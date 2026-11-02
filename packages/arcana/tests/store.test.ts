// The store: the SQLite database the tracker saves itself in, the way it takes over the old
// `state.json`, and the way it writes only what changed.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'

import { SCHEMA_VERSION, Tracker, emptyHistory, loadArcana, saveArcana, type SavedArcana } from '../src/index'

import { arcanaStatus } from '../src/status'
import { expectSameSaved, ms, theRest, trackerPartway } from './helpers'

/* ---------- the states the tests save ---------- */

/** What a saved tracker looks like on the inside, straight from its tables. */
function look<T>(path: string, sql: string): T[] {
  const db = new Database(path, { readonly: true })
  try {
    return db.query(sql).all() as T[]
  } finally {
    db.close()
  }
}

/* ---------- the tests ---------- */

describe('the store', () => {
  let dir = ''
  const xdg = process.env.XDG_DATA_HOME
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arcana-store-'))
    process.env.XDG_DATA_HOME = dir
  })
  afterAll(() => {
    if (xdg === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = xdg
    rmSync(dir, { recursive: true, force: true })
  })

  test('the schema: everything the tracker knows has a table, and the version is user_version', async () => {
    const tracker = trackerPartway()
    tracker.feed(theRest())
    const path = join(dir, 'schema', 'arcana.db')
    await saveArcana({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 1234 }, history: tracker.state, snapshot: tracker.snapshot() }, path)

    expect(look(path, 'PRAGMA user_version')).toEqual([{ user_version: SCHEMA_VERSION }])
    expect(look(path, 'PRAGMA journal_mode')).toEqual([{ journal_mode: 'wal' }])
    const tables = look<{ name: string }>(path, "select name from sqlite_master where type = 'table' order by name").map((row) => row.name)
    expect(tables).toEqual([
      'cells',
      'chests',
      'contest_chests',
      'contests',
      'instances',
      'log_position',
      'moves',
      'price_overrides',
      'prices',
      'rewards',
      'settings',
      'slots',
      'trials',
      'visits',
    ])
    expect(look(path, 'select count(*) as n from visits')).toEqual([{ n: 2 }])
    expect(look(path, 'select count(*) as n from moves')).toEqual([{ n: 5 }])
    expect(look(path, 'select count(*) as n from cells')).toEqual([{ n: 3 }])
    expect(look(path, 'select count(*) as n from chests')).toEqual([{ n: 2 }])
    expect(look(path, 'select count(*) as n from trials')).toEqual([{ n: 1 }])
    expect(look(path, 'select file, offset from log_position')).toEqual([{ file: 'UE_game.log', offset: 1234 }])
    expect(look(path, "select value from settings where key = 'next_id'")).toEqual([{ value: 3 }])
    // one move, as sqlite3 shows it: the steps as the game named them, and the chest it took
    expect(look(path, 'select steps, chest_slot, chest_rarity, chest_upgrades from moves where visit_id = 1 and ord = 0')).toEqual([
      { steps: '["CardDraw","MoveTo"]', chest_slot: 71366, chest_rarity: 'Blue', chest_upgrades: 1 },
    ])
    expect(look(path, 'select cell_id, kind, rarity from cells where visit_id = 2 and move_ord = 0')).toEqual([
      { cell_id: 71384, kind: 'trap', rarity: null },
    ])
  })

  test('the second save writes only what changed: the visit that was over is not written again', async () => {
    const tracker = trackerPartway()
    const path = join(dir, 'incremental', 'arcana.db')
    await saveArcana({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 100 }, history: tracker.state, snapshot: tracker.snapshot() }, path)

    // where the rows of the finished visit and the unnamed trial sit
    const moveRowids = look<{ rowid: number }>(path, 'select rowid from moves where visit_id = 1 order by rowid').map((row) => row.rowid)
    const chestRowids = look<{ rowid: number }>(path, 'select rowid from chests where visit_id = 1 order by rowid').map((row) => row.rowid)
    const trialIds = look<{ id: number }>(path, 'select id from trials order by id').map((row) => row.id)
    expect(moveRowids).toHaveLength(2)
    expect(trialIds).toEqual([1])

    // the rest of it: the trial is named, the open visit moves and takes a chest that is raised,
    // and the contest's second chest is opened and the fight ends
    tracker.feed(theRest())
    await saveArcana({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 200 }, history: tracker.state, snapshot: tracker.snapshot() }, path)

    expectSameSaved(await loadArcana(path), { version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 200 }, history: tracker.state, snapshot: tracker.snapshot() })
    // the finished visit was not written again, and neither was the trial's place
    expect(look<{ rowid: number }>(path, 'select rowid from moves where visit_id = 1 order by rowid').map((row) => row.rowid)).toEqual(moveRowids)
    expect(look<{ rowid: number }>(path, 'select rowid from chests where visit_id = 1 order by rowid').map((row) => row.rowid)).toEqual(chestRowids)
    expect(look<{ id: number; arcana: string }>(path, 'select id, arcana from trials')).toEqual([{ id: 1, arcana: 'TheHangedMan' }])
    // the open visit grew, and what it gained was appended after what was there
    const grown = look<{ rowid: number }>(path, 'select rowid from moves order by rowid').map((row) => row.rowid)
    expect(grown.slice(0, moveRowids.length)).toEqual(moveRowids)
    expect(grown.length).toBe(5)
    // the raised chest is raised in both places the tracker keeps it
    expect(look(path, 'select upgrades from chests where visit_id = 2')).toEqual([{ upgrades: 1 }])
    expect(look(path, 'select chest_upgrades from moves where visit_id = 2 and ord = 1')).toEqual([{ chest_upgrades: 1 }])
  })

  test('a save with nothing in it forgets everything: the reset', async () => {
    const tracker = trackerPartway()
    const path = join(dir, 'reset', 'arcana.db')
    await saveArcana({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 0 }, history: tracker.state, snapshot: tracker.snapshot() }, path)
    await saveArcana({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 50 }, history: emptyHistory(), snapshot: new Tracker().snapshot() }, path)

    const saved = await loadArcana(path)
    expect(saved?.history).toEqual(emptyHistory())
    expect(look(path, 'select count(*) as n from visits')).toEqual([{ n: 0 }])
    expect(look(path, "select value from settings where key = 'next_id'")).toEqual([{ value: 1 }])
  })
})

