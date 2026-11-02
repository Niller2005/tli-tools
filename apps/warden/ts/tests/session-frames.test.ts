//! The app session on saved frames: the reading matches `readModel`, the
//! solve run in rounds matches one `solve` call, cell edits and held
//! instruments change the model and re-solve, and the screens around the
//! board (picks, popups, loading and riot screens) keep or end the reading.
//! Skips when trainingdata/s16 (git-ignored) is missing.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

import { ROUND, Session, type Reading } from '@/app/session'
import { RunLog } from '@/app/runlog'
import { buildState, cellEvent, type CellModel } from '@/board/board'
import { TOOLS } from '@/engine/data'
import { devourOptions, startOptions } from '@/engine/devour'
import { language } from '@/reader/ocr'
import { loadPng, readModel, warningText } from '@/reader/mod'
import { Rollouts, solve } from '@/solver/solve'
import { TUNED } from '@/solver/mod'
import { black, frame, framePath, have, pollUntil, readAll, readNext, ROLLOUTS } from './session-common'

/** The index of the first cell of `kind`. */
function firstOf(cells: CellModel[], kind: CellModel['kind']): number {
  return cells.findIndex((c) => c.kind === kind)
}

test('the session on t087', async () => {
  if (!have(['rec1-t087.png'])) return
  const path = framePath('rec1-t087.png')
  // The session starts with the list the instrument panel shows: its read adds no line.
  const s = new Session(ROLLOUTS, ['coin'], null, null)
  s.readInBackground(loadPng(path))
  await s.wait()
  const [model, warnings] = await readModel(path, [])
  const reading = s.reading as Reading
  expect(reading.model).toEqual(model)
  expect(reading.warnings).toEqual(warnings)
  expect(s.problems).toEqual([])
  expect(s.pick).not.toBe(null)

  // The worker's rounds add up to one solve call with the same rollouts.
  await s.wait()
  expect(s.rounds).toBe(ROLLOUTS)
  const [st] = buildState(model, 1)
  const whole = solve(st, ROLLOUTS, 1, TUNED)
  expect(whole.length).toBeGreaterThan(1)
  expect(s.ranking).toEqual(whole)

  // A partial ranking ranks the rounds so far.
  const r = new Rollouts(st, 1, TUNED)
  r.run(ROUND)
  expect(r.ranking().every((o) => o.n <= ROUND)).toBe(true)
  expect(r.ranking()).toEqual(solve(st, ROUND, 1, TUNED))

  // Edit a locked door into a Wolf.
  const n = firstOf(model.cells, 'sealed')
  expect(n).toBeGreaterThanOrEqual(0)
  s.editCell(n + 1, { kind: 'inmate', beast: 'wolf', tier: 2 })
  const edited = (s.reading as Reading).model
  expect(edited.cells[n]).toEqual({ kind: 'inmate', beast: 'wolf', tier: 2, ivory: false, prey: null, event: cellEvent(model.cells[n]) })
  expect(edited).not.toEqual(model)
  await s.wait()
  expect(s.problems).toEqual([])
  expect(s.ranking.length).toBeGreaterThan(0)
  expect(() => s.editCell(1, { kind: 'empty' })).toThrow() // the Interrogation Room is not a cell to edit

  // Held instruments go into the built state; the edit stays.
  const held = [TOOLS[0]]
  s.setTools(held)
  const withTools = (s.reading as Reading).model
  expect(withTools.tools).toEqual(held)
  expect(withTools.cells[n]).toEqual(edited.cells[n])
  expect(buildState(withTools, 1)[0].tools).not.toEqual(buildState(edited, 1)[0].tools)
  await s.wait()
  expect(s.ranking.length).toBeGreaterThan(0)

  // A read of the same scene keeps the edit and the solve: no restart.
  const at = reading.at
  expect((s.reading as Reading).at).toEqual(at) // corrections keep the read time
  s.setTools(model.tools)
  await s.wait()
  const [kept, rounds] = [s.ranking, s.rounds]
  s.readInBackground(loadPng(path))
  await pollUntil(s, (x) => {
    x.poll()
    return !x.scanning()
  })
  expect(s.solving).toBe(false)
  expect([s.rounds, s.ranking]).toEqual([rounds, kept])
  const same = s.reading as Reading
  expect(same.model).toEqual(edited)
  expect(same.warnings).toEqual(warnings)
  expect(same.at.getTime()).toBeGreaterThan(at.getTime())

  // Another frame drops the edit and restarts the solve.
  s.readInBackground(loadPng(framePath('rec1-t031.png')))
  await s.wait()
  expect((s.reading as Reading).model).not.toEqual(edited)
  expect(s.ranking).not.toEqual(kept)

  // Back on the board: the reading without the edit, solved again.
  s.readInBackground(loadPng(path))
  expect(s.scanning()).toBe(true)
  await s.wait()
  expect(s.scanning()).toBe(false)
  // The panel's list stands over the pick's advised instrument; setting it
  // drops the panel's line, and the board is as before.
  expect(s.tools).toEqual(model.tools)
  s.setTools(model.tools)
  await s.wait()
  const again = s.reading as Reading
  expect(again.model).toEqual(model)
  expect(again.warnings).toEqual(warnings)
  expect([again.screen, again.daysLeft]).toEqual([reading.screen, reading.daysLeft])
  expect(again.at.getTime()).toBeGreaterThan(same.at.getTime())
  expect(s.rounds).toBe(ROLLOUTS)
  expect(s.ranking).toEqual(whole)
})

