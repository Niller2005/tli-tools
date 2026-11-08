//! The app's state without the UI: the frame scheduler, the solve worker,
//! the player's corrections and the run log. What a read means for the run
//! - the days clock, the boards a pick covers, the treasure, the warnings -
//! is the run tracker's (see `./run`).
//!
//! A port of src/app/session.rs. The reader and the solver run in the
//! background: a read is a promise the session picks up in [`poll`], and the
//! solve plays its rounds between two turns of the event loop, so the
//! window keeps painting.

import { buildState, cloneModel } from '@/board/board'
import { apply } from '@/engine/actions'
import { data, toolFromKey, type Gift, type Tool } from '@/engine/data'
import { offerChain, startOptions } from '@/engine/devour'
import { treasurePicks } from '@/engine/rules'
import { cellLabel } from '@/engine/text'
import type { State } from '@/engine/state'
import { target as clickTarget, toFrame } from '@/reader/click'
import { layOutScaled } from '@/reader/layout'
import { warningText, type Warning } from '@/reader/model'
import { language } from '@/reader/ocr'
import { readPanelsTitled, type Panels, type Screen } from '@/reader/panels'
import { readScene, type Scene } from '@/reader/scene'
import { REF_H, REF_W, type Rgba } from '@/reader/mod'
import { advise, alsoGood, preferChange, whyShown, type Advice, type Pick } from '@/solver/advise'
import { consumeTargets, jawed, Run, type CellEdit, type Meal, type Reading, type RunHooks } from './run'
import { instant, instantBite, type SolveOption } from '@/solver/solve'
import { sameAction } from '@/solver/mod'
import { RunLog, timestamp } from './runlog'
import { timed } from './profile'
import { solvePool, type SolveProgress, type SolveRun } from './solve-pool'

/** Rounds played between two partial rankings. */
export const ROUND = 50
/** The seed of the board's hidden parts and of the playouts, as in
 * `warden-cli solve`. */
const SEED = 1

/** What the reader saw in a frame, the frame's size, the frame itself
 * when the run log keeps it, and the interface scale it was read at. */
interface Scanned {
  scene: Scene
  panels: Panels
  size: [number, number]
  frame: Rgba | null
  u: number
}

/** Reads the frame at the reference size the reader's regions are measured
 * on, as `load_png` does, at the interface scale measured near `hint`; see
 * the run tracker's `shapeKept` for the shapes refused. `keep` gives the
 * frame back at its own size. */
async function scan(frame: Rgba, keep: boolean, hint: number | null): Promise<Scanned> {
  const size: [number, number] = [frame.w, frame.h]
  const [f, title, u] = layOutScaled(frame, hint)
  const scene = readScene(f)
  const panels = await readPanelsTitled(f, title ?? f)
  return { scene, panels, size, frame: keep ? frame : null, u }
}

/** The fingerprint grid: 64 x 36 blocks, 30 x 30 pixels each on a 1920 x
 * 1080 frame. */
const PRINT: [number, number] = [64, 36]
/** A block changes when its mean gray moves by more than this. */
const BLOCK_DIFF = 16
/** Two fingerprints differ when at least this many blocks changed. */
const CHANGED_BLOCKS = 4

/** A frame's mean gray per block of a 64 x 36 grid: small enough to compare
 * every second, and a block average sees a change to a digit that a
 * resize, which samples a few pixels per block, can miss. */
export function fingerprint(frame: Rgba): Uint8Array {
  const [gw, gh] = PRINT
  const sum = new Int32Array(gw * gh)
  // The block each column and each row belongs to, and how many pixels of
  // it there are: the same for every row of a block row.
  const cols = new Int32Array(frame.w)
  const colCount = new Int32Array(gw)
  for (let x = 0; x < frame.w; x++) {
    const b = Math.floor((x * gw) / frame.w)
    cols[x] = b
    colCount[b] += 1
  }
  const rows = new Int32Array(frame.h)
  const rowCount = new Int32Array(gh)
  for (let y = 0; y < frame.h; y++) {
    const b = Math.floor((y * gh) / Math.max(frame.h, 1))
    rows[y] = b
    rowCount[b] += 1
  }
  const count = new Int32Array(gw * gh)
  for (let by = 0; by < gh; by++) {
    for (let bx = 0; bx < gw; bx++) count[by * gw + bx] = rowCount[by] * colCount[bx]
  }
  const data = frame.data
  for (let y = 0; y < frame.h; y++) {
    const row = rows[y] as number * gw
    const from = y * frame.w * 4
    for (let x = 0; x < frame.w; x++) {
      const i = from + x * 4
      const gray = ((data[i] as number) * 299 + (data[i + 1] as number) * 587 + (data[i + 2] as number) * 114) / 1000
      sum[row + (cols[x] as number)] += gray | 0
    }
  }
  const out = new Uint8Array(gw * gh)
  for (let k = 0; k < out.length; k++) out[k] = count[k] === 0 ? 0 : Math.floor((sum[k] as number) / count[k])
  return out
}

