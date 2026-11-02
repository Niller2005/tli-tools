# Arcana: the Tarot Path and the Fateful Contest

A Torchlight: Infinite tracker for the Arcana season, in the terminal. It reads the game's log
file and keeps what the log says about the season's minigame: the visits to the Tarot Path, the
moves you made on it, the notes and the chests you took, the trials you fought, and what the
Fateful Contest's chests of destiny gave you.

It only reads the log: it never touches the game, and it never sends anything over the network.

```
bun run arcana                     # from the repo root
bun src/tui.ts                     # from apps/arcana
bun src/tui.ts --log=<UE_game.log>  # read another log
bun src/tui.ts --reset              # forget what was saved and read the log from its start
bun src/tui.ts --no-backfill        # do not read the log's old lines, only the new ones
bun src/tui.ts --no-color           # draw without colours
```

## What it shows

| Panel | What is in it |
|-------|---------------|
| The top lines | the name of the app and the state of the Tarot Path and the trade tax as chips, on the bar along the top, and the log it is reading |
| Now | the visit that is going on: how long, how many moves, the cells walked, the cards played, the notes gained, the life lost and won, the chests of destiny taken, with the chests carried as a bar out of the seven the game's bar holds |
| History | every visit, newest first, with the Fateful Contest that followed it; `enter` opens the detail of one |
| Lifetime totals | everything the player did: visits, moves, notes, cards, life, chests by rarity, trials fought, and what the contests' chests gave, valued |

The keys:

| Key | What it does |
|-----|--------------|
| `↑` `↓` (or `k` `j`) | Move in the history; scroll in the detail and the totals |
| `page up` `page down` | Move ten rows |
| `tab` | The next panel (`shift+tab` the one before) |
| `enter` | The detail of the visit that is picked out; `enter` or `esc` goes back |
| `esc` | Back |
| `t` | The trade tax on and off (12.5% of everything but FE, which is what the exchange takes) |
| `r` | Read the log again |
| `?` | The help |
| `q` | Quit |

The mouse picks a row of the history, and the wheel scrolls the list that is open.

## The colours

The colours are the ones every tool in this repo shares, and each one has a job, so the same kind
of number is the same colour everywhere:

| Colour | What it marks here |
|--------|--------------------|
| orange (the brand) | the name of the tool in the bar along the top |
| cyan | the focused panel, the picked row, the keys in the footer |
| gold | FE: what the contests' rewards are worth |
| green / red | life won and life lost, the Tarot Path open and the tax on |
| blue | names: the visits' numbers, the rewards' names, the chests of a contest |
| purple | rare things: the chests of destiny by rarity, the notes, the trials' arcana |
| orange | effort: moves, cells, cards, chest counts, a contest in the fight |
| teal | times: the stamps, the durations, the clocks |
| dim | labels, the log's path, the quiet notes |

The state of the Tarot Path and the trade tax are chips — short labels on a tinted background —
and the keys in the footer sit on key caps. The panel that has the focus is told by its heavy
border and the filled dot in its title, not by the colour alone. With `--no-color` (or
`NO_COLOR`) the chips become `[Tarot Path: open]`, the keys plain words, the meter a plain bar
and the focused panel keeps its heavy border: everything still reads.

## What the log really carries

The log is written by the game, not by this app, so what can be tracked is what the game happens
to say. For the Tarot Path it says:

- **that the board is open**: `PageName = S9Taro , PageRunState = Run` (and `Hide` or `Destory`
  when it closes). The Fateful Contest's page is `S9Challenge`, and the game asks
  `Start Fateful Contest with collected Chests of Destiny?` before it starts.
