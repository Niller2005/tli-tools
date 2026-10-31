# @tli/capture

A picture of the game window on Linux, for the readers that follow a running
game (Vorax's helper today; Warden's reader can use it too).

Default: silent `grim` capture only. The picture is the whole output when the
game fills it, and the part of the output the game is in otherwise. `grim`
writes the pixels as they are, in a PPM, so there is no PNG to decode: a
picture of a 2560 x 1440 output costs 15 ms instead of 95 ms. Niri's own
`niri msg action screenshot-window --id N` can take a window that is hidden or
on another workspace, but Niri announces every one of those with a "Screenshot
captured" notification and cannot turn it off. It is therefore never used by
default: when the game is not visible to `grim`, `grab()` throws and says that
no picture was taken.

Niri's window screenshot needs an explicit opt-in: set `TLI_NIRI_SCREENSHOT=1`
or pass `niriScreenshot: true` to `createCapture`. The Vorax and Warden CLIs
and TUIs expose the same choice as `--niri-screenshot`. An explicit `false`
option wins over the environment variable.

Any other compositor: `command` is a shell command that writes a PNG of the
game to `{out}`, which the capture replaces with the file it wants.

`TLI_NO_CAPTURE=1` turns every picture off: the capture says `capture disabled`
and neither Niri nor `grim` is run. The tests run with it, so they never touch
the player's own desktop. After a failed capture, the next automatic attempt
waits briefly instead of retrying in a tight loop; a manual read can force it.

## What it gives

```ts
export interface Capture {
  /** the capture's state for the header: which window, or why there is none */
  status(): string
  /** a picture of the game window; throws when there is none */
  grab(): Promise<Image<Uint8ClampedArray>>
  close(): void
}

export function createCapture(o: {
  title: RegExp
  command?: string
  niriScreenshot?: boolean
}): Capture
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
- `none`: no silent picture is possible; the plan says why.
- `window`: Niri's own picture of the window, chosen only with the explicit
  opt-in. Niri announces it.

A window on a workspace that is not the one on the screen is not on the screen
at all. A window behind the overview, or hidden behind a floating window, is
not visible to `grim` either. By default these cases produce a `none` plan and
no picture; with the opt-in they use Niri's announced window screenshot.
