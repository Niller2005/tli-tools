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

The log also says which minigame is on screen, because the game names the pages it opens: the Tartarus board is
`S16BoardMain` and the Vorax game is `S13GamePlayMain`. `@tli/gamelog` reads those lines out of the log, so the
dashboard can show a tool's minigame as open or closed, and Warden can leave the game window alone while the board is
closed instead of reading a board that is not there. The log only has those lines when the game writes its own lines
(Esc → Account Related → Enable Log); without them the tools carry on as before.

## The loot tracker's pieces

The tracker ([`apps/tracker`](../apps/tracker), [`packages/tracker`](../packages/tracker)) reads the same log file, but
for the loot instead of the board. It works out four things:

1. **Where the player is.** The game says which level it is in, with a type: the hideout is type 0, a map is type 3
   (and the harder tiers 25 and 27). A run is the time between entering a map and leaving it, and the map's path
   says which map it is.
2. **What the player has.** The game says what is in each slot of the bag. A slot's count is absolute, so the change
   is the difference against what was there before. The game writes those changes in blocks that say what caused
   them: `PickItem` and `PickItems` are loot, `Spv3Open` is the cost of opening a map, and the rest is the game
   moving things around. The tracker keeps the bag, so the net worth can be worked out.
3. **What things are worth.** When the player looks an item up on the exchange, the prices of the listings come back
   in the log. The tracker keeps the tenth of them, which is close to what a quick sale gets, and the player can set
   a price by hand.
4. **What a run was worth.** The loot of a run, at those prices, minus the tax the exchange takes (12.5% of
   everything but FE) and, when the player wants it, the cost of opening the map.

The log can be hundreds of megabytes, so it is read in pieces and never held in memory all at once. The tracker keeps
its place in the file, so it can be stopped and started again and carry on where it left off; a log that was truncated
or rotated is read from its beginning again.

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

PNG decoding, window capture and running `tesseract` were written twice, once per tool, and finding the game's log was
written twice as well. They live in [`packages/`](../packages) so there is one copy. Game-specific code, such as each
game's engine and random numbers, stays in its app on purpose.

## The Windows apps

This repo is about the Linux terminal tools. Both original projects also have Windows apps, and the code for them is
still here but not part of the Linux build:

- **Warden:** the Rust crate in `apps/warden/src` builds the Windows window (an egui app with a hotkey, installer and
  updater). The TypeScript port does not include it.
- **Vorax Helper:** the Windows desktop app is in `apps/vorax/desktop`, with the batch files in `apps/vorax`.

Their own READMEs ([Warden](../apps/warden/README.md), [Vorax](../apps/vorax/README.md)) describe installing and
using them.
