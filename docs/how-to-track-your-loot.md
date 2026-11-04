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
| level | your level and how far through it you are; it shows once the log has said it |
| XP/h | the experience you gained in an hour of maps |
| next level in | how long that takes at this pace |

Everything is in FE, the game's currency. The exchange prices things in FE, so a loot's value is what it would
fetch when you sell it. Selling costs 12.5% of everything but FE, so `t` turns that tax on and off.

A run is the time between entering a map and leaving it. The map's cost — the beacon and the resonance that
opening it takes — is kept with the run; `c` says whether it counts against the profit.

A visit to the Tartarus prison is a run too. The board opens in the town and the challenge it leads into is
a level of its own, so the run begins with the board and ends when you leave the prison. The list of the runs
says *prison* next to those runs, and the loot of the prison is worth what the prices say, like the loot of
any other map. Looking at the board without a challenge is not a run, so it does not add one.

## The legendaries

When a legendary drops, the log only says the base of the gear, so the tracker shows the base at first. When you
put the gear on, the log says which legendary it is (`AttributeMgr:SetPlayerEquipment(BaseId=3010, GoldId=112151,
4)`), and the tracker then shows the piece by the name of the legendary and values it as the legendary.

## Experience

The game says where the experience bar is every time it moves (`ExpMgr@UpdateExp Percent:6257480 94`: the experience
in the level, and the level). The tracker counts what is gained in a map as that run's experience, and the header
shows the level, how far through it you are, the experience you gain in an hour of maps, and how long the next level
takes at that pace. The detail of a run (`enter`) shows the experience it gave.

What a level takes is the game's own table, in `packages/tracker/data/levels.json`, so a level-up in the middle of a
map is counted whole. The first move after the tracker starts or after you log in only says where the bar is: nothing
is counted for it, and dying (the bar going back) is not a gain.

## Which map modifiers paid

When a map opens, the game puts its modifiers on one by one and lists the ones you can read. The tracker keeps the
modifiers of each run (the detail of a run lists the ones the game says in words), and `f` opens a page that
compares them: for each modifier that was on at least three finished maps, what those maps were worth on average
against all the maps. It is a comparison, not a cause: a modifier that is on the better maps may be there because
those maps were better prepared. A modifier the game never says in words is not listed.

## The exchange

`h` opens what you did at the exchange: what you listed, what you paid, what you collected and what you took back, with
the items and the FE that changed in your bag. The log says what changed in the bag, not the price of a listing, so
a listing shows the item that left and a purchase shows the FE that left (the item arrives when you collect it).
`FE paid` and `FE collected` at the top add the FE up.

## Sessions

A session is a stretch of play you name: press `n`, type a name and press `enter`. The runs that begin from then on
are the session's, until you press `N` (or start another one). `g` opens the sessions page with the runs, the time,
the FE, the FE/h, the value of the loot and the XP/h of each one, so a farm can be compared with another. The header
says which session is going on. A run that was already going on when the session began stays outside it.

## More than one character

The log says which character logged in (`PlayerIdTrace@LoginDataMgr:SetPlayerId`), and the tracker keeps a bag, runs,
experience, exchange entries and sessions for each. When another character logs in, the one that was playing leaves:
its run ends where the log says, and everything stays as it was until that character logs in again. The prices are
the same for everyone. The header shows the last digits of the character that is playing, and how many characters
the tracker knows when there are more than one.

What was saved before the log said who was playing belongs to the first character that logs in. The log does not say
which league or season a character is in, so a character is told apart by its id alone.

## The prices

The tracker learns prices from the exchange: when you look an item up in the game, the prices of the listings come
back in the log, and the tracker keeps the tenth of them, which is close to what a quick sale gets.

It only knows about the items you have looked up. For the rest, set the price yourself: move to the item in the
*Bag* or the *Prices* panel and press `e`, then type the price in FE and press `enter`. A price you set wins over
one that was learned, and it is kept when the tracker is closed.

