# Dashboard

A terminal home for the tools in this repo: a list of the tools with what each is doing, the keys
to start them, and the panels that say how the game's log, the capture and the data behind the
tools are doing.

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
| `A` | Select all |
| `enter` | Run the selected tools (the one under the cursor if none is selected) |
| `w` | Open the tool under the cursor in a window of its own |
| `o` | The options of the tool under the cursor |
| `a` | Turn auto-launch of the tool under the cursor on or off |
| `x` | Ask the running tool under the cursor to stop |
| `f` | Bring the tool's window to the front (tmux panes only) |
| `b` | Fetch the community prices again |
| `tab` | The next detail pane, on a narrow screen |
| `?` | Help |
| `q` | Quit |

A tool that is on auto shows a purple `⟳ auto` chip after its badge.

## The look

The dashboard uses the shared palette of [`@tli/tui`](../../packages/tui/README.md), so every kind
of thing has its own colour: the name in the bar along the top is brand orange on a surface bar,
tool names are blue, the focused list panel has the heavy accent border, FE amounts are gold, run
counts orange, times and durations teal, run names blue and a run still going orange. The bar
along the top also carries the state of things as chips — `log ok` (green) or `log missing`
(yellow), the capture way, how many tools are running (orange) and how many are on auto (purple).
The keys at the bottom sit on keycaps on a surface bar. A message under the list is accent, or red
when something went wrong (a tool whose programs are missing, settings that could not be kept,
prices that could not be fetched). With `--no-color` or `NO_COLOR` the chips become `[word]`, the
keycaps plain text and the borders the terminal's own: the shape carries the meaning, never the
colour alone.

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
the log the dashboard watches (`--log=`), the colours the dashboard has (`--no-color`) and the
options the player has set for it (below).

In tmux the tool opens as a pane of the session the dashboard is in, so the dashboard keeps the
focus. `TLI_TMUX_MODE` says how: `split-h` (the default) puts the pane beside the dashboard,
`split-v` below it and `window` gives it a window of its own.

The window is opened in a session of its own, so it keeps running when the dashboard is left.
Opening the same tool twice does nothing: the second key says that it is already open. Where the
window ends up on the screen is the compositor's business.

## The status badges and lines

A tool that reads a minigame shows what the game's log says about it, as a tinted chip:

| Badge | Meaning |
|-------|---------|
| `● open` (green) | the minigame is on screen |
| `○ closed` (dim) | it is not |
| `? unknown` (dim) | the log says nothing about it |

Beside the badge, each tool has a line about what it is doing: the tracker says what today's
farming did, Arcana says whether the Tarot Path is open and what its visits gave, and the Vorax and
Warden lines are the minigame's own state (which the badge says already, so their line is left out
when it would only repeat it). The lines come from the packages as plain objects, read once a
second on the dashboard's tick — never per frame, so a slow read delays the next tick and not the
drawing.

The log itself can also be missing (`log: missing`) or have none of the game's own lines (`log: enable
log`: turn on Esc → Account Related → Enable Log in the game) — the log panel (below) says the
same about the log once, for every tool. The badges and lines are refreshed about once a second
while the dashboard is up; a running tool has the terminal, so the log is not watched then.

`--log=<file>` chooses the log to watch. Colours follow `NO_COLOR` and `--no-color`.

## The panels

On the right of the list (or under it, one at a time, on a narrow screen):

- **Session** — what the tracker's saved state says about today: the runs, the FE per hour, the
  best run, the last one and the FE total.
- **Log and capture** — the log's health (where it is, how big, how fresh, whether the game writes
  its own lines) and what a capture would do right now, without taking any picture: the way it
  would go (`grim`, `niri`, a given command, or nothing) and whether `TLI_NO_CAPTURE` has turned
  every picture off. A capture command set for a tool (below) is that tool's business; the panel
  shows the machine's own way.
- **Running tools and data** — the tools the dashboard has opened in windows or panes (`via`, how
  long, running or the exit code), and how old the community prices and the item-name table are.

Everything in the panels is read on the same 1 s tick as the badges, from the packages that know
it; the dashboard only draws it.

## The options of a tool

`o` opens the options of the tool under the cursor: only the ones the tool's own command takes, so
the Vorax Helper and the Warden have the colours, the log reading, Niri's window screenshot and a
capture command, while the tracker and Arcana have the colours alone. `space` toggles an option,
`enter` on the capture command types it in, and every change is kept at once in the settings file
`$XDG_CONFIG_HOME/tli-dashboard/settings.json` — see
[the launch package](../../packages/launch/README.md) for how the settings become the tool's flags
when it is opened.

## Auto-launch

`a` turns auto-launch of the tool under the cursor on or off (the tracker has no minigame of its
own, so it says no). With it on, the tool opens in a window of its own when its minigame turns
`open` and it is not already running — once per closed-to-open transition, not once per second, and
nothing is ever closed by it. A board that is already open when the dashboard comes up does not
open anything: the dashboard has to see the board close and open again first.

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
that the tools are listed, that the status badges and panels are shown and refreshed, that the panes of a small
terminal tab-switch, that the options dialog keeps a setting, that auto-launch opens a tool when its minigame
opens, that the tracker can take the terminal and give it back, and that the terminal is put back when the
dashboard is left. `--log=<file>` says which log to watch.