/** True when two fingerprints show different screens: other sizes, or at
 * least [`CHANGED_BLOCKS`] blocks whose gray moved by more than
 * [`BLOCK_DIFF`]. A hover glow on one cell may count, and so may an
 * animation: a re-read of the same scene keeps the solve. */
export function differs(a: Uint8Array, b: Uint8Array): boolean {
  return a.length !== b.length || changed(a, b) >= CHANGED_BLOCKS
}

/** The blocks whose gray moved by more than [`BLOCK_DIFF`] between two
 * prints of one size. */
function changed(a: Uint8Array, b: Uint8Array): number {
  let n = 0
  const len = Math.min(a.length, b.length)
  for (let k = 0; k < len; k++) if (Math.abs(a[k] - b[k]) > BLOCK_DIFF) n += 1
  return n
}

/** A sample holds when at most this many blocks moved since the one before.
 * Measured at 4 samples a second on a 2026-10-17 recording: the Interrogation
 * Room's animation moves 7 to 13 blocks a sample, a screen change 40 to 280.
 */
export const HELD_BLOCKS = 16

/** Samples in a row that have to hold before auto read reads: 2 at one
 * sample every 250 ms waits about 0.5 s for transitions to settle. */
export const SETTLE = 2

/** Samples in a row a screen may differ from the last one read without
 * settling before it is read anyway, about 1.5 s: on the last day the
 * frame's edges pulse by up to 90 blocks a sample and never hold. */
export const MAX_WAIT = 6

/** Samples since the last read after which a screen that moved fewer than
 * [`CHANGED_BLOCKS`] blocks from it, but at least one, is read again: 5 s at
 * 4 samples a second. A Prison Incident "!" that appears on a cell moves only
 * 2 blocks (measured on a player's screenshot), and a hover glow that comes
 * and goes costs at most one read per 5 s. */
export const RECHECK = 20

/** The longest wait between two rechecks of a screen that keeps moving a
 * little: 30 s. Each recheck that finds nothing new doubles the wait up to
 * this; a read for any other reason starts over at [`RECHECK`]. */
export const MAX_RECHECK = 120

/** Samples after which a block's count of flips fades by one: 40 s. */
const FLIP_FADE = 160

/** A block that flipped this often is a glow or an animation, not a change. */
const NOISY_FLIPS = 2

/** Auto read's decision, one fingerprint per sample of the game: read a
 * screen once it differs from the last one read and has settled, or has
 * differed for longer than [`MAX_WAIT`] samples; read a screen that moved
 * less than that, but by at least one block, once [`RECHECK`] samples passed
 * since the last read. */
export class Watch {
  /** The print of the last screen read; none before the first. */
  private read: Uint8Array | null = null
  /** The previous sample's print. */
  private prev: Uint8Array | null = null
  /** Samples in a row that held. */
  private stable = 0
  /** Samples in a row that differed from the last screen read. */
  private waited = 0
  /** Samples since the last screen read. */
  private since = 0
  /** Samples without a read after which a small change is read again. */
  private recheckAfter = RECHECK
  /** Per block, how often it has gone over and come back under
   * [`BLOCK_DIFF`] from the screen read: a glow that breathes does it every
   * few seconds, a real change once. Fading by one every [`FLIP_FADE`] samples. */
  private readonly flips = new Uint8Array(64 * 36)
  /** Per block, whether it is over [`BLOCK_DIFF`] from the screen read now. */
  private readonly off = new Uint8Array(64 * 36)
  /** Samples taken, for the fade. */
  private ticks = 0

  /** The blocks that moved from the screen read, not counting those that
   * keep flipping: the breathing glow of the last day sits a block or two
   * either side of the threshold and would be read every few seconds. */
  private moved(read: Uint8Array, print: Uint8Array): number {
    const fade = ++this.ticks % FLIP_FADE === 0
    let n = 0
    let raw = 0
    for (let k = 0; k < print.length; k++) {
      const over = Math.abs(read[k] - print[k]) > BLOCK_DIFF ? 1 : 0
      raw += over
      if (over !== this.off[k]) {
        this.off[k] = over
        if (this.flips[k] < 255) this.flips[k] += 1
      } else if (fade && this.flips[k] > 0) {
        this.flips[k] -= 1
      }
      if (over === 1 && this.flips[k] < NOISY_FLIPS) n += 1
    }
    // Another screen, not a glow: nothing is masked on it.
    if (raw >= HELD_BLOCKS) {
      this.flips.fill(0)
      return raw
    }
    return n
  }

