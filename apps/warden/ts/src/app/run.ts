//! The run-tracking module: one run of the game from its first board read
//! to the riot, as the session tracks it. The session scans the frames and
//! plays the solves out in its worker; this module decides what a read
//! means for the run and owns everything the run knows between two reads.
//!
//! A port of the run-tracking half of src/app/session.rs.

import {
  cellEvent,
  cellIvory,
  cloneCell,
  cloneModel,
  sameCell,
  sameModel,
  type CellModel,
  type Model,
} from '@/board/board'
import { beastIndex, data, IRON_LAW, RAINBOW, toolIndex, VAULT_CAP, type Beast, type Tool } from '@/engine/data'
import { eats } from '@/engine/devour'
import { treasurePicks } from '@/engine/rules'
import { cellLabel, cellList, tierName, toolName } from '@/engine/text'
import { is16x9 } from '@/reader/layout'
import { ironLawDays, keptWarning, RUN_DAYS, toModel, warningText, type KeptWarning, type Warning } from '@/reader/model'
import { offBoard, type Panels, type Screen } from '@/reader/panels'
import { CELLS, type Scene } from '@/reader/scene'

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
export interface Meal {
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

/** The screens a frame can show, by what the run does with the board on
 * it. Named once: the same sets were spelled out as literals in five
 * places with four memberships, each different on purpose (see each
 * class). */

/** Whether `screen` reads the board as it stands, so the reading becomes
 * the run's board - what a pick covers - and its prey marks are counted
 * and its chains reset: a patrol, a manage, the Sewer Ratway's cell pick
 * (the Hunt's prey pick shows the same board) and View Prison Status. A
 * Consume target screen is not one (its board is the day's consume, with
 * the jaws over its targets); the Interrogation Room's pick is not (an
 * interrogation moves no inmate); a day banner covers the board; and a
 * pick covers the board it is read over. */
function boardRead(screen: Screen): boolean {
  return screen === 'patrol' || screen === 'manage' || screen === 'cellPick' || screen === 'prisonStatus'
}

/** Whether `screen` shows a board a live read can change under the player
 * on the same screen and day: such a change is held for one more read
 * that confirms it, because one read in about ten is a blip that shows
 * the old board again within a second. The Interrogation Room's pick
 * shows a board that can change; a Consume target screen's board is the
 * day's consume, not the read's; View Prison Status is opened on purpose;
 * and a screen that reads as unknown is no board to confirm. */
function blipRead(screen: Screen): boolean {
  return screen === 'patrol' || screen === 'manage' || screen === 'cellPick' || screen === 'interrogation'
}

/** Whether `screen` carries a decision, so a Warden's Treasure closes on
 * it: the day's screens (a patrol's cards, a manage's buttons, a Consume
 * target pick, a cell pick, an interrogation), an instrument pick and the
 * day banner that ends the day. View Prison Status decides nothing, and a
 * screen that reads as unknown carries no cards or buttons. */
function decisionScreen(screen: Screen): boolean {
  return (
    screen === 'patrol' ||
    screen === 'manage' ||
    screen === 'chainTarget' ||
    screen === 'cellPick' ||
    screen === 'interrogation' ||
    screen === 'instrumentPick' ||
    screen === 'dayBanner'
  )
}

/** Whether a board read of `screen` with the days counter hidden on the
 * run's last day can be a screen after the run (the riot screen missed):
 * the day's board screens, the Consume target screen (which hides the
 * counter every day) and whatever the player stays on after the riot,
 * which reads as unknown. The picks and View Prison Status do not show
 * around the run's end. */
function afterRunRead(screen: Screen): boolean {
  return screen === 'patrol' || screen === 'manage' || screen === 'chainTarget' || screen === 'unknown'
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
export function jawed(scene: Scene): number[] {
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

/** The line for a read kept between runs, see [`Run.take`]. */
const RUN_OVER_WAIT = 'The run is over: waiting for the next run.'
/** The line logged for a changed board read held for one more read, see
 * [`Run.take`]. */
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

/** What [`Run.take`] did with a read: a kept one carries its line and
 * whether the run log keeps its frame (off the board and between runs the
 * frame shows another game screen). */
export type Taken = { kind: 'installed' } | { kind: 'kept'; line: string; saveFrame: boolean } | { kind: 'skipped' }

/** A window as wide as 16:9 or wider is read: [`layOutScaled`] lays it out
 * as the reference frame. A window narrower than 16:9 (by more than 1%)
 * has never been seen, so how the game lays it out is untested: such a
 * frame is not read, and the reading on show is kept (see [`KeptKind`]). */
function shapeKept([w, h]: [number, number]): KeptWarning | null {
  return w * 9 < h * 16 && !is16x9(w, h) ? keptWarning('shape', [w, h]) : null
}

/** What the run asks of the session around it: the solver's pick on the
 * Consume target screen on show, the solve itself, and the run log's run
 * markers. The frame scheduler, the solve worker, the player's corrections
 * and the log's read and miss entries are the session's, so the run knows
 * nothing of them. */
export interface RunHooks {
  /** The meal the advice picks on the Consume target screen on show: the
   * run takes it as the day's last when the screen goes. */
  advisedMeal(): Meal | null
  /** The reading on show changed, or the run started: the session solves
   * the board. */
  solve(): void
  /** The run is over: the solve and its ranking go. */
  solveDropped(): void
  /** The run log's marker of a new run. */
  logNewRun(): void
  /** The run log's run_end entry, with the run's take vaulted; the session
   * writes it only when the last reading was on the run's last day. */
  logRunEnd(vaulted: number | null): void
}

/** One run of the game as the session tracks it, from the first board read
 * to the riot: the reading on show, the days clock and the last count read,
 * the theme and the instruments held (a new run clears them), the board a
 * pick covers, the day's consume and its meal, the vault's top and the prey
 * marks seen, the treasure open, the chain flag, the blip held for one more
 * read and the board fading in kept once.
 *
 * The session scans the frames, plays the solves out in its worker, holds
 * the player's corrections ([`Run.edits`], [`Run.markers`]) and writes the
 * run log; the run asks for those through [`RunHooks`]. */
export class Run {
  /** The reading on show, with the player's corrections applied. */
  reading: Reading | null = null
  /** Set by the riot screen that ends a run: the line the window shows in
   * place of the board and the advice, see [`Run.take`]. */
  runOver: string | null = null
  /** Why the last read installed nothing while no reading is on show:
   * a theme scroll, a popup or a screen without the board. */
  missed: string | null = null
  /** The instruments held. The reader can't name them, so they follow the
   * advice and the player's list; a new run clears them. */
  tools: Tool[]
  /** The run's theme, an id of `data().themes`: read from the lobby's
   * scroll or set by the player; null for a run without one. */
  theme: number | null
  /** The stored read, its days replaced by the clock's count. */
  stored: { scene: Scene; panels: Panels; at: Date } | null = null
  /** The picks taken from the Warden's Treasure open since its first pick
   * screen; null when no treasure is open, see [`Run.take`]. */
  treasure: number | null = null
  /** A Consume target screen read since the last manage screen showed a
   * bite: the target screen is a chain's (see [`bitten`]). */
  chained = false
  /** The instrument advised on the instrument pick screen on show or last
   * read: held from the next screen on, see [`Run.take`]. The session
   * writes it (its advice names the pick). */
  advisedTool: Tool | null = null
  /** The player set the held list on the pick on show: nothing is inferred
   * from it. The session writes it. */
  pickNamed = false
  /** Per screen cell, a correction the player made (see [`CellEdit`]);
   * applied by every build. */
  readonly edits = new Map<number, CellEdit>()
  /** Per screen cell, an incident marker the player added (true) or
   * removed. */
  readonly markers = new Map<number, boolean>()
  /** The game's screen shows the stored read: it came from the game and no
   * read since was kept, see the session's `mark`. */
  onScreen = false

  /** The days counter as the stored read gave it. */
  private daysRead: number | null = null
  private days = new DaysClock()
  /** How many instruments were held before the read whose higher count
   * waits for its second reading: a new run clears these and keeps any
   * picked since. */
  private heldBeforeHigher = 0
  /** The instrument panel's read when the player last set the held list
   * (null inside: unread or unsure); undefined when the player has not set
   * it. While reads give the same panel read, the player's list stands; the
   * run's own changes to the list (an advised pick, a new run) clear it. */
  private heldEdit: Tool[] | null | undefined = undefined
  /** The last read was kept as the board fading in, see [`Run.take`]. */
  private fadeKept = false
  /** The run's lines for the stored read (a held list it changed). */
  private notes: string[] = []
  /** The run changed `tools` or `theme`, see [`Run.takeToolsChanged`]. */
  private toolsChanged = false
  /** `theme` was set (scroll or panel) after the last board read: a new run
   * keeps it, see [`Run.take`]. */
  private themeFresh = false
  /** The last model of a patrol, manage or Sewer Ratway cell pick screen,
   * corrections included: what an instrument or treasure pick covers. */
  private board: Model | null = null
  /** The board since the last manage screen, with the cells and the warden
   * of any Consume target screen read after it (earlier bites locked): what
   * a treasure pick after a consume covers, see [`vaultedOf`]. Null after a
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
  /** The meal picked on the last Consume target screen since the last
   * patrol, manage or cell pick screen: what a treasure pick covers, see
   * [`vaultedOf`]. */
  private meal: Meal | null = null
  /** Per low-confidence cell warning (see [`steadyKey`]), the reads in a
   * row up to the stored one that gave it. */
  private steady = new Map<string, number>()
  /** The last read was held as a changed board: the next one is taken
   * whatever it shows. */
  private confirming = false
  /** A read was held and waits for one more, see [`Run.wantsReread`]. */
  private reread = false
  /** The time of the last reading, so the readings' times never stand
   * still: the clock has milliseconds, the Rust's has nanoseconds. */
  private lastStamp: Date | null = null

  /** `days` is the days count the held `tools` were saved at: a higher
   * count read twice is a new run and clears them. */
  constructor(tools: Tool[], theme: number | null, days: number | null) {
    this.tools = [...tools]
    this.theme = theme
    this.days.left = days
  }

  /** The days until Riot in use: null until a first read and after a run's
   * end. */
  daysLeft(): number | null {
    return this.days.left
  }

  /** True once after the run changed the held instruments or the theme
   * itself (the scroll, a new run, an advised pick, the run's end), so the
   * UI saves them. */
  takeToolsChanged(): boolean {
    const out = this.toolsChanged
    this.toolsChanged = false
    return out
  }

  /** True once after a read was held: the session reads the game again. */
  wantsReread(): boolean {
    const out = this.reread
    this.reread = false
    return out
  }

  /** Sets the held instruments (the panel shows only icons) and rebuilds;
   * the lines about the run's own changes to them go. */
  setTools(tools: Tool[], hooks: RunHooks): void {
    this.tools = [...tools]
    this.heldEdit = this.stored === null ? null : (this.stored.panels.held ?? null)
    this.notes = []
    if (this.reading !== null && this.reading.screen === 'instrumentPick') {
      this.advisedTool = null
      this.pickNamed = true
    }
    if (this.stored !== null) this.rebuild(hooks)
  }

  /** Sets the run's theme (the scroll was missed or misread); the session
   * re-solves. */
  setTheme(theme: number | null): void {
    this.theme = theme
    this.themeFresh = true
  }

  /** Instals a read of a frame: what it means for the run. When the read
   * gives the scene on show again (the same model with the current
   * corrections, screen and days), only the read time and warnings change:
   * the corrections and the running solve stay. Otherwise the corrections
   * go and the session solves. A game dialog, a frame without the board
   * (see [`@/reader/panels::offBoard`]) or a frame of a window narrower
   * than 16:9 (see [`shapeKept`]) keeps the last reading and its solve on
   * show, with a line that says so. The riot screen ends the run, see
   * [`Run.endRun`]. Until the next run starts (a days counter reading at
   * least one under the run's length, or an instrument pick with the
   * counter hidden), a read is kept with [`RUN_OVER_WAIT`]. On the run's
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
   * A live frame (one captured from the game) whose board differs from the
   * last read's on the same screen and day is held, with no line on show,
   * and the next read is taken whatever it shows: a blip that shows the
   * old board again keeps the corrections and the running solve. */
  take(scene: Scene, panels: Panels, size: [number, number], live: boolean, hooks: RunHooks): Taken {
    const confirming = this.confirming
    this.confirming = false
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
      this.onScreen = false
      return { kind: 'kept', line: warningText(kept), saveFrame: kept.keep !== 'offBoard' }
    }
    if (panels.screen === 'runEnd') {
      this.endRun(hooks)
      return { kind: 'skipped' }
    }
    // Between runs only a run start is taken: the screens players stay on
    // after the riot (chest rooms and such) read as junk boards.
    const startsRun =
      (panels.days !== null && panels.days >= RUN_DAYS - 1) || (panels.screen === 'instrumentPick' && panels.days === null)
    if (this.runOver !== null && !startsRun) {
      this.missed = RUN_OVER_WAIT
      this.onScreen = false
      return { kind: 'kept', line: RUN_OVER_WAIT, saveFrame: false }
    }
    // The riot screen missed: a board with a hidden counter on the last day,
    // far from the board on show, is a screen after the run.
    const r = this.reading
    if (this.days.left === 0 && panels.days === null && afterRunRead(panels.screen) && r !== null) {
      const model = toModel(scene, panels, this.tools, null, this.runDays())[0]
      const len = Math.min(model.cells.length, r.model.cells.length)
      let differ = 0
      for (let k = 0; k < len; k++) {
        const a = cellSight(model.cells[k])
        const b = cellSight(r.model.cells[k])
        if (a[0] !== b[0] || a[1] !== b[1] || a[2] !== b[2]) differ += 1
      }
      if (differ >= AFTER_RUN_CELLS) {
        this.endRun(hooks)
        return { kind: 'skipped' }
      }
    }
    // One read in about ten same-screen board changes is a blip that shows
    // the old board again within a second: a live read that changes the
    // board is held until one more read confirms it.
    const last = this.stored
    if (
      live &&
      !confirming &&
      blipRead(panels.screen) &&
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
        this.onScreen = false
        return { kind: 'kept', line: CHANGED, saveFrame: true }
      }
    }
    this.runOver = null
    if (this.reading !== null && this.reading.screen === 'chainTarget') {
      this.meal = hooks.advisedMeal()
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
    if (newRun) hooks.logNewRun()
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
    // player set it while the panel read the same and the run has not
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
    const over = this.stored
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
    } else if (decisionScreen(panels.screen)) {
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
    this.stored = { scene: nextScene, panels: nextPanels, at: this.stamp() }
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
        this.missed = null
        return { kind: 'installed' }
      }
    }
    this.toolsChanged = this.toolsChanged || heldChanged
    this.notes = notes
    this.edits.clear()
    this.markers.clear()
    this.rebuild(hooks)
    this.missed = null
    return { kind: 'installed' }
  }

