// The store: the SQLite database the tracker saves itself in, the way it takes over the old
// `state.json`, and the way it writes only what changed.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Database } from 'bun:sqlite'

import { SCHEMA_VERSION, Tracker, emptyHistory, load, save, type Saved, type Snapshot } from '../src/index'

import { arcanaStatus } from '../src/status'
import { FE_UUID, GOLD_UUID, T, add, chestMove, game, level, ms, pick, sound, trapMove, update } from './helpers'

/* ---------- the states the tests save ---------- */

/** One move that raises the rarity of the chest the visit before it took. */
function upgradeMove(): string[] {
  return [
    game('01.33.00:000', 'S9Taro HandleOrderAni Start Step=1 Type=CardDraw'),
    game('01.33.00:100', '71366_S9Reward Anim_Taro_RewardUpgrade Start'),
    game('01.33.00:900', 'S9Taro HandleOrderAni All done'),
  ]
}

/** A tracker that has seen a whole visit, an unnamed trial, a visit that is still going on and a
 * Fateful Contest with one chest opened and rewarded: everything the store keeps, while there is
 * still something open, so the next save has something to do. */
function trackerPartway(): Tracker {
  const t = new Tracker()
  t.feed([
    // the bag, so a chest's loot is measured against what was already there
    update('01.00.00:000', 100300, FE_UUID, 5, 0),
    add('01.00.00:001', 100200, GOLD_UUID, 1, 102, 10),
    game(T.open, 'S9Taro Run'),
    ...chestMove(),
    ...upgradeMove(),
    game(T.hide, 'S9Taro Hide'),
    // a trial that has shown itself but not told its story yet
    sound('01.31.37:582', 'Play_Obj_S9_SMTL_KaPai_Turn_Slow'),
    // a second visit, still going on
    game('02.00.00:000', 'S9Taro Run'),
    ...trapMove(),
    // the Fateful Contest, with one chest opened and its rewards picked up
    game('02.35.07:875', 'Start Fateful Contest with collected Chests of Destiny?\\n'),
    level('02.35.10:000', 19),
    sound('02.35.25:933', 'Play_Obj_S9_SMTL_BaoXiang_Open_01'),
    ...pick('02.35.26:100', 100200, GOLD_UUID, 16, 1),
  ])
  return t
}

/** What the tracker saw after the rest of it: the trial named, the visit moved on and took a
 * chest, the contest's second chest opened and the fight ended. */
function theRest(): string[] {
  return [
    sound('01.31.38:296', 'Play_VO_Story_S9_3_11_TheHangedMan'),
    ...chestMove(),
    ...upgradeMove(),
    sound('02.35.31:964', 'Play_Obj_S9_SMTL_BaoXiang_Open_01'),
    ...pick('02.35.32:100', 100300, FE_UUID, 8, 0),
    level('02.41.55:700', 3),
  ]
}

/** Two saved states, compared the way the store keeps them: the history exactly, the bag and the
 * prices by what is in them rather than by the order the tables give them back in. */
