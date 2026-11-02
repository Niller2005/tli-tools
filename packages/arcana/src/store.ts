// Saving what the tracker knows.
//
// Everything the tracker knows is written to one SQLite database, so the tracker can be stopped
// and started again and still know about the visits that were already played. The database is
// written now and then, and when the tracker is left; each save writes only what changed since
// the last one, in one transaction.
//
// The database can be looked at while the tracker runs (it is in WAL mode, so a reader never gets
// in the writer's way):
//
//   sqlite3 ~/.local/share/tli-arcana/arcana.db 'select id, opened_at, closed_at from visits'
//
// The state the tracker kept before the database was introduced is still read once: when the
// database is not there and `state.json` is, the old state is brought in with one write and the
// file is renamed to `state.json.imported`, so it is kept as a backup and never deleted.

import { Database } from 'bun:sqlite'
import { defineStore } from '@tli/store'

import {
  emptyHistory,
  type CellKind,
  type Chest,
  type Contest,
  type History,
  type Move,
  type OpenedChest,
  type Session,
  type Snapshot,
  type Trial,
} from './session'

/** The database the tracker saves itself in. */
const DB_FILE = 'arcana.db'

/**
 * Where the tracker saves itself.
 *
 * The life of the file — opening it, bringing its schema up to date, refusing a newer one,
 * setting a bad one aside, bringing the old `state.json` in — is `@tli/store`'s, shared with the
 * loot tracker; what is the Arcana tracker's own is the schema, the rows and the saved state
 * below.
 */
export function statePath(): string {
  return store.dbPath
}

/** The version of the old state file, the only one this code reads back. */
const LEGACY_STATE_VERSION = 2

