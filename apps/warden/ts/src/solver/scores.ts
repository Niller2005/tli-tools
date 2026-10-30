//! Valuing moves (js/solver.js 336-497): incident markers, patrol
//! destinations, prey marks, devours, swaps and the gift picks.

import { RAINBOW, TYRANNY, beastIndex, data, type Tool } from '@/engine/data'
import { apply, isOk, type Action } from '@/engine/actions'
import { eaterMask, sureGain, type Bite } from '@/engine/devour'
import { CHAIN_REACTION, EXECUTION_EFFICIENCY, SEWER_RATWAY } from '@/engine/incidents'
import { clockwisePath, fittingIncidents, land, markerSeen, stepsBetween } from '@/engine/rules'
import type { Cell, Inmate, State } from '@/engine/state'
import { an, describe, incidentName, plural } from '@/engine/text'

import { bestMeal, coinOfFate, devourDelta, replaceOdds } from './chain'
import { activation, executionValue, freshValue, stairDelta, swapValue } from './values'
import {
  TOP,
  beasts,
  composition,
  distWorth,
  doorDist,
  fmax,
  goalTerm,
  powi,
  seenDoor,
  tierValues,
  worth,
  type Comp,
  type Ctx,
  type Dist,
  type Params,
  type Rng32,
} from './mod'

/** Sorts best first, keeping ties in order (the JS stable sort on b - a). */
function bestFirst(out: [number, number][]): void {
  out.sort((a, b) => {
    const d = b[1] - a[1]
    return Number.isNaN(d) ? 0 : d < 0 ? -1 : d > 0 ? 1 : 0
  })
}

/** incidentScore: the value of the incident marker on a destination. Of a
 * seen marker only the two incidents the engine simulates have a value; an
 * unseen one also gets `wIncident` for the odds of any other. */
export function incidentScore(ctx: Ctx, c: Cell, comp: Comp): number {
  // Behind a door the executioner is whoever comes out; a Chain Reaction
  // landing opens it from the side.
  const execution = (): number => {
    if (!c.sealed) {
      return c.inmate === null ? 0.0 : executionValue(ctx, c.inmate.tier, beastIndex(c.inmate.beast), comp)
    }
    const [dist, beast] = doorDist(ctx.st, c, !ctx.st.chain)
    const [beastList, share] = beasts(beast)
    let exec = 0.0
    for (let t = 0; t < dist.length; t++) {
      const p = dist[t]
      for (const b of beastList) {
        exec += (p * share) * executionValue(ctx, t, b, comp)
      }
    }
    return exec
  }
  const id = c.event
  // A marker whose incident the player can't see is any that fits
  // its cell, at the draw odds.
  if (id !== null && !markerSeen(ctx.st)) {
    let exec = 0.0
    let chain = 0.0
    let total = 0.0
    for (const fit of fittingIncidents(ctx.st, c.n)) {
      const w = fit.weight
      total += w
      if (fit.id === EXECUTION_EFFICIENCY) exec += w
      else if (fit.id === CHAIN_REACTION) chain += w
    }
    if (total === 0.0) {
      return 0.0
    }
    const execShare = exec / total
    const chainShare = chain / total
    let score = chainShare * ctx.p.wChain + (1.0 - execShare - chainShare) * ctx.p.wIncident
    if (execShare > 0.0) {
      score += execShare * execution()
    }
    return score
  }
  if (id === EXECUTION_EFFICIENCY) return execution()
  if (id === CHAIN_REACTION) return ctx.p.wChain
  return 0.0
}

/** Incidents whose effect rolls no dice, played once. */
const SURE_INCIDENTS: number[] = [213, 231, 232, SEWER_RATWAY]

/** The seed of sample `k` of a copy landed on cell `n`: fixed, so a copy
 * never reads the game's own dice. */
function sampleSeed(st: State, n: number, k: number): number {
  return (Math.imul(st.day, 0x9e3779b9) ^ Math.imul(n, 0x85ebca6b) ^ Math.imul(k + 1, 0xc2b2ae35)) >>> 0
}

/** A copy of `st` with the warden landed on cell `n`, its marker's incident
 * pending. A Sewer Ratway choice in progress is this landing. */
function landed(st: State, n: number, seed: number): State {
  const trial = st.clone()
  trial.rng = seed
  trial.pending = []
  land(trial, n)
  return trial
}

