import { afterEach, describe, expect, test } from 'bun:test'
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'
import { STATE_VERSION, migrateState, type SavedState } from '../src/engine'
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

/** A state with something of everything the tracker keeps. */
function richState(): SavedState {
  return {
    version: STATE_VERSION,
    runs: [
      {
        id: 1,
        kind: 'map',
        zone: 'SD_GeBuLinShanZhai',
        name: 'Glacial Abyss - Shadow Outpost',
        levelId: 4708,
        start: 1000,
        end: 9000,
        loot: [
          [100200, 5],
          [3010, 1],
        ],
        cost: [[100300, 2]],
        fe: 0,
      },
      {
        id: 2,
        kind: 'prison',
        zone: 'S16',
        name: 'The Tartarus prison',
        levelId: 5,
        start: 20000,
        end: 30000,
        loot: [],
        cost: [],
        fe: 42,
      },
    ],
    current: {
      id: 3,
      kind: 'map',
      zone: 'z',
      name: 'n',
      levelId: 7,
      start: 40000,
      end: null,
      loot: [[1, 1]],
      cost: [],
      fe: 0,
    },
    slots: [
      { key: '1:23', item: 260105, num: 1, uuid: 'a' },
      { key: '102:5', item: 100200, num: 30, uuid: null },
    ],
    instances: [{ uuid: 'a', item: 260105, page: 1, slot: 23, num: 1 }],
    prices: [[3010, { price: 12.5, samples: 2, listings: 10, at: 5000 }]],
    overrides: [[3010, 20]],
    gear: [[3010, 112151]],
    nextRunId: 4,
    taxed: false,
    mapCosts: true,
  }
}

/** A saved tracker around a state. */
function around(state: SavedState, offset = 42): SavedTracker {
  return { version: 1, log: { file: '/tmp/UE_game.log', offset }, tracker: state }
}

/** A pile of items in an order the comparison does not care about. */
function items(loot: [number, number][]): string[] {
  return loot.map(([item, qty]) => `${item}:${qty}`).sort()
}

/** Says a state is the one wanted, whatever order its lists were kept in. */
function expectState(loaded: SavedTracker | null, wanted: SavedState): void {
  expect(loaded).not.toBeNull()
  const state = loaded?.tracker
  if (state === undefined) throw new Error('nothing was loaded')
  expect(state.version).toBe(STATE_VERSION)
  expect(state.runs.length).toBe(wanted.runs.length)
  for (const [i, run] of state.runs.entries()) {
    expect(run.id).toBe(wanted.runs[i]?.id)
    expect(run.kind).toBe(wanted.runs[i]?.kind)
    expect(run.zone).toBe(wanted.runs[i]?.zone)
    expect(run.name).toBe(wanted.runs[i]?.name)
    expect(run.levelId).toBe(wanted.runs[i]?.levelId)
    expect(run.start).toBe(wanted.runs[i]?.start)
    expect(run.end).toBe(wanted.runs[i]?.end)
    expect(items(run.loot)).toEqual(items(wanted.runs[i]?.loot ?? []))
    expect(items(run.cost)).toEqual(items(wanted.runs[i]?.cost ?? []))
    expect(run.fe).toBe(wanted.runs[i]?.fe)
  }
  expect(state.current?.id).toBe(wanted.current?.id)
  expect(state.current?.end).toBe(wanted.current?.end)
  expect(items(state.current?.loot ?? [])).toEqual(items(wanted.current?.loot ?? []))
  expect([...state.slots].sort((a, b) => (a.key < b.key ? -1 : 1))).toEqual(
    [...wanted.slots].sort((a, b) => (a.key < b.key ? -1 : 1)),
  )
  expect([...state.instances].sort((a, b) => (a.uuid < b.uuid ? -1 : 1))).toEqual(
    [...wanted.instances].sort((a, b) => (a.uuid < b.uuid ? -1 : 1)),
  )
  expect([...state.prices].sort((a, b) => a[0] - b[0])).toEqual([...wanted.prices].sort((a, b) => a[0] - b[0]))
  expect([...state.overrides].sort((a, b) => a[0] - b[0])).toEqual([...wanted.overrides].sort((a, b) => a[0] - b[0]))
  expect([...(state.gear ?? [])].sort((a, b) => a[0] - b[0])).toEqual([...(wanted.gear ?? [])].sort((a, b) => a[0] - b[0]))
  expect(state.nextRunId).toBe(wanted.nextRunId)
  expect(state.taxed).toBe(wanted.taxed)
  expect(state.mapCosts).toBe(wanted.mapCosts)
}

/** The bytes of the database, as a fingerprint of what was written to it. */
function fingerprint(path: string): string {
  return new Bun.CryptoHasher('sha256').update(readFileSync(path)).digest('hex')
}