function expectSameSaved(read: Saved | null, wanted: Saved): void {
  expect(read).not.toBeNull()
  if (read === null) throw new Error('nothing was saved')
  expect(read.version).toBe(wanted.version)
  expect(read.log).toEqual(wanted.log)
  expect(read.history).toEqual(wanted.history)
  const orderless = (snapshot: Snapshot) => ({
    bag: {
      slots: [...snapshot.bag.slots].sort((a, b) => (a.key < b.key ? -1 : 1)),
      instances: [...snapshot.bag.instances].sort((a, b) => (a.uuid < b.uuid ? -1 : 1)),
    },
    prices: [...snapshot.prices].sort(([a], [b]) => a - b),
    overrides: [...snapshot.overrides].sort(([a], [b]) => a - b),
  })
  expect(orderless(read.snapshot)).toEqual(orderless(wanted.snapshot))
}

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
    await save({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 1234 }, history: tracker.state, snapshot: tracker.snapshot() }, path)

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

  test('what is saved is read back, and saving it again changes nothing', async () => {
    const tracker = trackerPartway()
    tracker.feed(theRest())
    const wanted: Saved = { version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 4321 }, history: tracker.state, snapshot: tracker.snapshot() }
    const path = join(dir, 'reopen', 'arcana.db')
    await save(wanted, path)
    expectSameSaved(await load(path), wanted)
    await save(wanted, path)
    expectSameSaved(await load(path), wanted)
  })

  test('the second save writes only what changed: the visit that was over is not written again', async () => {
    const tracker = trackerPartway()
    const path = join(dir, 'incremental', 'arcana.db')
    await save({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 100 }, history: tracker.state, snapshot: tracker.snapshot() }, path)

    // where the rows of the finished visit and the unnamed trial sit
    const moveRowids = look<{ rowid: number }>(path, 'select rowid from moves where visit_id = 1 order by rowid').map((row) => row.rowid)
    const chestRowids = look<{ rowid: number }>(path, 'select rowid from chests where visit_id = 1 order by rowid').map((row) => row.rowid)
    const trialIds = look<{ id: number }>(path, 'select id from trials order by id').map((row) => row.id)
    expect(moveRowids).toHaveLength(2)
    expect(trialIds).toEqual([1])

    // the rest of it: the trial is named, the open visit moves and takes a chest that is raised,
    // and the contest's second chest is opened and the fight ends
    tracker.feed(theRest())
    await save({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 200 }, history: tracker.state, snapshot: tracker.snapshot() }, path)

    expectSameSaved(await load(path), { version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 200 }, history: tracker.state, snapshot: tracker.snapshot() })
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
    await save({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 0 }, history: tracker.state, snapshot: tracker.snapshot() }, path)
    await save({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 50 }, history: emptyHistory(), snapshot: new Tracker().snapshot() }, path)

    const saved = await load(path)
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

  test('the state.json of the JSON tracker is brought in once, and kept as a backup', async () => {
    // the shape of the file the JSON tracker wrote: here the one of a first run that never saw
    // the board, which is what a real `state.json` looks like before any visit was played
    const state = `${JSON.stringify({
      version: 2,
      log: { file: '/game/UE_game.log', offset: 4096 },
      history: { sessions: [], contests: [], trials: [], nextId: 1 },
      snapshot: { bag: { slots: [], instances: [] }, prices: [], overrides: [] },
    })}\n`
    const home = join(dir, 'empty')
    mkdirSync(home, { recursive: true })
    const db = join(home, 'arcana.db')
    writeFileSync(join(home, 'state.json'), state)

    expect(await load(db)).toMatchObject({ log: { file: '/game/UE_game.log', offset: 4096 }, history: emptyHistory() })
    expect(existsSync(join(home, 'state.json'))).toBe(false)
    expect(readFileSync(join(home, 'state.json.imported'), 'utf8')).toBe(state)
    // the second read is the database's, and the backup is never touched again
    expect(await load(db)).toMatchObject({ log: { file: '/game/UE_game.log', offset: 4096 }, history: emptyHistory() })
    expect(existsSync(join(home, 'state.json.imported'))).toBe(true)
  })

  test('a fuller state, replayed by the package itself, is brought in whole', async () => {
    const tracker = trackerPartway()
    tracker.feed(theRest())
    // the JSON the old tracker would have written for what this one replayed
    const legacy = JSON.parse(
      JSON.stringify({ version: 2, log: { file: 'UE_game.log', offset: 9999 }, history: tracker.state, snapshot: tracker.snapshot() }),
    ) as Saved
    const home = join(dir, 'fuller')
    mkdirSync(home, { recursive: true })
    const db = join(home, 'arcana.db')
    writeFileSync(join(home, 'state.json'), `${JSON.stringify(legacy)}\n`)

    const saved = await load(db)
    expectSameSaved(saved, { ...legacy, version: SCHEMA_VERSION })
    if (saved === null) throw new Error('not imported')
    // what was brought in carries on, the way the JSON state did
    const again = new Tracker(saved.history)
    again.restore(saved.snapshot)
    expect(again.state.sessions[0].chests[0]?.upgrades).toBe(1)
    expect(again.state.trials).toEqual([{ at: ms('01.31.37:582'), arcana: 'TheHangedMan' }])
    expect(again.state.contests[0].chests[1]?.rewards).toEqual([{ item: 100300, qty: 3 }])
  })

  test('a state file that is corrupt, or of another version, is left where it is', async () => {
    for (const [name, contents] of [
      ['corrupt', '{not json'],
      ['old version', JSON.stringify({ version: 1, history: emptyHistory() })],
      ['half a state', JSON.stringify({ version: 2, log: { file: 'a', offset: 0 } })],
    ] as [string, string][]) {
      const home = join(dir, name.replace(' ', '-'))
      mkdirSync(home, { recursive: true })
      writeFileSync(join(home, 'state.json'), contents)
      const db = join(home, 'arcana.db')
      expect(await load(db)).toBeNull()
      expect(existsSync(db)).toBe(false)
      expect(existsSync(join(home, 'state.json'))).toBe(true)
      expect(existsSync(join(home, 'state.json.imported'))).toBe(false)
    }
  })

  test('nothing anywhere reads as nothing, and nothing is written', async () => {
    const db = join(dir, 'nowhere', 'arcana.db')
    expect(await load(db)).toBeNull()
    expect(existsSync(db)).toBe(false)
  })
})

describe('a broken database', () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arcana-broken-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('a file that is not a database reads as nothing, and the next save starts a fresh one beside it', async () => {
    const path = join(dir, 'arcana.db')
    writeFileSync(path, 'not a database at all')
    expect(await load(path)).toBeNull()

    const tracker = trackerPartway()
    const wanted: Saved = { version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 7 }, history: tracker.state, snapshot: tracker.snapshot() }
    await save(wanted, path)
    expectSameSaved(await load(path), wanted)
    // the broken file is kept, never deleted
    expect(readFileSync(`${path}.corrupt`, 'utf8')).toBe('not a database at all')
  })

  test('a database of a newer version is left alone, and the write is refused', async () => {
    const path = join(dir, 'future.db')
    const db = new Database(path)
    db.exec('create table visits (id integer primary key)')
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION + 1}`)
    db.close()

    expect(await load(path)).toBeNull()
    const tracker = trackerPartway()
    const saved: Saved = { version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 0 }, history: tracker.state, snapshot: tracker.snapshot() }
    expect(save(saved, path)).rejects.toThrow()
    expect(look(path, 'PRAGMA user_version')).toEqual([{ user_version: SCHEMA_VERSION + 1 }])
    expect(existsSync(`${path}.corrupt`)).toBe(false)
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
      ) as Saved
      // the database path
      const path = join(dir, 'arcana.db')
      await save({ version: SCHEMA_VERSION, log: { file: 'UE_game.log', offset: 10 }, history: straight.state, snapshot: straight.snapshot() }, path)
      const fromDb = await load(path)
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
