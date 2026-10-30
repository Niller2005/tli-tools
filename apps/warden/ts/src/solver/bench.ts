//! `warden-cli bench`: full runs played by the strategy alone and by the
//! app's advice (playouts at every decision, the strategy's pick unless the
//! leader beats it by more than its paired margin) on the same seeds, so the
//! paired difference measures what following the advice is worth.
//! `warden-cli bench --strategy-only` plays the strategy alone, on the tuned
//! weights or changed ones, to measure a change of weights.

import { apply, takeTool } from '@/engine/actions'
import type { Tool } from '@/engine/data'
import { newGame } from '@/engine/rules'
import type { State, Stats } from '@/engine/state'

import { advise, type Pick } from './advise'
import { Rng32, TUNED, decide, sameAction, type Params } from './mod'
import { Rollouts, playout } from './solve'

/** Moves a run may take before it is cut, as in `playout` and the JS lab. */
const GUARD = 2000

/** Percentiles `Spread` reports, in percent. */
const PERCENTILES = [10, 25, 50, 75, 90] as const

/** Game `k` of `seed` with the strategy's dice for it, as
 * the JS strategy simulator's newDrill and playGames start one (rewards on),
 * holding `held` as if picked before the first move. */
export function start(seed: number, k: number, held: Tool[]): [State, Rng32] {
  const st = newGame(`${seed}-${k}`)
  for (const tool of held) takeTool(st, tool)
  return [st, new Rng32((Math.imul(k, 2654435761) + 7) >>> 0)]
}

/** One seed played by both players. */
export interface Game {
  /** Chromatics vaulted by the strategy alone. */
  strategy: number
  /** Chromatics vaulted following the advice. */
  advice: number
  /** Riot loot of the strategy alone, in Chromatics (`State::loot`). */
  strategyLoot: number
  /** Riot loot following the advice. */
  adviceLoot: number
  /** Advice decisions with two or more options. */
  decisions: number
  /** Those where the advice was not the strategy's move. */
  overruled: number
}

/** Plays game `k` both ways; the advice runs `rollouts` playouts per option. */
export function play(seed: number, k: number, rollouts: number): Game {
  const solo = playStrategy(seed, k, [], 0, TUNED)

  const [st, rng] = start(seed, k, [])
  let decisions = 0
  let overruled = 0
  for (let step = 0; step < GUARD; step++) {
    if (st.phase === 'ended') break
    const mine = decide(st, TUNED, rng)
    if (mine === null) break
    const solveSeed = (Math.imul(k, 7919) + Math.imul(step, 104729) + seed) >>> 0
    const r = new Rollouts(st, solveSeed, TUNED)
    let action = mine
    if (r.run(rollouts) !== 0) {
      decisions += 1
      const ranking = r.ranking()
      const pick: Pick = { action: mine, label: '', why: '' }
      const advised = advise(pick, ranking, true)
      const index = advised?.option ?? null
      if (index !== null && !sameAction(ranking[index].action, mine)) {
        overruled += 1
        action = ranking[index].action
      }
    }
    if (!apply(st, action).ok && !(action.type !== 'end' && apply(st, { type: 'end' }).ok)) break
  }
  return {
    strategy: solo.chromatics,
    advice: st.vault.length,
    strategyLoot: solo.loot,
    adviceLoot: st.loot(),
    decisions,
    overruled,
  }
}

/** Games 0..`games` of `seed` on `threads` threads, in game order. */
export function bench(games: number, rollouts: number, seed: number, threads: number): Game[] {
  return eachGame(games, threads, (k) => play(seed, k, rollouts))
}

/** A run played by the strategy alone. */
export interface Solo {
  /** Chromatics vaulted. */
  chromatics: number
  /** Riot loot, in Chromatics (`State::loot`). */
  loot: number
  stats: Stats
  /** Whether the run completed its objective. */
  objective: boolean
}

