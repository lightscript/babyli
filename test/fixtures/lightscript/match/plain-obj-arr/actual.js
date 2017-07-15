match x:
  | { a, b }~isObject(): true
  | { a: 'a' }: 'should throw in compiler'
  | [a, b].includes(x): true
  | [a, 'b']: 'should throw in compiler'
