// The tracker: it reads the log and keeps what the player has, what they picked up and what it is
// worth.
//
// The log is a stream of lines; the tracker takes them one at a time and keeps:
//   - the bag (what the player has), so the net worth can be worked out
//   - the runs (what was picked up in each trip into a map), so the profit per run can be
//   - the prices the exchange told it about, so the loot can be valued
//
// The lines the game writes its item changes in come in blocks that say what caused them:
// `PickItem`/`PickItems` are loot, `Spv3Open` is the cost of opening a map, `XchgReceive` is money
// from the exchange, and everything else is the game moving things around.

import { AffixDumpReader } from './affixes'
import {
  CharacterState,
  EXCHANGE_PROTOS,
  MAX_TRADES,
  UNKNOWN_CHARACTER,
  type ExchangeEntry,
  type Session,
} from './character'
import { ExchangeParser, FE_ITEM, type Quote } from './exchange'
import type { Inventory, Delta } from './inventory'
import { ItemNames } from './items'
import { parseDumpItem, parseDumpLegendary, parseLine, zoneOf, type Fact } from './parse'
import { PriceStore } from './prices'
import type { Run, RunKind, RunSegmenter } from './runs'
import { durationOf, perHour, valueOf, type Value } from './valuation'
import { expToNext } from './xp'

/** The protocol blocks that mean the items changed because the player picked them up. */
export const LOOT_PROTOS: Record<string, true> = { PickItem: true, PickItems: true }

/** The protocol blocks that mean the items changed because a map was opened. */
export const COST_PROTOS: Record<string, true> = { Spv3Open: true, ClimbTowerOpen: true }

/** The protocol blocks that mean the player got money from the exchange. */
export const MONEY_PROTOS: Record<string, true> = { XchgReceive: true }

/** How many finished runs the tracker keeps. */
export const MAX_RUNS = 500

/** How long an item can be waited for after the block that named it. */
export const EQUIP_WINDOW_MS = 30_000

/** How many blocks the tracker keeps, waiting to be told what was put on. */
const MAX_EQUIP_BLOCKS = 16

/** One item the log named, with the page and the slot it was in. */
interface NamedItem {
  uuid: string
  item: number
  page: number
  slot: number
}

/** What a pile of runs came to. */
export interface RunTotals {
  /** how many runs there were */
  runs: number
  /** how long the player was in maps, in ms */
  totalTime: number
  /** the average run's length, in ms */
  avgRunTime: number
  /** the FE that was picked up in maps */
  fe: number
  /** what all the loot was worth */
  lootValue: number
  /** the FE picked up in an hour of maps */
  fePerHour: number
  /** the FE picked up in a run, on average */
  fePerRun: number
  /** the experience that was gained in maps */
  xp: number
  /** the experience gained in an hour of maps */
  xpPerHour: number
}

/** What the tracker worked out. */
export interface Stats extends RunTotals {
  /** what the player has, at the prices the tracker knows */
  netWorth: number
  /** the character's level, when the log has said; null until then */
  level: number | null
  /** how far through the level the character is, from 0 to 1; null when it is not known */
  levelProgress: number | null
  /** how long until the next level at this pace, in ms; null when it cannot be told */
  levelEta: number | null
}

/** One modifier of the maps and what the maps that had it were worth. */
export interface AffixRow {
  id: number
  /** what the modifier says */
  text: string
  /** how many finished maps had it */
  runs: number
  /** what those maps were worth on average, in FE */
  avgWorth: number
  /** the FE picked up in those maps on average */
  avgFe: number
  /** what those maps were worth on average over what all the maps were worth: above 0 is better */
  versus: number
}

/** How the tracker is set up. */
export interface TrackerOptions {
  /** the names of the items */
  names?: ItemNames
  /** whether the trade tax counts against the value (on by default) */
  taxed?: boolean
  /** whether the cost of a map counts against the profit (off by default) */
  mapCosts?: boolean
}

