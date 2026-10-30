//! The session's reading of a run's flow on saved frames: treasure picks
//! after a consume chain, the blip a live read holds for one more read, the
//! run theme and Opulence's picks, the Hunt, the run log's frames and the
//! frames that wait for a read. Skips when trainingdata/s16 (git-ignored) is
//! missing. A port of the second half of the Rust crate's tests/session.rs.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

import { RunLog } from '@/app/runlog'
import { ROUND, Session, type Reading } from '@/app/session'
import type { PreyMark } from '@/board/board'
import { data, OPULENCE } from '@/engine/data'
import { loadPng, Rgba } from '@/reader/mod'
import { frame, framePath, have, pollUntil, readAll, readNext } from './session-common'

/** A treasure pick after a consume chain that reached Chromatic: the board
 * under it is the last Consume target screen's (earlier bites locked), with
 * the eater gone from the warden's cell to the vault and its cell and its
 * last meal's locked. */
test('a treasure after a chain', async () => {
  const names = ['rec2-t045.png', 'rec2-t051.png', 'rec2-t063.png']
  if (!have(names)) return
  const s = new Session(20, [], null, null)
  const [board, chain, pick] = [await readNext(s, names[0]), await readNext(s, names[1]), await readNext(s, names[2])]
  expect([board.screen, chain.screen, pick.screen]).toEqual(['manage', 'chainTarget', 'treasurePick'])
  // The eater sits in the warden's cell, 02.
  const n = chain.model.warden
  expect(n).toBe(1)
  const eater = chain.model.cells[n]
  if (eater.kind !== 'inmate') throw new Error(JSON.stringify(eater))
  expect(pick.model.cells[n].kind).toBe('sealed')
  // Cell 03, the chain's last meal, locks too.
  expect([chain.model.cells[2].kind, pick.model.cells[2].kind]).toEqual(['inmate', 'sealed'])
  for (let k = 0; k < chain.model.cells.length; k++) {
    if (k === n || k === 2) continue
    expect(pick.model.cells[k]).toEqual(chain.model.cells[k])
  }
  // Cell 10, open on the manage board, was the first bite.
  expect([board.model.cells[9].kind, pick.model.cells[9].kind]).toEqual(['inmate', 'sealed'])
  expect(pick.model.vault).toEqual([...board.model.vault, eater.beast])
  expect([pick.model.day, pick.model.step, pick.model.choice.kind]).toEqual([board.model.day, 'choice', 'gift'])
  expect(pick.model.devourUsed).toBe(true)
  expect(pick.warnings.some((w) => w.text.endsWith('cell 02 left for the vault after consuming cell 03.'))).toBe(true)
  expect(s.problems).toEqual([])
})

/** The last Consume target screen before a treasure pick offers one target
 * (cell 09): the pick's board has that cell locked, as well as the
 * eater's. */
test('a treasure seals the last meal', async () => {
  const s = await readAll([], ['rec3-t113.png', 'rec3-t114.png', 'rec3-t116.png', 'rec3-t117.png'])
  if (s === null) return
  const chain = s.reading as Reading
  expect(chain.screen).toBe('chainTarget')
  expect(chain.model.cells[8].kind).toBe('inmate')
  if (!have(['rec3-t121.png'])) return
  const pick = await readNext(s, 'rec3-t121.png')
  expect(pick.screen).toBe('treasurePick')
  for (const n of [8, 15]) expect(pick.model.cells[n].kind).toBe('sealed')
  const text = "The Warden's Treasure follows a Chromatic Prisoner: the inmate in cell 16 left for the vault after consuming cell 09."
  expect(pick.warnings.some((w) => w.text === text)).toBe(true)
  expect(s.problems).toEqual([])
})

/** The Consume target screen rec3-t117 with the Shackles and the Saw held,
 * then the day 9 patrol board rec3-t161 (`_` for its panel read empty, as
 * while the board fades in): the session and the reading on show. */
