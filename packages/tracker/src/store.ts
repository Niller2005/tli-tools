// Saving the tracker.
//
// Everything the tracker knows is written to one SQLite database, so the tracker can be stopped
// and started again and still know about the runs that were already farmed, the prices that were
// learned and where it was in the log. The database is written now and then, and when the tracker
// is left; each save writes only what changed since the last one, in one transaction.
//
// The database can be looked at while the tracker runs (it is in WAL mode, so a reader never gets
// in the writer's way):
//
//   sqlite3 ~/.local/share/tli-tracker/tracker.db 'select kind, count(*) from runs group by kind'
//
// The state the tracker kept before the database was introduced is still read once: when the
// database is not there and `state.json` is, the old state is brought in with one write and the
// file is renamed to `state.json.imported`, so it is kept as a backup and never deleted.

import { mkdir, readFile, rename } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Database, SQLiteError } from 'bun:sqlite'
import { dataPath } from './items'
import { migrateState, STATE_VERSION, type SavedRun, type SavedState } from './engine'

/** The database the tracker saves itself in. */
export const DB_FILE = 'tracker.db'

/** Where the tracker saves itself. */
export function dbPath(): string {
  return dataPath(DB_FILE)
}

/** The file the tracker kept its state in before there was a database; read once, then renamed. */
const LEGACY_STATE_FILE = 'state.json'

/** What the old state file is renamed to once it was brought in: kept as a backup, never deleted. */
const IMPORTED_SUFFIX = '.imported'

/** What a file that is not a usable database is moved aside to. */
const CORRUPT_SUFFIX = '.corrupt'

/** What is saved: the tracker's state, and where it was in the log. */
export interface SavedTracker {
  version: number
  /** the log that was being read */
  log: { file: string; offset: number }
  /** what the tracker knows */
  tracker: SavedState
}

/* ---------- the schema ---------- */

/**
 * The schema of the database, one entry per version: the entry `n` turns a database of version
 * `n` into one of version `n + 1`. The version is the database's own `user_version`.
 */
const MIGRATIONS: string[] = [
  // 1 → the tables the tracker's state is kept in
  `
  create table log_position (
    id integer primary key check (id = 1),
    file text not null,
    offset integer not null
  );
  create table runs (
    id integer primary key,
    kind text not null,
    zone text not null,
    name text not null,
    level_id integer not null,
    start_ms integer not null,
    end_ms integer,
    fe integer not null,
    is_current integer not null default 0 check (is_current in (0, 1))
  );
  create table run_loot (
    run_id integer not null references runs(id) on delete cascade,
    item integer not null,
    qty integer not null,
    primary key (run_id, item)
  );
  create table run_cost (
    run_id integer not null references runs(id) on delete cascade,
    item integer not null,
    qty integer not null,
    primary key (run_id, item)
  );
  create table slots (
    key text primary key,
    item integer not null,
    num integer not null,
    uuid text
  );
  create table instances (
    uuid text primary key,
    item integer not null,
    page integer not null,
    slot integer not null,
    num integer not null
  );
  create table prices (
    item integer primary key,
    price real not null,
    samples integer not null,
    listings integer not null,
    seen_at integer not null
  );
  create table price_overrides (
    item integer primary key,
    price real not null
  );
  create table gear (
    base integer primary key,
    legendary integer not null
  );
  create table settings (
    key text primary key,
    value integer not null
  );
  `,
]

/** The version of the database schema this code writes and reads. */
export const SCHEMA_VERSION = MIGRATIONS.length

/** The database was written by a newer version of the tracker: it is left alone, nothing is written. */
class FutureSchemaError extends Error {}

/** The file is there but it is not the tracker's database: it is corrupt, or another tool's. */
class NotTrackerDbError extends Error {}

/** The rows the tables are read back as. */
interface RunRow {
  id: number
  kind: string
  zone: string
  name: string
  level_id: number
  start_ms: number
  end_ms: number | null
  fe: number
  is_current: number
}
interface ItemRow {
  run_id: number
  item: number
  qty: number
}
interface SlotRow {
  key: string
  item: number
  num: number
  uuid: string | null
}
interface InstanceRow {
  uuid: string
  item: number
  page: number
  slot: number
  num: number
}
interface PriceRow {
  item: number
  price: number
  samples: number
  listings: number
  seen_at: number
}
interface PairRow {
  item: number
  price: number
}
interface GearRow {
  base: number
  legendary: number
}
interface SettingRow {
  key: string
  value: number
}
interface LogRow {
  file: string
  offset: number
}

