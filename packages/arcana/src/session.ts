// The Arcana season's sessions: a visit to the Tarot Path, and the Fateful Contest that
// can follow it.
//
// The log narrates the board in two layers. The coarse layer is the pages: the board
// (`S9Taro`) opens and closes, and the Fateful Contest's page (`S9Challenge`) opens and
// closes. The fine layer is the moves: each run of `HandleOrderAni` is one move, made of
// ordered steps.
//
//   CardDraw         a card is drawn from the hand and used
//   MoveTo           the marker moves along the path
//   CardGroupAdd     cards are added to the hand
//   RewardRarityUp   a chest of destiny's rarity is raised
//   HPTo             life changes
//
// What a move does is read off the widgets and the sounds it touches:
//
//   a card used       `_S9HandCard Anim_Dachu`, with `Card_PopUp` before it
//   cards gained      `_S9HandCard Anim_Putong_Jinpai`, with `Card_Thead_CardAdd`
//   the hand shuffled `_S9HandCard Anim_Xipai`
//   the path drawn    `_S9Line* Anim_D` — the path ahead is drawn
//   the path walked   `_S9Line* Anim_Light` — the path under the marker is lit
//   cells revealed    `_S9Tile Anim_ShowL` (from the left) or `Anim_ShowR` (from the right)
//   the cell's icon   `_S9TileIcon Anim_<Rarity>_Show02`, or `Anim_Show02` for a plain cell
//   a chest taken     `_S9Reward Anim_<Rarity>` and the `Card_Box_Get` sound
//   a chest raised    `_S9Reward Anim_Taro_RewardUpgrade` and the `Card_Box_Upgrade` sound
//   life lost or won  `_S9Tile Anim_Kouxue` / `Anim_Jiaxue`, with the `Life -1` message
//
// The trials of the season are fought in the stages, not on the board. A trial shows up as
// a tarot card turning over (`KaPai_Turn_Slow`) and as its story (`Play_VO_Story_S9_3_`),
// which names the trial: The Sun, The Hermit, The Chariot and the rest.
//
// What the log does *not* say is where the cells are. The board is a strip of cells whose
// widget ids are allocated as the game scrolls it, so a cell's id says nothing about its
// place on the board. What is knowable is the shape of the walk: how many cells were
// crossed, and on which side the path revealed itself.
//
// The items the chests of destiny give are read by the loot tracker, which already knows
// how the game writes its item changes and how the exchange's prices come back.

import { ExchangeParser, Inventory, PriceStore, parseLine as parseItem, type Delta, type Fact as ItemFact } from '@tli/tracker'
import { parseLine, type Fact, type Rarity, type StepKind } from './parse'

/** A slot of the bag, as it is saved. */
export interface SlotRecord {
  key: string
  item: number
  num: number
  uuid: string | null
}

/** A stack of the bag, as it is saved. */
export interface InstanceRecord {
  uuid: string
  item: number
  page: number
  slot: number
  num: number
}

/** A price the tracker learned, as it is saved. */
export interface PriceRecord {
  price: number
  samples: number
  listings: number
  at: number
}

/** What the tracker keeps besides its history: the bag, so that the next item change is measured against it, and the prices. */
export interface Snapshot {
  bag: { slots: SlotRecord[]; instances: InstanceRecord[] }
  prices: [number, PriceRecord][]
  overrides: [number, number][]
}

/** What a cell of the board holds. */
export type CellKind = 'plain' | 'chest' | 'event' | 'trap'

/** One cell of the board, as the log describes it. */
export interface Cell {
  /** the game's widget id for the cell */
  id: number
  /** what the cell holds */
  kind: CellKind
  /** the rarity of the chest on the cell, when it holds one */
  rarity: Rarity | null
}

/** A chest of destiny the player took. */
export interface Chest {
  /** the widget id of the chest's slot in the carried bar */
  slot: number
  /** the chest's rarity, when the log showed it */
  rarity: Rarity | null
  /** when it was taken */
  at: number
  /** how many times its rarity was raised afterwards */
  upgrades: number
}

