//! The app's state without the UI: the reading of the last frame, the
//! player's corrections and held instruments, and the ranking, which a
//! worker fills in rounds so the window shows it as it firms up.
//!
//! A port of src/app/session.rs. The reader and the solver run in the
//! background: a read is a promise the session picks up in [`poll`], and the
//! solve plays its rounds between two turns of the event loop, so the
//! window keeps painting.

import {
  buildState,
  cellEvent,
  cellIvory,
  cloneCell,
  cloneModel,
  sameCell,
  sameModel,
  type CellModel,
  type Model,
} from '@/board/board'
import {
  beastIndex,
  data,
  IRON_LAW,
  RAINBOW,
  toolFromKey,
  toolIndex,
  VAULT_CAP,
  type Beast,
  type Gift,
  type Tool,
} from '@/engine/data'
import { eats, offerChain, startOptions } from '@/engine/devour'
import { treasurePicks } from '@/engine/rules'
import { cellLabel, cellList, tierName, toolName } from '@/engine/text'
import type { State } from '@/engine/state'
import { target as clickTarget, toFrame } from '@/reader/click'
import { is16x9, layOutScaled } from '@/reader/layout'
import { ironLawDays, keptWarning, RUN_DAYS, toModel, warningText, type KeptWarning, type Warning } from '@/reader/model'
import { language } from '@/reader/ocr'
import { offBoard, readPanelsTitled, type Panels, type Screen } from '@/reader/panels'
import { CELLS, readScene, type Scene } from '@/reader/scene'
import { REF_H, REF_W, type Rgba } from '@/reader/mod'
import { advise, alsoGood, preferChange, whyShown, type Advice, type Pick } from '@/solver/advise'
import { instant, instantBite, type SolveOption } from '@/solver/solve'
import { RunLog, timestamp } from './runlog'
import { timed } from './profile'
import type { SolveProgress } from './solve-worker'

/** Rounds the worker plays between two partial rankings. */
export const ROUND = 50
/** The seed of the board's hidden parts and of the playouts, as in
 * `warden-cli solve`. */
const SEED = 1

/** The solver's worker: the playouts run in it, so the window keeps
 * painting and the capture keeps its pace while they do. */
const SOLVER = new URL('./solve-worker.ts', import.meta.url)

/** A correction to a cell the reader got wrong. */
export type CellEdit =
  | { kind: 'locked' }
  | { kind: 'empty' }
  | { kind: 'inmate'; beast: Beast; tier: number }

/** What the reader made of a frame, with the player's corrections applied. */
export class Reading {
  /** The board the reading shows, with the player's corrections applied. */
  model: Model
  /** The warnings of the reading, in the order they are shown. */
  warnings: Warning[]

  constructor(
    /** The board the reading shows, with the player's corrections applied. */
    model: Model,
    /** The warnings of the reading, in the order they are shown. */
    warnings: Warning[],
    /** The screen the frame shows. */
    readonly screen: Screen,
    /** "N days until Riot", read or kept from an earlier reading (see
     * [`DaysClock`]). */
    readonly daysLeft: number | null,
    /** When the frame was read (corrections keep it). */
    readonly at: Date
  ) {
    this.model = model
    this.warnings = warnings
  }

  /** The lines saying why the frames after this reading were not read
   * (a popup, a screen without the board, a window narrower than 16:9, the
   * theme scroll): empty unless the reading on show is a kept one. The
   * next reading installed starts without them. */
  keptLines(): string[] {
    return this.warnings.filter((w) => w.kind === 'kept').map(warningText)
  }
}

/** The days left until the Riot over a run's readings. The counter only
 * counts down, so a read equal to or lower than the last count is taken, a
 * missing read keeps the last count, and a higher read is a misread unless
 * the same value reads twice in a row (a new run). */
export class DaysClock {
  left: number | null = null
  /** A higher read waiting for its second reading. */
  higher: number | null = null

  /** Takes one reading's days read and gives the count to use: null
   * until a first read. */
  update(read: number | null): number | null {
    const higher = this.higher
    this.higher = null
    if (read !== null && this.left !== null && read > this.left && higher !== read) {
      this.higher = read
    } else if (read !== null) {
      this.left = read
    }
    return this.left
  }

  /** [`DaysClock.update`], and whether it took a higher count (a new run). */
  updateRun(read: number | null): [number | null, boolean] {
    const before = this.left
    const left = this.update(read)
    return [left, before !== null && left !== null && left > before]
  }
}

/** Whether `screen` is a pick that covers the board with no board read under
 * it (`under`): the run start is assumed. */
function runStart(screen: Screen, under: Model | null): boolean {
  return (screen === 'instrumentPick' || screen === 'treasurePick') && under === null
}

/** The warning for a days count kept from an earlier reading, when `read`
 * is not the count in use. */
function keptDays(read: number | null, left: number | null): Warning | null {
  if (left === null || read === left) return null
  return read !== null
    ? {
        kind: 'read',
        cell: null,
        text: `The days counter read ${read}, more than the last count: ${left} day(s) until Riot kept until ${read} reads again.`,
      }
    : { kind: 'note', cell: null, text: `The days counter is hidden: ${left} day(s) until Riot kept from the last read.` }
}

/** The board under a treasure pick after a consume, and the eater's model
 * index. The day's consume starts in the warden's cell and chain bites keep
 * the eater there; at Chromatic it leaves for the vault and its cell locks
 * again, as every consumed cell does, the last meal's cell (`meal`) too.
 * Null when the warden's cell holds no inmate: the board read already shows
 * it gone. With no Consume target screen read since the board (`meal` null)
 * and the Ravenous Chains held, the Chromatic comes from the Chains at the
 * start of a day instead when they can lift the board's top inmate that far;
 * the removed neighbours are the returned list. */
function vaultedOf(board: Model, meal: Meal | null, chains: boolean): [Model, number, number[]] | null {
  if (meal === null && chains) {
    const v = chainsVaulted(board)
    if (v !== null) return v
  }
  const n = board.warden
  const cell = board.cells[n]
  if (cell === undefined || cell.kind !== 'inmate') return null
  const m = cloneModel(board)
  m.cells[n] = { kind: 'sealed', event: cell.event }
  m.vault.push(cell.beast)
  if (meal !== null) {
    const last = m.cells[meal.cell]
    if (last !== undefined && last.kind === 'inmate') {
      m.cells[meal.cell] = { kind: 'sealed', event: last.event }
    }
  }
  return [m, n, []]
}

