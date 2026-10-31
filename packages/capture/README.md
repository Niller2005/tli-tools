# @tli/capture

A picture of the game window on Linux, for the readers that follow a running
game (Vorax's helper today; Warden's reader can use it too).

Default: Niri (`niri msg action screenshot-window --id N`, the window alone,
even behind others, the clipboard untouched). Niri announces every one of those
with a "Screenshot captured" notification and cannot turn it off, so the picture
is taken with `grim` whenever the game is on the screen: the whole output when
the game fills it, and the part of the output the game is in otherwise. Niri
says where a window is only for the floating ones, so a tiled game that does not
fill its output, and a game on a workspace that is not the one on the screen,
still come from Niri.

Any other compositor: `command` is a shell command that writes a PNG of the
game to `{out}`, which the capture replaces with the file it wants.

`TLI_NO_CAPTURE=1` turns every picture off: the capture says `capture disabled`
and neither Niri nor `grim` is run. The tests run with it, so they never touch
the player's own desktop.

## What it gives

```ts
export interface Capture {
  /** the capture's state for the header: which window, or why there is none */
  status(): string
  /** a picture of the game window; throws when there is none */
  grab(): Promise<Image<Uint8ClampedArray>>
  close(): void
}

export function createCapture(o: { title: RegExp; command?: string }): Capture
export const STEAM_APP: string
```

The picture is the shared image type of `@tli/png`: RGBA, four bytes a pixel.
For a reader that keeps its pixels in a plain byte array, `asBytes` of
`@tli/png` gives the same memory as one, without a copy.

## Where the picture comes from

[`src/geometry.ts`](src/geometry.ts) holds the decision on its own, with no
process and no screen: given the game window, the other windows, the
workspaces and the outputs, it says how the picture should be taken.

- `output`: the whole output, through `grim -o`.
- `region`: the part of the output the game is in, through `grim -g`. The
  region is in logical pixels, so `grim` scales it for the output.
- `window`: Niri's own picture of the window, which Niri announces.

A window that is on a workspace that is not the one on the screen is not on the
screen at all, and a window behind the overview is not either: both come from
Niri. So does a game that is hidden behind a floating window.
