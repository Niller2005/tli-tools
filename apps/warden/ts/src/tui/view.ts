// The data behind Warden's terminal screen.
//
// The capture loop, the session and the screen all speak in terms of these plain values. There is
// no terminal code here, so the advice and the board can be checked without opening a terminal.

import type { Session } from '@/app/session'
import type { CellModel, EventMark, Model } from '@/board/board'
import type { Action } from '@/engine/actions'
import { beastIndex, data, type Beast } from '@/engine/data'
import { cellLabel, tierName } from '@/engine/text'
import { fixed } from '@/format'
import type { Advice } from '@/solver/advise'
import { alsoGood } from '@/solver/advise'
import type { SolveOption } from '@/solver/solve'

/** The advice and the playouts behind it. */
export interface MoveView {
  /** the move to make */
  action: Action
  /** the move in words */
  label: string
  /** why the move is made */
  why: string
  /** the row of the ranking, when it has one */
  option: number | null
}

/** A cell of the ring, in the words the screen shows. */
export interface CellView {
  /** the cell's number and its marks */
  top: string
  /** what the cell holds */
  body: string
  /** whether this is the cell the advice points at */
  advised: boolean
  /** whether this is the warden's cell */
  warden: boolean
  /** whether the cell has a warning */
  warned: boolean
  /** whether this move is nearly as good as the advice */
  near: boolean
}

/** One row of the ring. */
export interface RingView {
  /** the cells, from left to right */
  cells: CellView[]
  /** whether this row is the bottom of the ring */
  bottom: boolean
}

/** The state the terminal screen shows. */
export interface ViewState {
  /** the note about the game window */
  captureNote: string
  /** the run-over message, when the run is over */
  runOver: string | null
  /** whether the board is being read */
  reading: boolean
  /** why the board cannot be read, when it cannot */
  ocrProblem: string | null
  /** why there is no board on show, when there is none */
  missed: string | null
  /** the board read */
  model: Model | null
  /** the problems the solver found in the board */
  problems: string[]
  /** the warnings of the read that do not point at a cell */
  warnings: string[]
  /** the warnings that point at a cell */
  cellWarnings: string[]
  /** the routine notes of the read */
  notes: string[]
  /** the notes kept over the read */
  keptLines: string[]
  /** the day and objective line */
  day: string | null
  /** the advice, when there is one */
  advice: MoveView | null
  /** whether the solver is still playing the board out */
  solving: boolean
  /** the rounds the solver has played */
  rounds: number
  /** the rounds the solver will play */
  rollouts: number
  /** the ranking */
  ranking: RankingRow[]
  /** the rows of the ring */
  ring: RingView[]
}

/** The state before the first read. */
export function freshView(captureNote = ''): ViewState {
  return {
    captureNote,
    runOver: null,
    reading: false,
    ocrProblem: null,
    missed: null,
    model: null,
    problems: [],
    warnings: [],
    cellWarnings: [],
    notes: [],
    keptLines: [],
    day: null,
    advice: null,
    solving: false,
    rounds: 0,
    rollouts: 0,
    ranking: [],
    ring: [],
  }
}

/** The name of a move, in the words the screen uses. */
export function moveName(action: Action, label: string): string {
  const short = label.split(' (')[0]
  switch (action.type) {
    case 'devour':
      return `Consume ${cellLabel(action.to)}`
    case 'swap':
      return 'Replace'
    default:
      return short
  }
}

/** The cell a move points at, when it points at one. */
export function actionCell(action: Action, warden: number): number | null {
  switch (action.type) {
    case 'patrol':
      return action.cell
    case 'devour':
      return action.to
    case 'chain':
      return action.to
    case 'choose':
      return typeof action.id === 'number' ? action.id : null
    case 'swap':
      return warden >= 0 ? warden : null
    default:
      return null
  }
}

