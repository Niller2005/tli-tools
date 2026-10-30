// The bag: which items are in which slot, and how many of each the player has.
//
// The game says three things about the bag, and all three end up here:
//   - `ItemChange@ Add|Update Id=<base>_<instance> BagNum=<n> in PageId=<p> SlotId=<s>`: the
//     instance is in that slot now, with that many of it.
//   - `ItemChange@ Delete Id=<base>_<instance> in PageId=<p> SlotId=<s>`: the instance is gone.
//   - `BagMgr@:InitBagData PageId=<p> SlotId=<s> ConfigBaseId=<c> Num=<n>`: the whole page, as it
//     is (the game sends this when the bag is sorted).
//
// A slot's count is absolute, so a change is the difference against what was there before. Every
// change is a delta: how much of an item the player gained or lost.

/** How much of an item changed. */
export interface Delta {
  item: number
  delta: number
}

/** What a slot holds. */
interface Slot {
  item: number
  num: number
  uuid: string | null
}

/** Where an instance of an item is. */
interface Instance {
  item: number
  page: number
  slot: number
  num: number
}

/** The pages the bag has. Page 100 is the gear, 101 the skills, 102 the currencies, 103 the
 * beacons and cards; 1 and 2 are the stash. Negative pages are the gear on the character and the
 * skill bar, which are not in the bag. */
export const BAG_PAGES = [1, 2, 100, 101, 102, 103]

/** The bag, as the log describes it. */
export class Inventory {
  private readonly slots = new Map<string, Slot>()
  private readonly instances = new Map<string, Instance>()
  private readonly counts = new Map<number, number>()

  private static key(page: number, slot: number): string {
    return `${page}:${slot}`
  }

  /** Whether a page is one the bag keeps its items in. */
  static tracked(page: number): boolean {
    return page >= 0
  }

  private adjust(item: number, by: number): void {
    const now = (this.counts.get(item) ?? 0) + by
    if (now === 0) this.counts.delete(item)
    else this.counts.set(item, now)
  }

  /**
   * A slot holds an item now.
   *
   * `uuid` is the game's id for the stack, when the line had one: the same stack can move from
   * slot to slot, and the tracker follows it so that a move is not counted as a gain.
   *
   * `op` says how the slot came to hold it. A stack that changed (`update`) is only a gain of what
   * it grew by; when the tracker has not seen the stack before, it does not know what it grew by,
   * and says nothing. A new item (`add`) and the whole page (`init`) are known in full.
   */
  set(page: number, slot: number, item: number, num: number, uuid: string | null, op: 'add' | 'update' | 'init'): Delta[] {
    if (!Inventory.tracked(page)) return []
    const key = Inventory.key(page, slot)
    const touched = new Set<number>()
    const before = new Map<number, number>()
    const note = (i: number): void => {
      if (touched.has(i)) return
      touched.add(i)
      before.set(i, this.counts.get(i) ?? 0)
    }

    note(item)
    const prev = uuid === null ? undefined : this.instances.get(uuid)
    if (prev !== undefined && uuid !== null) {
      note(prev.item)
      if (prev.page !== page || prev.slot !== slot) {
        // the stack moved here from another slot
        this.adjust(prev.item, -prev.num)
        const from = Inventory.key(prev.page, prev.slot)
        if (this.slots.get(from)?.uuid === uuid) this.slots.delete(from)
        this.instances.delete(uuid)
      }
    }

    const old = this.slots.get(key)
    const known = old !== undefined || prev !== undefined
    if (old !== undefined) {
      note(old.item)
      const oldUuid = old.uuid
      if (oldUuid !== null && oldUuid !== uuid) this.instances.delete(oldUuid)
      this.adjust(old.item, -old.num)
      this.slots.delete(key)
    }

    this.adjust(item, num)
    this.slots.set(key, { item, num, uuid })
    if (uuid !== null) this.instances.set(uuid, { item, page, slot, num })

    const deltas = Inventory.deltas(touched, before, this.counts)
    if (op === 'update' && !known) {
      // the stack was already there; the tracker just did not know how big it was
      return deltas.map((d) => ({ item: d.item, delta: 0 })).filter((d) => d.delta !== 0)
    }
    return deltas
  }

