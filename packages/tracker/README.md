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
| `src/parse.ts` | reads the log's lines: the level, the map's path, the bag, the pages the game opens, the blocks the game writes its item changes in |
| `src/inventory.ts` | the bag: which items are in which slot, and how many of each the player has |
| `src/runs.ts` | the runs: the time in each map, what was picked up in it, what it cost, and the visits to the Tartarus prison |
| `src/prices.ts` | the prices the exchange told it about, and the ones the player set |
| `src/baseline.ts` | the community prices of TITrack, and the file they are kept in |
| `src/exchange.ts` | the exchange's blocks of lines: what a search found |
| `src/valuation.ts` | what a pile of loot is worth, with and without the trade tax |
| `src/items.ts` | the names of the items |
| `src/zones.ts` | the English names of the maps |
| `src/engine.ts` | the tracker: it ties the rest together |
| `src/log.ts` | reading the log file in pieces, and where it was left |
| `src/store.ts` | saving and loading the tracker |

## The runs

A run is the time between entering a map and leaving it. The level the player is in says which
map it is: the type 3 is a map, the type 0 is the hideout.

The Tartarus prison is a run of its own. The board the warden reads opens in the town
(`S16BoardMain Run`), and the challenge it leads into is a level of its own (the type 28), so the
visit begins with the board and ends when the player leaves the prison level. The runs have a kind
(`map` or `prison`) that is kept in the state that is saved: the state of the first version had no
kind, and its runs are all trips into a map.

## The prices

The tracker knows three kinds of price, and the first one that is there wins: the price the player
set by hand, the price the exchange told the tracker when the player looked an item up, and the
community price. `PriceStore.price()` gives the one that counts, and `PriceStore.source()` says
where it came from.

The community prices come from [TLI Companion](https://tlicompanion.com), the site that collects the
prices players saw on the auction house. `src/baseline.ts` reads them from its public API (see
[the docs](https://tlicompanion.com/api)), keeps them in `~/.local/share/tli-tracker/baseline.json`,
and says how old they are. They are never mixed into what was learned: they have a file of their
own, and the state that is saved does not carry them.

```ts
import { baselineIsStale, fetchBaseline, readBaseline, writeBaseline } from '@tli/tracker'

const cached = await readBaseline()
if (baselineIsStale(cached)) {
  const data = await fetchBaseline()
  tracker.prices.setBaseline(data.prices)
  await writeBaseline(data)
}
```

The prices are in FE, the same currency the exchange prices things in. A failure is only a
failure: the tracker carries on with what it has.

## The data of the items

`data/items.json` maps the game's item id to the item's English name, its Chinese name and its kind.
It is built from two sources, both of them the
[Torchlight: Infinite wiki](https://tlidb.com) (a fan-made site, not affiliated with XD).

The first is the item data the [TITrack](https://github.com/astockman99/TITrack) project builds from
the wiki and from the community translations. It carries the Chinese names and the kinds as well.
`scripts/generate-items.ts` fetches it and writes the table:

```
bun scripts/generate-items.ts                 # fetch the upstream data and write data/items.json
bun scripts/generate-items.ts --from=<file>  # use a copy of the upstream data on disk
```

The second is the wiki itself, which `scripts/scrape-tlidb.ts` reads. The upstream data is older
than the wiki and leaves out the gear bases, so the ids the player's log shows have nothing to name
them with. The wiki has a page per item, and the page says which id the game knows the item by, so
the script collects the ids and the names from there:

```
bun scripts/scrape-tlidb.ts                     # read the wiki and write data/tlidb-items.json
bun scripts/scrape-tlidb.ts --ids=<file>        # also look up the ids listed in a file
bun scripts/scrape-tlidb.ts --no-crawl           # only look up the ids, do not read the pages
bun scripts/scrape-tlidb.ts --max=<n>           # read at most n pages and stop
bun scripts/scrape-tlidb.ts --delay=<ms>        # wait longer between the requests
```

The script asks for one page at a time and waits a second between the requests. It keeps what it
fetched under `.cache/tlidb`, so a run that is interrupted can be continued without asking the wiki
for the same page twice. `scripts/generate-items.ts` merges the result into the table; the names the
upstream data has are kept, and the wiki only fills in the ids the upstream data leaves out. Every
entry in `data/items.json` says which sources it came from.

The wiki names the gear the player picks up after the base type of the gear, so the names of the
different stat families would be the same. The name in the table has the family in brackets:
`Magic Shoes (Int)`.

The gear bases the player has not picked up yet are named as well. `scripts/gear-bases.ts` walks
the wiki's pages of the gear (the page of each slot lists the base types that fit it), reads the
pages of those base types, and writes the ids it finds, so the scraper can name them too:

```
bun scripts/gear-bases.ts                   # the ids of the gear bases, one per line
bun scripts/gear-bases.ts --pages           # the pages of the gear bases, one per line
bun scripts/gear-bases.ts > gear-ids.txt    # the ids, ready for the scraper
```

Two items can carry the same name: the wiki has a page for each version of some gear bases, and
the tiers of a divinity slate all carry the same name. The name of such an item gets the level it
needs in brackets (`Divine Arbiter's Defense (Str) (lv 62)`), or its id when the levels are the
same (`Goddess of Hunting's Divinity (#260001)`), so that every item in the table has its own name.

`scripts/coverage.ts` says how much of the loot in the game's logs the table can name, and which
ids it does not know:

```
bun scripts/coverage.ts                 # the logs of this machine
bun scripts/coverage.ts <log> [<log> …]  # the logs to read
bun scripts/coverage.ts --missing       # only the ids the table does not name
```

An item the table does not know is shown as `Item #<id>`. The player can name items in
`~/.config/tli-tracker/items.json`; those names win over the ones in the table.

The ids the wiki does not name either are left alone, rather than guessed at. The logs of this
machine show four of them, and the wiki has a card for none of them (the card comes back empty, in
every language the site has):

| Id | What the logs show | What the ids around it say |
|----|--------------------|-----------------------------|
| 5141 | the stash, in `ResetItemsLayout` and `ExchangeItem` blocks | 5140 is Memory Scrap, 5142 to 5144 are Memory Thread - Magic, Rare and Epic: a tier of Memory Thread the wiki does not have a page for |
| 100400 | the stash, in `ResetItemsLayout`, `ExchangeItem` and `BuyVendorGoods` blocks; the largest pile in the logs (68,167 items) | 100200 is Flame Sand and 100300 is Flame Elementium, the two fuels the wiki has pages for |
| 250001 | the stash, in `ResetItemsLayout` blocks | the ids around it are the Divinity Slates (260001 and up) and the legendaries (210003 and down) |
| 502100 | the stash, in `ResetItemsLayout` blocks | 502000 is Tempering Medal and 502001 is Tempering Medal (Origin) |

The game gives no name for them either: the blocks the logs write for an item carry its id, its
count and its rarity, but no name.

## The tests

```
bun test
```

The tests use lines from a real game log, in `tests/fixtures.ts`.
