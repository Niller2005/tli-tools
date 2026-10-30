//! The strategy, a port of js/solver.js lines 16-546: it scores every legal
//! move from what the player can see and plays the best one. Sums run in the
//! JS order and sorts are stable, so a position gets the same pick as the JS.

import { BEAST_KEYS, CAGE_FIGHT, LOOT, RAINBOW, beastIndex, data, type ObjectiveKind, type Tool } from '@/engine/data'
import { canDevourNow, devourOptions, huntTargets, startOptions } from '@/engine/devour'
import { rand } from '@/engine/rng'
import { doorWeights } from '@/engine/rules'
import type { Cell, State } from '@/engine/state'
import type { Action } from '@/engine/actions'

import { replaceOdds } from './chain'
import { bestByBoard, bestHunt, devourScores, patrolScores, swapGainHere } from './scores'
import { freshActivation } from './values'

/** Torture Instruments by Chromatics per run (TOOL_RANK). */
export const TOOL_RANK: readonly Tool[] = [
  'crown',
  'trap',
  'longchain',
  'claws',
  'rope',
  'coin',
  'skewer',
  'chains',
  'muzzle',
  'maul',
  'revenge',
  'tongs',
  'stake',
  'saw',
  'whip',
  'maiden',
  'hook',
  'collar',
  'guillotine',
  'dogtag',
  'blacklist',
  'scales',
  'pestle',
  'shortchain',
  'keys',
  'fire',
  'beastcage',
  'forgedkey',
  'axe',
  'ironbox',
  'scapegoat',
]

/** The top tier (Rainbow) as an index. */
export const TOP = RAINBOW

/** Strategy weights in tier-value units; see js/solver.js 29-43. */
export interface Params {
  tierBase: number
  rainbowMult: number
  wOpen: number
  wNow: number
  wWalk: number
  wStep: number
  wChain: number
  /** An incident's or the Interrogation Room's board gain, played on a copy. */
  wEvent: number
  wStair: number
  minDevour: number
  swapMaxTier: number
  /** Progress toward the run's objective, whose completion gives a second
   * Torture Instrument pick: a move that completes it earns `wGoal`, a
   * part of it the same share of `wGoal`. */
  wGoal: number
  /** The board value of an unseen marker's other incidents, those besides
   * Execution Efficiency and Chain Reaction. */
  wIncident: number
  /** With a Re-roll left, an instrument offer is re-rolled when its best
   * instrument sits at this TOOL_RANK index or lower down. */
  rerollRank: number
  /** The Room's landing weight factor under Tyranny, whose extra Instigates
   * place markers the Bestow gain does not count. */
  roomTyranny: number
}

/** The weight with field name `name` (such as `w_step`), for the strategy
 * bench's `--set`. */
export function weightOf(p: Params, name: string): number | null {
  switch (name) {
    case 'tier_base':
      return p.tierBase
    case 'rainbow_mult':
      return p.rainbowMult
    case 'w_open':
      return p.wOpen
    case 'w_now':
      return p.wNow
    case 'w_walk':
      return p.wWalk
    case 'w_step':
      return p.wStep
    case 'w_chain':
      return p.wChain
    case 'w_event':
      return p.wEvent
    case 'w_stair':
      return p.wStair
    case 'min_devour':
      return p.minDevour
    case 'swap_max_tier':
      return p.swapMaxTier
    case 'w_goal':
      return p.wGoal
    case 'w_incident':
      return p.wIncident
    case 'reroll_rank':
      return p.rerollRank
    case 'room_tyranny':
      return p.roomTyranny
    default:
      return null
  }
}

/** Sets the weight with field name `name`; false when there is none. */
export function setWeight(p: Params, name: string, value: number): boolean {
  switch (name) {
    case 'tier_base':
      p.tierBase = value
      return true
    case 'rainbow_mult':
      p.rainbowMult = value
      return true
    case 'w_open':
      p.wOpen = value
      return true
    case 'w_now':
      p.wNow = value
      return true
    case 'w_walk':
      p.wWalk = value
      return true
    case 'w_step':
      p.wStep = value
      return true
    case 'w_chain':
      p.wChain = value
      return true
    case 'w_event':
      p.wEvent = value
      return true
    case 'w_stair':
      p.wStair = value
      return true
    case 'min_devour':
      p.minDevour = value
      return true
    case 'swap_max_tier':
      p.swapMaxTier = value
      return true
    case 'w_goal':
      p.wGoal = value
      return true
    case 'w_incident':
      p.wIncident = value
      return true
    case 'reroll_rank':
      p.rerollRank = value
      return true
    case 'room_tyranny':
      p.roomTyranny = value
      return true
    default:
      return false
  }
}

