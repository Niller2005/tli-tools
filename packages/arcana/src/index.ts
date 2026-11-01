// The Arcana season: the Tarot Path and the Fateful Contest.
//
//   import { Tracker } from '@tli/arcana'
//
//   const tracker = new Tracker()
//   tracker.feed(lines)
//
// The tracker reads the game's log and keeps what it says: the visits to the Tarot Path with
// their moves, the trials that were fought, and the Fateful Contests with the rewards their
// chests gave. What the log does not carry (where the cells are, which notes are in hand) is
// not tracked.

export {
  parseLine,
  logTime,
  RARITIES,
  RARITY_NAMES,
  type Rarity,
  type StepKind,
  type CellWhat,
  type HandWhat,
  type Fact,
} from './parse'

export {
  Tracker,
  emptyHistory,
  CONTEST_LEVEL_TYPE,
  REWARD_WINDOW_MS,
  type History,
  type Session,
  type Move,
  type Cell,
  type CellKind,
  type Chest,
  type Trial,
  type Contest,
  type OpenedChest,
  type Snapshot,
  type SlotRecord,
  type InstanceRecord,
  type PriceRecord,
} from './session'

export { load, save, statePath, dataDir, historyOf, DB_FILE, SCHEMA_VERSION, type Saved } from './store'

export { arcanaStatus } from './status'
