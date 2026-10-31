# How to: track what a map run gives you

The loot tracker reads the game's log file and works out what you picked up on each trip into a map, what it is
worth, and what you have. This is how to get it going on Linux, and what the numbers mean.

It only reads the log file. It never touches the game and never sends anything over the network.

## Start the tracker

```
bun run tracker
```

from the repo root, or pick *Loot Tracker* in the dashboard.

The tracker finds the log by itself. When it does not, say where it is:

```
bun run tracker --log="/path/to/UE_game.log"
```

## Turn on the game's own log lines

The game writes its own lines into the log only when *Enable Log* is on: in the game, press `esc`, go to
*Account Related* and turn on *Enable Log*. Turn it on before you start the tracker.

Without it the log is nearly empty, and the tracker says so at the top of the screen:

```
the game is not writing its own lines: turn on Enable Log (Esc, Account Related, Enable Log)
```

## Where the log is

With Steam and Proton the log is in the game's folder:

```
~/.local/share/Steam/steamapps/common/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game.log
```

or, when the Steam library is somewhere else:

```
/path/to/steamapps/common/Torchlight Infinite/UE_game/TorchLight/Saved/Logs/UE_game.log
```

## Sync the bag once

The game sends the whole bag when it is sorted. Open the bag in the game and press *Sort* once after the tracker
has started: the tracker then knows exactly what you have, and what it is worth.

## What the numbers mean

| Number | What it is |
|--------|------------|
| net worth | what everything in your bag is worth, at the prices the tracker knows |
| FE/h | the Flame Elementium you picked up in an hour of maps |
| FE/run | the Flame Elementium you picked up in a run, on average |
| runs | how many runs there have been |
| time | how long you have been in maps |
| avg | how long a run takes, on average |

Everything is in FE, the game's currency. The exchange prices things in FE, so a loot's value is what it would
fetch when you sell it. Selling costs 12.5% of everything but FE, so `t` turns that tax on and off.

A run is the time between entering a map and leaving it. The map's cost — the beacon and the resonance that
opening it takes — is kept with the run; `c` says whether it counts against the profit.

## The prices

The tracker learns prices from the exchange: when you look an item up in the game, the prices of the listings come
back in the log, and the tracker keeps the tenth of them, which is close to what a quick sale gets.

It only knows about the items you have looked up. For the rest, set the price yourself: move to the item in the
*Bag* or the *Prices* panel and press `e`, then type the price in FE and press `enter`. A price you set wins over
one that was learned, and it is kept when the tracker is closed.

## Open a minigame in a window of its own

The tracker follows the log while the game is being played, so it cannot show another full-screen
tool at the same time. The keys `a`, `v` and `w` open Arcana, Vorax and Warden in a window of their
own, and the tracker carries on: the log is still read and the numbers still change.

```
a   Arcana
v   Vorax
w   Warden
```

The window is opened in the terminal you use: `ghostty`, `kitty`, `foot`, `alacritty`, `wezterm` or
`xterm`, whichever is installed. To say which one:

```
TLI_TERMINAL=ghostty bun run tracker
```

When the tracker runs inside tmux, the tool opens as a pane of that session instead, and the
tracker keeps the focus. `TLI_TMUX_MODE` says how the pane is made:

| `TLI_TMUX_MODE` | What is made |
|-----------------|--------------|
| `split-h` (the default) | a pane beside the tracker |
| `split-v` | a pane below the tracker |
| `window` | a window of its own, named after the tool |

Without a terminal to open a window in, the tracker says so. The tool that is opened gets the log
the tracker reads and the colours the tracker has, so it shows the same things.

Opening the same tool twice does nothing: the second key says that it is already open. Where the
window ends up on the screen is up to your compositor.

The dashboard has the same key: `w` opens the tool under the cursor in a window of its own, and the
dashboard keeps the terminal.

## Write a report

Press `x` to write a csv file of every run, what was picked up in it and what it was worth. The file is in your
home folder. To write one without the screen:

```
bun run tracker:report --out=loot.csv
```

## Start again later

The tracker keeps the runs, the bag, the prices and its place in the log in `~/.local/share/tli-tracker/state.json`,
so when it starts again it carries on where it left off. `--reset` makes it forget and read the log from its
beginning. A log that was truncated (the game was restarted) or rotated is read from its beginning again.

## Name the items yourself

The tracker ships with the names of most items, built from the [Torchlight: Infinite wiki](https://tlidb.com): the item
data the [TITrack](https://github.com/astockman99/TITrack) project builds from the wiki, and the wiki itself, which
`packages/tracker/scripts/scrape-tlidb.ts` reads for the ids that the first one leaves out. The ones it still does
not know are shown as `Item #<id>`. Name them in `~/.config/tli-tracker/items.json`:

```json
{ "3210": "Iron Sword", "3510": "Oak Staff" }
```