/** The player adds a missed incident marker, keeps it through a kind
 * correction and takes it off again. */
test('marker correction', async () => {
  if (!have(['rec1-t087.png'])) return
  const s = new Session(20, [], null, null)
  s.readInBackground(loadPng(framePath('rec1-t087.png')))
  await s.wait()
  const model = (s.reading as Reading).model
  const n = model.cells.findIndex((c) => c.kind === 'sealed' && c.event === null)
  expect(n).toBeGreaterThanOrEqual(0)
  const cell = () => (s.reading as Reading).model.cells[n]
  s.setMarker(n + 1, true)
  expect(cell()).toEqual({ kind: 'sealed', event: 'unknown' })
  s.editCell(n + 1, { kind: 'empty' })
  expect(cell()).toEqual({ kind: 'empty', event: 'unknown' })
  s.editCell(n + 1, { kind: 'locked' })
  expect(cell()).toEqual({ kind: 'sealed', event: 'unknown' })
  s.setMarker(n + 1, false)
  expect(cell()).toEqual({ kind: 'sealed', event: null })
  expect(() => s.setMarker(1, true)).toThrow() // the Interrogation Room takes no marker
})

/** A live frame of another 16:9 size reads as the reference size does; a
 * window narrower than 16:9 is not read and says why, then keeps the
 * reading on show with the same line. */
test('the frame size is scaled or refused', async () => {
  const reference = await readAll([], ['rec1-t087.png'])
  if (reference === null) return
  const img = loadPng(framePath('rec1-t087.png'))
  const s = new Session(20, [], null, null)
  const read = async (w: number, h: number) => {
    s.readInBackground(img.resize(w, h))
    await s.wait()
  }
  await read(1440, 1080)
  const line = 'The game window is 1440 x 1080, narrower than 16:9'
  expect(s.reading).toBe(null)
  expect(s.missed?.startsWith(line)).toBe(true)

  await read(2560, 1440)
  const wide = s.reading as Reading
  expect(wide.model.cells).toEqual((reference.reading as Reading).model.cells)
  expect(wide.warnings.every((w) => !(w.kind === 'kept' && w.keep === 'shape'))).toBe(true)
  expect(wide.keptLines()).toEqual([])

  await read(1440, 1080)
  const kept = s.reading as Reading
  expect(kept.model.cells).toEqual(wide.model.cells)
  expect(kept.warnings[0]).toMatchObject({ kind: 'kept', keep: 'shape' })
  const lines = kept.keptLines()
  expect(lines.length === 1 && lines[0].startsWith(line) && lines[0].endsWith('that is not maximized.')).toBe(true)

  // A frame that reads again drops the line.
  await read(1920, 1080)
  expect((s.reading as Reading).keptLines()).toEqual([])
})

/** An instrument pick covers the board: its cells come from the last board
 * read, corrections included, and never from the card art. */