  /** Whether the last sample is the first that differs from the screen read, and so not yet read. */
  private first = false

  /** True when the last sample is the first of a change that is not settled: the reader may warm up on it (see
   * [`Session.prewarm`]). */
  get starting(): boolean {
    return this.first
  }

  /** The next sample counts as read: a screenshot is on show. */
  private adopt = false
  /** The next sample is read whatever it shows: a held read asks for one
   * more. */
  private reread = false

  /** Takes a sample's print; true when it should be read, which records it
   * as read. */
  sample(print: Uint8Array): boolean {
    this.first = false
    const prev = this.prev
    this.stable = prev !== null && prev.length === print.length && changed(prev, print) <= HELD_BLOCKS ? this.stable + 1 : 0
    this.prev = print.slice()
    if (this.adopt) {
      this.adopt = false
      this.markRead(print)
      return false
    }
    if (this.reread) {
      this.reread = false
      this.markRead(print)
      return true
    }
    this.since += 1
    const read = this.read
    const n = read !== null && read.length === print.length ? this.moved(read, print) : null
    if (n !== null && n < CHANGED_BLOCKS) {
      this.waited = 0
      if (n > 0 && this.since >= this.recheckAfter) {
        // A screen that keeps moving a little (an animated banner, a glow)
        // is read less and less often; a real change starts over.
        const next = Math.min(this.recheckAfter * 2, MAX_RECHECK)
        this.markRead(print)
        this.recheckAfter = next
        return true
      }
      return false
    }
    this.waited += 1
    if (this.stable >= SETTLE || this.waited > MAX_WAIT) {
      this.markRead(print)
      return true
    }
    this.first = this.waited === 1
    return false
  }

  /** Records a screen read some other way (the read hotkey). */
  markRead(print: Uint8Array): void {
    this.read = print.slice()
    this.waited = 0
    this.since = 0
    this.recheckAfter = RECHECK
    this.off.fill(0)
  }

  /** Counts the next sample as read, so an opened screenshot stays on show
   * until the game's screen changes. */
  adoptNext(): void {
    this.adopt = true
  }

  /** Reads the next sample whatever it shows, so a held read (see
   * [`Session.readLive`]) gets the one more read that confirms it. */
  readNext(): void {
    this.reread = true
  }
}

/** The worker's latest ranking. */
interface Progress {
  rounds: number
  done: boolean
  options: SolveOption[]
}

/** The solve of the board the advised move leads to, started while the player makes the move. */
interface Ahead {
  /** The board it solves, as [`Session.solve`] keys one. */
  key: string
  run: SolveRun
  /** Its latest ranking. */
  latest: SolveProgress | null
  /** Where its rankings go once the board is the one on show. */
  sink: ((progress: SolveProgress) => void) | null
}

/** A finished solve: the board it solved and its ranking. */
interface Solved {
  key: string
  options: SolveOption[]
  rounds: number
}

/** The app's state without the UI: the frame scheduler, the solve worker,
 * the player's corrections and the run log, around the run tracker (see
 * [`Run`]) that decides what a read means. */
export class Session {
  /** The advice's pick, while a solve runs or stands. */
  pick: Pick | null = null
  /** `buildState` objections: the model can't be played, nothing is solved. */
  problems: string[] = []
  ranking: SolveOption[] = []
  /** Rounds behind `ranking`. */
  rounds = 0
  solving = false
  /** Playouts per option for a full solve. */
  rollouts: number
  /** The run log the session writes its reads, advice and corrections to;
   * none by default. */
  log: RunLog | null = null

