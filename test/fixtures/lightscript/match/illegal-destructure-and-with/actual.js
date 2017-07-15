match x:
  // error must be thrown at the compiler level
  // TODO: consider using lodash `isMatch` for this.
  | { a } with { a }: "not allowed"