/** The mean board gain, by tiers `(v, r)`, of `action` on a copy landed on
 * cell `n` over `samples` samples: a marker's incident (`Action::Event`) or
 * the Interrogation Room's Bestow. Instigate's marker adds no board value. */
function landingGain(st: State, n: number, action: Action, samples: number, tiers: [number[], number]): number {
  const [v, r] = tiers
  let gain = 0.0
  for (let k = 0; k < samples; k++) {
    const seed = sampleSeed(st, n, k)
    const trial = landed(st, n, seed)
    // Tyranny's extra Room cards run on landing, so they count as its gain.
    let before: number
    if (n === data().room && st.theme === TYRANNY) {
      const plain = st.clone()
      plain.theme = null
      before = boardValue(landed(plain, n, seed), v, r)
    } else {
      before = boardValue(trial, v, r)
    }
    // A refused action (a Treasure gift queued first) still keeps what landing did.
    apply(trial, action)
    gain += boardValue(trial, v, r) - before
  }
  return gain / samples
}

/** The `why` of incidentScore: what waits on the marker, if there is one. */
export function incidentWhy(st: State, c: Cell): string | null {
  const id = c.event
  if (id === null) return null
  if (!markerSeen(st)) return 'a Prison Incident waits there'
  if (id === EXECUTION_EFFICIENCY) return 'an Execution Efficiency waits there'
  if (id === CHAIN_REACTION) return 'a Chain Reaction waits there'
  return `${an(incidentName(id))} waits there`
}

/** The `why` patrolScores gives landing on cell `n`. */
export function patrolWhy(st: State, n: number): string {
  const c = st.cells[n]
  const why = incidentWhy(st, c)
  if (why !== null) return why
  if (st.chain) {
    const sealed = clockwisePath(st, n).filter((k) => st.cells[k].sealed).length
    return `the chain opens ${plural(sealed, 'door')} on the way`
  }
  if (c.sealed && c.nest !== null) {
    return `it destroys the Rat Nest due on day ${c.nest.due}`
  }
  if (c.sealed) return 'a new Inmate, who may consume today'
  if (c.inmate !== null) return `its ${describe(c.inmate)} can act today`
  if (n === data().room) return 'Instigate or Bestow waits there'
  return 'an empty cell'
}

