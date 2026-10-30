//! The solver's own unit tests, ported from the Rust crate's src/solver
//! modules: apps/warden/src/solver/advise.rs, bench.rs and scores.rs. The
//! Rust code is the specification, so every assertion here mirrors its own.

import { expect, test } from 'bun:test'
import { apply } from '@/engine/actions'
import { RAINBOW, TYRANNY, data } from '@/engine/data'
import type { Bite } from '@/engine/devour'
import { newGame } from '@/engine/rules'
import type { State } from '@/engine/state'
import { advise, whyShown, type Pick } from '@/solver/advise'
import { bench, playStrategy, spread, start, strategyBench, summarize } from '@/solver/bench'
import { Rng32, TUNED, cloneParams, context, decide, setWeight, weightOf } from '@/solver/mod'
import { devourScores, patrolScores } from '@/solver/scores'
import type { SolveOption } from '@/solver/solve'

/** Moves a run may take before it is cut, as in `playout` and the JS lab. */
const GUARD = 2000

/** A row of a ranking, as the Rust tests build it. */
function option(cell: number, mean: number, gapSe: number, policy: boolean): SolveOption {
  return {
    label: `Go to cell ${cell}`,
    action: { type: 'patrol', cell },
    mean,
    se: 0.1,
    gapSe,
    n: 400,
    best: 0,
    policy,
  }
}

/** A block with every cell open and empty, the warden in cell 0, and the
 * objective `id` (data/warden-data.json) not started. */
function bare(id: number): State {
  const st = newGame('goal')
  for (const c of st.cells) {
    c.sealed = false
    c.inmate = null
    c.hidden = null
    c.event = null
    c.nest = null
    c.known = 0
  }
  st.tools = []
  st.position = 0
  st.chain = false
  st.objective = { id, progress: 0, done: false }
  return st
}

// Rust: advice_takes_the_playouts_best
test('advice takes the playouts best', () => {
  const pick: Pick = { action: { type: 'patrol', cell: 8 }, label: 'Go to cell 8', why: 'A new Inmate.' }
  // The strategy's pick ranks second, 0.040 behind the leader, outside its 1.96 * 0.01 margin.
  const tie = [option(7, 4.07, 0.0, false), option(8, 4.03, 0.01, true)]
  const a = advise(pick, tie, true)
  if (a === null) throw new Error('no advice')
  expect([a.label, a.option]).toEqual(['Go to cell 7', 0])
  expect(a.action).toEqual({ type: 'patrol', cell: 7 })
  expect(a.why).toBe("The playouts found a better move than the strategy's pick (Go to cell 8).")

  const led = [option(8, 4.07, 0.0, true), option(7, 4.03, 0.06, false)]
  const b = advise(pick, led, true)
  if (b === null) throw new Error('no advice')
  expect([b.label, b.why]).toEqual(['Go to cell 8', 'A new Inmate.'])
  // Before enough playouts, the strategy's pick stands.
  const c = advise(pick, tie, false)
  if (c === null) throw new Error('no advice')
  expect(c.option).toBe(1)
})

// Rust: advice_in_a_tie_rates_the_pick_as_good
test('advice in a tie rates the pick as good', () => {
  const pick: Pick = { action: { type: 'patrol', cell: 8 }, label: 'Go to cell 8', why: 'A new Inmate.' }
  const tie = [option(7, 0.0, 0.0, false), option(8, 0.0, 0.0, true), option(9, 0.0, 0.0, false)]
  const a = advise(pick, tie, true)
  if (a === null) throw new Error('no advice')
  // The move stays the first row; only the why changes.
  expect([a.action, a.option]).toEqual([{ type: 'patrol', cell: 7 }, 0])
  expect(a.why).toBe("The playouts rate it as good as the strategy's pick (Go to cell 8).")
})

// Rust: a_tied_card_pick_still_names_one_card
test('a tied card pick still names one card', () => {
  const st = newGame('tie')
  st.pending = [{ kind: 'interrogation', options: [] }]
  const tie = [option(7, 4.0, 0.0, false), option(8, 4.0, 0.05, false)]
  const a = advise(null, tie, true)
  if (a === null) throw new Error('no advice')
  expect([a.label, whyShown(st, tie, a)]).toEqual(['Go to cell 7', "The playouts can't tell it from the others."])
  const led = [option(7, 4.5, 0.0, false), option(8, 4.0, 0.05, false)]
  const b = advise(null, led, true)
  if (b === null) throw new Error('no advice')
  expect(whyShown(st, led, b)).toBe('The playouts rate it best.')
})

// Rust: the_strategy_player_replays_plain_games
test('the strategy player replays plain games', () => {
  const games = bench(2, 20, 1, 2)
  expect(games.length).toBe(2)
  for (let k = 0; k < games.length; k++) {
    const g = games[k]
    const [st, rng] = start(1, k, [])
    for (let step = 0; step < GUARD; step++) {
      const action = decide(st, TUNED, rng)
      if (action === null) break
      if (!apply(st, action).ok && !(action.type !== 'end' && apply(st, { type: 'end' }).ok)) break
    }
    expect(st.phase).toBe('ended')
    expect(g.strategy).toBe(st.vault.length)
    expect(g.decisions > 0 && g.overruled <= g.decisions).toBe(true)
    expect(playStrategy(1, k, [], 0, TUNED)).toEqual({
      chromatics: g.strategy,
      loot: st.loot(),
      stats: st.stats,
      objective: st.objective !== null && st.objective.done,
    })
  }
  const s = summarize(games)
  for (const x of [s.strategy[0], s.strategy[1], s.advice[0], s.advice[1], s.gain[0], s.gain[1]]) {
    expect(Number.isFinite(x)).toBe(true)
  }
}, 600_000)