  /** The run being tracked. */
  private readonly run: Run
  /** What the run asks of this session: the advice's meal pick, the solve
   * and the run log's run markers. */
  private readonly runHooks: RunHooks = {
    advisedMeal: () => this.mealPicked(),
    solve: () => this.solve(),
    solveDropped: () => this.stop(),
    logNewRun: () => this.log?.newRun(),
    logRunEnd: (vaulted) => {
      const r = this.run.reading
      if (this.log !== null && r !== null && r.model.day >= r.model.maxDays) {
        this.log.event('run_end', new Date(), { vaulted })
        this.log.newRun()
      }
    },
  }
  /** The state the running solve plays from. */
  private state: State | null = null
  /** The size of the last frame read, before it was scaled. */
  private size: [number, number] = [REF_W, REF_H]
  /** The interface scale the last frame was read at (see
   * [`@/reader/layout::uiScale`]): the next read searches near it.
   * A game setting, so a new run keeps it. */
  private uiScale: number | null = null
  private notify: (() => void) | null = null
  /** The frame the reader is working on. */
  private scanTask: Promise<void> | null = null
  /** Whether the read that is running is done. */
  private scanReady = false
  /** What the read that is running found. */
  private scanned: Scanned | null = null
  /** The newest frame that arrived while a read ran, and whether it came
   * from the game; read when it ends. */
  private queued: { frame: Rgba; live: boolean } | null = null
  /** The frame the read came from the game, see [`Session.readLive`]. */
  private live = false
  /** The solve that is running. */
  private solveTask: Promise<void> | null = null
  /** The number of the running solve; a solve that is not the current one
   * stops at its next round. */
  private solveGen = 0
  /** The running solve, in the pool of worker threads that play its rounds,
   * so the window keeps painting and the capture keeps its pace. */
  private solveRun: SolveRun | null = null
  /** The worker's latest ranking. */
  private progress: Progress | null = null
  /** The last finished solve, so a board that comes up again as a Consume target pick is not solved again. */
  private solved: Solved | null = null
  /** The solve of the board the advised move leads to. */
  private ahead: Ahead | null = null

  /** `days` is the days count the held `tools` were saved at: a higher
   * count read twice is a new run and clears them. */
  constructor(rollouts: number, tools: Tool[], theme: number | null, days: number | null) {
    this.rollouts = Math.max(rollouts, 1)
    this.run = new Run(tools, theme, days)
  }

  /** The reading on show, with the player's corrections applied. */
  get reading(): Reading | null {
    return this.run.reading
  }

  /** The line the window shows in place of the board and the advice once a
   * run is over. */
  get runOver(): string | null {
    return this.run.runOver
  }

  /** Why the last read installed nothing while no reading is on show:
   * a theme scroll, a popup or a screen without the board. */
  get missed(): string | null {
    return this.run.missed
  }

  /** The instruments held; see [`Run.tools`]. */
  get tools(): Tool[] {
    return this.run.tools
  }

  /** The run's theme, an id of `data().themes`. */
  get theme(): number | null {
    return this.run.theme
  }

  /** True while a frame from [`Session.readInBackground`] is being read. */
  scanning(): boolean {
    return this.scanTask !== null
  }

  /** The number of the solve on show. A new solve or a dropped run changes it; a read that finds the same board
   * over and over does not, though it hands out a new `reading` each time. */
  get solveId(): number {
    return this.solveGen
  }

  /** Called from the worker after each partial ranking (the UI asks for a
   * repaint). */
  onProgress(notify: () => void): void {
    this.notify = notify
  }

  /** Reads a frame with the reader (OCR included) in the background;
   * [`Session.poll`] takes the result (see [`Session.install`]). A frame
   * that arrives while a read runs waits for it; only the newest waiting
   * one is read next. */
  readInBackground(frame: Rgba): void {
    this.read(frame, false)
  }

  /** [`Session.readInBackground`] for a frame captured from the game: a
   * changed board read is held for one more read, see
   * [`Session.install`]. */
  readLive(frame: Rgba): void {
    this.read(frame, true)
  }

  /** Instals a read the reader made of a frame the caller holds as data:
   * the scene and the panels, at the reference size. The test seam for the
   * run rules, which are otherwise reached only through PNG frames; `live`
   * marks a frame captured from the game (see [`Session.readLive`]). */
  readSynthetic(scene: Scene, panels: Panels, live = false): void {
    this.live = live
    this.size = [REF_W, REF_H]
    this.run.take(scene, panels, [REF_W, REF_H], live, this.runHooks)
  }

  private read(frame: Rgba, live: boolean): void {
    if (this.scanTask !== null) {
      this.queued = { frame, live }
      return
    }
    this.startScan(frame, live, false)
  }

  /** Reads a frame for nothing but its OCR, which the reader keeps: a screen that has just begun to change is
   * read while it settles, so the read after the settle finds its regions done. The reading is dropped; a frame
   * that arrives to be read waits for it. Does nothing while a read runs. */
  prewarm(frame: Rgba): void {
    if (this.scanTask === null) this.startScan(frame, false, true)
  }

  /** True once after a read was held: the UI reads the game again. */
  wantsReread(): boolean {
    return this.run.wantsReread()
  }

  /** Starts the read of a frame. */
  private startScan(frame: Rgba, live: boolean, warm: boolean): void {
    this.live = live
    const keep = this.log !== null && !warm
    const hint = this.uiScale
    this.scanReady = false
    this.scanned = null
    this.scanTask = (async () => {
      const started = performance.now()
      try {
        const scanned = await scan(frame, keep, hint)
        this.scanned = warm ? null : scanned
      } catch (error) {
        // The reader failed: the spinner must not stick.
        this.scanned = null
        console.error(error)
      }
      timed(warm ? 'warm' : 'read', performance.now() - started)
      this.scanReady = true
      this.notify?.()
    })()
  }

