import { describe, expect, test } from 'bun:test'
import { arg, flag } from '../src/args'

describe('arg', () => {
  test('reads the value after the equals sign, whole', () => {
    expect(arg('log', ['bun', 'x.ts', '--log=/tmp/a=b.log'])).toBe('/tmp/a=b.log')
  })

  test('an empty value is empty, not missing', () => {
    expect(arg('log', ['--log='])).toBe('')
  })

  test('a missing option is null', () => {
    expect(arg('log', ['--other=1', '--logs=2'])).toBeNull()
  })

  test('the value in the next argument is not read', () => {
    expect(arg('log', ['--log', 'a.log'])).toBeNull()
  })

  test('reads process.argv when no argv is given', () => {
    expect(arg('definitely-not-passed')).toBeNull()
  })
})

describe('flag', () => {
  test('is true when the bare option is there', () => {
    expect(flag('no-color', ['--no-color'])).toBe(true)
  })

  test('is false when it is missing or only a prefix of another', () => {
    expect(flag('no-color', ['--no-colors', '--no-color=1'])).toBe(false)
  })
})