/** A copy of the weights (the Rust engine's Clone). */
export function cloneParams(p: Params): Params {
  return { ...p }
}

/** The tuned weights (js/solver.js withDefaults(TUNED)), what `decide(st, null)` plays. */
export const TUNED: Params = {
  tierBase: 2.75,
  rainbowMult: 1.0,
  wOpen: 0.5,
  wNow: 1.5,
  wWalk: 0.5,
  wStep: 0.75,
  wChain: 16.0,
  wEvent: 4.0,
  wStair: 1.0,
  minDevour: -2.0,
  swapMaxTier: 2.0,
  wGoal: 0.0,
  wIncident: 64.0,
  rerollRank: 8.0,
  roomTyranny: 4.0,
}

/** mulberry32 (rng32), for the solver's own dice (never the game's). */
export class Rng32 {
  rng: number

  constructor(seed: number) {
    this.rng = seed >>> 0
  }

  roll(): number {
    return rand(this)
  }
}

/** Open inmates by tier and beast (index tier * 4 + beast). */
export type Comp = number[]

/** Tier odds, Normal to Rainbow. */
export type Dist = number[]

/** Rust's `f64::max`: the greater of two, the other one when one is NaN. */
export function fmax(a: number, b: number): number {
  if (Number.isNaN(a)) return b
  if (Number.isNaN(b)) return a
  return a > b ? a : b
}

/** Rust's `f64::min`: the lesser of two, the other one when one is NaN. */
export function fmin(a: number, b: number): number {
  if (Number.isNaN(a)) return b
  if (Number.isNaN(b)) return a
  return a < b ? a : b
}

/** Rust's `f64::powi`: binary exponentiation, as LLVM lowers it. */
export function powi(x: number, n: number): number {
  if (n === 0) return 1
  let result = 1
  let base = x
  let e = n
  while (e > 0) {
    if ((e & 1) === 1) result *= base
    base *= base
    e >>= 1
  }
  return result
}

/** composition: the open inmates below Rainbow leaving out cell `exclude`,
 * plus how many are on the block in all. */
export function composition(st: State, exclude: number | null): [Comp, number] {
  const comp = new Array<number>(24).fill(0)
  let crowd = 0
  for (const c of st.cells) {
    if (c.inmate === null || c.sealed) continue
    crowd += 1
    if (c.n === exclude || c.inmate.tier >= RAINBOW) continue
    comp[c.inmate.tier * 4 + beastIndex(c.inmate.beast)] += 1
  }
  return [comp, crowd]
}

/** normalize: negative weights count as 0; all zero leaves all zero. */
export function normalize(weights: readonly number[]): number[] {
  let total = 0
  for (const w of weights) total += fmax(w, 0)
  if (total === 0) total = 1
  return weights.map((w) => fmax(w, 0) / total)
}

/** Who each beast eats without tools: by eater, a bit per beast it eats. */
export function foodChain(): number[] {
  return BEAST_KEYS.map((b) => data().foodChain[beastIndex(b)].reduce((m, f) => m | (1 << beastIndex(f)), 0))
}

/** Who each beast eats with the Skewered Rat Heads and the Iron Crown, as in `food_chain`. */
export function eatsTable(st: State): number[] {
  const eats = foodChain()
  if (st.has('skewer')) eats[beastIndex('rat')] |= 1 << beastIndex('rat')
  if (st.has('crown')) eats[beastIndex('lion')] = 0b1111
  return eats
}

/** The beasts set in a `food_chain` mask, by index in ascending order. The
 * masks are four bits wide, so the table holds every one of them. */
const FOODS: number[][] = []
for (let mask = 0; mask < 16; mask++) {
  const set: number[] = []
  for (let f = 0; f < 4; f++) {
    if (((mask >> f) & 1) === 1) set.push(f)
  }
  FOODS.push(set)
}

/** The beasts set in a `food_chain` mask, by index in ascending order. The
 * array is shared: read it, never change it. */
export function foods(mask: number): number[] {
  return FOODS[mask & 15]
}