/**
 * Opens the database and brings its schema up to date; the caller closes it.
 *
 * A file that is not the tracker's database (corrupt, or another tool's tables) and a database of
 * a newer version are both refused: the one by `NotTrackerDbError`, so the caller can move it
 * aside, the other by `FutureSchemaError`, so the caller leaves it alone.
 */
function openDb(path: string, create: boolean): Database {
  const db = create ? new Database(path) : new Database(path, { create: false })
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    // the rows sqlite gives back are untyped; these are the tracker's own tables
    const versionRow = db.query('PRAGMA user_version').get() as { user_version: number }
    const version = versionRow.user_version
    if (version > SCHEMA_VERSION) {
      throw new FutureSchemaError(`the tracker database is of schema version ${version}; this tracker knows up to ${SCHEMA_VERSION}`)
    }
    if (version === 0) {
      const countRow = db.query("select count(*) as n from sqlite_master where type = 'table' and name not like 'sqlite_%'").get() as { n: number }
      if (countRow.n > 0) throw new NotTrackerDbError(`${path} has tables this tracker does not know`)
    }
    for (let from = version; from < SCHEMA_VERSION; from += 1) {
      const apply = db.transaction(() => {
        db.exec(MIGRATIONS[from])
        db.exec(`PRAGMA user_version = ${from + 1}`)
      })
      apply()
    }
    return db
  } catch (e) {
    db.close()
    if (e instanceof NotTrackerDbError || e instanceof FutureSchemaError) throw e
    if (isUnusable(e)) throw new NotTrackerDbError(`${path} is not the tracker's database: ${(e as Error).message}`)
    throw e
  }
}

/** Whether the error says the file is not a usable database: not one at all, or broken inside. */
function isUnusable(e: unknown): boolean {
  return e instanceof SQLiteError && (e.code === 'SQLITE_NOTADB' || e.code === 'SQLITE_CORRUPT')
}

/* ---------- reading ---------- */

/** The runs of the state, with their loot and their cost, from the rows the tables hold. */
function readRuns(db: Database, runs: RunRow[]): { runs: SavedRun[]; current: SavedRun | null } {
  const loot = new Map<number, [number, number][]>()
  const lootRows = db.query('select * from run_loot order by run_id, item').all() as ItemRow[]
  for (const row of lootRows) {
    push(loot, row.run_id, [row.item, row.qty])
  }
  const cost = new Map<number, [number, number][]>()
  const costRows = db.query('select * from run_cost order by run_id, item').all() as ItemRow[]
  for (const row of costRows) {
    push(cost, row.run_id, [row.item, row.qty])
  }
  const done: SavedRun[] = []
  let current: SavedRun | null = null
  for (const row of runs) {
    const run: SavedRun = {
      id: row.id,
      kind: row.kind as SavedRun['kind'],
      zone: row.zone,
      name: row.name,
      levelId: row.level_id,
      start: row.start_ms,
      end: row.end_ms,
      loot: loot.get(row.id) ?? [],
      cost: cost.get(row.id) ?? [],
      fe: row.fe,
    }
    if (row.is_current === 1) current = run
    else done.push(run)
  }
  return { runs: done, current }
}

/** Puts a row in the map of the run it belongs to. */
function push(map: Map<number, [number, number][]>, runId: number, entry: [number, number]): void {
  const list = map.get(runId)
  if (list === undefined) map.set(runId, [entry])
  else list.push(entry)
}

