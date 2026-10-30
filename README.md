# TLI Tools

A monorepo of Linux terminal tools for **Torchlight: Infinite**, all in TypeScript on [Bun](https://bun.sh).

Unofficial. Not affiliated with or endorsed by the developers or publishers of *Torchlight: Infinite*. The tools only
read pixels from the game window (and, for Vorax, the game's log file). They never touch the game's memory or network
traffic, and they never click or type in the game.

## Credits

This repository is built on the work of others. Both tools started as separate projects, and their git history is kept
here (imported with `git subtree`).

| App | Original project | Author | Licence |
|-----|------------------|--------|---------|
| [`apps/warden`](apps/warden) | [arcasti/tli-warden](https://github.com/arcasti/tli-warden) | arcasti | GPL-3.0-only |
| [`apps/vorax`](apps/vorax) | [Timer-Lol/Voraxhalper](https://github.com/Timer-Lol/Voraxhalper) | Timer, tidewarden | MIT |

- **Vorax Helper** also builds on Moebing's original *Torchlight-Infinite-SS11-Vorax-simulator*, credited in
  [`apps/vorax/LICENSE`](apps/vorax/LICENSE).
- **Warden** was originally a Rust app. It is being ported to TypeScript here, and the Rust source stays in
  `apps/warden/src` until the port fully replaces it (the Windows window is not ported). The port is checked against
  the Rust output for the engine, solver and reader.
- The shared packages (`png`, `capture`, `ocr`, `gamelog`) were factored out of code written for those two projects.

Each app keeps its own licence (see the `LICENSE` file in its folder). The repository root has no licence of its own:
files under `apps/warden` are GPL-3.0-only, files under `apps/vorax` are MIT.

## What is in here

| Path | What it is |
|------|------------|
| `apps/dashboard` | Terminal launcher: pick the tools to run |
| `apps/vorax` | Vorax / Surgical Preparation helper: reads the board, shows the best move |
| `apps/warden` | Tartarus prison board advisor: reads the board, recommends the next move |
| `packages/png` | PNG decode and encode |
| `packages/capture` | Game window capture on Linux (Niri, `grim`, or a custom command) |
| `packages/gamelog` | The game's log file: where it is and which minigame it says is open |
| `packages/ocr` | `tesseract` runner and TSV parser |

The game's log (`UE_game.log`) says which minigame is on screen: the dashboard shows that as a badge next to each tool,
and Warden waits for the Tartarus board instead of looking at the game window while it is closed. The log only has
those lines when the game writes its own lines (Esc → Account Related → Enable Log); without them the tools carry on
as before.

## Requirements

- Linux with [Bun](https://bun.sh).
- `tesseract` with the English data (Arch: `pacman -S tesseract tesseract-data-eng`).
- Window capture: [Niri](https://github.com/YaLTeR/niri) is supported out of the box, with `grim` for a silent capture
  of a fullscreen game. Other compositors can supply a command that writes a PNG (see each app's README).
- `tmux`, only to run several tools at once from the dashboard.

## Quick start

```
bun install
bun run start          # the dashboard: ↑/↓ move, space select, enter run, q quit
```

Or run a tool directly:

| Command | Runs |
|---------|------|
| `bun run vorax` | Vorax Helper TUI |
| `bun run warden` | Warden TUI |
| `bun run warden:cli -- read\|solve\|capture\|bench …` | Warden command line |
| `bun run test` | Warden test suite |
| `bun run typecheck` | Typecheck all apps |

## Documentation

| Document | For |
|----------|-----|
| [Getting started](docs/tutorial-getting-started.md) | A first run of each tool, step by step |
| [Other compositors](docs/how-to-other-compositors.md) | Running without Niri |
| [Adding a tool to the dashboard](apps/dashboard/README.md#adding-a-tool) | One entry in `src/tools.ts` |
| [How the tools work](docs/explanation-how-it-works.md) | Capture, reader, solver, the Rust port, the Windows apps |

See [`apps/vorax/README.md`](apps/vorax/README.md) and [`apps/warden/LINUX.md`](apps/warden/LINUX.md) for each tool's
options and keys.
