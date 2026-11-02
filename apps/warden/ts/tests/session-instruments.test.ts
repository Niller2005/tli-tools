//! The session's held instruments on saved frames: the panel's read, the
//! instrument advised on a pick, the player's own list, new runs and the
//! Iron Law theme. Skips when trainingdata/s16 (git-ignored) is missing. A
//! port of the instrument tests of the Rust crate's tests/session.rs.

import { expect, test } from 'bun:test'

import { Session, type Reading } from '@/app/session'
import { IRON_LAW, TOOLS, toolFromKey, type Tool } from '@/engine/data'
import { loadPng, warningText } from '@/reader/mod'
import { frame, framePath, have, readAll } from './session-common'

/** The labels of the session's ranking. */
function labels(s: Session): string[] {
  return s.ranking.map((o) => o.label)
}

/** The instrument the session advises on the rec1-t031 pick after `board`
 * (rec1-t087, see [`frame`]) with `held`, and the pick's options. */
async function advisedOnT031(held: Tool[], board: string): Promise<[Tool, Tool[]] | null> {
  const s = await readAll(held, [board, 'rec1-t031.png'])
  if (s === null) return null
  const r = s.reading as Reading
  expect(r.screen).toBe('instrumentPick')
  const action = s.advice()?.action
  if (action?.type !== 'choose' || typeof action.id !== 'string') throw new Error(JSON.stringify(s.advice()))
  const tool = toolFromKey(action.id)
  if (tool === null) throw new Error(`not an instrument: ${action.id}`)
  return [tool, r.model.choice.options]
}

/** A board frame's sure panel read names the held list over the instrument
 * advised on the pick before it: rec1-t087 shows the Coin. */
test('the panel read wins over the advised instrument', async () => {
  const advised = await advisedOnT031([], 'rec1-t087.png')
  if (advised === null) return
  expect(advised[0]).not.toBe('coin')
  const s = (await readAll([], ['rec1-t087.png', 'rec1-t031.png', 'rec1-t087.png'])) as Session
  expect(s.tools).toEqual(['coin'])
})

/** With the panel's read unsure, the board after an instrument pick holds the
 * advised instrument without a line about it, and the solve plays with it. */
test('the advised instrument is held after the pick', async () => {
  const advised = await advisedOnT031([], '~rec1-t087.png')
  if (advised === null) return
  const t = advised[0]
  const s = (await readAll([], ['~rec1-t087.png', 'rec1-t031.png', '~rec1-t087.png'])) as Session
  expect(s.tools).toEqual([t])
  const r = s.reading as Reading
  expect(r.warnings.every((w) => !warningText(w).includes('held instruments'))).toBe(true)
  expect(s.takeToolsChanged()).toBe(true)
  expect(s.takeToolsChanged()).toBe(false)
  const held = (await readAll([t], ['~rec1-t087.png'])) as Session
  expect(r.model).toEqual((held.reading as Reading).model)
  expect(s.ranking).toEqual(held.ranking)
})

/** An advised instrument already held is not added again. The advice never
 * names a held instrument, so the player adds it on a screen the reader
 * doesn't know (the board between moves of rec1-t059 here), which keeps the
 * advised instrument. */
test('a held advised instrument is not duplicated', async () => {
  const advised = await advisedOnT031([], '~rec1-t087.png')
  if (advised === null) return
  const t = advised[0]
  const s = await readAll([], ['~rec1-t087.png', 'rec1-t031.png', 'rec1-t059.png'])
  if (s === null) return
  expect((s.reading as Reading).screen).toBe('unknown')
  s.setTools([t])
  s.readInBackground(frame('~rec1-t087.png'))
  await s.wait()
  expect(s.tools).toEqual([t])
  expect(s.takeToolsChanged()).toBe(false)
})

/** A player's list stands while reads give the panel read it was set over
 * (rec1-t087's Coin), and gives way to another (the rec2-t340 cell pick's
 * Crown and Stake). */
test('set instruments stand until the panel changes', async () => {
  if (!have(['rec2-t340.png'])) return
  const s = await readAll([], ['rec1-t087.png'])
  if (s === null) return
  s.setTools(['saw'])
  s.readInBackground(frame('rec1-t087.png'))
  await s.wait()
  expect(s.tools).toEqual(['saw'])
  s.readInBackground(frame('rec2-t340.png'))
  await s.wait()
  expect(s.tools).toEqual(['crown', 'stake'])
})

/** A game dialog between the pick and the board keeps the advised
 * instrument. */
test('a popup keeps the advised instrument', async () => {
  const advised = await advisedOnT031([], '~rec1-t087.png')
  if (advised === null) return
  const t = advised[0]
  const s = await readAll([], ['~rec1-t087.png', 'rec1-t031.png', 'rec2-t109.png'])
  if (s === null) return
  expect(s.tools).toEqual([])
  s.readInBackground(frame('~rec1-t087.png'))
  await s.wait()
  expect(s.tools).toEqual([t])
})

/** An instrument advised at a new run's start is kept when the second higher
 * read confirms the new run: the board after the rec1-t031 pick (rec1-t049,
 * 19 days, over rec1-t087's 14) takes the advised instrument while its count
 * waits, and reading it again clears only the old Saw. The panel's reads are
 * unsure throughout. */
test('a new run keeps the instrument picked at its start', async () => {
  const advised = await advisedOnT031(['saw'], '~rec1-t087.png')
  if (advised === null) return
  const t = advised[0]
  expect(t).not.toBe('saw')
  const s = await readAll(['saw'], ['~rec1-t087.png', 'rec1-t031.png', '~rec1-t049.png'])
  if (s === null) return
  const shown = s.reading as Reading
  expect([shown.daysLeft, shown.screen]).toEqual([14, 'patrol']) // the higher count waits
  expect(s.tools).toEqual(['saw', t])
  s.readInBackground(frame('~rec1-t049.png'))
  await s.wait()
  const r = s.reading as Reading
  expect(r.daysLeft).toBe(19)
  expect(s.tools).toEqual([t])
  expect(r.warnings.some((w) => warningText(w) === 'A new run: the held instruments were cleared.')).toBe(true)
})

