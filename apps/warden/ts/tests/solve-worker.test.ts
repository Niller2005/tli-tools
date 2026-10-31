//! The session's solve in its worker: the ranking is the one a solve call
//! gives, and the rounds add up.

import { expect, test } from 'bun:test'

import { Session } from '@/app/session'
import { buildState } from '@/board/board'
import { loadPng, readModel } from '@/reader/mod'
import { solve } from '@/solver/solve'
import { TUNED } from '@/solver/mod'

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
