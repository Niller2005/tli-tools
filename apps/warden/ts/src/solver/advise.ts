//! The move to recommend from a ranking: the strategy's pick until the
//! playouts count, then the playouts' best. The app shows it, and `bench`
//! plays it to measure what following the advice is worth.

import type { Action } from '@/engine/actions'
import type { Gift } from '@/engine/data'
import { applyGift } from '@/engine/gifts'
import type { Cell, Inmate, Nest, State, VaultEntry } from '@/engine/state'
import { toolName } from '@/engine/text'

import { sameAction } from './mod'
import type { SolveOption } from './solve'

/** The strategy's own pick and why, before any playout. */
export interface Pick {
  action: Action
  label: string
  why: string
}

/** The move to recommend; `option` is its row in the ranking. */
export interface Advice {
  action: Action
  label: string
  why: string
  option: number | null
}

/** The three dice `changesNothing` tries the treasure's effect with. */
const TRIAL_RNGS: readonly number[] = [0x9e3779b9, 0x85ebca6b, 0xc2b2ae35]

/** The strategy's pick until the playouts count (`live`), then the ranking's
 * first row. */
export function advise(pick: Pick | null, ranking: SolveOption[], live: boolean): Advice | null {
  let mine: number | null = null
  if (pick !== null) {
    const action = pick.action
    const at = ranking.findIndex((o) => sameAction(o.action, action))
    if (at >= 0) mine = at
  }
  if (!live || ranking.length < 2) {
    if (pick !== null) {
      return { action: { ...pick.action }, label: pick.label, why: pick.why, option: mine }
    }
    if (ranking.length === 1) {
      const only = ranking[0]
      return { action: { ...only.action }, label: only.label, why: "It's the only move here.", option: 0 }
    }
    return null
  }
  const best = ranking[0]
  let why: string
  if (pick === null) {
    why = 'The playouts rate it best.'
  } else if (mine === 0) {
    why = pick.why
  } else if (mine !== null && alsoGood(ranking, 0).includes(mine)) {
    // Within the margin of error of the first row, the pick is as good.
    why = `The playouts rate it as good as the strategy's pick (${pick.label}).`
  } else {
    why = `The playouts found a better move than the strategy's pick (${pick.label}).`
  }
  return { action: { ...best.action }, label: best.label, why, option: 0 }
}

/** The rows of the ranking other than the advised one that are within the
 * margin of error of it, in ranking order. */
export function alsoGood(ranking: SolveOption[], advised: number | null): number[] {
  if (advised === null) return []
  const best = ranking.at(advised)
  if (best === undefined) return []
  const out: number[] = []
  for (let k = 0; k < ranking.length; k++) {
    const o = ranking[k]
    // gapSe is the margin to the first row; the first row's margin
    // to the advised row is the advised row's.
    const se = k === 0 ? best.gapSe : o.gapSe
    if (k !== advised && Math.abs(best.mean - o.mean) <= 1.96 * se) out.push(k)
  }
  return out
}

/** The line under the board for the advice. On a named pick (treasure, card,
 * instrument) where every option ties, it says the others score the same;
 * on a treasure pick, it names the treasures that change nothing on the
 * board. */
export function whyShown(st: State, ranking: SolveOption[], advice: Advice): string {
  const others = alsoGood(ranking, advice.option)
  const tie = ranking.length >= 2 && others.length === ranking.length - 1
  const alike = "The playouts can't tell it from the others."
  const pending = st.pending.at(0)
  if (pending === undefined) return advice.why
  if (pending.kind === 'gift') {
    const options = pending.options
    if (tie) {
      const noops = options.filter((g) => changesNothing(st, g))
      if (noops.length === 0) return alike
      if (noops.length === options.length) return 'No treasure changes anything on this board.'
      return `${alike} ${names(noops)} ${change(noops.length)} nothing on this board.`
    }
    const k = advice.option
    if (k !== null) {
      const gift = giftAt(options, ranking, k)
      if (gift !== null && changesNothing(st, gift)) {
        const idle = idleTied(st, options, ranking, k)
        return `${names(idle)} ${change(idle.length)} nothing on this board, and the other treasures score lower.`
      }
    }
    return advice.why
  }
  if ((pending.kind === 'interrogation' || pending.kind === 'tool') && tie) return alike
  return advice.why
}

