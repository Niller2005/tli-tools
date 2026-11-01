# Dashboard plan

The dashboard (`apps/dashboard`) is a list of tools with open/closed/unknown badges. This plan made
it a status screen and a launcher with options. Waves 1 and 2 are built: the packages say what
they know as plain objects, the dashboard draws them, launches with per-tool options, auto-launches
on a board opening, and manages what it has running. Item 8 (embedded tool panes) was answered by
the spike below: build later, not as part of this plan.

## Rules for every item

- The data comes from code in `packages/*`; the dashboard only draws it. Packages never import from apps.
- Reads the log and the screen only (see AGENTS.md); nothing touches the game.
- Tests: pure functions get unit tests; the dashboard gets OpenTUI test-renderer tests and an extension of
  `apps/dashboard/tests/tui-smoke.py`. `TLI_NO_CAPTURE=1` in all tests.
- Docs: `apps/dashboard/README.md` and the relevant package README change with the code.
- Commits: Conventional Commits, one logical change each, scope `dashboard`, `launch`, `tracker`, `gamelog`, ...
- New package or test script: add to the root `test` / `typecheck` chains.

## Items

| # | Item | Lives in | Depends on |
|---|---|---|---|
| 1 | Live status line per tool | `summarize` in `packages/tracker`, `packages/arcana`, `packages/gamelog` (open/closed for Vorax and Warden); drawn by the dashboard | contract C1 |
| 2 | Log health | `logHealth()` in `packages/gamelog` | contract C2 |
| 3 | Capture status | `captureStatus()` in `packages/capture` | contract C2 |
| 4 | Session summary panel | `sessionSummary()` in `packages/tracker` (runs today, FE/hour, best run, last run) | C1 |
| 5 | Auto-launch on board open | dashboard + `packages/launch`; opt-in, off by default | 6 (stored setting), 1 |
| 6 | Per-tool options | settings file `$XDG_CONFIG_HOME/tli-dashboard/settings.json`; `packages/launch` `openTool` takes the options | none |
| 7 | Running-tool management | `Launcher` in `packages/launch`: list, focus, close, exit codes | none |
| 8 | Embedded tool panes | feasibility spike only, see below | none |
| 9 | Data freshness and refresh | `baselineAge()` and refresh in `packages/tracker`; item-name table age; dashboard key | C2 |

### Contracts

**C1, status.** Each source returns a plain object, never draws:

```ts
interface ToolStatus { id: string; line: string; tone: 'ok' | 'dim' | 'warn'; at: number }
```

Sources are cheap: they read a small tail of the log or a saved state file and return within 50 ms, and they are
refreshed by the dashboard on its 1 s tick, never per frame. A tool with nothing to say returns `line: ''`.

**C2, health.** `logHealth(): { path: string | null; size: number; modifiedAt: number | null; detail: 'ok'|'no-detail'|'missing' }`,
`captureStatus(): { tools: {name: string; found: boolean}[]; noCapture: boolean; path: 'grim'|'niri'|'command'|'none' }`.
The 'path' is what the capture would do right now without capturing (no screenshot, no notification).

### Item 8 is a spike, not a feature

Running another program inside an OpenTUI pane needs a pty and a terminal emulator that OpenTUI does not provide.
The spike answers whether a pane is feasible (OpenTUI API, a pty library for Bun, cost of an ANSI screen emulator,
keyboard and mouse routing) and ends with a written recommendation in `docs/plan-dashboard.md` under "Spike result".
It builds nothing in the repo beyond that note and a /tmp prototype. The decision to build is the user's.

## Work breakdown

| Wave | Task | Files | Items |
|---|---|---|---|
| 1 (parallel, disjoint) | Status sources | `packages/tracker`, `packages/arcana`, `packages/gamelog` summaries | 1, 4, 9 (tracker side) |
| 1 | Health and capture | `packages/gamelog` (health only), `packages/capture` | 2, 3 |
| 1 | Launcher | `packages/launch`, `packages/launch` settings | 6 (options + settings), 7 |
| 1 | Embedded spike | `/tmp`, this doc | 8 |
| 2 (one owner) | Dashboard integration | `apps/dashboard` only | 1-7, 9 drawn; 5 auto-launch |

Wave 2 starts when wave 1 has merged, because it needs the final signatures. The `packages/gamelog` edits of the first
two wave-1 tasks touch different files (`status.ts` vs `health.ts`); the only shared file is `index.ts` exports, which
each task appends to.

## Dashboard layout (wave 2)