test('a pick keeps the board under it', async () => {
  if (!have(['rec1-t087.png', 'rec1-t031.png'])) return
  const [board, pick] = [framePath('rec1-t087.png'), framePath('rec1-t031.png')]
  // Without a board read first: the run start, every cell locked.
  const [alone] = await readModel(pick, [])
  expect(alone.cells.slice(1).every((c) => c.kind === 'sealed')).toBe(true)

  const s = new Session(20, [], null, null)
  s.readInBackground(loadPng(board))
  await s.wait()
  const n = firstOf((s.reading as Reading).model.cells, 'sealed')
  s.editCell(n + 1, { kind: 'inmate', beast: 'wolf', tier: 2 })
  const under = (s.reading as Reading).model

  s.readInBackground(loadPng(pick))
  await s.wait()
  const r = s.reading as Reading
  expect(r.model.cells).toEqual(under.cells)
  expect([r.model.warden, r.model.day]).toEqual([under.warden, under.day])
  expect(r.model.choice.options.length).toBe(3)
  expect(r.warnings.every((w) => w.cell === null)).toBe(true)
  expect(s.problems).toEqual([])
})

/** A Consume target pick hides the days counter and does not replace the
 * board; the treasure pick after it keeps the day of the last board read
 * and covers the board as the chain left it. */
test('a hidden counter keeps the day', async () => {
  const names = ['rec1-t071.png', 'rec1-t073.png', 'rec1-t085.png']
  if (!have(names)) return
  const s = new Session(20, [], null, null)
  const read = async (f: string) => readNext(s, f)
  const board = await read(names[0])
  expect([board.screen, board.daysLeft]).toEqual(['manage', 16])
  for (const f of names.slice(1)) {
    const r = await read(f)
    expect([r.daysLeft, r.model.day]).toEqual([16, board.model.day])
    // The Consume target screen always hides the counter, so only the
    // treasure pick says so.
    const kept = r.warnings.some((w) => warningText(w).includes('16 day(s) until Riot kept from the last read'))
    expect(kept).toBe(r.screen !== 'chainTarget')
    expect(r.warnings.every((w) => !warningText(w).includes('day 1 assumed'))).toBe(true)
  }
  const pick = s.reading as Reading
  expect(pick.screen).toBe('treasurePick')
  // The chain emptied the eater's cell 05 (Chromatic) and cell 15 (bitten,
  // fading on the Consume target screen): both lock again.
  const cells = [...board.model.cells]
  const eater = cells[4]
  if (eater.kind !== 'inmate') throw new Error(JSON.stringify(eater))
  cells[4] = { kind: 'sealed', event: null }
  cells[14] = { kind: 'sealed', event: null }
  expect(pick.model.cells).toEqual(cells)
  expect(pick.model.vault).toEqual([...board.model.vault, eater.beast])
})

/** A pick read before any board is the run start's, its hidden counter too:
 * a stale count saved at 0 days left gives way to day 1, and the board read
 * after it is the same run. */
test('a hidden counter on the run start pick is day one', async () => {
  const names = ['rec1-t031.png', 'rec1-t071.png']
  if (!have(names)) return
  const s = new Session(20, ['chains'], null, 0)
  const pick = await readNext(s, names[0])
  expect(pick.screen).toBe('instrumentPick')
  expect([pick.daysLeft, pick.model.day]).toEqual([20, 1])
  expect(pick.warnings.every((w) => !warningText(w).includes('kept from the last read'))).toBe(true)
  // The count 0 kept from the settings was the last run's: its Chains go.
  expect(pick.warnings.some((w) => warningText(w) === 'A new run: the held instruments were cleared.')).toBe(true)
  for (let k = 0; k < 2; k++) {
    const board = await readNext(s, names[1])
    expect([board.screen, board.daysLeft]).toEqual(['manage', 16])
    expect(board.warnings.every((w) => !warningText(w).startsWith('A new run'))).toBe(true)
  }
})

/** View Prison Status over a treasure pick (rec5-t018) shows the real board:
 * the pick stays on show, solved on that board in place of the inferred one
 * (rec5-t012), and the pick shown again (rec5-t028) keeps it. */