/** The board after the Ravenous Chains sent the board's top inmate to the
 * vault: it and its neighbours on the ring lock. Null when the top rarity is
 * shared (the Chains pick one at random) or the Chains' tiers, one roll per
 * neighbour, can't lift it to Chromatic. */
function chainsVaulted(board: Model): [Model, number, number[]] | null {
  if (board.vault.length >= VAULT_CAP) return null
  let top: number | null = null
  for (const cell of board.cells) {
    if (cell.kind !== 'inmate') continue
    if (top === null || cell.tier > top) top = cell.tier
  }
  if (top === null) return null
  const at = board.cells.filter((c) => c.kind === 'inmate' && c.tier === top).length
  if (at !== 1) return null
  const n = board.cells.findIndex((c) => c.kind === 'inmate' && c.tier === top)
  const beast = (board.cells[n] as Extract<CellModel, { kind: 'inmate' }>).beast
  const len = board.cells.length
  const sides = [(n + len - 1) % len, (n + 1) % len].filter((k) => board.cells[k].kind === 'inmate')
  const gain = (data().tool('chains').tiers ?? 0) * sides.length
  if (top + gain < RAINBOW) return null
  const m = cloneModel(board)
  for (const k of [...sides, n]) m.cells[k] = { kind: 'sealed', event: cellEvent(m.cells[k]) }
  m.vault.push(beast)
  return [m, n, sides]
}

/** The meal picked on the last Consume target screen read: the only target
 * the screen offered (certain), or the one Warden advised there. */
interface Meal {
  cell: number
  certain: boolean
}

/** The cells, as model indices, of the prey the board's Lions have marked. */
function preyCells(m: Model): number[] {
  const out: number[] = []
  for (const cell of m.cells) {
    if (cell.kind !== 'inmate') continue
    const mark = cell.prey
    if (mark === null || mark.cell === null || mark.cell < 0) continue
    out.push(mark.cell)
  }
  return out
}

/** True when a Consume target screen read shows a bite since `before`: the
 * inmate in the warden's cell changed, or another inmate left its cell. The
 * screen then picks a chain's next meal, not the day's first. */
function bitten(before: Model, read: Model): boolean {
  const eater = read.warden
  const n = Math.min(before.cells.length, read.cells.length)
  for (let k = 0; k < n; k++) {
    const cell = before.cells[k]
    const other = read.cells[k]
    if (cell.kind === 'inmate' && other.kind === 'inmate') {
      if (k === eater && (cell.beast !== other.beast || cell.tier !== other.tier)) return true
    } else if (cell.kind === 'inmate' && (other.kind === 'empty' || other.kind === 'sealed')) {
      return true
    }
  }
  return false
}

/** A low-confidence cell read stops warning once it gave the same read on
 * this many reads in a row before the one on show. */
const STEADY_READS = 2

/** The key of a low-confidence cell warning: the cell, the read and what it
 * gave, so the same read on the same cell gives the same key whatever the
 * confidence. */
function steadyKey(w: Warning): string | null {
  if (w.kind !== 'cellRead' || w.confidence === undefined) return null
  return `${w.cell}:${w.detail}:${w.read ?? ''}`
}

/** The targets of a Consume target pick: the engine's `options` on the read
 * board that the screen marks with big jaws (`jawed`, model indices). When
 * the two differ, a warning on the eater's cell; when none of the jawed
 * cells is among the options, or no jaws were read, the options as they
 * are. */
export function consumeTargets(options: number[], jawed: number[], eater: number): [number[], Warning | null] {
  if (jawed.length === 0 || (jawed.length === options.length && options.every((n) => jawed.includes(n)))) {
    return [[...options], null]
  }
  const text = `The Consume targets on screen are ${cellList(jawed)} and the board read allows ${cellList(options)}: check the eater in cell ${cellLabel(eater)} and those cells.`
  const both = options.filter((n) => jawed.includes(n))
  const targets = both.length === 0 ? [...options] : both
  return [targets, { cell: eater, kind: 'targetsDiffer', text }]
}

/** The cells a Consume target screen marks with big jaws, as model indices. */
function jawed(scene: Scene): number[] {
  return CELLS.filter((c) => scene.cell(c).target).map((c) => c - 1)
}

/** Avenger's Casket opens a locked door after a bite with a meal for the
 * eater, at its rarity, and the target screen puts the big jaws on it, which
 * spoil its read. A jawed cell (`jawed`, model indices) that `m` holds
 * without an inmate becomes that meal: the eater's rarity and the beast
 * `read` shows when the eater eats it, else what the eater eats, with a
 * warning on the cell when that is more than one beast. */
export function casketMeals(m: Model, read: Model, jawed: number[]): Warning[] {
  const cell = m.cells[m.warden]
  if (cell === undefined || cell.kind !== 'inmate') return []
  const tier = cell.tier
  const food = eats(cell.beast)
  const warnings: Warning[] = []
  for (const n of jawed) {
    const here = m.cells[n]
    if (here === undefined) continue
    if (here.kind === 'inmate') continue
    const there = read.cells[n]
    const seen = there !== undefined && there.kind === 'inmate' && food.includes(there.beast) ? there.beast : null
    const beast = seen ?? food[0]
    if (seen === null && food.length > 1) {
      const text = `Check cell ${cellLabel(n)}: a new Inmate from ${toolName('revenge')}, taken as ${tierName(tier)} ${data().beastNames[beastIndex(beast)]}: click the cell to correct it.`
      warnings.push({ cell: n, kind: 'read', text })
    }
    m.cells[n] = { kind: 'inmate', beast, tier, ivory: cellIvory(here), prey: null, event: cellEvent(here) }
  }
  return warnings
}

/** The line for a read kept between runs, see [`Session.install`]. */
const RUN_OVER_WAIT = 'The run is over: waiting for the next run.'
/** The line logged for a changed board read held for one more read, see
 * [`Session.install`]. */
const CHANGED = 'The board changed: reading it again to confirm.'

/** Cells in which a board read with a hidden counter on the run's last day
 * must differ from the board on show to be taken as a screen after the run
 * (the riot screen missed). In the cloud run logs such reads differed from
 * the last day's board in 6 to 14 of 16 cells; 43 of about 16,000 same-day
 * read pairs in normal play differed in 6 or more. */
const AFTER_RUN_CELLS = 6

/** What the player sees of a cell for [`AFTER_RUN_CELLS`]: locked or not,
 * the beast and the tier. */
function cellSight(cell: CellModel): [boolean, Beast | null, number | null] {
  switch (cell.kind) {
    case 'sealed':
      return [true, null, null]
    case 'inmate':
    case 'scouted':
      return [false, cell.beast, cell.tier]
    case 'scratch':
      return [false, null, cell.tier]
    default:
      return [false, null, null]
  }
}

