//! The board model: what a player can see of a run (every cell, the warden,
//! today's doors, the instruments, the vault), and `buildState`, which turns
//! it into an engine state the solver can play from. A port of js/analyze.js
//! (blankModel, normalize, buildState).

import {
  BEAST_KEYS,
  CARD_KEYS,
  GIFT_KEYS,
  RAINBOW,
  data,
  toolFromKey,
  type Beast,
  type Tool,
} from '@/engine/data'
import { HUNT_NEEDS, canEat, huntTargets } from '@/engine/devour'
import { CHAIN_REACTION, EXECUTION_EFFICIENCY, SEWER_RATWAY } from '@/engine/incidents'
import { newGameWith, stepsBetween } from '@/engine/rules'
import {
  Params,
  blankCell,
  defaultParams,
  type Cell,
  type EventRef,
  type Inmate,
  type ObjectiveState,
  type Pending,
  type PreyLink,
  type State,
  type ToolReason,
  type Used,
  type VaultEntry,
} from '@/engine/state'
import { cellLabel } from '@/engine/text'
import { Rng32 } from '@/solver/mod'

/** Cells hold Normal to Ultimate: Chromatics leave for the vault. */
export const TOP_TIER = RAINBOW - 1

/** The step of the run the board was read on. */
export type Step = 'patrol' | 'manage' | 'event' | 'choice'

/** The incident behind a marker: "unknown" when the player sees the marker
 * but not its kind. */
export type EventMark = 'execution' | 'chain' | 'unknown'

/** A Lion's prey mark: the marked cell and the rounds left. */
export interface PreyMark {
  /** null when the saved value is not an integer (no cell). */
  cell: number | null
  rounds: number
}

/** One cell as the player sees it. Tiers and due days are kept as entered
 * and clamped by `buildState`. */
export type CellModel =
  | { kind: 'office' }
  | { kind: 'sealed'; event: EventMark | null }
  /** An open cell can hold a marker an incident put there. */
  | { kind: 'empty'; event: EventMark | null }
  | {
      kind: 'inmate'
      beast: Beast
      tier: number
      ivory: boolean
      prey: PreyMark | null
      event: EventMark | null
    }
  /** null: due tomorrow. */
  | { kind: 'nest'; due: number | null }
  | { kind: 'scouted'; beast: Beast; tier: number; event: EventMark | null }
  | { kind: 'scratch'; tier: number; event: EventMark | null }

/** The cell's incident marker, if any. */
export function cellEvent(c: CellModel): EventMark | null {
  switch (c.kind) {
    case 'sealed':
    case 'empty':
    case 'scouted':
    case 'scratch':
      return c.event
    case 'inmate':
      return c.event
    case 'office':
    case 'nest':
      return null
  }
}

/** Whether the cell's inmate carries the Tusk. */
export function cellIvory(c: CellModel): boolean {
  return c.kind === 'inmate' && c.ivory
}

/** What a choice offers. */
export type ChoiceKind = 'tool' | 'gift' | 'cell' | 'interrogation' | 'prey'

/** A choice the player makes. */
export class Choice {
  kind: ChoiceKind
  options: Tool[]
  /** The re-rolls left this run, as an instrument pick shows them
   * ("Remaining attempts N"); 0 when it shows no Re-roll button. */
  rerolls: number

  constructor(init: { kind: ChoiceKind; options: Tool[]; rerolls?: number }) {
    this.kind = init.kind
    this.options = [...init.options]
    this.rerolls = init.rerolls ?? 0
  }

  /** The JSON shape of serde's Choice: the re-rolls stay out when 0. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = { kind: this.kind, options: this.options }
    if (this.rerolls !== 0) out.rerolls = this.rerolls
    return out
  }
}

/** The run's objective: its data id and the progress shown on the panel.
 * Completion follows from the data target (1 for a rating objective). */
export interface ObjectiveModel {
  id: number
  progress: number
}

/** The kind of the incident in the warden's cell on the event step. */
export type EventKindModel = 'execution' | 'chain'

/** The analyzer's board model. Reading it goes through `normalizeModel`, so
 * missing or malformed fields take the blank model's values. */
export class Model {
  v: number
  day: number
  maxDays: number
  step: Step
  warden: number
  dest: number[]
  devourUsed: boolean
  swapUsed: boolean
  huntUsed: boolean
  eventKind: EventKindModel
  choice: Choice
  chainArmed: boolean
  tools: Tool[]
  vault: Beast[]
  cells: CellModel[]
  /** The run's objective, when the player has read it off the objective panel. */
  objective: ObjectiveModel | null

