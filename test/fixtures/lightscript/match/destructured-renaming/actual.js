match x:
  | x.a with { a, b = 1 }: a + b
  | x.0 and x.1 with [ a, b ]: a + b