  /** The model again from the stored read, the tools and the edits; then
   * the session solves. */
  rebuild(hooks: RunHooks): void {
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
    if (boardRead(reading.screen)) {
      this.board = cloneModel(reading.model)
      this.chained = false
      this.meal = null
    }
    if (reading.screen === 'cellPick' && prey) {
      // nothing
    } else if (boardRead(reading.screen) && reading.screen !== 'manage') {
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
      if (this.stored !== null) {
        const cells = jawed(this.stored.scene).filter((n) => unedited(n))
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
    if (boardRead(reading.screen)) {
      const seen = this.preySeen
      this.preySeen = preyCells(reading.model).map((x) => {
        const found = seen.find(([c, d]) => c === x && d <= day)
        return found === undefined ? ([x, day] as [number, number]) : found
      })
    }
    this.reading = reading
    hooks.solve()
  }

  /** The days the run lasts: Iron Law extends it. */
  private runDays(): number {
    return this.theme === IRON_LAW ? ironLawDays() : RUN_DAYS
  }

  /** The reading of the stored read with the tools and the edits. */
  private build(): Reading | null {
    const stored = this.stored
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
  private endRun(hooks: RunHooks): void {
    if (this.runOver !== null) return
    const vaulted = this.vaultTop === null ? null : this.vaultTop[1].length
    this.runOver =
      vaulted === null
        ? 'The run is over.'
        : vaulted === 1
          ? 'The run is over: 1 Chromatic Prisoner vaulted.'
          : `The run is over: ${vaulted} Chromatic Prisoners vaulted.`
    hooks.logRunEnd(vaulted)
    hooks.solveDropped()
    this.reading = null
    this.missed = null
    this.stored = null
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