test('Prison Status gives the board under the pick', async () => {
  const tools = ['muzzle', 'saw'] as const
  const status = await readAll([...tools], ['rec5-t018.png'])
  if (status === null) return
  const shown = status.reading as Reading
  expect(shown.screen).toBe('prisonStatus')
  const s = await readAll([...tools], ['rec5-t012.png'])
  if (s === null) return
  expect((s.reading as Reading).screen).toBe('treasurePick')
  for (const f of ['rec5-t018.png', 'rec5-t028.png']) {
    const r = await readNext(s, f)
    expect(r.screen).toBe('treasurePick')
    expect(r.model.cells).toEqual(shown.model.cells)
    expect(r.model.vault).toEqual(shown.model.vault)
    const patrol = (w: string) => w.includes("Mark today's doors") || w.includes('No destination cards')
    expect(r.warnings.every((w) => !patrol(warningText(w)))).toBe(true)
    expect(s.problems.every((p) => !patrol(p))).toBe(true)
    expect(r.model.choice.kind).toBe('gift')
    expect(s.advice()?.action.type).toBe('choose')
  }
})

/** A Consume target screen right after the manage screen picks the day's
 * first bite among today's targets; once the screen shows a bite (the eater
 * grew, its meal's cell locked), it picks the chain's next meal. */
test('a Consume target picks a bite', async () => {
  const names = ['rec3-t113.png', 'rec3-t114.png', 'rec3-t116.png']
  const s = await readAll([], names.slice(0, 2))
  if (s === null) return
  let r = s.reading as Reading
  expect(r.screen).toBe('chainTarget')
  expect(r.warnings.every((w) => !warningText(w).includes("can't be solved"))).toBe(true)
  let st = buildState(r.model, 1)[0]
  const targets = startOptions(st).map((o) => o.cell)
  expect(targets.length).toBeGreaterThan(0)
  let advice = s.advice()
  expect(advice?.action.type === 'devour' && targets.includes(advice.action.to)).toBe(true)
  expect(advice?.label.startsWith('Consume the ')).toBe(true)
  expect(s.ranking.length).toBeGreaterThan(0)
  expect(s.ranking.every((o) => o.action.type === 'devour')).toBe(true)

  s.readInBackground(loadPng(framePath(names[2])))
  await s.wait()
  r = s.reading as Reading
  expect(r.screen).toBe('chainTarget')
  st = buildState(r.model, 1)[0]
  const options = devourOptions(st, st.position).map((o) => o.cell)
  advice = s.advice()
  const action = advice?.action
  if (action?.type === 'chain') expect(options).toContain(action.to)
  else expect(action?.type).toBe('endChain')
  expect(s.ranking.every((o) => o.action.type === 'chain' || o.action.type === 'endChain')).toBe(true)
})

/** The game opens a chain's Consume target screen only while the eater has a
 * target, so a board that gives it none (an eater read before its rarity
 * rose, a misread target) is a misread: no advice, never a Replace or End
 * the day, and a problem naming the eater's cell. */
test('a Consume target with no target read gets no advice', async () => {
  const s = await readAll([], ['rec3-t113.png', 'rec3-t114.png', 'rec3-t116.png'])
  if (s === null) return
  // A Normal Rat on the eater's cell: no Mammoth on the board to eat.
  s.editCell(16, { kind: 'inmate', beast: 'rat', tier: 0 })
  await s.wait()
  const r = s.reading as Reading
  expect(r.screen).toBe('chainTarget')
  const st = buildState(r.model, 1)[0]
  expect(devourOptions(st, st.position)).toEqual([]) // the edited eater has no target
  expect(s.advice()).toBe(null)
  expect(s.ranking).toEqual([])
  expect(s.problems.some((p) => p.includes('eater in cell 16'))).toBe(true)
})

/** The red jaws over the targets of the Consume target screen rec4-t110
 * spoil the read of cell 03: read alone it warns. After the board rec4-t070
 * of the day before, where 03 is locked, it gives no warning: a jawed cell
 * the board holds locked is the meal Avenger's Casket let in, here a Magic
 * Rat for the Magic Lion on 10, as the screen shows. The hidden days
 * counter, which this screen always hides, gives no line either. */
test('a Consume target keeps unsure cells', async () => {
  const alone = await readAll([], ['rec4-t110.png'])
  if (alone === null) return
  let r = alone.reading as Reading
  expect(r.screen).toBe('chainTarget')
  expect(r.warnings.some((w) => w.kind === 'cellRead' && w.cell === 2)).toBe(true)

  const s = await readAll([], ['rec4-t070.png', 'rec4-t110.png'])
  if (s === null) return
  r = s.reading as Reading
  expect(r.screen).toBe('chainTarget')
  expect(r.warnings.every((w) => w.kind !== 'cellRead' && !warningText(w).includes('days counter'))).toBe(true)
  expect(r.model.cells[2]).toEqual({ kind: 'inmate', beast: 'rat', tier: 1, ivory: false, prey: null, event: null })
})