/** One move of the marker along the path. */
export interface Move {
  /** when the move started */
  at: number
  /** the steps of the move, in the order the game played them */
  steps: StepKind[]
  /** the cells the marker crossed */
  cells: number
  /** the cells the path revealed on the left */
  left: number
  /** the cells the path revealed on the right */
  right: number
  /** the cell the marker stopped on */
  landed: Cell | null
  /** a chest of destiny was taken */
  chest: Chest | null
  /** the chests whose rarity was raised */
  upgraded: number[]
  /** life lost (-1) or won (+1) */
  life: number
  /** cards drawn from the hand and used */
  played: number
  /** cards added to the hand */
  gained: number
  /** the hand was shuffled */
  shuffled: boolean
  /** what the game told the player */
  messages: string[]
}

/** One visit to the Tarot Path. */
export interface Session {
  /** the session's number */
  id: number
  /** when the board opened */
  openedAt: number
  /** when the board closed; null while it is open */
  closedAt: number | null
  /** the cells the marker crossed over the whole session */
  cells: number
  /** the moves of the session, in order */
  moves: Move[]
  /** the chests of destiny the player took */
  chests: Chest[]
  /** the cells that held a chest that was not taken; the log does not say why */
  chestsSkipped: number
  /** the notes of arcana the player gained */
  notes: number
  /** the cards the player used */
  played: number
  /** life lost */
  lifeLost: number
  /** life won */
  lifeWon: number
}

/** One trial of the season, fought in a stage. */
export interface Trial {
  /** when the trial's story played */
  at: number
  /** the arcana the trial is about */
  arcana: string
}

/** One chest of destiny opened in the Fateful Contest, and what it gave. */
export interface OpenedChest {
  /** when the chest was opened */
  at: number
  /** the items the chest gave */
  rewards: { item: number; qty: number }[]
}

/** The Fateful Contest: the fight the player enters to open their chests. */
export interface Contest {
  /** when the game asked whether to start it */
  askedAt: number | null
  /** when the contest's page opened */
  openedAt: number | null
  /** when the contest's fight ended */
  closedAt: number | null
  /** the chests of destiny opened in the fight */
  chests: OpenedChest[]
}

/** The level type of the Fateful Contest's fight. The game puts it in a level of its own. */
export const CONTEST_LEVEL_TYPE = 19

/**
 * How long after a chest is opened its rewards may still arrive.
 *
 * The game drops a chest's loot the moment it is opened: in the log the items are picked up
 * within a second or two of the `BaoXiang_Open_01` sound. The cap keeps the loot of the stage
 * that follows from being counted as the chest's reward.
 */
export const REWARD_WINDOW_MS = 30_000

/** Everything the tracker knows. */
export interface History {
  /** the visits to the Tarot Path, oldest first */
  sessions: Session[]
  /** the Fateful Contests, oldest first */
  contests: Contest[]
  /** the trials fought, oldest first */
  trials: Trial[]
  /** the number the next session gets */
  nextId: number
}

/** A history with nothing in it. */
export function emptyHistory(): History {
  return { sessions: [], contests: [], trials: [], nextId: 1 }
}

/** The move being built, and what the log has said about it so far. */
interface Builder {
  /** the move */
  move: Move
  /** the path segments the move drew */
  drawn: Set<number>
  /** the path segments the move lit */
  lit: Set<number>
  /** the cells the move revealed, and the side each came from */
  revealed: Map<number, 'left' | 'right'>
  /** the icon the move showed */
  icon: { id: number; rarity: Rarity | null } | null
}

/** The tracker: it reads the log's lines and keeps what they say. */
export class Tracker {
  private readonly history: History
  /** the prices the exchange told the tracker about */
  readonly prices = new PriceStore()
  private readonly exchange = new ExchangeParser()
  private readonly bag = new Inventory()
  private session: Session | null = null
  private contest: Contest | null = null
  /** the chest of destiny whose rewards are still coming in */
  private openChest: OpenedChest | null = null
  /** whether the player is in the Fateful Contest's fight */
  private inContest = false
  private builder: Builder | null = null
  /** the protocol block the log is in, when it is in one */
  private proto: string | null = null
  /** the time of the last thing the log said */
  private lastAt = 0

