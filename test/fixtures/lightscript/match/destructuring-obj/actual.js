match x:
  | with { a, b }: a - b
  | with { a, b = 2 }: a + b - 2
  | with { a, ...c }: [a, b, c].join('')
  | with {
    a: {
      b
      d = 'e'
    }
    f: { ...g }
  }:
    [b, d, g].join('')
  | foo with { a, b }: a + b
  | foo with { a, b = 2 }: a + b - 2
  | foo with { a, ...c }: [a, b, c].join('')
  | foo with {a:{b,d = 'e'},f:{ ...g }}:
    [b, d, g].join('')