/** The player's Consume target pick trainingdata/reports/chain-target.png
 * (outside s16): the eater on cell 03 has the big jaws on 04, 05, 12 and 13.
 * The advice bites one of those or bites nothing, never the Magic Lion on
 * 08; when the board read allows other targets, a warning on the eater's
 * cell names both sets. Skips when the frame is missing. */
test('a Consume target follows the jaws', async () => {
  const path = new URL('../../trainingdata/reports/chain-target.png', import.meta.url).pathname
  if (!existsSync(path)) {
    console.log(`skipped: ${path} is missing`)
    return
  }
  const s = new Session(20, [], null, null)
  s.readInBackground(loadPng(path))
  await s.wait()
  const r = s.reading as Reading
  expect(r.screen).toBe('chainTarget')
  const jawed = [3, 4, 11, 12]
  const action = s.advice()?.action
  if (action !== undefined) {
    if (action.type === 'devour' || action.type === 'chain') expect(jawed).toContain(action.to)
    else expect(['endChain', 'end']).toContain(action.type)
  }
  const st = buildState(r.model, 1)[0]
  const options = startOptions(st).map((o) => o.cell).sort((a, b) => a - b)
  if (JSON.stringify(options) !== JSON.stringify(jawed)) {
    const w = r.warnings.find((x) => x.kind === 'targetsDiffer')
    expect(w?.cell).toBe(2)
  }
})

/** The manage board rec1-t143 (day 16) has 2 Chromatic Prisoners. The same
 * frame with the vault panel blacked out, as when its slots do not read,
 * keeps them: Chromatics never leave the vault in a run. */
test('an unread vault keeps the board vault', async () => {
  const s = await readAll([], ['rec1-t143.png'])
  if (s === null) return
  const vault = (s.reading as Reading).model.vault
  expect(vault.length).toBe(2)
  const img = frame('rec1-t143.png')
  for (let y = 180; y < 680; y++) {
    for (let x = 1660; x < 1870; x++) img.data.fill(0, (y * img.w + x) * 4, (y * img.w + x) * 4 + 3)
  }
  s.readInBackground(img)
  await s.wait()
  const r = s.reading as Reading
  expect(r.screen).toBe('manage')
  expect(r.model.vault).toEqual(vault)
})

/** A treasure pick (rec5-t012) over the day-16 board rec1-t143 has its 2
 * Chromatic Prisoners and the eater gone to the vault. View Prison Status
 * over it (rec5-t018, day 16) shows an empty vault panel, as when the panel
 * does not read; the pick it stays on and the pick shown again (rec5-t028)
 * keep the run's 3, and so does the riot screen's line. */
test('a pick over an unread vault keeps the run vault', async () => {
  if (!have(['rec5-t018.png', 'rec5-t028.png', 'rec4-t422.png'])) return
  const s = await readAll([], ['rec1-t143.png', 'rec5-t012.png'])
  if (s === null) return
  const vault = (s.reading as Reading).model.vault
  expect(vault.length).toBe(3)
  for (const f of ['rec5-t018.png', 'rec5-t028.png']) {
    s.readInBackground(frame(f))
    await s.wait()
    const r = s.reading as Reading
    expect([r.screen, r.model.day]).toEqual(['treasurePick', 16])
    expect(r.model.vault).toEqual(vault)
  }
  s.readInBackground(frame('rec4-t422.png'))
  await s.wait()
  expect(s.runOver).toBe('The run is over: 3 Chromatic Prisoners vaulted.')
})

/** A loading screen (rec4-t424) after a board keeps the board's reading and
 * solve with a line that says so; the riot screen (rec4-t422) then ends the
 * run: no reading, no advice, no held instruments, one line. */
