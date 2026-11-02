//! The app session without saved frames: the auto read's fingerprint and
//! watch, the days clock, the Consume targets and Avenger's Casket meals,
//! the run rules on synthetic reads, and the solve run on any number of
//! threads. A port of the pure parts of the Rust crate's tests/session.rs;
//! the tests on saved frames are in session-frames.test.ts,
//! session-flow.test.ts and session-instruments.test.ts.

import { expect, test } from 'bun:test'

import {
  differs,
  fingerprint,
  HELD_BLOCKS,
  MAX_WAIT,
  MAX_RECHECK,
  RECHECK,
  SETTLE,
  Session,
  Watch,
} from '@/app/session'
import { casketMeals, consumeTargets, DaysClock, type Reading } from '@/app/run'
import { blankModel, type CellModel } from '@/board/board'
import { Rgba, warningText } from '@/reader/mod'
import type { CellRead } from '@/reader/scene'
import { Rollouts } from '@/solver/solve'
import { TUNED } from '@/solver/mod'
import { buildBoard } from './common'
import { syntheticPanels, syntheticScene } from './session-common'

/** The auto read fingerprint: the same frame matches, a changed region or
 * another grid size differs. */
test('the fingerprint differs', () => {
  const [w, h] = [1280, 720]
  const data = new Uint8Array(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const [x, y] = [i % w, Math.floor(i / w)]
    data.set([x % 256, y % 256, (x + y) % 256, 255], i * 4)
  }
  const frame = new Rgba(w, h, data)
  const print = fingerprint(frame)
  expect(print.length).toBe(64 * 36)
  expect(differs(print, fingerprint(new Rgba(w, h, data.slice())))).toBe(false)

  // A 120 x 90 white patch, about the size of a cell.
  const changed = new Rgba(w, h, data.slice())
  for (let y = 300; y < 390; y++) {
    for (let x = 600; x < 720; x++) changed.data.fill(255, (y * w + x) * 4, (y * w + x) * 4 + 3)
  }
  expect(differs(print, fingerprint(changed))).toBe(true)
  expect(differs(print, print.slice(0, print.length - 1))).toBe(true)
})

/** A print of all `gray`, with the first `changed` blocks at 255. */
function print(gray: number, changed: number): Uint8Array {
  const p = new Uint8Array(64 * 36).fill(gray)
  p.fill(255, 0, changed)
  return p
}

/** A print of all `gray`, with `n` blocks at 255 starting at block `from`. */
function noisy(gray: number, from: number, n: number): Uint8Array {
  const p = new Uint8Array(64 * 36).fill(gray)
  p.fill(255, from, from + n)
  return p
}

/** The numbers 0 to `n` - 1. */
function upTo(n: number): number[] {
  return Array.from({ length: n }, (_, k) => k)
}

/** Auto read waits for [`SETTLE`] matching samples, reads a screen once and
 * ignores a hover-sized change. */
test('watch reads settled screens once', () => {
  const w = new Watch()
  // The screen keeps changing: no read.
  for (const g of [0, 50, 100, 150, 200]) expect(w.sample(print(g, 0))).toBe(false)
  // It settles: read after SETTLE samples matching the one before.
  for (let k = 0; k < SETTLE - 1; k++) expect(w.sample(print(200, 0))).toBe(false)
  expect(w.sample(print(200, 0))).toBe(true)
  // A hover glow under the threshold: no second read.
  for (let k = 0; k < 5; k++) {
    expect(w.sample(print(200, 0))).toBe(false)
    expect(w.sample(print(200, 2))).toBe(false)
  }
  // The same screen again, past RECHECK samples: never read again.
  expect(upTo(RECHECK + 20).every(() => !w.sample(print(200, 0)))).toBe(true)
  // Another screen: read once it settles, after SETTLE samples.
  const reads = upTo(SETTLE + 3).map(() => w.sample(print(10, 0)))
  expect(reads.indexOf(true)).toBe(SETTLE)
  expect(reads.filter((r) => r).length).toBe(1)
})

