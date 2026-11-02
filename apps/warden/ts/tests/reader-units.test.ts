//! The reader's own tests, ported from the Rust modules' unit tests
//! (src/reader/layout.rs, src/reader/panels.rs).

import { describe, expect, test } from 'bun:test'
import { readModel, Rect, REF_H, REF_W, Rgba } from '@/reader/mod'
import type { Warning } from '@/reader/model'
import { framePoint, is16x9, layOut, layOutTitle, type Layout } from '@/reader/layout'
import { target, toFrame } from '@/reader/click'
import { portrait } from '@/reader/scene'
import type { Spot } from '@/reader/panels'
import {
  bestMatch,
  buttons,
  completedTail,
  days,
  door,
  doors,
  interrogation,
  number,
  objective,
  popup,
  progressOf,
  rerolls,
  squash,
  theme,
} from '@/reader/panels'
import type { Line } from '@/reader/ocr'

/** A gradient image, as the layout tests build it. */
function gradient(w: number, h: number): Rgba {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = i % w % 256
    data[i * 4 + 1] = Math.trunc(i / w) % 256
    data[i * 4 + 2] = 7
    data[i * 4 + 3] = 255
  }
  return new Rgba(w, h, data)
}

/** A black image with a white block of `size` px around (cx, cy). */
function blocked(w: number, h: number, marks: [number, number, number][]): Rgba {
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    data[i * 4 + 3] = 255
  }
  for (const [cx, cy, size] of marks) {
    for (let y = cy - size; y <= cy + size; y++) {
      for (let x = cx - size; x <= cx + size; x++) {
        if (x < 0 || y < 0 || x >= w || y >= h) continue
        const i = (y * w + x) * 4
        data[i] = 255
        data[i + 1] = 255
        data[i + 2] = 255
      }
    }
  }
  return new Rgba(w, h, data)
}