  constructor(history: History = emptyHistory()) {
    this.history = history
    this.resume()
  }

  /** Picks up a session or a contest that was still going when the history was saved. */
  private resume(): void {
    const session = this.history.sessions[this.history.sessions.length - 1]
    if (session !== undefined && session.closedAt === null) this.session = session
    const contest = this.history.contests[this.history.contests.length - 1]
    if (contest !== undefined && contest.closedAt === null) {
      this.contest = contest
      this.inContest = contest.openedAt !== null
      this.openChest = contest.chests[contest.chests.length - 1] ?? null
    }
  }

  /** The bag and the prices, as they are saved: the history itself is `state`. */
  snapshot(): Snapshot {
    const prices = this.prices.snapshot()
    return {
      bag: { slots: this.bag.snapshot(), instances: this.bag.instancesSnapshot() },
      prices: prices.learned,
      overrides: prices.overrides,
    }
  }

  /** Puts a saved bag and saved prices back. */
  restore(saved: Snapshot): void {
    this.bag.restore(saved.bag.slots, saved.bag.instances)
    this.prices.restore(saved.prices, saved.overrides)
  }

  /** Everything the tracker knows. */
  get state(): History {
    return this.history
  }

  /** When the last thing the log said happened, in ms on the log's own clock; 0 before the first. */
  get at(): number {
    return this.lastAt
  }

  /** The session being played, if the board is open. */
  get current(): Session | null {
    return this.session
  }

  /** The contest being fought, if there is one. */
  get currentContest(): Contest | null {
    return this.contest
  }

  /** The bag, as the log described it. */
  get inventory(): Inventory {
    return this.bag
  }

  /** Reads a batch of the log's lines. */
  feed(lines: Iterable<string>): void {
    for (const line of lines) this.feedLine(line)
  }

  /** Reads one line of the log. */
  feedLine(line: string): void {
    const quote = this.exchange.feed(line)
    if (quote !== null) {
      this.prices.learn(quote.item, quote.prices, this.lastAt)
      return
    }
    const fact = parseLine(line)
    if (fact !== null) {
      this.lastAt = fact.at
      this.apply(fact)
      return
    }
    this.items(line)
  }

  /** Reads the item changes the loot tracker knows about. */
  private items(line: string): void {
    const fact = parseItem(line)
    if (fact === null) return
    this.lastAt = fact.at
    if (fact.t === 'proto') {
      this.proto = fact.start ? fact.name : null
      return
    }
    if (fact.t === 'level') {
      this.level(fact.ltype, fact.at)
      return
    }
    const deltas = this.bagDelta(fact)
    if (deltas.length === 0) return
    // Only what the player picked up counts as a reward, and only while a chest is open.
    if (this.proto !== 'PickItem' && this.proto !== 'PickItems') return
    const chest = this.openChest
    if (chest === null || fact.at - chest.at > REWARD_WINDOW_MS) return
    for (const delta of deltas) {
      if (delta.delta <= 0) continue
      chest.rewards.push({ item: delta.item, qty: delta.delta })
    }
  }

  /** How the bag changed. */
  private bagDelta(fact: ItemFact): Delta[] {
    if (fact.t === 'bagSet') {
      return this.bag.set(fact.page, fact.slot, fact.item, fact.num, fact.uuid, fact.op)
    }
    if (fact.t === 'bagClear') {
      return this.bag.clear(fact.page, fact.slot, fact.uuid)
    }
    if (fact.t === 'pageReset') {
      return this.bag.resetPage(fact.page)
    }
    return []
  }