/** Reads everything that was saved; null when the database holds nothing yet. */
function readTracker(db: Database): SavedTracker | null {
  const log = db.query('select file, offset from log_position where id = 1').get() as LogRow | null
  if (log === null) return null
  const runRows = db.query('select * from runs order by id').all() as RunRow[]
  const { runs, current } = readRuns(db, runRows)
  const settingRows = db.query('select key, value from settings').all() as SettingRow[]
  const settings = new Map(settingRows.map((row) => [row.key, row.value]))
  const slotRows = db.query('select * from slots').all() as SlotRow[]
  const instanceRows = db.query('select * from instances').all() as InstanceRow[]
  const priceRows = db.query('select * from prices').all() as PriceRow[]
  const overrideRows = db.query('select * from price_overrides').all() as PairRow[]
  const gearRows = db.query('select * from gear').all() as GearRow[]
  return {
    version: 1,
    log: { file: log.file, offset: log.offset },
    tracker: {
      version: STATE_VERSION,
      runs,
      current,
      slots: slotRows.map((row) => ({ key: row.key, item: row.item, num: row.num, uuid: row.uuid })),
      instances: instanceRows.map((row) => ({
        uuid: row.uuid,
        item: row.item,
        page: row.page,
        slot: row.slot,
        num: row.num,
      })),
      prices: priceRows.map((row) => [
        row.item,
        { price: row.price, samples: row.samples, listings: row.listings, at: row.seen_at },
      ]),
      overrides: overrideRows.map((row) => [row.item, row.price]),
      gear: gearRows.map((row) => [row.base, row.legendary]),
      nextRunId: settings.get('next_run_id') ?? 1,
      taxed: (settings.get('taxed') ?? 1) === 1,
      mapCosts: (settings.get('map_costs') ?? 0) === 1,
    },
  }
}

/* ---------- writing ---------- */

/** One run, as the diff sees it: the run, and whether it is the one going on. */
interface RunDiff {
  run: SavedRun
  isCurrent: boolean
}

/** The runs of a state, by their id. */
function runsById(tracker: SavedState): Map<number, RunDiff> {
  const byId = new Map<number, RunDiff>()
  for (const run of tracker.runs) byId.set(run.id, { run, isCurrent: false })
  if (tracker.current !== null) byId.set(tracker.current.id, { run: tracker.current, isCurrent: true })
  return byId
}

/** Whether two piles of items are the same, whatever order they were counted in. */
function sameItems(a: [number, number][], b: [number, number][]): boolean {
  if (a.length !== b.length) return false
  const key = (items: [number, number][]): string =>
    items.map(([item, qty]) => `${item}:${qty}`).sort().join('|')
  return key(a) === key(b)
}

/** Whether a run is the same as the one that was saved of it. */
function sameRun(a: SavedRun, b: SavedRun): boolean {
  return (
    (a.kind ?? 'map') === (b.kind ?? 'map') &&
    a.zone === b.zone &&
    a.name === b.name &&
    a.levelId === b.levelId &&
    a.start === b.start &&
    a.end === b.end &&
    a.fe === b.fe &&
    sameItems(a.loot, b.loot) &&
    sameItems(a.cost, b.cost)
  )
}

/** Writes a setting, when it changed. */
function setSetting(db: Database, key: string, value: number, before: number | undefined): void {
  if (before === value) return
  db.run('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value', [key, value])
}

/**
 * Writes what is saved, as the difference from what is there.
 *
 * A run that changed is written whole (its loot and its cost with it); a run that is no longer
 * there is deleted. Everything happens in one transaction, so a crash halfway through leaves the
 * last whole save in place. `before` null writes everything, which is what the first save and the
 * one-time import use.
 */
