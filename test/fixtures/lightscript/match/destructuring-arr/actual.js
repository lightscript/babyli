match x:
  | with [ a, b ]: a - b
  | with [ a, b = 2 ]: a + b - 2
  | with [ a, ...b ]: b.concat(a)
  | with [
      [
        b
        d = 'e'
      ]
      [ g, , h ]
      ...j
  ]:
    [b, d, g, ...j].join('')
  | foo with [ a, b ]: a - b
  | foo with [ a, b = 2 ]: a + b - 2
  | foo with [ a, ...b ]: b.concat(a)
  | foo with [[b, d = 'e'], [g,,h], ...j ]:
    [b, d, g, ...j].join('')