test('an off-board frame, then the run end', async () => {
  const s = await readAll(['saw'], ['rec4-t070.png'])
  if (s === null) return
  if (!have(['rec4-t424.png', 'rec4-t422.png'])) return
  const before = s.reading as Reading
  expect(before.screen).toBe('manage')
  const ranking = s.ranking
  s.readInBackground(loadPng(framePath('rec4-t424.png')))
  await s.wait()
  const after = s.reading as Reading
  expect([after.model, after.screen, after.at]).toEqual([before.model, before.screen, before.at])
  expect(warningText(after.warnings[0])).toBe('The prison board is not on screen: showing the last reading.')
  expect(after.warnings.slice(1)).toEqual(before.warnings)
  expect(s.ranking).toEqual(ranking)

  s.readInBackground(loadPng(framePath('rec4-t422.png')))
  await s.wait()
  const vaulted = before.model.vault.length
  const line = vaulted === 1 ? 'The run is over: 1 Chromatic Prisoner vaulted.' : `The run is over: ${vaulted} Chromatic Prisoners vaulted.`
  expect(s.runOver).toBe(line)
  expect(s.reading).toBe(null)
  expect(s.pick === null && s.ranking.length === 0 && s.problems.length === 0 && !s.solving).toBe(true)
  expect(s.advice()).toBe(null)
  expect(() => s.editCell(2, { kind: 'empty' })).toThrow()
  expect(s.tools).toEqual([])
  expect(s.takeToolsChanged()).toBe(true)
  expect(s.daysLeft()).toBe(null)

  // A mid-run board between runs is a screen after the run: kept.
  s.readInBackground(loadPng(framePath('rec4-t070.png')))
  await s.wait()
  expect(s.runOver).toBe(line)
  expect(s.reading).toBe(null)
  expect(s.missed).toBe('The run is over: waiting for the next run.')

  // A board with 20 days left (rec1-t029) starts the next run.
  if (!have(['rec1-t029.png'])) return
  s.readInBackground(loadPng(framePath('rec1-t029.png')))
  await s.wait()
  expect(s.runOver).toBe(null)
  expect((s.reading as Reading).daysLeft).toBe(20)
})

/** The riot screen after the last day (rec4-t412, day 20) logs one run_end
 * and starts the next run's folder; a day-1 board read after it (rec1-t055)
 * and the riot screen again show the line but log no second run_end and
 * start no folder. */
test('the run end logs once', async () => {
  if (!have(['rec4-t412.png', 'rec4-t422.png', 'rec1-t055.png'])) return
  const root = mkdtempSync(join(tmpdir(), 'warden-run-end-once-'))
  const s = new Session(20, [], null, null)
  s.log = new RunLog(root)
  const last = await readNext(s, 'rec4-t412.png')
  expect([last.model.day, last.model.maxDays]).toEqual([20, 20])
  const first = s.log.dir()
  s.readInBackground(frame('rec4-t422.png'))
  await s.wait()
  expect(s.runOver).not.toBe(null)
  const next = s.log.dir()
  expect(next).not.toBe(first)

  const day1 = await readNext(s, 'rec1-t055.png')
  expect(day1.model.day).toBe(1)
  s.readInBackground(frame('rec4-t422.png'))
  await s.wait()
  expect(s.runOver).toBe('The run is over: 0 Chromatic Prisoners vaulted.')
  expect(s.reading).toBe(null)
  expect(s.log.dir()).toBe(next)
  await s.log.wait()

  const runEnds = (dir: string): unknown[] => {
    const path = join(dir, 'log.jsonl')
    const text = existsSync(path) ? readFileSync(path, 'utf8') : ''
    return text
      .split('\n')
      .filter((l) => l !== '')
      .map((l) => JSON.parse(l))
      .filter((l) => l.kind === 'run_end')
      .map((l) => l.vaulted)
  }
  expect(runEnds(first)).toEqual([last.model.vault.length])
  expect(runEnds(next)).toEqual([])
  rmSync(root, { recursive: true })
})

/** The riot screen missed: on the last day (rec4-t412, 0 days left), a
 * board with the counter hidden and far from the board on show (rec1-t073,
 * another run's Consume target screen) is a screen after the run: it ends
 * the run and is not installed. */
test('a far board on the last day ends the run', async () => {
  if (!have(['rec4-t412.png', 'rec1-t073.png'])) return
  const s = new Session(20, [], null, null)
  const last = await readNext(s, 'rec4-t412.png')
  expect(last.daysLeft).toBe(0)
  s.readInBackground(frame('rec1-t073.png'))
  await s.wait()
  expect(s.runOver).not.toBe(null)
  expect(s.reading).toBe(null)
})