  /** Acts on what the log said. */
  private apply(fact: Fact): void {
    switch (fact.t) {
      case 'board':
        if (fact.open) this.openBoard(fact.at)
        else this.closeBoard(fact.at)
        return
      case 'challenge':
        if (fact.open) this.openContest(fact.at)
        return
      case 'contestPrompt':
        this.askContest(fact.at)
        return
      case 'step':
        this.step(fact.kind, fact.at)
        return
      case 'moveEnd':
        this.endMove()
        return
      case 'cell':
        this.cell(fact.id, fact.what)
        return
      case 'path':
        this.path(fact.id, fact.lit)
        return
      case 'icon':
        this.icon(fact.id, fact.rarity)
        return
      case 'chest':
        this.chest(fact.id, fact.rarity)
        return
      case 'chestUp':
        this.chestUp(fact.id)
        return
      case 'hand':
        this.hand(fact.what)
        return
      case 'message':
        this.message(fact.text)
        return
      case 'sound':
        this.sound(fact.name)
        return
      case 'trial':
        this.trial(fact.at)
        return
      case 'trialStory':
        this.trialStory(fact.arcana, fact.at)
        return
      case 'stepEnd':
        return
      default:
        return
    }
  }

  /** A tarot card turned over in a stage: a trial showed itself. */
  private trial(at: number): void {
    this.history.trials.push({ at, arcana: '' })
  }

  /** A trial's story played: the trial was fought, and the log named its arcana. */
  private trialStory(arcana: string, at: number): void {
    const last = this.history.trials[this.history.trials.length - 1]
    // The story plays a moment after the card turned over; when it does, it names the
    // trial. A story with no card before it is a trial of the Fateful Contest.
    if (last !== undefined && last.arcana === '' && at - last.at < 5000) {
      last.arcana = arcana
      return
    }
    this.history.trials.push({ at, arcana })
  }

  /** The board opened. */
  private openBoard(at: number): void {
    if (this.session !== null) this.closeBoard(at)
    const session: Session = {
      id: this.history.nextId++,
      openedAt: at,
      closedAt: null,
      cells: 0,
      moves: [],
      chests: [],
      chestsSkipped: 0,
      notes: 0,
      played: 0,
      lifeLost: 0,
      lifeWon: 0,
    }
    this.history.sessions.push(session)
    this.session = session
  }

  /**
   * The log began again (the game was restarted, or the log was rotated): the visit and the
   * contest that were open are over, and whatever block of item changes was open is gone.
   */
  logRestarted(): void {
    this.closeBoard(this.lastAt)
    if (this.contest !== null) this.contest.closedAt = this.lastAt
    this.contest = null
    this.inContest = false
    this.openChest = null
    this.proto = null
  }

  /** The board closed. */
  private closeBoard(at: number): void {
    if (this.session === null) return
    this.endMove()
    this.session.closedAt = at
    this.session = null
  }

  /** The game asked whether to start the Fateful Contest. */
  private askContest(at: number): void {
    if (this.contest !== null) return
    this.contest = { askedAt: at, openedAt: null, closedAt: null, chests: [] }
    this.history.contests.push(this.contest)
  }

  /** The contest's page opened. */
  private openContest(at: number): void {
    if (this.contest === null) {
      this.contest = { askedAt: null, openedAt: at, closedAt: null, chests: [] }
      this.history.contests.push(this.contest)
      return
    }
    this.contest.openedAt = at
  }

  /** A step of a move began. */
  private step(kind: StepKind, at: number): void {
    if (this.session === null) return
    if (this.builder === null) {
      this.builder = {
        move: {
          at,
          steps: [],
          cells: 0,
          left: 0,
          right: 0,
          landed: null,
          chest: null,
          upgraded: [],
          life: 0,
          played: 0,
          gained: 0,
          shuffled: false,
          messages: [],
        },
        drawn: new Set(),
        lit: new Set(),
        revealed: new Map(),
        icon: null,
      }
    }
    this.builder.move.steps.push(kind)
  }

