# @tli/arcana

The Arcana season of Torchlight: Infinite: the Tarot Path and the Fateful Contest, as the
game's log tells them.

```ts
import { Tracker } from '@tli/arcana'

const tracker = new Tracker()
tracker.feed(lines)
tracker.state // the visits, the contests and the trials
```

The package reads the game's log and keeps what the log says: the visits to the Tarot Path with
the moves that were made, the chests of destiny that were taken and raised, the trials that were
fought, and the Fateful Contests with what their chests gave. It never looks at the screen, and it
never talks to the game.

## What it gives

```ts
/** The tracker: it reads the log's lines and keeps what they say. */
export class Tracker {
  constructor(history?: History)
  feed(lines: Iterable<string>): void
  feedLine(line: string): void
  get state(): History
  get current(): Session | null
  get currentContest(): Contest | null
  get at(): number
  snapshot(): Snapshot
  restore(saved: Snapshot): void
  logRestarted(): void
  readonly prices: PriceStore
}

/** What a log line says about the season; null when it says nothing. */
export function parseLine(line: string): Fact | null

/** Reads what was saved; null when there is nothing saved, or it cannot be read. */
export async function load(path?: string): Promise<Saved | null>

/** Writes what is saved, as the difference from what is there, in one transaction. */
export async function save(saved: Saved, path?: string): Promise<void>

/** The Arcana tool's status line, as the dashboard draws it (contract C1 of the dashboard plan). */
export function arcanaStatus(history: History): ToolStatus
 ```

`arcanaStatus` (in [`src/status.ts`](src/status.ts)) works the history out into one line: whether
the Tarot Path is open (a visit that never ended is one that is still going on), the life of the
visit that is going on, the chests of destiny still waiting for a Fateful Contest, and how many
trials were fought. It reads the history alone — `tracker.state` of a live tracker, or
`historyOf(await load())` of what was saved — so it costs nothing to call.

## What the log says, and what it does not

The log is written by the game. It says that the board opened (`PageName = S9Taro , PageRunState =
Run`), that a move was made (`S9Taro HandleOrderAni Start Step=1 Type=CardDraw`), that the marker
walked (`S9LineShort Anim_Light`), that a chest of destiny entered the carried bar (`S9Reward
Anim_Blue`), that a card was used (`S9HandCard Anim_Dachu`), that life changed (`MsgMgr@:Show
MsgValue = Life -1`), that a trial turned over (`Play_Obj_S9_SMTL_KaPai_Turn_Slow`) and which
arcana it was (`Play_VO_Story_S9_3_11_TheHangedMan`).

It does **not** say where the cells of the board are, what an event cell does, which card is in
hand, or how much life the player has left. The widget ids are allocated as the game scrolls the
board, so they carry no position. This package therefore tracks the shape of the walk (how many
cells were crossed, and on which side the path revealed itself) and never invents a position: there
is no solver here, and there cannot be one without reading the board off the screen.

A cell that shows a chest but gives none is counted as a chest left behind (the carried bar holds
seven). The log does not say why it was left behind, so the package does not guess.

## The rewards of the Fateful Contest

The Fateful Contest is its own level (`LevelUid, LevelType, LevelId = 3100 19 203013`), so the
fight has a start and an end. A chest is opened by the sound `Play_Obj_S9_SMTL_BaoXiang_Open_01`,
and the loot that comes out of it is picked up in the seconds that follow. The tracker gives those
pick-ups to that chest, up to `REWARD_WINDOW_MS` after it was opened. The items themselves are read
by the loot tracker (`@tli/tracker`), which already knows how the game writes its item changes and
how the exchange's prices come back, so the rewards can be valued.

## The saved state

The tracker keeps what it knows in a SQLite database, `~/.local/share/tli-arcana/arcana.db`
(`$XDG_DATA_HOME` moves it), written with `bun:sqlite`. The tables are the parts of the state:
`visits` with `moves`, `cells` and `chests`, `trials`, `contests` with `contest_chests` and
`rewards`, `slots` and `instances` for the bag, `prices` and `price_overrides`, `settings`, and
`log_position` for where the tracker was in the log. The database is in WAL mode, so the dashboard
can read it while the tracker writes it. Its schema is versioned (the sqlite `user_version`) and
brought up to date when it is opened.

A save writes only what changed since the last one, in one transaction; the backfill of a log
hundreds of megabytes long saves as it goes. The state the tracker kept before the database — a
`state.json` in the same folder, of the version the old loader read — is brought in by itself the
first time the database is not there, and the file is renamed to `state.json.imported` and kept.
A file that is not the tracker's database is moved aside as `arcana.db.corrupt` (kept, never
deleted); a database of a newer schema is left alone and the write to it is refused.

## Tests

```
bun test
```

The tests write small logs in a temp folder and read them back: the parser, the sessions, the
Fateful Contest and its rewards, saving and resuming, and a log that is truncated.

## Replaying a log

```
bun scripts/replay.ts --log=<UE_game.log>
```

The script reads the log in pieces (a log can be hundreds of megabytes) and prints what the tracker
found in it: the visits with their moves, the contests with what their chests gave, and the trials.
