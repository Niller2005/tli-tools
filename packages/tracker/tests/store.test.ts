import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { STATE_VERSION, migrateState, type SavedState } from '../src/engine'
import { around, expectState, items, richState } from './fixtures'
import {
  DB_FILE,
  SCHEMA_VERSION,
  loadTracker,
  queryRuns,
  queryTotals,
  saveTracker,
  type SavedTracker,
} from '../src/store'

const folders: string[] = []

/** A folder of its own, with the database path of the test in it. */
async function folder(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'tli-tracker-store-'))
  folders.push(dir)
  return join(dir, DB_FILE)
}

afterEach(async () => {
  while (folders.length > 0) {
    const dir = folders.pop()
    if (dir !== undefined) await rm(dir, { recursive: true, force: true })
  }
})

describe('the tracker that is saved', () => {
  test('is kept in a database of the schema this code knows, in WAL mode', async () => {
    const path = await folder()
    await saveTracker(around(richState()), path)
    const db = new Database(path, { readonly: true })
    const tables = db
      .query("select name from sqlite_master where type = 'table' and name not like 'sqlite_%' order by name")
      .all()
      .map((row) => (row as { name: string }).name)
    expect(tables).toEqual([
      'affixes',
      'characters',
      'gear',
      'instances',
      'log_position',
      'meta',
      'price_overrides',
      'prices',
      'run_affix',
      'run_cost',
      'run_loot',
      'runs',
      'sessions',
      'settings',
      'slots',
      'trade_items',
      'trades',
    ])
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    expect((db.query('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
    db.close()
  })

  test('the current run becomes a finished one without a second copy of it', async () => {
    const path = await folder()
    const state = richState()
    await saveTracker(around(state), path)
    const finished = state.current
    state.current = null
    if (finished !== null) {
      finished.end = 50000
      state.runs.push(finished)
    }
    await saveTracker(around(state), path)
    const loaded = await loadTracker(path)
    expect(loaded?.tracker.current).toBeNull()
    expect(loaded?.tracker.runs.map((run) => run.id)).toEqual([1, 2, 3])
    const db = new Database(path, { readonly: true })
    expect((db.query("select count(*) as n from runs where character = '980032478075064320'").get() as { n: number }).n).toBe(3)
    db.close()
  })

  test('a real-shaped state file is brought in', async () => {
    const path = await folder()
    const dir = dirname(path)
    // the copy of the player's own state.json, made before the tests ran; a state of the same
    // shape stands in when the copy is not there
    const copy = '/tmp/tli-tracker-work/real-state.json'
    if (existsSync(copy)) {
      await copyFile(copy, join(dir, 'state.json'))
    } else {
      const runs = Array.from({ length: 150 }, (_, i) => ({
        id: i + 1,
        kind: i % 20 === 19 ? 'prison' : 'map',
        zone: 'SD_GeBuLinShanZhai',
        name: `Glacial Abyss ${i}`,
        levelId: 4708,
        start: i * 100_000,
        end: i * 100_000 + 90_000,
        loot: [[100200, 5 + i]] as [number, number][],
        cost: [] as [number, number][],
        fe: i % 3,
      }))
      const slots = Array.from({ length: 250 }, (_, i) => ({
        key: `${(i % 2) + 1}:${i}`,
        item: 260105 + i,
        num: 1 + (i % 5),
        uuid: i % 7 === 0 ? null : `u${i}`,
      }))
      const instances = Array.from({ length: 50 }, (_, i) => ({ uuid: `u${i}`, item: 260105 + i, page: 1, slot: i, num: 1 }))
      const gear = Array.from({ length: 22 }, (_, i) => [3010 + i, 112151 + i] as [number, number])
      const state = { version: STATE_VERSION, runs, current: null, slots, instances, prices: [], overrides: [], gear, nextRunId: 151, taxed: true, mapCosts: true }
      await writeFile(join(dir, 'state.json'), JSON.stringify({ version: 1, log: { file: '/log/UE_game.log', offset: 123456 }, tracker: state }))
    }
    const raw = await readFile(join(dir, 'state.json'), 'utf8')
    const wanted = migrateState((JSON.parse(raw) as SavedTracker).tracker)
    expect(wanted).not.toBeNull()

    const loaded = await loadTracker(path)
    expectState(loaded, wanted as SavedState)
    expect(existsSync(join(dir, 'state.json.imported'))).toBe(true)
    // the whole of it came in, and can be asked for straight out of the tables
    expect(loaded?.tracker.runs.length).toBeGreaterThan(100)
    const totals = queryTotals(path)
    expect(totals?.runs).toBe(loaded?.tracker.runs.length)
    expect(totals?.fe).toBe((wanted as SavedState).runs.reduce((sum, run) => sum + run.fe, 0))
  })

  test('the queries a dashboard can ask', async () => {
    const path = await folder()
    await saveTracker(around(richState()), path)
    const runs = queryRuns(path)
    expect(runs?.map((run) => run.id)).toEqual([1, 2]) // the run that is going on is not among them
    expect(runs?.[1]?.kind).toBe('prison')
    expect(items(runs?.[0]?.loot ?? [])).toEqual(items([[100200, 5], [3010, 1]]))
    expect(queryRuns(path, 15000)?.map((run) => run.id)).toEqual([2])
    const totals = queryTotals(path)
    expect(totals?.runs).toBe(3) // every row, the run that is going on among them
    expect(totals?.fe).toBe(42)
    expect(totals?.firstAt).toBe(1000)
    expect(totals?.lastAt).toBe(40000)
    // and where there is no database, the queries say so rather than making one
    expect(queryRuns(join(dirname(path), 'none.db'))).toBeNull()
    expect(queryTotals(join(dirname(path), 'none.db'))).toBeNull()
  })

  test('the characters are kept apart, the one the log named last is the state, and the queries are about it', async () => {
    const path = await folder()
    const state = richState()
    await saveTracker(around(state), path)
    // the other character logs in: it becomes the state, and the first one is parked as it was
    const parked = state.parked?.[0]
    if (parked === undefined) throw new Error('the fixture has no other character')
    const swapped: SavedState = { ...parked, prices: state.prices, overrides: state.overrides, parked: [{ ...state, parked: undefined, prices: [], overrides: [] }] }
    await saveTracker(around(swapped), path)
    const loaded = await loadTracker(path)
    expect(loaded?.tracker.character).toBe('1')
    expect(loaded?.tracker.runs.map((run) => run.id)).toEqual([1])
    expect(loaded?.tracker.parked?.map((other) => other.character)).toEqual(['980032478075064320'])
    expect(loaded?.tracker.parked?.[0]?.runs.map((run) => run.id)).toEqual([1, 2])
    expect(loaded?.tracker.parked?.[0]?.current?.id).toBe(3)
    expect(queryRuns(path)?.map((run) => run.id)).toEqual([1])
    expect(queryTotals(path)?.runs).toBe(1)
  })

  test('what was saved before the log named the character is renamed to it, and nothing is left under the old name', async () => {
    const path = await folder()
    const state = richState()
    state.character = ''
    state.parked = []
    await saveTracker(around(state), path)
    state.character = '980032478075064320'
    await saveTracker(around(state), path)
    const db = new Database(path, { readonly: true })
    expect(db.query('select distinct character from runs').all()).toEqual([{ character: '980032478075064320' }])
    expect(db.query('select distinct character from slots').all()).toEqual([{ character: '980032478075064320' }])
    expect(db.query('select id from characters').all()).toEqual([{ id: '980032478075064320' }])
    db.close()
    expectState(await loadTracker(path), state)
  })

})
