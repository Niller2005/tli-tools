/** Chain math (js/solver.js 113-251): the exact expected outcome of a devour,
 * including the random chain after it. */

import { RAINBOW, beastIndex, data, type Tool } from '@/engine/data'
import { weights } from '@/engine/rules'
import type { State } from '@/engine/state'

import {
  TOP,
  composition,
  eatsTable,
  foodChain,
  foods,
  fmax,
  normalize,
  powi,
  worth,
  type Comp,
  type Ctx,
  type Dist,
} from './mod'

export type { Comp, Ctx, Dist }

/** The tiers an instrument adds. */
function tiers(t: Tool): number {
  return data().tool(t).tiers ?? 0
}

/** swapDist: tier odds for a swapped-in inmate, after Hangman's Noose. */
export function swapDist(ctx: Ctx): Dist {
  const w = new Array<number>(TOP + 1).fill(0.0)
  const drawn = weights(ctx.st.params.tierWeights)
  for (let t = 0; t < TOP; t++) w[t] = drawn[t]
  if (ctx.st.has('rope')) {
    w[0] = 0.0
    w[1] = 0.0
  }
  return normalize(w)
}

/** replaceOdds: tier odds (Normal to Rainbow) for the inmate a Replace brings
 * in for one of tier `tier`, after every instrument that changes its rarity
 * (engine swap), and the expected worth of the inmates the Replace removes,
 * with `others` other open inmates on the block (those below Rainbow counted
 * in `comp`).
 * - Hangman's Noose: no Normal or Magic roll (`swapDist`).
 * - Scapegoat's Guillotine: with at least min_others others, it removes count
 *   of them at random and the new inmate is sure to be rarer than the old.
 * - Burning Stake: replacing an inmate below Legendary, a roll below
 *   Legendary becomes Legendary at the data chance.
 * - Severed Iron Maiden: a new inmate on the block with as many rarer open
 *   inmates as less rare ones rises its tiers. */
export function replaceOdds(ctx: Ctx, tier: number, comp: Comp, others: number): [Dist, number] {
  const st = ctx.st
  const top = st.topTier()
  let dist = swapDist(ctx)
  const def = data().tool('scapegoat')
  const removed =
    st.has('scapegoat') && others >= (def.minOthers ?? 0) && others > 0 ? Math.min(def.count ?? 0, others) : 0
  let loss = 0.0
  if (removed > 0) {
    for (let t = 0; t <= tier; t++) dist[t] = 0.0
    if (dist.some((p) => p > 0.0)) {
      dist = normalize(dist)
    } else {
      // Nothing rarer left to roll: the engine makes one a tier up.
      dist = new Array<number>(TOP + 1).fill(0.0)
      dist[Math.min(tier + 1, top)] = 1.0
    }
    let worthSum = 0.0
    for (let i = 0; i < comp.length; i++) worthSum += comp[i] * ctx.v[Math.floor(i / 4)]
    loss = (removed / others) * worthSum
  }
  const stake = data().tool('stake')
  const legendary = stake.tier ?? RAINBOW
  if (st.has('stake') && tier < legendary) {
    const c = stake.chance / 100.0
    let below = 0.0
    for (let t = 0; t < legendary; t++) below += dist[t]
    for (let t = 0; t < legendary; t++) dist[t] *= 1.0 - c
    dist[legendary] += c * below
  }
  if (st.params.maiden && st.has('maiden')) {
    // Open inmates by tier; the Guillotine's removals come first, so the
    // Maiden's odds at each tier average over the removed inmates.
    const counts = new Array<number>(TOP + 1).fill(0)
    for (let i = 0; i < comp.length; i++) counts[Math.floor(i / 4)] += comp[i]
    let n = 0
    for (let t = 0; t < counts.length; t++) n += counts[t]
    const k = Math.min(removed, n)
    const maidenTiers = tiers('maiden')
    for (let t = 0; t < TOP; t++) {
      const mass = dist[t]
      const to = Math.min(t + maidenTiers, top)
      if (mass === 0.0 || to === t) continue
      let above = 0
      for (let u = t + 1; u < counts.length; u++) above += counts[u]
      let below = 0
      for (let u = 0; u < t; u++) below += counts[u]
      const level = n - above - below
      let fire = 0.0
      for (let a = 0; a <= k; a++) {
        for (let b = 0; b <= k - a; b++) {
          if (above - a === below - b) {
            fire += choose(above, a) * choose(below, b) * choose(level, k - a - b)
          }
        }
      }
      const moved = (mass * fire) / choose(n, k)
      dist[t] -= moved
      dist[to] += moved
    }
  }
  return [dist, loss]
}