/** A lasting change under the threshold, such as an incident marker on a
 * cell, is read once [`RECHECK`] samples passed since the last read, then
 * not again. */
test('watch rechecks a small change', () => {
  const w = new Watch()
  expect(upTo(SETTLE + 1).filter(() => w.sample(print(200, 0))).length).toBe(1)
  expect(differs(print(200, 0), print(200, 2))).toBe(false)
  const reads = upTo(RECHECK).map(() => w.sample(print(200, 2)))
  expect(reads.indexOf(true)).toBe(RECHECK - 1)
  expect(reads.filter((r) => r).length).toBe(1)
  expect(upTo(40).every(() => !w.sample(print(200, 2)))).toBe(true)
})

/** A screen marked read, or the sample after `adoptNext`, is not read
 * again. */
test('watch markRead suppresses', () => {
  let w = new Watch()
  w.markRead(print(80, 0))
  expect(upTo(SETTLE + 3).every(() => !w.sample(print(80, 0)))).toBe(true)

  w = new Watch()
  w.adoptNext()
  expect(upTo(SETTLE + 3).every(() => !w.sample(print(30, 0)))).toBe(true)
  expect(upTo(SETTLE + 3).filter(() => w.sample(print(90, 0))).length).toBe(1)
})

/** The sample after `readNext` is read whatever it shows, once. */
test('watch readNext reads once', () => {
  const w = new Watch()
  w.markRead(print(80, 0))
  expect(w.sample(print(80, 0))).toBe(false)
  w.readNext()
  expect(w.sample(print(80, 0))).toBe(true)
  expect(upTo(SETTLE + 3).every(() => !w.sample(print(80, 0)))).toBe(true)
})

/** A new screen with an animation that moves up to [`HELD_BLOCKS`] blocks a
 * sample settles and is read; the next screen change is read too. */
test('watch reads a noisy screen', () => {
  // The animation's 12 blocks make two prints differ but hold.
  expect(differs(noisy(120, 0, 6), noisy(120, 6, 6))).toBe(true)
  expect(12).toBeLessThanOrEqual(HELD_BLOCKS)
  const w = new Watch()
  expect(upTo(SETTLE + 1).filter(() => w.sample(print(40, 0))).length).toBe(1)
  // A screen change, then an animation that moves 2 x 6 blocks every sample.
  expect(w.sample(print(120, 0))).toBe(false)
  let reads = upTo(SETTLE).map((k) => w.sample(noisy(120, 6 * (k % 2), 6)))
  expect(reads.at(-1)).toBe(true)
  // Another screen, with the same animation: read once it settles.
  expect(w.sample(noisy(200, 0, 6))).toBe(false)
  reads = upTo(SETTLE).map((k) => w.sample(noisy(200, 6 * (k % 2), 6)))
  expect(reads.at(-1)).toBe(true)
})

/** A screen whose edges pulse by more than [`HELD_BLOCKS`] blocks every
 * sample never settles: it is read after [`MAX_WAIT`] samples anyway. */
test('watch reads a pulsing screen after MAX_WAIT', () => {
  const w = new Watch()
  w.markRead(print(40, 0))
  const reads = upTo(MAX_WAIT + 1).map((k) => w.sample(noisy(120, 40 * (k % 2), 40)))
  expect(reads.indexOf(true)).toBe(MAX_WAIT)
})

/** The days clock: the counter only counts down, so a lone higher read is a
 * misread and the same higher value on two readings in a row is a new run. */
test('the days clock', () => {
  const c = new DaysClock()
  expect(c.update(null)).toBe(null) // nothing read yet
  expect(c.update(14)).toBe(14)
  expect(c.update(null)).toBe(14) // a hidden counter keeps the count
  expect(c.update(14)).toBe(14)
  expect(c.update(12)).toBe(12)
  expect(c.update(15)).toBe(12) // a lone higher read
  expect(c.update(11)).toBe(11)
  expect(c.update(20)).toBe(11)
  expect(c.update(null)).toBe(11) // a missing read breaks the pair
  expect(c.update(20)).toBe(11)
  expect(c.update(5)).toBe(5) // a different value breaks the pair
  expect(c.update(20)).toBe(5)
  expect(c.update(20)).toBe(20) // the same higher read twice: a new run
  expect(c.update(0)).toBe(0)
})

