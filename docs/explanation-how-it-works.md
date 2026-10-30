# How the tools work

This page explains what happens between the game window and the move on your screen, and why the repo is laid out as
it is. For steps to follow, see the [getting-started tutorial](tutorial-getting-started.md).

## The pipeline

Both tools do the same four things:

1. **Capture.** `@tli/capture` takes a picture of the game window. On Niri it asks the compositor for the window; if
   the game fills its output and is the active window it uses `grim` instead, because Niri announces every window
   screenshot with a notification that can't be turned off.
2. **Read.** The picture becomes a model of the board. Template matching and pixel measurements find the cells,
   Inmates and instruments. Text such as the day counter and card names goes through `tesseract` (`@tli/ocr`).
3. **Solve.** The model is rebuilt as a game state for the rules engine, and the solver plays it out many times to
   rank the moves. Both the engine and the solver are seeded, so the same board and seed give the same answer.
4. **Show.** The TUI prints the best move and the ranking. Nothing is sent back to the game.

Vorax also follows the game's log file, which tells it when a move happened, so it knows when to take the next
picture. Warden samples the screen about four times a second and reads again when the picture changes.

## Warden's pieces

All under `apps/warden/ts/src`:

| Folder | Role |
|--------|------|
| `reader/` | Picture to board model: layout, scene (Inmates), panels (text), instruments |
| `board/` | The board model, and the step that rebuilds a game state from it |
| `engine/` | The Tartarus rules, with a seeded random stream |
| `solver/` | Plays the game forward to rank moves (rollouts and a chain solver for devour chains) |
| `app/` | A session that runs reads and solves in the background, the run log and the settings |
| `bin/` | The terminal UI and the command line |

## Why Warden was ported from Rust

Warden began as a Rust app. The monorepo is all TypeScript on Bun so the tools can share code and run from one
dashboard. The Rust source stays in `apps/warden/src` and is the reference: the port was accepted only when it matched
it.

- The engine replays the same recorded games as the Rust, state for state.
- The solver and board model match the recorded solves and boards.
- The reader gives the same model JSON, and the CLI the same text, on the real screenshots tested.

The TypeScript solver is slower than the Rust one, by roughly a factor of five. The results are identical, but the
Rust version is faster if you need many rollouts.

## Why there are shared packages

PNG decoding, window capture and running `tesseract` were written twice, once per tool. They live in
[`packages/`](../packages) so there is one copy. Game-specific code, such as each game's engine and random numbers,
stays in its app on purpose.

## The Windows apps

This repo is about the Linux terminal tools. Both original projects also have Windows apps, and the code for them is
still here but not part of the Linux build:

- **Warden:** the Rust crate in `apps/warden/src` builds the Windows window (an egui app with a hotkey, installer and
  updater). The TypeScript port does not include it.
- **Vorax Helper:** the Windows desktop app is in `apps/vorax/desktop`, with the batch files in `apps/vorax`.

Their own READMEs ([Warden](../apps/warden/README.md), [Vorax](../apps/vorax/README.md)) describe installing and
using them.