/** n choose k, 0 when k is out of range. */
function choose(n: number, k: number): number {
  if (k < 0 || k > n) {
    return 0.0
  }
  let c = 1.0
  for (let i = 0; i < k; i++) c = (c * (n - i)) / (i + 1)
  return c
}

/** coinOfFate: the expected worth of Kin's Coin of Fate for the open inmates
 * below Rainbow in `comp`: the odds it fires on one of the mornings left
 * times one firing's average gain, a random match's partner rising its tiers
 * less the matched inmate it removes. 0 without the Coin, a match or a morning. */
export function coinOfFate(ctx: Ctx, comp: Comp): number {
  const st = ctx.st
  const mornings = Math.max(0, st.maxDays - st.day)
  if (!st.has('coin') || mornings === 0) {
    return 0.0
  }
  let matched = 0
  let gain = 0.0
  for (let i = 0; i < comp.length; i++) {
    const k = comp[i]
    if (k < 2) continue
    const t = Math.floor(i / 4)
    const to = Math.min(TOP, t + tiers('coin'))
    matched += k
    gain += k * (worth(ctx, to) - 2.0 * ctx.v[t])
  }
  if (matched === 0) {
    return 0.0
  }
  const miss = 1.0 - data().tool('coin').chance / 100.0
  return ((1.0 - powi(miss, mornings)) * gain) / matched
}

/** A meal an eater can take: its tier and beast, the tiers the bite adds
 * before Muzzle, Skewer, Crown and the rolls, and the odds it upgrades at all. */
export interface Meal {
  tier: number
  beast: number
  base: number
  chance: number
}

/** Whether an eater of beast b eats countered inmates of lower tiers (Fanged
 * Guillotine for a Wolf, Cage Fight for any) and of higher ones (the Maul
 * for a Mammoth). */
function reachLower(ctx: Ctx, b: number): boolean {
  return (b === WOLF && ctx.fangs) || ctx.cageFight
}
function reachHigher(ctx: Ctx, b: number): boolean {
  return b === MAMMOTH && ctx.maul
}

/** The terms of a bite it can make. The base is `sureGain`'s before the
 * bonuses: the Maul lands a Mammoth `above` tiers over the meal, at least +1.
 * The chance is `upgradeChance`: Oppress costs a Wolf with the Fanged
 * Guillotine `oppressPerTier` percent per tier below it. */
const MAMMOTH = beastIndex('mammoth')
const WOLF = beastIndex('wolf')
const MAUL_ABOVE = data().tool('maul').above ?? 0
const OPPRESS_PER_TIER = data().oppressPerTier

function terms(ctx: Ctx, t: number, b: number, mt: number, mb: number): Meal {
  let base = 1
  if (b === MAMMOTH && ctx.maul) {
    base = Math.max(base, mt + MAUL_ABOVE - t)
  }
  let chance = 1.0
  if (mt < t && b === WOLF && ctx.fangs) {
    chance = fmax(100.0 - OPPRESS_PER_TIER * (t - mt), 0.0) / 100.0
  }
  return { tier: mt, beast: mb, base, chance }
}

/** The tiers an eater of beast b at tier t takes meals from: its own, then
 * the lower and higher ones it reaches. The list depends on the reach of `b`
 * and on `t` alone, so the few there are are built once. */
const MEAL_TIERS: number[][] = []
for (let key = 0; key < 20; key++) {
  const lower = (key & 1) !== 0
  const higher = (key & 2) !== 0
  const t = key >> 2
  const out: number[] = [t]
  if (lower) {
    for (let mt = 0; mt < t; mt++) out.push(mt)
  }
  if (higher) {
    for (let mt = t + 1; mt < RAINBOW; mt++) out.push(mt)
  }
  MEAL_TIERS.push(out)
}