/** A game dialog keeps the last reading and its solve on show. */
test('a popup keeps the last reading', async () => {
  if (!have(['rec1-t087.png', 'rec2-t109.png'])) return
  const s = new Session(20, [], null, null)
  s.readInBackground(loadPng(framePath('rec1-t087.png')))
  await s.wait()
  const before = s.reading as Reading
  const ranking = s.ranking
  s.readInBackground(loadPng(framePath('rec2-t109.png')))
  await s.wait()
  const after = s.reading as Reading
  expect([after.model, after.screen, after.at]).toEqual([before.model, before.screen, before.at])
  expect(warningText(after.warnings[0])).toBe('A popup covers the game: showing the last reading.')
  expect(after.warnings[0].kind).toBe('kept')
  expect(after.warnings.slice(1)).toEqual(before.warnings)
  expect(after.keptLines()).toEqual(['A popup covers the game: showing the last reading.'])
  expect(before.keptLines()).toEqual([])
  expect(s.ranking).toEqual(ranking)
})

/** A live read of a patrol marks the advised door's card once the solve
 * ends: three 330 x 170 cards centred 345 apart in y 750-920. A popup read
 * after it hides the mark; the same board from an opened file gives none. */
test('a mark on the advised door', async () => {
  if (!have(['rec1-t087.png', 'rec2-t109.png'])) return
  const [board, popup] = [framePath('rec1-t087.png'), framePath('rec2-t109.png')]
  let s = new Session(20, [], null, null)
  s.readLive(loadPng(board))
  await s.wait()
  const r = s.reading as Reading
  expect(r.screen).toBe('patrol')
  const action = s.advice()?.action
  if (action?.type !== 'patrol') throw new Error('not a patrol move')
  const card = r.model.dest.indexOf(action.cell)
  expect(card).toBeGreaterThanOrEqual(0)
  const [x, y, halfW, halfH] = s.mark() ?? [NaN, NaN, NaN, NaN]
  const centre = 615 + 345 * card
  expect(x >= centre - 165 && x < centre + 165 && y >= 750 && y < 920).toBe(true)
  expect(halfW >= 150 && halfW < 180 && halfH >= 75 && halfH < 95).toBe(true)
  // on the screen: the box moves with the area the frame was taken from and scales with it
  const frame = loadPng(board)
  const on = s.markOn({ x: 100, y: 50, width: frame.w * 2, height: frame.h * 2 })
  expect(on).toEqual({ x: 100 + 2 * (x - halfW), y: 50 + 2 * (y - halfH), width: 4 * halfW, height: 4 * halfH })
  s.readLive(loadPng(popup))
  await s.wait()
  expect(s.mark()).toBe(null)
  expect(s.markOn({ x: 0, y: 0, width: 10, height: 10 })).toBe(null)

  s = new Session(20, [], null, null)
  s.readInBackground(loadPng(board))
  await s.wait()
  expect(s.advice()).not.toBe(null)
  expect(s.mark()).toBe(null)
})

/** A read without the board while no reading is on show says so in
 * `missed`; a board read clears it. */
test('an off-board read without a reading is missed', async () => {
  const s = new Session(20, [], null, null)
  s.readInBackground(black())
  await s.wait()
  expect(s.reading).toBe(null)
  expect(s.missed).toBe('The last read found no board or pick on screen.')

  if (!have(['rec1-t087.png'])) return
  s.readInBackground(loadPng(framePath('rec1-t087.png')))
  await s.wait()
  expect(s.reading !== null && s.missed === null).toBe(true)
})

/** The run log gets a "miss" line for a read that installed nothing, with no
 * frame for one off the board, and the "window" line names the OCR
 * language. */
