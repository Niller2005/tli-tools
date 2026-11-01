# @tli/launch

The tools of this repo, and the terminal windows they can be started in.

The tools in this repo are full-screen programs: two of them cannot share one terminal. The
dashboard therefore hands the whole terminal over to the tool that is picked, and the tracker opens
a minigame's tool in a window of its own and carries on following the log.

| Part | What it is |
|------|------------|
| `tools.ts` | the table of tools: what they are called, how they are started and what they need |
| `terminal.ts` | the terminal emulators that are known and the argv of each |
| `tmux.ts` | the pane of a tmux session, and how tmux is asked for it |
| `launcher.ts` | the launcher: it opens the window and remembers what it has open |
| `open.ts` | opening one of the tools in a window of its own |
| `settings.ts` | the settings file of the dashboard: read tolerantly, written in one piece |

## The tools

```typescript
import { TOOLS, missing, toolById } from '@tli/launch'

const vorax = toolById('vorax')
const gone = missing(vorax) // the programs it needs that are not installed
```

The table lives here so that every app that starts a tool reads the same one.

## A window of its own

```typescript
import { Launcher, openTool } from '@tli/launch'

const launcher = new Launcher()
const result = openTool(launcher, tool, { parentArgv: process.argv })
```

`openTool` gives the child the flags of the parent that it understands (`--log=` for the tools that
read the log, `--no-color` when the colours are off) and opens a window for it. The result says
what happened: the window is open, the tool is already open, there is no terminal to open it in, or
the terminal would not start.

The launcher remembers the tools it has opened, so a second window for the same tool is not opened
while the first one is still there.

## The per-tool settings

The player's settings live in one file, `$XDG_CONFIG_HOME/tli-dashboard/settings.json` (in
`~/.config` when `XDG_CONFIG_HOME` is not set), and are set per tool:

```json
{
  "version": 1,
  "tools": {
    "vorax": { "noColor": false, "noLog": false, "niriScreenshot": false, "captureCmd": null, "autoLaunch": false }
  }
}
```

```typescript
import { readSettings, setToolSettings, settingsPath, toolSettings, writeSettings } from '@tli/launch'

const path = settingsPath()
const settings = setToolSettings(readSettings(path), 'vorax', { noLog: true })
writeSettings(path, settings)
const options = toolSettings(readSettings(path), 'vorax') // the settings, with the unset ones filled in
```

The file is written in one piece (a neighbour file that is renamed over it), so a reader never
sees half of it. Reading is tolerant: a file that is missing, not JSON, or of another version gives
the default settings, and a tool entry keeps only what it says plainly. `autoLaunch` is stored
here and nothing else: the dashboard acts on it.

`openTool` takes the settings and turns them into the flags of the tool that is opened — only for
the tools whose command takes them, each spelled the way that tool reads it:

| Setting | vorax | warden | tracker, arcana |
|---------|-------|--------|-----------------|
| `noColor` | `--no-color` | `--no-color` | `--no-color` |
| `noLog` | `--no-log` | `--no-log` | not taken |
| `niriScreenshot` | `--niri-screenshot` | `--niri-screenshot` | not taken |
| `captureCmd` | `--capture-cmd=<command>` | `--capture-cmd <command>` | not taken |

```typescript
openTool(launcher, tool, { parentArgv: process.argv, settings: options })
```

## The running tools

The launcher remembers what it has opened, and answers for it:

```typescript
const entries = launcher.list()   // { id, pid, since, via, running, exitCode }
const focused = launcher.focus('vorax')  // tmux: the pane's window is selected and the pane made
                                       // the active one. A terminal emulator window: unsupported.
const closed = launcher.close('vorax')   // SIGTERM to the process the launcher started
```

`list()` gives every entry, running or ended: the tool id, the pid of the process that runs it,
when it was opened, and what it runs in (`tmux`, or the id of the terminal emulator). An entry is
kept after its process has gone, with the exit code when the launcher has seen it (a window of a
terminal emulator: always; a tmux pane: never, for tmux does not tell how a pane's process ended).
It is replaced when the same tool is opened again.

`close` sends SIGTERM to one process only: the one the launcher itself started, or the one tmux
named for the pane the launcher opened. Nothing is looked up by name, and the game is never
touched.

## In tmux

When the player is in tmux, the window is a pane of their own session: the tracker keeps the
focus and the terminal stays where it is.

| `TLI_TMUX_MODE` | What is made |
|-----------------|--------------|
| `split-h` (the default) | a pane beside the tracker |
| `split-v` | a pane below the tracker |
| `window` | a window of its own, named after the tool |

The pane is made with `tmux split-window -h -d`, so it does not take the focus, and it is closed
when the tool in it is done. The command is put in one shell string, quoted the way a shell reads
it, and the environment of the parent (`NO_COLOR` and `PATH`) is given to the pane with `-e`, or in
front of the command when the tmux is too old for `-e`.

The server is the one the player is in: the socket of `TMUX`, before the first comma.
`TLI_TMUX_SOCKET` names another one: a path when it starts with a slash, a socket name otherwise.

`TLI_TERMINAL` is stronger than being in tmux: when it is set, the window is a window of that
terminal emulator and not a pane.

## The terminal

The terminal is looked for in this order:

1. `TLI_TERMINAL`: the player's own choice. It is always used, whether it names one of the
   terminals below or a program of their own.
2. tmux, when the player is in a tmux session (see above).
3. `TERMINAL`: used when it names one of the terminals below, or a program that is installed. It is
   usually the name of the terminal's colours (`xterm-256color`), which is not a program.
4. `ghostty`, `kitty`, `foot`, `alacritty`, `wezterm`, `xdg-terminal-exec`, `xterm`: the first one
   that is installed.

Without a terminal there is nothing to open a window in, and the launcher says so:
*set TLI_TERMINAL to the one to use*.

The argv of each terminal is built by a pure function, so it can be looked at without a terminal
being anywhere near:

| Terminal | The argv |
|----------|----------|
| ghostty | `ghostty --title=<title> --working-directory=<dir> -e <command>` |
| kitty | `kitty --title <title> --directory <dir> -- <command>` |
| foot | `foot --title=<title> --working-directory=<dir> <command>` |
| alacritty | `alacritty --title <title> --working-directory <dir> -e <command>` |
| wezterm | `wezterm start --cwd <dir> -- <command>` |
| xdg-terminal-exec | `xdg-terminal-exec <command>` |
| xterm | `xterm -T <title> -e <command>` |

The window is started in a session of its own, with its standard streams closed, so it keeps
running when the program that opened it is left. Where the window ends up on the screen is the
compositor's business: the launcher only asks for a window.
