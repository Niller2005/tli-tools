//! Growth and the Torture Instrument effects outside a consume (js/engine.js
//! promote 548-565, the "after opening" block of openCell, beginDay 884-951,
//! filthyClaws, coinOfFate, ravenousChains, shackles and scout).

import { BEAST_KEYS, RAINBOW, data } from './data'
import { pickIndex, pickOne, rand, shuffle } from './rng'
import { afterGrowth, checkPrey, doorWeights, emptyCell, fires, openCell, openRandom, rollInmate, weights } from './rules'
import type { Inmate, State } from './state'

/** The cell `step` places from `n` on the ring. */
function ring(n: number, step: number): number {
  const cells = data().cellCount
  return (((n + step) % cells) + cells) % cells
}

/** The inmates on the block. */
export function boardInmates(s: State): Inmate[] {
  const out: Inmate[] = []
  for (const c of s.cells) {
    if (!c.sealed && c.inmate !== null) out.push(c.inmate)
  }
  return out
}

/** promote: `who` rises `by` tiers; a consume re-rolls the beast below
 * Chromatic. The JS mutates the inmate object, so the one in its cell is the
 * current one; `who` stands in when it has left every cell. Returns it after. */
export function promote(s: State, who: Inmate, by: number, reroll: boolean): Inmate {
  const at = s.cellOf(who.id)
  const current = at !== null ? s.cells[at].inmate : null
  const inmate: Inmate = current !== null ? { ...current } : { ...who }
  inmate.tier = Math.min(Math.max(inmate.tier + by, 0), s.topTier())
  if (reroll && inmate.tier < RAINBOW) {
    inmate.beast = BEAST_KEYS[pickIndex(s, weights(s.params.beastWeights))]
  }
  if (at !== null) s.cells[at].inmate = inmate
  afterGrowth(s, inmate)
  return inmate
}

/** hiddenOf: the occupant behind a sealed door is rolled the first time anyone looks. */
export function hiddenOf(s: State, n: number): Inmate {
  const hidden = s.cells[n].hidden
  if (hidden !== null) return hidden
  const inmate = rollInmate(s, doorWeights(s))
  s.cells[n].hidden = inmate
  return inmate
}

/** The "after opening" instruments on a patrolled door or one an instrument
 * opened; `id` is the inmate that came out of cell `n`. */
export function afterOpening(s: State, n: number, id: number): void {
  const d = data()
  const here = (): Inmate | null => {
    const inmate = s.cells[n].inmate
    return inmate !== null && inmate.id === id ? inmate : null
  }
  // Felon's Dog Tag: the inmate behind the door rises.
  if (fires(s, 'dogtag')) {
    const inmate = here()
    if (inmate !== null) promote(s, inmate, d.tool('dogtag').tiers ?? 0, false)
  }
  // Executioner's Blacklist: with few unopened cells left, random inmates
  // rise. The game counts the doors locked before this one opens, so it
  // fires once fewer than `max_sealed` stay locked after it.
  const blacklist = d.tool('blacklist')
  if (s.has('blacklist') && s.sealedCells().length < (blacklist.maxSealed ?? 0)) {
    const picks = boardInmates(s)
    shuffle(s, picks)
    if (picks.length > (blacklist.count ?? 0)) picks.length = blacklist.count ?? 0
    for (const inmate of picks) {
      if (s.boardCellOf(inmate.id) !== null) promote(s, inmate, blacklist.tiers ?? 0, false)
    }
  }
  // Searing Branding Iron: a copy of the inmate opens another unopened cell.
  if (fires(s, 'fire')) {
    const inmate = here()
    if (inmate !== null) {
      const sealed = s.sealedCells()
      if (sealed.length > 0) {
        const target = sealed[pickOne(s, sealed.length)]
        openCell(s, target, 'side', { beast: inmate.beast, tier: inmate.tier })
      }
    }
  }
  // Lost Ring of Keys: the doors on both sides open too.
  if (fires(s, 'keys')) {
    for (const step of [-1, 1]) openCell(s, ring(n, step), 'side', null)
  }
  // Forged Key: one more random door opens with no other effect.
  if (fires(s, 'forgedkey')) openRandom(s, d.tool('forgedkey').count ?? 0, 'side')
}

/** The morning's prey marks: a Lion with several marks rises once, each prey once. */
export function preyRise(s: State): void {
  const risen: number[] = []
  for (const link of [...s.prey]) {
    if (link.next > s.day) continue
    const lionCell = s.boardCellOf(link.lion)
    const preyCell = s.boardCellOf(link.prey)
    if (lionCell === null || preyCell === null) continue
    const lion = s.cells[lionCell].inmate as Inmate
    const prey = s.cells[preyCell].inmate as Inmate
    const lionRises = !risen.includes(lion.id)
    risen.push(lion.id)
    const k = s.prey.findIndex((l) => l.lion === link.lion && l.prey === link.prey)
    if (k >= 0) {
      s.prey[k].rounds -= 1
      s.prey[k].next = s.day + 1
      if (s.prey[k].rounds <= 0) s.prey.splice(k, 1)
    }
    if (lionRises) promote(s, lion, 1, false)
    promote(s, prey, 1, false)
  }
}