function mealTiers(ctx: Ctx, t: number, b: number): number[] {
  const lower = reachLower(ctx, b)
  const higher = reachHigher(ctx, b)
  const key = t * 4 + (lower ? 1 : 0) + (higher ? 2 : 0)
  if (key < 0 || key >= MEAL_TIERS.length) {
    const out: number[] = [t]
    if (lower) {
      for (let mt = 0; mt < t; mt++) out.push(mt)
    }
    if (higher) {
      for (let mt = t + 1; mt < TOP; mt++) out.push(mt)
    }
    return out
  }
  return MEAL_TIERS[key]
}

/** meals: the meals in `comp` an eater of beast b at tier t can take, in a
 * fixed buffer (one slot per tier and beast) and their count: the same-tier
 * ones first in `ctx.eats` order, then the lower and higher tiers it reaches. */
export function meals(ctx: Ctx, t: number, b: number, comp: Comp): [Meal[], number] {
  const out: Meal[] = []
  for (const mt of mealTiers(ctx, t, b)) {
    for (const mb of foods(mt === t ? ctx.eats[b] : ctx.chain[b])) {
      if (comp[mt * 4 + mb] > 0) {
        out.push(terms(ctx, t, b, mt, mb))
      }
    }
  }
  return [out, out.length]
}

/** Whether an eater of beast b at tier t has a meal in `comp`. */
export function fed(ctx: Ctx, t: number, b: number, comp: Comp): boolean {
  const tiers = mealTiers(ctx, t, b)
  for (let i = 0; i < tiers.length; i++) {
    const mt = tiers[i]
    const list = foods(mt === t ? ctx.eats[b] : ctx.chain[b])
    for (let j = 0; j < list.length; j++) {
      if (comp[mt * 4 + list[j]] > 0) return true
    }
  }
  return false
}

/** rise: value from here on for an eater of beast b that just reached tier t;
 * its beast re-rolls (kept under Cage Fight), then it chains into a random
 * valid meal if it has one. With the Crowded Beastcage the meal's re-sealed
 * cell may open with a fresh door inmate (engine doDevour); only its worth
 * is counted, not the chain it could feed. */
export function rise(ctx: Ctx, t: number, b: number, comp: Comp, crowd: number): number {
  const cage = ctx.beastcage * ctx.sideValue
  if (t >= TOP) {
    return ctx.r + cage
  }
  if (ctx.cageFight) {
    return cage + land(ctx, t, b, comp, crowd)
  }
  let sum = 0.0
  for (let beast = 0; beast < 4; beast++) {
    sum += land(ctx, t, beast, comp, crowd)
  }
  return cage + sum / 4.0
}

/** land: value from here on for an eater of beast b settled at tier t. */
function land(ctx: Ctx, t: number, b: number, comp: Comp, crowd: number): number {
  if (!ctx.revenge) {
    return feed(ctx, t, b, comp, crowd)
  }
  // Avenger's Casket: with its chance a door opens with a plain counter of
  // the new form at its tier (engine doDevour), whatever the tools widen.
  const casket = data().tool('revenge').chance / 100.0
  const n = foods(ctx.chain[b]).length
  let spawned = 0.0
  for (const f of foods(ctx.chain[b])) {
    comp[t * 4 + f] += 1
    spawned += ctx.v[t] + feed(ctx, t, b, comp, crowd + 1)
    comp[t * 4 + f] -= 1
  }
  return (casket * spawned) / n + (1.0 - casket) * feed(ctx, t, b, comp, crowd)
}

/** The memo key of feed: tier, beast, the exact crowd under the Muzzle (its
 * bonus starts once the chain has shrunk the crowd to max_inmates) and the
 * counts an eater at tier t can reach. */
const KEY_CHARS: string[] = Array.from({ length: 64 }, (_, i) => String.fromCharCode(0x30 + i))

function feedKey(ctx: Ctx, t: number, b: number, comp: Comp, crowd: number): string {
  let head = (t | (b << 3)) >>> 0
  if (ctx.muzzle) head = (head | (1 << 5) | ((crowd + 1024) << 6)) >>> 0
  // The slots below Rainbow it reads: from tier t up, and below it only the
  // beasts the chain can eat down (their bits repeated once per tier).
  const slots = (0xffffff & ((ctx.down[b] & 15) * 0x11111 | ~((1 << (4 * t)) - 1))) >>> 0
  let key = String.fromCharCode(head & 0xffff, head >>> 16)
  let s = slots
  while (s !== 0) {
    const i = 31 - Math.clz32(s & -s) // trailing_zeros
    s = (s & (s - 1)) >>> 0
    key += KEY_CHARS[(comp[i] + 2) & 63]
  }
  return key
}