/** A run, as it is saved. */
export interface SavedRun {
  id: number
  /** what kind of run it is; the runs of the first version had no kind and were all maps */
  kind?: RunKind
  zone: string
  name: string
  levelId: number
  start: number
  end: number | null
  loot: [number, number][]
  cost: [number, number][]
  fe: number
  /** the experience that was gained in it; the runs of the first versions had none */
  xp?: number
  /** the modifiers of the map, by id */
  affixes?: number[]
  /** the session it belongs to; 0 or missing is none */
  session?: number
}

/** One thing the player did at the exchange, as it is saved. */
export type SavedExchange = ExchangeEntry

/** A session, as it is saved. */
export type SavedSession = Session

/**
 * What the tracker keeps of one character, as it is saved.
 *
 * The state of the character that is logged in is the top of a `SavedTracker`, with the other
 * characters in `parked`. The prices, the names of the modifiers and the gear are the same for
 * everyone and are only kept in the character that is logged in.
 */
export interface SavedState {
  version: number
  /** the character this is the state of: the id the log gave, or '' for what was read before it said */
  character?: string
  /** the runs that are done */
  runs: SavedRun[]
  /** the run that is going on */
  current: SavedRun | null
  /** the bag */
  slots: { key: string; item: number; num: number; uuid: string | null }[]
  instances: { uuid: string; item: number; page: number; slot: number; num: number }[]
  /** the prices that were learned */
  prices: [number, { price: number; samples: number; listings: number; at: number }][]
  /** the prices the player set */
  overrides: [number, number][]
  /** the legendary id of the gear bases the log has named */
  gear?: [number, number][]
  /** the number the next run gets */
  nextRunId: number
  /** whether the trade tax counts against the value */
  taxed: boolean
  /** whether the cost of a map counts against the profit */
  mapCosts: boolean
  /** where the experience bar was last */
  xp?: { level: number; exp: number } | null
  /** what the player did at the exchange */
  exchange?: SavedExchange[]
  /** the sessions the player started; the last one is the one that is going on when it has no end */
  sessions?: SavedSession[]
  /** what the modifiers of maps say, by id */
  affixNames?: [number, string][]
  /** the other characters the log named */
  parked?: SavedState[]
}

/** The version of the saved file this code writes. */
export const STATE_VERSION = 3

/**
 * Puts a saved state into the shape this code writes.
 *
 * The runs of version 1 had no kind: they were all trips into a map. The runs of version 2 had no
 * experience, modifiers or session, and the state no character: it is the character the log had
 * not named yet. A state of a version this code does not know is not used at all.
 */
export function migrateState(state: SavedState): SavedState | null {
  if (state.version === STATE_VERSION) return state
  if (state.version !== 1 && state.version !== 2) return null
  const map = (run: SavedRun): SavedRun => ({
    ...run,
    kind: run.kind ?? 'map',
    xp: run.xp ?? 0,
    affixes: run.affixes ?? [],
    session: run.session ?? 0,
  })
  return {
    ...state,
    version: STATE_VERSION,
    character: state.character ?? UNKNOWN_CHARACTER,
    runs: state.runs.map(map),
    current: state.current === null ? null : map(state.current),
  }
}

/** The tracker. */
export class Tracker {
  /** the prices the tracker knows */
  readonly prices = new PriceStore()
  /** the names of the items */
  readonly names: ItemNames
  /** what the modifiers of maps say, by id, as far as the log has said */
  readonly affixNames = new Map<number, string>()
  /** whether the trade tax counts against the value */
  taxed: boolean
  /** whether the cost of a map counts against the profit */
  mapCosts: boolean