function writeTracker(db: Database, saved: SavedTracker, before: SavedTracker | null): void {
  const state = saved.tracker
  const write = db.transaction(() => {
    // where the tracker was in the log
    if (before?.log.file !== saved.log.file || before?.log.offset !== saved.log.offset) {
      db.run(
        'insert into log_position (id, file, offset) values (1, ?, ?) on conflict(id) do update set file = excluded.file, offset = excluded.offset',
        [saved.log.file, saved.log.offset],
      )
    }

    // the runs, and the one that is going on
    const old = before === null ? new Map<number, RunDiff>() : runsById(before.tracker)
    const now = runsById(state)
    for (const id of old.keys()) {
      if (!now.has(id)) db.run('delete from runs where id = ?', [id])
    }
    for (const [id, { run, isCurrent }] of now) {
      const was = old.get(id)
      if (was !== undefined && was.isCurrent === isCurrent && sameRun(was.run, run)) continue
      if (was !== undefined) db.run('delete from runs where id = ?', [id])
      db.run(
        'insert into runs (id, kind, zone, name, level_id, start_ms, end_ms, fe, is_current) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, run.kind ?? 'map', run.zone, run.name, run.levelId, run.start, run.end, run.fe, isCurrent ? 1 : 0],
      )
      for (const [item, qty] of run.loot) {
        db.run('insert into run_loot (run_id, item, qty) values (?, ?, ?)', [id, item, qty])
      }
      for (const [item, qty] of run.cost) {
        db.run('insert into run_cost (run_id, item, qty) values (?, ?, ?)', [id, item, qty])
      }
    }

    // the bag
    const oldSlots = new Map((before?.tracker.slots ?? []).map((slot) => [slot.key, slot]))
    for (const slot of state.slots) {
      const was = oldSlots.get(slot.key)
      oldSlots.delete(slot.key)
      if (was !== undefined && was.item === slot.item && was.num === slot.num && was.uuid === slot.uuid) continue
      db.run(
        'insert into slots (key, item, num, uuid) values (?, ?, ?, ?) on conflict(key) do update set item = excluded.item, num = excluded.num, uuid = excluded.uuid',
        [slot.key, slot.item, slot.num, slot.uuid],
      )
    }
    for (const key of oldSlots.keys()) db.run('delete from slots where key = ?', [key])

    const oldInstances = new Map((before?.tracker.instances ?? []).map((i) => [i.uuid, i]))
    for (const instance of state.instances) {
      const was = oldInstances.get(instance.uuid)
      oldInstances.delete(instance.uuid)
      if (
        was !== undefined &&
        was.item === instance.item &&
        was.page === instance.page &&
        was.slot === instance.slot &&
        was.num === instance.num
      ) {
        continue
      }
      db.run(
        'insert into instances (uuid, item, page, slot, num) values (?, ?, ?, ?, ?) on conflict(uuid) do update set item = excluded.item, page = excluded.page, slot = excluded.slot, num = excluded.num',
        [instance.uuid, instance.item, instance.page, instance.slot, instance.num],
      )
    }
    for (const uuid of oldInstances.keys()) db.run('delete from instances where uuid = ?', [uuid])

    // the prices
    const oldPrices = new Map((before?.tracker.prices ?? []).map(([item, info]) => [item, info]))
    for (const [item, info] of state.prices) {
      const old = oldPrices.get(item)
      oldPrices.delete(item)
      if (
        old !== undefined &&
        old.price === info.price &&
        old.samples === info.samples &&
        old.listings === info.listings &&
        old.at === info.at
      ) {
        continue
      }
      db.run(
        'insert into prices (item, price, samples, listings, seen_at) values (?, ?, ?, ?, ?) on conflict(item) do update set price = excluded.price, samples = excluded.samples, listings = excluded.listings, seen_at = excluded.seen_at',
        [item, info.price, info.samples, info.listings, info.at],
      )
    }
    for (const item of oldPrices.keys()) db.run('delete from prices where item = ?', [item])

    // the prices the player set
    const oldOverrides = new Map((before?.tracker.overrides ?? []).map(([item, price]) => [item, price]))
    for (const [item, price] of state.overrides) {
      const old = oldOverrides.get(item)
      oldOverrides.delete(item)
      if (old === price) continue
      db.run(
        'insert into price_overrides (item, price) values (?, ?) on conflict(item) do update set price = excluded.price',
        [item, price],
      )
    }
    for (const item of oldOverrides.keys()) db.run('delete from price_overrides where item = ?', [item])

    // the gear and its legendaries
    const oldGear = new Map((before?.tracker.gear ?? []).map(([base, legendary]) => [base, legendary]))
    for (const [base, legendary] of state.gear ?? []) {
      const old = oldGear.get(base)
      oldGear.delete(base)
      if (old === legendary) continue
      db.run(
        'insert into gear (base, legendary) values (?, ?) on conflict(base) do update set legendary = excluded.legendary',
        [base, legendary],
      )
    }
    for (const base of oldGear.keys()) db.run('delete from gear where base = ?', [base])

    // the settings
    setSetting(db, 'next_run_id', state.nextRunId, before?.tracker.nextRunId)
    setSetting(db, 'taxed', state.taxed ? 1 : 0, before === null ? undefined : before.tracker.taxed ? 1 : 0)
    setSetting(db, 'map_costs', state.mapCosts ? 1 : 0, before === null ? undefined : before.tracker.mapCosts ? 1 : 0)
  })
  write()
}

/* ---------- the old state file ---------- */

/** Reads the state the tracker kept in one JSON file; null when it is not one this code reads. */
function parseLegacyState(raw: string): SavedTracker | null {
  try {
    const saved = JSON.parse(raw) as SavedTracker
    if (saved?.version !== 1) return null
    const tracker = migrateState(saved.tracker)
    if (tracker === null) return null
    return { ...saved, tracker }
  } catch {
    return null
  }
}

/**
 * Brings the old state in: one write, then the file is renamed to `state.json.imported`.
 *
 * A state file that is truncated, corrupt or of a version this code does not know is left where
 * it is, and nothing is written: the same states the old loader turned away.
 */