/** patrolScores: scores landing on each of `cells`, as (cell, score), best first. */
export function patrolScores(ctx: Ctx, cells: number[]): [number, number][] {
  const st = ctx.st
  const p = ctx.p
  const [board, crowd] = composition(st, null)
  const swapLeft = st.used.swap < st.params.swapsPerDay
  // The door in cell c, by whether its opening sets off the "after opening"
  // instruments; an unseen door is valued once per kind of opening.
  const fresh: (number | null)[] = [null, null]
  // The scratch bite each cell's opening gives up.
  const loss: number[] = st.cells.map((c) => scratchLoss(ctx, c))
  const doorNow = (b: Comp, c: Cell, after: boolean): number => {
    const seen = seenDoor(c)
    const cached = fresh[after ? 1 : 0]
    if (!seen && cached !== null) {
      return cached
    }
    const [dist, beast] = doorDist(st, c, after)
    const value = freshValue(ctx, dist, beast, b, crowd + 1, swapLeft) - p.wOpen * loss[c.n]
    if (!seen) {
      fresh[after ? 1 : 0] = value
    }
    return value
  }
  const known = (cell: Cell): number => {
    const [comp, cellCrowd] = composition(st, cell.n)
    const i = cell.inmate as Inmate
    return activation(ctx, i.tier, beastIndex(i.beast), comp, cellCrowd, swapLeft)
  }
  const held = HELD_TERMS.some((t) => st.has(t)) ? Held.of(ctx, loss) : null
  const tiers = giftTiers(ctx.st, ctx.p, [ctx.v, ctx.r, ctx.lastDay])
  const out: [number, number][] = []
  for (const n of cells) {
    const c = st.cells[n]
    const steps = stepsBetween(st.position, n)
    let score = p.wStep * steps
    // Objective progress: the steps walked, the doors opened, an incident set off.
    if (ctx.goal !== null) {
      const goal = ctx.goal
      let gain = 0
      if (goal.kind === 'moveDistance') {
        gain = steps
      } else if (goal.kind === 'openCellCount') {
        gain = st.chain
          ? clockwisePath(st, n).filter((k) => st.cells[k].sealed).length
          : c.sealed && n !== data().room
            ? 1
            : 0
      } else if (goal.kind === 'eventTriggerCount') {
        gain = c.event !== null && n !== data().room ? 1 : 0
      }
      score += goalTerm(goal, p, gain)
    }
    // Landing on a marker fires its incident, which can't be declined.
    score += incidentScore(ctx, c, board)
    // Any other known marker, and the Interrogation Room, are played on a copy.
    if (c.event !== null && markerSeen(st) && c.event !== EXECUTION_EFFICIENCY && c.event !== CHAIN_REACTION) {
      const samples = SURE_INCIDENTS.includes(c.event) ? 1 : 3
      score += p.wEvent * landingGain(st, n, { type: 'event' }, samples, tiers)
    } else if (n === data().room) {
      const bestow: Action = { type: 'choose', id: 'bestow' }
      const t = st.theme === TYRANNY ? p.roomTyranny : 1.0
      score += t * p.wEvent * landingGain(st, n, bestow, 3, tiers)
    }
    // The sealed doors left after this landing's own openings.
    let left = held === null ? 0 : held.sealed
    let leftWorth = held === null ? 0.0 : held.side
    if (held !== null && c.sealed && !st.chain) {
      left -= 1
      leftWorth -= sideWorth(ctx, c, loss)
    }
    if (st.chain) {
      // Chain Reaction opens every door on the walk from the side.
      let opened = 0.0
      for (const k of clockwisePath(st, n).filter((k) => st.cells[k].sealed)) {
        const d = st.cells[k]
        if (held !== null) {
          left -= 1
          leftWorth -= sideWorth(ctx, d, loss)
        }
        if (k === n) continue
        opened += sideWorth(ctx, d, loss)
      }
      let here = 0.0
      if (c.sealed) {
        here = doorNow(board, c, false)
      } else if (c.inmate !== null) {
        here = p.wWalk * known(c)
      }
      score += p.wOpen * opened + here
    } else if (c.sealed) {
      score += doorNow(board, c, true)
      // Squirming Iron Box: the patrol opens the door's own inmate and
      // destroys the nest, whose Rare Rat hatches if it is due in the run.
      if (c.nest !== null && c.nest.due <= st.maxDays) {
        score -= ctx.v[st.params.nestTier]
      }
    } else if (c.inmate !== null) {
      score += p.wWalk * known(c)
    }
    // Iron Tongs of Lust: a Replace left for the Tusk cell's inmate.
    if (swapLeft && c.ivory && c.inmate !== null && !c.sealed) {
      score += p.wWalk * tuskGain(ctx)
    }
    if (held !== null) {
      // A dice patrol onto a door sets off the "after opening" instruments.
      const opened = c.sealed && !st.chain ? doorDist(st, c, true)[0] : null
      score += heldTerms(ctx, held, n, steps, opened, left, leftWorth)
    }
    out.push([n, score])
  }
  bestFirst(out)
  return out
}

/** The instruments `heldTerms` prices on a patrol landing. */
const HELD_TERMS: Tool[] = ['keys', 'forgedkey', 'fire', 'blacklist', 'shortchain', 'longchain']

/** The board before a patrol, as the held instruments see it: the sealed
 * doors and their worth opened from the side, the open inmates' tiers, and
 * the scratch bite each cell's opening gives up. */
class Held {
  sealed: number
  side: number
  board: number[]
  loss: number[]

  constructor(sealed: number, side: number, board: number[], loss: number[]) {
    this.sealed = sealed
    this.side = side
    this.board = board
    this.loss = loss
  }

  /** The held board of `ctx`, with the scratch bite of each cell's opening. */
  static of(ctx: Ctx, loss: number[]): Held {
    const st = ctx.st
    const doors = st.cells.filter((c) => c.sealed)
    let side = 0.0
    for (const c of doors) side += sideWorth(ctx, c, loss)
    const board: number[] = []
    for (const c of st.cells) {
      if (c.inmate !== null && !c.sealed) board.push(c.inmate.tier)
    }
    return new Held(doors.length, side, board, [...loss])
  }
}

/** The worth of sealed cell `c` opened from the side (no "after opening"
 * instrument), less the scratch bite its opening gives up (`loss` by cell). */
function sideWorth(ctx: Ctx, c: Cell, loss: number[]): number {
  const worthOf = seenDoor(c) ? distWorth(ctx.v, ctx.r, doorDist(ctx.st, c, false)[0]) : ctx.sideValue
  return worthOf - loss[c.n]
}

