# Third-party data

The tools in this repo read a few things that other people made. This page says what, where it comes from and what
the licence is, so it is clear what this repo is standing on.

## The community prices

The loot tracker can value the items nobody looked up with the prices players saw on the auction house. They come
from the [TITrack](https://github.com/astockman99/TITrack) project (MIT), a loot tracker whose players can share the
prices they see. It keeps them in a Supabase database, and the table of aggregated prices is public to read: its own
app reads it with the publishable key that is in its source.

| What | Where it comes from |
|------|---------------------|
| The project | [github.com/astockman99/TITrack](https://github.com/astockman99/TITrack), by astockman99 |
| The data | `aggregated_prices` and `get_available_seasons()` of the project's database, read only (`packages/tracker/src/baseline.ts`) |
| The unit | FE (Flame Elementium), the same currency the in-game exchange prices things in |
| The credit | *Prices: TITrack community*, shown in the tracker and written down here |

Each row is the median of what players saw for an item in one season over the last day. The seasons are separate
economies, so the tracker asks for the one the log says the player is in (`SeasonId`), and for the newest ordinary
season until the log has said. Some rows come from a single player; the prices are only a floor under what the
player looked up or set. The tracker asks for the prices at most once an hour (and again when the season changes),
keeps them in `~/.local/share/tli-tracker/baseline.json`, and says where they are from and how old they are.
`--no-baseline` turns them off, and a fetch that fails is only a message.

The tracker used to read the prices from the public API of TLI Companion, which has closed it (it answers 410). Its
README names TITrack as the base of its community prices.

## The names of the items

The loot tracker ships a table of the names of the items in
[`packages/tracker/data/items.json`](../packages/tracker/data/items.json). It is built from the data of the
[Torchlight: Infinite wiki](https://tlidb.com), a fan-made site that is not affiliated with the publishers of the
game, in two parts:

- the item data the [TITrack](https://github.com/astockman99/TITrack) project builds from the wiki and from the
  community translations (`scripts/generate-items.ts`), which carries the Chinese names and the kinds as well;
- the wiki itself, which `scripts/scrape-tlidb.ts` reads for the ids the first part leaves out.

Both are named in the table itself: every entry says which sources it came from.

## What a level takes

The loot tracker shows the level, how far through it you are and the time to the next one. For that it ships the
game's own table of the experience each level takes, in
[`packages/tracker/data/levels.json`](../packages/tracker/data/levels.json), a hundred numbers. The table is the
game's `Experience` data as [Oracle](https://github.com/GeorgeTG/Oracle) (MIT) published it in
`server/Experience.json`; the file names its source. The tracker reads only the experience of each level.

## The game itself

*Torchlight: Infinite* is by XD. This repo is unofficial, and is not affiliated with or endorsed by the developers
or the publishers of the game. The tools read the pixels of the game window and the log file the game writes; they
never touch the game's memory or its network traffic.