/** Plays game `k` of `seed` with the strategy alone on weights `p`, holding
 * `held`, with `rerolls` instrument rerolls for the run. */
export function playStrategy(seed: number, k: number, held: Tool[], rerolls: number, p: Params): Solo {
  const [st, rng] = start(seed, k, held)
  st.rerolls = rerolls
  playout(st, p, rng)
  return {
    chromatics: st.vault.length,
    loot: st.loot(),
    stats: { ...st.stats },
    objective: st.objective !== null && st.objective.done,
  }
}

/** Games 0..`games` of `seed` played by the strategy alone on weights `p`,
 * holding `held`, with `rerolls` rerolls, on `threads` threads, in game order. */
export function strategyBench(
  games: number,
  seed: number,
  threads: number,
  held: Tool[],
  rerolls: number,
  p: Params,
): Solo[] {
  return eachGame(games, threads, (k) => playStrategy(seed, k, held, rerolls, p))
}

/** `play` on games 0..`games` on `threads` threads, in game order. The Rust
 * spreads the games over OS threads and sorts the results by game index, so
 * the order does not depend on the thread count: a plain loop in game order
 * gives the same order. */
function eachGame<T>(games: number, threads: number, play: (k: number) => T): T[] {
  void threads
  const done: T[] = []
  for (let k = 0; k < games; k++) done.push(play(k))
  return done
}

/** A mean and its standard error (0 with fewer than two values). */
export function meanSe(xs: number[]): [number, number] {
  const n = xs.length
  if (n === 0) return [0, 0]
  // Rust's `Sum` for f64 folds from -0.0, so the sums start there.
  let sum: number = -0
  for (const x of xs) sum += x
  const mean = sum / n
  if (n < 2) return [mean, 0]
  let squares: number = -0
  for (const x of xs) squares += (x - mean) * (x - mean)
  const variance = squares / (n - 1)
  return [mean, Math.sqrt(variance / n)]
}

/** Chromatics and loot per run, each as (mean, standard error); `gain` is
 * advice minus strategy in loot, paired by seed. */
export interface Summary {
  strategy: [number, number]
  advice: [number, number]
  strategyLoot: [number, number]
  adviceLoot: [number, number]
  gain: [number, number]
  decisions: number
  overruled: number
}

export function summarize(games: Game[]): Summary {
  return {
    strategy: meanSe(games.map((g) => g.strategy)),
    advice: meanSe(games.map((g) => g.advice)),
    strategyLoot: meanSe(games.map((g) => g.strategyLoot)),
    adviceLoot: meanSe(games.map((g) => g.adviceLoot)),
    gain: meanSe(games.map((g) => g.adviceLoot - g.strategyLoot)),
    decisions: games.reduce((sum, g) => sum + g.decisions, 0),
    overruled: games.reduce((sum, g) => sum + g.overruled, 0),
  }
}

/** Runs with at most this many Chromatics count as bad runs in `Spread`. */
export const LOW = 2

/** Whether a run with `chromatics` is a bad run: see [`LOW`]. */
export function isLow(chromatics: number): boolean {
  return chromatics <= LOW
}

/** How Chromatics per run spread: the share of runs with at most `LOW` (in %),
 * the `PERCENTILES` by nearest rank (the smallest value with at least p% of
 * the runs at or below it), and the most. */
export interface Spread {
  low: number
  percentiles: number[]
  max: number
}

export function spread(runs: number[]): Spread {
  if (runs.length === 0) return { low: 0, percentiles: [0, 0, 0, 0, 0], max: 0 }
  const sorted = runs.slice().sort((a, b) => a - b)
  const n = sorted.length
  let low = 0
  for (const c of sorted) if (isLow(c)) low += 1
  const percentiles = PERCENTILES.map((p) => sorted[Math.max(1, Math.ceil((p * n) / 100)) - 1])
  return { low: (100 * low) / n, percentiles, max: sorted[n - 1] }
}
