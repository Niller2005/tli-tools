import { afterEach, describe, expect, test } from 'bun:test'
import { chip, hintChunks, meter, mix, panelTitle, signTone, sparkline } from '../src/chrome'
import { setColorEnabled } from '../src/theme'

afterEach(() => {
  setColorEnabled(undefined)
})

const text = (chunks: { text: string }[]): string => chunks.map((chunk) => chunk.text).join('')

describe('mix', () => {
  test('it runs from the first colour to the second', () => {
    expect(mix('#000000', '#ffffff', 0)).toBe('#000000')
    expect(mix('#000000', '#ffffff', 1)).toBe('#ffffff')
    expect(mix('#000000', '#fe0000', 0.5)).toBe('#7f0000')
  })
})

describe('chips and hints', () => {
  test('a chip has a background of its own, and brackets when the colours are off', () => {
    setColorEnabled(true)
    const coloured = chip('tax on', 'green')
    expect(coloured.text).toBe(' tax on ')
    expect(coloured.bg).toBeDefined()

    setColorEnabled(false)
    expect(chip('tax on', 'green').text).toBe('[tax on]')
  })

  test('the key hints stay readable without colours', () => {
    setColorEnabled(false)
    expect(text(hintChunks([['q', 'quit'], ['?', 'help']]))).toBe('q quit  ? help')
  })

  test('a panel title marks the focus only when asked to', () => {
    expect(panelTitle('Runs')).toBe(' Runs ')
    expect(panelTitle('Runs', true)).toBe(' ● Runs ')
    expect(panelTitle('Runs', false)).toBe(' ○ Runs ')
  })
})

describe('meter and sparkline', () => {
  test('a meter is always as wide as it was asked to be', () => {
    setColorEnabled(false)
    expect(text(meter(0, 6))).toBe('──────')
    expect(text(meter(0.5, 6))).toBe('━━━───')
    expect(text(meter(2, 6))).toBe('━━━━━━')
    expect(text(meter(-1, 6))).toBe('──────')
  })

  test('a sparkline is scaled to its highest value', () => {
    setColorEnabled(false)
    expect(sparkline([0, 4, 8]).text).toBe('▁▄█')
    expect(sparkline([0, 0]).text).toBe('▁▁')
  })

  test('a change is green up, red down and quiet when it did not move', () => {
    expect(signTone(3)).toBe('green')
    expect(signTone(-3)).toBe('red')
    expect(signTone(0)).toBe('dim')
  })
})
