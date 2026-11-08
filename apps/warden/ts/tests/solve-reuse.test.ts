//! The Consume target pick of a board that was just solved: the solve of the board played those bites against
//! each other, so the target screen shows that ranking, and it is the ranking a solve of the pick alone gives.

import { expect, test } from 'bun:test'
import { Session } from '@/app/session'
import type { Reading } from '@/app/run'
import { buildState } from '@/board/board'
import { loadPng } from '@/reader/mod'
import { TUNED } from '@/solver/mod'
import { Rollouts } from '@/solver/solve'
import { ROLLOUTS } from './session-common'

const frame = (name: string): string => new URL(`./fixtures/s16-${name}-1440p.png`, import.meta.url).pathname

async function read(s: Session, name: string): Promise<void> {
  s.readInBackground(loadPng(frame(name)))
  await s.wait()
}

test('the target pick of a solved board ranks as a solve of the pick alone', async () => {
  const s = new Session(ROLLOUTS, [], null, null)
  await read(s, 'consume-or-finish-last-day')
  const board = s.ranking
  expect(board.length).toBeGreaterThan(2)
  await read(s, 'consume-target-last-day')
  expect((s.reading as Reading).screen).toBe('chainTarget')
  expect(s.solving).toBe(false)

  const bites = s.ranking.map((o) => (o.action.type === 'devour' ? o.action.to : -1))
  expect(bites).toHaveLength(2)
  expect(bites.every((n) => n >= 0)).toBe(true)
  const alone = Rollouts.with(buildState((s.reading as Reading).model, 1)[0], 1, TUNED, bites)
  alone.run(ROLLOUTS)
  expect(s.ranking).toEqual(alone.ranking())
})
