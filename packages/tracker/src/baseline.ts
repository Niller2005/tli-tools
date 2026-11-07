// The baseline prices: what the community says things are worth.
//
// The tracker learns prices from the exchange (the player's own searches) and the player can set
// them by hand; those two always win. Under them sits the baseline: the community prices of
// [TLI Companion](https://tlicompanion.com), the site that collects the prices players saw on the
// auction house. The baseline is a floor for the items nobody looked up: it is never mixed into
// what was learned, and it is kept in a file of its own.
//
// The site has a documented public API (https://tlicompanion.com/api): read only, no key, open to
// every website, and the data changes at most every ten minutes. It asks for the prices to be
// credited where they are shown, which is what `ATTRIBUTION` is for.
//
// The tracker asks for the prices a few times a day at most, and keeps them on disk, so it works
// the same when there is no network: the cache is used until it is old, and a failure is only a
// message.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from './items'

/** The site the prices come from. */
export const PRICES_SITE = 'https://tlicompanion.com'

/** The API that gives the prices of every item. */
export const PRICES_URL = 'https://tlicompanion.com/api/public/v1/prices'

/** The words the site asks to have shown where its prices are. */
export const ATTRIBUTION = 'Prices: tlicompanion.com'

/** The link the attribution points at. */
export const ATTRIBUTION_URL = 'https://tlicompanion.com'

/** The name the tracker says it is when it asks for the prices. */
export const USER_AGENT = 'tli-tools tracker'

/** The file the prices are kept in. */
export const BASELINE_FILE = 'baseline.json'

/** How long the prices on disk are good for. The data changes at most every ten minutes. */
export const BASELINE_MAX_AGE_MS = 60 * 60 * 1000

/** How long a request may take. */
export const TIMEOUT_MS = 20_000

/** What the community prices are. */
export interface BaselineData {
  /** when they were fetched, in ms */
  fetchedAt: number
  /** where they came from */
  source: string
  /** the price of each item, in FE */
  prices: [number, number][]
}

/** Where the prices are kept. */
export function baselinePath(): string {
  return dataPath(BASELINE_FILE)
}

/**
 * Reads the prices out of what the API answered.
 *
 * The answer carries the id of the item and the price in FE. Anything that is not a price is left
 * out.
 */
export function parsePrices(payload: unknown): [number, number][] {
  if (typeof payload !== 'object' || payload === null) return []
  if (!('items' in payload)) return []
  const items = payload.items
  if (!Array.isArray(items)) return []
  const prices: [number, number][] = []
  for (const row of items) {
    if (typeof row !== 'object' || row === null) continue
    if (!('id' in row) || !('price' in row)) continue
    const item = row.id
    const price = row.price
    if (typeof item !== 'number' || !Number.isFinite(item)) continue
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
    prices.push([item, price])
  }
  return prices
}

/** Asks the API for the prices and gives back what it answered. */
async function ask(): Promise<unknown> {
  const response = await fetch(PRICES_URL, {
    headers: {
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`the site answered ${response.status}`)
  return (await response.json()) as unknown
}

/** Fetches the community prices. */
export async function fetchBaseline(now = Date.now()): Promise<BaselineData> {
  const prices = parsePrices(await ask())
  if (prices.length === 0) throw new Error('the prices came back empty')
  return { fetchedAt: now, source: PRICES_SITE, prices }
}

/** Reads the prices that were kept on disk; null when there are none, or they cannot be read. */
export async function readBaseline(path = baselinePath()): Promise<BaselineData | null> {
  try {
    const raw = JSON.parse(await readFile(path, 'utf8')) as Partial<BaselineData>
    if (typeof raw.fetchedAt !== 'number' || !Array.isArray(raw.prices)) return null
    const prices: [number, number][] = []
    for (const entry of raw.prices) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const item = entry[0]
      const price = entry[1]
      if (typeof item !== 'number' || typeof price !== 'number') continue
      prices.push([item, price])
    }
    return {
      fetchedAt: raw.fetchedAt,
      source: typeof raw.source === 'string' ? raw.source : PRICES_SITE,
      prices,
    }
  } catch {
    return null
  }
}

/** Keeps the prices on disk, so the tracker can use them without a network. */
export async function writeBaseline(data: BaselineData, path = baselinePath()): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp`
  await writeFile(tmp, `${JSON.stringify(data)}\n`)
  await rename(tmp, path)
}

/**
 * Fetches the community prices and keeps them on disk: the one entry a refresh key runs.
 *
 * It is the same fetch `fetchBaseline` makes — no behaviour of its own — and the prices are put
 * where every reader looks for them, so the tracker works without a network again afterwards.
 * How old they then are is what `baselineAge` says of what `readBaseline` gives back.
 */
export async function refreshBaseline(now = Date.now(), path = baselinePath()): Promise<BaselineData> {
  const data = await fetchBaseline(now)
  await writeBaseline(data, path)
  return data
}

/** What a refresh came to, and the line a screen says about it. */
export type BaselineRefresh =
  | { ok: true; data: BaselineData; message: string }
  | { ok: false; message: string }

/**
 * The refresh a key runs: `refreshBaseline` that never throws, with the words for the status line.
 *
 * A screen applies `data` to what it shows when the refresh worked, and shows `message` either way.
 */
export async function refreshBaselineStatus(now = Date.now(), path = baselinePath()): Promise<BaselineRefresh> {
  try {
    const data = await refreshBaseline(now, path)
    return { ok: true, data, message: `the community prices are here: ${data.prices.length} items` }
  } catch (error) {
    const why = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `the community prices could not be fetched: ${why}` }
  }
}

/** How old the prices are, in ms; null when there are none. */
export function baselineAge(data: BaselineData | null, now = Date.now()): number | null {
  if (data === null) return null
  return Math.max(0, now - data.fetchedAt)
}

/** Whether the prices are too old to be used. */
export function baselineIsStale(
  data: BaselineData | null,
  now = Date.now(),
  maxAge = BASELINE_MAX_AGE_MS,
): boolean {
  const age = baselineAge(data, now)
  if (age === null) return true
  return age > maxAge
}