  /** Instals a read frame: the run tracker takes it (see [`Run.take`]) and
   * the run log gets the reading, or the miss with its frame. */
  private install(scanned: Scanned): void {
    this.uiScale = scanned.u
    this.size = scanned.size
    const taken = this.run.take(scanned.scene, scanned.panels, scanned.size, this.live, this.runHooks)
    if (taken.kind === 'installed') {
      this.logRead(scanned.frame)
    } else if (taken.kind === 'kept') {
      // Off the board or between runs the frame shows another game screen.
      this.logMiss(scanned.panels.screen, taken.line, taken.saveFrame ? scanned.frame : null)
    }
  }

  /** Logs a read that installed nothing: its screen, the line it gave, the
   * frame size and `frame` when its screen differs from the last frame
   * saved. */
  private logMiss(screen: Screen, line: string, frame: Rgba | null): void {
    const log = this.log
    if (log === null) return
    const file = frame === null ? null : log.frame(screen, null, frame)
    log.event('miss', new Date(), {
      screen: screenName(screen),
      line,
      size: [this.size[0], this.size[1]],
      frame: file,
    })
  }

  /** Logs the window auto read captures, as the watcher describes it, and
   * the language the OCR reads in (null with none installed). */
  logWindow(window: string): void {
    this.log?.window({ window, ocr: language() })
  }

  /** Logs the reading on show, and `frame` when it shows another screen or
   * board than the last frame saved. */
  private logRead(frame: Rgba | null): void {
    const log = this.log
    const r = this.run.reading
    if (log === null || r === null) return
    const file = frame === null ? null : log.frame(r.screen, r.model, frame)
    log.event('read', r.at, {
      screen: screenName(r.screen),
      days_left: r.daysLeft,
      tools: [...this.run.tools],
      theme: data().themeName(this.run.theme),
      warnings: r.warnings.map(warningText),
      frame: file,
      model: r.model,
    })
  }

  /** Logs the advice of a finished solve: the pick and the picks about as
   * good. */
  private logAdvice(): void {
    const log = this.log
    const a = this.advice()
    if (log === null || a === null) return
    log.event('advice', new Date(), {
      read_at: this.run.reading === null ? null : timestamp(this.run.reading.at),
      pick: a.label,
      also_good: alsoGood(this.ranking, a.option).map((k) => this.ranking[k].label),
      rounds: this.rounds,
    })
  }

  /** Corrects screen cell `cell` (2-16; 1 is the Interrogation Room) and
   * re-solves. Throws when the cell cannot be edited. */
  editCell(cell: number, edit: CellEdit): void {
    this.checkEditable(cell)
    this.run.edits.set(cell, edit)
    let name: string
    switch (edit.kind) {
      case 'locked':
        name = 'Locked'
        break
      case 'empty':
        name = 'Empty'
        break
      case 'inmate': {
        const beast =
          edit.beast === 'mammoth' ? 'Mammoth' : edit.beast === 'lion' ? 'Lion' : edit.beast === 'wolf' ? 'Wolf' : 'Rat'
        name = `Inmate { beast: ${beast}, tier: ${edit.tier} }`
        break
      }
    }
    this.logEdit(cell, name)
    this.run.rebuild(this.runHooks)
  }

  /** Adds or removes the incident marker on screen cell `cell` (2-16) and
   * re-solves. Throws when the cell cannot be edited. */
  setMarker(cell: number, on: boolean): void {
    this.checkEditable(cell)
    this.run.markers.set(cell, on)
    this.logEdit(cell, `Marker ${on ? 'on' : 'off'}`)
    this.run.rebuild(this.runHooks)
  }

  private checkEditable(cell: number): void {
    const r = this.run.reading
    if (r === null) throw new Error('no board read yet')
    const count = r.model.cells.length
    if (cell < 2 || cell > count) throw new Error(`cell ${cell} can't be edited`)
  }

  private logEdit(cell: number, edit: string): void {
    this.log?.event('edit', new Date(), { cell, edit })
  }

  /** True once after the session changed the held instruments or the theme
   * itself (the scroll, a new run, an advised pick, the run's end), so the
   * UI saves them. */
  takeToolsChanged(): boolean {
    return this.run.takeToolsChanged()
  }

  /** The days until Riot in use: null until a first read and after a run's
   * end. */
  daysLeft(): number | null {
    return this.run.daysLeft()
  }

