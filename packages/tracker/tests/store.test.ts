import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { STATE_VERSION } from '../src/engine'
import { loadTracker, saveTracker } from '../src/store'

const folders: string[] = []

/** A folder of its own for the file of one test. */
async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tli-tracker-store-'))
  folders.push(dir)
  return join(dir, 'state.json')
}

afterEach(async () => {
  while (folders.length > 0) {
    const dir = folders.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

describe('the tracker that is saved', () => {
  test('is read back', async () => {
    const path = await folder()
    const state = {
      version: STATE_VERSION,
      runs: [],
      current: null,
      slots: [],
      instances: [],
      prices: [],
      overrides: [],
      nextRunId: 1,
      taxed: true,
      mapCosts: false,
    }
    await saveTracker({ version: 1, log: { file: '/tmp/UE_game.log', offset: 42 }, tracker: state }, path)
    const loaded = await loadTracker(path)
    expect(loaded?.log.offset).toBe(42)
    expect(loaded?.tracker.version).toBe(STATE_VERSION)
  })

  test('the state of the first version is put back', async () => {
    const path = await folder()
    const state = {
      version: 1,
      runs: [
        {
          id: 1,
          zone: 'SD_GeBuLinShanZhai',
          name: 'Glacial Abyss - Shadow Outpost',
          levelId: 4708,
          start: 0,
          end: 1000,
          loot: [[100200, 5]] as [number, number][],
          cost: [] as [number, number][],
          fe: 0,
        },
      ],
      current: null,
      slots: [],
      instances: [],
      prices: [],
      overrides: [],
      nextRunId: 2,
      taxed: true,
      mapCosts: false,
    }
    await saveTracker({ version: 1, log: { file: '/tmp/UE_game.log', offset: 0 }, tracker: state }, path)
    const loaded = await loadTracker(path)
    expect(loaded?.tracker.version).toBe(STATE_VERSION)
    expect(loaded?.tracker.runs[0]?.kind).toBe('map')
    expect(loaded?.tracker.runs[0]?.loot).toEqual([[100200, 5]])
  })

  test('a file that is not there is not a problem', async () => {
    const path = await folder()
    expect(await loadTracker(path)).toBeNull()
  })
})
