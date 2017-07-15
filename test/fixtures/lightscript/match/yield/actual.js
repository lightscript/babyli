f() -*>
  yield match x:
    | a: 1
    | b: yield z()
    | c:
      yield z()
