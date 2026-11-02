// Saving the tracker.
//
// Everything the tracker knows is written to one SQLite database, so the tracker can be stopped
// and started again and still know about the runs that were already farmed, the prices that were
// learned and where it was in the log. The database is written now and then, and when the tracker
// is left; each save writes only what changed since the last one, in one transaction.
//
// What belongs to a character (the bag, the runs, the experience, the exchange, the sessions) is
// kept per character, in tables whose key starts with the character's id. What is the same for
// everyone (the prices, the names of the modifiers, the gear) is kept once. The character the log
// said was playing last is the one `loadTracker` gives back as the state; the others come with it
// as `parked`.
//
// The database can be looked at while the tracker runs (it is in WAL mode, so a reader never gets
// in the writer's way):
//
//   sqlite3 ~/.local/share/tli-tracker/tracker.db 'select kind, count(*) from runs group by kind'
//
// The state the tracker kept before the database was introduced is still read once: when the
// database is not there and `state.json` is, the old state is brought in with one write and the
// file is renamed to `state.json.imported`, so it is kept as a backup and never deleted.

import { Database } from 'bun:sqlite'
import { defineStore } from '@tli/store'
import { migrateState, STATE_VERSION, type SavedRun, type SavedState } from './engine'
import { UNKNOWN_CHARACTER, type ExchangeKind } from './character'

/** The database the tracker saves itself in. */
export const DB_FILE = 'tracker.db'

/**
 * Where the tracker saves itself.
 *
 * The life of the file — opening it, bringing its schema up to date, refusing a newer one,
 * setting a bad one aside, bringing the old `state.json` in — is `@tli/store`'s; what is the
 * tracker's own is the schema, the rows and the saved state below.
 */
export function dbPath(): string {
  return store.dbPath
}

/** What is saved: the tracker's state, and where it was in the log. */
export interface SavedTracker {
  version: number
  /** the log that was being read */
  log: { file: string; offset: number }
  /** what the tracker knows: the character that is logged in, with the other characters parked in it */
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
  // 2 → what a character owns is kept per character; experience, map modifiers, the exchange and
  // sessions. What was saved so far is the character the log had not named yet (the empty id): the
  // tracker gives it its real id when the log says who it is.
  `
  alter table runs rename to runs_old;
  alter table run_loot rename to run_loot_old;
  alter table run_cost rename to run_cost_old;
  alter table slots rename to slots_old;
  alter table instances rename to instances_old;

  create table characters (
    id text primary key,
    next_run_id integer not null default 1,
    xp_level integer,
    xp_exp integer
  );
  insert into characters (id, next_run_id)
    select '', value from settings where key = 'next_run_id';
  delete from settings where key = 'next_run_id';

  create table meta (
    key text primary key,
    value text not null
  );

  create table runs (
    character text not null,
    id integer not null,
    kind text not null,
    zone text not null,
    name text not null,
    level_id integer not null,
    start_ms integer not null,
    end_ms integer,
    fe integer not null,
    xp integer not null default 0,
    session_id integer not null default 0,
    is_current integer not null default 0 check (is_current in (0, 1)),
    primary key (character, id)
  );
  insert into runs (character, id, kind, zone, name, level_id, start_ms, end_ms, fe, is_current)
    select '', id, kind, zone, name, level_id, start_ms, end_ms, fe, is_current from runs_old;
  create table run_loot (
    character text not null,
    run_id integer not null,
    item integer not null,
    qty integer not null,
    primary key (character, run_id, item),
    foreign key (character, run_id) references runs (character, id) on delete cascade
  );
  insert into run_loot (character, run_id, item, qty) select '', run_id, item, qty from run_loot_old;
  create table run_cost (
    character text not null,
    run_id integer not null,
    item integer not null,
    qty integer not null,
    primary key (character, run_id, item),
    foreign key (character, run_id) references runs (character, id) on delete cascade
  );
  insert into run_cost (character, run_id, item, qty) select '', run_id, item, qty from run_cost_old;
  create table run_affix (
    character text not null,
    run_id integer not null,
    pos integer not null,
    affix integer not null,
    primary key (character, run_id, pos),
    foreign key (character, run_id) references runs (character, id) on delete cascade
  );
  create table slots (
    character text not null,
    key text not null,
    item integer not null,
    num integer not null,
    uuid text,
    primary key (character, key)
  );
  insert into slots (character, key, item, num, uuid) select '', key, item, num, uuid from slots_old;
  create table instances (
    character text not null,
    uuid text not null,
    item integer not null,
    page integer not null,
    slot integer not null,
    num integer not null,
    primary key (character, uuid)
  );
  insert into instances (character, uuid, item, page, slot, num)
    select '', uuid, item, page, slot, num from instances_old;

  drop table run_loot_old;
  drop table run_cost_old;
  drop table runs_old;
  drop table slots_old;
  drop table instances_old;

  create table sessions (
    character text not null,
    id integer not null,
    name text not null,
    start_ms integer not null,
    end_ms integer,
    primary key (character, id)
  );
  create table trades (
    character text not null,
    id integer not null,
    at_ms integer not null,
    kind text not null,
    primary key (character, id)
  );
  create table trade_items (
    character text not null,
    trade_id integer not null,
    item integer not null,
    delta integer not null,
    primary key (character, trade_id, item),
    foreign key (character, trade_id) references trades (character, id) on delete cascade
  );
  create table affixes (
    id integer primary key,
    text text not null
  );
  `,
]

