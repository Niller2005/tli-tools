// What the screen is showing, and the rows it is made of.
//
// The rows are plain data: the screen in `screen.ts` turns them into something that can be drawn.
// That way the numbers can be looked at without a terminal.

import type { AffixRow, ExchangeKind, RunKind, RunTotals, Run, Session, Tracker } from '@tli/tracker'

/** The pages that cover the screen: what the modifiers of the maps paid, the exchange, the sessions. */
export type Page = 'affixes' | 'exchange' | 'sessions'

/** The key that opens each page. */
export const PAGE_KEYS: Record<string, Page> = { f: 'affixes', h: 'exchange', g: 'sessions' }

/** The panels the player can move in. */
export type Panel = 'runs' | 'inventory' | 'prices'

/** The panels that can be searched. */
export type SearchPanel = 'inventory' | 'prices'

/** The panels, in the order the tab key goes through them. */
export const PANELS: Panel[] = ['runs', 'inventory', 'prices']

/** One entry of the menu: the key that does it, and what it does. */
export interface MenuItem {
  key: string
  label: string
  section: string
}

/** The menu the m key opens; every entry is also a key of its own. */
export const MENU: MenuItem[] = [
  { section: 'Prices', key: 'e', label: 'Set the price of the picked item' },
  { section: 'Prices', key: 'u', label: 'Reset a hand-set price to the learned one' },
  { section: 'Prices', key: 'd', label: 'Remove the picked item from the prices' },
  { section: 'Prices', key: 'z', label: 'Clear every price learned from searches' },
  { section: 'Prices', key: 'b', label: 'Fetch the community prices again' },
  { section: 'Run', key: 't', label: 'Trade tax on or off' },
  { section: 'Run', key: 'c', label: 'Map cost counts against the profit or not' },
  { section: 'Run', key: 'p', label: 'Stop or start the clock' },
  { section: 'Run', key: 'x', label: 'Write the CSV report' },
  { section: 'Sessions', key: 'n', label: 'Start a session of your own (it asks for a name)' },
  { section: 'Sessions', key: 'N', label: 'End the session that is going on' },
  { section: 'Pages', key: 'f', label: 'Which map modifiers paid' },
  { section: 'Pages', key: 'h', label: 'What you did at the exchange' },
  { section: 'Pages', key: 'g', label: 'The sessions, added up' },
  { section: 'Windows', key: 'a', label: 'Open Arcana in a window' },
  { section: 'Windows', key: 'v', label: 'Open Vorax in a window' },
  { section: 'Windows', key: 'w', label: 'Open Warden in a window' },
  { section: 'Windows', key: 'o', label: 'Loot card over the game: off, bottom-left, bottom-right' },
  { section: 'List', key: 's', label: 'Change how the list is sorted' },
  { section: 'List', key: '/', label: 'Search the list' },
  { section: 'List', key: 'i', label: 'Open the wiki page of the picked item' },
  { section: 'Other', key: '?', label: 'Help' },
  { section: 'Other', key: 'q', label: 'Quit' },
]

/** The input box that is open at the footer: what it asks for, and what is typed in it so far. */
export type OpenBox =
  | { kind: 'price'; item: number; name: string; text: string }
  | { kind: 'name'; text: string }
  | { kind: 'search'; panel: SearchPanel; text: string }

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
  /** the words the rows of the bag have to match */
  inventoryFilter: string
  /** the words the rows of the prices have to match */
  pricesFilter: string
  /** the run whose detail is open, or null */
  detail: number | null
  /** the page that covers the screen, or null */
  page: Page | null
  /** the input box that is open at the footer, or null when none is */
  box: OpenBox | null
  /** the entry that is picked out in the menu, or null when it is closed */
  menu: number | null
  /** whether the help is open */
  help: boolean
  /** the corner of the screen the loot card is shown in over the game, or null when it is off */
  overlay: 'bottom-left' | 'bottom-right' | null
  /** whether the clock is stopped */
  paused: boolean
  /** what the tracker says at the bottom of the screen */
  message: string
  /** when the community prices were fetched, in ms; null when there are none */
  baselineAt: number | null
  /** how many community prices there are */
  baselineCount: number
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
    inventoryFilter: '',
    pricesFilter: '',
    box: null,
    detail: null,
    page: null,
    help: false,
    menu: null,
    paused: false,
    overlay: null,
    message: '',
    baselineAt: null,
    baselineCount: 0,
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
  source: 'set' | 'learned' | 'baseline'
  samples: number
}

/** A row of the recent runs list. */
export interface RunRow {
  id: number
  /** what kind of run it is: a trip into a map, or a visit to the prison */
  kind: RunKind
  name: string
  /** when the run started */
  started: number
  /** when the run ended, or null when it is still going */
  ended: number | null
  /** how long the run took, in ms */
  took: number
  /** what the run was worth */
  worth: number
}

/** A row of loot: the item, how many there are and what they are worth. */
export interface LootRow {
  item: number
  name: string
  qty: number
  worth: number
}

/** The rows of a list, and how many rows it has without a filter. */
export interface Rows<T> {
  /** the rows that match the filter */
  rows: T[]
  /** how many rows the list has in all */
  total: number
}

/** The bag, as rows, in the order the screen shows them. */
export function bagRows(
  tracker: Tracker,
  sort: ViewState['inventorySort'],
  filter = '',
): Rows<BagRow> {
  const rows: BagRow[] = []
  // a gear base the log has named is the legendary it became: it is shown and priced as that
  const totals = new Map<number, number>()
  for (const [item, qty] of tracker.inventory.totals()) {
    const id = tracker.itemOf(item)
    totals.set(id, (totals.get(id) ?? 0) + qty)
  }
  for (const [item, qty] of totals) {
    const price = tracker.prices.price(item)
    rows.push({ item, name: tracker.names.name(item), qty, price, worth: price * qty })
  }
  rows.sort((a, b) => {
    if (sort === 'qty') return b.qty - a.qty || a.name.localeCompare(b.name)
    if (sort === 'name') return a.name.localeCompare(b.name)
    return b.worth - a.worth || b.qty - a.qty
  })
  return { rows: filterRows(rows, filter), total: rows.length }
}