/** The targets of a Consume target pick: the jawed cells among the board
 * read's, with a warning on the eater's cell when the two differ; the board
 * read's when no jaws read or none of them is among its own. */
test('consume targets restrict and warn', () => {
  expect(consumeTargets([3, 7], [], 2)).toEqual([[3, 7], null])
  expect(consumeTargets([7, 3], [3, 7], 2)).toEqual([[7, 3], null])

  let [targets, w] = consumeTargets([3, 7], [3, 4], 2)
  expect(targets).toEqual([3])
  expect(w).toMatchObject({ kind: 'targetsDiffer', cell: 2 })

  ;[targets, w] = consumeTargets([7], [3, 4, 11], 2)
  expect(targets).toEqual([7])
  expect(w).toMatchObject({ kind: 'targetsDiffer', cell: 2 })

  ;[targets, w] = consumeTargets([], [3], 2)
  expect(targets).toEqual([])
  expect(w).toMatchObject({ kind: 'targetsDiffer', cell: 2 })
})

/** Avenger's Casket's meal on a Consume target screen: a jawed cell the
 * board holds as locked takes the eater's rarity and a beast it eats. The
 * player's report consume-target-cell2.png: an Ultimate Rat in 07 bit, the
 * Casket opened 02, and the meal (an Ultimate Mammoth, what a Rat eats)
 * stayed locked. A Mammoth eats Lions and Wolves: the read beast when it is
 * one of them, else a Lion with a warning on the cell. */
test('casket meal on a locked cell', () => {
  const inmate = (beast: 'mammoth' | 'lion' | 'wolf' | 'rat', tier: number): CellModel => ({
    kind: 'inmate',
    beast,
    tier,
    ivory: false,
    prey: null,
    event: null,
  })
  const board = blankModel()
  board.warden = 6
  board.cells[6] = inmate('rat', 4)
  board.cells[2] = inmate('mammoth', 1)
  const read = structuredClone(board)
  read.cells[1] = inmate('wolf', 0)
  read.cells[2] = inmate('lion', 0)

  let m = structuredClone(board)
  expect(casketMeals(m, read, [1, 2])).toEqual([])
  expect(m.cells[1]).toEqual(inmate('mammoth', 4))
  expect(m.cells[2]).toEqual(board.cells[2]) // a jawed inmate stays as the board has it

  board.cells[6] = inmate('mammoth', 3)
  read.cells[1] = inmate('wolf', 0)
  m = structuredClone(board)
  expect(casketMeals(m, read, [1])).toEqual([])
  expect(m.cells[1]).toEqual(inmate('wolf', 3))

  read.cells[1] = inmate('rat', 0)
  m = structuredClone(board)
  const warnings = casketMeals(m, read, [1])
  expect(m.cells[1]).toEqual(inmate('lion', 3))
  expect(warnings.length).toBe(1)
  expect(warnings[0].cell).toBe(1)
  expect(warningText(warnings[0]).startsWith('Check cell 02: a new Inmate from ')).toBe(true)
})

/** The rollouts rank the same on any thread count and in any steps. */
test('rollouts are the same on any thread count', () => {
  const [st, problems] = buildBoard('ratway.json')
  expect(problems).toEqual([])
  const ranked = (threads: number) => {
    const r = new Rollouts(st, 7, TUNED)
    expect(r.runOn(60, threads)).toBe(60)
    return r.ranking()
  }
  const one = ranked(1)
  expect(one.length).toBeGreaterThan(2)
  expect(ranked(4)).toEqual(one)
  // In steps, with a thread count that does not divide the rounds.
  const r = new Rollouts(st, 7, TUNED)
  r.run(25)
  r.runOn(35, 3)
  expect(r.ranking()).toEqual(one)
})

