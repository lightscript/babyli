import Parser from "../parser";
import { types as tt } from "../tokenizer/types";

const REMAPPED_OPERATORS = {
  "!=": "!==",
  "==": "===",
  "or": "||",
  "and": "&&",
  "not": "!",
};

const MATCHING_ITER_VARS = {
  "idx": "elem",
  "elem": "idx",
  "key": "val",
  "val": "key",
};

export default (superClass: Class<Parser>): Class<Parser> => class extends superClass {

  isColonConstAssign(expr) {
    if (expr.type !== "AssignmentExpression") return false;
    if (expr.left.type === "MemberExpression") return false;
    if (expr.isNowAssign !== false) return false;

    return (
      expr.operator === "=" || expr.operator === "<-" || expr.operator === "<!-"
    );
  }

  rewriteAssignmentAsDeclarator(node) {
    node.type = "VariableDeclarator";
    node.id = node.left;
    node.init = node.right;
    delete node.left;
    delete node.operator;
    delete node.right;
    delete node.isNowAssign;
    return node;
  }

  // Must unwind state after calling this!
  // c/p parseVar and parseVarStatement
  tryParseAutoConst() {
    const node = this.startNode(), decl = this.startNode();
    try {
      this.parseVarHead(decl);
    } catch (err) {
      return null;
    }

    if (!this.eat(tt.eq)) return null;

    try {
      decl.init = this.parseMaybeAssign();
    } catch (err) {
      return null;
    }

    node.declarations = [this.finishNode(decl, "VariableDeclarator")];
    node.kind = "const";
    this.semicolon();

    return this.finishNode(node, "VariableDeclaration");
  }

  rewriteOperator(node) {
    if (REMAPPED_OPERATORS[node.operator]) {
      node.operator = REMAPPED_OPERATORS[node.operator];
    }
  }

  parseForInIterationVariable(node, targetType = null) {
    const iterType = this.state.value;
    if (targetType && targetType !== iterType) {
      this.unexpected(null, `Unexpected token, expected ${targetType}`);
    }

    this.next();
    node[iterType] = iterType === "elem" || iterType === "val"
      ? this.parseBindingAtom()
      : this.parseBindingIdentifier();
    return MATCHING_ITER_VARS[iterType];
  }

  parseEnhancedForIn(node) {
    const matchingIterationType = this.parseForInIterationVariable(node);
    if (this.eat(tt.comma)) {
      this.parseForInIterationVariable(node, matchingIterationType);
    }

    this.expect(tt._in);

    const iterable = this.parseMaybeAssign(true);

    this.expectParenFreeBlockStart(node);
    node.body = this.parseStatement(false);

    if ((matchingIterationType === "idx") || (matchingIterationType === "elem")) {
      node.array = iterable;
      return this.finishNode(node, "ForInArrayStatement");
    } else {
      node.object = iterable;
      return this.finishNode(node, "ForInObjectStatement");
    }
  }

  expectParenFreeBlockStart(node) {
    // if true: blah
    // if true { blah }
    // if (true) blah
    if (node && node.extra && node.extra.hasParens) {
      this.expect(tt.parenR);
    } else if (!(this.match(tt.colon) || this.match(tt.braceL))) {
      this.unexpected(null, "Paren-free test expressions must be followed by braces or a colon.");
    }
  }

  // [for ...: stmnt]
  parseArrayComprehension(node) {
    const loop = this.startNode();
    node.loop = this.parseForStatement(loop);
    this.expect(tt.bracketR);
    return this.finishNode(node, "ArrayComprehension");
  }

  parseObjectComprehension(node) {
    const loop = this.startNode();
    node.loop = this.parseForStatement(loop);
    this.expect(tt.braceR);
    return this.finishNode(node, "ObjectComprehension");
  }

  // c/p parseBlock
  parseWhiteBlock(allowDirectives?, isExpression?) {
    const node = this.startNode(), indentLevel = this.state.indentLevel;
    let allowEmptyBody = false;

    // must start with colon or arrow
    if (isExpression) {
      this.expect(tt.colon);
      if (!this.isLineBreak()) return this.parseMaybeAssign();
    } else if (this.eat(tt.colon)) {
      if (!this.isLineBreak()) return this.parseStatement(false);
    } else if (this.eat(tt.arrow)) {
      allowEmptyBody = true;

      if (!this.isLineBreak()) {
        if (this.match(tt.braceL)) {
          // restart node at brace start instead of arrow start
          const node = this.startNode();
          this.next();
          this.parseBlockBody(node, allowDirectives, false, tt.braceR);
          this.addExtra(node, "curly", true);
          return this.finishNode(node, "BlockStatement");
        } else if (this.state.type.startsExpr) {
          return this.parseMaybeAssign();
        }
      }
    } else {
      this.unexpected(null, "Whitespace Block must start with a colon or arrow");
    }

    // never parse directives if curly braces aren't used (TODO: document)
    this.parseBlockBody(node, false, false, indentLevel);
    this.addExtra(node, "curly", false);
    if (!allowEmptyBody && !node.body.length) {
      this.unexpected(node.start, "Expected an Indent or Statement");
    }

    return this.finishNode(node, "BlockStatement");
  }

  expectCommaOrLineBreak() {
    // TODO: consider error message like "Missing comma or newline."
    if (!(this.eat(tt.comma) || this.isLineBreak())) this.unexpected(null, tt.comma);
  }

  // Arguably one of the hackiest parts of LightScript so far.
  seemsLikeStatementStart() {
    const lastTok = this.state.tokens[this.state.tokens.length - 1];
    if (lastTok && lastTok.type === tt.semi) return true;
    if (lastTok && lastTok.type === tt.braceR) return true;

    // This is not accurate; could easily be a continuation of a previous expression.
    if (this.isLineBreak()) return true;
  }

  isFollowedByLineBreak() {
    const end = this.state.input.length;

    let pos = this.state.pos;
    while (pos < end) {
      const code = this.state.input.charCodeAt(pos);
      if (code === 10) {
        return true;
      } else if (code === 32 || code === 13) {
        ++pos;
        continue;
      } else {
        return false;
      }
    }
  }

  // detect whether we're on a (non-indented) newline
  // relative to another position, eg;
  // x y -> false
  // x\ny -> true
  // x\n  y -> false
  isNonIndentedBreakFrom(pos) {
    const indentLevel = this.indentLevelAt(pos);
    return this.isLineBreak() && this.state.indentLevel <= indentLevel;
  }

  // walk backwards til newline or start-of-file.
  // if two consecutive spaces are found together, increment indents.
  // if non-space found, reset indentation.
  indentLevelAt(pos) {
    let indents = 0;
    while (pos > 0 && this.state.input[pos] !== "\n") {
      if (this.state.input[pos--] === " ") {
        if (this.state.input[pos] === " ") {
          --pos;
          ++indents;
        }
      } else {
        indents = 0;
      }
    }
    return indents;
  }

  parseArrowType(node) {
    if (!this.match(tt.arrow)) return;
    const val = this.state.value;

    // validations
    const isPlainFatArrow = val === "=>" && !node.id && !node.key;
    if (node.async && !isPlainFatArrow) {
      this.unexpected(node.start, "Can't use async with lightscript arrows.");
    }
    if (node.generator) {
      this.unexpected(node.start, "Can't declare generators with arrows; try -*> instead.");
    }
    if (node.kind === "get") {
      this.unexpected(node.start, "Can't use arrow method with get; try -get> instead.");
    }
    if (node.kind === "set") {
      this.unexpected(node.start, "Can't use arrow method with set; try -set> instead.");
    }
    if (node.kind === "constructor" && val !== "->") {
      this.unexpected(null, "Can only use -> with constructor.");
    }

    switch (val) {
      case "=/>": case "-/>":
        node.async = true;
        break;
      case "=*>": case "-*>":
        node.generator = true;
        break;
      case "=/*>": case "-/*>":
        node.async = true;
        node.generator = true;
        break;
      case "-get>":
        // TODO: validate that it's in a method not a function
        if (!node.kind) this.unexpected(null, "Only methods can be getters.");
        node.kind = "get";
        break;
      case "-set>":
        if (!node.kind) this.unexpected(null, "Only methods can be setters.");
        node.kind = "set";
        break;
      case "=>": case "->":
        break;
      default:
        this.unexpected();
    }

    if (val[0] === "-") {
      node.skinny = true;
    } else if (val[0] === "=") {
      node.skinny = false;
    } else {
      this.unexpected();
    }
  }

  // largely c/p from parseFunctionBody
  parseArrowFunctionBody(node) {
    // set and reset state surrounding block
    const oldInAsync = this.state.inAsync,
      oldInGen = this.state.inGenerator,
      oldLabels = this.state.labels,
      oldInFunc = this.state.inFunction;
    this.state.inAsync = node.async;
    this.state.inGenerator = node.generator;
    this.state.labels = [];
    this.state.inFunction = true;

    node.body = this.parseWhiteBlock(true);

    if (node.body.type !== "BlockStatement") {
      node.expression = true;
    }

    this.state.inAsync = oldInAsync;
    this.state.inGenerator = oldInGen;
    this.state.labels = oldLabels;
    this.state.inFunction = oldInFunc;

    this.validateFunctionBody(node, true);
  }

  parseNamedArrowFromCallExpression(node, call) {
    this.initFunction(node);
    node.params = this.toAssignableList(call.arguments, true, "named arrow function parameters");
    if (call.typeParameters) node.typeParameters = call.typeParameters;

    let isMember;
    if (call.callee.type === "Identifier") {
      node.id = call.callee;
      isMember = false;
    } else if (call.callee.type === "MemberExpression") {
      node.id = call.callee.property;
      node.object = call.callee.object;
      isMember = true;
    } else {
      this.unexpected();
    }

    if (this.match(tt.colon)) {
      const oldNoAnonFunctionType = this.state.noAnonFunctionType;
      this.state.noAnonFunctionType = true;
      node.returnType = this.flowParseTypeAnnotation();
      this.state.noAnonFunctionType = oldNoAnonFunctionType;
    }
    if (this.canInsertSemicolon()) this.unexpected();

    this.check(tt.arrow);
    this.parseArrowType(node);
    this.parseArrowFunctionBody(node);

    // may be later rewritten as "NamedArrowDeclaration" in parseStatement
    return this.finishNode(node, isMember ? "NamedArrowMemberExpression" : "NamedArrowExpression");
  }

  pushBlockState(blockType, indentLevel) {
    this.state.blockStack.push({ blockType, indentLevel });
  }

  matchBlockState(blockType, indentLevel) {
    return this.state.blockStack.some((x) => x.blockType === blockType && x.indentLevel === indentLevel);
  }

  popBlockState() {
    this.state.blockStack.pop();
  }

  // c/p parseIfStatement
  parseIf(node, isExpression) {
    const indentLevel = this.state.indentLevel;
    this.next();
    node.test = this.parseParenExpression();

    const isColon = this.match(tt.colon);
    if (isColon) this.pushBlockState("if", indentLevel);

    if (isExpression) {
      if (this.match(tt.braceL)) {
        node.consequent = this.parseBlock(false);
      } else if (!isColon) {
        node.consequent = this.parseMaybeAssign();
      } else {
        node.consequent = this.parseWhiteBlock(false, true);
      }
    } else {
      node.consequent = this.parseStatement(false);
    }

    node.alternate = this.parseIfAlternate(node, isExpression, isColon, indentLevel);

    if (isColon) this.popBlockState();

    return this.finishNode(node, isExpression ? "IfExpression" : "IfStatement");
  }

  parseIfAlternate(node, isExpression, ifIsWhiteBlock, ifIndentLevel) {
    if (!this.match(tt._elif) && !this.match(tt._else)) return null;

    // If the indent level here doesn't match with the current whiteblock `if`, or
    // it matches with a whiteblock `if` higher on the stack, then this alternate
    // clause does not match the current `if` -- so unwind the recursive descent.
    const alternateIndentLevel = this.state.indentLevel;
    if (
      (alternateIndentLevel !== ifIndentLevel) &&
      (ifIsWhiteBlock || this.matchBlockState("if", alternateIndentLevel))
    ) {
      return null;
    }

    if (this.match(tt._elif)) {
      return this.parseIf(this.startNode(), isExpression);
    }

    if (this.eat(tt._else)) {
      if (this.match(tt._if)) {
        if (this.isLineBreak()) {
          this.unexpected(this.state.lastTokEnd, "Illegal newline.");
        }
        return this.parseIf(this.startNode(), isExpression);
      }

      if (this.isLineBreak()) {
        this.unexpected(this.state.lastTokEnd, tt.colon);
      }

      if (isExpression) {
        if (this.match(tt.braceL)) {
          return this.parseBlock(false);
        } else if (!this.match(tt.colon)) {
          return this.parseMaybeAssign();
        } else {
          return this.parseWhiteBlock(false, true);
        }
      }

      return this.parseStatement(false);
    }

    return null;
  }

  parseIfExpression(node) {
    return this.parseIf(node, true);
  }


  // c/p parseAwait
  parseSafeAwait(node) {
    if (!this.state.inAsync) this.unexpected();
    node.argument = this.parseMaybeUnary();
    return this.finishNode(node, "SafeAwaitExpression");
  }

  isAwaitArrowAssign(expr) {
    return (
      expr.type === "AssignmentExpression" &&
      (expr.operator === "<-" || expr.operator === "<!-")
    );
  }

  parseAwaitArrow(left) {
    const node = this.startNode();
    const arrowType = this.state.value;
    this.next();
    if (arrowType === "<!-") {
      if (left.type === "ObjectPattern" || left.type === "ArrayPattern") {
        this.unexpected(left.start, "Destructuring is not allowed with '<!-'.");
      }
      return this.parseSafeAwait(node);
    } else {
      return this.parseAwait(node);
    }
  }

  tryParseNamedArrowDeclaration() {
    let node = this.startNode();
    const call = this.startNode();

    if (!this.match(tt.name)) return null;
    if (this.state.value === "type") return null;
    try {
      call.callee = this.parseIdentifier();
    } catch (err) {
      return null;
    }


    // parse eg; `fn<T>() ->`
    if (this.hasPlugin("flow") && this.isRelational("<")) {
      try {
        node.typeParameters = this.flowParseTypeParameterDeclaration();
      } catch (err) {
        return null;
      }
    }

    if (!this.eat(tt.parenL)) return null;
    try {
      call.arguments = this.parseCallExpressionArguments(tt.parenR, false);
    } catch (err) {
      return null;
    }

    if (!this.shouldParseArrow()) return null;
    node = this.parseNamedArrowFromCallExpression(node, call);

    // Declaration, not Expression
    node.type = "NamedArrowDeclaration";
    return node;
  }

  isBitwiseOp() {
    return (
      this.match(tt.bitwiseOR) ||
      this.match(tt.bitwiseAND) ||
      this.match(tt.bitwiseXOR) ||
      this.match(tt.bitShift)
    );
  }


  // ==================================
  // Overrides
  // ==================================


  // if, switch, while, with --> don't need no stinkin' parens no more
  parseParenExpression() {
    if (this.isLineBreak()) {
      this.unexpected(this.state.lastTokEnd, "Illegal newline.");
    }

    // parens are special here; they might be `if (x) -1` or `if (x < 1) and y: -1`
    if (this.match(tt.parenL)) {
      const state = this.state.clone();

      // first, try paren-free style
      try {
        const val = this.parseExpression();
        if (this.match(tt.braceL) || this.match(tt.colon)) {
          if (val.extra && val.extra.parenthesized) {
            delete val.extra.parenthesized;
            delete val.extra.parenStart;
          }
          return val;
        }
      } catch (_err) {
        // fall-through, will re-raise if it's an error below
      }

      // otherwise, try traditional parseParenExpression
      this.state = state;
      return super.parseParenExpression(...arguments);
    }

    const val = this.parseExpression();
    this.expectParenFreeBlockStart();
    return val;
  }

  // `export` is the only time auto-const and can be preceded by a non-newline,
  // and has a bunch of weird parsing rules generally.
  parseExport(node) {
    if (this.isContextual("type") || this.isContextual("interface")) {
      return super.parseExport(...arguments);
    }
    let state = this.state.clone();

    // first try NamedArrowDeclaration
    // eg; `export fn() -> 1`, `export fn<T>(x: T): T -> x`
    this.next();
    if (this.match(tt.name)) {
      const decl = this.tryParseNamedArrowDeclaration();
      if (decl) {
        node.specifiers = [];
        node.source = null;
        node.declaration = decl;
        this.checkExport(node, true);
        return this.finishNode(node, "ExportNamedDeclaration");
      }
    }

    // wasn't a NamedArrowDeclaration, reset.
    this.state = state;
    state = this.state.clone();

    // next, try auto-const
    // eg; `export x = 7`, `export { x, y }: Point = a`
    this.next();
    if (this.match(tt.name) || this.match(tt.bracketL) || this.match(tt.braceL)) {
      const decl = this.tryParseAutoConst();
      if (decl) {
        node.specifiers = [];
        node.source = null;
        node.declaration = decl;
        this.checkExport(node, true);
        return this.finishNode(node, "ExportNamedDeclaration");
      }
    }

    this.state = state;
    return super.parseExport(...arguments);
  }

  // whitespace following a colon
  parseStatement() {
    if (this.match(tt.colon)) {
      return this.parseWhiteBlock();
    }
    return super.parseStatement(...arguments);
  }

  // whitespace following a colon
  parseBlock(allowDirectives) {
    if (this.match(tt.colon)) {
      return this.parseWhiteBlock(allowDirectives);
    }
    const block = super.parseBlock(...arguments);
    this.addExtra(block, "curly", true);
    return block;
  }

  parseIfStatement(node) {
    return this.parseIf(node, false);
  }


};
