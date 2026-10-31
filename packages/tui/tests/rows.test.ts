import { afterEach, describe, expect, test } from 'bun:test'
import { clip, duration, fe, fit, fitEnd, num, pad, padStart, visibleLength } from '../src/format'
import { MARKER, rowChunks, rowText } from '../src/rows'
import { colorEnabled, setColorEnabled, theme } from '../src/theme'

afterEach(() => {
  setColorEnabled(undefined)
})

describe('the numbers', () => {
  test('a number has thousands separators', () => {
    expect(num(1234567)).toBe('1,234,567')
    expect(num(0)).toBe('0')
    expect(num(1.5)).toBe('1.5')
  })

  test('an amount of FE says so', () => {
    expect(fe(1234.5)).toBe('1,234.5 FE')
  })

  test('a time is written the way a person reads it', () => {
    expect(duration(45_000)).toBe('45s')
    expect(duration(724_000)).toBe('12m 04s')
    expect(duration(13_020_000)).toBe('3h 37m')
  })
})

describe('the width of the text', () => {
  test('it counts the columns, not the characters', () => {
    expect(visibleLength('abc')).toBe(3)
    expect(visibleLength('日本')).toBe(4)
  })

  test('text is cut to the width it is given', () => {
    expect(clip('abcdef', 3)).toBe('abc')
    expect(clip('abc', 5)).toBe('abc')
    expect(clip('abc', 0)).toBe('')
  })

  test('text is padded to the width it is given', () => {
    expect(pad('ab', 4)).toBe('ab  ')
    expect(padStart('ab', 4)).toBe('  ab')
    expect(pad('abcdef', 3)).toBe('abc')
  })

  test('long text is fitted with an ellipsis', () => {
    expect(fit('abcdef', 4)).toBe('abc…')
    expect(fit('abc', 4)).toBe('abc')
    expect(fitEnd('abcdef', 4)).toBe('…def')
  })
})

describe('a row of a table', () => {
  test('the cells share what is left', () => {
    const text = rowText(
      {
        cells: [
          { text: 'Ember Core' },
          { text: '12', width: 4, align: 'right' },
        ],
      },
      20,
    )
    expect(text).toBe('  Ember Core      12')
    expect(visibleLength(text)).toBe(20)
  })

  test('the row that is picked out is marked', () => {
    const text = rowText(
      {
        selected: true,
        cells: [{ text: 'Ember Core' }],
      },
      12,
    )
    expect(text.startsWith(`${MARKER} `)).toBe(true)
    expect(visibleLength(text)).toBe(12)
  })

  test('the picked out row is put on the background of the selection', () => {
    setColorEnabled(true)
    const chunks = rowChunks(
      {
        selected: true,
        cells: [{ text: 'Ember Core' }],
      },
      12,
    )
    expect(chunks.some((chunk) => chunk.bg !== undefined)).toBe(true)
  })

  test('without colours there is no colour and no background', () => {
    setColorEnabled(false)
    const chunks = rowChunks(
      {
        selected: true,
        cells: [{ text: 'Ember Core', tone: 'gold' }],
      },
      12,
    )
    for (const chunk of chunks) {
      expect(chunk.fg).toBeUndefined()
      expect(chunk.bg).toBeUndefined()
    }
  })

  test('the colours can be turned off and on again', () => {
    setColorEnabled(true)
    expect(colorEnabled()).toBe(true)
    setColorEnabled(false)
    expect(colorEnabled()).toBe(false)
    setColorEnabled(undefined)
    expect(colorEnabled()).toBe(process.env.NO_COLOR === undefined)
  })

  test('the theme has a colour for everything', () => {
    for (const [name, value] of Object.entries(theme)) {
      expect(typeof value).toBe('string')
      expect(value.startsWith('#')).toBe(true)
      expect(name.length).toBeGreaterThan(0)
    }
  })
})