/** feed: an eater of beast b at tier t takes a random valid meal; with none,
 * the chain ends and it keeps its tier. */
export function feed(ctx: Ctx, t: number, b: number, comp: Comp, crowd: number): number {
  if (!fed(ctx, t, b, comp)) {
    return ctx.v[t]
  }
  const key = feedKey(ctx, t, b, comp, crowd)
  const hit = ctx.memo.get(key)
  if (hit !== undefined) {
    return hit
  }
  const [options, n] = meals(ctx, t, b, comp)
  // `fed` reads the slots `meals` takes from, so there is at least one.
  let total = 0
  for (let i = 0; i < n; i++) total += comp[options[i].tier * 4 + options[i].beast]
  let sum = 0.0
  for (let i = 0; i < n; i++) {
    const m = options[i]
    const idx = m.tier * 4 + m.beast
    const k = comp[idx]
    comp[idx] -= 1
    sum += k * bite(ctx, t, b, m, true, comp, crowd)
    comp[idx] += 1
  }
  const out = sum / total
  ctx.memo.set(key, out)
  return out
}

/** bite: one bite by an eater at tier t; the meal is gone and the eater rises
 * (engine doDevour). `chained` marks a bite after the day's first, which
 * the Barbed Collar rolls on. A failed Oppress roll adds nothing, the rolled
 * tiers included, and the eater stays at tier t. */
export function bite(
  ctx: Ctx,
  t: number,
  b: number,
  meal: Meal,
  chained: boolean,
  comp: Comp,
  crowd: number,
): number {
  let gain = meal.base
  if (ctx.muzzle && crowd <= (data().tool('muzzle').maxInmates ?? 0)) {
    gain += tiers('muzzle')
  }
  if (ctx.skewer && b === beastIndex('rat')) {
    gain += tiers('skewer')
  }
  if (ctx.crown && b === beastIndex('lion')) {
    gain += tiers('crown')
  }
  const extra = ctx.extra[chained ? 1 : 0]
  let won = 0.0
  for (let k = 0; k < extra.length; k++) {
    const p = extra[k]
    if (p > 0.0) won += p * rise(ctx, Math.min(TOP, t + gain + k), b, comp, crowd - 1)
  }
  const rest =
    meal.chance < 1.0
      ? meal.chance * won + (1.0 - meal.chance) * rise(ctx, Math.min(TOP, t), b, comp, crowd - 1)
      : won
  return -worth(ctx, meal.tier) + rest
}

/** devourDelta: expected change in value from a devour, the chosen first meal
 * (tier, beast) then the random chain. `comp` leaves out the eater and still
 * holds the meal. */
export function devourDelta(
  ctx: Ctx,
  tier: number,
  beast: number,
  meal: [number, number],
  scratch: boolean,
  comp: Comp,
  crowd: number,
): number {
  const [mt, mb] = meal
  const i = mt * 4 + mb
  const mealTerms = scratch
    ? { tier, beast: mb, base: 1 + ctx.scratchExtra, chance: 1.0 }
    : terms(ctx, tier, beast, mt, mb)
  if (!scratch) {
    comp[i] -= 1
  }
  const value = bite(ctx, tier, beast, mealTerms, false, comp, crowd) - ctx.v[tier]
  if (!scratch) {
    comp[i] += 1
  }
  return value
}

/** bestMeal: the best first meal for an eater of this tier and beast, as
 * (value, (meal tier, meal beast)); (-inf, None) when it has none. */
export function bestMeal(
  ctx: Ctx,
  tier: number,
  beast: number,
  comp: Comp,
  crowd: number,
): [number, [number, number] | null] {
  let bestValue = -Infinity
  let best: [number, number] | null = null
  const [options, n] = meals(ctx, tier, beast, comp)
  for (let i = 0; i < n; i++) {
    const m = options[i]
    const value = devourDelta(ctx, tier, beast, [m.tier, m.beast], false, comp, crowd)
    if (value > bestValue) {
      bestValue = value
      best = [m.tier, m.beast]
    }
  }
  return [bestValue, best]
}

