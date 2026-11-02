// The contract suite, run against the loot tracker's store.
//
// The states and the comparisons come from the tracker's own test fixtures; the old database and
// the old `state.json` are what the tracker's first schema and its JSON predecessor wrote. The
// suite itself is `contract.ts`, shared with the Arcana tracker's store.

import { describe, expect } from 'bun:test'
import { Database } from 'bun:sqlite'

import { SCHEMA_VERSION, STATE_VERSION, loadTracker, migrateState, saveTracker, type SavedState, type SavedTracker } from '@tli/tracker'

import { around, expectState, richState } from '../../tracker/tests/fixtures'
import { theStoreContract } from './contract'

/** The state the old `state.json` kept: one run of the first version's shape. */
const legacyState = {
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

/** A saved state that differs from the full one in what it keeps: the next save has something to do. */
function changedState(): SavedTracker {
  const state = richState()
  state.runs[1]!.fe = 43
  state.runs.pop() // the prison visit is gone
  state.prices.push([4001, { price: 3, samples: 1, listings: 4, at: 6000 }])
  state.slots = state.slots.filter((slot) => slot.key !== '102:5')
  state.overrides = [[3010, 25]]
  state.gear?.push([3020, 112152])
  state.taxed = true
  return around(state, 43)
}

/** Writes a database of the tracker's first schema, with rows in it, as that version left it. */
function writeFirstSchema(path: string): void {
  const old = new Database(path)
  old.exec(`
    create table log_position (id integer primary key check (id = 1), file text not null, offset integer not null);
    create table runs (id integer primary key, kind text not null, zone text not null, name text not null, level_id integer not null, start_ms integer not null, end_ms integer, fe integer not null, is_current integer not null default 0 check (is_current in (0, 1)));
    create table run_loot (run_id integer not null references runs(id) on delete cascade, item integer not null, qty integer not null, primary key (run_id, item));
    create table run_cost (run_id integer not null references runs(id) on delete cascade, item integer not null, qty integer not null, primary key (run_id, item));
    create table slots (key text primary key, item integer not null, num integer not null, uuid text);
    create table instances (uuid text primary key, item integer not null, page integer not null, slot integer not null, num integer not null);
    create table prices (item integer primary key, price real not null, samples integer not null, listings integer not null, seen_at integer not null);
    create table price_overrides (item integer primary key, price real not null);
    create table gear (base integer primary key, legendary integer not null);
    create table settings (key text primary key, value integer not null);
    insert into log_position values (1, '/tmp/UE_game.log', 99);
    insert into runs values (7, 'map', 'z', 'Glacial Abyss', 4708, 1000, 9000, 3, 0);
    insert into runs values (8, 'prison', 'p', 'Tartarus Prison', 5, 20000, null, 0, 1);
    insert into run_loot values (7, 100200, 5);
    insert into run_cost values (7, 100300, 2);
    insert into slots values ('102:5', 100200, 30, null);
    insert into instances values ('a', 260105, 1, 23, 1);
    insert into prices values (3010, 12.5, 2, 10, 5000);
    insert into settings values ('next_run_id', 9);
    insert into settings values ('taxed', 0);
    pragma user_version = 1;
  `)
  old.close()
}

describe('the tracker store', () => {
  theStoreContract<SavedTracker>({
    name: 'the loot tracker',
    schemaVersion: SCHEMA_VERSION,
    load: loadTracker,
    save: saveTracker,
    full: around(richState()),
    changed: changedState(),
    expectSame: (loaded, wanted) => expectState(loaded, wanted.tracker),
    legacy: JSON.stringify({ version: 1, log: { file: '/tmp/UE_game.log', offset: 7 }, tracker: legacyState }),
    expectImported: (loaded) => {
      expect(loaded?.tracker.version).toBe(STATE_VERSION)
      expect(loaded?.tracker.runs[0]?.kind).toBe('map')
      expect(loaded?.tracker.runs[0]?.loot).toEqual([[100200, 5]])
      expect(loaded?.log.offset).toBe(7)
      expectState(loaded, migrateState(legacyState) as SavedState)
    },
    refused: [
      '{"version":1,"log":{"file":"/l","offset":1},"tracker":{"version"', // truncated
      'not json at all',
      JSON.stringify({ version: 2, log: { file: '/l', offset: 1 }, tracker: richState() }), // a wrapper this code does not know
      JSON.stringify({ version: 1, log: { file: '/l', offset: 1 }, tracker: { ...richState(), version: 99 } }), // a state this code does not know
    ],
    writeOldFile: (path, version) => {
      if (version !== 1) throw new Error(`no fixture for schema version ${version}`)
      writeFirstSchema(path)
    },
    expectOld: (loaded, version) => {
      if (version !== 1) throw new Error(`no fixture for schema version ${version}`)
      expect(loaded?.log.offset).toBe(99)
      const state = loaded?.tracker
      expect(state?.character).toBe('')
      expect(state?.runs.map((run) => run.id)).toEqual([7])
      expect(state?.runs[0]).toMatchObject({ kind: 'map', fe: 3, xp: 0, affixes: [], session: 0, loot: [[100200, 5]], cost: [[100300, 2]] })
      expect(state?.current).toMatchObject({ id: 8, kind: 'prison', end: null })
      expect(state?.slots).toEqual([{ key: '102:5', item: 100200, num: 30, uuid: null }])
      expect(state?.instances).toHaveLength(1)
      expect(state?.prices).toEqual([[3010, { price: 12.5, samples: 2, listings: 10, at: 5000 }]])
      expect(state?.nextRunId).toBe(9)
      expect(state?.taxed).toBe(false)
    },
  })
})