  /** every character the log named, by id */
  private characters = new Map<string, CharacterState>()
  /** the character that is logged in */
  private here: CharacterState
  private readonly quotes = new ExchangeParser()
  private readonly affixDump = new AffixDumpReader()
  /** the protocol block the log is in, if any */
  private proto: string | null = null
  /** when the last line came, in ms */
  private lastAt = 0
  /** the legendary id of each gear base the log has named */
  private readonly gear = new Map<number, number>()
  /** the items the block that is going on named */
  private blockItems: NamedItem[] = []
  /** what the exchange block that is going on changed in the bag: the item and by how much */
  private tradeBlock = new Map<number, number>()
  /** the blocks that could hold the item that was put on */
  private readonly equipBlocks: { at: number; items: NamedItem[] }[] = []
  /** the item the dump is reading */
  private dumpItem: { uuid: string; base: number } | null = null
  /** the legendary the dump named for that item */
  private dumpUnique = 0

  constructor(opts: TrackerOptions = {}) {
    this.names = opts.names ?? new ItemNames({})
    this.taxed = opts.taxed ?? true
    this.mapCosts = opts.mapCosts ?? false
    this.here = new CharacterState()
    this.characters.set(this.here.id, this.here)
  }

  /** When the last line came, in ms. */
  get at(): number {
    return this.lastAt
  }

  /** The id of the character that is logged in; '' while the log has not said. */
  get character(): string {
    return this.here.id
  }

  /** The ids of the characters the tracker keeps something for. */
  get characterIds(): string[] {
    return [...this.characters.keys()]
  }

  /** The bag of the character that is logged in. */
  get inventory(): Inventory {
    return this.here.inventory
  }

  /** The runs that are done, oldest first. */
  get runs(): Run[] {
    return this.here.runs
  }

  /** What the player did at the exchange, oldest first. */
  get trades(): ExchangeEntry[] {
    return this.here.trades
  }

  /** The sessions, oldest first. */
  get sessions(): Session[] {
    return this.here.sessions
  }

  /** The session that is going on, if there is one. */
  get session(): Session | null {
    return this.here.session
  }

  private get segmenter(): RunSegmenter {
    return this.here.segmenter
  }

  /** The run that is going on, if there is one. */
  get currentRun(): Run | null {
    return this.segmenter.currentRun
  }

  /** The FE the player has. */
  get fe(): number {
    return this.inventory.count(FE_ITEM)
  }

  /** Reads a batch of lines. */
  feed(lines: Iterable<string>): void {
    for (const line of lines) this.feedLine(line)
  }

  /** Reads one line. */
  feedLine(line: string): void {
    const named = this.affixDump.feed(line)
    if (named !== null) this.affixNames.set(named.id, named.text)

    const quote = this.quotes.feed(line)
    if (quote !== null) {
      this.learnPrice(quote)
      return
    }

    const fact = parseLine(line)
    if (fact === null) {
      this.readDump(line)
      return
    }
    this.lastAt = fact.at
    this.apply(fact)
  }

  /**
   * The game dumps the bag as the raw lines of its protocol.
   *
   * In a dump the fields of one item follow one another, and two of them name it: the id with the
   * instance the game gave it, and the id of the legendary it is. The dump is written when the
   * player logs in and when things move to the warehouse, so the legendary of a piece of gear is
   * known from then on.
   */
  private readDump(line: string): void {
    if (!line.startsWith('|')) {
      this.flushDump()
      return
    }
    if (line.includes('+Item+')) {
      this.flushDump()
      const legendary = parseDumpLegendary(line)
      if (legendary !== null) this.dumpUnique = legendary.legendary
      return
    }
    const item = parseDumpItem(line)
    if (item !== null) {
      this.dumpItem = { uuid: item.uuid, base: item.base }
      return
    }
    const legendary = parseDumpLegendary(line)
    if (legendary !== null) this.dumpUnique = legendary.legendary
  }

  /** The item the dump was reading is done: keep the legendary it named. */
  private flushDump(): void {
    const item = this.dumpItem
    const legendary = this.dumpUnique
    this.dumpItem = null
    this.dumpUnique = 0
    if (item === null || legendary === 0) return
    this.rememberGear(item.base, legendary)
  }

