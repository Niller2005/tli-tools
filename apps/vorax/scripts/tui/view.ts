// What the helper shows: the state of the screen, and the rows it is made of.
//
// The state is plain data and the rows are plain data too: the screen in `screen.ts` turns them
// into something that can be drawn and the report in `report.ts` prints them, so the advice can
// be looked at without a terminal.

import { LAST_ROUND } from '@/engine/game'
import type { Advice, Ranked } from '@/strategy/advisor'
import type { HelperInput, InstrumentAdvice, Row as DeepRow } from '@/web/helper'
import { type Row, num, type Tone } from '@tli/tui'

/** The board the helper read: what is on the screen, and what it says about it. */
export interface Board {
  x: HelperInput
  round: number
  phase: 'potion' | 'instrument' | 'protocol'
  /** what the reader wasn't sure of, and other things to check on screen */
  warnings: string[]
}

/** The deep check's state: the rows it has so far, and how far along it is. */
export interface DeepState {
  rows: DeepRow[]
  done: number
  total: number
  finished: boolean
  error?: string
}

/** What the screen is showing. */
export interface ViewState {
  /** what the capture says: which window, or why there is none */
  capture: string
  /** the game's log file */
  log: string
  /** how many lines of the log have been read */
  logLines: number
  /** how many pictures have been read */
  pictures: number
  /** what is happening, or what is wrong */
  status: string
  /** the score the player is playing for */
  target: number
  /** whether the deep check runs */
  deepOn: boolean
  /** the board that was read */
  board: Board | null
  /** the instant answer: this round's expected score for every play */
  quick: Advice | null
  /** the look-ahead: every option played out to the end of the run */
  ahead: Advice | null
  /** whether the look-ahead is still running */
  aheadPending: boolean
  /** the sweep tables, for an instrument pick */
  table: InstrumentAdvice | null
  /** the deep check */
  deep: DeepState | null
}

/** The scores the player can play for. */
export const TARGETS = [600_000, 700_000, 925_000, 1_120_000]

/** The state a fresh screen starts in. */
export function freshView(target: number, deepOn: boolean): ViewState {
  return {
    capture: 'looking for the game window',
    log: 'looking for the game log',
    logLines: 0,
    pictures: 0,
    status: '',
    target,
    deepOn,
    board: null,
    quick: null,
    ahead: null,
    aheadPending: false,
    table: null,
    deep: null,
  }
}

/** A big number, short: 1.12M, 900k. */
export const short = (n: number): string => (n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : `${Math.round(n / 1000)}k`)

/** The tone of a chance: green when it is close, yellow when it is a long shot, red when it is about gone. */
const pTone = (p: number): Tone => (p >= 0.6 ? 'green' : p >= 0.3 ? 'yellow' : 'red')

/** The tone of a kind of thing on the board: the common quiet, the magic calm, the rare special, the boss loud. */
const KIND: Record<string, Tone> = { normal: 'dim', magic: 'teal', rare: 'purple', supreme: 'pink', boss: 'pink' }

/** A potion, and the tanks it goes on. */
const cardMove = (x: HelperInput, r: { index: number | null; targets: number[] }): string =>
  `${r.index === null ? '?' : x.hand[r.index] ?? '?'}${r.targets.length ? ` → tank ${r.targets.map(i => i + 1).join(' + ')}` : ''}`

/** An instrument to take. */
const instrumentMove = (x: HelperInput, i: number | null): string =>
  `Take ${i === null ? '?' : x.hand[i] ?? '?'}`

/** The phase, in words. */
export const phaseName = (phase: Board['phase']): string =>
  phase === 'potion' ? 'potion' : phase === 'protocol' ? 'protocol' : 'instrument'

