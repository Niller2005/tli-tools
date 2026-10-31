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

import { ExchangeParser, FE_ITEM, type Quote } from './exchange'
import { Inventory, type Delta } from './inventory'
import { ItemNames } from './items'
import { parseLine, zoneOf, type Fact } from './parse'
import { PriceStore } from './prices'
import { RunSegmenter, type Run, type RunKind } from './runs'
import { durationOf, perHour, valueOf, type Value } from './valuation'

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

/** What the tracker worked out. */
export interface Stats {
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
  /** what the player has, at the prices the tracker knows */
  netWorth: number
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
}

/** Everything the tracker keeps, as it is saved. */
export interface SavedState {
  version: number
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
}

/** The version of the saved file this code writes. */
export const STATE_VERSION = 2

/**
 * Puts a saved state into the shape this code writes.
 *
 * The runs of version 1 had no kind: they were all trips into a map. A state of a version this
 * code does not know is not used at all.
 */
export function migrateState(state: SavedState): SavedState | null {
  if (state.version === STATE_VERSION) return state
  if (state.version !== 1) return null
  const map = (run: SavedRun): SavedRun => ({ ...run, kind: 'map' })
  return {
    ...state,
    version: STATE_VERSION,
    runs: state.runs.map(map),
    current: state.current === null ? null : map(state.current),
  }
}

/** The tracker. */
export class Tracker {
  /** the bag */
  readonly inventory = new Inventory()
  /** the prices the tracker knows */
  readonly prices = new PriceStore()
  /** the runs that are done, oldest first */
  readonly runs: Run[] = []
  /** the names of the items */
  readonly names: ItemNames
  /** whether the trade tax counts against the value */
  taxed: boolean
  /** whether the cost of a map counts against the profit */
  mapCosts: boolean

  private readonly segmenter = new RunSegmenter()
  private readonly exchange = new ExchangeParser()
  /** the protocol block the log is in, if any */
  private proto: string | null = null
  /** when the last line came, in ms */
  private lastAt = 0
  /** the legendary id of each gear base the log has named */
  private readonly gear = new Map<number, number>()
  /** the items the block that is going on named */
  private blockItems: NamedItem[] = []
  /** the blocks that could hold the item that was put on */
  private readonly equipBlocks: { at: number; items: NamedItem[] }[] = []

  constructor(opts: TrackerOptions = {}) {
    this.names = opts.names ?? new ItemNames({})
    this.taxed = opts.taxed ?? true
    this.mapCosts = opts.mapCosts ?? false
  }

  /** When the last line came, in ms. */
  get at(): number {
    return this.lastAt
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
    const quote = this.exchange.feed(line)
    if (quote !== null) {
      this.learnPrice(quote)
      return
    }

    const fact = parseLine(line)
    if (fact === null) return
    this.lastAt = fact.at
    this.apply(fact)
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
        } else {
          this.proto = null
          this.closeBlock(fact.at)
        }
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
    const old = this.gear.get(item.item)
    if (old !== undefined && old !== fact.legendary) this.gear.delete(item.item)
    else this.gear.set(item.item, fact.legendary)
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
    this.runs.push(run)
    while (this.runs.length > MAX_RUNS) this.runs.shift()
  }

  /** What the changes to the bag mean: loot, cost or money. */
  private takeDeltas(deltas: Delta[]): void {
    if (deltas.length === 0) return
    const proto = this.proto
    for (const d of deltas) {
      if (proto === null) continue
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

  /** What the tracker worked out. */
  stats(now = Date.now()): Stats {
    let totalTime = 0
    let fe = 0
    let lootValue = 0
    for (const run of this.runs) {
      totalTime += durationOf(run.start, run.end, now)
      fe += run.fe
      lootValue += this.valueOfRun(run).gross
    }
    const current = this.segmenter.currentRun
    if (current !== null) {
      totalTime += durationOf(current.start, null, now)
      fe += current.fe
      lootValue += this.valueOfRun(current).gross
    }
    const runs = this.runs.length + (current !== null ? 1 : 0)
    return {
      runs,
      totalTime,
      avgRunTime: runs === 0 ? 0 : totalTime / runs,
      fe,
      lootValue,
      fePerHour: perHour(fe, totalTime),
      fePerRun: runs === 0 ? 0 : fe / runs,
      netWorth: this.netWorth(),
    }
  }

  /** Everything the tracker keeps, as it is saved. */
  snapshot(): SavedState {
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
    })
    const prices = this.prices.snapshot()
    const current = this.segmenter.currentRun
    const last = this.runs[this.runs.length - 1]
    return {
      version: STATE_VERSION,
      runs: this.runs.map(save),
      current: current === null ? null : save(current),
      slots: this.inventory.snapshot(),
      instances: this.inventory.instancesSnapshot(),
      prices: prices.learned,
      overrides: prices.overrides,
      gear: [...this.gear],
      nextRunId: (last?.id ?? 0) + 1,
      taxed: this.taxed,
      mapCosts: this.mapCosts,
    }
  }

  /** Puts a saved tracker back. */
  restore(state: SavedState): void {
    const migrated = migrateState(state)
    if (migrated === null) return
    this.inventory.restore(migrated.slots, migrated.instances)
    this.prices.restore(migrated.prices, migrated.overrides)
    this.gear.clear()
    for (const [base, legendary] of migrated.gear ?? []) this.gear.set(base, legendary)
    this.taxed = migrated.taxed
    this.mapCosts = migrated.mapCosts
    this.runs.length = 0
    for (const saved of migrated.runs) this.runs.push(fromSaved(saved))
    this.segmenter.setNextId(migrated.nextRunId)
    const current = migrated.current
    if (current !== null) this.segmenter.restoreCurrent(fromSaved(current))
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
  }
}