/** What a cell holds in a few letters: "Rar Wolf", "locked", "empty". */
export function shortCell(cell: CellModel): string {
  const d = data()
  const beast = (b: Beast): string => {
    const words = d.beastNames[beastIndex(b)].split(/\s+/)
    return words[words.length - 1] ?? ''
  }
  const tier = (t: number): string => [...tierName(t)].slice(0, 3).join('')
  const mark = (e: EventMark | null): string => (e !== null ? '!' : '')
  switch (cell.kind) {
    case 'office':
      return 'Room'
    case 'sealed':
      return `locked${mark(cell.event)}`
    case 'empty':
      return `empty${mark(cell.event)}`
    case 'inmate':
      return `${tier(cell.tier)} ${beast(cell.beast)}${mark(cell.event)}`
    case 'nest':
      return cell.due !== null ? `nest ${cell.due}d` : 'nest 1d'
    case 'scouted':
      return `(${tier(cell.tier)} ${beast(cell.beast)}${mark(cell.event)}`
    case 'scratch':
      return `lock ${tier(cell.tier)}${mark(cell.event)}`
  }
}

/** Column and row of model cell `n` on the screen's 6x4 ring, clockwise from the Interrogation Room. */
export function ringPosition(n: number): [number, number] {
  if (n <= 5) return [n, 0]
  if (n === 6 || n === 7) return [5, n - 5]
  if (n <= 13) return [13 - n, 3]
  return [0, 16 - n]
}

/** The four rows of the board, with the advice and its near misses marked. */
export function ringRows(
  model: Model,
  advice: MoveView | null,
  ranking: SolveOption[],
  warned: number[] = [],
): RingView[] {
  const pick = advice === null ? null : actionCell(advice.action, model.warden)
  const near: number[] =
    advice === null
      ? []
      : alsoGood(ranking, advice.option)
          .map((k) => actionCell(ranking[k].action, model.warden))
          .filter((c): c is number => c !== null && c !== pick)
  const rows: RingView[] = Array.from({ length: 4 }, (_, row) => ({
    bottom: row === 3,
    cells: Array.from({ length: 6 }, () => ({
      top: '',
      body: '',
      advised: false,
      warden: false,
      warned: false,
      near: false,
    })),
  }))
  model.cells.slice(0, 16).forEach((cell, n) => {
    const [col, row] = ringPosition(n)
    let top = ''
    if (model.warden === n) top += '@'
    top += cellLabel(n)
    if (near.includes(n)) top += '~'
    if (warned.includes(n)) top += '?'
    const target = rows[row]?.cells[col]
    if (target === undefined) return
    target.top = top
    target.body = shortCell(cell)
    target.advised = pick === n
    target.warden = model.warden === n
    target.warned = warned.includes(n)
  })
  return rows
}

/** The day, objective and last-reading line of a board. */
export function dayLine(model: Model, daysLeft: number | null, kept: boolean): string {
  let day = daysLeft !== null ? `Day ${model.day} · ${daysLeft} to Riot` : `Day ${model.day} · Riot not read`
  if (kept) day += ' · last reading'
  if (model.objective !== null) {
    const objective = data().objective(model.objective.id)
    if (objective !== null) {
      const name = objective.name.replace(/^(Objective: )+/, '')
      const progress = model.objective.progress >= objective.target ? 'done' : `${model.objective.progress}/${objective.target}`
      day += ` · ${name} ${progress}`
    }
  }
  return day
}

/** The advice as the view shows it. */
export function adviceView(advice: Advice | null): MoveView | null {
  if (advice === null) return null
  return {
    action: advice.action,
    label: advice.label,
    why: advice.why,
    option: advice.option,
  }
}

