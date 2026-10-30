# @tli/tracker

The Torchlight: Infinite loot tracker, as a library. It reads the game's log file and works out what
the player picked up on each trip into a map, what it is worth, and what the player has.

```ts
import { ItemNames, LogReader, Tracker } from '@tli/tracker'

const names = await ItemNames.load()
const tracker = new Tracker({ names })
const reader = new LogReader(logFile, 0)
reader.readAll((batch) => tracker.feed(batch.lines))

console.log(tracker.stats())
```

## The parts

| File | What it does |
|------|--------------|
| `src/parse.ts` | reads the log's lines: the level, the map's path, the bag, the blocks the game writes its item changes in |
| `src/inventory.ts` | the bag: which items are in which slot, and how many of each the player has |
| `src/runs.ts` | the runs: the time in each map, what was picked up in it, what it cost |
| `src/prices.ts` | the prices the exchange told it about, and the ones the player set |
| `src/exchange.ts` | the exchange's blocks of lines: what a search found |
| `src/valuation.ts` | what a pile of loot is worth, with and without the trade tax |
| `src/items.ts` | the names of the items |
| `src/zones.ts` | the English names of the maps |
| `src/engine.ts` | the tracker: it ties the rest together |
| `src/log.ts` | reading the log file in pieces, and where it was left |
| `src/store.ts` | saving and loading the tracker |

## The data of the items

`data/items.json` maps the game's item id to the item's English name, its Chinese name and its kind.
It is built by `scripts/generate-items.ts` from the item data of the
[Torchlight: Infinite wiki](https://tlidb.com), as the [TITrack](https://github.com/astockman99/TITrack)
project builds it:

```
bun scripts/generate-items.ts                 # fetch the upstream data and write data/items.json
bun scripts/generate-items.ts --from=<file>  # use a copy of the upstream data on disk
```

An item the table does not know is shown as `Item #<id>`. The player can name items in
`~/.config/tli-tracker/items.json`; those names win over the ones in the table.

## The tests

```
bun test
```

The tests use lines from a real game log, in `tests/fixtures.ts`.