async function importLegacyState(dbFile: string): Promise<SavedTracker | null> {
  const legacy = join(dirname(dbFile), LEGACY_STATE_FILE)
  let saved: SavedTracker | null = null
  try {
    saved = parseLegacyState(await readFile(legacy, 'utf8'))
  } catch {
    return null
  }
  if (saved === null) return null
  await mkdir(dirname(dbFile), { recursive: true })
  const db = openDb(dbFile, true)
  try {
    writeTracker(db, saved, null)
  } finally {
    db.close()
  }
  await rename(legacy, `${legacy}${IMPORTED_SUFFIX}`)
  return saved
}

/* ---------- the public face ---------- */

/**
 * Reads what was saved; null when there is nothing saved, or it cannot be read.
 *
 * When the database is not there yet and the old `state.json` is, that state is brought in (see
 * `importLegacyState`) and read back. Nothing is created on disk when there is nothing to read:
 * a dashboard that only looks does not leave a database behind.
 */
export async function loadTracker(path = dbPath()): Promise<SavedTracker | null> {
  if (!existsSync(path)) return importLegacyState(path)
  let db: Database
  try {
    db = openDb(path, false)
  } catch {
    return null
  }
  try {
    return readTracker(db)
  } catch {
    return null
  } finally {
    db.close()
  }
}

/**
 * Writes what is saved.
 *
 * Only what changed since the last save is written, in one transaction, so a crash halfway
 * through leaves the last whole save in place. A file that is not the tracker's database is moved
 * aside (to `<db>.corrupt`) rather than deleted; a database of a newer version of the tracker is
 * left entirely alone, and the write is refused.
 */
export async function saveTracker(saved: SavedTracker, path = dbPath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  let db = await openForSave(path)
  let written = false
  try {
    writeTracker(db, saved, readTracker(db))
    written = true
  } catch (e) {
    // a database that was broken between the saves is set aside below, like one that never was one
    if (!isUnusable(e)) throw e
  } finally {
    db.close()
  }
  if (written) return
  await rename(path, `${path}${CORRUPT_SUFFIX}`)
  db = await openForSave(path)
  try {
    writeTracker(db, saved, null)
  } finally {
    db.close()
  }
}

/**
 * Opens the database to write to it, moving aside a file that is not the tracker's database.
 *
 * The file that was moved aside is kept as `<db>.corrupt`; a database of a newer version of the
 * tracker is not one of those, and the error it raises is passed on untouched.
 */
async function openForSave(path: string): Promise<Database> {
  try {
    return openDb(path, true)
  } catch (e) {
    if (!(e instanceof NotTrackerDbError)) throw e
    await rename(path, `${path}${CORRUPT_SUFFIX}`)
    return openDb(path, true)
  }
}

/**
 * The runs the database holds, straight from its tables: the ones that were finished (the run
 * that is going on is not among them — `loadTracker` has it).
 *
 * `since` keeps only the runs that started at or after it, so "the runs of today" is one call
 * with the local midnight. Null when there is no database to read.
 */
export function queryRuns(path = dbPath(), since?: number): SavedRun[] | null {
  return withDb(path, (db) => {
    const rows =
      since === undefined
        ? (db.query('select * from runs order by id').all() as RunRow[])
        : (db.query('select * from runs where start_ms >= ? order by id').all(since) as RunRow[])
    return readRuns(db, rows).runs
  })
}

/** The totals a dashboard can draw without reading every run. Null when there is no database. */
export function queryTotals(
  path = dbPath(),
): { runs: number; fe: number; firstAt: number | null; lastAt: number | null } | null {
  return withDb(path, (db) => {
    const row = db.query('select count(*) as runs, coalesce(sum(fe), 0) as fe, min(start_ms) as first, max(start_ms) as last from runs').get() as {
      runs: number
      fe: number
      first: number | null
      last: number | null
    }
    return { runs: row.runs, fe: row.fe, firstAt: row.first, lastAt: row.last }
  })
}

/** Opens the database for a look; null when there is none, or it cannot be read. */
function withDb<T>(path: string, look: (db: Database) => T): T | null {
  if (!existsSync(path)) return null
  let db: Database
  try {
    db = openDb(path, false)
  } catch {
    return null
  }
  try {
    return look(db)
  } catch {
    return null
  } finally {
    db.close()
  }
}