/** Held instruments saved at a days count (an app restart) are cleared by a
 * higher count read twice (rec1-t029, 20 days); with no saved count the
 * first count is taken and they are kept. */
test('saved instruments clear on a higher count', async () => {
  if (!have(['rec1-t029.png'])) return
  const cases: [number | null, Tool[]][] = [
    [11, []],
    [null, ['muzzle']],
  ]
  for (const [days, held] of cases) {
    const s = new Session(20, ['muzzle'], null, days)
    for (let k = 0; k < 2; k++) {
      s.readInBackground(loadPng(framePath('rec1-t029.png')))
      await s.wait()
    }
    expect(s.daysLeft()).toBe(20)
    expect(s.tools).toEqual(held)
  }
})

/** Under Iron Law the run lasts 30 days, so 20 days left (rec1-t029) is day
 * 10; without a theme it is day 1 of 20. */
test('an Iron Law run reads at 30 days', async () => {
  if (!have(['rec1-t029.png'])) return
  const cases: [number | null, number, number][] = [
    [IRON_LAW, 10, 30],
    [null, 1, 20],
  ]
  for (const [theme, day, maxDays] of cases) {
    const s = new Session(20, [], theme, null)
    s.readInBackground(loadPng(framePath('rec1-t029.png')))
    await s.wait()
    const m = (s.reading as Reading).model
    expect([m.day, m.maxDays]).toEqual([day, maxDays])
  }
})

/** An instrument the player adds on the pick is the one taken: the next
 * advice on that pick is not added on top (the panel's reads unsure). */
test('an instrument named on the pick is kept', async () => {
  const advised = await advisedOnT031([], '~rec1-t087.png')
  if (advised === null) return
  const [t, offers] = advised
  const other = offers.find((o) => o !== t)
  expect(other).not.toBe(undefined)
  const s = await readAll([], ['~rec1-t087.png', 'rec1-t031.png'])
  if (s === null) return
  s.setTools([other as Tool])
  await s.wait()
  s.readInBackground(frame('~rec1-t087.png'))
  await s.wait()
  expect(s.tools).toEqual([other as Tool])
})

/** A higher days count read twice is a new run: the held instruments go (the
 * panel's reads unsure). */
test('a new run clears the held instruments', async () => {
  const s = await readAll([TOOLS[0], TOOLS[1]], ['~rec1-t087.png', '~rec1-t071.png'])
  if (s === null) return
  expect(s.tools.length).toBe(2) // a lone higher read
  s.readInBackground(frame('~rec1-t071.png'))
  await s.wait()
  expect(s.tools).toEqual([])
  const r = s.reading as Reading
  expect(r.warnings.some((w) => warningText(w) === 'A new run: the held instruments were cleared.')).toBe(true)
  expect(s.takeToolsChanged()).toBe(true)
})

/** An advised Re-roll keeps the pick on show: the board after it holds no
 * instrument, not even one advised on that pick before (the panel's reads
 * unsure). reroll-2000x837 shows one re-roll left; its playouts advise an
 * instrument, so the ranking is changed to put the Re-roll first. */
test('an advised Re-roll is not held', async () => {
  const s = await readAll([], ['~rec1-t087.png', 'reroll-2000x837.png'])
  if (s === null) return
  const r = s.reading as Reading
  expect([r.screen, r.model.choice.rerolls]).toEqual(['instrumentPick', 1])
  expect(s.advice()?.action.type).toBe('choose')
  const k = s.ranking.findIndex((o) => o.action.type === 'reroll')
  if (k < 0) throw new Error(JSON.stringify(labels(s)))
  const [reroll] = s.ranking.splice(k, 1)
  reroll.mean = s.ranking[0].mean + 100
  s.ranking.unshift(reroll)
  for (const o of s.ranking) o.gapSe = 0
  await s.wait()
  expect(s.advice()?.action).toEqual({ type: 'reroll' })
  s.readInBackground(frame('~rec1-t087.png'))
  await s.wait()
  expect(s.tools).toEqual([])
})

/** A re-roll's new offer at the same pick is solved anew: reroll-2000x837
 * (one re-roll left) then rec1-t031 (none left, another offer). The board
 * after it holds the instrument advised on the new offer. */
test('a new offer at the pick is solved anew', async () => {
  const s = await readAll([], ['~rec1-t087.png', 'reroll-2000x837.png', 'rec1-t031.png'])
  if (s === null) return
  const r = s.reading as Reading
  expect([r.screen, r.model.choice.rerolls]).toEqual(['instrumentPick', 0])
  const offers = r.model.choice.options
  expect(offers).toEqual(['chains', 'scapegoat', 'coin'])
  expect(s.ranking.length).toBeGreaterThan(0)
  const offered = (o: { action: { type: string; id?: unknown } }) =>
    o.action.type === 'choose' && typeof o.action.id === 'string' && offers.includes(toolFromKey(o.action.id) as Tool)
  expect(s.ranking.every(offered)).toBe(true)
  const action = s.advice()?.action
  if (action?.type !== 'choose' || typeof action.id !== 'string') throw new Error(JSON.stringify(s.advice()))
  const t = toolFromKey(action.id) as Tool
  s.readInBackground(frame('~rec1-t087.png'))
  await s.wait()
  expect(s.tools).toEqual([t])
})