/** chainOdds: exact odds that a devour from cell `from` into cell `to` chains
 * up to Rainbow, and its expected bites, by the rules of `rise` with Avenger's
 * Casket (engine doDevour: after each bite, while a door is left, its chance
 * to open one with a meal for the eater's new tier and beast) and no other tools. */
export function chainOdds(st: State, from: number, to: number): [number, number] {
  const target = st.cells[to]
  const meal = target.sealed ? target.hidden : target.inmate
  const eater = st.cells[from].inmate
  if (eater === null || meal === null) return [0.0, 0.0]
  const [comp] = composition(st, from)
  if (!target.sealed) {
    comp[meal.tier * 4 + beastIndex(meal.beast)] -= 1
  }
  // With reusable cells a meal's cell seals again and a scratched door stays sealed.
  const reseal = st.params.reusableCells
  const doors =
    st.sealedCells().length + (reseal && !target.sealed ? 1 : 0) - (!reseal && target.sealed ? 1 : 0)
  const casket = st.has('revenge') ? data().tool('revenge').chance / 100.0 : 0.0
  const odds = new Odds(eatsTable(st), foodChain(), casket, reseal, doors, comp)
  const gain = target.sealed && target.scratch ? 2 + (st.params.scratchStacksBase ? 1 : 0) : 1
  const [p, n] = odds.atTier(Math.min(TOP, eater.tier + gain))
  return [p, 1.0 + n]
}

/** (tier, beast, doors, the tiers' composition from tier up) to the odds. */
class Odds {
  eats: number[]
  /** Who each beast eats without tools: the meals the Casket brings. */
  food: number[]
  /** Avenger's Casket's chance to fire after a bite; 0 without it. */
  casket: number
  /** A meal's cell seals again (reusable cells). */
  reseal: boolean
  doors: number
  comp: Comp
  memo: Map<string, [number, number]>

  constructor(eats: number[], food: number[], casket: number, reseal: boolean, doors: number, comp: Comp) {
    this.eats = eats
    this.food = food
    this.casket = casket
    this.reseal = reseal
    this.doors = doors
    this.comp = comp
    this.memo = new Map<string, [number, number]>()
  }

  /** (P(reach Rainbow), expected further bites) from tier t, beast re-rolling. */
  atTier(t: number): [number, number] {
    if (t >= TOP) {
      return [1.0, 0.0]
    }
    let p = 0.0
    let n = 0.0
    for (let b = 0; b < 4; b++) {
      let [pb, nb] = this.eat(t, b)
      if (this.casket > 0.0 && this.doors > 0) {
        const count = foods(this.food[b]).length
        let ps = 0.0
        let ns = 0.0
        this.doors -= 1
        for (const f of foods(this.food[b])) {
          this.comp[t * 4 + f] += 1
          const [pf, nf] = this.eat(t, b)
          this.comp[t * 4 + f] -= 1
          ps += pf / count
          ns += nf / count
        }
        this.doors += 1
        pb = this.casket * ps + (1.0 - this.casket) * pb
        nb = this.casket * ns + (1.0 - this.casket) * nb
      }
      p += pb / 4.0
      n += nb / 4.0
    }
    return [p, n]
  }

  eat(t: number, b: number): [number, number] {
    // The doors only change the odds through the Casket.
    const doors = this.casket > 0.0 ? this.doors : 0
    const key = `${t}|${b}|${doors}|${this.comp.slice(t * 4, 20).join(',')}`
    const hit = this.memo.get(key)
    if (hit !== undefined) {
      return hit
    }
    const eats = this.eats[b]
    let total = 0
    for (const f of foods(eats)) total += this.comp[t * 4 + f]
    let out: [number, number] = [0.0, 0.0]
    if (total !== 0) {
      let p = 0.0
      let n = 0.0
      const reseal = this.reseal ? 1 : 0
      for (const f of foods(eats)) {
        const k = this.comp[t * 4 + f]
        if (k === 0) {
          continue
        }
        this.comp[t * 4 + f] -= 1
        this.doors += reseal
        const [pf, nf] = this.atTier(t + 1)
        this.doors -= reseal
        this.comp[t * 4 + f] += 1
        p += (k * pf) / total
        n += (k * (nf + 1.0)) / total
      }
      out = [p, n]
    }
    this.memo.set(key, out)
    return out
  }
}