/** Playouts per option before the playouts can overrule the strategy's
 * pick. */
const LIVE_MIN = 150

/** What the reader saw in a frame, the frame's size, the frame itself
 * when the run log keeps it, and the interface scale it was read at. */
interface Scanned {
  scene: Scene
  panels: Panels
  size: [number, number]
  frame: Rgba | null
  u: number
}

/** What [`Session.takeRead`] did with a read: a kept one carries its line
 * and whether the run log keeps its frame (off the board and between runs
 * the frame shows another game screen). */
type Taken = { kind: 'installed' } | { kind: 'kept'; line: string; saveFrame: boolean } | { kind: 'skipped' }

/** Reads the frame at the reference size the reader's regions are measured
 * on, as `load_png` does, at the interface scale measured near `hint`; see
 * [`shapeKept`] for the shapes refused. `keep` gives the frame back at its
 * own size. */
async function scan(frame: Rgba, keep: boolean, hint: number | null): Promise<Scanned> {
  const size: [number, number] = [frame.w, frame.h]
  const [f, title, u] = layOutScaled(frame, hint)
  const scene = readScene(f)
  const panels = await readPanelsTitled(f, title ?? f)
  return { scene, panels, size, frame: keep ? frame : null, u }
}

/** A window as wide as 16:9 or wider is read: [`layOutScaled`] lays it out
 * as the reference frame. A window narrower than 16:9 (by more than 1%)
 * has never been seen, so how the game lays it out is untested: such a
 * frame is not read, and the reading on show is kept (see [`KeptKind`]). */
