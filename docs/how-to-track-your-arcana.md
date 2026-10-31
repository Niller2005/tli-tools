# How to: track your Tarot Path runs and Fateful Contests

The Arcana tracker reads the game's log file and keeps what the log says about the season's minigame:
every visit to the Tarot Path, the moves you made on it, the notes and the chests of destiny you took,
the trials you fought, and what the Fateful Contest's chests gave you. This is how to get it going on
Linux, and what the numbers mean.

It only reads the log file. It never touches the game and never sends anything over the network.

## Start the tracker

```
bun run arcana
```

from the repo root, or pick *Arcana (Tarot Path)* in the dashboard.

The tracker finds the log by itself. When it does not, say where it is:

```
bun run arcana --log="/path/to/UE_game.log"
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

The log is written in the player's local time. The tracker shows the times as they are written in the
log, so they read the same there and on the screen.

## What the screen shows

| Panel | What is in it |
|-------|---------------|
| The top line | whether the Tarot Path is open right now, and the log that is being read |
| Now | the visit that is going on: how long, how many moves, the cells walked, the cards played, the notes gained, the life lost and won, the chests taken |
| History | every visit, newest first, with the Fateful Contest that followed it; `enter` opens the detail of one |
| Lifetime totals | everything you did: visits, moves, notes, cards, life, chests by rarity, trials fought, and what the contests' chests gave, valued |

The keys:

| Key | What it does |
|-----|--------------|
| `↑` `↓` (or `k` `j`) | Move in the history; scroll in the detail and the totals |
| `tab` | The next panel (`shift+tab` the one before) |
| `enter` | The detail of the visit that is picked out; `enter` or `esc` goes back |
| `t` | The exchange's trade tax on and off (12.5% of everything but FE) |
| `r` | Read the log again |
| `?` | The help |
| `q` | Quit |

## The chests and the notes

The rarities are the game's own: Bai (white), Green, Blue, Zi (purple), Jin (orange), Hong (red) and Cai
(rainbow). The tracker counts the chests of destiny you took by rarity, and how many times a chest's
rarity was raised by an *Auspicious Note: Increase*.

The carried bar holds seven chests. When you stop on a cell that shows a chest and no chest enters
the bar, that chest was left behind; the tracker counts those too, but the log does not say why it
happened, so it does not guess.

A note of arcana is a card in your hand: the log says that a card came into the hand and that a card
was used, but never which one. So the tracker counts the notes, and does not pretend to know what is
in your hand.

## The Fateful Contest and what its chests gave

The Fateful Contest is a fight of its own in the log (level type 19), so the tracker knows when it was
asked for, when it started and when it ended. Each chest of destiny you open in the fight is shown
with the loot that came out of it, and what that loot is worth.

The value comes from the exchange: when you look an item up in the game, the prices of the listings
come back in the log, and the tracker keeps the tenth of them, which is close to what a quick sale
gets. The tracker also uses the prices the loot tracker knows. An item nobody looked up shows
*no price*: look it up in the game, or set the price in the loot tracker with `e`.

The log does not say "this item came out of that chest". The tracker gives the loot picked up just
after a chest was opened to that chest, which is right almost always and can be off when the loot of
a stage and the loot of a chest are picked up close together.

## The trials

A tarot card turning over in a stage is a trial showing itself, and the trial's story names its
arcana: The Sun, The Hermit, The Chariot, The Devil, The Magician, The Emperor, The Hanged Man, The
Star. The tracker lists them and counts how many of each you fought.

## Start again later

The tracker keeps the visits, the contests, the trials, the bag, the prices and its place in the log in
`$XDG_DATA_HOME/tli-arcana/state.json` (`~/.local/share/tli-arcana/state.json` when `XDG_DATA_HOME` is
not set), so when it starts again it carries on where it left off. `--reset` makes it forget and read
the log from its beginning. A log that was truncated (the game was restarted) or rotated is read from
its beginning again, and the visit and the contest that were open are closed.

## What it cannot do

The board itself is not in the log. The log says that a cell was shown, drawn, lit or vanished, and
which widget id it had, but never where that cell *is*: the ids are handed out as the game scrolls the
board. So the absolute position of the marker, the shape of the path and what is on the tile next are
not recoverable, and there is no solver here: reading the board needs the screen, the way the Tartarus
board helper does it.