- **the moves**: every move is a run of `S9Taro HandleOrderAni Start Step=<n> Type=<step>`, and the
  steps are `CardDraw` (a card is used), `MoveTo` (the marker walks), `CardGroupAdd` (cards come
  into the hand), `RewardRarityUp` (a chest's rarity is raised) and `HPTo` (life changes).
- **the path**: `S9LineShort`/`S9LineLong` with `Anim_D` (the path ahead is drawn) and `Anim_Light`
  (the path under the marker is lit), and the cells with `S9Tile Anim_ShowL`/`ShowR` (the cell was
  shown to that side), `Anim_Xiaoshi` (it vanished) and `Anim_Chuxian` (it appeared).
- **the chests of destiny**: `S9Reward Anim_<Rarity>` when a chest enters the carried bar, and
  `S9Reward Anim_Taro_RewardUpgrade` when its rarity is raised. The rarities are the game's own
  Chinese colours: Bai (white), Green, Blue, Zi (purple), Jin (orange), Hong (red) and Cai
  (rainbow). The carried bar holds seven chests; when a cell shows a chest and no chest enters the
  bar, that chest was left behind, and the tracker counts it as such. The log does not say why it
  was left behind, so the tracker does not guess.
- **the rarity raised of a chest that was already carried in.** A chest that was in the bar before the
  tracker started is not in the log, so the raises of its rarity are not counted either.
- **the cards in hand**: `S9HandCard Anim_Putong_Jinpai` (a note came into the hand),
  `Anim_Dachu` (a card was used) and `Anim_Xipai` (the hand was shuffled).
- **the life**: `MsgMgr@:Show MsgValue = Life -1` (and `Life +1`, `Life +2`).
- **the trials**: a tarot card turning over in a stage is `Play_Obj_S9_SMTL_KaPai_Turn_Slow`, and the
  trial's story is `Play_VO_Story_S9_3_<n>_<Arcana>`, which names it: The Sun, The Hermit, The
  Chariot, The Devil, The Magician, The Emperor, The Hanged Man, The Star.
- **what the chests gave**: the item changes the game writes when you pick the loot up
  (`ItemChange@ Add|Update ...` inside a `PickItem`/`PickItems` block). The Fateful Contest is its
  own level (`LevelMgr@ LevelUid, LevelType, LevelId = 3100 19 203013`), so the fight has a start
  and an end, and a chest's rewards are the loot picked up just after it was opened
  (`Play_Obj_S9_SMTL_BaoXiang_Open_01`).

The rewards are valued with the prices the exchange put in the log, the same prices the loot
tracker uses: the tenth of the listings of each item that was looked up, which is close to what a
quick sale gets. An item nobody looked up shows *no price*.

## What the log does not carry

This is the honest list of what cannot be tracked, and why there is no solver here yet:

- **The board itself.** The log says that a cell was shown, drawn, lit or vanished, and which widget
  id it had. It never says where that cell *is*. The widget ids are allocated as the game scrolls
  the board, so they say nothing about a position on the path. The absolute position of the marker,
  the shape of the path and which tile is next cannot be recovered from the log.
- **What is on a tile.** The log shows the icon of the cell the marker stopped on (`S9TileIcon
  Anim_<Rarity>_Show02`), so the rarity of a chest on that cell is known. It does not say what an
  event cell does, nor what a trap costs beyond the `Life -1` the game writes afterwards.
- **The hand.** The log says that a card came into the hand and that a card was used. It never says
  which card it was: the names of the notes (Advance, Retreat, Increase) are only in the messages
  the game shows, and those are not tied to a card in the log.
- **The life total.** The log writes the *change* (`Life -1`), not the life the player has left, so
  only the life lost and won can be counted.
- **The rewards of a chest, exactly.** The log does not say "this item came out of this chest". The
  attribution here is by timing: the loot picked up within a short window after a chest was opened
  is that chest's reward. The window is generous (30 seconds), so it can be off when the loot of a
  stage and the loot of a chest are picked up close together.

Reading the tiles (and the notes in hand) needs the board as it is drawn on the screen, so a solver
would need screen capture and image recognition, the way the Tartarus board helper does. That is not
in this app.

## The files

| File | What is in it |
|------|---------------|
| `$XDG_DATA_HOME/tli-arcana/arcana.db` (or `~/.local/share/tli-arcana/arcana.db`) | the visits, the contests, the trials, the bag and the prices, and where the tracker was in the log |

The tracker saves now and then — and, while it is reading the old lines of a log hundreds of
megabytes long, every so often along the way — and when it is left. Each save writes only what
changed, in one transaction, so a crash leaves the last whole save in place. When it starts again
it carries on where it left off in the log. A log that was truncated (the game was restarted) or
rotated is read from its beginning again, and the visit and the contest that were open are closed.

The database is in WAL mode, so it can be looked at while the tracker runs:

```
sqlite3 ~/.local/share/tli-arcana/arcana.db 'select id, opened_at, closed_at, cells from visits'
sqlite3 ~/.local/share/tli-arcana/arcana.db 'select count(*) from trials'
```

The state the tracker kept as `state.json` is brought in by itself the first time it runs, and the
old file is renamed to `state.json.imported` and kept. A database the tracker cannot use is moved
aside as `arcana.db.corrupt` and kept as well.

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

The tracker reads the log while the game is running and while it is not. A visit that is going on is
shown with the time it has been going so far; the times are the log's own clock, so they read the
same as they do in the log file.

A log of a few hundred megabytes is read in pieces and never held in memory all at once; the first
read says how far it is.

## Tests

```
bun test                    # the screen and what it shows, without a terminal
bun run smoke               # the screen in a real terminal (python pty)
```

The screen is drawn with [OpenTUI](https://opentui.com/docs), the same way the other tools in this
repo draw theirs: the layout is flexbox, the colours come from `@tli/tui`, and the terminal is put
back on every way out. `bun test` uses OpenTUI's test renderer, so the screen is looked at without
a terminal. `bun scripts/frame.ts` writes the same screen as an HTML page, which is how the colours
are looked at without a terminal that draws them.

The smoke test runs the app in a pty: it checks that the screen is drawn, that the keys work, that
`q` leaves the terminal as it was, and that a missing log and a log without the game's own lines are
said so.
