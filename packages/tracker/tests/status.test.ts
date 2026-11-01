import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STATE_VERSION, type SavedRun, type SavedState } from '../src/engine'
import { baselineAge, readBaseline, refreshBaseline } from '../src/baseline'
import { itemTableAge, readItemTableMeta } from '../src/items'
import { sessionSummary, trackerStatus } from '../src/status'

const folders: string[] = []

/** A file of its own for the test that asks for one. */
async function folder(name: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tli-tracker-status-'))
  folders.push(dir)
  return join(dir, name)
}

afterEach(async () => {
  while (folders.length > 0) {
    const dir = folders.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }

})

/** A run, as the tracker saves it: only what the test says is not the default. */
const run = (over: Partial<SavedRun> & Pick<SavedRun, 'id' | 'start'>): SavedRun => ({
  kind: 'map',
  zone: 'timeworn',
  name: 'Timeworn Sea',
  levelId: 203013,
  end: over.start + 10 * 60_000,
  loot: [],
  cost: [],
  fe: 0,
  ...over,
})

/** A state with the runs given and nothing else. */
const state = (runs: SavedRun[], current: SavedRun | null = null): SavedState => ({
  version: STATE_VERSION,
  runs,
  current,
  slots: [],
  instances: [],
  prices: [],
  overrides: [],
  gear: [],
  nextRunId: runs.length + 1,
  taxed: true,
  mapCosts: false,
})

/** A time on the day the tests call "today", so the day is the local one whatever the clock is. */
const local = (dayOffset: number, hours: number, minutes = 0): number =>
  new Date(2026, 9, 29 + dayOffset, hours, minutes).getTime()

const NOW = local(0, 21, 55)

describe('sessionSummary', () => {
  test('the runs of today, with their FE and their time', () => {
    const morning = run({ id: 1, start: local(0, 9), end: local(0, 9, 15), fe: 30 })
    const evening = run({ id: 2, start: local(0, 21), end: local(0, 21, 6), fe: 12 })
    const summary = sessionSummary(state([morning, evening]), NOW)
    expect(summary.runsToday).toBe(2)
    expect(summary.feToday).toBe(42)
    // 21 minutes of maps, 42 FE: 120 FE in an hour
    expect(summary.fePerHour).toBe(120)
    expect(summary.feTotal).toBe(42)
    expect(summary.lastRun?.id).toBe(2)
    expect(summary.at).toBe(local(0, 21, 6))
  })

  test('a run of yesterday is in the total and can be the last, but not in today', () => {
    const yesterday = run({ id: 1, start: local(-1, 20), end: local(-1, 20, 11), fe: 50 })
    const summary = sessionSummary(state([yesterday]), NOW)
    expect(summary.runsToday).toBe(0)
    expect(summary.feToday).toBe(0)
    expect(summary.fePerHour).toBe(0)
    expect(summary.feTotal).toBe(50)
    expect(summary.lastRun?.id).toBe(1)
    expect(summary.bestRun).toBeNull()
    expect(summary.at).toBe(local(-1, 20, 11))
  })

  test('the run that is going on counts, and is the last', () => {
    const ongoing = run({ id: 3, start: local(0, 21, 50), end: null, fe: 5 })
    const summary = sessionSummary(state([run({ id: 1, start: local(-1, 20) })], ongoing), NOW)
    expect(summary.runsToday).toBe(1)
    expect(summary.feToday).toBe(5)
    expect(summary.lastRun?.endedAt).toBeNull()
    expect(summary.lastRun?.startedAt).toBe(ongoing.start)
    // a run that is going on says the data is current
    expect(summary.at).toBe(NOW)
  })

  test('the best run is today\'s run whose loot was worth the most', () => {
    const prices: SavedState['prices'] = [
      [100, { price: 10, samples: 1, listings: 1, at: 0 }],
      [101, { price: 2, samples: 1, listings: 1, at: 0 }],
    ]
    const poor = run({ id: 1, start: local(0, 9), end: local(0, 9, 10), loot: [[100, 1]] })
    const rich = run({ id: 2, start: local(0, 20), end: local(0, 20, 10), loot: [[100, 3], [101, 5]] })
    const summary = sessionSummary({ ...state([poor, rich]), prices }, NOW)
    expect(summary.bestRun?.id).toBe(2)
    expect(summary.bestRun?.worth).toBe(40)
    expect(summary.bestRun?.name).toBe('Timeworn Sea')
    // the loot of yesterday is not in the running, however nice it was
    const old = run({ id: 0, start: local(-1, 20), loot: [[100, 9]] })
    expect(sessionSummary({ ...state([old, poor]), prices }, NOW).bestRun?.id).toBe(1)
  })

  test('a day of unsold loot has no best run', () => {
    const quiet = run({ id: 1, start: local(0, 9), end: local(0, 9, 10), loot: [[100, 1]] })
    expect(sessionSummary(state([quiet]), NOW).bestRun).toBeNull()
  })

  test('a state with no runs says nothing', () => {
    const summary = sessionSummary(state([]), NOW)
    expect(summary.runsToday).toBe(0)
    expect(summary.feTotal).toBe(0)
    expect(summary.bestRun).toBeNull()
    expect(summary.lastRun).toBeNull()
    expect(summary.at).toBe(0)
  })
})