  constructor(init: {
    v: number
    day: number
    maxDays: number
    step: Step
    warden: number
    dest: number[]
    devourUsed: boolean
    swapUsed: boolean
    huntUsed: boolean
    eventKind: EventKindModel
    choice: Choice
    chainArmed: boolean
    tools: Tool[]
    vault: Beast[]
    cells: CellModel[]
    objective?: ObjectiveModel | null
  }) {
    this.v = init.v
    this.day = init.day
    this.maxDays = init.maxDays
    this.step = init.step
    this.warden = init.warden
    this.dest = [...init.dest]
    this.devourUsed = init.devourUsed
    this.swapUsed = init.swapUsed
    this.huntUsed = init.huntUsed
    this.eventKind = init.eventKind
    this.choice = init.choice
    this.chainArmed = init.chainArmed
    this.tools = [...init.tools]
    this.vault = [...init.vault]
    this.cells = [...init.cells]
    this.objective = init.objective ?? null
  }

  /** The JSON shape of serde's Model: the objective stays out when it is
   * none. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      v: this.v,
      day: this.day,
      maxDays: this.maxDays,
      step: this.step,
      warden: this.warden,
      dest: this.dest,
      devourUsed: this.devourUsed,
      swapUsed: this.swapUsed,
      huntUsed: this.huntUsed,
      eventKind: this.eventKind,
      choice: this.choice,
      chainArmed: this.chainArmed,
      tools: this.tools,
      vault: this.vault,
      cells: this.cells,
    }
    if (this.objective !== null) out.objective = this.objective
    return out
  }
}

/** A copy of the cell, its prey mark included. */
export function cloneCell(c: CellModel): CellModel {
  if (c.kind === 'inmate' && c.prey !== null) return { ...c, prey: { ...c.prey } }
  return { ...c }
}

/** A copy of the model: its cells and lists are copied, so a change to one
 * does not touch the other. */
export function cloneModel(m: Model): Model {
  return new Model({
    v: m.v,
    day: m.day,
    maxDays: m.maxDays,
    step: m.step,
    warden: m.warden,
    dest: [...m.dest],
    devourUsed: m.devourUsed,
    swapUsed: m.swapUsed,
    huntUsed: m.huntUsed,
    eventKind: m.eventKind,
    choice: new Choice({ kind: m.choice.kind, options: [...m.choice.options], rerolls: m.choice.rerolls }),
    chainArmed: m.chainArmed,
    tools: [...m.tools],
    vault: [...m.vault],
    cells: m.cells.map(cloneCell),
    objective: m.objective === null ? null : { ...m.objective },
  })
}

/** Whether two models are the same: the same fields and the same cells. */
export function sameModel(a: Model, b: Model): boolean {
  if (a === b) return true
  if (a.v !== b.v || a.day !== b.day || a.maxDays !== b.maxDays || a.step !== b.step) return false
  if (a.warden !== b.warden || a.devourUsed !== b.devourUsed || a.swapUsed !== b.swapUsed) return false
  if (a.huntUsed !== b.huntUsed || a.eventKind !== b.eventKind || a.chainArmed !== b.chainArmed) return false
  if (a.dest.length !== b.dest.length || a.tools.length !== b.tools.length) return false
  if (a.vault.length !== b.vault.length || a.cells.length !== b.cells.length) return false
  for (let k = 0; k < a.dest.length; k++) if (a.dest[k] !== b.dest[k]) return false
  for (let k = 0; k < a.tools.length; k++) if (a.tools[k] !== b.tools[k]) return false
  for (let k = 0; k < a.vault.length; k++) if (a.vault[k] !== b.vault[k]) return false
  for (let k = 0; k < a.cells.length; k++) if (!sameCell(a.cells[k], b.cells[k])) return false
  if (a.choice.kind !== b.choice.kind || a.choice.rerolls !== b.choice.rerolls) return false
  if (a.choice.options.length !== b.choice.options.length) return false
  for (let k = 0; k < a.choice.options.length; k++) if (a.choice.options[k] !== b.choice.options[k]) return false
  if ((a.objective === null) !== (b.objective === null)) return false
  if (a.objective !== null && b.objective !== null) {
    if (a.objective.id !== b.objective.id || a.objective.progress !== b.objective.progress) return false
  }
  return true
}

/** Whether two cells are the same. */
export function sameCell(a: CellModel, b: CellModel): boolean {
  if (a.kind !== b.kind) return false
  switch (a.kind) {
    case 'office':
      return true
    case 'sealed':
    case 'empty':
      return a.event === (b as Extract<CellModel, { kind: 'sealed' }>).event
    case 'inmate': {
      const o = b as Extract<CellModel, { kind: 'inmate' }>
      if (a.beast !== o.beast || a.tier !== o.tier || a.ivory !== o.ivory || a.event !== o.event) return false
      const pa = a.prey
      const pb = o.prey
      if ((pa === null) !== (pb === null)) return false
      if (pa !== null && pb !== null && (pa.cell !== pb.cell || pa.rounds !== pb.rounds)) return false
      return true
    }
    case 'nest':
      return a.due === (b as Extract<CellModel, { kind: 'nest' }>).due
    case 'scouted': {
      const o = b as Extract<CellModel, { kind: 'scouted' }>
      return a.beast === o.beast && a.tier === o.tier && a.event === o.event
    }
    case 'scratch': {
      const o = b as Extract<CellModel, { kind: 'scratch' }>
      return a.tier === o.tier && a.event === o.event
    }
  }
}

/** blankModel: day 1 in the office, every cell sealed. */
export function blankModel(): Model {
  const d = data()
  return new Model({
    v: 1,
    day: 1,
    maxDays: defaultParams().drillDays,
    step: 'patrol',
    warden: d.room,
    dest: [],
    devourUsed: false,
    swapUsed: false,
    huntUsed: false,
    eventKind: 'chain',
    choice: new Choice({ kind: 'tool', options: [], rerolls: 0 }),
    chainArmed: false,
    tools: [],
    vault: [],
    cells: Array.from({ length: d.cellCount }, (_, n) =>
      n === d.room ? ({ kind: 'office' } as CellModel) : ({ kind: 'sealed', event: null } as CellModel),
    ),
    objective: null,
  })
}

/** JS Number(v) for JSON values; NaN for what it can't read. */
function jsNumber(v: unknown): number {
  if (v === null || v === undefined) return 0
  if (typeof v === 'boolean') return v ? 1 : 0
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    const s = v.trim()
    if (s === '') return 0
    return parseRustFloat(s)
  }
  return NaN
}

/** Rust's `f64::from_str`: a decimal, an exponent, "inf" or "nan"; no hex and
 * no other spellings. */
function parseRustFloat(s: string): number {
  if (/^[+-]?(inf|infinity)$/i.test(s)) return s.startsWith('-') ? -Infinity : Infinity
  if (/^[+-]?nan$/i.test(s)) return NaN
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return NaN
  return Number(s)
}

/** toInt: a number or numeric string, rounded half up as Math.round; the
 * fallback for anything else or a missing value. */
function toInt(v: unknown, fallback: number): number {
  const x = v === undefined ? NaN : jsNumber(v)
  if (!Number.isFinite(x)) return fallback
  const f = Math.floor(x)
  return x - f >= 0.5 ? f + 1 : f
}

/** A JSON number that is an integer (Number.isInteger). */
function integer(v: unknown): number | null {
  if (typeof v !== 'number') return null
  if (!Number.isFinite(v) || !Number.isInteger(v)) return null
  return toI64(v)
}

/** Rust's `as i64`: the value saturates at the ends of the range. */
function toI64(x: number): number {
  if (x >= 9223372036854775807) return 9223372036854775807
  if (x <= -9223372036854775808) return -9223372036854775808
  return Math.trunc(x)
}

/** Rust's `as u32`: the value saturates at the ends of the range. */
function toU32(x: number): number {
  if (x >= 4294967295) return 4294967295
  if (x <= 0) return 0
  return Math.trunc(x)
}

function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  return v.filter((x): x is string => typeof x === 'string')
}

