// The runs: one trip into a map, from the moment the player enters it to the moment they leave.
//
// The game says which level the player is in, with a type: 0 is the hideout, 3 is a map. A run
// starts when a map level is entered and ends when the player goes back to the hideout or into
// another level. The map's name comes from the level's path, which the game sends just after.
//
// The Tartarus prison is a run of its own. The board the warden reads opens in the town, and the
// challenge it leads into is a level of its own (type 28). The visit begins when the board opens
// and ends when the player leaves the prison level.

import { PRISON_NAME, zoneName } from './zones'

/** The level types that are a map the player farms. */
export const MAP_LEVEL_TYPES: Record<number, true> = { 3: true, 16: true, 17: true, 25: true, 27: true }

/** The level types that are the Tartarus prison. */
export const PRISON_LEVEL_TYPES: Record<number, true> = { 28: true }

/** The page that is the Tartarus prison board: the visit begins when the board opens. */
export const PRISON_PAGES: Record<string, true> = { S16BoardMain: true }

/** What kind of run it is: a trip into a map, or a visit to the Tartarus prison. */
export type RunKind = 'map' | 'prison'

/** One trip into a map. */
export interface Run {
  /** the run's number, in order */
  id: number
  /** what kind of run it is */
  kind: RunKind
  /** the map's own name, as the game calls it */
  zone: string
  /** the map's English name */
  name: string
  /** the level's id */
  levelId: number
  /** when the run started, in ms */
  start: number
  /** when it ended, in ms; null while it is still going */
  end: number | null
  /** what was picked up in it: the item and how many */
  loot: Map<number, number>
  /** what it cost to run it: the item and how many (the beacon, the key) */
  cost: Map<number, number>
  /** the FE that was made in it, when the player sold something */
  fe: number
}

function bump(map: Map<number, number>, item: number, by: number): void {
  const now = (map.get(item) ?? 0) + by
  if (now === 0) map.delete(item)
  else map.set(item, now)
}

/** Splits the log's levels into runs, and puts the loot in them. */
export class RunSegmenter {
  private current: Run | null = null
  private nextId = 1
  /** the cost of entering a map is said before the map starts; it waits here for the run */
  private pendingCost = new Map<number, number>()

  /** The run that is going on, if there is one. */
  get currentRun(): Run | null {
    return this.current
  }

  /** Sets the number the next run gets. */
  setNextId(id: number): void {
    this.nextId = id
  }

  /** The level the player is in changed. Ends the run that was going on, if any. */
  level(ltype: number, lid: number, at: number): Run | null {
    if (PRISON_LEVEL_TYPES[ltype] === true) return this.prison(lid, at)
    const ended = this.endRun(at)
    if (MAP_LEVEL_TYPES[ltype] !== true) return ended
    this.current = this.newRun('map', lid, at)
    return ended
  }

  /**
   * The Tartarus prison's level began.
   *
   * The visit that began on the board goes on into the level: the board is closed by the game
   * when the level opens, so the visit is one run, from the board to the end of the level.
   */
  private prison(lid: number, at: number): Run | null {
    const current = this.current
    if (current !== null && current.kind === 'prison') {
      current.levelId = lid
      return null
    }
    const ended = this.endRun(at)
    this.current = this.newRun('prison', lid, at)
    return ended
  }

  /** A page of the game opened, was hidden, or was destroyed. */
  screen(name: string, state: 'run' | 'hide' | 'destory', at: number): void {
    if (PRISON_PAGES[name] !== true) return
    if (state === 'run') this.board(at)
    if (state === 'destory') this.boardClosed()
  }

  /** The prison board opened: the visit begins. */
  private board(at: number): void {
    if (this.current !== null) return
    this.current = this.newRun('prison', 0, at)
  }

  /**
   * The prison board was destroyed.
   *
   * The game closes the board when the prison level opens, so a visit that is already in its
   * level goes on. A visit that never had a level is not a run: the player closed the board
   * without a challenge, so there is nothing to show.
   */
  private boardClosed(): void {
    const current = this.current
    if (current === null || current.kind !== 'prison') return
    if (current.levelId !== 0) return
    this.dropCurrent()
  }

  /** Throws the run that was going on away: it never became a run. */
  private dropCurrent(): void {
    if (this.current === null) return
    // the number of a run that never was is free again
    this.nextId = this.current.id
    this.current = null
  }

  /** The map the player is in was named. The game sends this right after the level it belongs to. */
  path(zone: string): void {
    const current = this.current
    if (current === null) return
    if (current.zone !== '') return
    current.zone = zone
    if (current.kind !== 'prison') current.name = zoneName(zone)
  }

  /** Ends the run that was going on, if there is one. */
  endRun(at: number): Run | null {
    if (this.current === null) return null
    this.current.end = at
    const run = this.current
    this.current = null
    return run
  }

  /** Puts a run that was going on back, after the tracker was restarted. */
  restoreCurrent(run: Run): void {
    this.current = run
    if (run.id >= this.nextId) this.nextId = run.id + 1
  }

  /** Something was picked up. */
  loot(item: number, qty: number): void {
    if (this.current === null) return
    bump(this.current.loot, item, qty)
  }

  /** Something was spent to run the map: the beacon that opens it, the key that gets in. */
  cost(item: number, amount: number): void {
    if (this.current === null) {
      bump(this.pendingCost, item, amount)
      return
    }
    bump(this.current.cost, item, amount)
  }

  /** The FE the player made. */
  fe(qty: number): void {
    if (this.current === null) return
    this.current.fe += qty
  }

  /** A run that begins now. */
  private newRun(kind: RunKind, lid: number, at: number): Run {
    const run: Run = {
      id: this.nextId++,
      kind,
      zone: '',
      name: kind === 'prison' ? PRISON_NAME : 'Unknown',
      levelId: lid,
      start: at,
      end: null,
      loot: new Map(),
      cost: new Map(this.pendingCost),
      fe: 0,
    }
    this.pendingCost.clear()
    return run
  }
}