async function chainThenBoard(board: string): Promise<[Session, Reading] | null> {
  if (!have([board])) return null
  const s = await readAll([], ['rec3-t113.png', 'rec3-t114.png', 'rec3-t116.png', 'rec3-t117.png'])
  if (s === null) return null
  const chain = s.reading as Reading
  expect(chain.screen).toBe('chainTarget')
  expect(s.tools).toEqual(['longchain', 'saw'])
  s.readInBackground(frame(board))
  await s.wait()
  return [s, chain]
}

/** A board read with an empty instrument panel right after a Consume target
 * screen is kept once; a second such read in a row is taken, the held
 * instruments kept. */
test('a fading board after a chain is kept once', async () => {
  const both = await chainThenBoard('_rec3-t161.png')
  if (both === null) return
  const [s, chain] = both
  const kept = s.reading as Reading
  expect([kept.model, kept.screen, kept.at]).toEqual([chain.model, chain.screen, chain.at])
  expect(kept.keptLines()).toEqual(['The board is still coming in: showing the last reading.'])
  expect(s.tools).toEqual(['longchain', 'saw'])

  s.readInBackground(frame('_rec3-t161.png'))
  await s.wait()
  const r = s.reading as Reading
  expect(r.screen).toBe('patrol')
  expect(r.keptLines()).toEqual([])
  expect(s.tools).toEqual(['longchain', 'saw'])
})

/** A board whose panel reads the held instruments is taken at once after a
 * Consume target screen. */
test('a board after a chain is taken', async () => {
  const both = await chainThenBoard('rec3-t161.png')
  if (both === null) return
  const [s] = both
  const r = s.reading as Reading
  expect(r.screen).toBe('patrol')
  expect(r.keptLines()).toEqual([])
  expect(s.tools).toEqual(['longchain', 'saw'])
})

/** An instrument panel read empty while instruments are held (rec1-t087's
 * panel shows the Coin) is a misread: the held list stays. */
test('an empty panel read keeps the held instruments', async () => {
  const s = await readAll(['coin'], ['_rec1-t087.png'])
  if (s === null) return
  expect((s.reading as Reading).screen).toBe('patrol')
  expect(s.tools).toEqual(['coin'])
})

/** The day-16 manage board rec1-t143 read, and the frame with cell 3's
 * portrait painted over (a board on the same screen and day that reads
 * another model). */
async function blip(): Promise<[Session, Rgba] | null> {
  const s = await readAll([], ['rec1-t143.png'])
  if (s === null) return null
  const img = frame('rec1-t143.png')
  for (let y = 90; y < 190; y++) {
    for (let x = 815; x < 925; x++) img.data.fill(0, (y * img.w + x) * 4, (y * img.w + x) * 4 + 3)
  }
  return [s, img]
}

/** A copy of a frame, as the game would send it again. */
function copyOf(img: Rgba): Rgba {
  return new Rgba(img.w, img.h, img.data.slice())
}

/** An opened screenshot of a changed board is taken at once. */
test('a changed board from a file is taken at once', async () => {
  const both = await blip()
  if (both === null) return
  const [s, changed] = both
  const before = s.reading as Reading
  s.readInBackground(changed)
  await s.wait()
  const r = s.reading as Reading
  expect(r.screen).toBe('manage')
  expect(r.model).not.toEqual(before.model)
  expect(s.wantsReread()).toBe(false)
})

/** A live read of a changed board on the same screen and day is held, with
 * no line on show, and asks for one more read. */
test('a changed board is held for one more read', async () => {
  const both = await blip()
  if (both === null) return
  const [s, changed] = both
  const before = s.reading as Reading
  s.readLive(changed)
  await s.wait()
  const r = s.reading as Reading
  expect([r.model, r.at]).toEqual([before.model, before.at])
  expect(r.keptLines()).toEqual([])
  expect(s.wantsReread()).toBe(true)
  expect(s.wantsReread()).toBe(false)
})

/** A blip (the old board read again after a held read) keeps the reading
 * and the corrections made before it. */