/** The prices the tracker knows, as rows. */
export function priceRows(
  tracker: Tracker,
  sort: ViewState['pricesSort'],
  filter = '',
): Rows<PriceRow> {
  const snapshot = tracker.prices.snapshot()
  const rows: PriceRow[] = []
  const seen = new Set<number>()
  for (const [item, price] of snapshot.overrides) {
    rows.push({ item, name: tracker.names.name(item), price, source: 'set', samples: 0 })
    seen.add(item)
  }
  for (const [item, info] of snapshot.learned) {
    if (seen.has(item)) continue
    rows.push({
      item,
      name: tracker.names.name(item),
      price: info.price,
      source: 'learned',
      samples: info.samples,
    })
    seen.add(item)
  }
  for (const [item, price] of tracker.prices.baselineEntries()) {
    if (seen.has(item)) continue
    rows.push({
      item,
      name: tracker.names.name(item),
      price,
      source: 'baseline',
      samples: 0,
    })
  }
  rows.sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name)
    return b.price - a.price
  })
  return { rows: filterRows(rows, filter), total: rows.length }
}

/** The words of a filter, in lower case. */
function filterTerms(filter: string): string[] {
  return filter
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term !== '')
}

/** Whether a row matches the words of a filter: all of them have to match. */
export function matchesFilter(name: string, item: number, filter: string): boolean {
  const terms = filterTerms(filter)
  if (terms.length === 0) return true
  const lower = name.toLowerCase()
  const words = lower.split(/\s+/)
  return terms.every((term) => matchesTerm(lower, words, item, term))
}

/** Whether one word of a filter matches a row: the name, the id of the item, or the start of a word of the name. */
function matchesTerm(lower: string, words: string[], item: number, term: string): boolean {
  if (lower.includes(term)) return true
  if (String(item) === term) return true
  return words.some((word) => word.startsWith(term))
}

/** The rows of a list that match the words of a filter. */
function filterRows<T extends { item: number; name: string }>(rows: T[], filter: string): T[] {
  if (filter.trim() === '') return rows
  return rows.filter((row) => matchesFilter(row.name, row.item, filter))
}

/** The runs, newest first. */
export function runRows(tracker: Tracker, now: number): RunRow[] {
  return [...tracker.runs]
    .reverse()
    .map((run) => ({
      id: run.id,
      kind: run.kind,
      name: run.name,
      started: run.start,
      ended: run.end,
      took: Math.max(0, (run.end ?? now) - run.start),
      worth: tracker.valueOfRun(run).gross,
    }))
}

/** The loot of a run, the most valuable first. */
export function lootRows(tracker: Tracker, loot: Map<number, number>): LootRow[] {
  const rows: LootRow[] = []
  // a gear base the log has named is the legendary it became: it is shown and priced as that
  const totals = new Map<number, number>()
  for (const [item, qty] of loot) {
    const id = tracker.itemOf(item)
    totals.set(id, (totals.get(id) ?? 0) + qty)
  }
  for (const [item, qty] of totals) {
    rows.push({ item, name: tracker.names.name(item), qty, worth: qty * tracker.prices.price(item) })
  }
  rows.sort((a, b) => b.worth - a.worth || b.qty - a.qty)
  return rows
}

/** The run whose detail is open, or null. */
export function findRun(tracker: Tracker, id: number | null): Run | null {
  if (id === null) return null
  return tracker.runs.find((candidate) => candidate.id === id) ?? null
}

/** A modifier of the maps and what the maps that had it were worth, for the page of them. */
export function affixRows(tracker: Tracker): AffixRow[] {
  return tracker.affixReport(3)
}

/** One thing the player did at the exchange, as a row. */
export interface TradeRow {
  id: number
  at: number
  kind: ExchangeKind
  /** what changed in the bag, the FE left out, the most valuable first */
  items: { item: number; name: string; delta: number }[]
  /** what the FE in the bag changed by; 0 when it did not */
  fe: number
}

/** The exchange entries, newest first. */
export function tradeRows(tracker: Tracker): TradeRow[] {
  const fe = 100300
  return [...tracker.trades].reverse().map((entry) => ({
    id: entry.id,
    at: entry.at,
    kind: entry.kind,
    items: entry.items
      .filter(([item]) => item !== fe)
      .map(([item, delta]) => ({ item, name: tracker.names.name(tracker.itemOf(item)), delta }))
      .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)),
    fe: entry.items.find(([item]) => item === fe)?.[1] ?? 0,
  }))
}

/** What the exchange cost and what it paid, over the entries that are kept. */
export function tradeTotals(tracker: Tracker): { spent: number; received: number } {
  let spent = 0
  let received = 0
  for (const row of tradeRows(tracker)) {
    if (row.fe < 0) spent -= row.fe
    else received += row.fe
  }
  return { spent, received }
}

/** A session and what its runs came to. */
export interface SessionRow {
  session: Session
  totals: RunTotals
  /** whether it is the one that is going on */
  active: boolean
}

/** The sessions, newest first. */
export function sessionRows(tracker: Tracker, now: number): SessionRow[] {
  const rows: SessionRow[] = []
  for (const session of [...tracker.sessions].reverse()) {
    const totals = tracker.sessionTotals(session.id, now)
    if (totals === null) continue
    rows.push({ session, totals, active: session.end === null })
  }
  return rows
}
