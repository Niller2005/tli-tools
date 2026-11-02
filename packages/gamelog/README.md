# @tli/gamelog

The game's log file: where it is, what it says about the minigames, and how to
follow it.

The game writes `UE_game.log` while it runs. Its own lines (the ones with
`TLLua:` or `TLGame:`) are only there when the game's **Enable Log** setting is
on (Esc → Account Related → Enable Log); with it off the log has almost nothing
in it. Those lines name the pages the game opens and closes, so the log says
which minigame is on screen:

```text
PageName = S16BoardMain , PageRunState = Run       the Tartarus board opens
PageName = S16BoardMain , PageRunState = Destory    ... and closes
PageName = S13GamePlayMain , PageRunState = Run     the Vorax game opens
PageName = S13GamePlayMain , PageRunState = Hide    ... and closes
```

The game spells "destroyed" "Destory", and the page name is followed by a space
and a comma. `GAMEPLAY_ENTER GameplayType=9102` is music, not the Vorax game.

## What it gives

```ts
/** The log: the player's choice, else the newest in each Steam library that holds the game; null if the game isn't installed. */
export function findLog(given?: string): { file: string; exists: boolean } | null

/** What a log line says about a minigame: which one, and whether it opened; null when the line is about neither. */
export function classifyLine(line: string): { game: GameName; open: boolean } | null

/** The minigames' states as the log tells them: `feed(lines)` gives the states the lines leave. */
export class MinigameTracker { … }

/** The minigames' states as the log's tail says them. */
export function scanBack(file: string, maxBytes?: number): ScanResult

/** Follows the log: each poll gives the lines written since the last one. */
export function follow(file: string, opts?: { maxRead?: number; start?: number }): Follower

/** Watches the game's log for the minigames. */
export function watchMinigames(opts?: { log?: string; intervalMs?: number }): Watcher

/** What to tell the player about the log itself; null when there is nothing to say. */
export function logHint(log: LogState): string | null

/** The log's health: where it is, how big and how fresh, and whether the game's own lines are in it. */
export function logHealth(given?: string): LogHealth

/** The status of a tool, as the dashboard draws it (contract C1 of the dashboard plan). */
export interface ToolStatus { id: string; line: string; tone: 'ok' | 'dim' | 'warn'; at: number }

/** What the log says about a minigame, as one line for the dashboard. */
export function minigameStatus(game: GameName, state: GameStatus): ToolStatus
 ```

`scanBack` reads the log's last 8 MB (the log can be over a gigabyte), so a
tool that starts in the middle of a minigame is right at once. `watchMinigames`
does that and then follows the log, polling it once a second.

## The states

| State | What it means |
|-------|---------------|
| `open` | the log says the minigame is on screen |
| `closed` | the log says it is not |
| `unknown` | the log says nothing about it |

The log itself is `ok` (it has the game's own lines), `missing` (there is no
log) or `no-detail` (the log is there, but the game writes none of its own
lines: Enable Log is off). A tool must never wait for a minigame it cannot see:
with `unknown`, `missing` or `no-detail` it carries on as before.

`logHealth` (in [`src/health.ts`](src/health.ts)) is the cheap version for a
status pane: `findLog` says which file, one `stat` says its size and mtime, and
the last 64 KiB of the file are read to tell `ok` from `no-detail` — the same
line test (`TLLua:` / `TLGame:`) the follower uses. It takes at most one small
read, so a dashboard can call it on its tick. `path` is null when the game is
not installed; a missing file keeps its path with `detail: 'missing'`.

`minigameStatus` (in [`src/status.ts`](src/status.ts)) is the status line of a
tool that reads a minigame — for the dashboard plan's contract C1. The Vorax and
Warden tools have no state of their own beyond the minigame they read, so their
line is just `open` or `closed`, read off the `MinigameTracker` the watcher
already keeps; a minigame the log says nothing about gives an empty line. The
`ToolStatus` interface itself is the one every status source returns, so the
other packages import it from here.

## The capture seam

A live tool takes its pictures through the gate: `minigameCaptureGate` says
whether the log allows a capture, and `captureMinigame` takes one picture
through it (a manual read is the one exception, and says that it forced one).
Around that, `retryCapture` wraps the capture with the back-off window both
live tools keep: a failed grab is remembered for 2 s, during which the next
automatic grab is refused with the same message instead of hammering the game
window, while a manual read forces its way through. Its `heldUp(gate)` is the
header note while nothing may be captured: the closed gate's status, or the
last failure while its window is open — never both. The clock is injectable
(`now`), which is how the tests cover the window without waiting.

## Tests

```
bun test
```

The tests write small logs in a temp folder and read them back. The test of the
game's own log is skipped when the game is not installed.