/** What the database says its own data version is: it moves only when something is written. */
function dataVersion(db: Database): number {
  return (db.query('PRAGMA data_version').get() as { data_version: number }).data_version
}

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
      'gear',
      'instances',
      'log_position',
      'price_overrides',
      'prices',
      'run_cost',
      'run_loot',
      'runs',
      'settings',
      'slots',
    ])
    expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(SCHEMA_VERSION)
    expect((db.query('PRAGMA journal_mode').get() as { journal_mode: string }).journal_mode).toBe('wal')
    db.close()
  })

  test('is read back, and read back again after the file was closed', async () => {
    const path = await folder()
    const state = richState()
    await saveTracker(around(state, 42), path)
    const loaded = await loadTracker(path)
    expect(loaded?.version).toBe(1)
    expect(loaded?.log.file).toBe('/tmp/UE_game.log')
    expect(loaded?.log.offset).toBe(42)
    expectState(loaded, state)
    // and again, from the file as it was left on disk
    expectState(await loadTracker(path), state)
  })

  test('a save with nothing changed writes nothing', async () => {
    const path = await folder()
    const saved = around(richState())
    await saveTracker(saved, path)
    const before = fingerprint(path)
    await saveTracker(saved, path)
    expect(fingerprint(path)).toBe(before)

    // and a watcher that only reads sees no write either
    const watch = new Database(path)
    const seen = dataVersion(watch)
    await saveTracker(saved, path)
    expect(dataVersion(watch)).toBe(seen)

    // a change does write: one run more, one run changed, one price learned, one slot emptied
    const state = richState()
    state.runs[1]!.fe = 43
    state.runs.pop() // the prison visit is gone
    state.prices.push([4001, { price: 3, samples: 1, listings: 4, at: 6000 }])
    state.slots = state.slots.filter((slot) => slot.key !== '102:5')
    state.overrides = [[3010, 25]]
    state.gear?.push([3020, 112152])
    state.taxed = true
    await saveTracker(around(state, 43), path)
    expect(dataVersion(watch)).toBeGreaterThan(seen)
    watch.close()

    const loaded = await loadTracker(path)
    expectState(loaded, state)
    expect(loaded?.log.offset).toBe(43)
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
    expect((db.query('select count(*) as n from runs').get() as { n: number }).n).toBe(3)
    db.close()
  })

  test('the state of the first version is brought in, and the old file is kept', async () => {
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
    await writeFile(join(dirname(path), 'state.json'), JSON.stringify({ version: 1, log: { file: '/tmp/UE_game.log', offset: 7 }, tracker: state }))
    const loaded = await loadTracker(path)
    expect(loaded?.tracker.version).toBe(STATE_VERSION)
    expect(loaded?.tracker.runs[0]?.kind).toBe('map')
    expect(loaded?.tracker.runs[0]?.loot).toEqual([[100200, 5]])
    expect(loaded?.log.offset).toBe(7)
    // the old file was renamed, not deleted
    expect(existsSync(join(dirname(path), 'state.json'))).toBe(false)
    expect(existsSync(join(dirname(path), 'state.json.imported'))).toBe(true)
    // and what was brought in is what the database now holds
    expectState(await loadTracker(path), migrateState(state) as SavedState)
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

  test('a state file that cannot be used is left where it is, and nothing is written', async () => {
    for (const bad of [
      '{"version":1,"log":{"file":"/l","offset":1},"tracker":{"version"', // truncated
      'not json at all',
      JSON.stringify({ version: 2, log: { file: '/l', offset: 1 }, tracker: richState() }), // a wrapper this code does not know
      JSON.stringify({ version: 1, log: { file: '/l', offset: 1 }, tracker: { ...richState(), version: 3 } }), // a state this code does not know
    ]) {
      const path = await folder()
      const dir = dirname(path)
      await writeFile(join(dir, 'state.json'), bad)
      expect(await loadTracker(path)).toBeNull()
      expect(existsSync(path)).toBe(false) // no database was made
      expect(existsSync(join(dir, 'state.json'))).toBe(true) // the old file was left alone
    }
  })

  test('a database that is not one is moved aside by the next save, and kept', async () => {
    const path = await folder()
    await writeFile(path, 'this is not a database')
    expect(await loadTracker(path)).toBeNull()
    const state = richState()
    await saveTracker(around(state), path)
    expect(existsSync(`${path}.corrupt`)).toBe(true)
    expect(await readFile(`${path}.corrupt`, 'utf8')).toBe('this is not a database')
    expectState(await loadTracker(path), state)
  })

  test('a database of a newer schema is left alone, and nothing is written to it', async () => {
    const path = await folder()
    await saveTracker(around(richState()), path)
    const bump = new Database(path)
    bump.exec('PRAGMA user_version = 999')
    bump.close()
    expect(await loadTracker(path)).toBeNull()
    await expect(saveTracker(around(richState()), path)).rejects.toThrow()
    const check = new Database(path)
    expect((check.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(999)
    check.close()
  })

  test('nothing on disk is nothing saved, and nothing is made of it', async () => {
    const path = await folder()
    expect(await loadTracker(path)).toBeNull()
    expect(queryRuns(path)).toBeNull()
    expect(queryTotals(path)).toBeNull()
    expect(existsSync(path)).toBe(false)
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
  })
})
