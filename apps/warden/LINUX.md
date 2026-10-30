# Warden on Linux (terminal, Niri)

`warden-tui` is a terminal version of Warden for Linux under Niri. It uses the same reader, solver and session as the
Windows window; only the window capture and the text reader differ.

```
cargo build --release --bin warden-tui --bin warden-cli
target/release/warden-tui                       # follow the running game
target/release/warden-tui --image frame.png     # read one screenshot, print, exit
```

The same program runs from TypeScript, without the Rust build:

```
bun run tui                                      # follow the running game
bun run tui --image frame.png                    # read one screenshot, print, exit
bun run tui --no-log                             # follow the running game, without the game's log
bun run cli solve frame.png --seed 1 --rollouts 400
```

`bun run tui` and `bun run cli` are the scripts in `package.json`; they run `ts/src/bin/warden-tui.ts` and
`ts/src/bin/warden-cli.ts`. They need `bun` and the same `tesseract` as the Rust build.

- Needs `tesseract` with the English data (Arch: `pacman -S tesseract tesseract-data-eng`). It replaces Windows OCR.
- The game window is found through `niri msg` (app id `steam_app_1974050`, else a title containing "Torchlight";
  `--title TEXT` changes that). A **fullscreen** game on a visible workspace is captured with `grim` (silent, about
  40 ms). Niri sends a "Screenshot captured" notification for every `niri msg action screenshot-window` and can't turn
  it off, so that is only the fallback for a game that isn't fullscreen (or if `grim` is missing).
- The reader needs the picture at 16:9 or wider: play fullscreen, or floating at that shape. A tiled window of another
  shape is not read.
- Keys: `r` read now, `q` quit. Auto read is always on (the screen is sampled 4 times a second).
- The game's log (`UE_game.log`) says whether the Tartarus board is on screen. While the log says the board is closed,
  the game window is not looked at and the header says `board closed (waiting for the Tartarus board)`; the board is
  read as soon as the log says it opened. The log is only read when the game writes its own lines, which needs
  **Enable Log** on (Esc → Account Related → Enable Log). Without the log, or with `--no-log`, the window is watched
  as before and the reading is never held up.
- `warden-cli read|solve|capture|bench` work on Linux too (`capture` uses niri).