/** The move to play, in words, and how sure the helper is of it. */
export function recommendation(v: ViewState): { move: string; basis: string } | null {
  const b = v.board
  if (!b) return null
  const x = b.x
  const potion = b.phase === 'potion'
  const name = (r: Ranked | 'refresh' | null): string =>
    r === 'refresh'
      ? 'Refresh the hand'
      : r
        ? potion
          ? cardMove(x, r)
          : instrumentMove(x, r.index)
        : potion
          ? 'Any card'
          : 'Take any instrument'
  const top = v.deep?.rows[0]
  if (top && v.deep?.finished && !top.out) {
    const move = top.refresh
      ? 'Refresh the hand'
      : potion
        ? cardMove(x, { index: top.index, targets: top.targets })
        : instrumentMove(x, top.index)
    return { move, basis: `${Math.round(top.p * 100)}% to reach ${num(v.target)} · deep check, ${top.n} playouts` }
  }
  const a = v.ahead
  if (a) {
    const e = a.best === 'refresh' ? a.refreshEnd : a.best?.end
    return {
      move: a.allEven ? `${name(a.best)} (any is as good)` : name(a.best),
      basis: e
        ? `ends around ${short(e.activity)} · ${Math.round(e.reached * 100)}% of runs reach 950k · look-ahead`
        : a.note ?? 'look-ahead',
    }
  }
  if (b.phase === 'instrument' && v.table) {
    const t = v.table
    return {
      move: t.action === 'refresh' ? 'Refresh the offer' : instrumentMove(x, t.best ?? 0),
      basis: `${t.why} (sweep tables; looking ahead…)`,
    }
  }
  const q = v.quick
  if (q) return { move: name(q.best), basis: q.note ?? 'best for this round alone; looking ahead…' }
  return null
}

/** What the move panel says: the move, and why it is that one. */
export interface Move {
  /** the move, or the message when there is none */
  text: string
  /** how good the move is, or the message under it */
  basis: string
  /** how the text is shown */
  tone: Tone
}

/** The move the helper advises, or the message that says there is none. */
export function moveOf(v: ViewState): Move {
  const b = v.board
  if (!b) {
    return {
      text:
        v.status !== ''
          ? v.status
          : 'Open Surgical Preparation in the game. The board is read after every move.',
      basis: '',
      tone: v.status !== '' ? 'yellow' : 'dim',
    }
  }
  if (b.phase === 'protocol' || (b.phase === 'potion' && b.round > 10)) {
    return {
      text: "Protocol pick (rounds 11-13): it doesn't change your Ultimate Activity, so there is nothing to work out. Play it yourself.",
      basis: '',
      tone: 'yellow',
    }
  }
  if (b.phase === 'instrument' && b.x.instruments.length >= 3) {
    return { text: 'Already three instruments equipped: no pick needed.', basis: '', tone: 'yellow' }
  }
  const rec = recommendation(v)
  if (!rec) return { text: 'working it out…', basis: '', tone: 'dim' }
  return { text: rec.move, basis: rec.basis, tone: 'green' }
}

/** A heading and the rows under it. */
export interface Block {
  /** the heading above the rows; empty when there is none */
  heading: string
  /** the progress bar the screen draws at the end of the heading, when the block is still working */
  meter?: { fraction: number; tone: Tone }
  /** the rows */
  rows: Row[]
}

