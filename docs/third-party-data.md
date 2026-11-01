# Third-party data

The tools in this repo read a few things that other people made. This page says what, where it comes from and what
the licence is, so it is clear what this repo is standing on.

## The community prices

The loot tracker can value the items nobody looked up with the prices players saw on the auction house. They come
from [TLI Companion](https://tlicompanion.com), a fan-made site for *Torchlight: Infinite*, through its public API
([the docs](https://tlicompanion.com/api)).

| What | Where it comes from |
|------|---------------------|
| The site | [tlicompanion.com](https://tlicompanion.com), by the makers of TLI Companion |
| The API | `GET https://tlicompanion.com/api/public/v1/prices`, read only, no key, open to every website |
| The unit | FE (Flame Elementium), the same currency the in-game exchange prices things in |
| The credit | *Prices: tlicompanion.com*, shown in the tracker and written down here |

The API is documented: it is version 1 and stays stable (fields are added, never taken away), it allows 60 requests
a minute per address, and the data changes at most every ten minutes. The tracker asks for the prices at most once
an hour, keeps them in `~/.local/share/tli-tracker/baseline.json`, and says where they are from and how old they
are. `--no-baseline` turns them off, and a fetch that fails is only a message.

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