/** On a treasure pick, when the advised treasure changes nothing and a tied
 * one changes something, the best-ranked such one, since the playouts can't
 * rank them apart; otherwise the advice as it is. */
export function preferChange(st: State, ranking: SolveOption[], advice: Advice): Advice {
  const pending = st.pending.at(0)
  const k = advice.option
  if (pending === undefined || pending.kind !== 'gift' || k === null) return advice
  const options = pending.options
  const idle = idleTied(st, options, ranking, k)
  const acts = (j: number): boolean => {
    const gift = giftAt(options, ranking, j)
    return gift !== null && !idle.includes(gift)
  }
  if (acts(k)) return advice
  const best = alsoGood(ranking, k).find((j) => acts(j))
  if (best === undefined) return advice
  const row = ranking[best]
  return {
    action: { ...row.action },
    label: row.label,
    why: `The playouts can't tell it from ${names(idle)}, which ${change(idle.length)} nothing on this board.`,
    option: best,
  }
}

/** The treasures of ranking row `advised` and of the rows tied with it that
 * change nothing on the board, in ranking order. */
function idleTied(st: State, options: Gift[], ranking: SolveOption[], advised: number): Gift[] {
  const rows = [...alsoGood(ranking, advised), advised].sort((a, b) => a - b)
  const out: Gift[] = []
  for (const k of rows) {
    const gift = giftAt(options, ranking, k)
    if (gift !== null && changesNothing(st, gift)) out.push(gift)
  }
  return out
}

/** The treasure that ranking row `k` takes, if it is one of `options`. */
function giftAt(options: Gift[], ranking: SolveOption[], k: number): Gift | null {
  const row = ranking.at(k)
  if (row === undefined) return null
  const action = row.action
  if (action.type !== 'choose') return null
  const id = action.id
  if (typeof id !== 'string') return null
  for (const g of options) {
    if (g === id) return g
  }
  return null
}

/** Whether the treasure's own effect leaves the cells and the vault as they
 * are, over three dice. The pick's full action carries the game on past it
 * (new incident markers spawn), so only the effect is tried. */
function changesNothing(st: State, gift: Gift): boolean {
  for (const rng of TRIAL_RNGS) {
    const trial = st.clone()
    trial.rng = rng
    applyGift(trial, gift)
    if (!sameCells(trial.cells, st.cells) || !sameVault(trial.vault, st.vault)) return false
  }
  return true
}

/** The treasures' names joined as "A, B and C". */
function names(gifts: Gift[]): string {
  return join(gifts.map((g) => toolName(g)))
}

/** The verb for `n` treasures that change nothing. */
function change(n: number): string {
  return n === 1 ? 'changes' : 'change'
}

/** Names joined as "A, B and C". */
function join(names: string[]): string {
  if (names.length === 0) return ''
  if (names.length === 1) return names[0]
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/** Whether two inmates are the same (the Rust engine's `Inmate` equality). */
function sameInmate(a: Inmate | null, b: Inmate | null): boolean {
  if (a === null || b === null) return a === b
  return a.id === b.id && a.beast === b.beast && a.tier === b.tier
}

/** Whether two nests are the same (the Rust engine's `Nest` equality). */
function sameNest(a: Nest | null, b: Nest | null): boolean {
  if (a === null || b === null) return a === b
  return a.due === b.due
}

/** Whether two cells are the same (the Rust engine's `Cell` equality). */
function sameCell(a: Cell, b: Cell): boolean {
  return (
    a.n === b.n &&
    a.sealed === b.sealed &&
    sameInmate(a.inmate, b.inmate) &&
    sameInmate(a.hidden, b.hidden) &&
    a.known === b.known &&
    a.scratch === b.scratch &&
    sameNest(a.nest, b.nest) &&
    a.event === b.event &&
    a.ivory === b.ivory
  )
}

/** Whether two boards are the same (the Rust engine's `Vec<Cell>` equality). */
function sameCells(a: Cell[], b: Cell[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (!sameCell(a[i], b[i])) return false
  }
  return true
}

/** Whether two vaults are the same (the Rust engine's `Vec<VaultEntry>` equality). */
function sameVault(a: VaultEntry[], b: VaultEntry[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (x.id !== y.id || x.beast !== y.beast || x.day !== y.day) return false
  }
  return true
}