/** The scratch bite given up by opening sealed cell `c`. With an open Wolf of
 * the door's tier: half the most it gains biting the door over its best
 * other meal (it may not get its turn first). Without one: the share of the
 * open inmates that are lower Wolves, times 3, times the scratch rise. */
function scratchLoss(ctx: Ctx, c: Cell): number {
  if (c.hidden === null || !c.sealed || !c.scratch || c.hidden.tier >= RAINBOW) return 0.0
  const h = c.hidden
  const st = ctx.st
  const t = h.tier
  const wolf = beastIndex('wolf')
  const open: { n: number; i: Inmate }[] = []
  for (const w of st.cells) {
    if (w.inmate !== null && !w.sealed) open.push({ n: w.n, i: w.inmate })
  }
  const wolves = open.filter((o) => o.i.beast === 'wolf' && o.i.tier === h.tier).map((o) => o.n)
  if (wolves.length === 0) {
    const lower = open.filter((o) => o.i.beast === 'wolf' && o.i.tier < h.tier).length
    const share = lower / Math.max(open.length, 1)
    return 3.0 * share * riseWorth(ctx, t, 1 + ctx.scratchExtra)
  }
  let loss = 0.0
  for (const n of wolves) {
    const [comp, crowd] = composition(st, n)
    const bite = devourDelta(ctx, t, wolf, [t, wolf], true, comp, crowd)
    const other = fmax(bestMeal(ctx, t, wolf, comp, crowd)[0], 0.0)
    loss = fmax(loss, 0.5 * (bite - other))
  }
  return loss
}

/** What `by` tiers more are worth to an inmate of tier `t`; a Chromatic is
 * worth `r` and nothing rises past the top tier. */
function riseWorth(ctx: Ctx, t: number, by: number): number {
  const top = ctx.st.topTier()
  return worth(ctx, Math.min(Math.max(t + by, 0), top)) - worth(ctx, t)
}

/** What the held opening and movement instruments add to a dice landing on
 * cell `n`, `steps` away (engine after_opening and shackles). `opened` is the
 * tier odds of the inmate a patrol opening brings out, null when the landing
 * opens no door on the patrol; `left` doors stay sealed after the landing's
 * own openings, worth `leftWorth` in all from the side. */
function heldTerms(ctx: Ctx, h: Held, n: number, steps: number, opened: Dist | null, left: number, leftWorth: number): number {
  const st = ctx.st
  const d = data()
  const wOpen = ctx.p.wOpen
  const chance = (t: Tool): number => (st.has(t) ? d.tool(t).chance / 100.0 : 0.0)
  // A random sealed door left, opened from the side.
  const randomDoor = left > 0 ? leftWorth / left : 0.0
  // The open inmates after the landing, the opened one included, and the
  // sum of what `by` tiers more are worth to them.
  const board = h.board.length + (opened !== null ? 1 : 0)
  const rises = (by: number): number => {
    let sum = 0.0
    for (const t of h.board) sum += riseWorth(ctx, t, by)
    if (opened !== null) {
      let odds = 0.0
      for (let t = 0; t < opened.length; t++) odds += opened[t] * riseWorth(ctx, t, by)
      sum += odds
    }
    return sum
  }
  let gain = 0.0
  if (opened !== null) {
    // Executioner's Blacklist: with few doors left after this one (counted
    // before the Iron, Keys and Forged Key open theirs), random inmates rise.
    // The game counts the doors locked before this one opens, so it fires
    // once fewer than `maxSealed` stay locked after it.
    const black = d.tool('blacklist')
    if (st.has('blacklist') && left < (black.maxSealed ?? 0)) {
      const picks = Math.min(black.count ?? 0, board)
      gain += (picks / board) * rises(black.tiers ?? 0)
    }
    // Searing Branding Iron: a copy of the opened inmate opens another door.
    if (left > 0) {
      gain += chance('fire') * wOpen * distWorth(ctx.v, ctx.r, opened)
    }
    // Lost Ring of Keys: the doors on both sides open from the side.
    if (st.has('keys')) {
      const cells = d.cellCount
      let sides = 0.0
      for (const k of [n + cells - 1, n + 1]) {
        const cell = st.cells[k % cells]
        if (cell.sealed && cell.n !== d.room) sides += sideWorth(ctx, cell, h.loss)
      }
      gain += chance('keys') * wOpen * sides
    }
    // Forged Key: more random doors open from the side.
    const forged = Math.min(d.tool('forgedkey').count ?? 0, left)
    gain += chance('forgedkey') * wOpen * forged * randomDoor
  }
  // Short-Chained Shackles: a short move opens random doors.
  const short = d.tool('shortchain')
  if (steps > 0 && steps <= (short.maxSteps ?? 0)) {
    gain += chance('shortchain') * wOpen * Math.min(short.count ?? 0, left) * randomDoor
  }
  // Long-Chained Shackles: a long move raises a random open inmate.
  const long = d.tool('longchain')
  if (steps >= (long.minSteps ?? Number.MAX_SAFE_INTEGER) && board > 0) {
    gain += chance('longchain') * rises(long.tiers ?? 0) / board
  }
  return gain
}