- Left: tool list as now, each row with badge and its C1 line.
- Right top: session summary (4). Right middle: log health (2) and capture status (3). Right bottom: running tools
  (7) and data freshness (9).
- Narrow terminals (< 100 columns) stack to the list plus one detail pane switched with `tab`.
- Keys: `enter` run here, `w` window, `o` options for the selected tool (6), `x` close a running tool (7),
  `a` toggle auto-launch for the selected tool (5), `b` refresh baseline prices (9), `?` help.

## Auto-launch (5)

Off by default and per tool, stored in the settings file. A tool opens in a window when its minigame turns `open`
and it is not already running; it is never closed automatically. The watcher is the one the dashboard already runs
for badges. A launch happens once per open transition, not once per second. The first sample after the dashboard
starts is not a transition, however open a board already is: the dashboard has to see the minigame close and open
again before anything is opened by itself.

## Spike result

Date of the runs: 2026-11-01. Bun 1.4.4, `@opentui/core` 0.8.0, Linux, the prototype in `/tmp/embed-spike` (not in the
repo): `host.ts` is an OpenTUI app with a bordered list box and a bordered pane, `drive.py` runs it in a real pty of a
given size and feeds it keys and mouse bytes, and `@xterm/headless` replays what the host wrote so the whole screen can be
read. Every child ran with `TLI_NO_CAPTURE=1` and a synthetic log; nothing touched the game.

**Answer: yes. A pane is feasible, and OpenTUI already ships the hard part.** No pty library and no emulator has to be
added.

### Findings

1. **OpenTUI 0.8.0 has the widget.** `EmbeddedTerminalRenderable` (exported from `@opentui/core`, source in
   `index.bun.js` around line 8088, types in `renderables/EmbeddedTerminal.d.ts`) is a native (Zig, libghostty-based:
   it answers `XTVERSION` with `libghostty`) terminal emulator drawn into the cell buffer. API: `cols`, `rows`,
   `maxScrollback`, `write(bytes)` to feed it the child's output, `onData(bytes, 'input' | 'response')` for what must go to
   the child, `onTerminalResize(cols, rows)`, `screen()` for the text and cursor, `encodeKey`, `encodePaste`, mouse
   forwarding, selection and `getSelectedText()`. It does not spawn anything: the pty is ours to own.
2. **Bun has the pty.** `Bun.spawn(argv, { terminal: { cols, rows, data(terminal, bytes) } })` works at 1.4.4 and is in
   `@types/bun` 1.4.4. The child sees a tty (`tty` printed `/dev/pts/9`, `stty size` printed the requested `10 50`).
   `proc.terminal.write(bytes)` sends input, `proc.terminal.resize(cols, rows)` resizes and signals the child. It is
   POSIX only, which is fine for this Linux-only project. No `node-pty`, no native add-on.
3. **The wiring is about 15 lines**: `data` -> `term.write`; `onData` -> `proc.terminal.write`; `onTerminalResize` ->
   `proc.terminal.resize`; `term.focus()`; `proc.exited` -> show the exit code.
4. **A separate emulator is not needed.** For comparison, `@xterm/headless` 6.0.0 installs with `bun add` (one package,
   pure JS) and replays captures correctly under Bun; it is the fallback if the native widget ever disappears, and it is
   what the prototype used to read the host's own output. It would need our own cell-to-OpenTUI painter, which the native
   widget makes unnecessary.
5. **The child can itself be an OpenTUI app.** The tracker TUI and the Arcana TUI ran in the pane and drew their full
   screens. The child's startup probes (`OSC 10/11`, `XTVERSION`, cursor position, `DECRQM` for 1016/2027/2031/1004/2004/2026,
   kitty `CSI ? u`) are answered by the emulator (`onData` source `'response'`), which the host forwards to the pty. The
   child's mode switches stay inside the pane: `?1049h` (alternate screen), `?1000h ?1002h ?1003h ?1006h` (mouse),
   `?2004h` (bracketed paste), `?1004h` (focus), `>4;1m` and `>5u` (modifyOtherKeys, kitty keyboard). The host's own
   alternate screen and its own mouse mode were not disturbed.

### Evidence