test('the run log logs a miss', async () => {
  const root = mkdtempSync(join(tmpdir(), 'warden-run-log-miss-'))
  const s = new Session(20, [], null, null)
  s.log = new RunLog(root)
  s.logWindow('"Torchlight: Infinite" (1920 x 1080)')
  for (let k = 0; k < 2; k++) {
    s.readInBackground(black())
    await s.wait()
  }
  const run = s.log.dir()
  const text = readFileSync(join(run, 'log.jsonl'), 'utf8')
  const lines = text.split('\n').filter((l) => l !== '').map((l) => JSON.parse(l))
  expect(lines[0].kind).toBe('window')
  expect(lines[0].window).toBe('"Torchlight: Infinite" (1920 x 1080)')
  expect(lines[0].ocr).toBe(language())
  const misses = lines.filter((l) => l.kind === 'miss')
  expect(misses.length).toBe(2)
  expect(misses[0].screen).toBe('Unknown')
  expect(misses[0].line).toBe('The prison board is not on screen: showing the last reading.')
  expect(misses[0].size).toEqual([1920, 1080])
  // Off the board, the frame shows another game screen: none is saved.
  expect(misses.every((m) => m.frame === null)).toBe(true)
  expect(existsSync(join(run, 'frame-0001.png'))).toBe(false)
  rmSync(root, { recursive: true })
})

/** The Sewer Ratway's "Select an Objective" reads the board under the corner
 * brackets as a cell choice, picks the cell to move to, and is the board
 * under the next instrument pick. */
test('the Sewer Ratway cell pick', async () => {
  if (!have(['rec2-t340.png', 'rec1-t031.png'])) return
  const s = new Session(20, [], null, null)
  s.readInBackground(loadPng(framePath('rec2-t340.png')))
  await s.wait()
  const r = s.reading as Reading
  expect([r.screen, r.model.step, r.model.choice.kind]).toEqual(['cellPick', 'choice', 'cell'])
  expect(r.model.cells.filter((c) => c.kind === 'inmate').length).toBeGreaterThanOrEqual(4)
  expect(s.problems).toEqual([])
  const label = s.pick?.label ?? ''
  expect(label.startsWith('Move to ')).toBe(true)

  s.readInBackground(loadPng(framePath('rec1-t031.png')))
  await s.wait()
  expect((s.reading as Reading).model.cells).toEqual(r.model.cells)
})

/** The Interrogation Room's Instigate and Bestow cards after a patrol are a
 * choice between the two, solved on the board read behind them. */
test('the Interrogation Room cards', async () => {
  for (const card of ['rec3-ir08.png', 'rec3-ir12.png']) {
    const s = await readAll([], ['rec3-t291.png', card])
    if (s === null) return
    const r = s.reading as Reading
    expect([r.screen, r.model.step, r.model.choice.kind]).toEqual(['interrogation', 'choice', 'interrogation'])
    expect(s.problems).toEqual([])
    const action = s.advice()?.action
    if (action?.type !== 'choose') throw new Error(`${card}: ${JSON.stringify(action)}`)
    expect(['instigate', 'bestow'].includes(String(action.id))).toBe(true)
    for (const name of ['instigate', 'bestow']) {
      expect(s.ranking.some((o) => o.action.type === 'choose' && o.action.id === name)).toBe(true)
    }
  }
})

/** An incident marker on an open cell is read and stays through a
 * correction. */
test('an open cell marker', async () => {
  if (!have(['rec2-t100.png'])) return
  const s = new Session(20, [], null, null)
  s.readInBackground(loadPng(framePath('rec2-t100.png')))
  await s.wait()
  const cell = (s.reading as Reading).model.cells[12]
  expect(cell.kind === 'inmate' && cell.beast === 'wolf' && cell.event === 'unknown').toBe(true)
  s.editCell(13, { kind: 'empty' })
  const model = (s.reading as Reading).model
  expect(model.cells[12]).toEqual({ kind: 'empty', event: 'unknown' })
  const st = buildState(model, 1)[0]
  expect(!st.cells[12].sealed && st.cells[12].event !== null).toBe(true)
})

/** A low-confidence cell read warns on the first two reads that give it and
 * not on a third in a row. */
test('a steady read stops warning', async () => {
  const name = 'rec3-t058.png'
  const s = await readAll([], [name])
  if (s === null) return
  const check = () => (s.reading as Reading).warnings.filter((w) => w.kind === 'cellRead' && w.detail === 'rarity' && w.cell === 7).length
  expect(check()).toBe(1)
  const counts: number[] = []
  for (let k = 0; k < 2; k++) {
    s.readInBackground(loadPng(framePath(name)))
    await s.wait()
    counts.push(check())
  }
  expect(counts).toEqual([1, 0])
  expect((s.reading as Reading).warnings.every((w) => w.kind !== 'cellRead')).toBe(true)
})
