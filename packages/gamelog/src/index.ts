//! The game's log file: where it is, what it says about the minigames, and
//! how to follow it.
//!
//! The game writes `UE_game.log` while it runs. Its own lines (the ones with
//! `TLLua:` or `TLGame:`) are only there when the game's "Enable Log" setting
//! is on (Esc → Account Related → Enable Log); with it off the log has almost
//! nothing in it. Those lines name the pages the game opens and closes, so
//! the log says which minigame is on screen:
//!
//! ```text
//! PageName = S16BoardMain , PageRunState = Run       the Tartarus board opens
//! PageName = S16BoardMain , PageRunState = Destory    ... and closes
//! PageName = S13GamePlayMain , PageRunState = Run     the Vorax game opens
//! PageName = S13GamePlayMain , PageRunState = Hide    ... and closes
//! PageName = S9Taro , PageRunState = Run              the Tarot Path opens
//! PageName = S9Taro , PageRunState = Hide             ... and closes
//! ```
//!
//! The game spells "destroyed" "Destory", and the page name is followed by a
//! space and a comma.

import { closeSync, openSync, readFileSync, readSync, statSync, type Stats } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { STEAM_APP } from '@tli/capture'

/* ---------- where the log is ---------- */

const LOG_IN_GAME = ['UE_game', 'TorchLight', 'Saved', 'Logs', 'UE_game.log']

const mtime = (p: string): number | null => {
  try {
    const s = statSync(p)
    return s.isFile() ? s.mtimeMs : null
  } catch {
    return null
  }
}

/** The file's size, or null when it is not there. */
const size = (p: string): number | null => {
  try {
    const s = statSync(p)
    return s.isFile() ? s.size : null
  } catch {
    return null
  }
}

/** The log: the player's choice, else the newest in each Steam library that holds the game; null if the game isn't installed. */
export function findLog(given?: string): { file: string; exists: boolean } | null {
  if (given) return { file: resolve(given), exists: mtime(given) !== null }
  const home = homedir()
  const roots = new Set<string>()
  for (const r of [
    join(home, '.steam/steam'),
    join(home, '.local/share/Steam'),
    join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam'),
  ]) {
    roots.add(r)
  }
  const libraries = new Set(roots)
  for (const root of roots) {
    try {
      for (const m of readFileSync(join(root, 'steamapps/libraryfolders.vdf'), 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) {
        libraries.add(m[1].replace(/\\\\/g, '\\'))
      }
    } catch {
      /* not a Steam folder */
    }
  }
  const found: { file: string; at: number | null }[] = []
  for (const lib of libraries) {
    try {
      const m = /"installdir"\s+"([^"]+)"/.exec(readFileSync(join(lib, 'steamapps', `appmanifest_${STEAM_APP}.acf`), 'utf8'))
      if (!m) continue
      const file = join(lib, 'steamapps/common', m[1], ...LOG_IN_GAME)
      found.push({ file, at: mtime(file) })
    } catch {
      /* not in this library */
    }
  }
  if (!found.length) return null
  found.sort((a, b) => (b.at ?? -1) - (a.at ?? -1))
  return { file: found[0].file, exists: found[0].at !== null }
}

/* ---------- what a line says ---------- */

/** The minigames the log can talk about. */
export type GameName = 'warden' | 'vorax' | 'arcana'

/** Whether a minigame is on screen: open, closed, or unknown when the log says nothing about it. */
export type MinigameState = 'open' | 'closed' | 'unknown'

/** What the log itself can tell us: it is there and has the game's own lines, it is missing, or it has no detail (Enable Log off). */
export type LogState = 'ok' | 'missing' | 'no-detail'

/** What the log says about one minigame. */
export interface GameStatus {
  /** open, closed, or unknown when the log says nothing about it */
  state: MinigameState
  /** when the state last changed, in ms since the epoch (the log line's own time); null when there is none */
  at: number | null
}

/** The pages the minigames open, with the states that open and close them. */
const PAGES: Record<string, { game: GameName; open: string[]; closed: string[] }> = {
  S16BoardMain: { game: 'warden', open: ['Run'], closed: ['Destory'] },
  S13GamePlayMain: { game: 'vorax', open: ['Run'], closed: ['Hide', 'Destory'] },
  S9Taro: { game: 'arcana', open: ['Run'], closed: ['Hide', 'Destory'] },
}

/** The line that names the page and the state it went to. */
const PAGE_STATE = /PageName\s*=\s*(\w+)\s*,\s*PageRunState\s*=\s*(\w+)/