function eventMark(v: unknown): EventMark | null {
  if (!v) return null
  if (typeof v === 'string') {
    if (v === 'execution') return 'execution'
    if (v === 'unknown') return 'unknown'
  }
  return 'chain'
}

function beast(v: unknown): Beast {
  if (typeof v === 'string' && (BEAST_KEYS as readonly string[]).includes(v)) return v as Beast
  return 'mammoth'
}

/** A member of an object, or undefined when it is not one. */
function field(v: unknown, key: string): unknown {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return undefined
  return (v as Record<string, unknown>)[key]
}

function record(v: unknown): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return {}
  return v as Record<string, unknown>
}

function cellModel(c: unknown): CellModel {
  const o = record(c)
  const tier = toInt(o['tier'], 0)
  const event = eventMark(o['event'])
  switch (o['kind']) {
    case 'empty':
      return { kind: 'empty', event }
    case 'inmate': {
      const preyRaw = o['prey']
      return {
        kind: 'inmate',
        beast: beast(o['beast']),
        tier,
        ivory: !!o['ivory'],
        prey: !!preyRaw
          ? { cell: integer(field(preyRaw, 'cell')), rounds: toInt(field(preyRaw, 'rounds'), 1) }
          : null,
        event,
      }
    }
    case 'nest': {
      const dueRaw = o['due']
      const due = dueRaw === undefined ? null : Number.isFinite(jsNumber(dueRaw)) ? toInt(dueRaw, 0) : null
      return { kind: 'nest', due }
    }
    case 'scouted':
      return { kind: 'scouted', beast: beast(o['beast']), tier, event }
    case 'scratch':
      return { kind: 'scratch', tier, event }
    // Sealed, or a kind the analyzer does not know: a sealed door.
    default:
      return { kind: 'sealed', event }
  }
}