describe('the layout', () => {
  test('a 16:9 frame is resized', () => {
    const frame = gradient(1280, 720)
    expect(Array.from(layOut(frame, 1.0).data)).toEqual(Array.from(frame.resize(REF_W, REF_H).data))
    const near = gradient(1902, 1072)
    expect(Array.from(layOut(near, 1.0).data)).toEqual(Array.from(near.resize(REF_W, REF_H).data))
    expect(is16x9(1280, 720)).toBe(true)
    expect(is16x9(1902, 1072)).toBe(true)
    expect(is16x9(1716, 720)).toBe(false)
  })

  /// A 1716 x 720 frame (2.38:1) with white blocks at the first
  /// instrument icon, the board's middle and the first vault slot.
  test('a wide frame keeps its edges pinned', () => {
    const [w, h] = [1716, 720]
    const frame = blocked(w, h, [
      [82, 261, 12],
      [858, 200, 12],
      [1584, 160, 12],
    ])
    const out = layOut(frame, 1.0)
    expect([out.w, out.h]).toEqual([REF_W, REF_H])
    // The scaled frame is 2569 wide: 651 more than the reference.
    for (const [x, y] of [
      [122, 390],
      [960, 300],
      [1720, 240],
    ]) {
      expect(out.rgb(x, y)).toEqual([255, 255, 255])
    }
    // Centred, the edge blocks would land 325 px further in.
    for (const [x, y] of [
      [122 + 325, 390],
      [1720 - 325, 240],
    ]) {
      expect(out.rgb(x, y)).toEqual([0, 0, 0])
    }
  })

  /// A black 1920 x 1084 frame at u = 0.645 with a white 7 x 7 block about
  /// where each kind of anchor puts a reference point (worked out by hand
  /// from the zone formula): each lands on its reference point.
  test('a scaled frame lands on the reference points', () => {
    const [w, h] = [1920, 1084]
    // (reference point, block centre on the frame, what anchors it).
    const marks: [number, number, number, number, string][] = [
      [960, 600, 960, 581, 'centre, centre (outside every zone)'],
      [100, 100, 65, 65, 'left, top'],
      [1800, 100, 1843, 65, 'right, top'],
      [1724, 1003, 1794, 843, 'right, centre'],
      [959, 30, 960, 19, 'centre, top'],
      [959, 1000, 960, 1033, 'centre, bottom'],
      [122, 391, 78, 251, 'left, top about a point off the corner'],
      [959, 120, 960, 78, 'centre, top in the title layout only'],
    ]
    const frame = blocked(w, h, marks.map(([, , cx, cy]) => [cx, cy, 3]))
    const board = layOut(frame, 0.645)
    const title = layOutTitle(frame, 0.645, board)
    for (const [x, y, , , what] of marks) {
      expect(title.rgb(x, y)).toEqual([255, 255, 255])
      expect(what.length).toBeGreaterThan(0)
    }
    for (const [x, y] of marks.slice(0, 7).map(([x, y]) => [x, y])) {
      expect(board.rgb(x, y)).toEqual([255, 255, 255])
    }
    expect(board.rgb(959, 120)).toEqual([0, 0, 0])
  })

  /// A reference point's frame pixel at unit scale: the identity at 1920 x
  /// 1080 within 1.5 px, a plain scale at 2560 x 1440, and on a 3440 x 1440
  /// ultrawide the board moved right by its centring offset while Cancel
  /// keeps to the right edge.
  test('a reference point at unit scale', () => {
    const [[x, y], s] = framePoint([959.0, 539.0], 'board', 1920, 1080, 1.0)
    expect(Math.abs(x - 959.0)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(y - 539.0)).toBeLessThanOrEqual(1.5)
    expect(Math.abs(s - 1.0)).toBeLessThan(0.01)
    const k = Math.fround(1440.0 / REF_H)
    const [p, s2] = framePoint([500.0, 300.0], 'board', 2560, 1440, 1.0)
    expect(Math.abs(p[0] - (500.5 * 2560.0) / REF_W + 0.5)).toBeLessThan(0.01)
    expect(Math.abs(p[1] - (300.5 * k - 0.5))).toBeLessThan(0.01)
    expect(s2).toBe(k)
    // The 3440 px frame is 2575 reference px wide: the board sits about 328.6 px further right.
    const [[x2], s3] = framePoint([959.0, 539.0], 'board', 3440, 1440, 1.0)
    const offset = (3440.0 / k - REF_W) / 2.0
    expect(Math.abs(offset - 328.6)).toBeLessThan(0.1)
    expect(Math.abs((x2 + 0.5) / k - 959.5 - offset)).toBeLessThan(0.01)
    expect(s3).toBe(k)
    const [[x3, y3]] = framePoint([1724.0, 803.0], 'board', 3440, 1440, 1.0)
    expect(Math.abs((3440.0 - x3 - 0.5) / k - (REF_W - 1724.5))).toBeLessThan(0.01)
    expect(Math.abs((y3 + 0.5) / k - 803.5)).toBeLessThan(0.01)
  })
})