describe('trackerStatus', () => {
  test('a day with runs is one line about them', () => {
    const status = trackerStatus(
      state([run({ id: 1, start: local(0, 9), end: local(0, 9, 15), fe: 30 })]),
      NOW,
    )
    expect(status.id).toBe('tracker')
    expect(status.tone).toBe('ok')
    expect(status.line).toContain('1 runs today')
    expect(status.line).toContain('FE/h')
    expect(status.line).toContain('last: Timeworn Sea')
    expect(status.line).toContain('30 FE total')
    expect(status.at).toBe(local(0, 9, 15))
  })

  test('a tracker whose last run was another day says only that, quietly', () => {
    const yesterday = run({ id: 1, start: local(-1, 20), end: local(-1, 20, 11), fe: 50 })
    const status = trackerStatus(state([yesterday]), NOW)
    expect(status.tone).toBe('dim')
    expect(status.line).not.toContain('runs today')
    expect(status.line).toContain('last: Timeworn Sea')
    expect(status.line).toContain('50 FE total')
  })

  test('a tracker with nothing has nothing to say', () => {
    const status = trackerStatus(state([]), NOW)
    expect(status).toEqual({ id: 'tracker', line: '', tone: 'dim', at: 0 })
  })

  test('the line and the panel are the same numbers', () => {
    const runs = [run({ id: 1, start: local(0, 9), end: local(0, 9, 15), fe: 30 })]
    const status = trackerStatus(state(runs), NOW)
    const summary = sessionSummary(state(runs), NOW)
    expect(status.line).toContain(`${summary.runsToday} runs today`)
    expect(status.at).toBe(summary.at)
  })
})

describe('the age of the item-name table', () => {
  test('is the time since its own meta says it was built', async () => {
    const file = await folder('items.json')
    const generatedAt = '2026-10-20T02:10:22.251Z'
    await writeFile(file, `${JSON.stringify({ meta: { generatedAt, count: 2 }, items: {} })}\n`)
    const now = Date.parse('2026-10-22T02:10:22.251Z')
    expect(await itemTableAge(file, now)).toBe(48 * 60 * 60 * 1000)
    expect((await readItemTableMeta(file))?.count).toBe(2)
  })

  test('a table that is not there, or says nothing, has no age', async () => {
    expect(await itemTableAge(join(tmpdir(), 'tli-no-such-table.json'), 0)).toBeNull()
    const file = await folder('items.json')
    await writeFile(file, `${JSON.stringify({ items: {} })}\n`)
    expect(await itemTableAge(file, 0)).toBeNull()
  })
})

describe('refreshBaseline', () => {
  test('fetches the prices and keeps them where the readers look', async () => {
    const realFetch = globalThis.fetch
    const answer = JSON.stringify({ items: [{ id: 100, price: 10 }, { id: 101, price: 5 }] })
    globalThis.fetch = (async () => new Response(answer)) as unknown as typeof fetch
    try {
      const path = await folder('baseline.json')
      const data = await refreshBaseline(1000, path)
      expect(data.prices).toEqual([
        [100, 10],
        [101, 5],
      ])
      const kept = await readBaseline(path)
      expect(kept).toEqual(data)
      expect(baselineAge(kept, 61_000)).toBe(60_000)
    } finally {
      globalThis.fetch = realFetch
    }
  })
})