/** normalize: the blank model with whatever `v` sets; a cells list of the
 * wrong length gives the blank model. */
export function normalizeModel(v: unknown): Model {
  const d = data()
  const m = blankModel()
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return m
  const o = v as Record<string, unknown>
  const cells = Array.isArray(o['cells']) ? (o['cells'] as unknown[]) : null
  if (cells === null || cells.length !== d.cellCount) return m
  if (o['day'] !== undefined) m.day = toInt(o['day'], 1)
  if (o['maxDays'] !== undefined) m.maxDays = toInt(o['maxDays'], 20)
  if (o['warden'] !== undefined) m.warden = toInt(o['warden'], 0)
  switch (o['step']) {
    case 'manage':
      m.step = 'manage'
      break
    case 'event':
      m.step = 'event'
      break
    case 'choice':
      m.step = 'choice'
      break
    default:
      m.step = 'patrol'
      break
  }
  // Negative doors pass the JS filter; they are dropped here.
  m.dest = []
  const destRaw = Array.isArray(o['dest']) ? (o['dest'] as unknown[]) : []
  for (const d0 of destRaw) {
    const n = integer(d0)
    if (n === null) continue
    if (n < 0 || n >= d.cellCount) continue
    m.dest.push(n)
  }
  m.devourUsed = !!o['devourUsed']
  m.swapUsed = !!o['swapUsed']
  m.huntUsed = !!o['huntUsed']
  if (o['eventKind'] === 'execution') m.eventKind = 'execution'
  const choice = record(o['choice'])
  if (typeof o['choice'] === 'object' && o['choice'] !== null && !Array.isArray(o['choice'])) {
    switch (choice['kind']) {
      case 'gift':
        m.choice.kind = 'gift'
        break
      case 'cell':
        m.choice.kind = 'cell'
        break
      case 'prey':
        m.choice.kind = 'prey'
        break
      case 'interrogation':
        m.choice.kind = 'interrogation'
        break
      default:
        break
    }
    m.choice.options = strings(choice['options'])
      .map((key) => toolFromKey(key))
      .filter((t): t is Tool => t !== null)
    m.choice.rerolls = toInt(choice['rerolls'], 0)
  }
  m.chainArmed = !!o['chainArmed']
  m.tools = strings(o['tools'])
    .map((key) => toolFromKey(key))
    .filter((t): t is Tool => t !== null)
  const vaultRaw = Array.isArray(o['vault']) ? (o['vault'] as unknown[]) : []
  m.vault = vaultRaw.filter((b): b is Beast => typeof b === 'string' && (BEAST_KEYS as readonly string[]).includes(b))
  const goal = record(o['objective'])
  if (typeof o['objective'] === 'object' && o['objective'] !== null && !Array.isArray(o['objective'])) {
    const id = integer(goal['id'])
    if (id !== null && id >= 0) {
      m.objective = { id: toU32(id), progress: toU32(toInt(goal['progress'], 0)) }
    }
  }
  m.cells = cells.map((c, n) => (n === d.room ? ({ kind: 'office' } as CellModel) : cellModel(c)))
  return m
}