  /** Sets the held instruments (the panel shows only icons) and re-solves;
   * the lines about the run's own changes to them go. */
  setTools(tools: Tool[]): void {
    this.log?.event('edit', new Date(), { tools: [...tools] })
    this.run.setTools(tools, this.runHooks)
  }

  /** Sets the run's theme (the scroll was missed or misread) and re-solves. */
  setTheme(theme: number | null): void {
    this.log?.event('edit', new Date(), { theme: data().themeName(theme) })
    this.run.setTheme(theme)
    if (this.run.reading !== null) this.solve()
  }

  /** The treasure pick the running solve plays: the gifts on offer and the
   * picks left of the treasure, this one included. */
  treasurePick(): [Gift[], number] | null {
    const pending = this.state?.pending[0]
    if (pending === undefined || pending.kind !== 'gift') return null
    return [[...pending.options], pending.picks]
  }

  /** The meal picked on the Consume target screen on show: the only target
   * the engine offers there, or else the advised one. */
  private mealPicked(): Meal | null {
    const st = this.state
    if (st === null) return null
    const chain = st.pending.find((p) => p.kind === 'chain')
    const offered = chain !== undefined && chain.kind === 'chain' ? [...chain.options] : startOptions(st).map((o) => o.cell)
    if (offered.length === 1) return { cell: offered[0], certain: true }
    const a = this.advice()
    if (a === null) return null
    const action = a.action
    if (action.type === 'devour' || action.type === 'chain') return { cell: action.to, certain: false }
    return null
  }

  /** What the window recommends now; see [`advise`]. */
  advice(): Advice | null {
    const a = advise(this.pick, this.ranking, !this.solving || this.rounds >= LIVE_MIN)
    if (a === null) return null
    return this.state !== null ? preferChange(this.state, this.ranking, a) : a
  }

  /** Where the player clicks for the advice: the target's centre, half
   * width and half height in the game frame's pixels. Null while a solve
   * runs, for a reading from an opened file, and while the game shows
   * another screen than the reading's (a read since was kept or ended the
   * run). */
  mark(): [number, number, number, number] | null {
    const stored = this.run.stored
    const r = this.run.reading
    if (stored === null || r === null) return null
    if (!this.run.onScreen || this.solving || stored.panels.screen !== r.screen) return null
    const advice = this.advice()
    if (advice === null) return null
    const click = clickTarget(stored.panels.screen, stored.panels.spots, advice.action)
    if (click === null) return null
    if (this.uiScale === null) return null
    return toFrame(click, this.size[0], this.size[1], this.uiScale)
  }

  /** [`mark`] on the screen: the box in the logical pixels of `area`, the part of the screen the frame was taken
   * from. Null when [`mark`] is. */
  markOn(area: { x: number; y: number; width: number; height: number }): { x: number; y: number; width: number; height: number } | null {
    const m = this.mark()
    if (m === null) return null
    const sx = area.width / this.size[0]
    const sy = area.height / this.size[1]
    return { x: area.x + (m[0] - m[2]) * sx, y: area.y + (m[1] - m[3]) * sy, width: 2 * m[2] * sx, height: 2 * m[3] * sy }
  }

  /** The line the window shows under the advice `a`; see [`whyShown`]. */
  whyShown(a: Advice): string {
    return this.state !== null ? whyShown(this.state, this.ranking, a) : a.why
  }

  /** Keeps the instrument advised on an instrument pick. */
  private noteAdvisedTool(): void {
    if (this.run.pickNamed) return
    if (this.run.reading === null || this.run.reading.screen !== 'instrumentPick') return
    const advice = this.advice()
    if (advice === null) return
    // An advised Re-roll keeps the pick on show with a new offer: nothing is
    // held from it.
    const action = advice.action
    this.run.advisedTool = action.type === 'choose' && typeof action.id === 'string' ? toolFromKey(action.id) : null
  }

  /** Starts a solve of the current model in the background, replacing any
   * running one: rounds of [`ROUND`] playouts until `rollouts`, each
   * reported to [`Session.poll`]. A solve that is not the current one stops
   * at its next round. A board that [`Session.lookAhead`] has solved or is
   * solving takes that solve's place; the ranking of a finished solve of the
   * board answers its Consume target pick, which ranks the same bites. */
  solve(): void {
    const ahead = this.ahead
    this.ahead = null
    this.begin(ahead)
    if (ahead !== null && this.solveRun !== ahead.run) ahead.run.cancel()
  }

