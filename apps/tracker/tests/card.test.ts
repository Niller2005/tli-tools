import { describe, expect, test } from 'bun:test'
import { ItemNames, Tracker } from '@tli/tracker'
import { lootCard } from '../src/card'

const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime()
const HOUR = 3_600_000

function trackerWithRuns(session: number): Tracker {
  const tracker = new Tracker({ names: new ItemNames({ '100': { name: 'Ember Core' } }) })
  tracker.prices.setOverride(100, 5)
  for (const [id, start] of [[1, NOW - 2 * HOUR], [2, NOW - HOUR]] as const) {
    tracker.runs.push({
      id,
      kind: 'map',
      zone: 'test',
      name: 'Glacial Abyss',
      levelId: 4708,
      start,
      end: start + HOUR / 2,
      loot: new Map([[100, 2]]),
      cost: new Map(),
      fe: 1000,
      xp: 500_000,
      affixes: [],
      session,
    })
  }
  return tracker
}

describe('the loot card', () => {
  test('shows what the session came to while one is going on', () => {
    const tracker = trackerWithRuns(1)
    const session = tracker.startSession('Fire farm', NOW - 3 * HOUR)
    for (const run of tracker.runs) run.session = session.id
    const lines = lootCard(tracker, 'bottom-left', NOW)?.lines?.map((line) => line.text) ?? []
    expect(lines.slice(0, 2)).toEqual([
      'Session Fire farm · 2 runs · 1h 00m',
      '20 FE/h · 20 FE · 10/run',
    ])
  })

  test("with no session going on it adds up today's runs, not yesterday's", () => {
    const tracker = trackerWithRuns(0)
    const old = tracker.runs[0]!
    tracker.runs.unshift({ ...old, id: 0, start: NOW - 30 * HOUR, end: NOW - 29 * HOUR })
    const lines = lootCard(tracker, 'bottom-left', NOW)?.lines?.map((line) => line.text) ?? []
    expect(lines.slice(0, 2)).toEqual(['Today · 2 runs · 1h 00m', '20 FE/h · 20 FE · 10/run'])
  })

  test('has no pace lines when a session has no runs yet', () => {
    const tracker = trackerWithRuns(0)
    tracker.startSession('Empty', NOW)
    expect(lootCard(tracker, 'bottom-left', NOW)?.lines?.some((line) => line.text.startsWith('Session'))).toBe(false)
  })
})