  /** Acts on what a line said. */
  private apply(fact: Fact): void {
    switch (fact.t) {
      case 'level': {
        const ended = this.segmenter.level(fact.ltype, fact.lid, fact.at)
        if (ended !== null) this.finish(ended)
        return
      }
      case 'path':
        this.segmenter.path(zoneOf(fact.path))
        return
      case 'proto':
        if (fact.start) {
          this.proto = fact.name
          this.blockItems = []
          this.tradeBlock.clear()
        } else {
          this.proto = null
          this.closeBlock(fact.at)
          this.closeTrade(fact.name, fact.at)
        }
        return
      case 'exp': {
        const gained = this.here.xp.update(fact.level, fact.exp)
        if (gained > 0) this.segmenter.xp(gained)
        return
      }
      case 'modifier':
        if (fact.ok) this.segmenter.affix(fact.id)
        return
      case 'player':
        this.login(fact.id, fact.at)
        return
      case 'equip':
        this.equip(fact)
        return
      case 'pageReset': {
        const deltas = this.inventory.resetPage(fact.page)
        this.takeDeltas(deltas)
        return
      }
      case 'bagSet': {
        if (fact.uuid !== null) {
          this.blockItems.push({ uuid: fact.uuid, item: fact.item, page: fact.page, slot: fact.slot })
        }
        const deltas = this.inventory.set(fact.page, fact.slot, fact.item, fact.num, fact.uuid, fact.op)
        this.takeDeltas(deltas)
        return
      }
      case 'bagClear': {
        const deltas = this.inventory.clear(fact.page, fact.slot, fact.uuid)
        this.takeDeltas(deltas)
        return
      }
      case 'screen':
        this.segmenter.screen(fact.name, fact.state, fact.at)
        return
    }
  }

  /** The block is over: keep what it named, waiting to be told what was put on. */
  private closeBlock(at: number): void {
    if (this.blockItems.length === 0) return
    this.equipBlocks.push({ at, items: this.blockItems })
    while (this.equipBlocks.length > MAX_EQUIP_BLOCKS) this.equipBlocks.shift()
    this.blockItems = []
  }

  /**
   * The player put something on: the log says which legendary it is.
   *
   * The line names the base of the gear and the legendary it became, but not the item itself. The
   * item is found in the block that named it: the gear on the character says which slot it is in,
   * and a bag item is only used when the block named one item of that base.
   */
  private equip(fact: Extract<Fact, { t: 'equip' }>): void {
    if (fact.legendary === 0) return
    const item = this.equippedItem(fact)
    if (item === null) return
    this.rememberGear(item.item, fact.legendary)
  }

  /** Keeps the legendary of a gear base, unless the log says another one. */
  private rememberGear(base: number, legendary: number): void {
    const old = this.gear.get(base)
    if (old !== undefined && old !== legendary) this.gear.delete(base)
    else this.gear.set(base, legendary)
  }

  /** The item that was put on, when the log names it. */
  private equippedItem(fact: Extract<Fact, { t: 'equip' }>): NamedItem | null {
    for (let index = this.equipBlocks.length - 1; index >= 0; index -= 1) {
      const block = this.equipBlocks[index]
      if (block === undefined) continue
      if (fact.at - block.at > EQUIP_WINDOW_MS) break
      const same = block.items.filter((item) => item.item === fact.base)
      const worn = same.filter((item) => item.page < 0 && item.slot === fact.slot)
      if (worn.length === 1) return worn[0] ?? null
      if (same.length === 1) return same[0] ?? null
    }
    return null
  }

  /**
   * The item an id stands for.
   *
   * The log names the legendary of a piece of gear only when it is put on, so a gear base is
   * worth the legendary the player put on, and is worth its own name until then.
   */
  itemOf(item: number): number {
    return this.gear.get(item) ?? item
  }

  /** The legendary id of a gear base, when the log has named one. */
  legendaryOf(item: number): number | null {
    return this.gear.get(item) ?? null
  }