/** Everything a decision needs, computed once per position (context). */
export interface Ctx {
  st: State
  p: Params
  eats: number[]
  /** Who each beast counters without tools, for the cross-tier bites. */
  chain: number[]
  v: number[]
  r: number
  /** The odds of each count of extra tiers a successful bite rolls (Rusty
   * Saw, Barbed Whip, and the Barbed Collar on chained bites), by whether
   * the bite is chained. */
  extra: number[][]
  muzzle: boolean
  skewer: boolean
  crown: boolean
  revenge: boolean
  /** Crowded Beastcage's chance that a meal's cell opens again after a bite;
   * 0 without it or without reusable cells (the cell stays unsealed then). */
  beastcage: number
  /** Elephant-Foot Maul: a Mammoth eats higher countered inmates. */
  maul: boolean
  /** Fanged Guillotine: a Wolf eats lower countered inmates, with Oppress. */
  fangs: boolean
  /** Cage Fight theme: any eater eats lower countered inmates and keeps its beast. */
  cageFight: boolean
  /** By the eater's beast, a bit per beast whose lower-tier counts its
   * chain can read (the memo key of `chain::feed`). */
  down: number[]
  scratchExtra: number
  /** The worth of whoever comes out of an unseen door on a patrol or
   * instrument opening (`doorDist`). */
  openValue: number
  /** The worth of an unseen door opened from the side (Chain Reaction walk,
   * Crowded Beastcage), which sets off no "after opening" instrument. */
  sideValue: number
  /** The run's last day: what counts is the Riot loot, so every tier below
   * Chromatic is worth only its cache (`LOOT`) and a Replace of any tier
   * may pay. */
  lastDay: boolean
  /** The run's objective while it is open and `wGoal` is not 0. */
  goal: Goal | null
  /** The chain memo, by the counts the solver builds. */
  memo: Map<string, number>
}

/** The run's open objective, as the strategy prices progress toward it. */
export interface Goal {
  kind: ObjectiveKind
  /** The rarity a ReachRating objective names. */
  rating: number
  target: number
  /** The progress still to make. */
  left: number
}

/** The objective of `st`; None when there is none, it is done, or `wGoal` is 0. */
export function goalOf(st: State, p: Params): Goal | null {
  if (st.objective === null || st.objective.done || p.wGoal === 0) return null
  const o = data().objective(st.objective.id)
  if (o === null) return null
  const left = (o.target - st.objective.progress) >>> 0
  return { kind: o.kind, rating: o.rating, target: o.target, left }
}

/** `wGoal * gain / target`, with `gain` capped at the progress left. */
export function goalTerm(goal: Goal, p: Params, gain: number): number {
  return (p.wGoal * fmin(gain, goal.left)) / goal.target
}

/** The strategy's tier values `v` and vaulted Rainbow worth `r` on `st`, and
 * whether it is the run's last day, where every tier below Chromatic is worth
 * only its Riot loot (`LOOT`) in vaulted Chromatics. */
export function tierValues(st: State, p: Params): [number[], number, boolean] {
  const v = [0, 1, 2, 3, 4, 5].map((t) => powi(p.tierBase, t))
  // A full vault stops inmates at Ultimate: the top tier is worth no more.
  const r = st.topTier() < RAINBOW ? v[RAINBOW - 1] : v[RAINBOW] * p.rainbowMult
  const lastDay = st.day >= st.maxDays
  if (lastDay) {
    // Full vault or not.
    const chromatic = v[RAINBOW] * p.rainbowMult
    for (let t = 0; t < TOP; t++) v[t] = LOOT[t] * chromatic
  }
  return [v, r, lastDay]
}

/** Everything a decision needs, computed once per position (context). */
export function context(st: State, p: Params): Ctx {
  const [v, r, lastDay] = tierValues(st, p)
  const openValue = distWorth(v, r, doorDist(st, null, true)[0])
  const sideValue = distWorth(v, r, doorDist(st, null, false)[0])
  const chain = foodChain()
  const cageFight = st.theme === CAGE_FIGHT
  // Under Cage Fight the eater keeps its beast; otherwise any eater may
  // re-roll into a Wolf, which eats down with the Fanged Guillotine.
  const down = BEAST_KEYS.map((_, b) => {
    if (cageFight) return chain[b]
    if (st.has('guillotine')) return chain[beastIndex('wolf')]
    return 0
  })
  return {
    st,
    p,
    eats: eatsTable(st),
    chain,
    down,
    v,
    r,
    extra: [extraTiers(st, false), extraTiers(st, true)],
    muzzle: st.has('muzzle'),
    skewer: st.has('skewer'),
    crown: st.has('crown'),
    revenge: st.has('revenge') && st.cells.some((c) => c.sealed),
    beastcage:
      st.has('beastcage') && st.params.reusableCells ? data().tool('beastcage').chance / 100.0 : 0.0,
    maul: st.has('maul'),
    fangs: st.has('guillotine'),
    cageFight,
    scratchExtra: 1 + (st.params.scratchStacksBase ? 1 : 0),
    openValue,
    sideValue,
    lastDay,
    goal: goalOf(st, p),
    memo: new Map<string, number>(),
  }
}

