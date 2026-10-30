# @tli/capture

A picture of the game window on Linux, for the readers that follow a running
game (Vorax's helper today; Warden's reader can use it too).

Default: Niri (`niri msg action screenshot-window --id N`, the window alone,
even behind others, the clipboard untouched). A game that fills its output and
is its workspace's active window is taken with `grim` instead (the whole
output, silent), because Niri cannot turn off its "Screenshot captured"
notification.

Any other compositor: `command` is a shell command that writes a PNG of the
game to `{out}`, which the capture replaces with the file it wants.

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