describe('the panel reader', () => {
  test('the fuzzy names', () => {
    const names = ["Ferocious Beast's Ravenous Chains", "Scapegoat's Guillotine", "Kin's Coin of Fate", 'Forged Key']
    expect(bestMatch("Ferocious Beast's Ravenous Chains", names, 0.75)).toEqual([0, 1.0])
    expect(bestMatch('ferocious beasts ravenous chalns', names, 0.75)?.[0]).toBe(0)
    expect(bestMatch("Scapegoat'sGuillotlne", names, 0.75)?.[0]).toBe(1)
    expect(bestMatch("Kin 's Coin of Fale", names, 0.75)?.[0]).toBe(2)
    expect(bestMatch('Randomly removes 2 other', names, 0.75)).toBeNull()
    expect(door('Go to Celi9.')).toBe(9)
    expect(door('Go to Imeycogation Room')).toBe(1)
    expect(door('Go to Cell 16')).toBe(16)
    expect(number('O')).toBe(0)
    expect(squash('Go to Cell 16!')).toBe('gotocell16')
  })

  test('the objective progress parses', () => {
    expect(progressOf('0/2', 2)).toBe(0)
    expect(progressOf('times0/2', 2)).toBe(0)
    expect(progressOf('O/18', 18)).toBe(0)
    expect(progressOf('Trigger ! Prison Incident 2 times 1/2', 2)).toBe(1)
    expect(progressOf('Completed', 4)).toBe(4)
    expect(progressOf('Move 18 tiles Completed', 18)).toBe(18)
    expect(progressOf('UltimateCompleted', 1)).toBe(1)
    expect(progressOf('Move 18 tiles 7/18', 18)).toBe(7)
    expect(progressOf('timesl/2', 2)).toBe(1)
    expect(progressOf('tilesl0/18', 18)).toBe(10)
    expect(progressOf('times0/2', 2)).toBe(0)
    expect(progressOf('Complete 2 objectives 1/2', 2)).toBe(1)
    expect(progressOf('Consume 4 times', 4)).toBeNull()
    expect(progressOf('3/2', 2)).toBeNull()
    expect(completedTail('Move 18 tiles Completed')).toBe(true)
    expect(completedTail('Consume 4 times')).toBe(false)
  })

  test('the cards by position', async () => {
    const line = (text: string, x: number, y: number): Line => ({ text, rect: new Rect(x, y, 160, 30) })
    // Three cards, the room on two lines.
    const three = [
      line('Go to Cell 7', 535, 860),
      line('Go to Interrogation', 880, 845),
      line('Room', 920, 875),
      line('Go to Cell 12', 1225, 860),
    ]
    expect((await doors(three, async () => null)).map((c) => c[0])).toEqual([7, 1, 12])
    // Two cards centred between the three-card columns (Burning Stake).
    const two = [line('Go to Cell 5', 1060, 860), line('Go to Cell 2', 710, 860)]
    expect((await doors(two, async () => null)).map((c) => c[0])).toEqual([2, 5])
    // OCR of a live frame at the reader's scale: junk before "Go", 11 read as IL.
    const live = [line('so to Cell 6', 710, 869), line('eGo to Cell IL', 1057, 869)]
    expect((await doors(live, async () => null)).map((c) => c[0])).toEqual([6, 11])
    // The card under the mouse: "Go" dropped and "Cell 11" garbled; it is read again.
    const hovered = [line('to Cell 8', 588, 869), line('to celgl', 927, 869), line('Go to Cell 13', 1234, 869)]
    expect((await doors(hovered, async (x) => (x === 1007 ? 11 : null))).map((c) => c[0])).toEqual([8, 11, 13])
  })

  test('the decision buttons are read on the name row only', () => {
    const line = (text: string, x: number, y: number): Line => ({ text, rect: new Rect(x, y, 100, 30) })
    // Junk from the pulsing card art above card 1 ("e n-.z", seen on a Hunt day) is no End button.
    expect(buttons([line('e n-.z', 506, 796), line('Go to Cell 15', 560, 845)])).toEqual([])
    const found = buttons([line('Consume', 390, 865), line('Hunt', 700, 865), line('End', 1000, 865)])
    expect(found.map((b) => b[0])).toEqual(['Consume', 'Hunt', 'End'])
  })

  test('the interrogation cards', () => {
    const line = (text: string, x: number): Line => ({ text, rect: new Rect(x, 862, 110, 30) })
    expect(interrogation([line('Instigate', 738), line('Bestow', 1090)])).not.toBeNull()
    expect(interrogation([line('lnstigate', 738), line('Bestaw', 1090)])).not.toBeNull()
    expect(interrogation([line('Instigate', 738)])).toBeNull()
    expect(interrogation([line('Consume', 600), line('Replace', 900), line('End', 1200)])).toBeNull()
  })

  test('the re-roll count', () => {
    const read = (text: string): number => rerolls([{ text, rect: new Rect(693, 893, 199, 22) }])
    // As Windows OCR read reroll-2000x837.
    expect(read('Remaining attemptsl')).toBe(1)
    expect(read('Remaining attempts1')).toBe(1)
    expect(read('Remaining attempts 2')).toBe(2)
    expect(read('Remainingattempts2')).toBe(2)
    // The text shows only with re-rolls left.
    expect(read('Remaining attempts')).toBe(1)
    expect(read('Confirm')).toBe(0)
    expect(rerolls([])).toBe(0)
  })

  test('the door numbers', () => {
    expect(door('Go to Cell lO')).toBe(10)
    expect(door('Go to Cell 16')).toBe(16)
    // The "l" of "Cell" is not a 1.
    expect(door('Go to Cell')).toBeNull()
    expect(door('Go to Interrogation Room')).toBe(1)
  })

  test('the days counter', () => {
    const read = (text: string): number | null => days([{ text, rect: new Rect(844, 11, 235, 33) }])
    expect(read('12 day(s) until Riot')).toBe(12)
    expect(read('1 day(s) until Riot')).toBe(1)
    // The red 0 on the last day, as Windows OCR read it in a recording.
    expect(read('() day(S) untii Riot')).toBe(0)
    expect(read('0day(s) until Riot')).toBe(0)
    expect(read('Oday(s) until Riot')).toBe(0)
    expect(read('O day(s) until Riot')).toBe(0)
    expect(read('1 0 day(s) until Riot')).toBe(10)
    expect(read('13 dav(s) until Riot')).toBe(13)
    expect(read('day(s) until Riot')).toBeNull()
    expect(read('Tartarus Prison')).toBeNull()
    expect(days([])).toBeNull()
  })

  test('the dialogs', () => {
    const lines = (texts: string[]): Line[] =>
      texts.map((t) => ({ text: t, rect: new Rect(560, 561, 800, 34) }))
    expect(popup(lines(['Tip', 'Network request timeout. Please try again later.(5684)']), [])).toBe(true)
    expect(popup(lines(['Connecting to server...']), [])).toBe(true)
    expect(popup([], lines(['Behind Closed Doors']))).toBe(true)
    expect(popup(lines(['Multiple']), lines(['Warden']))).toBe(false)
    expect(popup([], [])).toBe(false)
    expect(theme(lines(['Opulence']))).toBe(302)
    expect(theme(lines(['Cage Fiqht']))).toBe(304)
    expect(theme(lines(['Warden']))).toBeNull()
  })

  test('the objective panel', () => {
    const lines = (texts: string[]): Line[] =>
      texts.map((t) => ({ text: t, rect: new Rect(30, 110, 370, 30) }))
    expect(objective(lines(['Objective: Undercurrents', '0/2']))).toEqual({ id: 4, progress: 0 })
    expect(objective(lines(['Objective: Survival of the Fittest', 'Completed']))).toEqual({ id: 2, progress: 4 })
    expect(objective(lines(['Nothing here']))).toBeNull()
  })
})

