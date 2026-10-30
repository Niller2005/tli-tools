// The runs: one trip into a map, from the moment the player enters it to the moment they leave.
//
// The game says which level the player is in, with a type: 0 is the hideout, 3 is a map. A run
// starts when a map level is entered and ends when the player goes back to the hideout or into
// another level. The map's name comes from the level's path, which the game sends just after.

import { zoneName } from './zones'

/** The level types that are a map the player farms. */
export const MAP_LEVEL_TYPES: Record<number, true> = { 3: true, 16: true, 17: true, 25: true, 27: true }

/** One trip into a map. */
export interface Run {
  /** the run's number, in order */
  id: number
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
    const ended = this.endRun(at)
    if (MAP_LEVEL_TYPES[ltype] !== true) return ended
    const run: Run = {
      id: this.nextId++,
      zone: '',
      name: 'Unknown',
      levelId: lid,
      start: at,
      end: null,
      loot: new Map(),
      cost: new Map(this.pendingCost),
      fe: 0,
    }
    this.pendingCost.clear()
    this.current = run
    return ended
  }

  /** The map the player is in was named. The game sends this right after the level it belongs to. */
  path(zone: string): void {
    if (this.current === null) return
    if (this.current.zone !== '') return
    this.current.zone = zone
    this.current.name = zoneName(zone)
  }

  /** Ends the run that is going on, if there is one. */
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
}