  private begin(ahead: Ahead | null): void {
    this.stop()
    const reading = this.run.reading
    if (reading === null) return
    const [st, problems] = buildState(reading.model, SEED)
    if (problems.length > 0) {
      this.problems = problems
      return
    }
    st.theme = this.run.theme
    // A treasure pick always offers all four gifts (build_state lists
    // them), for the picks the treasure has left.
    const first = st.pending[0]
    if (first !== undefined && first.kind === 'gift') {
      first.picks = Math.max(treasurePicks(this.run.theme) - (this.run.treasure ?? 0), 1)
    }
    // A Consume target screen picks the day's first bite, or a chain's next,
    // among the cells the screen marks as targets.
    const target = reading.screen === 'chainTarget'
    if (target && this.run.chained) {
      const eater = st.cells[st.position].inmate
      if (eater !== null) offerChain(st, eater.id)
      // The game opens this screen only while the eater has a target, so a
      // board read that gives it none is wrong (the eater's rarity not risen
      // yet, a misread target) and gets no advice.
      if (!st.pending.some((p) => p.kind === 'chain')) {
        this.problems = [
          `The board read gives the eater in cell ${cellLabel(st.position)} nothing to Consume, but the game marks targets: check the eater and the marked cells.`,
        ]
        return
      }
    }
    const firstBite = target && !this.run.chained
    let warning: Warning | null = null
    let bites: number[] = []
    if (target) {
      const jawedCells = this.run.stored === null ? [] : jawed(this.run.stored.scene)
      const eater = st.position
      const chain = st.pending.find((p) => p.kind === 'chain')
      if (chain !== undefined && chain.kind === 'chain') {
        const [options, w] = consumeTargets(chain.options, jawedCells, eater)
        chain.options = options
        warning = w
      } else if (firstBite) {
        const options = startOptions(st).map((o) => o.cell)
        const [targets, w] = consumeTargets(options, jawedCells, eater)
        bites = targets
        warning = w
      }
    }
    if (this.run.reading !== null) {
      this.run.reading.warnings = this.run.reading.warnings.filter((w) => w.kind !== 'targetsDiffer')
      if (warning !== null) this.run.reading.warnings.push(warning)
    }
    const pick = firstBite ? instantBite(st, bites) : instant(st)
    this.pick = pick === null ? null : { action: pick.action, label: pick.label, why: pick.why }
    this.state = st
    this.noteAdvisedTool()
    const key = JSON.stringify(st)
    if (firstBite && pick !== null && this.reuse(key, bites, pick.action)) return
    this.startSolve(st, firstBite ? bites : null, key, ahead !== null && ahead.key === key ? ahead : null)
  }

  /** Shows the finished solve of this board as the ranking of its Consume target pick, when the advised move
   * was a Consume: the playouts that ranked it played the same bites. False when there is no such solve. */
  private reuse(key: string, bites: number[], pick: Pick['action']): boolean {
    const solved = this.solved
    // One bite has nothing to rank: its solve is over at once.
    if (solved === null || solved.key !== key || solved.options.length === 0 || bites.length < 2) return false
    // The gaps of the ranking are to its first row, which the bites must keep.
    const lead = solved.options[0].action
    if (lead.type !== 'devour' || !bites.includes(lead.to)) return false
    const options: SolveOption[] = []
    for (const o of solved.options) {
      if (o.action.type === 'devour' && bites.includes(o.action.to)) {
        options.push({ ...o, policy: sameAction(pick, o.action) })
      }
    }
    if (options.length !== bites.length) return false
    this.solveGen += 1
    this.solving = true
    this.progress = { rounds: solved.rounds, done: true, options }
    this.notify?.()
    return true
  }

  /** Starts the solve of the board the advice leads to, so the screen after the move has its ranking when it is
   * read. Only a move to an open cell that holds nothing to draw (no incident marker, no shackles roll) is
   * foreseen: the warden moves and nothing else changes. The board is built from the reading as the reader will
   * build it from the next one, so a board that differs in any way is solved again. */
  private lookAhead(): void {
    this.dropAhead()
    const st = this.state
    const reading = this.run.reading
    if (st === null || reading === null || reading.screen !== 'patrol' || st.phase !== 'patrol') return
    const advice = this.advice()
    if (advice === null || advice.action.type !== 'patrol') return
    const n = advice.action.cell
    if (st.cells[n].sealed) return
    const trial = st.clone()
    if (!apply(trial, advice.action).ok) return
    if (trial.phase !== 'manage' || trial.pending.length > 0 || trial.rng !== st.rng) return
    const model = cloneModel(reading.model)
    model.step = 'manage'
    model.warden = n
    model.dest = []
    const [next, problems] = buildState(model, SEED)
    if (problems.length > 0) return
    next.theme = this.run.theme
    const ahead: Ahead = {
      key: JSON.stringify(next),
      latest: null,
      sink: null,
      run: solvePool().solve({ state: next, seed: SEED, rollouts: this.rollouts, round: ROUND, bite: null }, (progress) => {
        ahead.latest = progress
        ahead.sink?.(progress)
      }),
    }
    this.ahead = ahead
  }

