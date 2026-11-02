//! A real board from the game (day 19, 1 day until Riot, the warden on cell 7, the End button alone
//! instead of destination cards), taken on Linux at 2560x1440 and kept at 1918x1078: the reader finds the
//! board, the day, the warden and the locked cells; no number on the screen is read as a destination
//! card, the End button is read, and the session advises to end the day.

import { expect, test } from 'bun:test'
import { Session } from '@/app/session'
import { loadPng, readModel } from '@/reader/mod'
import { readPanels } from '@/reader/panels'
import { ROLLOUTS } from './session-common'

const FRAME = new URL('./fixtures/s16-board-day19.png', import.meta.url).pathname

test('the reader reads the board of day 19', async () => {
  const [model, warnings] = await readModel(FRAME, [])
  expect(model.day).toBe(19)
  expect(model.maxDays).toBe(20)
  expect(model.warden).toBe(6)
  expect(model.cells).toHaveLength(16)
  expect(model.cells[0]?.kind).toBe('office')
  // the two locked cells, 05 and 13
  expect(model.cells.flatMap((c, i) => (c.kind === 'sealed' ? [i] : []))).toEqual([4, 12])
  expect(model.cells.filter((c) => c.kind === 'inmate')).toHaveLength(13)
  // the reader says which cells it is unsure of, and none of them is the warden's
  expect(warnings.every((w) => w.cell !== 6)).toBe(true)
})

test('the End button alone is read: no door, nothing left to do but end the day', async () => {
  const panels = await readPanels(loadPng(FRAME))
  expect(panels.screen).toBe('manage')
  expect(panels.decision).toEqual(['End'])
  // numbers on the board and the End panel are not destination cards
  expect(panels.doors).toEqual([])
  const [model] = await readModel(FRAME, [])
  expect(model.dest).toEqual([])
  expect(model.step).toBe('manage')

  const s = new Session(ROLLOUTS, [], null, null)
  s.readInBackground(loadPng(FRAME))
  await s.wait()
  expect(s.pick?.action).toEqual({ type: 'end' })
})
