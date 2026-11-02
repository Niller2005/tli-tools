// The life of a saved state's database file.
//
// Every tool that saves itself — the loot tracker, the Arcana tracker — keeps its state in one
// SQLite database, and the life of that file is the same for both: opening it, bringing its
// schema up to date, refusing one a newer version wrote, setting a file that is not a usable
// database aside, and bringing the old `state.json` in once. This module owns that life; a tool
// is an adapter over it (`StoreSpec`): its schema's migrations, the mapping between its saved
// state and its tables' rows, and how the state file it kept before the database is read.
//
// Nothing here knows any tool's tables: the adapter reads and writes them. The contract the file
// follows either way is `tests/contract.ts`, run against every adapter.
//
// The database can be looked at while the tool runs (it is in WAL mode, so a reader never gets in
// the writer's way), and a save writes only what the adapter's `write` finds changed, in one
// transaction, so a crash halfway through leaves the last whole save in place.

import { mkdir, readFile, rename, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { Database, SQLiteError } from 'bun:sqlite'

/** The directory a tool keeps its files in: `$XDG_DATA_HOME/<tool>`, or `~/.local/share/<tool>`. */
export function dataDir(tool: string): string {
  const xdg = process.env.XDG_DATA_HOME
  if (xdg !== undefined && xdg !== '') return join(xdg, tool)
  return join(process.env.HOME ?? '.', '.local', 'share', tool)
}

/** What one tool's saved state is, and how the rows of its database map to it. */
export interface StoreSpec<S> {
  /** the tool's name, as the messages about its database say it: 'the tracker' */
  tool: string
  /** the tool's data directory, the folder under the data home: 'tli-tracker' */
  dir: string
  /** the database's file name in it: 'tracker.db' */
  dbFile: string
  /**
   * The schema, one entry per version: the entry `n` turns a database of version `n` into one of
   * version `n + 1`. The version is the database's own `user_version`.
   */
  migrations: string[]
  /** reads the state the tool kept in one JSON file, before there was a database; null when it is not one this code reads */
  parseLegacyState(raw: string): S | null
  /** reads everything that was saved; null when the database holds nothing yet */
  read(db: Database): S | null
  /** writes what is saved, as the difference from what is there */
  write(db: Database, saved: S, before: S | null): void
}

/** The life of one tool's database file: where it is, and how it is read and written. */
export interface Store<S> {
  /** where the tool's database is, in its data directory */
  readonly dbPath: string
  /**
   * Reads what was saved; null when there is nothing saved, or it cannot be read.
   *
   * When the database is not there yet and the old `state.json` is, that state is brought in (see
   * `importLegacyState`) and read back. Nothing is created on disk when there is nothing to read:
   * a dashboard that only looks does not leave a database behind.
   */
  load(path?: string): Promise<S | null>
  /**
   * Writes what is saved.
   *
   * A file that is not the tool's database is moved aside (to `<db>.corrupt`) rather than deleted;
   * a database of a newer schema is left entirely alone, and the write is refused.
   */
  save(saved: S, path?: string): Promise<void>
  /** Opens the database for a look; null when there is none, or it cannot be read. */
  look<T>(path: string, look: (db: Database) => T): T | null
}

/** Defines a tool's store: the life of its database file around its row mapping. */
export function defineStore<S>(spec: StoreSpec<S>): Store<S> {
  const where = (): string => join(dataDir(spec.dir), spec.dbFile)
  return {
    get dbPath(): string {
      return where()
    },
    async load(path = where()): Promise<S | null> {
      if (!existsSync(path)) return importLegacyState(spec, path)
      let db: Database
      try {
        db = openDb(spec, path, false)
      } catch {
        return null
      }
      try {
        return spec.read(db)
      } catch {
        return null
      } finally {
        db.close()
      }
    },
    async save(saved: S, path = where()): Promise<void> {
      await mkdir(dirname(path), { recursive: true })
      let db = await openForSave(spec, path)
      let written = false
      try {
        spec.write(db, saved, spec.read(db))
        written = true
      } catch (e) {
        // a database that was broken between the saves is set aside below, like one that never was one
        if (!isUnusable(e)) throw e
      } finally {
        db.close()
      }
      if (written) return
      await rename(path, `${path}${CORRUPT_SUFFIX}`)
      db = await openForSave(spec, path)
      try {
        spec.write(db, saved, null)
      } finally {
        db.close()
      }
    },
    look<T>(path: string, look: (db: Database) => T): T | null {
      if (!existsSync(path)) return null
      let db: Database
      try {
        db = openDb(spec, path, false)
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
    },
  }
}

/* ---------- the file ---------- */

/** The file the tool kept its state in before there was a database; read once, then renamed. */
const LEGACY_STATE_FILE = 'state.json'

/** What the old state file is renamed to once it was brought in: kept as a backup, never deleted. */
const IMPORTED_SUFFIX = '.imported'

/** What a file that is not a usable database is moved aside to. */
const CORRUPT_SUFFIX = '.corrupt'

/** The database was written by a newer version of the code: it is left alone, nothing is written. */
class FutureSchemaError extends Error {}

/** The file is there but it is not the tool's database: it is corrupt, or another tool's. */
class NotDatabaseError extends Error {}

/** Whether the error says the file is not a usable database: not one at all, or broken inside. */
function isUnusable(e: unknown): boolean {
  return e instanceof SQLiteError && (e.code === 'SQLITE_NOTADB' || e.code === 'SQLITE_CORRUPT')
}

/**
 * Opens the database and brings its schema up to date; the caller closes it.
 *
 * A file that is not the tool's database (corrupt, or another tool's tables) and a database of a
 * newer schema are both refused: the one by `NotDatabaseError`, so the caller can move it aside,
 * the other by `FutureSchemaError`, so the caller leaves it alone.
 */
function openDb<S>(spec: StoreSpec<S>, path: string, create: boolean): Database {
  const db = create ? new Database(path) : new Database(path, { create: false })
  try {
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA foreign_keys = ON')
    db.exec('PRAGMA busy_timeout = 5000')
    // the rows sqlite gives back are untyped; these are the tool's own tables
    const versionRow = db.query('PRAGMA user_version').get() as { user_version: number }
    const version = versionRow.user_version
    const max = spec.migrations.length
    if (version > max) {
      throw new FutureSchemaError(`${spec.tool}'s database is of schema version ${version}; this code knows up to ${max}`)
    }
    if (version === 0) {
      const countRow = db.query("select count(*) as n from sqlite_master where type = 'table' and name not like 'sqlite_%'").get() as { n: number }
      if (countRow.n > 0) throw new NotDatabaseError(`${path} has tables ${spec.tool} does not know`)
    }
    for (let from = version; from < max; from += 1) {
      const apply = db.transaction(() => {
        db.exec(spec.migrations[from])
        db.exec(`PRAGMA user_version = ${from + 1}`)
      })
      apply()
    }
    return db
  } catch (e) {
    db.close()
    if (e instanceof NotDatabaseError || e instanceof FutureSchemaError) throw e
    if (isUnusable(e)) throw new NotDatabaseError(`${path} is not ${spec.tool}'s database: ${(e as Error).message}`)
    throw e
  }
}

/**
 * Opens the database to write to it, moving aside a file that is not the tool's database.
 *
 * The file that was moved aside is kept as `<db>.corrupt`; a database of a newer schema is not one
 * of those, and the error it raises is passed on untouched.
 */
async function openForSave<S>(spec: StoreSpec<S>, path: string): Promise<Database> {
  try {
    return openDb(spec, path, true)
  } catch (e) {
    if (!(e instanceof NotDatabaseError)) throw e
    await rename(path, `${path}${CORRUPT_SUFFIX}`)
    return openDb(spec, path, true)
  }
}

/**
 * Brings the old state in: one write, then the file is renamed to `state.json.imported`.
 *
 * A state file that is truncated, corrupt or of a version this code does not know is left where
 * it is, and nothing is written: the same states the old loader turned away. A write that fails
 * halfway takes the half-made database with it, so the state file stays as it was for the next
 * attempt.
 */
async function importLegacyState<S>(spec: StoreSpec<S>, path: string): Promise<S | null> {
  const legacy = join(dirname(path), LEGACY_STATE_FILE)
  let saved: S | null = null
  try {
    saved = spec.parseLegacyState(await readFile(legacy, 'utf8'))
  } catch {
    return null
  }
  if (saved === null) return null
  await mkdir(dirname(path), { recursive: true })
  const db = openDb(spec, path, true)
  let read: S | null = null
  let failed = false
  try {
    spec.write(db, saved, null)
    read = spec.read(db)
  } catch {
    failed = true
  } finally {
    db.close()
  }
  if (failed) {
    // nothing of it was written; the database this attempt made is empty, so it goes and the
    // state file stays, as it was, for the next attempt
    await rm(path, { force: true })
    await rm(`${path}-wal`, { force: true })
    await rm(`${path}-shm`, { force: true })
    return null
  }
  if (read === null) return null
  await rename(legacy, `${legacy}${IMPORTED_SUFFIX}`)
  return read
}