/** What a log line says about a minigame: which one, and whether it opened; null when the line is about neither. */
export function classifyLine(line: string): { game: GameName; open: boolean } | null {
  const m = PAGE_STATE.exec(line)
  if (m === null) return null
  const page = PAGES[m[1]]
  if (page === undefined) return null
  const state = m[2]
  if (page.open.includes(state)) return { game: page.game, open: true }
  if (page.closed.includes(state)) return { game: page.game, open: false }
  return null
}

/** The time at the start of a log line, "[2026.10.17-14.24.11:563]", in ms; null if it has none. */
export function logTime(line: string): number | null {
  const m = /^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]/.exec(line)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null
}

/** What the log says about a minigame it says nothing about. */
const UNKNOWN: GameStatus = { state: 'unknown', at: null }

/** The game's own lines; with Enable Log off it writes almost none. */
const DETAIL = /\b(TLLua|TLGame):/

/* ---------- the states the log gives ---------- */

/** The minigames' states as the log tells them. */
export class MinigameTracker {
  private readonly states: Record<GameName, GameStatus> = {
    warden: UNKNOWN,
    vorax: UNKNOWN,
    arcana: UNKNOWN,
  }
  private sawDetail = false

  /** Takes the states a scan of the log's tail gave, before its new lines are fed. */
  seed(scan: ScanResult): void {
    this.states.warden = scan.warden
    this.states.vorax = scan.vorax
    this.states.arcana = scan.arcana
    this.sawDetail = scan.detail
  }

  /** Takes the log's lines, oldest first, and gives the states they leave. */
  feed(lines: readonly string[]): Record<GameName, GameStatus> {
    for (const line of lines) {
      if (DETAIL.test(line)) this.sawDetail = true
      if (!line.includes('PageRunState')) continue
      const c = classifyLine(line)
      if (c === null) continue
      this.states[c.game] = { state: c.open ? 'open' : 'closed', at: logTime(line) }
    }
    return { warden: this.states.warden, vorax: this.states.vorax, arcana: this.states.arcana }
  }

  /** What the log says about the Tartarus board. */
  get warden(): GameStatus {
    return this.states.warden
  }

  /** What the log says about the Vorax game. */
  get vorax(): GameStatus {
    return this.states.vorax
  }

  /** What the log says about the Tarot Path. */
  get arcana(): GameStatus {
    return this.states.arcana
  }

  /** Whether the log had any of the game's own lines. */
  get detail(): boolean {
    return this.sawDetail
  }
}

/* ---------- reading the log's tail ---------- */

/** What a scan of the log's tail found. */
export interface ScanResult {
  /** what the log says about the Tartarus board */
  warden: GameStatus
  /** what the log says about the Vorax game */
  vorax: GameStatus
  /** what the log says about the Tarot Path */
  arcana: GameStatus
  /** the log had some of the game's own lines */
  detail: boolean
  /** the log's size when it was read; a follower goes on from there */
  size: number
}

/** How much of the log's tail a scan reads when it is not told otherwise. */
export const SCAN_BYTES = 8 * 1024 * 1024

/** How much is read at a time. */
const CHUNK = 1 << 18

/** Whether the byte before the offset ends a line. */
function atLineStart(fd: number, at: number): boolean {
  const buf = Buffer.alloc(1)
  const got = readSync(fd, buf, 0, 1, at - 1)
  return got === 1 && buf[0] === 0x0a
}

/** The log's last `maxBytes`, and where they start in the file. */
function tail(file: string, maxBytes: number): { lines: string[]; size: number } | null {
  let size: number
  try {
    const s = statSync(file)
    if (!s.isFile()) return null
    size = s.size
  } catch {
    return null
  }
  const start = Math.max(0, size - maxBytes)
  const fd = openSync(file, 'r')
  try {
    const chunks: Buffer[] = []
    let end = size
    while (end > start) {
      const from = Math.max(start, end - CHUNK)
      const buf = Buffer.alloc(end - from)
      const got = readSync(fd, buf, 0, buf.length, from)
      chunks.push(buf.subarray(0, got))
      end = from
    }
    chunks.reverse()
    const lines = Buffer.concat(chunks).toString('utf8').split('\n')
    // the first line is only half there when the tail was cut in the middle of one
    if (start > 0 && !atLineStart(fd, start)) lines.shift()
    return { lines, size }
  } finally {
    closeSync(fd)
  }
}

/**
 * The minigames' states as the log's tail says them: a tool that starts in the
 * middle of a minigame is right at once. The log can be over a gigabyte, so
 * only its last `maxBytes` are read.
 */
