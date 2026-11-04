//! At every 8th decision of the strategy games of tests/decide.rs (games 0
//! to 19 of seed 1), runs the TypeScript solver and requires the instant
//! pick, the candidates and the options with their scores recorded in
//! tests/fixtures/strategy-solves.jsonl, so an accidental change of the
//! strategy or the playouts fails. After a deliberate change, re-record the
//! fixture with `WARDEN_RECORD=1 cargo test --profile fast-test --test decide --test solve`
//! and review its diff.

import { expect, test } from 'bun:test'
import type { Action } from '@/engine/actions'
import type { Tool } from '@/engine/data'
import { addMarker, incidentFits, markerSeen, newGame } from '@/engine/rules'
import type { State } from '@/engine/state'
import { Rng32, TOOL_RANK, TUNED, decide, type Params } from '@/solver/mod'
import { Rollouts, candidates, hideFuture, instant, solve, type SolveOption } from '@/solver/solve'
import { buildBoard, recorded, strategyGame } from './common'

const SOLVES = 'strategy-solves.jsonl'

/** A score as JSON: a number, or a string for a non-finite one (JSON has
 * no infinity). */
type Score = number | string

/** One option as the fixture holds it. */
interface RecordedOption {
  label: string
  action: unknown
  n: number
  policy: boolean
  mean: Score
  se: Score
  gapSe: Score
  best: Score
}

/** The solver's pick with its label and a short reason. */
interface RecordedInstant {
  action: unknown
  label: string
  why: string
}

/** One recorded point: the solver's view of a state. */
interface RecordedPoint {
  k: number
  step: number
  instant: RecordedInstant | null
  candidates: string[]
  options: RecordedOption[]
}

/** `x` as JSON; JSON has no infinity, so a non-finite score is a string.
 * The string is the Rust `f64::to_string` form ("inf", "-inf", "NaN"), so
 * the recorded fixtures and the TS scores hold the same text. */
function score(x: number): Score {
  if (Number.isFinite(x)) return x
  if (Number.isNaN(x)) return 'NaN'
  return x > 0 ? 'inf' : '-inf'
}

/** Whether two JSON values are the same (the Rust `Value`'s equality). */
function same(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => same(v, b[i]))
  }
  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => key in b && same(a[key], b[key]))
  }
  return false
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** `close`: the numbers are close when both are numbers, the values are the
 * same otherwise. */
function close(now: unknown, was: unknown): boolean {
  if (typeof now === 'number' && typeof was === 'number') return Math.abs(now - was) <= 1e-9
  return same(now, was)
}

/** One option of the solver's ranking, as the fixture holds it. */
function option(o: SolveOption): RecordedOption {
  return {
    label: o.label,
    action: o.action,
    n: o.n,
    policy: o.policy,
    mean: score(o.mean),
    se: score(o.se),
    gapSe: score(o.gapSe),
    best: score(o.best),
  }
}

/** Whether two options are the same: the label, the action, the count and
 * the policy exactly, the scores within 1e-9. */
function sameOption(now: RecordedOption, was: RecordedOption): boolean {
  return (
    same(now.label, was.label) &&
    same(now.action, was.action) &&
    same(now.n, was.n) &&
    same(now.policy, was.policy) &&
    close(now.mean, was.mean) &&
    close(now.se, was.se) &&
    close(now.gapSe, was.gapSe) &&
    close(now.best, was.best)
  )
}

/** The solver's view of the state before decision `step` of game `k`. */
function point(k: number, step: number, state: State): RecordedPoint {
  const pick = instant(state)
  const labels = candidates(state).map((c) => c.label)
  const options = solve(state, 30, 7, TUNED).map(option)
  return {
    k,
    step,
    instant: pick === null ? null : { action: pick.action, label: pick.label, why: pick.why },
    candidates: labels,
    options,
  }
}

/** The first part of point `now` that differs from the recorded `was`, if any. */
function pointDiff(now: RecordedPoint, was: RecordedPoint): string | null {
  if (now.k !== was.k || now.step !== was.step) {
    return `point: recorded game ${was.k} step ${was.step}`
  }
  if (!same(now.instant, was.instant)) {
    return `instant: now ${JSON.stringify(now.instant)} / recorded ${JSON.stringify(was.instant)}`
  }
  if (!same(now.candidates, was.candidates)) {
    return `candidates: now ${JSON.stringify(now.candidates)} / recorded ${JSON.stringify(was.candidates)}`
  }
  if (now.options.length !== was.options.length) {
    return `options: now ${now.options.length} / recorded ${was.options.length}`
  }
  for (let i = 0; i < now.options.length; i++) {
    if (!sameOption(now.options[i], was.options[i])) {
      return `option: now ${JSON.stringify(now.options[i])} / recorded ${JSON.stringify(was.options[i])}`
    }
  }
  return null
}

