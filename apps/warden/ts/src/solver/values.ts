//! Valuing positions (js/solver.js 255-334): chain readiness, swaps, what an
//! inmate can do once the warden stands with it, and Executions.

import { beastIndex, data } from '@/engine/data'

import { bestMeal, fed, replaceOdds } from './chain'
import { TOP, beasts, distWorth, fmax, worth, type Comp, type Ctx } from './mod'

/** stair: how ready the block is for chains; at each tier, the share of beasts
 * an eater could re-roll into and still find a meal there, weighted by tier. */
export function stair(ctx: Ctx, comp: Comp): number {
  let value = 0.0
  for (let t = 0; t < TOP; t++) {
    let count = 0
    for (let b = 0; b < 4; b++) {
      if (fed(ctx, t, b, comp)) count += 1
    }
    value += (count / 4.0) * ctx.v[t]
  }
  return value
}

/** stairDelta: change in readiness from adding (+1) or removing (-1) one inmate. */
export function stairDelta(ctx: Ctx, comp: Comp, tier: number, beast: number, sign: number): number {
  if (ctx.p.wStair === 0.0 || tier >= TOP) {
    return 0.0
  }
  const before = stair(ctx, comp)
  comp[tier * 4 + beast] += sign
  const after = stair(ctx, comp)
  comp[tier * 4 + beast] -= sign
  return ctx.p.wStair * (after - before)
}

/** stairFresh: expected readiness change from a new inmate with tier odds
 * `dist`, of beast `beast` when it is known, else any of the 4 at even odds. */
export function stairFresh(ctx: Ctx, dist: number[], beast: number | null, comp: Comp): number {
  if (ctx.p.wStair === 0.0) {
    return 0.0
  }
  const [beastList, share] = beasts(beast)
  let sum = 0.0
  for (let t = 0; t < dist.length; t++) {
    const p = dist[t]
    for (const b of beastList) {
      if (p !== 0.0) {
        sum += (p * share) * stairDelta(ctx, comp, t, b, 1)
      }
    }
  }
  return sum
}

/** swapValue: what swapping an inmate of this tier is worth, on average, with
 * `others` other open inmates (`comp` below Rainbow) that Scapegoat's
 * Guillotine may remove. */
export function swapValue(ctx: Ctx, tier: number, comp: Comp, others: number): number {
  const [dist, loss] = replaceOdds(ctx, tier, comp, others)
  return distWorth(ctx.v, ctx.r, dist) - ctx.v[tier] - loss
}

/** activation: the inmate's best devour or a swap, whichever is worth more,
 * and never below zero (it can just wait). */
export function activation(ctx: Ctx, tier: number, beast: number, comp: Comp, crowd: number, swapLeft: boolean): number {
  let value = 0.0
  if (tier < TOP) {
    value = fmax(value, bestMeal(ctx, tier, beast, comp, crowd)[0])
  }
  if (swapLeft && (ctx.lastDay || tier <= ctx.p.swapMaxTier)) {
    value = fmax(value, swapValue(ctx, tier, comp, crowd - 1))
  }
  return value
}

/** freshActivation: what a brand-new inmate (tier odds `dist`) could do today,
 * of beast `beast` when it is known (the Iron Pestle keeps the replaced
 * inmate's), else any of the 4 at even odds. */
export function freshActivation(ctx: Ctx, dist: number[], beast: number | null, comp: Comp, crowd: number, swapLeft: boolean): number {
  const [beastList, share] = beasts(beast)
  let sum = 0.0
  for (let t = 0; t < dist.length; t++) {
    const p = dist[t]
    if (p === 0.0) continue
    for (const b of beastList) {
      sum += p * share * activation(ctx, t, b, comp, crowd, swapLeft)
    }
  }
  return sum
}

/** freshValue: a new inmate behind a door, its own worth plus what it could
 * do today from the warden's cell; of beast `beast` when the player has seen it. */
export function freshValue(ctx: Ctx, dist: number[], beast: number | null, comp: Comp, crowd: number, swapLeft: boolean): number {
  const worthOf = distWorth(ctx.v, ctx.r, dist)
  return (
    ctx.p.wOpen * worthOf +
    ctx.p.wNow * freshActivation(ctx, dist, beast, comp, crowd, swapLeft) +
    stairFresh(ctx, dist, beast, comp)
  )
}

/** executionValue: an Execution by an inmate of this tier and beast. */
export function executionValue(ctx: Ctx, tier: number, beast: number, comp: Comp): number {
  const prey = data().foodChain[beast]
  let count = 0
  let lost = 0.0
  for (let t = 0; t < tier; t++) {
    for (const f of prey) {
      const k = comp[t * 4 + beastIndex(f)]
      count += k
      lost += k * ctx.v[t]
    }
  }
  if (count === 0) {
    return 0.0
  }
  // Rust's `as usize` on a negative number saturates at 0.
  const to = Math.min(TOP, Math.max(0, tier + count))
  return worth(ctx, to) - ctx.v[tier] - lost
}