  /** A run is over. */
  private finish(run: Run): void {
    const runs = this.here.runs
    runs.push(run)
    while (runs.length > MAX_RUNS) runs.shift()
  }

  /**
   * The log named the character that is logged in.
   *
   * What was read before the log said who was playing is that character's, when the character is
   * new to the tracker: it is renamed, nothing is lost. When another character logs in, the one
   * that was playing leaves: its run ends where the log says, and its state is parked as it is.
   * The experience bar starts over either way, because a login is a gap the log does not fill.
   */
  private login(id: string, at: number): void {
    const was = this.here
    if (was.id === id) {
      was.xp.reset()
      return
    }
    if (was.id === UNKNOWN_CHARACTER && !this.characters.has(id)) {
      this.characters.delete(was.id)
      was.id = id
      this.characters.set(id, was)
      was.xp.reset()
      return
    }
    const ended = was.segmenter.endRun(at)
    if (ended !== null) this.finish(ended)
    let next = this.characters.get(id)
    if (next === undefined) {
      next = new CharacterState(id)
      this.characters.set(id, next)
    }
    next.xp.reset()
    this.here = next
  }

  /** The exchange block is over: keep what it changed in the bag. */
  private closeTrade(name: string, at: number): void {
    const kind = EXCHANGE_PROTOS[name]
    const changed = this.tradeBlock
    if (kind === undefined || changed.size === 0) return
    const trades = this.here.trades
    trades.push({ id: (trades[trades.length - 1]?.id ?? 0) + 1, at, kind, items: [...changed] })
    while (trades.length > MAX_TRADES) trades.shift()
    changed.clear()
  }

  /** What the changes to the bag mean: loot, cost, money or the exchange. */
  private takeDeltas(deltas: Delta[]): void {
    if (deltas.length === 0) return
    const proto = this.proto
    if (proto === null) return
    const exchange = EXCHANGE_PROTOS[proto] !== undefined
    for (const d of deltas) {
      if (exchange) {
        const now = (this.tradeBlock.get(d.item) ?? 0) + d.delta
        if (now === 0) this.tradeBlock.delete(d.item)
        else this.tradeBlock.set(d.item, now)
      }
      if (LOOT_PROTOS[proto] === true) {
        if (d.delta > 0) {
          this.segmenter.loot(d.item, d.delta)
          if (d.item === FE_ITEM) this.segmenter.fe(d.delta)
        }
        continue
      }
      if (COST_PROTOS[proto] === true) {
        if (d.delta < 0) this.segmenter.cost(d.item, -d.delta)
        continue
      }
      if (MONEY_PROTOS[proto] === true && d.item === FE_ITEM && d.delta > 0) {
        this.segmenter.fe(d.delta)
      }
    }
  }

  /** Keeps what the exchange said about an item. */
  private learnPrice(quote: Quote): void {
    this.prices.learn(quote.item, quote.prices, this.lastAt)
  }

  /** What a run was worth. */
  valueOfRun(run: Run): Value {
    const loot = valueOf(run.loot, (i) => this.prices.price(this.itemOf(i)), this.taxed)
    const cost = this.mapCosts
      ? valueOf(run.cost, (i) => this.prices.price(this.itemOf(i)), false).gross
      : 0
    return {
      gross: loot.gross - cost,
      tax: loot.tax,
      net: loot.net - cost,
      fe: loot.fe,
    }
  }

  /** What the player has now. */
  netWorth(): number {
    return valueOf(this.inventory.totals(), (i) => this.prices.price(this.itemOf(i)), this.taxed).net
  }