Not sure what an item is? Pick it in the *Bag* or the *Prices* panel and press `i`: the tracker opens its page on the
[Torchlight: Infinite wiki](https://tlidb.com) in your browser, with the picture, the tier and what it does. The
tracker only reads the wiki's public pages for this; it asks for the page of the item's name, and if the wiki has
none under that name (the names in the tracker can be older than the wiki's), for the name the wiki gives the item's
id. An item with no page of that name opens the wiki's search for it.

Under both of them sits the community price: what players saw an item go for on the auction house,
collected by [TLI Companion](https://tlicompanion.com). The tracker reads its public API (see [the
docs](https://tlicompanion.com/api)) and uses the prices for the items nobody looked up. A price you set and a
price learned from the exchange both win over the community price.

The *Prices* panel says where each price comes from: `*` for a price you set, `·` for one learned from the
exchange and `~` for a community price. The footer says how many community prices there are, where they are from
and how old they are. The site asks to be credited where its prices are shown, so the footer says *Prices:
tlicompanion.com* with the link to it.

The community prices are fetched at most once an hour and are kept in
`~/.local/share/tli-tracker/baseline.json`, so the tracker works the same without a network. Press `b` to fetch
them again. To turn them off:

```
bun run tracker --no-baseline
```

The community price is the middle of the prices players saw, and the tracker's own price is the tenth of the
listings on the exchange, so the two can differ. Where they do, the tracker's own price wins.

## Search the bag and the prices

When the bag is long, it is easier to look at a part of it. Put the focus on the *Bag* or the *Prices* and press
`/`: a search box opens at the bottom of the screen, and the list is filtered as you type. `enter` keeps the filter
and gives the keys back, `esc` takes the filter away.

A word matches an item when its name has the word in it, when the word is the number of the item, or when the word
is the start of one of the words of the name. Capitals do not matter, and when you write more than one word, all of
them have to match: `iron sword` finds the iron swords.

The title of the panel says what is going on: `Bag (167)` when nothing is filtered, and `Bag /iron (5/167)` when
five things match. The bag and the prices each have their own filter.

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

The report starts from what the tracker saved and reads the log on from where the tracker left it,
so it says the same as the screen; `--full` reads the whole log from its beginning instead. Every
line of the report says what kind of run it is about: `map` for a trip into a map, `prison` for a
visit to the Tartarus prison.

## Start again later

The tracker keeps the runs, the bag, the prices, what the exchange did, the sessions and its place in the log in a
SQLite database, `~/.local/share/tli-tracker/tracker.db`, so when it starts again it carries on where it left off.
What a character owns is kept under the character's id. `--reset` makes it forget and read the log from its
beginning. A log that was truncated (the game was restarted) or rotated is read from its beginning again.

The database can be looked at while the tracker runs (it is in WAL mode, so a look never gets in
the tracker's way):

```
sqlite3 ~/.local/share/tli-tracker/tracker.db 'select kind, count(*) from runs group by kind'
sqlite3 ~/.local/share/tli-tracker/tracker.db 'select name, fe from runs order by start_ms desc limit 5'
```

The state the tracker kept as `state.json` is brought in by itself the first time it runs, and the
old file is renamed to `state.json.imported` and kept. A database the tracker cannot use is moved
aside as `tracker.db.corrupt` and kept as well.

## Name the items yourself

The tracker ships with the names of most items, built from the [Torchlight: Infinite wiki](https://tlidb.com): the item
data the [TITrack](https://github.com/astockman99/TITrack) project builds from the wiki, and the wiki itself, which
`packages/tracker/scripts/scrape-tlidb.ts` reads for the ids that the first one leaves out. The ones it still does
not know are shown as `Item #<id>`. Name them in `~/.config/tli-tracker/items.json`:

```json
{ "3210": "Iron Sword", "3510": "Oak Staff" }
```
