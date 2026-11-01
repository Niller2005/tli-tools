// What the tracker keeps for one character.
//
// The game's bag, the runs and the experience belong to the character that is logged in, so the
// tracker keeps one of each per character and switches when the log says another one logged in.
// What is the same for everyone stays out of here: the prices (the market is one), the names of
// the items and the legendary of each gear base.

import { Inventory } from './inventory'
import { RunSegmenter, type Run } from './runs'
import { XpMeter } from './xp'

/** The id of the character the tracker keeps what it read before the log said who was playing. */
export const UNKNOWN_CHARACTER = ''

/** How many exchange entries are kept for a character. */
export const MAX_TRADES = 500

/** What the player did at the exchange. */
export type ExchangeKind = 'list' | 'buy' | 'receive' | 'recall'

/** The protocol blocks the exchange's changes to the bag come in, and what each one is. */
export const EXCHANGE_PROTOS: Record<string, ExchangeKind> = {
  XchgForSale: 'list',
  XchgBuy: 'buy',
  XchgReceive: 'receive',
  XchgRecall: 'recall',
}

/**
 * One thing the player did at the exchange, as the bag saw it.
 *
 * The log says what changed in the bag, not at what price: listing takes the item out of the bag,
 * buying takes the FE (the item comes with a `receive` later), a sale or a purchase that is
 * collected puts the item or the FE in, and recalling a listing gives the item back.
 */
export interface ExchangeEntry {
  /** the entry's number among the character's, in order: it names the entry in the database */
  id: number
  /** when it happened, in ms */
  at: number
  kind: ExchangeKind
  /** what changed in the bag: the item and by how much (FE is item 100300) */
  items: [number, number][]
}

/** A stretch of play the player named, so its runs can be added up on their own. */
export interface Session {
  id: number
  name: string
  /** when it began, in ms */
  start: number
  /** when it ended, in ms; null while it is going on */
  end: number | null
}

/** Everything the tracker keeps for one character. */
export class CharacterState {
  readonly inventory = new Inventory()
  /** the runs that are done, oldest first */
  readonly runs: Run[] = []
  readonly segmenter = new RunSegmenter()
  readonly xp = new XpMeter()
  /** what the player did at the exchange, oldest first */
  readonly trades: ExchangeEntry[] = []
  /** the sessions, oldest first */
  readonly sessions: Session[] = []

  constructor(public id: string = UNKNOWN_CHARACTER) {}

  /** The session that is going on, if there is one. */
  get session(): Session | null {
    const last = this.sessions[this.sessions.length - 1]
    return last !== undefined && last.end === null ? last : null
  }

  /** Whether the character has nothing in it: nothing was read for it yet. */
  get empty(): boolean {
    return (
      this.runs.length === 0 &&
      this.segmenter.currentRun === null &&
      this.inventory.snapshot().length === 0 &&
      this.trades.length === 0 &&
      this.sessions.length === 0 &&
      this.xp.now === null
    )
  }
}