/** linkValue: what a prey mark still promises; both inmates rise a tier each morning. */
export function linkValue(ctx: Ctx, lion: number, prey: number, rounds: number): number {
  let value = 0.0
  for (const id of [lion, prey]) {
    const n = ctx.st.cellOf(id)
    if (n === null) continue
    const i = ctx.st.cells[n].inmate
    if (i === null) continue
    const t = i.tier
    // Rust's `as usize` on a negative number saturates at 0.
    const to = Math.min(TOP, Math.max(0, i.tier + rounds))
    value += worth(ctx, to) - ctx.v[t]
  }
  return value
}

/** linkLoss: the prey mark an action would end, valued (0 if none). */
export function linkLoss(ctx: Ctx, inmate: Inmate | null, certain: boolean): number {
  if (inmate === null) return 0.0
  const k = ctx.st.linkOf(inmate.id)
  if (k === null) return 0.0
  const link = ctx.st.prey[k]
  // A Lion that devours re-rolls its beast; 1 in 4 times it stays a Lion.
  return linkValue(ctx, link.lion, link.prey, link.rounds) * (certain || link.prey === inmate.id ? 1.0 : 0.75)
}

/** coinLoss: the worth of Kin's Coin of Fate lost when `gone` leave the board;
 * `board` holds every open inmate below Rainbow. */
function coinLoss(ctx: Ctx, board: Comp, gone: Inmate[]): number {
  if (!ctx.st.has('coin')) {
    return 0.0
  }
  const after = [...board]
  for (const i of gone) {
    if (i.tier >= RAINBOW) continue
    after[i.tier * 4 + beastIndex(i.beast)] -= 1
  }
  return coinOfFate(ctx, board) - coinOfFate(ctx, after)
}

/** The open inmates' tiers by cell, as Ravenous Chains reads them, -1 where
 * none stands; empty without the Chains or a morning left. */
function chainsRing(st: State): number[] {
  if (!st.has('chains') || st.maxDays <= st.day) {
    return []
  }
  return st.cells.map((c) => (c.inmate !== null && !c.sealed ? c.inmate.tier : -1))
}

/** chainsLoss: what Ravenous Chains takes on the next morning from the board
 * `ring` (`chainsRing`, 0 when empty): over the tied top inmates, the worth
 * of the open ring neighbours it removes less the expected worth of the
 * centre's rise, one roll per removal. */
function chainsLoss(ctx: Ctx, ring: number[]): number {
  let top = -1
  for (const t of ring) {
    if (t > top) top = t
  }
  if (top < 0) return 0.0
  const def = data().tool('chains')
  const p = def.chance / 100.0
  const by = def.tiers ?? 0
  const n = ring.length
  let tops = 0
  let loss = 0.0
  for (let c = 0; c < n; c++) {
    if (ring[c] !== top) continue
    tops += 1
    const sides = [ring[(c + n - 1) % n], ring[(c + 1) % n]]
    const removed = sides.filter((t) => t >= 0).length
    let removedWorth = 0.0
    for (const t of sides) {
      if (t >= 0) removedWorth += worth(ctx, t)
    }
    loss += removedWorth
    // At most two removals: j of them land in [1, removed, 1] ways.
    for (let j = 0; j <= removed; j++) {
      const odds = [1.0, removed, 1.0][j] * powi(p, j) * powi(1.0 - p, removed - j)
      loss -= odds * riseWorth(ctx, top, j * by)
    }
  }
  return loss / tops
}