describe('the old state file', () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arcana-import-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('a fuller state, replayed by the package itself, is brought in whole', async () => {
    const tracker = trackerPartway()
    tracker.feed(theRest())
    // the JSON the old tracker would have written for what this one replayed
    const legacy = JSON.parse(
      JSON.stringify({ version: 2, log: { file: 'UE_game.log', offset: 9999 }, history: tracker.state, snapshot: tracker.snapshot() }),
    ) as SavedArcana
    const home = join(dir, 'fuller')
    mkdirSync(home, { recursive: true })
    const db = join(home, 'arcana.db')
    writeFileSync(join(home, 'state.json'), `${JSON.stringify(legacy)}\n`)

    const saved = await loadArcana(db)
    expectSameSaved(saved, { ...legacy, version: SCHEMA_VERSION })
    if (saved === null) throw new Error('not imported')
    // what was brought in carries on, the way the JSON state did
    const again = new Tracker(saved.history)
    again.restore(saved.snapshot)
    expect(again.state.sessions[0].chests[0]?.upgrades).toBe(1)
    expect(again.state.trials).toEqual([{ at: ms('01.31.37:582'), arcana: 'TheHangedMan' }])
    expect(again.state.contests[0].chests[1]?.rewards).toEqual([{ item: 100300, qty: 3 }])
  })
})

describe('the database and the JSON state say the same', () => {
  test('a replay saved and read back is the replay, the way the JSON state was', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arcana-equal-'))
    try {
      // what the tracker knows after a whole replay
      const straight = trackerPartway()
      straight.feed(theRest())

      // the JSON path: what the old store wrote and read back
      const asJson = JSON.parse(
        JSON.stringify({ version: 2, log: { file: 'UE_game.log', offset: 10 }, history: straight.state, snapshot: straight.snapshot() }),
      ) as SavedArcana
      // the database path
      const path = join(dir, 'arcana.db')
      await saveArcana({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 10 }, history: straight.state, snapshot: straight.snapshot() }, path)
      const fromDb = await loadArcana(path)
      if (fromDb === null) throw new Error('not saved')

      const byJson = new Tracker(asJson.history)
      const byDb = new Tracker(fromDb.history)
      expect(byDb.state).toEqual(byJson.state)
      expect(arcanaStatus(byDb.state)).toEqual(arcanaStatus(byJson.state))
      expect(arcanaStatus(byDb.state)).toEqual(arcanaStatus(straight.state))
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