/** The model of a JSON board (the Rust `Model`'s `from` implementation). */
export function modelFromJson(v: unknown): Model {
  return normalizeModel(v)
}

/** cellLabel for a prey mark's cell, "NaN" for one that is not an integer. */
function label(n: number | null): string {
  if (n === null) return 'NaN'
  return String(n + 1).padStart(2, '0')
}

function make(st: State, beast: Beast, tier: number): Inmate {
  const id = st.nextId
  st.nextId += 1
  return { id, beast, tier: Math.min(Math.max(tier, 0), TOP_TIER) }
}

/** buildState: the engine state for a model, and anything that stops it from
 * being analyzed. `seed` stands in for the JS Math.random: the state's dice,
 * then a scratch door's beast, in cell order. An incident the player can't
 * name keeps a kind the solver re-rolls. */
export function buildState(m: Model, seed: number): [State, string[]] {
  const d = data()
  const problems: string[] = []
  const random = new Rng32(seed)
  const drillDays = Math.min(Math.max(m.maxDays, 5), 60)
  // Logged Replaces holding the Severed Iron Maiden never rose (none of the
  // about 10 its rule predicted), so a read board gives it no rise.
  const st = newGameWith('ANALYZER', new Params({ drillDays, maiden: false }))
  st.rng = (random.roll() * 4294967296) >>> 0
  // The objective comes from the model when the player read it; the board
  // shows no theme, so the run's own draw would add one.
  st.objective = null
  if (m.objective !== null) {
    const o = d.objective(m.objective.id)
    if (o === null) {
      problems.push(`There is no objective with id ${m.objective.id}.`)
    } else {
      const progress = Math.min(m.objective.progress, o.target)
      const objective: ObjectiveState = { id: m.objective.id, progress, done: progress >= o.target }
      st.objective = objective
    }
  }
  st.theme = null
  st.day = Math.min(Math.max(m.day, 1), st.maxDays)
  st.nextId = 1
  const day = st.day
  const cells: Cell[] = []
  for (let n = 0; n < m.cells.length; n++) {
    const c = m.cells[n]
    const cell = blankCell(n)
    if (n !== d.room) {
      switch (c.kind) {
        case 'empty':
          cell.sealed = false
          setEvent(cell, c.event)
          break
        case 'inmate':
          cell.sealed = false
          cell.inmate = make(st, c.beast, c.tier)
          cell.ivory = c.ivory
          setEvent(cell, c.event)
          break
        // A nest due today hatched this morning, so a sealed one is due later.
        case 'nest':
          cell.nest = { due: Math.max(c.due ?? day + 1, day + 1) }
          break
        case 'scouted':
          cell.known = 2
          cell.hidden = make(st, c.beast, c.tier)
          setEvent(cell, c.event)
          break
        // A "?" with a rarity glow is a Scratch mark only with Filthy
        // Claws; an incident that shows the rarity behind doors draws
        // the same glow on doors a Wolf can't eat through.
        case 'scratch': {
          cell.scratch = m.tools.includes('claws')
          cell.known = 1
          const beast = BEAST_KEYS[Math.floor(random.roll() * 4)]
          cell.hidden = make(st, beast, c.tier)
          setEvent(cell, c.event)
          break
        }
        case 'sealed':
          setEvent(cell, c.event)
          break
        case 'office':
          break
      }
    }
    cells.push(cell)
  }
  st.cells = cells

  // Prey marks: a Lion and the same-rarity meal it marked.
  st.prey = []
  for (let n = 0; n < m.cells.length; n++) {
    const c = m.cells[n]
    if (c.kind !== 'inmate' || c.beast !== 'lion' || c.prey === null) continue
    const mark = c.prey
    const lion = st.cells[n].inmate
    if (lion === null) continue
    let meal: Inmate | null = null
    if (mark.cell !== null && mark.cell >= 0 && mark.cell < st.cells.length) {
      meal = st.cells[mark.cell].inmate
    }
    if (meal === null || !canEat(st, lion, meal)) {
      problems.push(
        `The prey mark from the Lion in cell ${cellLabel(n)} needs a same-rarity meal in cell ${label(mark.cell)}.`,
      )
      continue
    }
    if (
      st.prey.some(
        (l) => l.lion === meal.id || l.prey === meal.id || l.lion === lion.id || l.prey === lion.id,
      )
    ) {
      problems.push(`Cell ${label(mark.cell)} already has a prey mark.`)
      continue
    }
    const link: PreyLink = {
      lion: lion.id,
      prey: meal.id,
      preyBeast: meal.beast,
      rounds: Math.min(Math.max(mark.rounds, 1), 9),
      next: day + 1,
    }
    st.prey.push(link)
  }

  st.vault = m.vault.map((b) => makeVault(st, b))
  st.cache = st.vault.length
  st.tools = d.toolIds.filter((t) => m.tools.includes(t))
  st.position = Math.min(Math.max(m.warden, 0), d.cellCount - 1)
  st.chain = m.chainArmed
  let top: number | null = null
  for (const c of st.cells) {
    if (c.inmate === null) continue
    top = top === null ? c.inmate.tier : Math.max(top, c.inmate.tier)
  }
  st.stats.best = Math.max(top ?? 0, 0, st.vault.length === 0 ? 0 : RAINBOW)
  st.used = { swap: 0, devour: 0, hunt: 0 }
  st.destinations = []
  st.event = null
  st.pending = []
  st.phase = 'manage'

  const usedToday: Used = {
    swap: m.swapUsed ? 1 : 0,
    devour: m.devourUsed ? 1 : 0,
    hunt: m.huntUsed ? 1 : 0,
  }
  switch (m.step) {
    case 'patrol': {
      st.phase = 'patrol'
      const doors: number[] = []
      for (const n of m.dest) {
        if (n < d.cellCount && !doors.includes(n)) doors.push(n)
      }
      doors.sort((a, b) => stepsBetween(st.position, a) - stepsBetween(st.position, b))
      if (doors.length === 0) {
        problems.push(
          "Mark today's doors: tick them under \u201cSelect a Destination\u201d, or select a cell and press Today's door.",
        )
      }
      st.destinations = doors
      break
    }
    case 'event': {
      const here = st.cells[st.position]
      if (here.sealed || here.inmate === null) {
        problems.push(
          `A ${d.incidentTerm} needs the Inmate that came out of the door in the warden's cell: put the warden there and set its Inmate.`,
        )
      }
      st.phase = 'event'
      const id = m.eventKind === 'execution' ? EXECUTION_EFFICIENCY : CHAIN_REACTION
      const event: EventRef = { id, cell: st.position }
      st.event = event
      break
    }
    case 'choice': {
      st.used = usedToday
      // The JS pending has no reason or picks; Start and 1 act the same.
      let pending: Pending
      switch (m.choice.kind) {
        case 'gift':
          pending = { kind: 'gift', options: [...GIFT_KEYS], picks: 1 }
          break
        case 'cell':
          pending = {
            kind: 'cell',
            id: SEWER_RATWAY,
            options: Array.from({ length: d.cellCount }, (_, n) => n).filter((n) => n !== d.room),
          }
          break
        case 'interrogation':
          pending = { kind: 'interrogation', options: [...CARD_KEYS] }
          break
        // The pick comes before the mark: the targets as the Manage phase has them.
        case 'prey':
          pending = { kind: 'prey', options: huntTargets(st) }
          break
        case 'tool': {
          const options: Tool[] = []
          for (const t of m.choice.options) {
            if (!options.includes(t) && !st.tools.includes(t)) options.push(t)
          }
          st.rerolls = m.choice.rerolls
          pending = { kind: 'tool', options, reason: 'start' as ToolReason }
          break
        }
      }
      if (pending.options.length === 0) {
        problems.push(m.choice.kind === 'prey' ? HUNT_NEEDS : `Pick the ${d.instrumentName}s on offer.`)
      }
      st.pending = [pending]
      break
    }
    case 'manage':
      st.used = usedToday
      break
  }
  return [st, problems]
}

function setEvent(cell: Cell, event: EventMark | null): void {
  if (event !== null) cell.event = event === 'execution' ? EXECUTION_EFFICIENCY : CHAIN_REACTION
}

function makeVault(st: State, beast: Beast): VaultEntry {
  const id = st.nextId
  st.nextId += 1
  return { id, beast, day: 1 }
}
