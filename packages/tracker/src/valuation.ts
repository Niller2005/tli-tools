// What a pile of loot is worth.
//
// Everything is priced in Flame Elementium (FE), the game's currency: the exchange's prices are in
// FE, so a loot's value is what it would fetch on the exchange. Selling on the exchange costs a
// tax of 12.5% on everything but FE itself, so the tracker can show what the loot is worth before
// the tax and after it.

import { FE_ITEM } from './exchange'

/** The tax the exchange takes, on everything but FE. */
export const TRADE_TAX = 0.125

/** A pile of items and what they are worth. */
export interface Value {
  /** what the items are worth before the tax */
  gross: number
  /** what the tax comes to */
  tax: number
  /** what is left after the tax */
  net: number
  /** the FE in the pile */
  fe: number
}

/** What a pile of items is worth. */
export function valueOf(items: Iterable<[number, number]>, price: (item: number) => number, taxed: boolean): Value {
  let gross = 0
  let fe = 0
  for (const [item, qty] of items) {
    const worth = price(item) * qty
    gross += worth
    if (item === FE_ITEM) fe += worth
  }
  const tax = taxed ? (gross - fe) * TRADE_TAX : 0
  return { gross, tax, net: gross - tax, fe }
}

/** How long a run took, in milliseconds; zero when it is still going. */
export function durationOf(start: number, end: number | null, now: number): number {
  return Math.max(0, (end ?? now) - start)
}

/** An amount of FE in an hour; zero when there was no time. */
export function perHour(amount: number, milliseconds: number): number {
  if (milliseconds <= 0) return 0
  return (amount * 3_600_000) / milliseconds
}
