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
| The header | the app name and log path, then net worth, FE per hour, FE per run, how many runs, how long in maps, the average run, and the tax, map-cost and pause switches |
| Current run | the map you are in, how long you have been in it, and what you have picked up, the most valuable first |
| Recent runs | the last runs, with how long each took and what it was worth; the runs that are visits to the Tartarus prison say so; `enter` opens the detail of one |
| Bag | what you have, sorted by value (or by how many, or by name); the value of each thing |
| Prices | what the tracker knows the price of each item to be; `*` a price you set, `·` one learned from the exchange, `~` a community price |

The panels use the whole width of the terminal on a normal screen: the current run is above the
bag on the left, recent runs are above the prices on the right, and the two columns line up. The
panel with the keyboard focus has a bright border, and the selected row is marked and highlighted.
The three lists scroll, and each one has a scrollbar. On a narrow terminal (less than 80 columns)
the panels are stacked instead, and the run that is going on is shown in the header. FE amounts
are yellow, positive values are green, and hints are cyan.

The mouse works too: clicking a panel gives it the focus, clicking a row picks it out, and the
wheel scrolls the list under the pointer.

Colours can be turned off with `--no-color`. The `NO_COLOR` environment variable has the same
effect. The layout and all the text stay exactly the same when colour is off.

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
| `~/.local/share/tli-tracker/state.json` | the runs, the bag, the prices and where the tracker was in the log |
| `~/.local/share/tli-tracker/baseline.json` | the community prices, and when they were fetched |
| `~/.config/tli-tracker/items.json` | the names of the items you named yourself |

The tracker saves now and then, and when it is left. When it starts again it carries on where it
left off in the log. A log that was truncated (the game was restarted) or rotated is read from its
beginning again.

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
