# Loot Tracker

A Torchlight: Infinite loot tracker for the terminal. It reads the game's log file and works out what
you picked up on each trip into a map, what it is worth, and what you have. It only reads the log:
it never touches the game. The only thing it asks for over the network is the community prices, and
only when they are older than six hours (see *The community prices*).

```
bun run tracker                     # from the repo root
bun src/tui.ts                      # from apps/tracker
bun src/tui.ts --log=<UE_game.log>  # read another log
bun src/tui.ts --reset              # forget what was saved and read the log from its start
bun src/tui.ts --no-backfill        # do not read the log's old lines, only the new lines
bun src/tui.ts --no-color           # draw without colours
bun src/tui.ts --no-baseline        # do not use the community prices
```

## What it shows

| Panel | What is in it |
|-------|---------------|
| The header | the tool name on a bar of its own and the log path, then net worth, FE per hour, FE per run, how many runs, how long in maps, the average run, your level with a progress bar of how far through it you are, the experience per hour and the time to the next level, and the switches as chips: tax, map cost, PAUSED, the session and the character |
| Current run | the map you are in, how long you have been in it, and what you have picked up, the most valuable first |
| Best run | the run worth the most, in one line above the recent runs (hidden until a run has value) |
| Recent runs | the last runs, with how long each took and what it was worth; the runs that are visits to the Tartarus prison say so; `enter` opens the detail of one |
| Bag | what you have, sorted by value (or by how many, or by name); the value of each thing |
| Prices | what the tracker knows the price of each item to be; `*` a price you set, `·` one learned from the exchange, `~` a community price |

The panels use the whole width of the terminal on a normal screen: the current run is above the
bag on the left, recent runs are above the prices on the right, and the two columns line up. The
panel with the keyboard focus has a heavy border and a `●` in its title, the others a rounded
border and a `○`, and the selected row is marked with `▸` and highlighted. The three lists scroll,
and each one has a scrollbar. On a narrow terminal (less than 80 columns) the panels are stacked
instead, and the run that is going on is shown in the header.

Every colour has a job, the same as in the other tools: the name of the tool is ember orange, the
focus and the keys are cyan, FE amounts are gold, item and map names are blue, experience and the
level are purple, run counts are orange, times and durations are teal, and a loss is red. The
switches along the top are chips — small labels on a tinted ground — green when they are on, quiet
when they are off, yellow for PAUSED, purple for the session. The keys at the bottom sit on caps,
so they stand out from what they do.

The mouse works too: clicking a panel gives it the focus, clicking a row picks it out, and the
wheel scrolls the list under the pointer.

Colours can be turned off with `--no-color`. The `NO_COLOR` environment variable has the same
effect. The layout stays exactly the same when colour is off: the chips become `[tax on]`-style
brackets, the key caps become plain `key label` pairs, and the focus is still told by the heavy
border and the `●` marker, never by the colour alone.

