// The Torchlight: Infinite loot tracker.
//
// The tracker reads the game's log file and works out what the player picked up on each trip into
// a map, what it is worth, and what the player has.
//
//   import { Tracker, ItemNames } from '@tli/tracker'
//
//   const names = await ItemNames.load()
//   const tracker = new Tracker({ names })
//   tracker.feed(lines)
//
// The parts: `parse` reads the log's lines, `inventory` keeps the bag, `runs` splits the log into
// runs, `prices` keeps what the exchange said, `baseline` brings the community prices, `valuation`
// turns loot into FE, `engine` ties them together and `store` saves the result.

export {
  Tracker,
  LOOT_PROTOS,
  COST_PROTOS,
  MONEY_PROTOS,
  MAX_RUNS,
  STATE_VERSION,
  migrateState,
} from './engine'
export type {
  AffixRow,
  RunTotals,
  SavedExchange,
  SavedRun,
  SavedSession,
  SavedState,
  Stats,
  TrackerOptions,
} from './engine'
export { UNKNOWN_CHARACTER, MAX_TRADES, EXCHANGE_PROTOS, type ExchangeEntry, type ExchangeKind, type Session } from './character'
export { XpMeter, expToNext, LEVEL_EXP, type XpState } from './xp'
export { AffixDumpReader, cleanDescription, type AffixText } from './affixes'
export { parseLine, logTime, zoneOf, type Fact } from './parse'
export { Inventory, BAG_PAGES, type Delta } from './inventory'
export {
  RunSegmenter,
  MAP_LEVEL_TYPES,
  PRISON_LEVEL_TYPES,
  PRISON_PAGES,
  type Run,
  type RunKind,
} from './runs'
export { PriceStore, referencePrice, type PriceInfo } from './prices'
export {
  ATTRIBUTION,
  ATTRIBUTION_URL,
  BASELINE_FILE,
  BASELINE_MAX_AGE_MS,
  PRICES_SITE,
  PRICES_URL,
  baselineAge,
  baselineIsStale,
  baselinePath,
  fetchBaseline,
  parsePrices,
  readBaseline,
  writeBaseline,
  type BaselineData,
} from './baseline'
export { ExchangeParser, FE_ITEM, parseQuote, parseRequest, type Quote } from './exchange'
export { valueOf, durationOf, perHour, TRADE_TAX, type Value } from './valuation'
export { ItemNames, ITEM_TABLE_PATH, userItemsPath, configDir, dataDir, dataPath, type ItemEntry } from './items'
export { LogReader, readTail, TAIL_BYTES, type Batch } from './log'
export {
  loadTracker,
  saveTracker,
  queryRuns,
  queryTotals,
  dbPath,
  DB_FILE,
  SCHEMA_VERSION,
  type SavedTracker,
} from './store'
export { zoneName, ZONE_NAMES, PRISON_NAME } from './zones'
export { trackerStatus, sessionSummary, type SessionSummary, type SummaryRun } from './status'
export { refreshBaseline } from './baseline'
export { itemTableAge, readItemTableMeta, type ItemTableMeta } from './items'
export { findWikiPage, wikiSearchUrl, wikiSlug, wikiUrl, type WikiTarget } from './wiki'