/** A screen that keeps moving a little is rechecked less and less often, and
 * a real change brings the short wait back. */
test('watch backs off rechecks of an animated screen', () => {
  const w = new Watch()
  expect(upTo(SETTLE + 1).filter(() => w.sample(print(200, 0))).length).toBe(1)
  const gaps: number[] = []
  let since = 0
  for (let i = 0; i < 500; i++) {
    since += 1
    // the animation: one bright block that wanders on, a new one each sample
    const p = new Uint8Array(64 * 36).fill(200)
    p[i] = 255
    if (w.sample(p)) {
      gaps.push(since)
      since = 0
    }
  }
  expect(gaps.slice(0, 4)).toEqual([RECHECK, RECHECK * 2, RECHECK * 4, MAX_RECHECK])
  expect(Math.max(...gaps)).toBe(MAX_RECHECK)

  // a change to another screen is read after it settles, and the wait starts over
  expect(upTo(SETTLE + 3).filter(() => w.sample(print(90, 0))).length).toBe(1)
  const again = upTo(RECHECK).map(() => w.sample(print(90, 1))).indexOf(true)
  expect(again).toBeGreaterThanOrEqual(0)
  expect(again).toBeLessThan(RECHECK)
})

/** A glow that breathes by a few blocks, as on the last day's board, is not
 * read again and again; a real change still is. */
test('watch ignores blocks that keep flipping', () => {
  const w = new Watch()
  const frame = (up: boolean): Uint8Array => {
    const p = new Uint8Array(64 * 36).fill(200)
    if (up) p.fill(255, 100, 106)
    return p
  }
  expect(upTo(SETTLE + 1).filter(() => w.sample(frame(false))).length).toBe(1)
  let reads = 0
  for (let i = 0; i < 400; i++) if (w.sample(frame(Math.floor(i / 8) % 2 === 0))) reads += 1
  expect(reads).toBeLessThanOrEqual(2)

  expect(upTo(SETTLE + 3).filter(() => w.sample(print(90, 0))).length).toBe(1)
})

/** A low-confidence cell read warns on the reads that give it until the
 * same read has come twice before the one on show; the count keys on what
 * was read, so a different confidence on the same cell does not start it
 * over (see [`steadyKey`]). */
test('a steady read keys on identity, not the confidence', async () => {
  const s = new Session(20, [], null, null)
  const read = (lockedConf: number): number => {
    s.readSynthetic(syntheticScene(2, { 3: { lockedConf } }), syntheticPanels('manage', 20))
    const r = s.reading as Reading
    return r.warnings.filter((w) => w.kind === 'cellRead' && w.cell === 2 && w.detail === 'lock').length
  }
  expect(read(0.2)).toBe(1)
  expect(read(0.1)).toBe(1) // the same read at another confidence still counts
  expect(read(0.1)).toBe(0) // the third in a row is steady
  await s.wait()
})

/** The run rules, on reads made of synthetic (scene, panels) input: the
 * PNG frames that guard them today (session-frames, session-flow) are
 * git-ignored and missing, so without these the rules have no test. */

/** The warden's cell, screen cell 3, read as a Normal Wolf; every other
 * cell locked and sure. */
const WOLF: Record<number, Partial<CellRead>> = { 3: { locked: false, inmate: { beast: 'wolf', tier: 1 } } }

/** A higher days count read twice is a new run: the first higher read
 * waits for its second, and the second clears the instruments held over
 * the old run. */
test('a higher days count twice is a new run', async () => {
  const s = new Session(20, ['chains'], null, null)
  const read = (days: number) => s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('manage', days))
  read(16)
  expect(s.daysLeft()).toBe(16)
  read(18) // a lone higher count is a misread and waits
  expect(s.daysLeft()).toBe(16)
  read(18) // the same higher count again: a new run
  expect(s.daysLeft()).toBe(18)
  expect(s.tools).toEqual([])
  expect((s.reading as Reading).warnings.some((w) => warningText(w) === 'A new run: the held instruments were cleared.')).toBe(true)
  await s.wait()
})