function shapeKept([w, h]: [number, number]): KeptWarning | null {
  return w * 9 < h * 16 && !is16x9(w, h) ? keptWarning('shape', [w, h]) : null
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

  /** The next sample counts as read: a screenshot is on show. */
  private adopt = false
  /** The next sample is read whatever it shows: a held read asks for one
   * more. */
  private reread = false

  /** Takes a sample's print; true when it should be read, which records it
   * as read. */
  sample(print: Uint8Array): boolean {
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

/** The app's state without the UI. */
export class Session {
  reading: Reading | null = null
  /** Set by the riot screen that ends a run: the line the window shows in
   * place of the board and the advice, see [`Session.install`]. */
  runOver: string | null = null
  /** Why the last read installed nothing while no reading is on show:
   * a theme scroll, a popup or a screen without the board. */
  missed: string | null = null
  tools: Tool[]
  /** The run's theme, an id of `data().themes`: read from the lobby's
   * scroll or set by the player; null for a run without one. */
  theme: number | null
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

  /** The state the running solve plays from. */
  private state: State | null = null
  /** The stored read, its days replaced by the clock's count. */
  private scene: { scene: Scene; panels: Panels; at: Date } | null = null
  /** The size of the last frame read, before it was scaled. */
  private size: [number, number] = [REF_W, REF_H]
  /** The interface scale the last frame was read at (see
   * [`@/reader/layout::uiScale`]): the next read searches near it.
   * A game setting, so a new run keeps it. */
  private uiScale: number | null = null
  /** The days counter as the stored read gave it. */
  private daysRead: number | null = null
  private days = new DaysClock()
  /** How many instruments were held before the read whose higher count
   * waits for its second reading: a new run clears these and keeps any
   * picked since. */
  private heldBeforeHigher = 0
  /** The instrument advised on the instrument pick screen on show or last
   * read: held from the next screen on, see [`Session.install`]. */
  private advisedTool: Tool | null = null
  /** The instrument panel's read when the player last set the held list
   * (null inside: unread or unsure); undefined when the player has not set
   * it. While reads give the same panel read, the player's list stands; the
   * session's own changes to the list (an advised pick, a new run) clear it. */
  private heldEdit: Tool[] | null | undefined = undefined
  /** The player set the held list on the pick on show: nothing is inferred
   * from it. */
  private pickNamed = false
  /** The last read was kept as the board fading in, see
   * [`Session.takeRead`]. */
  private fadeKept = false
  /** The session's lines for the stored read (a held list it changed). */
  private notes: string[] = []
  /** The session changed `tools` or `theme`, see
   * [`Session.takeToolsChanged`]. */
  private toolsChanged = false
  /** `theme` was set (scroll or panel) after the last board read: a new run
   * keeps it, see [`Session.install`]. */
  private themeFresh = false
  /** The picks taken from the Warden's Treasure open since its first pick
   * screen; null when no treasure is open, see [`Session.install`]. */
  private treasure: number | null = null
  /** The last model of a patrol, manage or Sewer Ratway cell pick screen,
   * corrections included: what an instrument or treasure pick covers. */
  private board: Model | null = null
  /** The board since the last manage screen, with the cells and the warden
   * of any Consume target screen read after it (earlier bites locked): what
   * a treasure pick after a consume covers, see [`vaulted`]. Null after a
   * patrol or cell pick screen. */
  private consume: Model | null = null
  /** The longest vault read this run and the day it was read: a treasure
   * pick reading fewer keeps it, and the run end counts it. A reading on an
   * earlier day is a new run's. */
  private vaultTop: [number, Beast[]] | null = null
  /** The day each Prey mark on the board was first read, by the prey's
   * cell: the reader reads every mark at its full rounds, and a mark loses
   * one each day after. A reading on an earlier day is a new run's. */
  private preySeen: [number, number][] = []
  /** A Consume target screen read since the last manage screen showed a
   * bite: the target screen is a chain's (see [`bitten`]). */
  private chained = false
  /** The meal picked on the last Consume target screen since the last
   * patrol, manage or cell pick screen: what a treasure pick covers, see
   * [`vaulted`]. */
  private meal: Meal | null = null
  /** Per low-confidence cell warning (see [`steadyKey`]), the reads in a
   * row up to the stored one that gave it. */
  private steady = new Map<string, number>()
  private edits = new Map<number, CellEdit>()
  /** Per cell, an incident marker the player added (true) or removed. */
  private markers = new Map<number, boolean>()
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
  /** The game's screen shows the stored read: it came from the game and no
   * read since was kept, see [`Session.mark`]. */
  private onScreen = false
  /** The last read was held as a changed board: the next one is taken
   * whatever it shows. */
  private confirming = false
  /** A read was held and waits for one more, see
   * [`Session.wantsReread`]. */
  private reread = false
  /** The solve that is running. */
  private solveTask: Promise<void> | null = null
  /** The number of the running solve; a solve that is not the current one
   * stops at its next round. */
  private solveGen = 0
  /** The worker that plays the rounds of the running solve. */
  private solver: Worker | null = null
  /** The wait for the worker's next ranking. */
  private solverWait: ((progress: SolveProgress | null) => void) | null = null
  /** The worker's latest ranking. */
  private progress: Progress | null = null
  /** The time of the last reading, so the readings' times never stand
   * still: the clock has milliseconds, the Rust's has nanoseconds. */
  private lastStamp: Date | null = null

  /** `days` is the days count the held `tools` were saved at: a higher
   * count read twice is a new run and clears them. */
  constructor(rollouts: number, tools: Tool[], theme: number | null, days: number | null) {
    this.tools = [...tools]
    this.theme = theme
    this.rollouts = Math.max(rollouts, 1)
    this.days.left = days
  }

  /** True while a frame from [`Session.readInBackground`] is being read. */
  scanning(): boolean {
    return this.scanTask !== null
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
    this.takeRead(scene, panels, [REF_W, REF_H])
  }

  private read(frame: Rgba, live: boolean): void {
    if (this.scanTask !== null) {
      this.queued = { frame, live }
      return
    }
    this.startScan(frame, live)
  }

  /** True once after a read was held: the UI reads the game again. */
  wantsReread(): boolean {
    const out = this.reread
    this.reread = false
    return out
  }

  /** Starts the read of a frame. */
  private startScan(frame: Rgba, live: boolean): void {
    this.live = live
    const keep = this.log !== null
    const hint = this.uiScale
    this.scanReady = false
    this.scanned = null
    this.scanTask = (async () => {
      const started = performance.now()
      try {
        const scanned = await scan(frame, keep, hint)
        this.scanned = scanned
      } catch (error) {
        // The reader failed: the spinner must not stick.
        this.scanned = null
        console.error(error)
      }
      timed('read', performance.now() - started)
      this.scanReady = true
      this.notify?.()
    })()
  }

  /** Installs a read frame. When it gives the scene on show again (the same
   * model with the current corrections, screen and days), only the read
   * time and warnings change: the corrections and the running solve stay.
   * Otherwise the corrections go and a solve starts. A game dialog, a frame
   * without the board (see [`@/reader/panels::offBoard`]) or a frame of a
   * window narrower than 16:9 (see [`shapeKept`]) keeps the last reading and
   * its solve on show, with a line that says so. The riot screen ends the
   * run, see [`Session.endRun`]. Until the next run starts (a days counter
   * reading at least one under the run's length, or an instrument pick with
   * the counter hidden), a read is kept with [`RUN_OVER_WAIT`]. On the run's
   * last day a board read with the counter hidden that differs from the
   * board on show in [`AFTER_RUN_CELLS`] cells or more is taken as the riot
   * screen missed and ends the run.
   *
   * The reader can't name held instruments, so they follow the advice: a
   * new run (see [`DaysClock`]) clears them, and the instrument advised on
   * a pick is taken as the one picked: held from the next screen that is
   * not a dialog, unknown or View Prison Status. View Prison Status over a
   * pick gives the board under it and keeps the pick on show.
   *
   * The run theme scroll sets the theme and keeps the last reading on show.
   * A new run clears the theme unless it was set after the old run's last
   * board read; the riot screen clears it too.
   *
   * A Warden's Treasure opens on its pick screen and closes on the next
   * decision screen. The board shown after a pick, with other cells than
   * the board under the pick, is the pick's effect: while the treasure has
   * picks left (Opulence gives more), it becomes the board the next pick
   * covers and the pick stays on show.
   *
   * A low-confidence cell read warns until it has given the same read on
   * [`STEADY_READS`] reads in a row; a new run warns again.
   *
   * A frame from the game (see [`Session.readLive`]) whose board differs
   * from the last read's on the same screen and day is held, with no line
   * on show, and the next read is taken whatever it shows: a blip that
   * shows the old board again keeps the corrections and the running solve.
   *
   * The run log gets the reading and, when it shows another screen or board
   * than the last frame saved, the frame. A read that keeps the last
   * reading (or, with none on show, sets [`Session.missed`]) is logged as a
   * miss with its frame, saved once per screen in a row and once a minute
   * while that screen lasts; a miss off the board or between runs saves no
   * frame. */
  private install(scanned: Scanned): void {
    this.uiScale = scanned.u
    const screen = scanned.panels.screen
    const taken = this.takeRead(scanned.scene, scanned.panels, scanned.size)
    if (taken.kind === 'installed') {
      this.missed = null
      this.logRead(scanned.frame)
    } else if (taken.kind === 'kept') {
      this.onScreen = false
      // Off the board or between runs the frame shows another game screen.
      const frame = taken.saveFrame ? scanned.frame : null
      this.logMiss(screen, taken.line, frame)
    }
  }

  /** [`Session.install`] without the log. */
  private takeRead(scene: Scene, panels: Panels, size: [number, number]): Taken {
    const live = this.live
    const confirming = this.confirming
    this.confirming = false
    this.scanTask = null
    this.size = size
    const shape = shapeKept(size)
    // The lobby's scroll names the coming run's theme and shows no days
    // counter.
    if (shape === null && panels.theme !== null) {
      this.toolsChanged = this.toolsChanged || this.theme !== panels.theme
      this.theme = panels.theme
      this.themeFresh = true
    }
    // The board fading in after a Consume target screen reads the instrument
    // panel as empty, and its cells unsure, for a frame. A run loses no
    // instrument, so such a read is kept once and the next taken.
    const fading =
      !this.fadeKept &&
      this.reading !== null &&
      this.reading.screen === 'chainTarget' &&
      this.tools.length > 0 &&
      panels.held !== null &&
      panels.held.length === 0
    this.fadeKept = fading
    const kept: KeptWarning | null =
      shape !== null
        ? shape
        : panels.screen === 'theme'
          ? keptWarning('theme', data().themeName(this.theme) ?? '')
          : panels.screen === 'popup'
            ? keptWarning('popup')
            : offBoard(panels)
              ? keptWarning('offBoard')
              : fading
                ? keptWarning('fading')
                : null
    if (kept !== null) {
      const r = this.reading
      if (r !== null) {
        r.warnings = r.warnings.filter((w) => w.kind !== 'kept')
        r.warnings.unshift(kept)
      } else {
        this.missed =
          shape !== null || panels.screen === 'theme'
            ? warningText(kept)
            : panels.screen === 'popup'
              ? 'A popup covered the game.'
              : 'The last read found no board or pick on screen.'
      }
      return { kind: 'kept', line: warningText(kept), saveFrame: kept.keep !== 'offBoard' }
    }
    if (panels.screen === 'runEnd') {
      this.endRun()
      return { kind: 'skipped' }
    }
    // Between runs only a run start is taken: the screens players stay on
    // after the riot (chest rooms and such) read as junk boards.
    const startsRun =
      (panels.days !== null && panels.days >= RUN_DAYS - 1) || (panels.screen === 'instrumentPick' && panels.days === null)
    if (this.runOver !== null && !startsRun) {
      this.missed = RUN_OVER_WAIT
      return { kind: 'kept', line: RUN_OVER_WAIT, saveFrame: false }
    }
    // The riot screen missed: a board with a hidden counter on the last day,
    // far from the board on show, is a screen after the run.
    const r = this.reading
    if (this.days.left === 0 && panels.days === null && ['patrol', 'manage', 'chainTarget', 'unknown'].includes(panels.screen) && r !== null) {
      const model = toModel(scene, panels, this.tools, null, this.runDays())[0]
      const len = Math.min(model.cells.length, r.model.cells.length)
      let differ = 0
      for (let k = 0; k < len; k++) {
        const a = cellSight(model.cells[k])
        const b = cellSight(r.model.cells[k])
        if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) differ += 1
      }
      if (differ >= AFTER_RUN_CELLS) {
        this.endRun()
        return { kind: 'skipped' }
      }
    }
    // One read in about ten same-screen board changes is a blip that shows
    // the old board again within a second: a live read that changes the
    // board is held until one more read confirms it.
    const last = this.scene
    if (
      live &&
      !confirming &&
      ['patrol', 'manage', 'cellPick', 'interrogation'].includes(panels.screen) &&
      panels.days !== null &&
      last !== null &&
      last.panels.screen === panels.screen &&
      last.panels.days === panels.days
    ) {
      const now = toModel(scene, panels, this.tools, this.board, this.runDays())[0]
      const before = toModel(last.scene, last.panels, this.tools, this.board, this.runDays())[0]
      if (!sameModel(now, before)) {
        this.confirming = true
        this.reread = true
        return { kind: 'kept', line: CHANGED, saveFrame: true }
      }
    }
    this.runOver = null
    if (this.reading !== null && this.reading.screen === 'chainTarget') {
      this.meal = this.mealPicked()
    }
    this.daysRead = panels.days
    // A pick over no board read is taken as the run start (see
    // [`toModel`]), and its hidden counter as the run start's too: a count
    // kept from an earlier read or a past session can be stale. A lower
    // count kept is a past run's, so the instruments and theme held with it
    // go.
    let days: number | null
    let newRun: boolean
    if (runStart(panels.screen, this.board) && panels.days === null) {
      const start = this.runDays()
      newRun = this.days.left !== null && this.days.left < start
      if (newRun) this.heldBeforeHigher = this.tools.length
      this.days = new DaysClock()
      this.days.left = start
      days = start
    } else {
      ;[days, newRun] = this.days.updateRun(panels.days)
    }
    panels.days = days
    if (newRun && this.log !== null) this.log.newRun()
    if (this.days.higher !== null) this.heldBeforeHigher = this.tools.length
    const notes: string[] = []
    let heldChanged = false
    const stale = newRun ? Math.min(this.heldBeforeHigher, this.tools.length) : 0
    if (stale > 0) {
      this.tools.splice(0, stale)
      this.heldEdit = undefined
      notes.push('A new run: the held instruments were cleared.')
      heldChanged = true
    }
    if (newRun && !this.themeFresh && this.theme !== null) {
      this.theme = null
      notes.push('A new run: the theme was cleared.')
      heldChanged = true
    }
    // A higher count waiting for its second read already belongs to the new
    // run.
    if (this.days.higher === null) this.themeFresh = false
    // Only Iron Law runs past 20 days, so a longer count names the theme
    // when the lobby's scroll was not read; after the new-run clear above,
    // which would drop it again.
    if (days !== null && days > RUN_DAYS && this.theme !== IRON_LAW) {
      this.toolsChanged = true
      this.theme = IRON_LAW
      this.themeFresh = true
    }
    if (!['instrumentPick', 'prisonStatus', 'unknown'].includes(panels.screen)) {
      this.pickNamed = false
      const t = this.advisedTool
      this.advisedTool = null
      if (t !== null && !this.tools.includes(t)) {
        this.tools.push(t)
        this.heldEdit = undefined
        heldChanged = true
      }
    }
    // A sure read of the instrument panel names the held list, unless the
    // player set it while the panel read the same and the session has not
    // changed it since. A new run cleared the list above and a run loses no
    // instrument, so an empty panel read over a held list is a misread.
    const held = panels.held
    if (held !== null && !(held.length === 0 && this.tools.length > 0) && !this.heldIs(held)) {
      this.heldEdit = undefined
      if (held.length !== this.tools.length || !held.every((t, k) => this.tools[k] === t)) {
        this.tools = [...held]
        heldChanged = true
        const names = held.map((t) => data().toolNames[toolIndex(t)])
        notes.push(`The ${data().instrumentName} panel shows: ${names.join(', ')}.`)
      }
    }
    // The board shown over an open treasure's pick: a flicker while View
    // Prison Status opens when its cells are the pick's, else the pick's
    // effect, the board the next pick covers while picks are left, and the
    // one a new treasure pick (as a Chromatic gives) covers after.
    let picked: Model | null = null
    let afterPick = false
    const over = this.scene
    const shown = this.reading
    if (panels.screen === 'unknown' && this.daysRead !== null && this.treasure !== null && over !== null && shown !== null && over.panels.screen === 'treasurePick') {
      const model = toModel(scene, panels, this.tools, this.board, this.runDays())[0]
      const cells = shown.model.cells
      if (model.cells.length === cells.length && model.cells.every((c, k) => sameCell(c, cells[k]))) {
        return { kind: 'skipped' }
      }
      picked = model
      const taken = this.treasure
      afterPick = taken + 1 < treasurePicks(this.theme)
      this.treasure = afterPick ? taken + 1 : null
    }
    if (panels.screen === 'treasurePick') {
      this.treasure = this.treasure ?? 0
    } else if (['patrol', 'manage', 'chainTarget', 'cellPick', 'interrogation', 'instrumentPick', 'dayBanner'].includes(panels.screen)) {
      this.treasure = null
    }
    // View Prison Status shows the real board under a pick, and so does the
    // board after a treasure's pick: it becomes the last board read, in
    // place of any board inferred after the consume. With picks left, or
    // under View Prison Status, the pick stays on show, solved on that
    // board; after the last pick the scene becomes this read.
    const underStatus =
      panels.screen === 'prisonStatus' && over !== null && (over.panels.screen === 'treasurePick' || over.panels.screen === 'instrumentPick')
    const keepPick = afterPick || underStatus
    if (picked !== null || underStatus) {
      this.board = picked ?? toModel(scene, panels, this.tools, this.board, this.runDays())[0]
      this.consume = null
      this.meal = null
      this.chained = false
    }
    let nextScene = scene
    let nextPanels = panels
    if (over !== null && keepPick) {
      over.panels.days = panels.days
      nextScene = over.scene
      nextPanels = over.panels
    }
    this.scene = { scene: nextScene, panels: nextPanels, at: this.stamp() }
    // A pick kept on show is not the screen the game shows.
    this.onScreen = live && !keepPick
    const before = this.steady
    this.steady = new Map()
    if (newRun) before.clear()
    // The stored read's warnings, none dropped yet (`steady` is empty).
    const first = this.build()
    const keys = first === null ? [] : first.warnings.map(steadyKey).filter((k): k is string => k !== null)
    const steady = new Map<string, number>()
    for (const k of keys) steady.set(k, (before.get(k) ?? 0) + 1)
    this.steady = steady
    if (!heldChanged) {
      const again = this.build()
      const old = this.reading
      if (old !== null && again !== null && sameModel(old.model, again.model) && old.screen === again.screen && old.daysLeft === again.daysLeft) {
        this.reading = again
        return { kind: 'installed' }
      }
    }
    this.toolsChanged = this.toolsChanged || heldChanged
    this.notes = notes
    this.edits.clear()
    this.markers.clear()
    this.rebuild()
    return { kind: 'installed' }
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
    const r = this.reading
    if (log === null || r === null) return
    const file = frame === null ? null : log.frame(r.screen, r.model, frame)
    log.event('read', r.at, {
      screen: screenName(r.screen),
      days_left: r.daysLeft,
      tools: [...this.tools],
      theme: data().themeName(this.theme),
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
      read_at: this.reading === null ? null : timestamp(this.reading.at),
      pick: a.label,
      also_good: alsoGood(this.ranking, a.option).map((k) => this.ranking[k].label),
      rounds: this.rounds,
    })
  }

  /** Corrects screen cell `cell` (2-16; 1 is the Interrogation Room) and
   * re-solves. Throws when the cell cannot be edited. */
  editCell(cell: number, edit: CellEdit): void {
    this.checkEditable(cell)
    this.edits.set(cell, edit)
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
    this.rebuild()
  }

  /** Adds or removes the incident marker on screen cell `cell` (2-16) and
   * re-solves. Throws when the cell cannot be edited. */
  setMarker(cell: number, on: boolean): void {
    this.checkEditable(cell)
    this.markers.set(cell, on)
    this.logEdit(cell, `Marker ${on ? 'on' : 'off'}`)
    this.rebuild()
  }

  private checkEditable(cell: number): void {
    const r = this.reading
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
    const out = this.toolsChanged
    this.toolsChanged = false
    return out
  }

  /** The days until Riot in use: null until a first read and after a run's
   * end. */
  daysLeft(): number | null {
    return this.days.left
  }

  /** Sets the held instruments (the panel shows only icons) and re-solves;
   * the lines about the session's own changes to them go. */
  setTools(tools: Tool[]): void {
    this.log?.event('edit', new Date(), { tools: [...tools] })
    this.tools = [...tools]
    this.heldEdit = this.scene === null ? null : (this.scene.panels.held ?? null)
    this.notes = []
    if (this.reading !== null && this.reading.screen === 'instrumentPick') {
      this.advisedTool = null
      this.pickNamed = true
    }
    if (this.scene !== null) this.rebuild()
  }

  /** Sets the run's theme (the scroll was missed or misread) and re-solves. */
  setTheme(theme: number | null): void {
    this.log?.event('edit', new Date(), { theme: data().themeName(theme) })
    this.theme = theme
    this.themeFresh = true
    if (this.reading !== null) this.solve()
  }

  /** The treasure pick the running solve plays: the gifts on offer and the
   * picks left of the treasure, this one included. */
  treasurePick(): [Gift[], number] | null {
    const pending = this.state?.pending[0]
    if (pending === undefined || pending.kind !== 'gift') return null
    return [[...pending.options], pending.picks]
  }

  /** The model again from the stored read, the tools and the edits; then a
   * solve. */
  private rebuild(): void {
    const built = this.build()
    if (built === null) return
    const reading = built
    // The Hunt's target pick shows no cards, and its white glow on a lone
    // target spoils that cell's read: the cells and the day's used Consume
    // and Replace are the same day's manage screen's.
    const prey = reading.screen === 'cellPick' && reading.model.choice.kind === 'prey'
    if (prey) {
      const m = this.consume
      if (m !== null && m.day === reading.model.day) {
        reading.model.cells = m.cells.map(cloneCell)
        reading.model.devourUsed = m.devourUsed
        reading.model.swapUsed = m.swapUsed
      }
    }
    if (['patrol', 'manage', 'cellPick', 'prisonStatus'].includes(reading.screen)) {
      this.board = cloneModel(reading.model)
      this.chained = false
      this.meal = null
    }
    if (reading.screen === 'cellPick' && prey) {
      // nothing
    } else if (['patrol', 'cellPick', 'prisonStatus'].includes(reading.screen)) {
      this.consume = null
    } else if (reading.screen === 'manage') {
      this.consume = cloneModel(reading.model)
    } else if (reading.screen === 'chainTarget') {
      // The screen hides the counter, the vault and the decision buttons:
      // only its cells and warden are taken. A cell bitten just before may
      // still show as open while its inmate fades: it locks again, as every
      // consumed cell does.
      // The red jaws over a target spoil its read: a cell read with low
      // confidence keeps the board's cell, and its warning goes, unless the
      // player corrected it.
      const before = this.consume ?? this.board
      this.consume = null
      const read = cloneModel(reading.model)
      const unedited = (n: number): boolean => !this.edits.has(n + 1)
      if (before !== null) {
        const unsure = (w: Warning): boolean => w.kind === 'cellRead' && unedited(w.cell)
        for (const w of reading.warnings.filter(unsure)) {
          const n = w.cell as number
          read.cells[n] = cloneCell(before.cells[n])
        }
        reading.warnings = reading.warnings.filter((w) => !unsure(w))
      }
      const m = before === null ? cloneModel(reading.model) : cloneModel(before)
      this.chained = this.chained || bitten(m, read)
      const len = Math.min(m.cells.length, read.cells.length)
      for (let k = 0; k < len; k++) {
        const cell = m.cells[k]
        const other = read.cells[k]
        m.cells[k] = cell.kind === 'inmate' && other.kind === 'empty' ? { kind: 'sealed', event: other.event } : cloneCell(other)
      }
      // The board before may be the day's patrol.
      m.warden = reading.model.warden
      m.step = 'manage'
      if (this.scene !== null) {
        const cells = jawed(this.scene.scene).filter((n) => unedited(n))
        reading.warnings = [...reading.warnings, ...casketMeals(m, reading.model, cells)]
      }
      // Before the first bite the day's consume is still open.
      m.devourUsed = this.chained
      m.tools = [...reading.model.tools]
      // The solve takes this board, not the bare read.
      reading.model = cloneModel(m)
      this.consume = cloneModel(m)
    }
    const day = reading.model.day
    const vault = reading.model.vault
    if (this.vaultTop === null || day < this.vaultTop[0] || vault.length > this.vaultTop[1].length) {
      this.vaultTop = [day, [...vault]]
    }
    if (['patrol', 'manage', 'cellPick', 'prisonStatus'].includes(reading.screen)) {
      const seen = this.preySeen
      this.preySeen = preyCells(reading.model).map((x) => {
        const found = seen.find(([c, d]) => c === x && d <= day)
        return found === undefined ? ([x, day] as [number, number]) : found
      })
    }
    this.reading = reading
    this.solve()
  }

  /** The days the run lasts: Iron Law extends it. */
  private runDays(): number {
    return this.theme === IRON_LAW ? ironLawDays() : RUN_DAYS
  }

  /** The reading of the stored read with the tools and the edits. */
  private build(): Reading | null {
    const stored = this.scene
    if (stored === null) return null
    const { scene, panels, at } = stored
    const chains = this.tools.includes('chains')
    const vaulted = this.consume !== null && panels.screen === 'treasurePick' ? vaultedOf(this.consume, this.meal, chains) : null
    const under = vaulted !== null ? vaulted[0] : this.board
    const assumedDays = runStart(panels.screen, under ?? null) && this.daysRead === null
    const [model, warnings] = toModel(scene, panels, this.tools, under ?? null, this.runDays())
    // Chromatics never leave the vault in a run: a read that shows fewer
    // (the panel did not read, or only some of its slots) keeps the last
    // board's. A day before the board's is a new run.
    if (under !== null && under !== undefined && under.day <= model.day && under.vault.length > model.vault.length) {
      model.vault = [...under.vault]
    }
    // The board under a treasure pick can be View Prison Status's with the
    // vault panel unread: the pick keeps the run's longest vault.
    const top = this.vaultTop
    if (panels.screen === 'treasurePick' && top !== null && top[0] <= model.day && top[1].length > model.vault.length) {
      model.vault = [...top[1]]
    }
    for (const cell of model.cells) {
      if (cell.kind !== 'inmate') continue
      const mark = cell.prey
      if (mark === null) continue
      const seen = this.preySeen.find(([c, d]) => c === mark.cell && d <= model.day)
      if (seen !== undefined) mark.rounds = Math.max(mark.rounds - (model.day - seen[1]), 1)
    }
    const kept = warnings.filter((w) => {
      const key = steadyKey(w)
      if (key === null) return true
      const n = this.steady.get(key)
      return n === undefined || n <= STEADY_READS
    })
    if (vaulted !== null) {
      const [, n, removed] = vaulted
      const left = `The Warden's Treasure follows a Chromatic Prisoner: the inmate in cell ${cellLabel(n)} left for the vault`
      const cells = removed.map(cellLabel)
      const text =
        removed.length > 0
          ? `${left}, lifted by the ${toolName('chains')} at the start of the day, which removed ${
              cells.length === 1 ? `the inmate in cell ${cells[0]}` : `the inmates in cells ${cells.join(' and ')}`
            }: check them with View Prison Status.`
          : this.meal !== null && this.meal.certain
            ? `${left} after consuming cell ${cellLabel(this.meal.cell)}.`
            : this.meal !== null
              ? `${left}. Cell ${cellLabel(this.meal.cell)} is taken as its last meal, the target Warden advised: click the cell to correct it.`
              : `${left}. The last cell it consumed is not known and still shows its inmate: check it with View Prison Status.`
      kept.push({ cell: null, kind: 'read', text })
    }
    // The Consume target screen always hides the counter; the run start's
    // count is assumed, not kept.
    if (panels.screen !== 'chainTarget' && !assumedDays) {
      const warning = keptDays(this.daysRead, panels.days)
      if (warning !== null) kept.push(warning)
    }
    for (const text of this.notes) kept.push({ cell: null, kind: 'note', text })
    for (const [cell, edit] of this.edits) {
      const n = cell - 1
      const target = model.cells[n]
      if (target === undefined) continue
      // A correction keeps the cell's incident marker and Tusk.
      const event = cellEvent(target)
      const ivory = cellIvory(target)
      if (edit.kind === 'locked') model.cells[n] = { kind: 'sealed', event }
      else if (edit.kind === 'empty') model.cells[n] = { kind: 'empty', event }
      else model.cells[n] = { kind: 'inmate', beast: edit.beast, tier: edit.tier, ivory, prey: null, event }
    }
    // The Office and a Nest carry no marker.
    for (const [cell, on] of this.markers) {
      const target = model.cells[cell - 1]
      if (target === undefined) continue
      if (target.kind === 'office' || target.kind === 'nest') continue
      target.event = on ? 'unknown' : null
    }
    return new Reading(model, kept, panels.screen, panels.days, at)
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
    const stored = this.scene
    const r = this.reading
    if (stored === null || r === null) return null
    if (!this.onScreen || this.solving || stored.panels.screen !== r.screen) return null
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
    if (this.pickNamed) return
    if (this.reading === null || this.reading.screen !== 'instrumentPick') return
    const advice = this.advice()
    if (advice === null) return
    // An advised Re-roll keeps the pick on show with a new offer: nothing is
    // held from it.
    const action = advice.action
    this.advisedTool = action.type === 'choose' && typeof action.id === 'string' ? toolFromKey(action.id) : null
  }

  /** Starts a solve of the current model in the background, replacing any
   * running one: rounds of [`ROUND`] playouts until `rollouts`, each
   * reported to [`Session.poll`]. A solve that is not the current one stops
   * at its next round. */
  solve(): void {
    this.stop()
    const reading = this.reading
    if (reading === null) return
    const [st, problems] = buildState(reading.model, SEED)
    if (problems.length > 0) {
      this.problems = problems
      return
    }
    st.theme = this.theme
    // A treasure pick always offers all four gifts (build_state lists
    // them), for the picks the treasure has left.
    const first = st.pending[0]
    if (first !== undefined && first.kind === 'gift') {
      first.picks = Math.max(treasurePicks(this.theme) - (this.treasure ?? 0), 1)
    }
    // A Consume target screen picks the day's first bite, or a chain's next,
    // among the cells the screen marks as targets.
    const target = reading.screen === 'chainTarget'
    if (target && this.chained) {
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
    const firstBite = target && !this.chained
    let warning: Warning | null = null
    let bites: number[] = []
    if (target) {
      const jawedCells = this.scene === null ? [] : jawed(this.scene.scene)
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
    if (this.reading !== null) {
      this.reading.warnings = this.reading.warnings.filter((w) => w.kind !== 'targetsDiffer')
      if (warning !== null) this.reading.warnings.push(warning)
    }
    const pick = firstBite ? instantBite(st, bites) : instant(st)
    this.pick = pick === null ? null : { action: pick.action, label: pick.label, why: pick.why }
    this.state = st
    this.noteAdvisedTool()
    this.startSolve(st, firstBite ? bites : null)
  }

  /** Plays the rounds of a solve in the solver's worker, one chunk at a
   * time, so the window keeps painting between them. */
  private startSolve(st: State, bites: number[] | null): void {
    const gen = ++this.solveGen
    this.solving = true
    const worker = new Worker(SOLVER)
    this.solver = worker
    worker.onmessage = (e: MessageEvent) => {
      const wait = this.solverWait
      this.solverWait = null
      wait?.(e.data as SolveProgress)
    }
    worker.onerror = () => {
      const wait = this.solverWait
      this.solverWait = null
      wait?.(null)
    }
    this.solveTask = (async () => {
      const started = performance.now()
      let first = true
      try {
        worker.postMessage({ state: st, seed: SEED, rollouts: this.rollouts, round: ROUND, bite: bites })
        for (;;) {
          const { promise, resolve } = Promise.withResolvers<SolveProgress | null>()
          this.solverWait = resolve
          const progress = await promise
          if (progress === null || gen !== this.solveGen) return
          this.progress = progress
          this.notify?.()
          if (first) {
            first = false
            timed('solve-first', performance.now() - started)
          }
          if (progress.done) {
            timed('solve', performance.now() - started)
            return
          }
        }
      } finally {
        if (this.solver === worker) this.solver = null
        worker.terminate()
      }
    })()
  }

  /** Drops the solve, its ranking and pick; the worker stops at its next
   * round. */
  private stop(): void {
    const worker = this.solver
    this.solver = null
    if (worker !== null) {
      // The wait for the next ranking is released, so the solve's task ends.
      const wait = this.solverWait
      this.solverWait = null
      wait?.(null)
      worker.terminate()
    }
    this.ranking = []
    this.rounds = 0
    this.pick = null
    this.state = null
    this.problems = []
    this.solving = false
    this.solveGen += 1
    this.progress = null
  }

  /** The riot screen: the run is over. The solve stops and the board goes
   * with the run (nothing on it can be played or corrected any more); the
   * line says how many Chromatic Prisoners the run vaulted, the most any of
   * its readings showed.
   *
   * The held instruments and the days count go too. The riot screen read
   * again keeps the line. The run log gets a run_end and the next run's
   * folder only when the last reading was on the run's last day: the riot
   * screen also shows right after a run ends, and a board read in between (a
   * day 1 with an empty vault) is no run of its own. */
  private endRun(): void {
    if (this.runOver !== null) return
    const vaulted = this.vaultTop === null ? null : this.vaultTop[1].length
    this.runOver =
      vaulted === null
        ? 'The run is over.'
        : vaulted === 1
          ? 'The run is over: 1 Chromatic Prisoner vaulted.'
          : `The run is over: ${vaulted} Chromatic Prisoners vaulted.`
    const r = this.reading
    if (this.log !== null && r !== null && r.model.day >= r.model.maxDays) {
      this.log.event('run_end', new Date(), { vaulted })
      this.log.newRun()
    }
    this.stop()
    this.reading = null
    this.missed = null
    this.scene = null
    this.board = null
    this.consume = null
    this.vaultTop = null
    this.preySeen = []
    this.chained = false
    this.meal = null
    this.advisedTool = null
    this.heldEdit = undefined
    this.pickNamed = false
    this.steady.clear()
    this.days = new DaysClock()
    this.treasure = null
    this.themeFresh = false
    if (this.theme !== null) {
      this.theme = null
      this.toolsChanged = true
    }
    if (this.tools.length > 0) {
      this.tools = []
      this.toolsChanged = true
    }
  }

  /** Takes the worker's latest ranking; true when something changed. */
  poll(): boolean {
    let changed = false
    const wasSolving = this.solving
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
    const progress = this.progress
    if (progress !== null) {
      this.ranking = progress.options
      this.rounds = progress.rounds
      this.solving = !progress.done
      this.progress = null
      changed = true
    }
    if (changed) this.noteAdvisedTool()
    if (wasSolving && !this.solving) this.logAdvice()
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
    if (progress !== null) {
      this.ranking = progress.options
      this.rounds = progress.rounds
      this.solving = !progress.done
      this.progress = null
    }
    this.noteAdvisedTool()
    if (wasSolving) this.logAdvice()
    if (this.log !== null) await this.log.wait()
  }

  /** Starts a read of the frame that waited for the last one, if any. */
  private readQueued(): void {
    const queued = this.queued
    if (queued === null) return
    this.queued = null
    this.startScan(queued.frame, queued.live)
  }

  /** Whether the held list was set over the panel read `held`. */
  private heldIs(held: Tool[]): boolean {
    const edit = this.heldEdit
    if (edit === undefined || edit === null) return false
    return edit.length === held.length && edit.every((t, k) => held[k] === t)
  }

  /** The time of a reading: the clock never stands still, so two readings
   * never share a time. */
  private stamp(): Date {
    const now = new Date()
    if (this.lastStamp !== null && now.getTime() <= this.lastStamp.getTime()) {
      this.lastStamp = new Date(this.lastStamp.getTime() + 1)
    } else {
      this.lastStamp = now
    }
    return this.lastStamp
  }
}

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