/** Rat Nests that are due hatch a rat of the nest rarity. */
export function hatchNests(s: State): void {
  for (let n = 0; n < s.cells.length; n++) {
    const nest = s.cells[n].nest
    if (nest !== null && nest.due <= s.day) openCell(s, n, 'side', { beast: 'rat', tier: s.params.nestTier })
  }
}

/** The start-of-day instruments, in the beginDay order. */
export function morningTools(s: State): void {
  if (s.has('tongs')) {
    const mammoths: number[] = []
    for (const c of s.cells) {
      if (!c.sealed && !c.ivory && c.inmate !== null && c.inmate.beast === 'mammoth') mammoths.push(c.n)
    }
    if (mammoths.length > 0) {
      const n = mammoths[pickOne(s, mammoths.length)]
      s.cells[n].ivory = true
    }
  }
  if (s.has('ironbox')) {
    const free: number[] = []
    for (const c of s.cells) {
      if (c.sealed && c.nest === null) free.push(c.n)
    }
    if (free.length > 0) {
      const n = free[pickOne(s, free.length)]
      s.cells[n].nest = { due: s.day + s.params.nestDays }
    }
  }
  if (s.has('claws')) filthyClaws(s)
  if (fires(s, 'coin')) coinOfFate(s)
  if (s.has('chains')) ravenousChains(s)
}

/** Filthy Claws: a random unopened cell gets a Scratch mark. */
function filthyClaws(s: State): void {
  const free: number[] = []
  for (const c of s.cells) {
    if (c.sealed && !c.scratch && c.nest === null) free.push(c.n)
  }
  if (free.length === 0) return
  const n = free[pickOne(s, free.length)]
  hiddenOf(s, n)
  const cell = s.cells[n]
  cell.scratch = true
  cell.known = Math.max(cell.known, 1)
}

/** Kin's Coin of Fate: one of a matching pair is removed and a match rises. */
function coinOfFate(s: State): void {
  const same = (a: Inmate, b: Inmate): boolean => a.beast === b.beast && a.tier === b.tier
  const board = boardInmates(s)
  const matched = board.filter((i) => board.some((o) => o.id !== i.id && same(o, i)))
  if (matched.length === 0) return
  const gone = matched[pickOne(s, matched.length)]
  const kin = matched.filter((i) => i.id !== gone.id && same(i, gone))
  const lucky = kin[pickOne(s, kin.length)]
  const n = s.cellOf(gone.id)
  if (n !== null) emptyCell(s, n)
  checkPrey(s)
  promote(s, lucky, data().tool('coin').tiers ?? 0, false)
}

/** Ravenous Chains: the neighbours of the highest-rarity inmate are removed,
 * and it rolls its chance to rise once per removal. */
function ravenousChains(s: State): void {
  const cells = s.boardCells()
  let top = 0
  for (const n of cells) {
    const tier = s.cells[n].inmate?.tier ?? 0
    if (tier > top) top = tier
  }
  if (cells.length === 0) return
  const tops = cells.filter((n) => (s.cells[n].inmate?.tier ?? 0) === top)
  const center = tops[pickOne(s, tops.length)]
  const inmate = s.cells[center].inmate
  if (inmate === null) return
  const sides = [-1, 1].map((step) => ring(center, step)).filter((n) => !s.cells[n].sealed && s.cells[n].inmate !== null)
  if (sides.length === 0) return
  for (const n of sides) emptyCell(s, n)
  checkPrey(s)
  const chains = data().tool('chains')
  let gain = 0
  for (const _ of sides) {
    if (rand(s) * 100 < chains.chance) gain += chains.tiers ?? 0
  }
  if (gain !== 0) promote(s, inmate, gain, false)
}

/** The shackles roll on a move of at least one tile. */
export function shackles(s: State, steps: number): void {
  const d = data()
  const short = d.tool('shortchain')
  if (steps > 0 && steps <= (short.maxSteps ?? 0) && fires(s, 'shortchain')) {
    openRandom(s, short.count ?? 0, 'side')
  }
  const long = d.tool('longchain')
  if (steps >= (long.minSteps ?? Number.MAX_SAFE_INTEGER) && fires(s, 'longchain')) {
    const board = boardInmates(s)
    if (board.length === 0) return
    const lucky = board[pickOne(s, board.length)]
    promote(s, lucky, long.tiers ?? 0, false)
  }
}

/** Warden's Scales: the rarity of the best inmate behind the locked doors is
 * shown, not its species (confirmed in-game). */
export function scout(s: State): void {
  const doors: number[] = []
  for (const c of s.cells) {
    if (c.sealed && c.nest === null) doors.push(c.n)
  }
  if (doors.length === 0) return
  const tiers = doors.map((n) => hiddenOf(s, n).tier)
  const top = Math.max(...tiers)
  const best = doors.filter((_, i) => tiers[i] === top)
  const n = best[pickOne(s, best.length)]
  s.cells[n].known = 1
}