The screen is drawn with [OpenTUI](https://opentui.com/docs), so the terminal is put back the way
it was on every way out, and the layout follows the size of the window. The parts the other tools
share are in [`packages/tui`](../../packages/tui/README.md), and the tools that can be started, and
the windows they can be started in, are in [`packages/launch`](../../packages/launch/README.md).

To draw the screen from a real log without starting the terminal UI, run this from `apps/tracker`:

```
bun scripts/replay.ts --log=<UE_game.log> --render=160x45 --out=screen.ansi
bun scripts/replay.ts --log=<UE_game.log> --html=160x45 --out=screen.html
```

The first writes the screen as it would look in a terminal, the second writes it as a web page,
with the colours, so it can be looked at in a browser.

The keys:

| Key | What it does |
|-----|--------------|
| `↑` `↓` (or `k` `j`) | Move in the panel that has the focus |
| `tab` | The next panel (`shift+tab` the one before) |
| `enter` | The detail of the run that is picked out |
| `m` | The menu: every key below in a list by section. Pick with `↑` `↓` and `enter`, or press the entry's key. Choosing "clear learned prices" there is the confirmation. |
| `esc` | Back, leave the price, or take the filter away |
| `t` | The trade tax on and off |
| `c` | The cost of the map counts against the profit, or not |
| `p` | Stop and start the clock |
| `e` | Set the price of the item that is picked out (empty enter resets it) |
| `u` | Reset a hand-set price back to the learned one |
| `d` | Remove the item from the prices (a new exchange search brings it back) |
| `z` | Clear every price learned from exchange searches (press twice; hand-set and community prices stay) |
| `b` | Fetch the community prices again |
| `s` | Change how the list is sorted |
| `/` | Search the list that has the focus |
| `x` | Write the loot report to a csv file |
| `f` | The page of the map modifiers: which ones paid (`esc` or the key again closes a page, `↑` `↓` scroll it) |
| `h` | The page of the exchange: what you listed, paid, collected and took back |
| `g` | The page of the sessions: each one's runs, FE, FE per hour and XP per hour |
| `n` | Start a session of your own: asks for a name, the runs that begin after it are its |
| `N` | End the session that is going on |
| `r` | Read the log again from where it was |
| `a` | Open Arcana in a window of its own |
| `v` | Open Vorax in a window of its own |
| `w` | Open Warden in a window of its own |
| `?` | The help |
| `q` | Quit |

## Searching the lists

The *Bag* and the *Prices* can be searched. Press `/` and the search box opens at the bottom of
the screen; the list is filtered as the words are typed, and `enter` keeps the filter and gives
the keys back. `esc` takes the filter away again, and so does `esc` later on, when the keys are
back.

A word matches an item when the name of the item has it in it, when the word is the number of the
item, or when the word is the start of one of the words of the name. The words are not about
capitals, and when there are more than one of them, all of them have to match: `iron sword` finds
the iron swords, not everything with an iron in it.

The bag and the prices have their own filter, and the title of the panel says what is going on:
`Bag (167)` when nothing is filtered, `Bag /iron (5/167)` when five of the hundred and sixty
seven things in the bag have an iron in the name. The keys work on the rows that are left: `e`
sets the price of the item that is picked out of the filtered list.

## Experience, modifiers, the exchange, sessions and characters

The game says where the experience bar is every time it moves, which modifiers it put on a map, what changed in
the bag when you used the exchange and which character logged in. The tracker keeps all of it from the log:

- **Experience.** What is gained in a map is that run's experience; the header shows the level, the percentage
  through it, the experience per hour of maps and the time to the next level at that pace. What a level takes is
  the game's own table (`packages/tracker/data/levels.json`, see
  [`docs/third-party-data.md`](../../docs/third-party-data.md)), so a level-up is counted whole.
- **Map modifiers.** Each run keeps the modifiers the game applied to its map; the detail of a run (`enter`) lists
  the ones the game says in words. `f` compares the modifiers that were on three finished maps or more with the
  average map. It is a comparison, not a cause.
- **The exchange.** `h` lists listings, payments, what you collected and what you took back, newest first, with the
  items and the FE that changed in the bag. The log does not carry the price of a listing.
- **Sessions.** `n` names a stretch of play; `g` adds up its runs on their own. A run that was going on when the
  session began stays outside it.
- **Characters.** The log says which character logged in. Each character has its own bag, runs, experience,
  exchange entries and sessions, kept under its id in the database; the prices are shared. The header shows the
  last digits of the id.

## A minigame in a window of its own

The tracker follows the log while the game is being played, so it cannot show another full-screen
tool at the same time. `a`, `v` and `w` open Arcana, Vorax and Warden in a window of their own,
and the tracker carries on: the log is still read, the numbers still change.

The window is opened in the terminal the player uses: `ghostty`, `kitty`, `foot`, `alacritty`,
`wezterm` or `xterm`, whichever is installed. `TLI_TERMINAL` says which one to use. The tool gets
the log the tracker reads (`--log=`) and the colours the tracker has (`--no-color`).

In tmux the tool opens as a pane of the session the tracker is in, so the tracker keeps the focus.
`TLI_TMUX_MODE` says how: `split-h` (the default) puts the pane beside the tracker, `split-v`
below it and `window` gives it a window of its own.

Opening the same tool twice does nothing: the second key says that it is already open. The window
is closed with the tool, or by closing the window.

Where the window ends up on the screen is the compositor's business.

## What it reads from the log

The game writes `UE_game.log` while it runs. The tracker reads:

- **the level**: `LevelMgr@ LevelUid, LevelType, LevelId = 1071008 3 4708`. The type says whether the
  player is in a map, in the hideout, or in the Tartarus prison. A run is the time between entering
  a map and leaving it. The types the logs have shown:

  | Type | What it is |
  |------|------------|
  | 0 | the hideout, the town |
  | 3 | a map |
  | 16, 17, 27 | maps the tracker follows; the logs of this machine have not shown them |
  | 19 | the Fateful Contest, which the Arcana tracker follows |
  | 25 | the harder tier of a map |
  | 28 | the Tartarus prison |

  A type that is not in this list is not a run: the tracker leaves that level alone. When a new one
  shows up in the log, it is written down here.
- **the pages**: `S16BoardMain Run` and `S16BoardMain Destory`. The Tartarus prison's board opens in
  the town, and the visit to the prison begins with it.
- **the bag**: `ItemChange@ Update Id=5140_... BagNum=26 in PageId=102 SlotId=23`. A slot's count is
  absolute, so the change is the difference against what was there before. The game writes these in
  blocks that say what caused them: `PickItem` and `PickItems` are loot, `Spv3Open` is the beacon
  and the resonance that opening a map costs, and the rest is the game moving things around.
- **the exchange**: `----Socket RecvMessage STT----XchgSearchPrice----SynId = 3720` and the prices
  that come back. The tracker keeps the tenth of the listings of each item the player looked up,
  which is close to what a quick sale gets.
- **the experience**: `ExpMgr@UpdateExp Percent:6257480 94` is the experience gathered in the level and the level
  (it starts again at zero at every level).
- **the map's modifiers**: `UCLevelSingleton::AddMapModifier(5112006) success 2` for each one the game applied, and
  the dump that follows `AffixInfos`, which says what the readable ones say (`+Description [...]` then `+Id [...]`).
- **the exchange**: the item changes inside `ProtoName=XchgForSale`, `XchgBuy`, `XchgReceive` and `XchgRecall`.
- **the character**: `PlayerIdTrace@LoginDataMgr:SetPlayerId old=... new=...`.

Everything is priced in Flame Elementium (FE). The exchange takes 12.5% of everything but FE when
you sell, so the tracker can show the value before the tax and after it.

## The Tartarus prison

The prison is a run of its own. The board the warden reads opens in the town, and the challenge it
leads into is a level of its own, so the visit begins when the board opens and ends when the player
leaves the prison level. The list of the runs says *prison* next to those runs, and the loot of the
prison is worth what the prices say, like the loot of any other map.

A visit that never had a challenge is not a run: looking at the board for a moment does not add one.

## The prices

The tracker knows three kinds of price, and the first one that is there wins:

| Mark | Where the price comes from |
|------|----------------------------|
| `*` | the price you set yourself (`e`) |
| `·` | the price the exchange told the tracker, when you looked the item up in the game |
| `~` | the community price, from [TLI Companion](https://tlicompanion.com) |

A price you set always wins. A price learned from the exchange wins over the community price. The
community price is the floor under everything else: it is what an item nobody looked up is worth.

The names of the items are in
[`packages/tracker/data/items.json`](../../packages/tracker/data/items.json), which is built by
[`packages/tracker/scripts/generate-items.ts`](../../packages/tracker/scripts/generate-items.ts) from
the item data of the [Torchlight: Infinite wiki](https://tlidb.com) (through the
[TITrack](https://github.com/astockman99/TITrack) project). Items that are not in there are shown as
`Item #<id>`; you can name them yourself in `~/.config/tli-tracker/items.json`:

```json
{ "3210": "Iron Sword", "3510": "Oak Staff" }
```

## The legendaries

When a legendary drops, the log only says the base of the gear: `ItemChange@ Add Id=3010_<uuid>` says
*Old King's Armor (Str)*, and nothing more. The log never says which legendary the piece is at the
moment it is picked up.

It does say later, in two places:

- when the player puts the gear on: `AttributeMgr:SetPlayerEquipment(BaseId=3010, GoldId=112151, 4)`
  names the legendary (*Furious Man's Body*) and the slot it is in, and the block that goes with it
  names the item itself;
- when the game dumps the bag (at login, and when things move to the warehouse): the fields of the
  item carry `+Id [3010_<uuid>]` and `+UniqueItmId [112151]`, the legendary's own id.

The tracker uses both: a gear base the log has named is shown by the name of the legendary and is
worth what the legendary is worth (a price you set, then a price learned from the exchange, then
the community price). A base the log has not named keeps its own name and its own price.

## The community prices

The tracker can fill in the prices nobody looked up with the prices the community reports.
[TLI Companion](https://tlicompanion.com) collects the prices players saw on the auction house
and has a documented public API ([the docs](https://tlicompanion.com/api)); the tracker reads the
prices from there.

- The prices are fetched at most once an hour (the data changes at most every ten minutes), and are
  kept in `~/.local/share/tli-tracker/baseline.json`, so the tracker works the same without a
  network.
- `b` fetches them again. The footer says where they are from and how old they are.
- `--no-baseline` turns them off: the tracker then only knows what it has seen.
- A fetch that fails is only a message; the tracker carries on with what it has.

The site asks to be credited where its prices are shown, so the footer says
*Prices: tlicompanion.com* with the link to it.

The community price is the middle of the prices players saw, and the tracker's own price is the
tenth of the listings of the exchange, so the two can differ. Where they do, the tracker's own
price wins.

The site is by other people; see [`docs/third-party-data.md`](../../docs/third-party-data.md).

## The tests

```
bun test                      # the screen, with OpenTUI's test renderer
python3 tests/tui-smoke.py   # the screen in a real terminal
```

The first draws the screen at every size from 60 to 200 columns and from 10 to 50 rows, presses
every key and checks what happens. The second runs the tracker in a pty, sends it keys and checks
that it leaves the terminal as it was.

## The files

| File | What is in it |
|------|---------------|
| `~/.local/share/tli-tracker/tracker.db` | the runs, the bag, the prices and where the tracker was in the log, in a SQLite database |
| `~/.local/share/tli-tracker/baseline.json` | the community prices, and when they were fetched |
| `~/.config/tli-tracker/items.json` | the names of the items you named yourself |

The tracker saves now and then, and when it is left; each save writes only what changed, in one
transaction. When it starts again it carries on where it left off in the log. A log that was
truncated (the game was restarted) or rotated is read from its beginning again.

The database can be looked at while the tracker runs, with `sqlite3` (it is in WAL mode, so a
reader never gets in the tracker's way):

```
sqlite3 ~/.local/share/tli-tracker/tracker.db 'select kind, count(*) from runs group by kind'
sqlite3 ~/.local/share/tli-tracker/tracker.db 'select name, fe from runs order by start_ms desc limit 5'
```

The runs are in `runs` (the one going on is the row with `is_current = 1`) with their loot, cost
and modifiers in `run_loot`, `run_cost` and `run_affix`, the bag in `slots` and `instances`, the
exchange in `trades` and `trade_items`, the sessions in `sessions`, the prices in `prices` and
`price_overrides`, the legendaries of the gear bases in `gear`, what the modifiers say in `affixes`,
the switches in `settings`, where the experience bar was and the next run's number in `characters`,
which character played last in `meta`, and where the tracker was in the log in `log_position`. Every
table of what a character owns has a `character` column with the character's id (empty for what was
read before the log said who was playing).

The state the tracker kept before the database — a `state.json` in the same folder — is brought in
by itself the first time the database is not there, and the old file is renamed to
`state.json.imported` and kept. A database the tracker cannot use is moved aside as
`tracker.db.corrupt`, also kept, and a fresh one is written; one from a newer version of the
tracker is left alone and nothing is written over it.

## On Linux

The log is in the game's folder. With Steam and Proton it is:

```
~/.local/share/Steam/steamapps/common/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game.log
```

or, when the library is somewhere else:

```
/path/to/steamapps/common/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game.log
```

The tracker finds it by itself; `--log=<file>` says where it is when it cannot.

**The game has to write its own lines.** Open the game, press `esc`, go to *Account Related* and turn
on *Enable Log*. Without it the log has almost nothing in it, and the tracker says so. Turn it on
before you start the tracker, and log out and back in if the game was already running.

**Sorting the bag syncs the inventory.** The game sends the whole bag when it is sorted, so open the
bag in the game and press *Sort* once after the tracker has started. The tracker then knows exactly
what you have.

The tracker reads the log while the game is running and while it is not. A run that is going on is
shown with the time it has been going so far; when the game is closed the clock keeps going until
the next level change in the log.