/** What is saved: the tracker's history, its bag and prices, and where it was in the log. */
export interface Saved {
  version: number
  /** the log that was being read, and how far */
  log: { file: string; offset: number }
  /** what the tracker knows */
  history: History
  /** the bag and the prices */
  snapshot: Snapshot
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
  create table settings (
    key text primary key,
    value integer not null
  );
  create table visits (
    id integer primary key,
    opened_at integer not null,
    closed_at integer,
    cells integer not null,
    chests_skipped integer not null,
    notes integer not null,
    played integer not null,
    life_lost integer not null,
    life_won integer not null
  );
  create table moves (
    visit_id integer not null references visits(id) on delete cascade,
    ord integer not null,
    at integer not null,
    steps text not null,
    cells integer not null,
    revealed_left integer not null,
    revealed_right integer not null,
    chest_slot integer,
    chest_rarity text,
    chest_at integer,
    chest_upgrades integer,
    upgraded text not null,
    life integer not null,
    played integer not null,
    gained integer not null,
    shuffled integer not null check (shuffled in (0, 1)),
    messages text not null,
    primary key (visit_id, ord)
  );
  create table cells (
    visit_id integer not null,
    move_ord integer not null,
    cell_id integer not null,
    kind text not null,
    rarity text,
    primary key (visit_id, move_ord),
    foreign key (visit_id, move_ord) references moves (visit_id, ord) on delete cascade
  );
  create table chests (
    visit_id integer not null references visits(id) on delete cascade,
    ord integer not null,
    slot integer not null,
    rarity text,
    taken_at integer not null,
    upgrades integer not null,
    primary key (visit_id, ord)
  );
  create table trials (
    id integer primary key,
    at integer not null,
    arcana text not null
  );
  create table contests (
    id integer primary key,
    asked_at integer,
    opened_at integer,
    closed_at integer
  );
  create table contest_chests (
    id integer primary key,
    contest_id integer not null references contests(id) on delete cascade,
    ord integer not null,
    opened_at integer not null
  );
  create table rewards (
    chest_id integer not null references contest_chests(id) on delete cascade,
    ord integer not null,
    item integer not null,
    qty integer not null,
    primary key (chest_id, ord)
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
  `,
]

/** The version of the database schema this code writes and reads. */
export const SCHEMA_VERSION = MIGRATIONS.length

/* ---------- the rows ---------- */

interface LogRow {
  file: string
  offset: number
}
interface SettingRow {
  key: string
  value: number
}
interface VisitRow {
  id: number
  opened_at: number
  closed_at: number | null
  cells: number
  chests_skipped: number
  notes: number
  played: number
  life_lost: number
  life_won: number
}
interface MoveRow {
  visit_id: number
  ord: number
  at: number
  steps: string
  cells: number
  revealed_left: number
  revealed_right: number
  chest_slot: number | null
  chest_rarity: string | null
  chest_at: number | null
  chest_upgrades: number | null
  upgraded: string
  life: number
  played: number
  gained: number
  shuffled: number
  messages: string
}
interface CellRow {
  visit_id: number
  move_ord: number
  cell_id: number
  kind: string
  rarity: string | null
}
interface ChestRow {
  visit_id: number
  ord: number
  slot: number
  rarity: string | null
  taken_at: number
  upgrades: number
}
interface TrialRow {
  id: number
  at: number
  arcana: string
}
interface ContestRow {
  id: number
  asked_at: number | null
  opened_at: number | null
  closed_at: number | null
}
interface ContestChestRow {
  id: number
  contest_id: number
  ord: number
  opened_at: number
}
interface RewardRow {
  chest_id: number
  ord: number
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

/* ---------- reading ---------- */

/** Puts a row in the list of the visit it belongs to. */
function push<T>(map: Map<number, T[]>, visitId: number, entry: T): void {
  const list = map.get(visitId)
  if (list === undefined) map.set(visitId, [entry])
  else list.push(entry)
}

/** Reads everything that was saved; null when the database holds nothing yet. */
function readArcana(db: Database): Saved | null {
  const log = db.query('select file, offset from log_position where id = 1').get() as LogRow | null
  if (log === null) return null
  const settingRows = db.query('select key, value from settings').all() as SettingRow[]
  const settings = new Map(settingRows.map((row) => [row.key, row.value]))

  const moveRows = db.query('select * from moves order by visit_id, ord').all() as MoveRow[]
  const moves = new Map<number, Move[]>()
  const cellRows = db.query('select * from cells').all() as CellRow[]
  const landed = new Map<string, CellRow>()
  for (const row of cellRows) landed.set(`${row.visit_id}:${row.move_ord}`, row)
  for (const row of moveRows) {
    const move: Move = {
      at: row.at,
      steps: JSON.parse(row.steps) as Move['steps'],
      cells: row.cells,
      left: row.revealed_left,
      right: row.revealed_right,
      landed: cellOf(landed.get(`${row.visit_id}:${row.ord}`)),
      chest:
        row.chest_slot === null
          ? null
          : { slot: row.chest_slot, rarity: row.chest_rarity as Chest['rarity'], at: row.chest_at ?? 0, upgrades: row.chest_upgrades ?? 0 },
      upgraded: JSON.parse(row.upgraded) as number[],
      life: row.life,
      played: row.played,
      gained: row.gained,
      shuffled: row.shuffled === 1,
      messages: JSON.parse(row.messages) as string[],
    }
    push(moves, row.visit_id, move)
  }

  const chestRows = db.query('select * from chests order by visit_id, ord').all() as ChestRow[]
  const chests = new Map<number, Chest[]>()
  for (const row of chestRows) {
    push(chests, row.visit_id, { slot: row.slot, rarity: row.rarity as Chest['rarity'], at: row.taken_at, upgrades: row.upgrades })
  }

  const sessions: Session[] = []
  const visitRows = db.query('select * from visits order by id').all() as VisitRow[]
  for (const row of visitRows) {
    sessions.push({
      id: row.id,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      cells: row.cells,
      moves: moves.get(row.id) ?? [],
      chests: chests.get(row.id) ?? [],
      chestsSkipped: row.chests_skipped,
      notes: row.notes,
      played: row.played,
      lifeLost: row.life_lost,
      lifeWon: row.life_won,
    })
  }

  const rewardRows = db.query('select * from rewards order by chest_id, ord').all() as RewardRow[]
  const rewards = new Map<number, { item: number; qty: number }[]>()
  for (const row of rewardRows) push(rewards, row.chest_id, { item: row.item, qty: row.qty })
  const contestChestRows = db.query('select * from contest_chests order by contest_id, ord').all() as ContestChestRow[]
  const contestChests = new Map<number, OpenedChest[]>()
  for (const row of contestChestRows) {
    push(contestChests, row.contest_id, { at: row.opened_at, rewards: rewards.get(row.id) ?? [] })
  }
  const contests: Contest[] = []
  const contestRows = db.query('select * from contests order by id').all() as ContestRow[]
  for (const row of contestRows) {
    contests.push({
      askedAt: row.asked_at,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      chests: contestChests.get(row.id) ?? [],
    })
  }

  const trials = (db.query('select * from trials order by id').all() as TrialRow[]).map((row) => ({ at: row.at, arcana: row.arcana }))

  const slotRows = db.query('select * from slots order by key').all() as SlotRow[]
  const instanceRows = db.query('select * from instances order by uuid').all() as InstanceRow[]
  const priceRows = db.query('select * from prices order by item').all() as PriceRow[]
  const overrideRows = db.query('select * from price_overrides order by item').all() as PairRow[]

  const history: History = { sessions, contests, trials, nextId: settings.get('next_id') ?? 1 }
  return {
    version: SCHEMA_VERSION,
    log: { file: log.file, offset: log.offset },
    history,
    snapshot: {
      bag: {
        slots: slotRows.map((row) => ({ key: row.key, item: row.item, num: row.num, uuid: row.uuid })),
        instances: instanceRows.map((row) => ({ uuid: row.uuid, item: row.item, page: row.page, slot: row.slot, num: row.num })),
      },
      prices: priceRows.map((row) => [row.item, { price: row.price, samples: row.samples, listings: row.listings, at: row.seen_at }]),
      overrides: overrideRows.map((row) => [row.item, row.price]),
    },
  }
}

/** The cell a move stopped on, as the row of it says. */
function cellOf(row: CellRow | undefined): Move['landed'] {
  if (row === undefined) return null
  return { id: row.cell_id, kind: row.kind as CellKind, rarity: row.rarity as Chest['rarity'] }
}

/* ---------- writing ---------- */

/** Whether two lists are the same, in the same order. */
function sameList(a: (string | number)[], b: (string | number)[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i])
}

/** Whether a move is the same as the one that was saved of it. */
function sameMove(a: Move, b: Move): boolean {
  return (
    a.at === b.at &&
    a.cells === b.cells &&
    a.left === b.left &&
    a.right === b.right &&
    a.life === b.life &&
    a.played === b.played &&
    a.gained === b.gained &&
    a.shuffled === b.shuffled &&
    sameList(a.steps, b.steps) &&
    sameList(a.upgraded, b.upgraded) &&
    sameList(a.messages, b.messages) &&
    sameCell(a.landed, b.landed) &&
    sameChest(a.chest, b.chest)
  )
}

/** Whether the cell a move stopped on is the same as the one that was saved. */
function sameCell(a: Move['landed'], b: Move['landed']): boolean {
  if (a === null || b === null) return a === b
  return a.id === b.id && a.kind === b.kind && a.rarity === b.rarity
}

/** Whether a chest is the same as the one that was saved of it. */
function sameChest(a: Chest | null, b: Chest | null): boolean {
  if (a === null || b === null) return a === b
  return a.slot === b.slot && a.rarity === b.rarity && a.at === b.at && a.upgrades === b.upgrades
}

/** Whether a visit is the same as the one that was saved of it, its moves and its chests with it. */
function sameVisit(a: Session, b: Session): boolean {
  return (
    a.id === b.id &&
    a.openedAt === b.openedAt &&
    a.closedAt === b.closedAt &&
    a.cells === b.cells &&
    a.chestsSkipped === b.chestsSkipped &&
    a.notes === b.notes &&
    a.played === b.played &&
    a.lifeLost === b.lifeLost &&
    a.lifeWon === b.lifeWon &&
    a.moves.length === b.moves.length &&
    a.moves.every((move, i) => sameMove(move, b.moves[i])) &&
    a.chests.length === b.chests.length &&
    a.chests.every((chest, i) => sameChest(chest, b.chests[i]))
  )
}

/** Whether a trial is the same as the one that was saved of it. */
function sameTrial(a: Trial, b: Trial): boolean {
  return a.at === b.at && a.arcana === b.arcana
}

/** Whether a chest of the contest is the same as the one that was saved of it, its rewards with it. */
function sameContestChest(a: OpenedChest, b: OpenedChest): boolean {
  return (
    a.at === b.at &&
    a.rewards.length === b.rewards.length &&
    a.rewards.every((reward, i) => reward.item === b.rewards[i].item && reward.qty === b.rewards[i].qty)
  )
}

/** Whether a contest is the same as the one that was saved of it, its chests with it. */
function sameContest(a: Contest, b: Contest): boolean {
  return (
    a.askedAt === b.askedAt &&
    a.openedAt === b.openedAt &&
    a.closedAt === b.closedAt &&
    a.chests.length === b.chests.length &&
    a.chests.every((chest, i) => sameContestChest(chest, b.chests[i]))
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
 * A visit that changed is written whole (its moves, its cells and its chests with it); a visit
 * that is no longer there is deleted. The trials and the contests have no ids of their own, so
 * they are kept by place: the first one that differs is written again, and everything after it.
 * Everything happens in one transaction, so a crash halfway through leaves the last whole save
 * in place. `before` null writes everything, which is what the first save and the one-time
 * import use.
 */
function writeArcana(db: Database, saved: Saved, before: Saved | null): void {
  const history = saved.history
  const write = db.transaction(() => {
    // where the tracker was in the log
    if (before?.log.file !== saved.log.file || before?.log.offset !== saved.log.offset) {
      db.run(
        'insert into log_position (id, file, offset) values (1, ?, ?) on conflict(id) do update set file = excluded.file, offset = excluded.offset',
        [saved.log.file, saved.log.offset],
      )
    }

    // the number the next visit gets
    setSetting(db, 'next_id', history.nextId, before?.history.nextId)

    // the visits, by their id
    const oldVisits = before === null ? new Map<number, Session>() : new Map(before.history.sessions.map((session) => [session.id, session]))
    for (const id of oldVisits.keys()) {
      if (history.sessions.every((session) => session.id !== id)) db.run('delete from visits where id = ?', [id])
    }
    for (const session of history.sessions) {
      const was = oldVisits.get(session.id)
      if (was !== undefined && sameVisit(was, session)) continue
      if (was !== undefined) db.run('delete from visits where id = ?', [session.id])
      db.run(
        'insert into visits (id, opened_at, closed_at, cells, chests_skipped, notes, played, life_lost, life_won) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [session.id, session.openedAt, session.closedAt, session.cells, session.chestsSkipped, session.notes, session.played, session.lifeLost, session.lifeWon],
      )
      for (const [ord, move] of session.moves.entries()) {
        db.run(
          'insert into moves (visit_id, ord, at, steps, cells, revealed_left, revealed_right, chest_slot, chest_rarity, chest_at, chest_upgrades, upgraded, life, played, gained, shuffled, messages) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
          [
            session.id,
            ord,
            move.at,
            JSON.stringify(move.steps),
            move.cells,
            move.left,
            move.right,
            move.chest?.slot ?? null,
            move.chest?.rarity ?? null,
            move.chest?.at ?? null,
            move.chest?.upgrades ?? null,
            JSON.stringify(move.upgraded),
            move.life,
            move.played,
            move.gained,
            move.shuffled ? 1 : 0,
            JSON.stringify(move.messages),
          ],
        )
        if (move.landed !== null) {
          db.run('insert into cells (visit_id, move_ord, cell_id, kind, rarity) values (?, ?, ?, ?, ?)', [
            session.id,
            ord,
            move.landed.id,
            move.landed.kind,
            move.landed.rarity,
          ])
        }
      }
      for (const [ord, chest] of session.chests.entries()) {
        db.run('insert into chests (visit_id, ord, slot, rarity, taken_at, upgrades) values (?, ?, ?, ?, ?, ?)', [
          session.id,
          ord,
          chest.slot,
          chest.rarity,
          chest.at,
          chest.upgrades,
        ])
      }
    }

    // the trials, by their place
    const oldTrials = before?.history.trials ?? []
    let from = 0
    while (from < oldTrials.length && from < history.trials.length && sameTrial(oldTrials[from], history.trials[from])) from += 1
    if (from < oldTrials.length) db.run('delete from trials where id > ?', [from])
    for (const [i, trial] of history.trials.entries()) {
      if (i < from) continue
      db.run('insert into trials (id, at, arcana) values (?, ?, ?)', [i + 1, trial.at, trial.arcana])
    }

    // the contests, by their place
    const oldContests = before?.history.contests ?? []
    from = 0
    while (from < oldContests.length && from < history.contests.length && sameContest(oldContests[from], history.contests[from])) from += 1
    if (from < oldContests.length) db.run('delete from contests where id > ?', [from])
    for (const [i, contest] of history.contests.entries()) {
      if (i < from) continue
      db.run('insert into contests (id, asked_at, opened_at, closed_at) values (?, ?, ?, ?)', [
        i + 1,
        contest.askedAt,
        contest.openedAt,
        contest.closedAt,
      ])
      for (const [ord, chest] of contest.chests.entries()) {
        db.run('insert into contest_chests (id, contest_id, ord, opened_at) values (?, ?, ?, ?)', [(i + 1) * 1000 + ord, i + 1, ord, chest.at])
        for (const [rewardOrd, reward] of chest.rewards.entries()) {
          db.run('insert into rewards (chest_id, ord, item, qty) values (?, ?, ?, ?)', [(i + 1) * 1000 + ord, rewardOrd, reward.item, reward.qty])
        }
      }
    }

    // the bag
    const oldSlots = new Map((before?.snapshot.bag.slots ?? []).map((slot) => [slot.key, slot]))
    for (const slot of saved.snapshot.bag.slots) {
      const was = oldSlots.get(slot.key)
      oldSlots.delete(slot.key)
      if (was !== undefined && was.item === slot.item && was.num === slot.num && was.uuid === slot.uuid) continue
      db.run(
        'insert into slots (key, item, num, uuid) values (?, ?, ?, ?) on conflict(key) do update set item = excluded.item, num = excluded.num, uuid = excluded.uuid',
        [slot.key, slot.item, slot.num, slot.uuid],
      )
    }
    for (const key of oldSlots.keys()) db.run('delete from slots where key = ?', [key])

    const oldInstances = new Map((before?.snapshot.bag.instances ?? []).map((instance) => [instance.uuid, instance]))
    for (const instance of saved.snapshot.bag.instances) {
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
    const oldPrices = new Map((before?.snapshot.prices ?? []).map(([item, info]) => [item, info]))
    for (const [item, info] of saved.snapshot.prices) {
      const old = oldPrices.get(item)
      oldPrices.delete(item)
      if (old !== undefined && old.price === info.price && old.samples === info.samples && old.listings === info.listings && old.at === info.at) {
        continue
      }
      db.run(
        'insert into prices (item, price, samples, listings, seen_at) values (?, ?, ?, ?, ?) on conflict(item) do update set price = excluded.price, samples = excluded.samples, listings = excluded.listings, seen_at = excluded.seen_at',
        [item, info.price, info.samples, info.listings, info.at],
      )
    }
    for (const item of oldPrices.keys()) db.run('delete from prices where item = ?', [item])

    // the prices the player set
    const oldOverrides = new Map((before?.snapshot.overrides ?? []).map(([item, price]) => [item, price]))
    for (const [item, price] of saved.snapshot.overrides) {
      const old = oldOverrides.get(item)
      oldOverrides.delete(item)
      if (old === price) continue
      db.run('insert into price_overrides (item, price) values (?, ?) on conflict(item) do update set price = excluded.price', [item, price])
    }
    for (const item of oldOverrides.keys()) db.run('delete from price_overrides where item = ?', [item])
  })
  write()
}

/* ---------- the old state file ---------- */

/** Reads the state the tracker kept in one JSON file; null when it is not one this code reads. */
function parseLegacyState(raw: string): Saved | null {
  try {
    const saved = JSON.parse(raw) as Saved
    if (saved?.version !== LEGACY_STATE_VERSION) return null
    if (saved.history === undefined || saved.snapshot === undefined || saved.log === undefined) return null
    return saved
  } catch {
    return null
  }
}

/* ---------- the store ---------- */

/** The Arcana tracker's own part of its store: the schema, the rows and the old state file. */
const store = defineStore<Saved>({
  tool: 'the Arcana tracker',
  dir: 'tli-arcana',
  dbFile: DB_FILE,
  migrations: MIGRATIONS,
  parseLegacyState,
  read: readArcana,
  write: writeArcana,
})

/* ---------- the public face ---------- */

/**
 * Reads what was saved; null when there is nothing saved, or it cannot be read.
 *
 * When the database is not there yet and the old `state.json` is, that state is brought in and
 * read back. Nothing is created on disk when there is nothing to read: a dashboard that only
 * looks does not leave a database behind.
 */
export async function load(path = statePath()): Promise<Saved | null> {
  return store.load(path)
}

/**
 * Writes what is saved.
 *
 * Only what changed since the last save is written, in one transaction, so a crash halfway
 * through leaves the last whole save in place. A file that is not the tracker's database, or one
 * that broke between the saves, is moved aside (to `<db>.corrupt`) rather than deleted; a
 * database of a newer version of the tracker is left entirely alone, and the write is refused.
 */
export async function save(saved: Saved, path = statePath()): Promise<void> {
  return store.save(saved, path)
}

/** A history with nothing in it, for when nothing usable was saved. */
export function historyOf(saved: Saved | null): History {
  return saved === null ? emptyHistory() : saved.history
}
