# @tli/overlay

A card over the game for Vorax and Warden, drawn on a [wlr-layer-shell](https://wayland.app/protocols/wlr-layer-shell-unstable-v1)
surface in the `overlay` layer. That layer is above fullscreen windows, so the card stays on top of the game without
touching it: the surface takes no input (an empty input region, no keyboard), and every click and key goes to the game.

```
bun run overlay                     # leave it running; it shows a card while Vorax or Warden has a board
bun run overlay -- --output=DP-1 --left=24 --top=700 --size=16
```

The loot tracker starts the overlay itself when its loot card is turned on (`ensureOverlay` in `src/index.ts`).
That one runs with `--auto-exit`: it closes a few seconds after the last tool that published a card (or asked for the
overlay) has ended. Vorax and Warden use an overlay that is already running, and keep an auto-started one open while
they run. Only one overlay runs at a time; a second `bun run overlay` exits. Errors of an auto-started one go to
`$XDG_RUNTIME_DIR/tli-overlay/overlay.log`.

| Option | Default | |
|--------|---------|--|
| `--output` | the output the game's window is on (asked from Niri), else the first | monitor to draw on, e.g. `DP-1` |
| `--left`, `--top` | 24, 700 | offset from the top-left corner, in logical pixels |
| `--right` | off | measure `--left` from the right edge |
| `--width` | 38 | width of a card, in characters |
| `--size` | 16 | font size in pixels |
| `--opacity` | 0.86 | how solid the card's background is |
| `--loot-opacity` | 0.45 | how solid the background of a corner card is |
| `--margin` | 24 | distance of a corner card from the screen's edges |
| `--margin-left` | 380 | distance of the bottom-left card from the left edge, so it sits to the right of the game's chat |

Needs `python-gobject`, `gtk4` and `gtk4-layer-shell` (Arch: `pacman -S python-gobject gtk4 gtk4-layer-shell`), and a
compositor with layer-shell (Niri, Sway, Hyprland, KDE; not GNOME). `scripts/start.ts` sets `LD_PRELOAD` for
`libgtk4-layer-shell`, which has to load before `libwayland`.

A card with `corner` set (`bottom-left` or `bottom-right`; the loot tracker's, from `bun run tracker -- --overlay=left`)
is drawn in that corner on a mostly transparent background instead of in the main stack, and is masked out of captures
like the others.

## In OBS as its own source

A PipeWire window capture of the game never has the card in it (the card is a separate surface), and a monitor
capture has it fixed on top of the game. To use a card as a source of its own, serve it as a browser source:

```
bun run overlay:obs                  # http://127.0.0.1:7391, localhost only; --port=<n> to change
```

In OBS: Sources, Browser, URL `http://127.0.0.1:7391/?tool=tracker` (`tool` takes `tracker`, `vorax`, `warden`,
comma-separated; without it every card shows). The page has a transparent background, so set the source's width and
height as you like and clear the custom CSS. It shows the cards the tools publish, so the tracker's loot card has to be
on (`o` in the tracker, or `--overlay=left|right`), which also draws it over the game. It is the same card text as
the overlay, with the corner card's look; the main stack's frame and the outline are not drawn.

## The outline

Warden also marks what to click: the advised cell, destination door, button or pick card gets a gold outline drawn on a
second, transparent layer surface that covers the output. The tool turns the target it already finds on the frame into
the compositor's logical pixels (`Card.marks`, using `capture.area()`, where the picture was taken from) and the overlay
draws four bars around it, 6 px outside the target. The bars sit between the cards, not on them, and only the bars are
blacked out of the pictures, so the reader still sees the whole card. The mark is only there while the screen read
still matches the screen (no solve running, no popup) and only when the picture came from `grim`, as the position of a
picture from a custom command or Niri's window screenshot is not known.

## How it fits together

- **Tools to overlay.** Vorax and Warden call `publishCard()` each time they draw, and take the card down when the board
  is gone or they exit. Cards are JSON in `$XDG_RUNTIME_DIR/tli-overlay/cards/<tool>.json`; a card whose process has
  died is ignored.
  Warden holds its card while a solve runs: the move it showed first stays, with no ranking rows, until the solve
  ends, and then the finished card (the move, its rows and the outline) replaces it once. Reads of the same board
  during the solve do not change it.
- **Overlay to capture.** `grim` takes a whole output, layers included, so the card would be in the picture the readers
  OCR, and its changing text would look like a change in the game. The overlay therefore writes where its cards are to
  `rects.json`, and `@tli/capture` blacks those rectangles out of every picture. Put the card where the readers do not
  need to look, or the black box takes part of the board with it. Nothing is hidden or redrawn between captures, so
  the card never flickers.
- It never reads the game and never sends it anything.

## Limits

- The card is not draggable (a click-through surface cannot be); move it with the options.
- Only the `grim` and region capture paths are masked. A custom `--capture-cmd` or Niri's own window screenshot is
  taken as it comes (the window screenshot does not include layers; a custom command might).