/** The Tusk's gain on a Replace in a marked cell: random open inmates below
 * Rainbow rise a tier each. */
function tuskGain(ctx: Ctx): number {
  const st = ctx.st
  const board: number[] = []
  for (const c of st.cells) {
    if (c.inmate !== null && !c.sealed && c.inmate.tier < RAINBOW) board.push(c.inmate.tier)
  }
  let sum = 0.0
  for (const t of board) sum = sum + ctx.v[t + 1] - ctx.v[t]
  const lift = sum / Math.max(board.length, 1)
  return Math.min(st.params.ivoryCount, board.length) * lift
}

/** huntGain: what a Hunt on the target in `cell` adds, the value of its prey mark. */
function huntGain(ctx: Ctx, cell: number): number {
  const st = ctx.st
  const lion = st.cells[st.position].inmate as Inmate
  const prey = st.cells[cell].inmate as Inmate
  return linkValue(ctx, lion.id, prey.id, st.params.preyRounds)
}

/** bestHunt: the target among `options` whose prey mark is worth the most, with its gain. */
export function bestHunt(ctx: Ctx, options: number[]): [number, number] | null {
  let best: [number, number] | null = null
  for (const n of options) {
    const g = huntGain(ctx, n)
    if (best === null || !(best[1] >= g)) best = [n, g]
  }
  return best
}

/** devourScores: the given first or chain bites for the warden's inmate, as
 * (cell, score), best first. */
export function devourScores(ctx: Ctx, options: Bite[]): [number, number][] {
  const st = ctx.st
  const here = st.cells[st.position]
  if (here.inmate === null || here.sealed) return []
  const eater = here.inmate
  const [comp, crowd] = composition(st, st.position)
  const board = composition(st, null)[0]
  const tier = eater.tier
  const beast = beastIndex(eater.beast)
  const own = linkLoss(ctx, eater, false)
  const ring = chainsRing(st)
  const chainsBefore = chainsLoss(ctx, ring)
  const block = ring.length === 0 ? 0 : st.boardCells().length
  const out: [number, number][] = []
  for (const o of options) {
    const target = st.cells[o.cell]
    const meal = (o.scratch ? target.hidden : target.inmate) as Inmate
    const mealLink = o.scratch ? 0.0 : linkLoss(ctx, meal, true)
    const sameLink = own !== 0.0 && mealLink !== 0.0 && st.linkOf(eater.id) === st.linkOf(meal.id)
    let loss = sameLink ? fmax(own, mealLink) : own + mealLink
    // The eater leaves its tier and the meal the board (the chain after is not priced).
    const gone = o.scratch ? [eater] : [eater, meal]
    loss += coinLoss(ctx, board, gone)
    // Ravenous Chains: the meal's cell empties and the eater lands
    // its sure gain up (a Chromatic leaves for the vault).
    if (ring.length !== 0) {
      const e = ring[st.position]
      const m = ring[o.cell]
      const landing = Math.min(eater.tier + sureGain(st, eater, meal, o.scratch, block), st.topTier())
      ring[o.cell] = -1
      ring[st.position] = landing >= RAINBOW ? -1 : landing
      loss += chainsLoss(ctx, ring) - chainsBefore
      ring[o.cell] = m
      ring[st.position] = e
    }
    const stairLoss = o.scratch ? 0.0 : stairDelta(ctx, comp, meal.tier, beastIndex(meal.beast), -1)
    const delta = devourDelta(ctx, tier, beast, [meal.tier, beastIndex(meal.beast)], o.scratch, comp, crowd)
    let score = delta - loss + stairLoss
    // Objective progress: a Consume, or the eater's sure landing reaching the rarity.
    if (ctx.goal !== null) {
      const goal = ctx.goal
      let gain = 0.0
      if (goal.kind === 'devourCount') {
        gain = 1.0
      } else if (goal.kind === 'reachRating') {
        const landing = Math.min(
          eater.tier + sureGain(st, eater, meal, o.scratch, st.boardCells().length),
          st.topTier(),
        )
        gain = landing >= goal.rating ? 1.0 : 0.0
      }
      score += goalTerm(goal, ctx.p, gain)
    }
    out.push([o.cell, score])
  }
  bestFirst(out)
  return out
}

/** swapGainHere: a swap in the warden's cell, the new inmate's worth over the
 * old one less any prey mark it ends, plus the Tusk bonus if the cell has one. */
