# Warden on Linux (terminal, Niri)

Warden's terminal version for Linux under Niri. It is written in TypeScript (`ts/`) and runs with `bun`; it is the
main version of Warden. (The Rust `warden-tui` is deprecated and no longer kept in step: see the notice in
[README.md](README.md).)

```
bun run tui                                      # follow the running game
bun run tui --image frame.png                    # read one screenshot, print, exit
bun run tui --no-log                             # follow the running game, without the game's log
bun run tui --no-color                           # draw without colours
bun run tui --capture-cmd 'grim -g "0,0 1920x1080" {out}'   # another compositor: the picture comes from that command
bun run cli solve frame.png --seed 1 --rollouts 400
```

With `bun run overlay` running in another terminal (see [`packages/overlay`](../../packages/overlay/README.md)), the
move and the ranking also appear in a card over the game. The capture blacks the card out of every picture it takes,
so place it where the board is not read (`--left`, `--top`). The overlay also outlines the cell, door, button or card
to click for the advised move.

`bun run tui` and `bun run cli` are the scripts in `package.json`; they run `ts/src/bin/warden-tui.ts` and
`ts/src/bin/warden-cli.ts`. They need `bun` and `tesseract`.

- Needs `tesseract` with the English data (Arch: `pacman -S tesseract tesseract-data-eng`). It replaces Windows OCR.
- The game window is found through `niri msg` (app id `steam_app_1974050`, else a title containing "Torchlight";
  `--title TEXT` changes that). A game that is **on the screen** is captured with `grim` (silent, about 40 ms): the whole
  output when the game fills it, and the part of the output the game is in otherwise. Niri's own window screenshot always
  sends a "Screenshot captured" notification, so it is never used by default. When the game is not visible to `grim`,
  the tool takes no picture and says that the game is not on screen.
- `--niri-screenshot` (or `TLI_NIRI_SCREENSHOT=1`) allows Niri's announced window screenshot. Leave it off to avoid the
  notification completely.
- The reader needs the picture at 16:9 or wider: play fullscreen, or floating at that shape. A tiled window of another
  shape is not read.
- Keys: `r` read now (one forced read, even when the log says the board is closed), `q` quit. Auto read is always on
  (the screen is sampled 4 times a second).
- The terminal screen is drawn with [OpenTUI](https://opentui.com/docs); the terminal is restored on every way out.
- The game's log (`UE_game.log`) says whether the Tartarus board is on screen. While the log says the board is closed,
  the game window is not looked at and the header says `board closed – waiting for the board`; the board is read as soon
  as the log says it opened. A readable log with detail lines but no board state is also treated as closed. Only a
  missing log, or one without detail lines, falls back to watching the screen. `--no-log` keeps that fallback explicit.
- `warden-cli read|solve|capture|bench` work on Linux too. The `capture` command also accepts `--niri-screenshot`.
- `TLI_NO_CAPTURE=1` turns every picture off: the tool says `capture disabled` and neither niri nor grim is run. The
  tests run with it, so they never touch the player's own desktop.

The bars are the shared chrome: on a narrow terminal the header cuts its "Tartarus prison board,
Linux terminal" note from the front (the name stays) and leaves its state chips out, and the
footer gives up the legend of the board's marks before the keys; of the keys, the read key and the
quit key are the last to go.
