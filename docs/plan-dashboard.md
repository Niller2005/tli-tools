# Dashboard plan

The dashboard (`apps/dashboard`) is a list of tools with open/closed/unknown badges. This plan makes it a status
screen and a launcher with options. Nothing here is built yet; each item says where it lives and how it is checked.

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
for badges. A launch happens once per open transition, not once per second.

## Spike result

(to be filled in by the spike)