  /** What a pile of runs came to; the run that is going on counts for the time it has taken so far. */
  totalsOf(runs: Run[], now = Date.now()): RunTotals {
    let totalTime = 0
    let fe = 0
    let xp = 0
    let lootValue = 0
    for (const run of runs) {
      totalTime += durationOf(run.start, run.end, now)
      fe += run.fe
      xp += run.xp
      lootValue += this.valueOfRun(run).gross
    }
    return {
      runs: runs.length,
      totalTime,
      avgRunTime: runs.length === 0 ? 0 : totalTime / runs.length,
      fe,
      lootValue,
      fePerHour: perHour(fe, totalTime),
      fePerRun: runs.length === 0 ? 0 : fe / runs.length,
      xp,
      xpPerHour: perHour(xp, totalTime),
    }
  }

  /** The runs that are done and the one that is going on. */
  private allRuns(): Run[] {
    const current = this.segmenter.currentRun
    return current === null ? [...this.runs] : [...this.runs, current]
  }

  /** What the tracker worked out. */
  stats(now = Date.now()): Stats {
    const totals = this.totalsOf(this.allRuns(), now)
    const bar = this.here.xp.now
    const need = bar === null ? 0 : expToNext(bar.level)
    const left = bar === null ? 0 : Math.max(0, need - bar.exp)
    return {
      ...totals,
      netWorth: this.netWorth(),
      level: bar?.level ?? null,
      levelProgress: this.here.xp.progress,
      levelEta: bar === null || need === 0 || totals.xpPerHour <= 0 ? null : (left / totals.xpPerHour) * 3_600_000,
    }
  }

  /** What the runs of a session came to; null when there is no such session. */
  sessionTotals(id: number, now = Date.now()): RunTotals | null {
    if (!this.sessions.some((session) => session.id === id)) return null
    return this.totalsOf(this.allRuns().filter((run) => run.session === id), now)
  }

  /**
   * Starts a session of the player's own: the runs that begin from now on belong to it, and the
   * session that was going on ends. The run that is going on stays where it was.
   */
  startSession(name: string, now = Date.now()): Session {
    this.endSession(now)
    const sessions = this.sessions
    const id = sessions.reduce((most, session) => Math.max(most, session.id), 0) + 1
    const session: Session = { id, name: name.trim() === '' ? `Session ${id}` : name.trim(), start: now, end: null }
    sessions.push(session)
    this.segmenter.setSession(id)
    return session
  }

  /** Ends the session that is going on, if there is one; the runs that begin after it belong to none. */
  endSession(now = Date.now()): Session | null {
    const session = this.session
    if (session === null) return null
    session.end = now
    this.segmenter.setSession(0)
    return session
  }

  /**
   * Which modifiers of the maps paid.
   *
   * Every modifier the log put a name to, with the runs it was on and what those runs were worth
   * on average against all the finished maps. Modifiers on fewer than `minRuns` runs are left out:
   * a handful of runs says nothing. It is a comparison, not a cause: a modifier that is on the
   * better maps may be there because those maps were better prepared.
   */
  affixReport(minRuns = 3): AffixRow[] {
    const maps = this.runs.filter((run) => run.kind === 'map' && run.end !== null)
    if (maps.length === 0) return []
    const worth = new Map<number, number>()
    for (const run of maps) worth.set(run.id, this.valueOfRun(run).gross)
    let sum = 0
    for (const value of worth.values()) sum += value
    const average = sum / maps.length

    const by = new Map<number, { runs: number; worth: number; fe: number }>()
    for (const run of maps) {
      for (const id of run.affixes) {
        if (!this.affixNames.has(id)) continue
        const row = by.get(id) ?? { runs: 0, worth: 0, fe: 0 }
        row.runs += 1
        row.worth += worth.get(run.id) ?? 0
        row.fe += run.fe
        by.set(id, row)
      }
    }
    const rows: AffixRow[] = []
    for (const [id, row] of by) {
      if (row.runs < minRuns) continue
      const mean = row.worth / row.runs
      rows.push({
        id,
        text: this.affixNames.get(id) ?? '',
        runs: row.runs,
        avgWorth: mean,
        avgFe: row.fe / row.runs,
        versus: mean - average,
      })
    }
    return rows.sort((a, b) => b.versus - a.versus)
  }

