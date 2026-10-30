// What the screen is showing, and the rows it is made of.
//
// The rows are plain data: the drawing in `render.ts` turns them into lines. That way the numbers
// can be looked at without a terminal.

import type { Tracker } from '@tli/tracker'

/** The panels the player can move in. */
export type Panel = 'runs' | 'inventory' | 'prices'

/** The panels, in the order the tab key goes through them. */
export const PANELS: Panel[] = ['runs', 'inventory', 'prices']

/** What the screen is showing. */
export interface ViewState {
  /** the panel the keys move in */
  focus: Panel
  /** the run that is picked out */
  runsAt: number
  /** the item that is picked out in the bag */
  inventoryAt: number
  /** the item that is picked out in the prices */
  pricesAt: number
  /** how the bag is sorted */
  inventorySort: 'value' | 'qty' | 'name'
  /** how the prices are sorted */
  pricesSort: 'value' | 'name'
  /** the run whose detail is open, or null */
  detail: number | null
  /** the price that is being typed in, or null */
  editing: { item: number; text: string } | null
  /** whether the clock is stopped */
  paused: boolean
  /** what the tracker says at the bottom of the screen */
  message: string
  /** the log the tracker is reading */
  logFile: string
  /** what is wrong with the log, if anything */
  logNote: string
  /** the time now */
  now: number
}

/** The state a fresh screen starts in. */
export function freshView(logFile: string, now: number): ViewState {
  return {
    focus: 'runs',
    runsAt: 0,
    inventoryAt: 0,
    pricesAt: 0,
    inventorySort: 'value',
    pricesSort: 'value',
    detail: null,
    editing: null,
    paused: false,
    message: '',
    logFile,
    logNote: '',
    now,
  }
}

/** A row of the bag: the item, how many there are and what they are worth. */
export interface BagRow {
  item: number
  name: string
  qty: number
  worth: number
  price: number
}

/** A row of the price list: the item, what it is worth and where that came from. */
export interface PriceRow {
  item: number
  name: string
  price: number
  source: 'set' | 'learned'
  samples: number
}

/** The bag, as rows, in the order the screen shows them. */
export function bagRows(tracker: Tracker, sort: ViewState['inventorySort']): BagRow[] {
  const rows: BagRow[] = []
  for (const [item, qty] of tracker.inventory.totals()) {
    const price = tracker.prices.price(item)
    rows.push({ item, name: tracker.names.name(item), qty, price, worth: price * qty })
  }
  rows.sort((a, b) => {
    if (sort === 'qty') return b.qty - a.qty || a.name.localeCompare(b.name)
    if (sort === 'name') return a.name.localeCompare(b.name)
    return b.worth - a.worth || b.qty - a.qty
  })
  return rows
}

/** The prices the tracker knows, as rows. */
export function priceRows(tracker: Tracker, sort: ViewState['pricesSort']): PriceRow[] {
  const rows: PriceRow[] = []
  const seen = new Set<number>()
  for (const [item, price] of tracker.prices.snapshot().overrides) {
    rows.push({ item, name: tracker.names.name(item), price, source: 'set', samples: 0 })
    seen.add(item)
  }
  for (const [item, info] of tracker.prices.snapshot().learned) {
    if (seen.has(item)) continue
    rows.push({
      item,
      name: tracker.names.name(item),
      price: info.price,
      source: 'learned',
      samples: info.samples,
    })
  }
  rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    return b.price - a.price
  })
  return rows
}
