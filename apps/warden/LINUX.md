# Warden on Linux (terminal, Niri)

`warden-tui` is a terminal version of Warden for Linux under Niri. It uses the same reader, solver and session as the
Windows window; only the window capture and the text reader differ.

```
cargo build --release --bin warden-tui --bin warden-cli
target/release/warden-tui                       # follow the running game
target/release/warden-tui --image frame.png     # read one screenshot, print, exit
```

- Needs `tesseract` with the English data (Arch: `pacman -S tesseract tesseract-data-eng`). It replaces Windows OCR.
- The game window is found through `niri msg` (app id `steam_app_1974050`, else a title containing "Torchlight";
  `--title TEXT` changes that). A **fullscreen** game on a visible workspace is captured with `grim` (silent, about
  40 ms). Niri sends a "Screenshot captured" notification for every `niri msg action screenshot-window` and can't turn
  it off, so that is only the fallback for a game that isn't fullscreen (or if `grim` is missing).
- The reader needs the picture at 16:9 or wider: play fullscreen, or floating at that shape. A tiled window of another
  shape is not read.
- Keys: `r` read now, `q` quit. Auto read is always on (the screen is sampled 4 times a second).
- `warden-cli read|solve|capture|bench` work on Linux too (`capture` uses niri).