test('a blip keeps the corrections', async () => {
  const both = await blip()
  if (both === null) return
  const [s, changed] = both
  const model = (s.reading as Reading).model
  const n = model.cells.findIndex((c, i) => i !== 2 && (c.kind === 'sealed' || c.kind === 'inmate'))
  expect(n).toBeGreaterThanOrEqual(0)
  s.editCell(n + 1, { kind: 'inmate', beast: 'wolf', tier: 2 })
  const edited = (s.reading as Reading).model
  expect(edited).not.toEqual(model)
  s.readLive(changed)
  await s.wait()
  expect(s.wantsReread()).toBe(true)
  s.readLive(frame('rec1-t143.png'))
  await s.wait()
  expect((s.reading as Reading).model).toEqual(edited)
  expect(s.wantsReread()).toBe(false)
})

/** A changed board read again after it was held is taken. */
test('a confirmed change is taken', async () => {
  const both = await blip()
  if (both === null) return
  const [s, changed] = both
  const direct = (await readAll([], ['rec1-t143.png'])) as Session
  direct.readInBackground(copyOf(changed))
  await direct.wait()
  const want = (direct.reading as Reading).model
  s.readLive(copyOf(changed))
  await s.wait()
  expect(s.wantsReread()).toBe(true)
  s.readLive(changed)
  await s.wait()
  expect((s.reading as Reading).model).toEqual(want)
  expect(s.wantsReread()).toBe(false)
})

/** rec4-t074: a Warden's Treasure pick after the rec4-t070 manage board with
 * no Consume target screen between them, the Ravenous Chains held. The
 * Chromatic is the board's top inmate, the Legendary Wolf in cell 07 (the
 * Chains removed the Mammoth in the warden's cell 08 beside it at the start
 * of a day), not the inmate in the warden's cell. */
test('a treasure after the Ravenous Chains', async () => {
  const s = await readAll(['chains'], ['rec4-t070.png'])
  if (s === null) return
  if (!have(['rec4-t074.png'])) return
  const board = s.reading as Reading
  const pick = await readNext(s, 'rec4-t074.png')
  expect([board.screen, pick.screen]).toEqual(['manage', 'treasurePick'])
  const top = board.model.cells[6]
  expect(top.kind === 'inmate' && top.beast === 'wolf' && top.tier === 4).toBe(true)
  for (const n of [6, 7]) expect(pick.model.cells[n].kind).toBe('sealed')
  expect(pick.model.vault).toEqual([...board.model.vault, 'wolf'])
  const text =
    "The Warden's Treasure follows a Chromatic Prisoner: the inmate in cell 07 left for the vault, lifted by the Ferocious Beast's Ravenous Chains at the start of the day, which removed the inmate in cell 08: check them with View Prison Status."
  expect(pick.warnings.some((w) => w.text === text)).toBe(true)
})

/** A frame sent while a read runs waits for it: the first read is not
 * dropped. */
test('a frame during a read waits for it', async () => {
  const names = ['rec5-t012.png', 'rec5-t018.png']
  if (!have(names)) return
  const s = new Session(20, [], null, null)
  for (const f of names) s.readInBackground(loadPng(framePath(f)))
  await pollUntil(s, (x) => x.poll())
  expect((s.reading as Reading).screen).toBe('treasurePick')
  expect(s.scanning()).toBe(true)
  await pollUntil(s, (x) => {
    x.poll()
    return !x.scanning()
  })
  // View Prison Status over the pick keeps the pick on show, on its board.
  const r = s.reading as Reading
  const status = ((await readAll([], names.slice(1))) as Session).reading as Reading
  expect([status.screen, r.screen]).toEqual(['prisonStatus', 'treasurePick'])
  expect(r.model.cells).toEqual(status.model.cells)
})

/** The run log: a line per reading, and a frame only when the screen or
 * board differs from the last frame saved. */
