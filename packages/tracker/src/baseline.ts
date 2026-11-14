// The baseline prices: what the community says things are worth.
//
// The tracker learns prices from the exchange (the player's own searches) and the player can set
// them by hand; those two always win. Under them sits the baseline: the community prices of the
// [TITrack](https://github.com/astockman99/TITrack) project, whose players share what they saw on
// the auction house. The baseline is a floor for the items nobody looked up: it is never mixed into
// what was learned, and it is kept in a file of its own.
//
// TITrack keeps its prices in a Supabase database, and its table of aggregated prices is public to
// read: the project's own app reads it with the same publishable key (it is in TITrack's source, MIT
// licensed, and can only read). An item has one row per season, with the median of what players
// saw in FE over the last day and how many devices saw it. The seasons are separate economies, so
// the tracker asks for the one the player is in: the log says which (`SeasonId`), and when it has
// not said, the newest season that has enough prices.
//
// Every row counts, as it does in TITrack's own app: the count of devices only covers the last
// day, so a season that is not busy has no price that three devices saw, and the baseline is only
// a floor under what the player looked up. The credit TITrack is due is what `ATTRIBUTION` is for.
//
// The tracker asks for the prices a few times a day at most, and keeps them on disk, so it works
// the same when there is no network: the cache is used until it is old, and a failure is only a
// message.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { dataPath } from './items'

/** The project the prices come from. */
export const PRICES_SITE = 'https://github.com/astockman99/TITrack'

/** The database of the project; its REST interface is `/rest/v1`. */
export const PRICES_URL = 'https://qhjulyngunwiculnharg.supabase.co/rest/v1'

/** The key the project's own app reads the prices with. It is public and can only read. */
const PRICES_KEY = 'sb_publishable_YgqYSMUarrM_IKvcNpJlBw_KwTpp7ho'

/** The words shown where the prices are. */
export const ATTRIBUTION = 'Prices: TITrack community'

/** The link the attribution points at. */
export const ATTRIBUTION_URL = PRICES_SITE

/** The name the tracker says it is when it asks for the prices. */
export const USER_AGENT = 'tli-tools tracker'

/** The file the prices are kept in. */
export const BASELINE_FILE = 'baseline.json'

/** How long the prices on disk are good for. TITrack works its prices out every few minutes. */
export const BASELINE_MAX_AGE_MS = 60 * 60 * 1000

/** How long a request may take. */
export const TIMEOUT_MS = 20_000

/** How many prices a season needs before it is picked on its own. */
export const MIN_SEASON_ITEMS = 500

/** How many rows the database gives at most in one answer. */
const PAGE = 1000

/** More pages than this is not a list of prices. */
const MAX_PAGES = 50

/** What the community prices are. */
export interface BaselineData {
  /** when they were fetched, in ms */
  fetchedAt: number
  /** where they came from */
  source: string
  /** the season they are for; null when the file does not say (the prices of an older version) */
  season: number | null
  /** the price of each item, in FE */
  prices: [number, number][]
}

/** A season that has prices, as the database counts them. */
export interface Season {
  id: number
  items: number
}

/** Where the prices are kept. */
export function baselinePath(): string {
  return dataPath(BASELINE_FILE)
}

/**
 * Reads the prices out of the rows the database answered.
 *
 * A row carries the id of the item and its median price in FE. Anything that is not a price is
 * left out.
 */
export function parsePrices(payload: unknown): [number, number][] {
  if (!Array.isArray(payload)) return []
  const prices: [number, number][] = []
  for (const row of payload) {
    if (typeof row !== 'object' || row === null) continue
    if (!('config_base_id' in row) || !('price_fe_median' in row)) continue
    const item = row.config_base_id
    const price = row.price_fe_median
    if (typeof item !== 'number' || !Number.isFinite(item)) continue
    if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) continue
    prices.push([item, price])
  }
  return prices
}

/** Reads the seasons out of what the database answered. */
export function parseSeasons(payload: unknown): Season[] {
  if (!Array.isArray(payload)) return []
  const seasons: Season[] = []
  for (const row of payload) {
    if (typeof row !== 'object' || row === null) continue
    if (!('season_id' in row) || !('item_count' in row)) continue
    const id = row.season_id
    const items = Number(row.item_count)
    if (typeof id !== 'number' || !Number.isInteger(id) || !Number.isFinite(items)) continue
    seasons.push({ id, items })
  }
  return seasons
}

/**
 * The season to ask for when the log has not said which the player is in.
 *
 * Seasons that end in 01 are the ones everybody plays (the others are variants with an economy of
 * their own, with fewer items), so the newest of those that has enough prices; null when none has.
 */
export function pickSeason(seasons: Season[]): number | null {
  let best: number | null = null
  for (const season of seasons) {
    if (season.id <= 1 || season.id % 100 !== 1 || season.items < MIN_SEASON_ITEMS) continue
    if (best === null || season.id > best) best = season.id
  }
  return best
}

/** Asks the database and gives back what it answered. */
async function ask(path: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(`${PRICES_URL}${path}`, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      apikey: PRICES_KEY,
      'User-Agent': USER_AGENT,
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  })
  if (!response.ok) throw new Error(`the database answered ${response.status}`)
  return (await response.json()) as unknown
}

/** Fetches the community prices of a season; of the newest one that has enough when none is given. */
export async function fetchBaseline(now = Date.now(), season?: number | null): Promise<BaselineData> {
  let chosen = season ?? null
  if (chosen === null) {
    chosen = pickSeason(parseSeasons(await ask('/rpc/get_available_seasons', { method: 'POST', body: '{}' })))
    if (chosen === null) throw new Error('no season has prices')
  }
  const prices: [number, number][] = []
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const query =
      `/aggregated_prices?select=config_base_id,price_fe_median&season_id=eq.${chosen}` +
      `&order=config_base_id&limit=${PAGE}&offset=${page * PAGE}`
    const rows = await ask(query)
    if (!Array.isArray(rows)) throw new Error('the prices came back in a form that is not known')
    prices.push(...parsePrices(rows))
    if (rows.length < PAGE) break
  }
  if (prices.length === 0) throw new Error(`the prices of season ${chosen} came back empty`)
  return { fetchedAt: now, source: PRICES_SITE, season: chosen, prices }
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
      season: typeof raw.season === 'number' ? raw.season : null,
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
 * The season is the one given; else the one of the prices on disk, so a screen that does not know
 * the player's season keeps what the tracker chose; else the newest one that has enough prices.
 * The prices are put where every reader looks for them, so the tracker works without a network
 * again afterwards. How old they then are is what `baselineAge` says of what `readBaseline` gives
 * back.
 */
export async function refreshBaseline(
  now = Date.now(),
  path = baselinePath(),
  season?: number | null,
): Promise<BaselineData> {
  const chosen = season ?? (await readBaseline(path))?.season ?? null
  const data = await fetchBaseline(now, chosen)
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
export async function refreshBaselineStatus(
  now = Date.now(),
  path = baselinePath(),
  season?: number | null,
): Promise<BaselineRefresh> {
  try {
    const data = await refreshBaseline(now, path, season)
    return {
      ok: true,
      data,
      message: `the community prices are here: ${data.prices.length} items (season ${data.season})`,
    }
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

/**
 * Whether the prices are the ones of the season the player is in.
 *
 * They are when the log has not said which season it is (there is nothing to compare) or when the
 * seasons are the same; prices of an older version do not name their season, so they are not.
 */
export function baselineFits(data: BaselineData | null, season: number | null): boolean {
  if (data === null) return false
  return season === null || data.season === season
}