/** doorDist: tier odds (Normal to Rainbow) for whoever comes out of sealed
 * cell `cell`, or of an unseen door when null, and its beast when the player
 * has seen it (engine door_inmate). A seen door holds its known rarity (even
 * a Normal under the Sorting Hook); an unseen one rolls `door_weights`, with
 * no Normal under the Hook. On a patrol or instrument opening (`after`),
 * Felon's Dog Tag may raise the inmate. A scratched door prices at its known
 * rarity; the scratch bite its opening gives up is charged by `scratch_loss`. */
export function doorDist(st: State, cell: Cell | null, after: boolean): [Dist, number | null] {
  const seen = cell !== null && seenDoor(cell) && cell.hidden !== null ? { h: cell.hidden, k: cell.known } : null
  let dist = new Array<number>(TOP + 1).fill(0)
  if (seen !== null) {
    dist[seen.h.tier] = 1.0
  } else {
    const w = normalize(doorWeights(st))
    for (let t = 0; t < TOP; t++) dist[t] = w[t]
  }
  if (after && st.has('dogtag')) {
    const def = data().tool('dogtag')
    const c = def.chance / 100.0
    const by = def.tiers ?? 0
    const top = st.topTier()
    const raised = new Array<number>(TOP + 1).fill(0)
    for (let t = 0; t <= TOP; t++) {
      const p = dist[t]
      raised[t] += p * (1.0 - c)
      raised[Math.min(Math.max(t + by, 0), top)] += p * c
    }
    dist = raised
  }
  return [dist, seen !== null && seen.k >= 2 ? beastIndex(seen.h.beast) : null]
}

/** Whether `doorDist` prices sealed cell `c` by what the player saw behind it. */
export function seenDoor(c: Cell): boolean {
  return c.known > 0 && c.hidden !== null
}

/** The worth of an inmate of tier t; a Chromatic is worth `r`. */
export function worth(ctx: Ctx, t: number): number {
  if (t >= TOP) return ctx.r
  return ctx.v[t]
}

/** The beasts an inmate may be and the odds of each: beast `beast` when it is
 * known, else any of the 4 at even odds. */
export function beasts(beast: number | null): [number[], number] {
  const list = beast === null ? [0, 1, 2, 3] : [beast]
  return [list, 1.0 / list.length]
}

/** The expected worth of an inmate with tier odds `dist`; a Chromatic is worth `r`. */
export function distWorth(v: number[], r: number, dist: number[]): number {
  let sum = 0.0
  for (let t = 0; t < dist.length; t++) sum += dist[t] * (t >= TOP ? r : v[t])
  return sum
}

/** The odds of 0 to 3 extra tiers on a successful bite (engine do_devour):
 * the held Saw, Whip and, on a chained bite, Collar each roll on their own. */
export function extraTiers(st: State, chained: boolean): number[] {
  let odds = [1.0, 0.0, 0.0, 0.0]
  for (const t of ['saw', 'whip', 'collar'] as Tool[]) {
    if (!st.has(t) || (t === 'collar' && !chained)) continue
    const def = data().tool(t)
    const p = def.chance / 100.0
    const k = def.tiers ?? 0
    const next = [0.0, 0.0, 0.0, 0.0]
    for (let i = 0; i < odds.length; i++) {
      const q = odds[i]
      next[i] += (1.0 - p) * q
      // Each adds one tier in the data, so three at most.
      next[Math.min(i + k, 3)] += p * q
    }
    odds = next
  }
  return odds
}

/** Whether two actions are the same move (the Rust engine's `Action`
 * equality). A named choice and a cell choice are never the same, even when
 * the name reads as a number. */
export function sameAction(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'choose':
      return b.type === 'choose' && a.id === b.id
    case 'patrol':
      return b.type === 'patrol' && a.cell === b.cell
    case 'devour':
      return b.type === 'devour' && a.to === b.to
    case 'chain':
      return b.type === 'chain' && a.to === b.to
    case 'hunt':
      return b.type === 'hunt' && a.cell === b.cell
    default:
      return true
  }
}