export function swapGainHere(ctx: Ctx): number {
  const st = ctx.st
  const here = st.cells[st.position]
  if (here.inmate === null || here.sealed || st.used.swap >= st.params.swapsPerDay) {
    return -Infinity
  }
  const inmate = here.inmate
  const [comp, crowd] = composition(st, st.position)
  let gain =
    swapValue(ctx, inmate.tier, comp, crowd - 1) -
    linkLoss(ctx, inmate, true) -
    coinLoss(ctx, composition(st, null)[0], [inmate])
  // Gaoler's Execution Axe: a swap that raises the rarity, counting the
  // Stake's and the Maiden's rises, opens random sealed cells.
  if (st.has('axe')) {
    const doors = Math.min(data().tool('axe').count ?? 0, st.sealedCells().length)
    const dist = replaceOdds(ctx, inmate.tier, comp, crowd - 1)[0]
    let rise = 0.0
    for (let t = inmate.tier + 1; t < dist.length; t++) rise += dist[t]
    gain += rise * doors * ctx.p.wOpen * ctx.openValue
  }
  // Ravenous Chains: the new inmate's tier follows the Replace odds.
  const ring = chainsRing(st)
  if (ring.length !== 0) {
    const before = chainsLoss(ctx, ring)
    let after = 0.0
    const dist = replaceOdds(ctx, inmate.tier, comp, crowd - 1)[0]
    for (let t = 0; t < dist.length; t++) {
      const p = dist[t]
      if (p <= 0.0) continue
      ring[st.position] = t >= TOP ? -1 : t
      after += p * chainsLoss(ctx, ring)
    }
    gain -= after - before
  }
  if (here.ivory) {
    return gain + tuskGain(ctx)
  }
  if (ctx.lastDay || inmate.tier <= ctx.p.swapMaxTier) return gain
  return -Infinity
}

/** boardValue: tier values `v` plus vaulted Rainbows worth `r` each, with a
 * bonus for inmates that have something to eat. */
function boardValue(st: State, v: number[], r: number): number {
  let value = st.vault.length * r
  const eaters = eaterMask(st)
  for (const c of st.cells) {
    if (c.inmate === null || c.sealed) continue
    value += v[c.inmate.tier] * ((eaters & (1 << c.n)) === 0 ? 1.0 : 1.25)
  }
  return value
}

/** The tier values and Rainbow worth a gift pick weighs the board with. Two
 * inmates of a tier make one of the next, so early on an inmate counts as the
 * inmates it took to make: 2^t. With fewer than 4 days left the tiers still
 * to climb weigh more than the inmates spent, 3^t. The last day keeps the
 * strategy's own values, where each tier is worth its Riot loot. */
function giftTiers(st: State, p: Params, tiers: [number[], number, boolean]): [number[], number] {
  const [v, r, lastDay] = tiers
  if (lastDay) {
    return [v, r]
  }
  const base = st.maxDays - st.day < 4 ? 3.0 : 2.0
  const gv = [0, 1, 2, 3, 4, 5].map((t) => powi(base, t))
  // A full vault stops inmates at Ultimate, as in `tierValues`.
  return [gv, st.topTier() < RAINBOW ? gv[TOP - 1] : gv[TOP] * p.rainbowMult]
}

/** bestByBoard: the option whose result has the highest board value; random
 * ones are sampled three times. Gifts (`gift`) weigh tiers by `giftTiers`;
 * the Interrogation Room's cards by the strategy's tier values. */
export function bestByBoard(ctx: Ctx, options: string[], gift: boolean, roll: Rng32): string {
  let best: [string, number] | null = null
  for (const id of options) {
    let value = 0.0
    const samples = ['ring', 'horn', 'instigate', 'bestow'].includes(id) ? 3 : 1
    for (let i = 0; i < samples; i++) {
      const trial = ctx.st.clone()
      trial.rng = (roll.roll() * 4294967296) >>> 0
      if (!isOk(apply(trial, { type: 'choose', id }))) {
        continue
      }
      const [tv, tr, tLast] = tierValues(trial, ctx.p)
      const [v, r] = gift ? giftTiers(trial, ctx.p, [tv, tr, tLast]) : [tv, tr]
      value += boardValue(trial, v, r)
    }
    value /= samples
    if (best === null || value > best[1]) {
      best = [id, value]
    }
  }
  return best === null ? options[0] : best[0]
}
