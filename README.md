# TLI Tools

Terminal tools for **Torchlight: Infinite** on Linux: two minigame helpers (Vorax, Tartarus Warden), two log trackers
(loot, Arcana) and a launcher that ties them together. TypeScript on [Bun](https://bun.sh), screens drawn with
[OpenTUI](https://opentui.com/docs).

| Tool | What it does | Reads |
|------|--------------|-------|
| **Vorax Helper** | Shows the best move in the Vorax / Surgical Preparation minigame | game window + log |
| **Warden** | Reads the Tartarus prison board and recommends the next move | game window + log |
| **Loot tracker** | Runs, loot, prices, FE per hour and net worth | log |
| **Arcana tracker** | Tarot Path visits, Fateful Contests, and what the chests gave | log |

Unofficial. Not affiliated with or endorsed by the developers or publishers of *Torchlight: Infinite*. The tools only
read the game's pixels (Vorax, Warden) and its log file. They never touch the game's memory or network traffic, and
they never click or type in the game. The only thing they fetch from the internet is the optional community price list
for the loot tracker (`--no-baseline` turns it off).

## Quick start

```
bun install
bun run start          # the dashboard: ↑/↓ move, space select, enter run, w window, q quit
```

Turn on the game's log once (Esc → Account Related → Enable Log). The trackers need it, and the minigame helpers use
it to know when their board is open.

Or run a tool directly:

| Command | Runs |
|---------|------|
| `bun run vorax` | Vorax Helper |
| `bun run warden` | Warden |
| `bun run warden:cli -- read\|solve\|capture\|bench …` | Warden command line |
| `bun run tracker` | Loot tracker |
| `bun run tracker:report` | Loot report as a csv file |
| `bun run arcana` | Arcana tracker |
| `bun run test` | All test suites |
| `bun run typecheck` | Typecheck everything |

## Requirements

- Linux with [Bun](https://bun.sh).
- For the game-window readers (Vorax, Warden): `tesseract` with the English data
  (Arch: `pacman -S tesseract tesseract-data-eng`) and a way to capture the game window:
  - [Niri](https://github.com/YaLTeR/niri) works out of the box, with `grim` for a silent capture of a game that is on
    the screen. Niri's own window screenshot is never used by default because it announces every picture;
    `--niri-screenshot` or `TLI_NIRI_SCREENSHOT=1` opts in.
  - Other compositors can supply a command that writes a PNG (see [Other compositors](docs/how-to-other-compositors.md)).
- Optional: `tmux`. From the loot tracker or the dashboard, `a` / `v` / `w` open Arcana, Vorax or Warden in a pane
  beside it (or in a new terminal window outside tmux) without closing the tracker.

## How the log is used

The game's log (`UE_game.log`) says which minigame is on screen. The dashboard shows that as a badge next to each tool,
and Vorax and Warden wait for their board instead of looking at the game window while it is closed. A readable log
with detail lines but no open board counts as closed. Without detail lines (the log is missing, or Enable Log is off)
the helpers fall back to watching the screen.

## What is in here

| Path | What it is |
|------|------------|
| `apps/dashboard` | Terminal launcher: pick the tools to run |
| `apps/vorax` | Vorax / Surgical Preparation helper |
| `apps/warden` | Tartarus prison board advisor |
| `apps/tracker` | Loot tracker |
| `apps/arcana` | Arcana tracker |
| `packages/tui` | Shared OpenTUI theme, formatting, table rows and app start-up |
| `packages/png` | PNG decode and encode |
| `packages/capture` | Silent game-window capture on Linux (`grim`, or a custom command) |
| `packages/ocr` | `tesseract` runner and TSV parser |
| `packages/gamelog` | Where the game's log is, and which minigame it says is open |
| `packages/launch` | The tools that can be started, and the terminal windows or tmux panes to start them in |
| `packages/tracker` | Log parsing behind the loot tracker: the bag, the runs, the prices |
| `packages/arcana` | Log parsing behind the Arcana tracker: Tarot Path sessions, Fateful Contests, trials |

## Documentation

| Document | For |
|----------|-----|
| [Getting started](docs/tutorial-getting-started.md) | A first run of each tool, step by step |
| [Tracking your loot](docs/how-to-track-your-loot.md) | The loot tracker: the log, the prices, the report |
| [Tracking your Tarot Path](docs/how-to-track-your-arcana.md) | The Arcana tracker: the visits, the chests, the Fateful Contests |
| [Other compositors](docs/how-to-other-compositors.md) | Running without Niri |
| [Adding a tool to the dashboard](apps/dashboard/README.md#adding-a-tool) | One entry in `packages/launch/src/tools.ts` |
| [How the tools work](docs/explanation-how-it-works.md) | Capture, reader, solver, the Rust port, the Windows apps |
| [Third-party data](docs/third-party-data.md) | Where prices and item names come from, and under which licence |

Each tool's options and keys are in its own README:
[Vorax](apps/vorax/README.md), [Warden](apps/warden/LINUX.md), [loot tracker](apps/tracker/README.md),
[Arcana](apps/arcana/README.md).

## Credits and licences

This repository is built on the work of others. Vorax and Warden started as separate projects, and their git history is
kept here (imported with `git subtree`).

| App | Original project | Author | Licence |
|-----|------------------|--------|---------|
| [`apps/warden`](apps/warden) | [arcasti/tli-warden](https://github.com/arcasti/tli-warden) | arcasti | GPL-3.0-only |
| [`apps/vorax`](apps/vorax) | [Timer-Lol/Voraxhalper](https://github.com/Timer-Lol/Voraxhalper) | Timer, tidewarden | MIT |

- **Vorax Helper** also builds on Moebing's original *Torchlight-Infinite-SS11-Vorax-simulator*, credited in
  [`apps/vorax/LICENSE`](apps/vorax/LICENSE).
- **Warden** was originally a Rust app. The TypeScript version in `apps/warden/ts` is now the main one and the only one
  that gets changes. The Rust source stays in `apps/warden/src` (it is the only version with the Windows window) but is
  deprecated: it is no longer kept in step, and the TypeScript tests no longer have to match its output.
- The shared packages (`png`, `capture`, `ocr`, `gamelog`) were factored out of code written for those two projects.
- The loot tracker uses data other people made: community prices from [TLI Companion](https://tlicompanion.com)
  (credit: **Prices: tlicompanion.com**) and item names from the
  [Torchlight: Infinite wiki](https://tlidb.com). Details in [`docs/third-party-data.md`](docs/third-party-data.md).

Each app keeps its own licence (see the `LICENSE` file in its folder). The repository root has no licence of its own:
files under `apps/warden` are GPL-3.0-only, files under `apps/vorax` are MIT.