export function scanBack(file: string, maxBytes = SCAN_BYTES): ScanResult {
  const read = tail(file, maxBytes)
  if (read === null) return { warden: UNKNOWN, vorax: UNKNOWN, arcana: UNKNOWN, detail: false, size: 0 }
  const tracker = new MinigameTracker()
  tracker.feed(read.lines)
  return { warden: tracker.warden, vorax: tracker.vorax, arcana: tracker.arcana, detail: tracker.detail, size: read.size }
}

/* ---------- following the log ---------- */

/** The log's new lines, as they are written. */
export interface Follower {
  /** the lines written since the last poll */
  poll(): string[]
  /** whether the log had any of the game's own lines */
  readonly detail: boolean
}

/**
 * Follows the log: each poll gives the lines written since the last one. The
 * first poll starts at the end of the file, or at `start` when it is given.
 * A log that is truncated or rotated is read from its beginning again.
 */
export function follow(file: string, opts: { maxRead?: number; start?: number } = {}): Follower {
  const maxRead = opts.maxRead ?? 1_048_576
  let offset = opts.start ?? -1
  let ino: number | null = null
  let decoder = new TextDecoder('utf-8')
  let rest = ''
  let detail = false

  const restart = (at: number): void => {
    offset = at
    decoder = new TextDecoder('utf-8')
    rest = ''
  }

  return {
    poll(): string[] {
      let st: Stats
      try {
        st = statSync(file)
      } catch {
        return []
      }
      if (!st.isFile()) return []
      if (ino !== null && st.ino !== ino) restart(0) // the log was rotated
      ino = st.ino
      if (offset < 0) {
        restart(st.size)
        return []
      }
      if (st.size < offset) restart(0) // the log was truncated
      if (st.size === offset) return []
      let skipped = false
      if (st.size - offset > maxRead) {
        restart(st.size - maxRead)
        skipped = true
      }
      const buf = Buffer.alloc(st.size - offset)
      const fd = openSync(file, 'r')
      let got = 0
      try {
        got = readSync(fd, buf, 0, buf.length, offset)
      } finally {
        closeSync(fd)
      }
      offset += got
      const parts = (rest + decoder.decode(buf.subarray(0, got), { stream: true })).split('\n')
      rest = parts.pop() ?? ''
      // after skipping ahead we land mid-line: that piece is dropped
      if (skipped) parts.shift()
      const lines = parts.map(l => (l.endsWith('\r') ? l.slice(0, -1) : l))
      if (!detail && lines.some(l => DETAIL.test(l))) detail = true
      return lines
    },
    get detail(): boolean {
      return detail
    },
  }
}

/** The same follower, under the name the other packages give theirs. */
export const createFollower = follow

/* ---------- watching the minigames ---------- */

/** The minigames' states, as the log tells them now. */
export interface MinigameView {
  /** the Tartarus board: open, closed, or unknown */
  warden: MinigameState
  /** the Vorax game: open, closed, or unknown */
  vorax: MinigameState
  /** the Tarot Path: open, closed, or unknown */
  arcana: MinigameState
  /** what the log itself can tell us */
  log: LogState
}

/** The header note when the log says the board is closed. */
export const BOARD_CLOSED_STATUS = 'board closed – waiting for the board'

/** The header note when the log cannot say whether the board is open. */
export const LOG_UNAVAILABLE_STATUS = 'log unavailable – watching the screen'

/** Whether a minigame may be captured, and what the header says about it. */
export interface CaptureGate {
  /** whether an automatic capture may happen */
  allowed: boolean
  /** what the header says about the gate */
  status: string
}

/**
 * Whether the log allows a minigame to be captured.
 *
 * An open board is always allowed. A closed board, and an unknown board in a readable log with
 * detail lines, are closed. Only a missing log or one without detail lines falls back to
 * watching the screen, because then the log cannot say whether the board is open.
 */
export function minigameCaptureGate(view: MinigameView | null, game: GameName): CaptureGate {
  if (view === null) return { allowed: true, status: LOG_UNAVAILABLE_STATUS }
  if (view[game] === 'open') return { allowed: true, status: '' }
  if (view.log === 'missing' || view.log === 'no-detail') {
    return { allowed: true, status: LOG_UNAVAILABLE_STATUS }
  }
  return { allowed: false, status: BOARD_CLOSED_STATUS }
}

/** A capture that the minigame gate can call. */
export interface MinigameCapture<T> {
  grab(options?: { force?: boolean }): Promise<T>
}

/** The result of a capture that went through the minigame gate. */
export interface CaptureAttempt<T> {
  /** the picture, or null when the gate stopped the capture */
  image: T | null
  /** what the header says about the gate */
  status: string
  /** whether a manual read went ahead while the gate was closed */
  forced: boolean
}