// Rust: changed_weights_change_the_strategy_runs
test('changed weights change the strategy runs', () => {
  const p = cloneParams(TUNED)
  expect(setWeight(p, 'w_step', 0)).toBe(true)
  expect(weightOf(p, 'w_steps')).toBeNull()
  const tuned = strategyBench(20, 1, 2, [], 0, TUNED)
  const changed = strategyBench(20, 1, 2, [], 0, p)
  expect(tuned).not.toEqual(changed)
  expect(changed[7]).toEqual(playStrategy(1, 7, [], 0, p))
}, 600_000)

// Rust: held_instruments_start_in_the_tools
test('held instruments start in the tools', () => {
  const [plain] = start(1, 3, [])
  expect(plain.tools).toEqual(newGame('1-3').tools)
  const [held] = start(1, 3, ['whip'])
  expect(held.has('whip')).toBe(true)
  expect(plain.has('whip')).toBe(false)
  // The Whip's "-1 destination" drops a die as on a pick.
  expect(held.dice.length).toBe(Math.max(plain.dice.length - 1, 1))
})

// Rust: spread_takes_nearest_rank_percentiles
test('spread takes nearest rank percentiles', () => {
  // Ten runs with ties: p10 is the 1st, p25 the 3rd, p50 the 5th, p75 the 8th, p90 the 9th.
  expect(spread([5, 0, 2, 2, 3, 3, 3, 7, 9, 4])).toEqual({ low: 30, percentiles: [0, 2, 3, 5, 7], max: 9 })
  // An even count of four: ranks 1, 1, 2, 3, 4.
  expect(spread([4, 1, 3, 2])).toEqual({ low: 50, percentiles: [1, 1, 2, 3, 4], max: 4 })
  expect(spread([])).toEqual({ low: 0, percentiles: [0, 0, 0, 0, 0], max: 0 })
})

// Rust: a_lion_with_the_trap_ends_the_chain_for_its_hunt
test('a lion with the trap ends the chain for its hunt', () => {
  const st = bare(5)
  st.phase = 'manage'
  st.position = 3
  st.cells[3].inmate = { id: 900, beast: 'lion', tier: 2 }
  st.cells[4].inmate = { id: 901, beast: 'rat', tier: 2 }
  st.pending = [{ kind: 'chain', from: 3, eaterId: 900, options: [4] }]
  expect(decide(st, TUNED, new Rng32(1))).toEqual({ type: 'chain', to: 4 })
  st.tools.push('trap')
  expect(decide(st, TUNED, new Rng32(1))).toEqual({ type: 'endChain' })
})

// Rust: a_move_distance_objective_favours_the_longer_walk
test('a move distance objective favours the longer walk', () => {
  const st = bare(5)
  const walks: number[] = []
  for (let n = 1; n < st.cells.length; n++) if (n !== data().room) walks.push(n)
  const near = walks[0]
  const far = walks[4]
  const p = { ...TUNED, wStep: -0.5 }
  expect(patrolScores(context(st, p), [near, far])[0][0]).toBe(near)
  const q = { ...p, wGoal: 64 }
  expect(patrolScores(context(st, q), [near, far])[0][0]).toBe(far)
})

// Rust: a_devour_count_objective_adds_its_share_to_every_bite
test('a devour count objective adds its share to every bite', () => {
  const st = bare(2)
  st.cells[0].inmate = { id: 900, beast: 'lion', tier: 1 }
  st.cells[3].inmate = { id: 901, beast: 'rat', tier: 1 }
  const bite = (): Bite[] => [{ cell: 3, scratch: false }]
  const p = { ...TUNED }
  const plain = devourScores(context(st, p), bite())[0][1]
  const q = { ...p, wGoal: 8 }
  // Target 4 Consumes: one is a quarter of w_goal.
  expect(devourScores(context(st, q), bite())[0][1]).toBe(plain + 2)
  st.objective = { id: 2, progress: 4, done: true }
  expect(devourScores(context(st, q), bite())[0][1]).toBe(plain)
})

// Rust: tyrannys_extra_room_cards_count_in_the_room_landing
test('tyrannys extra room cards count in the room landing', () => {
  const st = bare(5)
  st.position = 3
  st.cells[6].inmate = { id: 900, beast: 'lion', tier: RAINBOW - 1 }
  const room = data().room
  const p = { ...TUNED, roomTyranny: 1 }
  const plain = patrolScores(context(st, p), [room])[0][1]
  // Tyranny's extra Bestow makes the Chromatic, whose Treasure comes before the Room's card.
  st.theme = TYRANNY
  expect(Math.abs(patrolScores(context(st, p), [room])[0][1] - plain)).toBeLessThan(1e-9)
})
