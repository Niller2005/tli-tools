# Getting started: read your first board on Linux

In this tutorial you install the tools, start the dashboard, and get a recommended move from Warden and from Vorax
Helper. It takes about 15 minutes. You don't need the game running until step 4.

Both tools only read pixels from the game window. They never click or type in the game; you play every move yourself.

## Before you start

You need:

- Linux, and a terminal.
- [Bun](https://bun.sh). Check: `bun --version` prints a version.
- `tesseract` with the English data. Check: `tesseract --version` prints a version. On Arch:
  `sudo pacman -S tesseract tesseract-data-eng`.
- For live play (steps 4 and 5): the [Niri](https://github.com/YaLTeR/niri) compositor. `grim` is optional and makes
  captures silent when the game is fullscreen.
- For step 6 only: `tmux`.

## Step 1: Get the code and install

```
git clone <this repository's URL> tli-tools
cd tli-tools
bun install
```

`bun install` finishes without errors. All commands below run from the `tli-tools` folder.

## Step 2: Start the dashboard

```
bun run start
```

A list of tools appears: Vorax Helper and Tartarus Warden. Press `↓` and `↑` to move the cursor; a one-line
description of the tool under the cursor is shown. Press `q` to quit.

## Step 3: Read a screenshot with Warden

You can try Warden without the game, using the sample screenshot in `docs/`: a Tartarus board on day 1.

```
bun run warden -- --image "$PWD/docs/sample-warden-patrol.png"
```

Use the full path: `bun run` starts in the app's folder, so a relative path would not be found.

Warden reads the screenshot, prints the advice and exits. You should see:

```
Day 1 · 19 to Riot · Behind Cell Doors 4/10

NEXT MOVE
  Go to cell 03
  A new Inmate, who may consume today.
```

Below that is the board, one cell per slot: `@` marks your Warden, `locked` is a sealed cell, and a name such as
`Mag Wolf` is an Inmate (tier and beast). After the board comes a ranked list of moves with their expected Riot loot:

```
Moves by Riot loot per run (Chromatic 1, Ultimate 0.2, Legendary 0.05)
   1   4.86  Go to cell 03
   2   4.50  Go to cell 04
   3   4.46  Go to cell 06
```

The top row is the recommendation. The exact numbers can differ a little between runs because the advice is a
simulation. A `?` beside a cell means Warden was not sure of what it read there: check that cell on screen.

To use your own screenshot, pass its full path the same way. Warden needs the picture at 16:9 or wider.

## Step 4: Follow a live game with Warden

1. Start Torchlight: Infinite and put it **fullscreen**, with the Tartarus board showing.
2. In the dashboard, move to Tartarus Warden and press `enter`.

Warden finds the game window, reads the board about four times a second, and updates the move when the board
changes. Press `r` to read now, and `q` to leave and return to the dashboard.

If the game isn't running, Warden shows `game window not found: start Torchlight: Infinite`. Start the game; Warden
picks it up on its own.

## Step 5: Try Vorax Helper

Vorax Helper advises on the Vorax / Surgical Preparation minigame. Try it on a saved screenshot first:

```
cd apps/vorax
bun scripts/tui.ts --image=tests/fixtures/board-1080p.png
cd ../..
```

It prints the board it read and the move to make:

```
Round 1 · instrument pick · refreshes: 3 potion, 2 instrument

NEXT MOVE
  Take Aberrant Sprout (any is as good)
```

Under the move is a table of the other options, played out to the end of the run, with the expected score and your
chance of reaching the target.

For a live game, start the game, then pick Vorax Helper in the dashboard. It follows the game's log file, takes a
picture of the window after each move, and updates the advice. Keys:

| Key | Action |
|-----|--------|
| `r` | Read now |
| `t` | Change the target score (600k, 700k, 925k, 1.12M) |
| `d` | Turn the deep check on or off |
| `q` | Quit |

## Step 6: Run both at once

Two full-screen programs can't share one terminal, so the dashboard uses `tmux`.

1. In the dashboard, press `space` on each tool, or press `a` to select all.
2. Press `enter`.

Both tools open in tiled `tmux` panes. If a tool exits, its pane stays open so you can read any error. Without `tmux`,
the dashboard tells you to select one tool instead.

## Where to go next

- [`apps/warden/LINUX.md`](../apps/warden/LINUX.md): Warden options, including `--title` and `--rollouts`.
- [`apps/vorax/README.md`](../apps/vorax/README.md): Vorax options, including `--log`, `--target` and
  `--capture-cmd` for compositors other than Niri.
- If a board doesn't read, check that the game is 16:9 or wider and that `tesseract` is installed with the English
  data (step "Before you start").