/** The layout the frame point test uses: the board layout's zones. */
export type { Layout }

describe('the click targets', () => {
  /** The spots of a patrol screen with three destination cards. */
  const doors: [Spot, Layout, [number, number]][] = [
    [{ kind: 'door', door: 7 }, 'board', [615, 835]],
    [{ kind: 'door', door: 12 }, 'board', [960, 835]],
    [{ kind: 'door', door: 1 }, 'board', [1305, 835]],
  ]

  test('the destination cards', () => {
    // Actions name model cells; the screen numbers them from 1.
    expect(target('patrol', doors, { type: 'patrol', cell: 6 })?.at).toEqual([615, 835])
    expect(target('patrol', doors, { type: 'patrol', cell: 11 })?.at).toEqual([960, 835])
    expect(target('patrol', doors, { type: 'patrol', cell: 0 })?.at).toEqual([1305, 835])
    // A door the screen does not show has nothing to click.
    expect(target('patrol', doors, { type: 'patrol', cell: 3 })).toBeNull()
    expect(target('patrol', doors, { type: 'end' })).toBeNull()
  })

  test('the decision buttons', () => {
    const buttons: [Spot, Layout, [number, number]][] = [
      [{ kind: 'button', button: 'Consume' }, 'board', [614, 845]],
      [{ kind: 'button', button: 'Replace' }, 'board', [960, 845]],
      [{ kind: 'button', button: 'End' }, 'board', [1304, 845]],
    ]
    expect(target('manage', buttons, { type: 'devour', to: 4 })?.at).toEqual([614, 845])
    expect(target('manage', buttons, { type: 'swap' })?.at).toEqual([960, 845])
    expect(target('manage', buttons, { type: 'end' })?.at).toEqual([1304, 845])
    // The Hunt is not on the screen.
    expect(target('manage', buttons, { type: 'hunt', cell: 4 })).toBeNull()
  })

  test('the pick cards and the board cells', () => {
    const cards: [Spot, Layout, [number, number]][] = [
      [{ kind: 'card', card: 'chains' }, 'board', [493, 528]],
      [{ kind: 'card', card: 'coin' }, 'board', [1341, 528]],
    ]
    expect(target('instrumentPick', cards, { type: 'choose', id: 'chains' })?.at).toEqual([493, 528])
    expect(target('instrumentPick', cards, { type: 'choose', id: 'coin' })?.at).toEqual([1341, 528])
    // A card that is not on offer has nothing to click.
    expect(target('instrumentPick', cards, { type: 'choose', id: 'saw' })).toBeNull()
    // The board cells are the portraits of the screen cells.
    expect(target('cellPick', [], { type: 'choose', id: 3 })?.at).toEqual(portrait(4))
    expect(target('chainTarget', [], { type: 'devour', to: 5 })?.at).toEqual(portrait(6))
    expect(target('chainTarget', [], { type: 'chain', to: 5 })?.at).toEqual(portrait(6))
    expect(target('cellPick', [], { type: 'event' })).toBeNull()
  })

  test('the click on the game frame', () => {
    const click = target('patrol', doors, { type: 'patrol', cell: 6 })
    expect(click).not.toBeNull()
    const [x, y, hw, hh] = toFrame(click!, 1918, 1078, 1)
    expect(Math.abs(x - 615)).toBeLessThan(1.5)
    expect(Math.abs(y - 835)).toBeLessThan(1.5)
    expect(hw).toBeCloseTo(165, 1)
    expect(hh).toBeCloseTo(85, 1)
  })
})