/** A live read that changes the board is held for one more read: a blip
 * that shows the old board again within a second would otherwise cost the
 * corrections and the running solve. */
test('a live board change is held until the next read confirms it', async () => {
  const s = new Session(20, [], null, null)
  const read = (tier: number, live: boolean) =>
    s.readSynthetic(syntheticScene(3, { 3: { locked: false, inmate: { beast: 'wolf', tier } } }), syntheticPanels('manage', 16), live)
  read(1, true)
  expect((s.reading as Reading).model.cells[2]).toMatchObject({ kind: 'inmate', tier: 1 })
  read(2, true) // the changed board is held, the old one stays on show
  expect((s.reading as Reading).model.cells[2]).toMatchObject({ kind: 'inmate', tier: 1 })
  expect(s.wantsReread()).toBe(true)
  read(2, true) // the next read confirms it
  expect((s.reading as Reading).model.cells[2]).toMatchObject({ kind: 'inmate', tier: 2 })
  expect(s.wantsReread()).toBe(false)
  await s.wait()
})

/** The board fades in after a Consume target screen and its instrument
 * panel reads empty for a frame: such a read is kept once and the next
 * taken, whatever the panel reads. */
test('a Consume target frame that fades in is kept once', async () => {
  const s = new Session(20, ['chains'], null, null)
  const read = (held: 'none' | 'empty') =>
    s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('chainTarget', null, held === 'empty' ? { held: [] } : {}))
  read('none')
  const before = s.reading as Reading
  read('empty')
  expect(s.reading).toBe(before)
  expect(before.keptLines()).toEqual(['The board is still coming in: showing the last reading.'])
  read('empty') // the next read is taken with the panel still empty
  expect((s.reading as Reading).keptLines()).toEqual([])
  await s.wait()
})

/** A game dialog over the board keeps the last reading on show, with a
 * line that says so, until a frame reads again. */
test('a popup keeps the last reading', async () => {
  const s = new Session(20, [], null, null)
  s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('manage', 16))
  const before = s.reading as Reading
  s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('popup', null))
  expect(s.reading).toBe(before)
  expect(before.keptLines()).toEqual(['A popup covers the game: showing the last reading.'])
  s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('manage', 16))
  expect((s.reading as Reading).keptLines()).toEqual([])
  await s.wait()
})

/** The riot screen can be missed: on the run's last day a board read with
 * the counter hidden that differs from the board on show in six cells or
 * more is a screen after the run, and ends it. */
test('a far board on the last day with the counter hidden ends the run', async () => {
  const s = new Session(20, [], null, 0)
  s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('manage', 0))
  const after: Record<number, Partial<CellRead>> = { ...WOLF }
  for (let c = 4; c <= 10; c++) after[c] = { locked: false, inmate: { beast: 'rat', tier: 3 } }
  s.readSynthetic(syntheticScene(3, after), syntheticPanels('patrol', null))
  expect(s.runOver).not.toBe(null)
  expect(s.reading).toBe(null)
  expect(s.daysLeft()).toBe(null)
  await s.wait()
})

/** After the riot, only a run start is taken: the screens players stay on
 * read as junk boards, so a board read between runs is kept waiting. */
test('between runs only a run start is taken', async () => {
  const s = new Session(20, [], null, null)
  s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('manage', 16))
  s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('runEnd', null))
  expect(s.runOver).not.toBe(null)
  s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('manage', 5))
  expect(s.missed).toBe('The run is over: waiting for the next run.')
  expect(s.reading).toBe(null)
  // a pick with the counter hidden is a run start
  s.readSynthetic(syntheticScene(3, WOLF), syntheticPanels('instrumentPick', null))
  expect(s.reading).not.toBe(null)
  await s.wait()
})