test('the run log saves a frame per board', async () => {
  const names = ['rec1-t087.png', 'rec1-t031.png', 'rec1-t031.png']
  if (!have(names)) return
  const root = mkdtempSync(join(tmpdir(), 'warden-run-log-'))
  const s = new Session(ROUND, [], null, null)
  s.log = new RunLog(root)
  for (const f of names) {
    s.readInBackground(loadPng(framePath(f)))
    await s.wait()
  }
  const run = s.log.dir()
  const text = readFileSync(join(run, 'log.jsonl'), 'utf8')
  const lines = text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
  const reads = lines.filter((l) => l.kind === 'read')
  expect(reads.length).toBe(3)
  expect(reads[0].screen).toBe('Patrol')
  expect(reads[1].screen).toBe('InstrumentPick')
  expect(reads[0].frame).toBe('frame-0001.png')
  expect(reads[1].frame).toBe('frame-0002.png')
  expect(reads[2].frame).toBe(null)
  expect(Array.isArray(reads[0].model.cells) && typeof reads[0].at === 'string').toBe(true)
  expect(lines.some((l) => l.kind === 'advice' && typeof l.pick === 'string')).toBe(true)
  expect(readdirSync(run).filter((f) => f.endsWith('.png')).length).toBe(2)
  rmSync(root, { recursive: true })
})

/** The lobby's run theme scroll (rec6-t003, Opulence) sets the theme and
 * keeps the last board on show; the riot screen clears it. */
test('the theme scroll sets the theme', async () => {
  if (!have(['rec6-t181.png', 'rec6-t003.png', 'rec4-t422.png'])) return
  const s = new Session(20, [], null, null)
  const board = await readNext(s, 'rec6-t181.png')
  const r = await readNext(s, 'rec6-t003.png')
  expect(s.theme).toBe(OPULENCE)
  expect(s.takeToolsChanged()).toBe(true)
  expect([board.screen, r.screen]).toEqual(['manage', 'manage'])
  expect(r.model).toEqual(board.model)
  expect(r.warnings.some((w) => w.text.startsWith("The run's theme: "))).toBe(true)
  s.readInBackground(loadPng(framePath('rec4-t422.png')))
  await s.wait()
  expect(s.runOver).not.toBe(null)
  expect(s.theme).toBe(null)
})

/** An Opulence treasure in rec6 (day 13): the manage board, the pick, View
 * Prison Status over it, then the board shown after each pick before the
 * next pick screen. */
const OPULENCE_FLOW = [
  'rec6-t181.png',
  'rec6-t191.png',
  'rec6-t206.png',
  'rec6-t225.png',
  'rec6-t227.png',
  'rec6-t230.png',
  'rec6-t231.png',
  'rec6-t236.png',
]

/** The gifts offered and the picks left on the treasure pick being solved. */
function treasurePick(s: Session): [number, number] | null {
  const pick = s.treasurePick()
  return pick === null ? null : [pick[0].length, pick[1]]
}

test('Opulence counts the picks of a treasure', async () => {
  if (!have(OPULENCE_FLOW)) return
  const s = new Session(20, [], OPULENCE, null)
  expect((await readNext(s, 'rec6-t181.png')).screen).toBe('manage')
  expect((await readNext(s, 'rec6-t191.png')).screen).toBe('treasurePick')
  expect(treasurePick(s)).toEqual([4, 3])
  expect((await readNext(s, 'rec6-t206.png')).screen).toBe('treasurePick')
  expect(treasurePick(s)).toEqual([4, 3])
  // The board after the first pick stays under the pick on show.
  const r = await readNext(s, 'rec6-t225.png')
  const after = ((await readAll([], ['rec6-t225.png'])) as Session).reading as Reading
  expect([r.screen, after.screen]).toEqual(['treasurePick', 'unknown'])
  expect(r.model.cells).toEqual(after.model.cells)
  expect((await readNext(s, 'rec6-t227.png')).screen).toBe('treasurePick')
  expect(treasurePick(s)).toEqual([4, 2])
  expect((await readNext(s, 'rec6-t230.png')).screen).toBe('treasurePick')
  expect((await readNext(s, 'rec6-t231.png')).screen).toBe('treasurePick')
  expect(treasurePick(s)).toEqual([4, 1])
  // No pick left: the board after the last one is installed as read.
  expect((await readNext(s, 'rec6-t236.png')).screen).toBe('unknown')
  expect(treasurePick(s)).toBe(null)
})