/** The options the helper worked out: the deep check, the look-ahead, or the sweep tables. */
export function optionBlocks(v: ViewState): Block[] {
  const blocks: Block[] = []
  const b = v.board
  if (!b) return blocks
  const x = b.x
  const potion = b.phase === 'potion'
  const label = (r: { index: number | null; targets: number[]; refresh?: boolean }): string =>
    r.refresh
      ? 'Refresh the hand'
      : potion
        ? cardMove(x, { index: r.index, targets: r.targets })
        : r.index === null
          ? '?'
          : x.hand[r.index] ?? '?'

  const d = v.deep
  if (d?.rows.length) {
    blocks.push({
      heading: `Chance to reach ${num(v.target)}${d.finished ? '' : ` · checking ${d.done}/${d.total}`}`,
      meter: d.finished ? undefined : { fraction: d.total > 0 ? d.done / d.total : 0, tone: 'orange' },
      rows: d.rows.slice(0, 5).map(r => ({
        cells: [
          { text: `${Math.round(r.p * 100)}%`, width: 4, align: 'right', tone: r.out ? 'dim' : pTone(r.p) },
          { text: `${label(r)}${r.out ? ' (ruled out)' : ''}`, tone: r.out ? 'dim' : 'blue' },
          { text: `avg ${short(r.mean)}`, tone: r.out ? 'dim' : 'gold', width: 10 },
        ],
      })),
    })
    return blocks
  }
  if (d?.error) {
    blocks.push({
      heading: 'Deep check failed',
      rows: [{ cells: [{ text: d.error, tone: 'red' }] }],
    })
  }
  const a = v.ahead
  if (a?.ranking.length) {
    const rows = a.ranking.slice(0, 4).map(r => ({
      text: label({ index: r.index, targets: r.targets }),
      end: r.end,
      noEffect: r.noEffect,
    }))
    if (a.refreshEnd) rows.push({ text: 'Refresh the hand', end: a.refreshEnd, noEffect: undefined })
    rows.sort((p, q) => (q.end?.activity ?? 0) - (p.end?.activity ?? 0))
    blocks.push({
      heading: 'Played to the end of the run',
      rows: rows.map(r => ({
        cells: [
          { text: r.end ? short(r.end.activity) : '-', width: 6, align: 'right', tone: r.end ? 'gold' : 'dim' },
          { text: r.end ? `${Math.round(r.end.reached * 100)}%` : '-', width: 4, align: 'right', tone: r.end ? pTone(r.end.reached) : 'dim' },
          { text: `${r.text}${r.noEffect ? ' (does nothing here)' : ''}`, tone: 'blue' },
        ],
      })),
    })
    return blocks
  }
  if (v.aheadPending) blocks.push({ heading: 'Looking ahead to the end of the run…', rows: [] })
  const q = v.quick
  if (q?.ranking.length && potion) {
    blocks.push({
      heading: 'This round only · expected Ultimate Activity after it',
      rows: q.ranking.slice(0, 5).map(r => ({
        cells: [
          { text: short(r.value), width: 6, align: 'right', tone: 'gold' },
          { text: cardMove(x, r), tone: 'blue' },
        ],
      })),
    })
  } else if (v.table) {
    blocks.push({
      heading: 'Sweep tables',
      rows: v.table.rows
        .slice()
        .sort((p, q2) => (q2.value ?? 0) - (p.value ?? 0))
        .map(r => ({
          cells: [
            { text: r.value === null ? '-' : `${Math.round(r.value * 100)}%`, width: 4, align: 'right', tone: r.value === null ? 'dim' : pTone(r.value) },
            { text: r.name, tone: 'blue' },
          ],
        })),
    })
  }
  if (v.quick?.unknown.length) {
    blocks.push({
      heading: '',
      rows: [{ cells: [{ text: `Unknown card: ${v.quick.unknown.join(', ')}`, tone: 'red' }] }],
    })
  }
  return blocks
}

/** What the board panel says: the round, what the reader wasn't sure of, and the board itself. */
export interface BoardPanel {
  /** the round and the refreshes that are left */
  heading: string
  /** how far through the run the round is, for the progress bar beside the heading */
  progress: number
  /** what the reader wasn't sure of */
  warnings: string[]
  /** the board's rows */
  rows: Row[]
}

/** The board, as the board panel shows it. */
export function boardOf(v: ViewState): BoardPanel {
  const b = v.board
  if (!b) return { heading: '', progress: 0, warnings: [], rows: [] }
  const x = b.x
  const rows: Row[] = []
  x.tanks.forEach((t, i) => {
    if (!t) {
      rows.push({ cells: [{ text: `${i + 1}`, width: 1 }, { text: 'empty', tone: 'dim' }] })
      return
    }
    rows.push({
      cells: [
        { text: `${i + 1}`, width: 1 },
        { text: t.archetype, width: 11, tone: 'blue' },
        { text: t.rarity, width: 7, tone: KIND[t.rarity] ?? 'dim' },
        { text: `${num(t.activity)} × ${num(t.quantity)}`, width: 16, align: 'right', tone: 'gold' },
      ],
    })
  })
  rows.push({ cells: [{ text: 'hand:', tone: 'dim', width: 12 }, { text: x.hand.join(' | ') || '-', tone: 'blue' }] })
  rows.push({ cells: [{ text: 'instruments:', tone: 'dim', width: 12 }, { text: x.instruments.join(' | ') || '-', tone: 'purple' }] })
  return {
    heading: `Round ${b.round} · ${phaseName(b.phase)} pick · refreshes: ${x.potionRefreshes ?? '?'} potion, ${x.instrumentRefreshes ?? '?'} instrument`,
    progress: Math.min(1, b.round / LAST_ROUND),
    warnings: b.warnings,
    rows,
  }
}