test('solves as recorded', () => {
  const points: RecordedPoint[] = []
  for (let k = 0; k < 20; k++) {
    strategyGame(k, (step, state) => {
      if (step % 8 === 0) points.push(point(k, step, state))
    })
  }

  const want = recorded(SOLVES) as RecordedPoint[]
  const mismatches: string[] = []
  if (want.length !== points.length) {
    mismatches.push(`points: now ${points.length} / recorded ${want.length}`)
  }
  // The first differing point of each game.
  let reported: number | null = null
  for (let i = 0; i < points.length && i < want.length; i++) {
    const now = points[i]
    const was = want[i]
    if (now.k === reported) continue
    const diff = pointDiff(now, was)
    if (diff !== null) {
      reported = now.k
      mismatches.push(`game ${now.k} step ${now.step} ${diff}`)
    }
  }

  console.log(`points: ${points.length}, mismatches: ${mismatches.length}`)
  for (const m of mismatches.slice(0, 10)) console.log(`  ${m}`)
  expect(mismatches, `${mismatches.length} mismatches with ${SOLVES}`).toEqual([])
}, 600_000)

/** Racing stops moves at fixed round counts, so 1600 rounds in one call and
 * in steps of 50 rank the same, and the patrol board's trailing moves stop
 * before the leader. */
test('races the same in any steps', () => {
  const [st, problems] = buildBoard('patrol.json')
  expect(problems).toEqual([])
  const whole = new Rollouts(st, 1, TUNED)
  whole.run(1600)
  const steps = new Rollouts(st, 1, TUNED)
  while (steps.run(50) > 0) {
    // The rounds run until the race is over.
  }
  expect(whole.ranking()).toEqual(steps.ranking())
  const ranking = whole.ranking()
  expect(whole.rounds(), 'the solve ended early, with one move left').toBeLessThan(1600)
  expect(ranking[0].n).toBe(whole.rounds())
  const last = ranking.at(-1)
  if (last === undefined) throw new Error('the ranking is empty')
  expect(last.n).toBeLessThan(ranking[0].n)
}, 600_000)

// A timing benchmark of the Rust crate; skipped here, as it is there.
test.skip('solve timing', () => {
  const step = strategyGame(0, () => {})[0].length / 2
  let options: SolveOption[] = []
  strategyGame(0, (i, st) => {
    if (i !== step) return
    const start = performance.now()
    options = solve(st, 400, 1, TUNED)
    const wall = (performance.now() - start) / 1000
    console.log(`game 0 step ${step}: 400 rollouts in ${wall.toFixed(3)} s`)
    console.log(`candidates: ${options.length}`)
    const top = options.at(0)
    if (top !== undefined) {
      console.log(`top: ${top.label} (mean ${top.mean.toFixed(3)}, se ${top.se.toFixed(3)}, n ${top.n})`)
    }
  })
})

test('unseen markers draw any fitting incident', () => {
  const st = newGame('unseen')
  const n = st.cells.findIndex((c) => c.sealed && c.event === null)
  if (n < 0) throw new Error('a free sealed cell')
  expect(addMarker(st, n)).toBe(true)
  expect(markerSeen(st)).toBe(false)
  const ids = new Set<number>()
  for (let seed = 0; seed < 200; seed++) {
    const copy = st.clone()
    hideFuture(copy, seed)
    const id = copy.cells[n].event
    if (id === null) throw new Error('the marker stays')
    expect(incidentFits(id, copy.cells[n]), `incident ${id} doesn't fit cell ${n}`).toBe(true)
    ids.add(id)
  }
  expect(ids.size, `only ${[...ids].join(', ')} drawn`).toBeGreaterThan(2)
})

test('rerolls are offered only with one left', () => {
  const st = newGame('REROLL')
  const rerolls = (s: State): number => candidates(s).filter((c) => c.label === 'Re-roll').length
  expect(rerolls(st)).toBe(0)
  st.rerolls = 1
  expect(rerolls(st)).toBe(1)
  st.pending = []
  expect(rerolls(st)).toBe(0)
})

test('decide rerolls only a low ranked offer', () => {
  const p: Params = { ...TUNED, rerollRank: 10 }
  const st = newGame('REROLL')
  st.rerolls = 1
  const pick = (options: Tool[]): Action | null => {
    st.pending = [{ kind: 'tool', options, reason: 'start' }]
    return decide(st, p, new Rng32(1))
  }
  expect(pick(TOOL_RANK.slice(20, 23))).toEqual({ type: 'reroll' })
  expect(pick([TOOL_RANK[20], TOOL_RANK[0], TOOL_RANK[21]])).toEqual({ type: 'choose', id: TOOL_RANK[0] })
  st.rerolls = 0
  expect(pick(TOOL_RANK.slice(20, 23))).toEqual({ type: 'choose', id: TOOL_RANK[20] })
})