/** Without a theme a treasure gives one pick: the board after it is
 * installed as read. */
test('a treasure without a theme has one pick', async () => {
  const s = await readAll([], OPULENCE_FLOW.slice(0, 2))
  if (s === null) return
  expect((s.reading as Reading).screen).toBe('treasurePick')
  expect(treasurePick(s)).toEqual([4, 1])
  expect((await readNext(s, 'rec6-t225.png')).screen).toBe('unknown')
  expect(treasurePick(s)).toBe(null)
})

test('a second treasure pick covers the board after the first', async () => {
  // A Chromatic after the first pick's effect gives another treasure pick
  // at once: it is solved on the board read after the first pick.
  if (!have(OPULENCE_FLOW)) return
  const s = await readAll([], OPULENCE_FLOW.slice(0, 2))
  if (s === null) return
  expect((await readNext(s, 'rec6-t225.png')).screen).toBe('unknown')
  const r = await readNext(s, 'rec6-t191.png')
  expect(r.screen).toBe('treasurePick')
  const after = ((await readAll([], ['rec6-t225.png'])) as Session).reading as Reading
  expect(r.model.cells).toEqual(after.model.cells)
})

/** A Prey mark loses a round each day after it is first read: the crosshair
 * on cell 4 of the Trap run reads 3 rounds on day 3 (hunt-run-0008) and 2
 * on day 4 (hunt-run-0012). Day 3 read twice after it is a new run's, at 3
 * again (a lone higher days counter is taken as a misread). Skips when a
 * frame is missing. */
test('a Prey mark counts its rounds down', async () => {
  const names = ['hunt-run-0008.png', 'hunt-run-0012.png', 'hunt-run-0008.png', 'hunt-run-0008.png']
  if (!have(names)) return
  const s = new Session(20, [], null, null)
  const expected: [number, number][] = [[3, 3], [4, 2], [4, 2], [3, 3]]
  for (const [k, f] of names.entries()) {
    s.readInBackground(loadPng(framePath(f)))
    await s.wait()
    const model = (s.reading as Reading).model
    const marks: PreyMark[] = []
    for (const c of model.cells) if (c.kind === 'inmate' && c.prey !== null) marks.push({ ...c.prey })
    const [day, rounds] = expected[k]
    expect([model.day, marks]).toEqual([day, [{ cell: 3, rounds }]])
  }
})

/** The Hunt's target pick (hunt-run-0006) shows no cards: it keeps the day's
 * used Consume from the manage screen before it (hunt-run-0005), and its
 * cells, since the white glow on the lone target, the Normal Wolf in cell 4,
 * spoils that cell's read. The pick marks that Wolf. Skips when a frame is
 * missing. */
test('a Hunt pick keeps the manage read', async () => {
  if (!have(['hunt-run-0005.png', 'hunt-run-0006.png'])) return
  const s = new Session(20, [], null, null)
  s.readInBackground(loadPng(framePath('hunt-run-0005.png')))
  await s.wait()
  const before = (s.reading as Reading).model
  expect([before.step, before.devourUsed, before.swapUsed]).toEqual(['manage', false, false])
  s.readInBackground(loadPng(framePath('hunt-run-0006.png')))
  await s.wait()
  const r = s.reading as Reading
  expect([r.screen, r.model.step, r.model.choice.kind]).toEqual(['cellPick', 'choice', 'prey'])
  expect([r.model.devourUsed, r.model.swapUsed, r.model.huntUsed]).toEqual([false, false, false])
  expect(r.model.cells).toEqual(before.cells)
  expect(s.problems).toEqual([])
  const label = s.pick?.label ?? ''
  expect(label.startsWith(`${data().huntName}: mark`) && label.includes(' in 04 ')).toBe(true)
})
