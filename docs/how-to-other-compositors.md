# How to run the tools on a compositor other than Niri

The tools find and capture the game window through Niri (`niri msg`). On another Wayland compositor, or on X11, you
supply a command that writes a PNG of the game instead.

## Vorax Helper

Pass `--capture-cmd`. The command runs through `sh -c`, and `{out}` is replaced by the file to write:

```
cd apps/vorax
bun scripts/tui.ts --capture-cmd='grim -g "$(slurp)" {out}'
```

The command runs before every picture, so use one that needs no interaction. Capture a fixed region or window, for
example `grim -g "100,100 1920x1080" {out}` (Sway, Hyprland and other wlroots compositors) or
`import -window "Torchlight" {out}` (X11, ImageMagick).

With `--capture-cmd` the tool does not look for the window at all, so `--game-title` has no effect.

Check the command first: run it by hand and open the PNG. The picture must show only the game, at 16:9 or wider.

## Warden

Warden's terminal version has no `--capture-cmd` option yet. It captures through Niri only, and `--title TEXT`
only changes which Niri window it looks for. On another compositor you can still read single screenshots:

```
bun run warden -- --image /full/path/to/screenshot.png
```

Adding `--capture-cmd` to Warden means passing `command` to `createCapture` in
`apps/warden/ts/src/bin/warden-tui.ts`; the shared [`@tli/capture`](../packages/capture) package already supports it.

## See also

- [`packages/capture`](../packages/capture/README.md): how the capture works.
- [`apps/vorax/README.md`](../apps/vorax/README.md): the other Vorax options.