/** decide: the move the strategy would play now, or null once the run is over. */
export function decide(st: State, p: Params, roll: Rng32): Action | null {
  const ctx = context(st, p)
  if (st.phase === 'ended') return null
  const choice = st.pending.at(0)
  if (choice !== undefined) {
    switch (choice.kind) {
      case 'chain': {
        // A Hunt still open ends the chain: it is worth more than another bite.
        if (huntTargets(st).length !== 0) return { type: 'endChain' }
        const bites = devourOptions(st, choice.from).filter((o) => choice.options.includes(o.cell))
        const next = devourScores(ctx, bites)
        const first = next.at(0)
        if (first !== undefined && first[1] >= p.minDevour) return { type: 'chain', to: first[0] }
        return { type: 'endChain' }
      }
      case 'gift': {
        const keys = choice.options.map((g) => g)
        return { type: 'choose', id: bestByBoard(ctx, keys, true, roll) }
      }
      case 'interrogation': {
        const keys = choice.options.map((c) => c)
        return { type: 'choose', id: bestByBoard(ctx, keys, false, roll) }
      }
      case 'cell': {
        const scores = patrolScores(ctx, choice.options)
        const first = scores.at(0)
        if (first === undefined) return null
        return { type: 'choose', id: first[0] }
      }
      case 'prey': {
        const best = bestHunt(ctx, choice.options)
        return best === null ? null : { type: 'choose', id: best[0] }
      }
      case 'tool': {
        const best = TOOL_RANK.findIndex((t) => choice.options.includes(t))
        if (st.rerolls > 0 && (best === -1 ? TOOL_RANK.length : best) >= p.rerollRank) {
          return { type: 'reroll' }
        }
        if (choice.options.length === 0) return null
        const tool = best === -1 ? (choice.options.at(0) as Tool) : TOOL_RANK[best]
        return { type: 'choose', id: tool }
      }
    }
  }
  // An incident is confirmed, never declined (S16BoardEventPop.lua:17-38).
  if (st.phase === 'event' && st.event !== null) return { type: 'event' }
  if (st.phase === 'patrol') {
    const scores = patrolScores(ctx, st.destinations)
    const first = scores.at(0)
    return first === undefined ? { type: 'end' } : { type: 'patrol', cell: first[0] }
  }
  // Manage: a Hunt goes first, as a devour after it already counts the
  // prey marks it would end.
  const hunt = bestHunt(ctx, huntTargets(st))
  if (hunt !== null && hunt[1] > 0.0) return { type: 'hunt', cell: hunt[0] }
  const swapGain = swapGainHere(ctx)
  if (canDevourNow(st)) {
    const devours = devourScores(ctx, startOptions(st))
    const first = devours.at(0)
    if (first !== undefined && first[1] >= p.minDevour) {
      // A swap first can be worth more than a weak devour: the new
      // inmate may still devour today.
      if (swapGain > -Infinity && swapFirst(ctx, swapGain) > first[1]) return { type: 'swap' }
      return { type: 'devour', to: first[0] }
    }
  }
  // On the last day a Replace buys only what the new inmate can still do today.
  const gain = ctx.lastDay && swapGain > -Infinity ? swapFirst(ctx, swapGain) : swapGain
  return gain > 0.0 ? { type: 'swap' } : { type: 'end' }
}

/** A Replace in the warden's cell worth `swapGain`, plus what the new inmate
 * may still do today. */
export function swapFirst(ctx: Ctx, swapGain: number): number {
  const st = ctx.st
  const [comp, crowd] = composition(st, st.position)
  const old = st.cells[st.position].inmate
  const dist = replaceOdds(ctx, old === null ? 0 : old.tier, comp, crowd - 1)[0]
  // Iron Pestle: the new inmate keeps the old one's beast.
  const beast = old !== null && st.has('pestle') ? beastIndex(old.beast) : null
  return swapGain + ctx.p.wNow * freshActivation(ctx, dist, beast, comp, crowd, false)
}

/** The strategy's bite once Consume is pressed: decide's own, else the best
 * scored of today's targets; null when the inmate has none. Only bites
 * into the cells of `only` count. */
export function decideBite(st: State, p: Params, roll: Rng32, only: number[]): Action | null {
  const own = decide(st, p, roll)
  if (own !== null && own.type === 'devour' && only.includes(own.to)) return own
  const ctx = context(st, p)
  const options = startOptions(st).filter((o) => only.includes(o.cell))
  const scores = devourScores(ctx, options)
  const first = scores.at(0)
  return first === undefined ? null : { type: 'devour', to: first[0] }
}