/** The version of the database schema this code writes and reads. */
export const SCHEMA_VERSION = MIGRATIONS.length

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
  xp: number
  session_id: number
  is_current: number
}
interface ItemRow {
  run_id: number
  item: number
  qty: number
}
interface AffixRunRow {
  run_id: number
  affix: number
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
interface CharacterRow {
  id: string
  next_run_id: number
  xp_level: number | null
  xp_exp: number | null
}
interface MetaRow {
  value: string
}
interface SessionRow {
  id: number
  name: string
  start_ms: number
  end_ms: number | null
}
interface TradeRow {
  id: number
  at_ms: number
  kind: string
}
interface TradeItemRow {
  trade_id: number
  item: number
  delta: number
}
interface AffixNameRow {
  id: number
  text: string
}

/** The key of the character that was logged in last, in `meta`. */
const ACTIVE_KEY = 'active_character'

/* ---------- reading ---------- */

/** The id of the character that was logged in last. */
function activeCharacter(db: Database): string {
  const row = db.query('select value from meta where key = ?').get(ACTIVE_KEY) as MetaRow | null
  return row?.value ?? UNKNOWN_CHARACTER
}

/** The runs of a character, with their loot, their cost and their modifiers, from the rows the tables hold. */
function readRuns(db: Database, character: string, runs: RunRow[]): { runs: SavedRun[]; current: SavedRun | null } {
  const loot = new Map<number, [number, number][]>()
  const lootRows = db.query('select run_id, item, qty from run_loot where character = ? order by run_id, item').all(character) as ItemRow[]
  for (const row of lootRows) {
    push(loot, row.run_id, [row.item, row.qty])
  }
  const cost = new Map<number, [number, number][]>()
  const costRows = db.query('select run_id, item, qty from run_cost where character = ? order by run_id, item').all(character) as ItemRow[]
  for (const row of costRows) {
    push(cost, row.run_id, [row.item, row.qty])
  }
  const affixes = new Map<number, number[]>()
  const affixRows = db.query('select run_id, affix from run_affix where character = ? order by run_id, pos').all(character) as AffixRunRow[]
  for (const row of affixRows) {
    const list = affixes.get(row.run_id)
    if (list === undefined) affixes.set(row.run_id, [row.affix])
    else list.push(row.affix)
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
      xp: row.xp,
      affixes: affixes.get(row.id) ?? [],
      session: row.session_id,
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

/** What is kept of one character: everything but what is the same for every character. */
function readCharacter(db: Database, id: string, settings: Map<string, number>): SavedState {
  const runRows = db.query('select * from runs where character = ? order by id').all(id) as RunRow[]
  const { runs, current } = readRuns(db, id, runRows)
  const slotRows = db.query('select key, item, num, uuid from slots where character = ?').all(id) as SlotRow[]
  const instanceRows = db.query('select uuid, item, page, slot, num from instances where character = ?').all(id) as InstanceRow[]
  const row = db.query('select * from characters where id = ?').get(id) as CharacterRow | null
  const sessionRows = db.query('select id, name, start_ms, end_ms from sessions where character = ? order by id').all(id) as SessionRow[]
  const tradeRows = db.query('select id, at_ms, kind from trades where character = ? order by id').all(id) as TradeRow[]
  const itemRows = db.query('select trade_id, item, delta from trade_items where character = ? order by trade_id, item').all(id) as TradeItemRow[]
  const items = new Map<number, [number, number][]>()
  for (const item of itemRows) push(items, item.trade_id, [item.item, item.delta])
  return {
    version: STATE_VERSION,
    character: id,
    runs,
    current,
    slots: slotRows.map((slot) => ({ key: slot.key, item: slot.item, num: slot.num, uuid: slot.uuid })),
    instances: instanceRows.map((instance) => ({
      uuid: instance.uuid,
      item: instance.item,
      page: instance.page,
      slot: instance.slot,
      num: instance.num,
    })),
    prices: [],
    overrides: [],
    nextRunId: row?.next_run_id ?? 1,
    taxed: (settings.get('taxed') ?? 1) === 1,
    mapCosts: (settings.get('map_costs') ?? 0) === 1,
    xp: row !== null && row.xp_level !== null && row.xp_exp !== null ? { level: row.xp_level, exp: row.xp_exp } : null,
    exchange: tradeRows.map((trade) => ({
      id: trade.id,
      at: trade.at_ms,
      kind: trade.kind as ExchangeKind,
      items: items.get(trade.id) ?? [],
    })),
    sessions: sessionRows.map((session) => ({
      id: session.id,
      name: session.name,
      start: session.start_ms,
      end: session.end_ms,
    })),
  }
}

/** Reads everything that was saved; null when the database holds nothing yet. */
function readTracker(db: Database): SavedTracker | null {
  const log = db.query('select file, offset from log_position where id = 1').get() as LogRow | null
  if (log === null) return null
  const settingRows = db.query('select key, value from settings').all() as SettingRow[]
  const settings = new Map(settingRows.map((row) => [row.key, row.value]))
  const priceRows = db.query('select * from prices').all() as PriceRow[]
  const overrideRows = db.query('select * from price_overrides').all() as PairRow[]
  const gearRows = db.query('select * from gear').all() as GearRow[]
  const nameRows = db.query('select id, text from affixes').all() as AffixNameRow[]
  const ids = (db.query('select id from characters order by id').all() as { id: string }[]).map((row) => row.id)
  const active = activeCharacter(db)
  const top = readCharacter(db, active, settings)
  const parked = ids.filter((id) => id !== active).map((id) => readCharacter(db, id, settings))
  return {
    version: 1,
    log: { file: log.file, offset: log.offset },
    tracker: {
      ...top,
      prices: priceRows.map((row) => [
        row.item,
        { price: row.price, samples: row.samples, listings: row.listings, at: row.seen_at },
      ]),
      overrides: overrideRows.map((row) => [row.item, row.price]),
      gear: gearRows.map((row) => [row.base, row.legendary]),
      affixNames: nameRows.map((row) => [row.id, row.text]),
      parked,
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
    (a.xp ?? 0) === (b.xp ?? 0) &&
    (a.session ?? 0) === (b.session ?? 0) &&
    (a.affixes ?? []).join(',') === (b.affixes ?? []).join(',') &&
    sameItems(a.loot, b.loot) &&
    sameItems(a.cost, b.cost)
  )
}

/** Writes a setting, when it changed. */
function setSetting(db: Database, key: string, value: number, before: number | undefined): void {
  if (before === value) return
  db.run('insert into settings (key, value) values (?, ?) on conflict(key) do update set value = excluded.value', [key, value])
}

/** Every state the saved tracker holds: the character that is logged in, then the parked ones. */
function charactersOf(state: SavedState): Map<string, SavedState> {
  const all = new Map<string, SavedState>()
  all.set(state.character ?? UNKNOWN_CHARACTER, state)
  for (const parked of state.parked ?? []) all.set(parked.character ?? UNKNOWN_CHARACTER, parked)
  return all
}

/** Throws everything of a character away. */
function deleteCharacter(db: Database, id: string): void {
  db.run('delete from runs where character = ?', [id])
  db.run('delete from slots where character = ?', [id])
  db.run('delete from instances where character = ?', [id])
  db.run('delete from sessions where character = ?', [id])
  db.run('delete from trades where character = ?', [id])
  db.run('delete from characters where id = ?', [id])
}

/**
 * Writes what a character owns, as the difference from what is there.
 *
 * A run that changed is written whole (its loot, its cost and its modifiers with it); a run that
 * is no longer there is deleted. `before` null writes everything.
 */
function writeCharacter(db: Database, state: SavedState, before: SavedState | null): void {
  const id = state.character ?? UNKNOWN_CHARACTER

  const xp = state.xp ?? null
  const wasXp = before?.xp ?? null
  if (
    before === null ||
    before.nextRunId !== state.nextRunId ||
    wasXp?.level !== xp?.level ||
    wasXp?.exp !== xp?.exp
  ) {
    db.run(
      'insert into characters (id, next_run_id, xp_level, xp_exp) values (?, ?, ?, ?) on conflict(id) do update set next_run_id = excluded.next_run_id, xp_level = excluded.xp_level, xp_exp = excluded.xp_exp',
      [id, state.nextRunId, xp?.level ?? null, xp?.exp ?? null],
    )
  }

  // the runs, and the one that is going on
  const old = before === null ? new Map<number, RunDiff>() : runsById(before)
  const now = runsById(state)
  for (const runId of old.keys()) {
    if (!now.has(runId)) db.run('delete from runs where character = ? and id = ?', [id, runId])
  }
  for (const [runId, { run, isCurrent }] of now) {
    const was = old.get(runId)
    if (was !== undefined && was.isCurrent === isCurrent && sameRun(was.run, run)) continue
    if (was !== undefined) db.run('delete from runs where character = ? and id = ?', [id, runId])
    db.run(
      'insert into runs (character, id, kind, zone, name, level_id, start_ms, end_ms, fe, xp, session_id, is_current) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, runId, run.kind ?? 'map', run.zone, run.name, run.levelId, run.start, run.end, run.fe, run.xp ?? 0, run.session ?? 0, isCurrent ? 1 : 0],
    )
    for (const [item, qty] of run.loot) {
      db.run('insert into run_loot (character, run_id, item, qty) values (?, ?, ?, ?)', [id, runId, item, qty])
    }
    for (const [item, qty] of run.cost) {
      db.run('insert into run_cost (character, run_id, item, qty) values (?, ?, ?, ?)', [id, runId, item, qty])
    }
    for (const [pos, affix] of (run.affixes ?? []).entries()) {
      db.run('insert into run_affix (character, run_id, pos, affix) values (?, ?, ?, ?)', [id, runId, pos, affix])
    }
  }

  // the bag
  const oldSlots = new Map((before?.slots ?? []).map((slot) => [slot.key, slot]))
  for (const slot of state.slots) {
    const was = oldSlots.get(slot.key)
    oldSlots.delete(slot.key)
    if (was !== undefined && was.item === slot.item && was.num === slot.num && was.uuid === slot.uuid) continue
    db.run(
      'insert into slots (character, key, item, num, uuid) values (?, ?, ?, ?, ?) on conflict(character, key) do update set item = excluded.item, num = excluded.num, uuid = excluded.uuid',
      [id, slot.key, slot.item, slot.num, slot.uuid],
    )
  }
  for (const key of oldSlots.keys()) db.run('delete from slots where character = ? and key = ?', [id, key])

  const oldInstances = new Map((before?.instances ?? []).map((i) => [i.uuid, i]))
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
      'insert into instances (character, uuid, item, page, slot, num) values (?, ?, ?, ?, ?, ?) on conflict(character, uuid) do update set item = excluded.item, page = excluded.page, slot = excluded.slot, num = excluded.num',
      [id, instance.uuid, instance.item, instance.page, instance.slot, instance.num],
    )
  }
  for (const uuid of oldInstances.keys()) db.run('delete from instances where character = ? and uuid = ?', [id, uuid])

  // what the player did at the exchange: an entry never changes once it is written
  const oldTrades = new Set((before?.exchange ?? []).map((entry) => entry.id))
  for (const entry of state.exchange ?? []) {
    if (oldTrades.delete(entry.id)) continue
    db.run('insert into trades (character, id, at_ms, kind) values (?, ?, ?, ?)', [id, entry.id, entry.at, entry.kind])
    for (const [item, delta] of entry.items) {
      db.run('insert into trade_items (character, trade_id, item, delta) values (?, ?, ?, ?)', [id, entry.id, item, delta])
    }
  }
  for (const tradeId of oldTrades) db.run('delete from trades where character = ? and id = ?', [id, tradeId])

  // the sessions
  const oldSessions = new Map((before?.sessions ?? []).map((session) => [session.id, session]))
  for (const session of state.sessions ?? []) {
    const was = oldSessions.get(session.id)
    oldSessions.delete(session.id)
    if (was !== undefined && was.name === session.name && was.start === session.start && was.end === session.end) continue
    db.run(
      'insert into sessions (character, id, name, start_ms, end_ms) values (?, ?, ?, ?, ?) on conflict(character, id) do update set name = excluded.name, start_ms = excluded.start_ms, end_ms = excluded.end_ms',
      [id, session.id, session.name, session.start, session.end],
    )
  }
  for (const sessionId of oldSessions.keys()) db.run('delete from sessions where character = ? and id = ?', [id, sessionId])
}

/**
 * Writes what is saved, as the difference from what is there.
 *
 * Everything happens in one transaction, so a crash halfway through leaves the last whole save in
 * place. `before` null writes everything, which is what the first save and the one-time import use.
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

    // the characters; one that is gone (the one the log had not named yet, once it was) is thrown away
    const old = before === null ? new Map<string, SavedState>() : charactersOf(before.tracker)
    const now = charactersOf(state)
    for (const id of old.keys()) {
      if (!now.has(id)) deleteCharacter(db, id)
    }
    for (const [id, character] of now) writeCharacter(db, character, old.get(id) ?? null)
    const active = state.character ?? UNKNOWN_CHARACTER
    if (before === null || (before.tracker.character ?? UNKNOWN_CHARACTER) !== active) {
      db.run('insert into meta (key, value) values (?, ?) on conflict(key) do update set value = excluded.value', [ACTIVE_KEY, active])
    }

    // the prices
    const oldPrices = new Map((before?.tracker.prices ?? []).map(([item, info]) => [item, info]))
    for (const [item, info] of state.prices) {
      const was = oldPrices.get(item)
      oldPrices.delete(item)
      if (
        was !== undefined &&
        was.price === info.price &&
        was.samples === info.samples &&
        was.listings === info.listings &&
        was.at === info.at
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
      const was = oldOverrides.get(item)
      oldOverrides.delete(item)
      if (was === price) continue
      db.run(
        'insert into price_overrides (item, price) values (?, ?) on conflict(item) do update set price = excluded.price',
        [item, price],
      )
    }
    for (const item of oldOverrides.keys()) db.run('delete from price_overrides where item = ?', [item])

    // the gear and its legendaries
    const oldGear = new Map((before?.tracker.gear ?? []).map(([base, legendary]) => [base, legendary]))
    for (const [base, legendary] of state.gear ?? []) {
      const was = oldGear.get(base)
      oldGear.delete(base)
      if (was === legendary) continue
      db.run(
        'insert into gear (base, legendary) values (?, ?) on conflict(base) do update set legendary = excluded.legendary',
        [base, legendary],
      )
    }
    for (const base of oldGear.keys()) db.run('delete from gear where base = ?', [base])

    // what the modifiers of maps say
    const oldNames = new Map(before?.tracker.affixNames ?? [])
    for (const [affix, text] of state.affixNames ?? []) {
      const was = oldNames.get(affix)
      oldNames.delete(affix)
      if (was === text) continue
      db.run('insert into affixes (id, text) values (?, ?) on conflict(id) do update set text = excluded.text', [affix, text])
    }
    for (const affix of oldNames.keys()) db.run('delete from affixes where id = ?', [affix])

    // the settings
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

/* ---------- the store ---------- */

/** The tracker's own part of its store: the schema, the rows and the old state file. */
const store = defineStore<SavedTracker>({
  tool: 'the tracker',
  dir: 'tli-tracker',
  dbFile: DB_FILE,
  migrations: MIGRATIONS,
  parseLegacyState,
  read: readTracker,
  write: writeTracker,
})

/* ---------- the public face ---------- */

/**
 * Reads what was saved; null when there is nothing saved, or it cannot be read.
 *
 * When the database is not there yet and the old `state.json` is, that state is brought in and
 * read back. Nothing is created on disk when there is nothing to read: a dashboard that only
 * looks does not leave a database behind.
 */
export async function loadTracker(path = dbPath()): Promise<SavedTracker | null> {
  return store.load(path)
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
  return store.save(saved, path)
}

/**
 * The runs the database holds for the character that was logged in last, straight from its
 * tables: the ones that were finished (the run that is going on is not among them —
 * `loadTracker` has it).
 *
 * `since` keeps only the runs that started at or after it, so "the runs of today" is one call
 * with the local midnight. Null when there is no database to read.
 */
export function queryRuns(path = dbPath(), since?: number): SavedRun[] | null {
  return store.look(path, (db) => {
    const id = activeCharacter(db)
    const rows =
      since === undefined
        ? (db.query('select * from runs where character = ? and is_current = 0 order by id').all(id) as RunRow[])
        : (db.query('select * from runs where character = ? and is_current = 0 and start_ms >= ? order by id').all(id, since) as RunRow[])
    return readRuns(db, id, rows).runs
  })
}

/** The totals a dashboard can draw without reading every run. Null when there is no database. */
export function queryTotals(
  path = dbPath(),
): { runs: number; fe: number; firstAt: number | null; lastAt: number | null } | null {
  return store.look(path, (db) => {
    const row = db
      .query('select count(*) as runs, coalesce(sum(fe), 0) as fe, min(start_ms) as first, max(start_ms) as last from runs where character = ?')
      .get(activeCharacter(db)) as {
      runs: number
      fe: number
      first: number | null
      last: number | null
    }
    return { runs: row.runs, fe: row.fe, firstAt: row.first, lastAt: row.last }
  })
}
