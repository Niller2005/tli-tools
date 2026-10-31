import { describe, expect, test } from "bun:test"
import { price } from '../src/format'
describe('price', () => {
  test('small prices keep their first digits', () => {
    expect(price(533)).toBe('533 FE')
    expect(price(0.5)).toBe('0.5 FE')
    expect(price(0.0003000300030003)).toBe('0.0003 FE')
    expect(price(0.015094339622642)).toBe('0.015 FE')
    expect(price(0)).toBe('0 FE')
  })
})