  private dropAhead(): void {
    this.ahead?.run.cancel()
    this.ahead = null
  }

  /** Plays the rounds of a solve on the pool's workers, a stretch at a
   * time, so the window keeps painting between them. */
  private startSolve(st: State, bites: number[] | null, key: string, ahead: Ahead | null): void {
    const gen = ++this.solveGen
    this.solving = true
    const started = performance.now()
    let first = true
    const onProgress = (progress: SolveProgress): void => {
      if (gen !== this.solveGen) return
      this.progress = progress
      if (progress.done) this.solved = { key, options: progress.options, rounds: progress.rounds }
      this.notify?.()
      if (first) {
        first = false
        timed('solve-first', performance.now() - started)
      }
      if (progress.done) timed('solve', performance.now() - started)
    }
    if (ahead !== null) {
      this.solveRun = ahead.run
      this.solveTask = ahead.run.done
      ahead.sink = onProgress
      if (ahead.latest !== null) onProgress(ahead.latest)
      return
    }
    const run = solvePool().solve({ state: st, seed: SEED, rollouts: this.rollouts, round: ROUND, bite: bites }, onProgress)
    this.solveRun = run
    this.solveTask = run.done
  }

  /** Drops the solve, its ranking and pick; the workers stop at their next
   * chunk. */
  private stop(): void {
    this.dropAhead()
    this.solveRun?.cancel()
    this.solveRun = null
    this.ranking = []
    this.rounds = 0
    this.pick = null
    this.state = null
    this.problems = []
    this.solving = false
    this.solveGen += 1
    this.progress = null
  }

  /** Shows the worker's latest ranking. */
  private takeProgress(progress: Progress): void {
    this.ranking = progress.options
    this.rounds = progress.rounds
    this.solving = !progress.done
    this.progress = null
  }

  /** Takes the worker's latest ranking; true when something changed. */
  poll(): boolean {
    let changed = false
    if (this.scanTask !== null && this.scanReady) {
      const scanned = this.scanned
      this.scanTask = null
      this.scanned = null
      this.scanReady = false
      if (scanned !== null) {
        this.install(scanned)
        changed = true
      }
      this.readQueued()
    }
    // after the read: a read that installs a board with a ranking at hand has solved it already
    const wasSolving = this.solving
    const progress = this.progress
    if (progress !== null) {
      this.takeProgress(progress)
      changed = true
    }
    if (changed) this.noteAdvisedTool()
    if (wasSolving && !this.solving) {
      this.logAdvice()
      this.lookAhead()
    }
    return changed
  }

  /** Blocks until the pending reads, the running solve and the run log's
   * writes finish (for tests). */
  async wait(): Promise<void> {
    while (this.scanTask !== null) {
      const task = this.scanTask
      await task
      const scanned = this.scanned
      this.scanTask = null
      this.scanned = null
      this.scanReady = false
      if (scanned !== null) this.install(scanned)
      this.readQueued()
    }
    const wasSolving = this.solving
    if (this.solveTask !== null) {
      const task = this.solveTask
      await task
      this.solveTask = null
    }
    const progress = this.progress
    if (progress !== null) this.takeProgress(progress)
    this.noteAdvisedTool()
    if (wasSolving) this.logAdvice()
    if (this.log !== null) await this.log.wait()
  }

  /** Starts a read of the frame that waited for the last one, if any. */
  private readQueued(): void {
    const queued = this.queued
    if (queued === null) return
    this.queued = null
    this.startScan(queued.frame, queued.live, false)
  }
}

/** Playouts per option before the playouts can overrule the strategy's
 * pick. */
const LIVE_MIN = 150

/** The screen's name, as the Rust's Debug writes it in the run log. */
export function screenName(screen: Screen): string {
  switch (screen) {
    case 'patrol':
      return 'Patrol'
    case 'manage':
      return 'Manage'
    case 'chainTarget':
      return 'ChainTarget'
    case 'instrumentPick':
      return 'InstrumentPick'
    case 'treasurePick':
      return 'TreasurePick'
    case 'prisonStatus':
      return 'PrisonStatus'
    case 'interrogation':
      return 'Interrogation'
    case 'cellPick':
      return 'CellPick'
    case 'dayBanner':
      return 'DayBanner'
    case 'theme':
      return 'Theme'
    case 'popup':
      return 'Popup'
    case 'runEnd':
      return 'RunEnd'
    case 'unknown':
      return 'Unknown'
  }
}
