//! The session's solve on the pool's workers: the ranking is the one a solve
//! call gives, however many workers play the rounds, and the rounds add up.

import { expect, test } from 'bun:test'

import { SolvePool, type SolveProgress } from '@/app/solve-pool'
import { Session } from '@/app/session'
import { buildState } from '@/board/board'
import { loadPng, readModel } from '@/reader/mod'
import { solve } from '@/solver/solve'
import { TUNED } from '@/solver/mod'
import { buildBoard } from './common'

/** The rounds the solve plays. */
const ROLLOUTS = 200

/** The board of the saved frame. */
const FRAME = new URL('./fixtures/board-text.png', import.meta.url).pathname

test('the session solves in its worker', async () => {
  const s = new Session(ROLLOUTS, [], null, null)
  s.readInBackground(loadPng(FRAME))
  await s.wait()
  expect(s.rounds).toBe(ROLLOUTS)
  expect(s.solving).toBe(false)
  const [model] = await readModel(FRAME, [])
  const [st] = buildState(model, 1)
  const whole = solve(st, ROLLOUTS, 1, TUNED)
  expect(whole.length).toBeGreaterThan(1)
  expect(s.ranking).toEqual(whole)
})

/** Plays `rollouts` rounds of a board on `pool` and gives the last progress. */
async function playOn(pool: SolvePool, board: string, rollouts: number): Promise<SolveProgress> {
  const [st] = buildBoard(board)
  let last: SolveProgress | null = null
  const run = pool.solve({ state: st, seed: 1, rollouts, round: 50, bite: null }, (p) => {
    last = p
  })
  await run.done
  if (last === null) throw new Error('no progress')
  return last
}

/** The patrol board races: its trailing moves stop at checkpoints, which the
 * workers' chunks must not move. */
test('the pool ranks as one thread does, racing included', async () => {
  const [st] = buildBoard('patrol.json')
  const whole = solve(st, 1600, 1, TUNED)
  expect(whole[0].n).toBeLessThan(1600)
  for (const workers of [1, 3]) {
    const pool = new SolvePool(workers)
    const last = await playOn(pool, 'patrol.json', 1600)
    expect(last.done).toBe(true)
    expect(last.options).toEqual(whole)
    expect(last.rounds).toBe(whole[0].n)
  }
}, 120_000)

/** A solve that starts while another runs replaces it: the pool's workers
 * play the new board, and the cancelled one reports nothing more. */
test('a new solve replaces the running one', async () => {
  const pool = new SolvePool(2)
  const [first] = buildBoard('patrol.json')
  const [second] = buildBoard('ratway.json')
  const seen: SolveProgress[] = []
  const old = pool.solve({ state: first, seed: 1, rollouts: 1600, round: 50, bite: null }, (p) => seen.push(p))
  const last = await playOn(pool, 'ratway.json', 200)
  await old.done
  expect(last.options).toEqual(solve(second, 200, 1, TUNED))
  expect(seen.every((p) => !p.done)).toBe(true)
}, 120_000)