/** The state the screen shows for the session as it stands. */
export function stateFromSession(session: Session, captureNote: string, ocrProblem: string | null): ViewState {
  const reading = session.reading
  const advice = session.advice()
  const move = adviceView(advice)
  if (move !== null && advice !== null) move.why = session.whyShown(advice)
  const keptLines = reading?.keptLines() ?? []
  const warned = reading?.warnings.flatMap((warning) => (warning.cell !== null ? [warning.cell] : [])) ?? []
  return {
    captureNote,
    runOver: session.runOver,
    reading: session.scanning(),
    ocrProblem,
    missed: session.missed,
    model: reading?.model ?? null,
    problems: session.problems,
    warnings: reading?.warnings.filter((warning) => warning.cell === null && warning.kind !== 'note').map((warning) => warning.text) ?? [],
    cellWarnings: reading?.warnings.filter((warning) => warning.cell !== null).map((warning) => warning.text) ?? [],
    notes: reading?.warnings.filter((warning) => warning.kind === 'note').map((warning) => warning.text) ?? [],
    keptLines,
    day: reading === null ? null : dayLine(reading.model, reading.daysLeft, keptLines.length > 0),
    advice: move,
    solving: session.solving,
    rounds: session.rounds,
    rollouts: session.rollouts,
    ranking: rankingRows(session.ranking, move?.option ?? null),
    ring: reading === null ? [] : ringRows(reading.model, move, session.ranking, warned),
  }
}

/** The screen as plain text, for the one-image command. */
export function plainScreen(state: ViewState): string[] {
  const lines = ['Warden  Tartarus prison board, Linux terminal', `game: ${state.captureNote}`, '']
  if (state.runOver !== null) {
    lines.push(state.runOver)
    return lines
  }
  if (state.model === null) {
    lines.push(state.reading ? 'Reading the board…' : 'No board read yet.')
    if (!state.reading && state.ocrProblem !== null) lines.push(state.ocrProblem)
    if (state.missed !== null) lines.push(state.missed)
    return lines
  }
  for (const issue of state.problems) lines.push(issue)
  for (const warning of state.warnings) lines.push(warning)
  if (state.day !== null) lines.push(state.day)
  for (const kept of state.keptLines) lines.push(kept)
  lines.push('')
  if (state.advice !== null) {
    lines.push('NEXT MOVE')
    lines.push(`  ${moveName(state.advice.action, state.advice.label)}`)
    if (state.advice.why !== null) lines.push(`  ${state.advice.why}`)
  } else if (state.solving) {
    lines.push('Solving…')
  }
  lines.push('')
  for (const row of state.ring) {
    lines.push(row.cells.map((cell) => cell.top.padEnd(12)).join(' '))
    lines.push(row.cells.map((cell) => cell.body.padEnd(12)).join(' '))
    lines.push('')
  }
  for (const warning of state.cellWarnings) lines.push(`? ${warning}`)
  if (state.ranking.length > 0) {
    lines.push('Moves by Riot loot per run (Chromatic 1, Ultimate 0.2, Legendary 0.05)')
    for (const row of state.ranking) lines.push(`  ${String(row.rank).padStart(2)}  ${row.mean}  ${row.label}`)
  }
  for (const note of state.notes) lines.push(note)
  return lines
}

/** A ranking row as the screen shows it. */
export interface RankingRow {
  /** the one-based row number */
  rank: number
  /** the mean Riot loot per run */
  mean: string
  /** the move */
  label: string
  /** whether this is the advice */
  chosen: boolean
}

/** The rows of the move ranking. */
export function rankingRows(ranking: SolveOption[], advised: number | null): RankingRow[] {
  const shown: number[] = []
  for (let k = 0; k < Math.min(ranking.length, 5); k += 1) shown.push(k)
  if (advised !== null && advised >= 5) shown[4] = advised
  return shown.map((k) => {
    const option = ranking[k]
    if (option === undefined) throw new Error(`the move ${k + 1} is missing`)
    return {
      rank: k + 1,
      mean: fixed(option.mean, 2).padStart(5),
      label: moveName(option.action, option.label),
      chosen: advised === k,
    }
  })
}