  /** A slot lost its item. */
  clear(page: number, slot: number, uuid: string | null): Delta[] {
    if (!Inventory.tracked(page)) return []
    const touched = new Set<number>()
    const before = new Map<number, number>()
    const note = (i: number): void => {
      if (touched.has(i)) return
      touched.add(i)
      before.set(i, this.counts.get(i) ?? 0)
    }

    const prev = uuid === null ? undefined : this.instances.get(uuid)
    if (prev !== undefined && uuid !== null) {
      note(prev.item)
      this.adjust(prev.item, -prev.num)
      const from = Inventory.key(prev.page, prev.slot)
      if (this.slots.get(from)?.uuid === uuid) this.slots.delete(from)
      this.instances.delete(uuid)
    } else {
      const key = Inventory.key(page, slot)
      const old = this.slots.get(key)
      if (old === undefined) return []
      note(old.item)
      const oldUuid = old.uuid
      if (oldUuid !== null) this.instances.delete(oldUuid)
      this.adjust(old.item, -old.num)
      this.slots.delete(key)
    }

    return Inventory.deltas(touched, before, this.counts)
  }

  /** A whole page was emptied. */
  resetPage(page: number): Delta[] {
    if (!Inventory.tracked(page)) return []
    const touched = new Set<number>()
    const before = new Map<number, number>()
    const note = (i: number): void => {
      if (touched.has(i)) return
      touched.add(i)
      before.set(i, this.counts.get(i) ?? 0)
    }

    for (const [key, slot] of [...this.slots]) {
      if (!key.startsWith(`${page}:`)) continue
      note(slot.item)
      if (slot.uuid !== null) this.instances.delete(slot.uuid)
      this.adjust(slot.item, -slot.num)
      this.slots.delete(key)
    }

    return Inventory.deltas(touched, before, this.counts)
  }

  /** How much of each item changed, by how much it was before. */
  private static deltas(touched: Set<number>, before: Map<number, number>, counts: Map<number, number>): Delta[] {
    const out: Delta[] = []
    for (const item of touched) {
      const change = (counts.get(item) ?? 0) - (before.get(item) ?? 0)
      if (change !== 0) out.push({ item, delta: change })
    }
    return out
  }

  /** How many of each item the player has. */
  totals(): Map<number, number> {
    return new Map(this.counts)
  }

  /** How many of one item the player has. */
  count(item: number): number {
    return this.counts.get(item) ?? 0
  }

  /** The slots, as they are now: "page:slot" to what is in them. */
  snapshot(): { key: string; item: number; num: number; uuid: string | null }[] {
    return [...this.slots].map(([key, slot]) => ({ key, item: slot.item, num: slot.num, uuid: slot.uuid }))
  }

  /** The instances, as they are now: the game's id to where the stack is. */
  instancesSnapshot(): { uuid: string; item: number; page: number; slot: number; num: number }[] {
    return [...this.instances].map(([uuid, inst]) => ({ uuid, ...inst }))
  }

  /** Puts a saved bag back. */
  restore(
    slots: { key: string; item: number; num: number; uuid: string | null }[],
    instances: { uuid: string; item: number; page: number; slot: number; num: number }[],
  ): void {
    this.slots.clear()
    this.instances.clear()
    this.counts.clear()
    for (const s of slots) {
      this.slots.set(s.key, { item: s.item, num: s.num, uuid: s.uuid })
      this.adjust(s.item, s.num)
    }
    for (const i of instances) this.instances.set(i.uuid, { item: i.item, page: i.page, slot: i.slot, num: i.num })
  }
}