| Check | Result |
|---|---|
| `bash` in the pane, typed `abc` + Enter | prompt, `command not found`, cursor at the right cell; `screen()` matched the text |
| Tracker TUI in a 98x37 pane of a 120x40 host | full screen drawn inside the box, borders of the host intact (host list to the left unchanged) |
| Keys: Tab, Down, Enter | forwarded as `\t`, `ESC[B`, `\r`; the tracker opened its run detail |
| Esc | encoded as `ESC[27u` (kitty protocol) because the child had pushed `>5u`; on the tracker's main screen Esc does nothing, so only the encoding was checked |
| Ctrl+C | `ESC[99;5u`; the tracker quit, `proc.exited` gave 0; the pane went blank, because the child left its alternate screen inside the emulator (the host decides whether to show a "child exited" frame) |
| `q` | `q` forwarded, child exited 0, same blank pane |
| Host resize 120x40 -> 90x30 | host `resize` -> pane 68x27 -> `onTerminalResize` -> `proc.terminal.resize` -> the tracker relaid itself out to its narrow layout |
| Mouse press/release/wheel at screen (72,7) | delivered as `ESC[<0;51;6M`, `ESC[<0;51;6m`, `ESC[<64;51;9M`: pane-local 1-based coordinates, correct; a click at (5,5) on the host's list was not forwarded |
| Truecolor, bold, underline, 256-colour background, wide CJK, emoji | `38;2;255;100;0` kept, bold and underline kept, palette 21 came out as RGB `0000ff`, `日本語` and `🙂` drawn |
| Host quits with Ctrl+Q while a child runs | the host's global `keypress` handler with `preventDefault()` ran first and the child never received the key; host restored the terminal (`?1049l ?1000l ?1003l ?2004l ?25h`); no child left behind |
| Host killed with SIGKILL | the child was gone 2 s later (the pty closed) |
| Idle cost (tracker child, 10 s) | 0.06 s of CPU for the host and the child together |
| OpenTUI test renderer (`createTestRenderer`) | the widget works there: `term.write(...)` then `renderOnce()`, `term.screen().lines`, `captureCharFrame()`, `mockInput.pressKey` arrives in `onData` as `input`. Pane code can be unit tested without a pty |

### What broke or needs care

- **Focus model is ours to design.** A focused pane takes every key (Tab, Esc, q, Ctrl+C all go to the child). The host
  needs a reserved key to get back (a global `keypress` handler that calls `preventDefault()` works; Ctrl+Q was used) or
  mouse click on a host area. The dashboard's own keys (`q`, `tab`, `?`) must not be live while the pane has focus.
- **Layout trap.** Children of a bordered box are already inset by the border; giving the widget `left: 1, top: 1` as
  well put it two cells in and over the right border. Use `0, 0` (or flex) inside the box.
- **The emulator answers for the terminal.** The child is told the background is black and the foreground white
  (`OSC 10/11`) whatever the real terminal's theme is, and the terminal identifies as libghostty. Probes for desktop
  notifications (`OSC 99`), `OSC 1337` capabilities and `OSC 7501` got no answer; the child fell back (the tracker was
  fine). Clipboard (OSC 52), notifications and images from the child do not reach the real terminal: they stop in the
  emulator. Not exercised: OSC 52, kitty images, paste, selection and scrollback by hand (the code is there).
- **Lifecycle code is ours.** The prototype's first version crashed on Ctrl+Q because `proc.exited` wrote to a destroyed
  text node after the renderer was gone; the pane needs a guard, `proc.kill()` on close (SIGTERM, the tracker handles
  it), and a state for "child exited" that keeps or drops the last frame.
- **Children must be run with a known size.** The pane's size is the child's size; narrow panes switch the tracker to
  its narrow layout (seen at 68 columns), which is correct but means the pane should be given the right half of the
  screen, not a corner.
- **Not tried:** Vorax and Warden in a pane (Arcana and the tracker were), Windows (Bun's `terminal` is POSIX only), a
  child that streams heavy output, a pane inside the dashboard itself (the prototype is a separate host app).

### Recommendation: build later

Build it after wave 2 lands, not as part of it. It is feasible and low risk, but nothing in items 1-7 and 9 needs it:
"run here" already hands the terminal over and "window" already gives the tool its own terminal. The gain is seeing the
dashboard's status next to a running tool in one terminal, which is a convenience, not a missing capability. When the
user wants it: `apps/dashboard` gets a `pane` view (`Bun.spawn` with `terminal`, `EmbeddedTerminalRenderable`, a reserved
leader key, exit and close handling), `Launcher` gets a third mode next to here and window, and `packages/launch` only
needs the argv it already builds. Pass `TLI_NO_CAPTURE` through unchanged.

**Effort:** about one day for a working single pane (spawn, focus and leader key, resize, exit and close, a dashboard
layout slot, README), plus half a day for tests (test-renderer tests of the pane, and a case in `tui-smoke.py` that opens a
child in the pane, sends a key, and leaves). Another half day if the pane should coexist with the narrow-terminal
stacking and with the running-tools list of item 7. No new dependency.
