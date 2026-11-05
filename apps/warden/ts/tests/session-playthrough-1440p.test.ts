//! The Session over the recorded live 20-day run at 2560x1440 (the s16-*1440p fixtures): the glowless frame
//! after the day-6 board read keeps the earlier read's tiers and ranks like the corrected solve, a popup
//! between them keeps the reading and its solve on show, and the days clock follows the counter down to the
//! Riot, which ends the run. The whole recorded run was fed through the Session in capture order first; what
//! that replay got wrong is in the session-playthrough report, not asserted here.

import { expect, test } from 'bun:test'

import { Session } from '@/app/session'
import type { Reading } from '@/app/run'
import { loadPng } from '@/reader/mod'

const path = (name: string) => new URL(`./fixtures/s16-${name}-1440p.png`, import.meta.url).pathname

/** Reads the live frame `name` into `s` and waits the read and its solve out. */
async function read(s: Session, name: string): Promise<Reading | null> {
  s.readLive(loadPng(path(name)))
  await s.wait()
  return s.reading
}

/** A live read of the frame `name` into a fresh session. */
async function fresh(name: string): Promise<[Session, Reading | null]> {
  const s = new Session(150, [], null, null)
  return [s, await read(s, name)]
}

test('a glowless board read keeps the tiers of the board read before it', async () => {
  const [s, day6] = await fresh('replace-or-end-day6')
  expect(day6?.screen).toBe('manage')
  expect(day6?.daysLeft).toBe(14)

  // A popup covers the game: the reading and its solve stay on show.
  const solve = s.ranking.map((o) => o.label)
  const popup = await read(s, 'incident-sewer-ratway')
  expect([popup?.screen, popup?.daysLeft]).toEqual(['manage', 14])
  expect(popup?.model).toEqual(day6?.model)
  expect(s.ranking.map((o) => o.label)).toEqual(solve)

  // The day-7 destination was drawn without rarity glow: every cell that
  // still shows the beast the day-6 read saw keeps its tier.
  const day7 = await read(s, 'destination-day7')
  expect(day7?.screen).toBe('patrol')
  expect(day7?.daysLeft).toBe(13)
  const before = (day6 as Reading).model.cells
  const now = (day7 as Reading).model.cells
  let kept = 0
  for (let k = 0; k < Math.min(before.length, now.length); k++) {
    const a = before[k]
    const b = now[k]
    if (a.kind !== 'inmate' || b.kind !== 'inmate' || a.beast !== b.beast) continue
    expect(b.tier).toBe(a.tier)
    kept += 1
  }
  expect(kept).toBeGreaterThanOrEqual(8)

  // So the advice is the corrected one: the Prison Incident marker on cell
  // 04, worth what the real board is worth, not the ~6.7 of an all-Normal read.
  const top = s.ranking[0]
  expect(top?.label).toBe('Go to cell 04 (a Prison Incident marker)')
  expect(top?.mean).toBeGreaterThan(9)
}, 60_000)

test('the days clock follows the counter across the late days and the Riot ends the run', async () => {
  const [s, d18] = await fresh('destination-day18-2')
  expect([d18?.screen, d18?.daysLeft, d18?.model.day]).toEqual(['patrol', 2, 18])

  const d19 = await read(s, 'destination-day19')
  expect([d19?.screen, d19?.daysLeft, d19?.model.day]).toEqual(['patrol', 1, 19])

  // The Consume target screen hides the counter: the clock keeps the count.
  const target = await read(s, 'consume-target-day19')
  expect([target?.screen, target?.daysLeft, s.daysLeft()]).toEqual(['chainTarget', 1, 1])

  const d20 = await read(s, 'destination-day20')
  expect([d20?.screen, d20?.daysLeft, d20?.model.day]).toEqual(['patrol', 0, 20])
  expect(s.daysLeft()).toBe(0)

  // The riot ends the run: no reading, no advice, no count.
  await read(s, 'riot')
  expect(s.reading).toBe(null)
  expect(s.runOver).toContain('The run is over')
  expect(s.daysLeft()).toBe(null)
}, 60_000)

