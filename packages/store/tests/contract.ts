// The contract every tool's saved state keeps with its database file.
//
// Both tools that save themselves — the loot tracker (`@tli/tracker`) and the Arcana tracker
// (`@tli/arcana`) — keep their state in one SQLite database, and the life of that file is one
// module's (`@tli/store`): opening it, bringing its schema up to date, refusing a newer one,
// setting a bad one aside, and bringing the old `state.json` in once. This suite says the file is
// kept the same way for both: it is run once per tool (see the `*-store.test.ts` files beside it),
// with the tool supplying its own saved state, its comparisons, and the shape of what its own
// earlier versions left on disk.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { Database } from 'bun:sqlite'

/** One tool's store, from the outside, so the same suite can be run against both of them. */
export interface StoreContract<S> {
  /** the tool's name, in the tests' names */
  name: string
  /** the schema version this code writes and reads */
  schemaVersion: number
  /** reads what was saved; null when there is nothing saved, or it cannot be read */
  load(path: string): Promise<S | null>
  /** writes what is saved */
  save(saved: S, path: string): Promise<void>
  /** a saved state with something of everything the tool keeps */
  full: S
  /** says a state that was read back is the one wanted, whatever order its lists came back in */
  expectSame(loaded: S | null, wanted: S): void
  /** the old `state.json`, as the tool before the database wrote it */
  legacy: string
  /** says what the legacy import gave back is what the old state held */
  expectImported(loaded: S | null): void
  /** state files that must be refused: left where they are, with nothing written */
  refused: string[]
  /**
   * Writes a database file of an older schema version to `path`, with rows in it, as that
   * version's code left it; called once per version before the current one.
   */
  writeOldFile(path: string, version: number): void
  /** says what was read from a file of an older schema version is what that version held */
  expectOld(loaded: S | null, version: number): void
}

/** Runs the contract suite; called from the entry files, one per tool. */
export function theStoreContract<S>(contract: StoreContract<S>): void {
  describe(`the file ${contract.name} keeps its saved state in`, () => {
    let root = ''
    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'tli-store-contract-'))
    })
    afterAll(() => rmSync(root, { recursive: true, force: true }))

    /** A database path of the test's own, in a folder nothing else writes to. */
    const own = (name: string): string => join(root, name, 'saved.db')

    test('nothing on disk is nothing saved, and nothing is made of it', async () => {
      const path = own('nothing')
      expect(await contract.load(path)).toBeNull()
      expect(existsSync(path)).toBe(false)
    })

    for (let version = 1; version < contract.schemaVersion; version += 1) {
      test(`a database of schema version ${version} is carried to this one with what it held`, async () => {
        const path = own(`old-v${version}`)
        mkdirSync(dirname(path), { recursive: true })
        contract.writeOldFile(path, version)

        const loaded = await contract.load(path)
        contract.expectOld(loaded, version)
        // it can be written to, and what it held is still there
        if (loaded === null) throw new Error('nothing was loaded')
        await contract.save(loaded, path)
        contract.expectSame(await contract.load(path), loaded)
        const db = new Database(path, { readonly: true })
        expect((db.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(contract.schemaVersion)
        db.close()
      })
    }

    test('a file that is not a database reads as nothing, and the next save starts a fresh one beside it', async () => {
      const path = own('corrupt')
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, 'this is not a database')
      expect(await contract.load(path)).toBeNull()

      await contract.save(contract.full, path)
      contract.expectSame(await contract.load(path), contract.full)
      // the broken file is kept, never deleted
      expect(readFileSync(`${path}.corrupt`, 'utf8')).toBe('this is not a database')
    })

    test('a database of a newer schema is left alone, and nothing is written to it', async () => {
      const path = own('future')
      mkdirSync(dirname(path), { recursive: true })
      const db = new Database(path)
      db.exec(`PRAGMA user_version = ${contract.schemaVersion + 1}`)
      db.close()

      expect(await contract.load(path)).toBeNull()
      await expect(contract.save(contract.full, path)).rejects.toThrow()
      const check = new Database(path)
      expect((check.query('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(contract.schemaVersion + 1)
      check.close()
      expect(existsSync(`${path}.corrupt`)).toBe(false)
    })

    test('the old state file is brought in once, and kept as a backup', async () => {
      const path = own('legacy')
      const dir = dirname(path)
      mkdirSync(dir, { recursive: true })
      writeFileSync(join(dir, 'state.json'), contract.legacy)

      const loaded = await contract.load(path)
      contract.expectImported(loaded)
      expect(existsSync(join(dir, 'state.json'))).toBe(false)
      expect(readFileSync(join(dir, 'state.json.imported'), 'utf8')).toBe(contract.legacy)
      // the second read is the database's, and the backup is never touched again
      contract.expectImported(await contract.load(path))
      expect(readFileSync(join(dir, 'state.json.imported'), 'utf8')).toBe(contract.legacy)
    })

    test('a state file that cannot be used is left where it is, and nothing is written', async () => {
      for (const [i, contents] of contract.refused.entries()) {
        const path = own(`refused-${i}`)
        const dir = dirname(path)
        mkdirSync(dir, { recursive: true })
        writeFileSync(join(dir, 'state.json'), contents)
        expect(await contract.load(path)).toBeNull()
        expect(existsSync(path)).toBe(false) // no database was made
        expect(existsSync(join(dir, 'state.json'))).toBe(true) // the old file was left alone
        expect(existsSync(join(dir, 'state.json.imported'))).toBe(false)
      }
    })

    test('a save with nothing changed writes nothing', async () => {
      const path = own('no-change')
      await contract.save(contract.full, path)
      contract.expectSame(await contract.load(path), contract.full)
      const before = fingerprint(path)

      await contract.save(contract.full, path)
      expect(fingerprint(path)).toBe(before)

      // and a watcher that only reads sees no write either
      const watch = new Database(path)
      const seen = dataVersion(watch)
      await contract.save(contract.full, path)
      expect(dataVersion(watch)).toBe(seen)
      watch.close()
    })
  })
}

/** The bytes of the database, as a fingerprint of what was written to it. */
function fingerprint(path: string): string {
  return new Bun.CryptoHasher('sha256').update(readFileSync(path)).digest('hex')
}

/** What the database says its own data version is: it moves only when something is written. */
function dataVersion(db: Database): number {
  return (db.query('PRAGMA data_version').get() as { data_version: number }).data_version
}