  /** One character's state, as it is saved; `shared` adds what is the same for every character. */
  private saveOf(character: CharacterState, shared: boolean): SavedState {
    const save = (run: Run): SavedRun => ({
      id: run.id,
      kind: run.kind,
      zone: run.zone,
      name: run.name,
      levelId: run.levelId,
      start: run.start,
      end: run.end,
      loot: [...run.loot],
      cost: [...run.cost],
      fe: run.fe,
      xp: run.xp,
      affixes: [...run.affixes],
      session: run.session,
    })
    const prices = shared ? this.prices.snapshot() : { learned: [], overrides: [] }
    const current = character.segmenter.currentRun
    const last = character.runs[character.runs.length - 1]
    return {
      version: STATE_VERSION,
      character: character.id,
      runs: character.runs.map(save),
      current: current === null ? null : save(current),
      slots: character.inventory.snapshot(),
      instances: character.inventory.instancesSnapshot(),
      prices: prices.learned,
      overrides: prices.overrides,
      gear: shared ? [...this.gear] : [],
      nextRunId: Math.max(last?.id ?? 0, current?.id ?? 0) + 1,
      taxed: this.taxed,
      mapCosts: this.mapCosts,
      xp: character.xp.now,
      exchange: character.trades.map((entry) => ({ ...entry, items: entry.items.map(([item, by]): [number, number] => [item, by]) })),
      sessions: character.sessions.map((session) => ({ ...session })),
      affixNames: shared ? [...this.affixNames] : [],
    }
  }

  /** Everything the tracker keeps, as it is saved: the character that is logged in, and the others parked. */
  snapshot(): SavedState {
    const parked = [...this.characters.values()].filter((character) => character !== this.here)
    return { ...this.saveOf(this.here, true), parked: parked.map((character) => this.saveOf(character, false)) }
  }

  /** Puts a character's saved state in a fresh state of its own. */
  private fill(saved: SavedState): CharacterState {
    const character = new CharacterState(saved.character ?? UNKNOWN_CHARACTER)
    character.inventory.restore(saved.slots, saved.instances)
    for (const run of saved.runs) character.runs.push(fromSaved(run))
    character.segmenter.setNextId(saved.nextRunId)
    if (saved.current !== null) character.segmenter.restoreCurrent(fromSaved(saved.current))
    character.xp.restore(saved.xp ?? null)
    for (const entry of saved.exchange ?? []) character.trades.push(entry)
    for (const session of saved.sessions ?? []) character.sessions.push({ ...session })
    character.segmenter.setSession(character.session?.id ?? 0)
    return character
  }

  /** Puts a saved tracker back. */
  restore(state: SavedState): void {
    const migrated = migrateState(state)
    if (migrated === null) return
    this.prices.restore(migrated.prices, migrated.overrides)
    this.gear.clear()
    for (const [base, legendary] of migrated.gear ?? []) this.gear.set(base, legendary)
    this.affixNames.clear()
    for (const [id, text] of migrated.affixNames ?? []) this.affixNames.set(id, text)
    this.taxed = migrated.taxed
    this.mapCosts = migrated.mapCosts

    this.characters = new Map()
    this.here = this.fill(migrated)
    this.characters.set(this.here.id, this.here)
    for (const parked of migrated.parked ?? []) {
      const other = migrateState(parked)
      if (other === null) continue
      const character = this.fill(other)
      this.characters.set(character.id, character)
    }
  }
}

/** A saved run, as a run. */
function fromSaved(saved: SavedRun): Run {
  return {
    id: saved.id,
    kind: saved.kind ?? 'map',
    zone: saved.zone,
    name: saved.name,
    levelId: saved.levelId,
    start: saved.start,
    end: saved.end,
    loot: new Map(saved.loot),
    cost: new Map(saved.cost),
    fe: saved.fe,
    xp: saved.xp ?? 0,
    affixes: [...(saved.affixes ?? [])],
    session: saved.session ?? 0,
  }
}