/**
 * Takes a minigame picture only when the log allows it. A manual read is the one exception: it
 * forces one picture and says that it did so.
 */
export async function captureMinigame<T>(
  capture: MinigameCapture<T>,
  view: MinigameView | null,
  game: GameName,
  manual = false,
): Promise<CaptureAttempt<T>> {
  const gate = minigameCaptureGate(view, game)
  const forced = manual && !gate.allowed
  if (!gate.allowed && !manual) return { image: null, status: gate.status, forced }
  const image = await capture.grab({ force: manual })
  return {
    image,
    status: forced ? `${gate.status} (manual read forced)` : gate.status,
    forced,
  }
}

/** How long a failed capture holds the next automatic one back. */
const RETRY_WINDOW_MS = 2000

/**
 * A capture that waits out its own failures. A failed grab opens a 2 s window during which the next
 * automatic grab is refused with the same message instead of hammering the game's window; a manual
 * read forces its way through. The clock is injected so the tests do not wait.
 */
export interface RetryCapture<T> extends MinigameCapture<T> {
  /** an automatic capture is waiting out the last failure's window */
  paused(): boolean
  /** the last failure's message, '' when there is none */
  error(): string
  /**
   * What the header says while no capture may go ahead: the closed gate's status, or the last
   * failure while its window is open — never both. '' when a capture may go ahead. A manual read
   * is never held up.
   */
  heldUp(gate: CaptureGate, manual?: boolean): string
}

/**
 * Wraps a minigame capture with the back-off window both live tools keep: a failure is remembered
 * for `windowMs` (2 s by default, what the tools use today), and `force` — a manual read — bypasses
 * it. `grab` records the window itself, so a tool only has to ask `heldUp` what to show.
 */
export function retryCapture<T>(
  capture: MinigameCapture<T>,
  opts: { windowMs?: number; now?: () => number } = {},
): RetryCapture<T> {
  const windowMs = opts.windowMs ?? RETRY_WINDOW_MS
  const now = opts.now ?? Date.now
  let retryAt = 0
  let lastError = ''
  const paused = () => now() < retryAt
  return {
    async grab(options: { force?: boolean } = {}) {
      if (options.force !== true && paused()) throw new Error(lastError)
      try {
        const image = await capture.grab(options)
        retryAt = 0
        lastError = ''
        return image
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err)
        retryAt = now() + windowMs
        throw err instanceof Error ? err : new Error(lastError)
      }
    },
    paused,
    error: () => lastError,
    heldUp(gate, manual = false) {
      if (manual) return ''
      if (!gate.allowed) return gate.status
      if (paused()) return lastError
      return ''
    },
  }
}

/** Watches the log for the minigames' states. */
export interface Watcher {
  /** the states as they are now */
  state(): MinigameView
  /** stops watching */
  close(): void
}

/**
 * Watches the game's log for the minigames: the Tartarus board, the Vorax game
 * and the Tarot Path. The log's tail is read once at the start, so a tool that
 * starts in the middle of a minigame is right at once, and the log is followed
 * after that.
 */
export function watchMinigames(opts: { log?: string; intervalMs?: number } = {}): Watcher {
  const file = opts.log !== undefined ? resolve(opts.log) : findLog()?.file
  if (file === undefined) {
    return { state: () => ({ warden: 'unknown', vorax: 'unknown', arcana: 'unknown', log: 'missing' }), close: () => {} }
  }
  const scan = scanBack(file)
  const tracker = new MinigameTracker()
  tracker.seed(scan)
  const follower = follow(file, { start: scan.size })
  const timer = setInterval(() => tracker.feed(follower.poll()), opts.intervalMs ?? 1000)
  return {
    state(): MinigameView {
      const bytes = size(file)
      // only a log with the game's own lines can say that a board is closed
      const log: LogState = bytes === null ? 'missing' : tracker.detail ? 'ok' : 'no-detail'
      return {
        warden: tracker.warden.state,
        vorax: tracker.vorax.state,
        arcana: tracker.arcana.state,
        log,
      }
    },
    close(): void {
      clearInterval(timer)
    },
  }
}

/** What to tell the player about the log itself; null when there is nothing to say. */
export function logHint(log: LogState): string | null {
  if (log === 'missing') return 'log: missing'
  if (log === 'no-detail') return 'log: enable log'
  return null
}

/* ---------- the log's health ---------- */

export { logHealth, type LogHealth } from './health'
export { DETAIL }

/* ---------- the status of the tools ---------- */

export { minigameStatus, type ToolStatus } from './status'
