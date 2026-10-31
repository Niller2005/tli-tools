# Dashboard

A terminal launcher for the tools in this repo. Pick one or more tools and start them from one place.

```
bun run start          # from the repo root
bun src/main.ts        # from apps/dashboard
bun src/main.ts --log=<UE_game.log>
bun src/main.ts --no-color
```

| Key | Action |
|-----|--------|
| `↑` / `↓` (or `k` / `j`) | Move |
| `space` | Select or unselect the tool under the cursor |
| `a` | Select all |
| `enter` | Run the selected tools (the one under the cursor if none is selected) |
| `w` | Open the tool under the cursor in a window of its own |
| `q` | Quit |

## How tools start

The list is drawn with [OpenTUI](https://opentui.com/docs), using the shared colours and renderer
helpers from `@tli/tui`.

- Before a tool starts, the dashboard's renderer is destroyed. The terminal is restored, raw mode is
  turned off and stdin is released before the child process starts.
- **One tool** takes over the terminal. When it exits, a new renderer is made and the dashboard comes
  back with the same cursor and selections.
- **Several tools** need `tmux`, since two full-screen programs cannot share a terminal. They open as tiled
  panes in a new window if you are already inside tmux, or in a new tmux session otherwise. A pane stays
  open after its tool exits so you can read any error.
- A tool whose required programs (`bun`, `tesseract`, ...) are not installed shows what is missing and does
  not start.

## A tool in a window of its own

`w` opens the tool under the cursor in a window of its own, and the dashboard keeps the terminal.
The window is opened in the terminal the player uses: `ghostty`, `kitty`, `foot`, `alacritty`,
`wezterm` or `xterm`, whichever is installed; `TLI_TERMINAL` says which one to use. The tool gets
the log the dashboard watches (`--log=`) and the colours the dashboard has (`--no-color`).

In tmux the tool opens as a pane of the session the dashboard is in, so the dashboard keeps the
focus. `TLI_TMUX_MODE` says how: `split-h` (the default) puts the pane beside the dashboard,
`split-v` below it and `window` gives it a window of its own.

The window is opened in a session of its own, so it keeps running when the dashboard is left.
Opening the same tool twice does nothing: the second key says that it is already open. Where the
window ends up on the screen is the compositor's business.

## The status badges

A tool that reads a minigame shows what the game's log says about it:

| Badge | Meaning |
|-------|---------|
| `● open` (green) | the minigame is on screen |
| `○ closed` (dim) | it is not |
| `? unknown` (dim) | the log says nothing about it |

The log itself can also be missing (`log: missing`) or have none of the game's own lines (`log: enable
log`: turn on Esc → Account Related → Enable Log in the game). The badges are refreshed about once a
second while the dashboard is up; a running tool has the terminal, so the log is not watched then.

`--log=<file>` chooses the log to watch. Colours follow `NO_COLOR` and `--no-color`.

## Adding a tool

Add an entry to `TOOLS` in [`packages/launch/src/tools.ts`](../../packages/launch/src/tools.ts): an id, a name, a
description, the command and its working directory, and the programs it needs on `PATH`. It then shows up in the
list. A tool that reads a minigame also names it in `game` (`vorax`, `warden` or `arcana`), so it gets a status
badge.

## Tests

```
bun test
bun run smoke
```

The renderer tests use OpenTUI's test renderer. The smoke test runs the dashboard in a pty (python): it checks
that the tools are listed, that the status badges are shown and refreshed, that the tracker can take the
terminal and give it back, and that the terminal is put back when the dashboard is left. `--log=<file>` says
which log to watch.