/** A doubtful read the reader flags, for the identity assertions below. */
function cellReads(warnings: Warning[]): Extract<Warning, { kind: 'cellRead' }>[] {
  return warnings.filter((w): w is Extract<Warning, { kind: 'cellRead' }> => w.kind === 'cellRead')
}

describe('the warnings of a read frame', () => {
  /** A warning says which cell and which read of it is doubtful, with the
   * confidence measured: its identity, not its sentence (see
   * [`warningText`]). */
  test('the warnings carry their identity', async () => {
    const day19 = await readModel(new URL('./fixtures/s16-board-day19.png', import.meta.url).pathname, [])
    const doubtful = cellReads(day19[1])
    expect(doubtful).toHaveLength(2)
    expect(doubtful[0]).toMatchObject({ cell: 7, detail: 'rarity', read: 'Ultimate Alpha Wolf' })
    expect(doubtful[0].confidence).toBeCloseTo(0.24, 2)
    expect(doubtful[1]).toMatchObject({ cell: 15, detail: 'event' })
    expect(doubtful[1].confidence).toBeCloseTo(0.03, 2)

    const tyranny = await readModel(new URL('./fixtures/s16-theme-tyranny.png', import.meta.url).pathname, [])
    const reads = cellReads(tyranny[1])
    expect(reads[0]).toMatchObject({ cell: 8, detail: 'lock', read: 'locked' })
    expect(reads[0].confidence).toBeCloseTo(0.14, 2)
    expect(reads[1]).toMatchObject({ cell: 9, detail: 'beast', read: 'Normal Berserk Lion' })
    expect(reads[2]).toMatchObject({ cell: 10, detail: 'glowless', read: 'Normal Alpha Wolf' })
    expect(reads[2].confidence).toBeUndefined()
    expect(tyranny[1]).toContainEqual({ kind: 'note', cell: null, text: "The run's theme: Tyranny. Nothing to solve on this screen." })
  })
})