  /** The move is over. */
  private endMove(): void {
    const builder = this.builder
    if (builder === null || this.session === null) return
    const move = builder.move
    move.cells = builder.lit.size
    for (const side of builder.revealed.values()) {
      if (side === 'left') move.left++
      else move.right++
    }
    if (builder.icon !== null) {
      const rarity = builder.icon.rarity
      move.landed = { id: builder.icon.id, kind: rarity === null ? 'plain' : 'chest', rarity }
    }
    // A cell that costs life is a trap; one that gives life or notes is an event.
    if (move.landed !== null) {
      if (move.life < 0) move.landed.kind = 'trap'
      else if (move.life > 0 || move.gained > 0) move.landed.kind = 'event'
      // A cell that showed a chest but gave none: the chest was not taken (the carried bar
      // holds seven, so a full bar leaves a chest behind). The log does not say why.
      else if (move.landed.kind === 'chest' && move.chest === null) this.session.chestsSkipped++
    }
    this.session.moves.push(move)
    this.session.cells += move.cells
    this.builder = null
  }

  /** A cell of the board vanished, appeared, or was shown to a side. */
  private cell(id: number, what: 'gone' | 'new' | 'left' | 'right'): void {
    const builder = this.builder
    if (builder === null) return
    if (what === 'left' || what === 'right') builder.revealed.set(id, what)
  }

  /** A path between two cells was drawn, or lit. */
  private path(id: number, lit: boolean): void {
    const builder = this.builder
    if (builder === null) return
    builder.drawn.add(id)
    if (lit) builder.lit.add(id)
  }

  /** A cell showed its icon. */
  private icon(id: number, rarity: Rarity | null): void {
    const builder = this.builder
    if (builder === null) return
    builder.icon = { id, rarity }
  }

  /** A chest of destiny entered the carried bar. */
  private chest(id: number, rarity: Rarity | null): void {
    const builder = this.builder
    if (builder === null || this.session === null) return
    const chest: Chest = { slot: id, rarity, at: builder.move.at, upgrades: 0 }
    builder.move.chest = chest
    this.session.chests.push(chest)
  }

  /** A chest of destiny's rarity was raised. */
  private chestUp(id: number): void {
    const builder = this.builder
    if (builder === null || this.session === null) return
    builder.move.upgraded.push(id)
    const chest = this.session.chests.find((c) => c.slot === id)
    if (chest !== undefined) chest.upgrades++
  }

  /** A card came into the hand, was used, or the hand was shuffled. */
  private hand(what: 'gained' | 'played' | 'shuffled'): void {
    const builder = this.builder
    if (this.session === null) return
    if (what === 'gained') {
      if (builder !== null) builder.move.gained++
      this.session.notes++
    } else if (what === 'played') {
      if (builder !== null) builder.move.played++
      this.session.played++
    } else if (builder !== null) {
      builder.move.shuffled = true
    }
  }

  /** The game told the player something. */
  private message(text: string): void {
    const builder = this.builder
    if (builder !== null) builder.move.messages.push(text)
    const life = /^Life ([+-])(\d+)$/.exec(text)
    if (life === null || this.session === null) return
    const delta = Number(life[2]) * (life[1] === '-' ? -1 : 1)
    if (builder !== null) builder.move.life += delta
    if (delta < 0) this.session.lifeLost -= delta
    else this.session.lifeWon += delta
  }

  /** The game asked for a sound. */
  private sound(name: string): void {
    if (name === 'BaoXiang_Open_01') this.chestOpened()
  }

  /** A chest of destiny was opened in the Fateful Contest. */
  private chestOpened(): void {
    if (this.contest === null) return
    const chest: OpenedChest = { at: this.lastAt, rewards: [] }
    this.contest.chests.push(chest)
    this.openChest = chest
  }

  /** The player went into a level: the Fateful Contest is a level of its own. */
  private level(ltype: number, at: number): void {
    if (ltype === CONTEST_LEVEL_TYPE) {
      if (this.contest === null) {
        this.contest = { askedAt: null, openedAt: at, closedAt: null, chests: [] }
        this.history.contests.push(this.contest)
      } else if (this.contest.openedAt === null) {
        this.contest.openedAt = at
      }
      this.inContest = true
      return
    }
    if (!this.inContest) return
    this.inContest = false
    this.openChest = null
    if (this.contest !== null) {
      this.contest.closedAt = at
      this.contest = null
    }
  }
}

