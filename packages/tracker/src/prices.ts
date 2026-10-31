// What things are worth.
//
// The exchange's prices are what the tracker learns: when the player looks an item up, the prices of
// the listings come back and the tracker keeps the tenth of them, which is close to what a quick
// sale gets. The player can also set a price by hand, which wins over what was learned.

import { FE_ITEM } from './exchange'

/** What the tracker knows about one item's price. */
export interface PriceInfo {
  /** the price in FE */
  price: number
  /** how many searches this came from */
  samples: number
  /** how many listings the last search had */
  listings: number
  /** when it was last seen */
  at: number
}

/**
 * The price of an item, from the listings: the tenth of them, low to high.
 *
 * The tenth is a balance: the very lowest listing is often a scam or a bait, the middle is what
 * most people ask for, and the tenth is about what a quick sale gets.
 */
export function referencePrice(prices: number[]): number {
  if (prices.length === 0) return 0
  const sorted = [...prices].sort((a, b) => a - b)
  const index = Math.max(0, Math.floor(sorted.length * 0.1) - 1)
  return sorted[index] ?? 0
}

/** The prices the tracker knows: what it learned, and what the player set. */
export class PriceStore {
  private readonly learned = new Map<number, PriceInfo>()
  private readonly overrides = new Map<number, number>()

  /** What the player set by hand, or null when the price was only learned. */
  override(item: number): number | null {
    return this.overrides.get(item) ?? null
  }

  /** Sets a price by hand; null takes the hand-set price away. */
  setOverride(item: number, price: number | null): void {
    if (price === null) this.overrides.delete(item)
    else this.overrides.set(item, price)
  }

  /** Keeps what a search found. */
  learn(item: number, prices: number[], at: number): void {
    const price = referencePrice(prices)
    if (price <= 0) return
    const old = this.learned.get(item)
    this.learned.set(item, {
      price,
      samples: (old?.samples ?? 0) + 1,
      listings: prices.length,
      at,
    })
  }

  /** Drops everything known about an item's price, the learned one and the hand-set one. */
  forget(item: number): boolean {
    const had = this.learned.delete(item)
    return this.overrides.delete(item) || had
  }

  /** What the item is worth: what the player set, else what was learned. */
  price(item: number): number {
    const set = this.overrides.get(item)
    if (set !== undefined) return set
    if (item === FE_ITEM) return 1
    return this.learned.get(item)?.price ?? 0
  }

  /** Whether the price was set by hand. */
  isOverride(item: number): boolean {
    return this.overrides.has(item)
  }

  /** What was learned about an item. */
  info(item: number): PriceInfo | null {
    return this.learned.get(item) ?? null
  }

  /** Everything the tracker knows, for saving. */
  snapshot(): { learned: [number, PriceInfo][]; overrides: [number, number][] } {
    return {
      learned: [...this.learned],
      overrides: [...this.overrides],
    }
  }

  /** Puts the saved prices back. */
  restore(learned: [number, PriceInfo][], overrides: [number, number][]): void {
    this.learned.clear()
    this.overrides.clear()
    for (const [item, info] of learned) this.learned.set(item, info)
    for (const [item, price] of overrides) this.overrides.set(item, price)
  }
}
