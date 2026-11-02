import { afterEach, describe, expect, test } from 'bun:test'
import { chip, chunksWidth, footerChunks, hintChunks, keyHint, meter, mix, panelTitle, signTone, sparkline, topBarChunks } from '../src/chrome'
import { setColorEnabled, tone } from '../src/theme'

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

describe('the key hint', () => {
  test('the key is on a cap with one space before its label, coloured or not', () => {
    setColorEnabled(true)
    expect(text(keyHint('q', 'quit'))).toBe(' q quit')
    setColorEnabled(false)
    expect(text(keyHint('q', 'quit'))).toBe('q quit')
  })
})

describe('topBarChunks', () => {
  const bar = {
    name: 'Dashboard',
    sub: 'Torchlight: Infinite tools',
    chips: [
      ['log ok', 'green'],
      ['2 running', 'orange'],
    ] as const,
  }

  test('a wide bar shows the name, the sub and every chip', () => {
    setColorEnabled(false)
    const chunks = topBarChunks(bar, 100)
    expect(text(chunks)).toBe('◆ Dashboard  Torchlight: Infinite tools  [log ok]  [2 running]')
  })

  test('a narrow bar cuts the sub from the front and leaves chips out from the end', () => {
    setColorEnabled(false)
    expect(text(topBarChunks(bar, 32))).toBe('◆ Dashboard  …ht: Infinite tools')
    // once the sub fits, the chips come back, most important first, while there is room
    expect(text(topBarChunks(bar, 50))).toBe('◆ Dashboard  Torchlight: Infinite tools  [log ok]')
    // the name is cut last, and never past the edge
    expect(text(topBarChunks(bar, 8))).toBe('◆ Dashbo')
  })

  test('the bar is never wider than the terminal', () => {
    setColorEnabled(false)
    for (let width = 0; width <= 60; width += 1) {
      expect(chunksWidth(topBarChunks(bar, width))).toBeLessThanOrEqual(width)
    }
  })
})

describe('footerChunks', () => {
  const hints = [
    ['↑/↓', 'move'],
    ['space', 'select'],
    ['⏎', 'run'],
    ['w', 'window'],
    ['?', 'help'],
    ['q', 'quit'],
  ] as const

  test('a wide bar shows every key', () => {
    setColorEnabled(false)
    expect(text(footerChunks({ hints }, 100))).toBe(
      '↑/↓ move  space select  ⏎ run  w window  ? help  q quit',
    )
  })

  test('the keys between the first and the last go first; the menu key and the quit key survive', () => {
    setColorEnabled(false)
    expect(text(footerChunks({ hints }, 34))).toBe('↑/↓ move  w window  ? help  q quit')
    expect(text(footerChunks({ hints }, 33))).toBe('↑/↓ move  ? help  q quit')
    expect(text(footerChunks({ hints }, 16))).toBe('↑/↓ move  q quit')
    expect(text(footerChunks({ hints }, 15))).toBe('q quit')
    expect(text(footerChunks({ hints }, 5))).toBe('q qui')
  })

  test('a message replaces the keys', () => {
    setColorEnabled(false)
    expect(text(footerChunks({ hints, message: 'the prices are being fetched' }, 100))).toBe(
      'the prices are being fetched',
    )
    expect(text(footerChunks({ hints, message: 'the prices are being fetched' }, 10))).toBe(
      'the prices',
    )
  })

  test('the pieces after the keys go first, the middle keys next, and the chips before the keys last', () => {
    setColorEnabled(false)
    const after = [[tone('dim', 'a legend')]] as const
    const chips = [['/vorax', 'accent']] as const
    const both = footerChunks({ hints, chips, after }, 100)
    expect(text(both)).toContain('[/vorax]')
    expect(text(both)).toContain('a legend')
    // narrow: the legend is left out and the middle keys go, but the filter chip survives beside the
    // menu and quit keys
    const narrow = footerChunks({ hints, chips, after }, 30)
    expect(text(narrow)).not.toContain('a legend')
    expect(text(narrow)).toContain('[/vorax]')
    expect(text(narrow)).toContain('q quit')
  })

  test('the bar is never wider than the terminal', () => {
    setColorEnabled(false)
    const chips = [['/vorax', 'accent'], ['bag /map', 'dim']] as const
    const after = [[tone('dim', 'a legend')], [tone('dim', 'an attribution')]] as const
    for (let width = 0; width <= 90; width += 1) {
      const chunks = footerChunks({ hints, chips, after }, width)
      expect(chunksWidth(chunks)).toBeLessThanOrEqual(width)
    }
  })
})
