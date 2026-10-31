//! A real board from the game (day 19, 1 day until Riot, the warden on cell 7, the End button instead
//! of destination cards), taken on Linux at 2560x1440 and kept at 1918x1078: the reader finds the
//! board, the day, the warden and the locked cells, and the session takes the two held instruments
//! from the panel.

import { expect, test } from 'bun:test'
import { Session } from '@/app/session'
import { loadPng, readModel } from '@/reader/mod'
import { readPanels, screenLabel } from '@/reader/panels'
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

test('the screen is a board and the session reads the held instruments', async () => {
  const panels = await readPanels(loadPng(FRAME))
  expect(screenLabel(panels.screen)).toBe('board')
  const s = new Session(ROLLOUTS, [], null, null)
  s.readInBackground(loadPng(FRAME))
  await s.wait()
  expect(s.problems).toEqual([])
  expect(s.reading).not.toBeNull()
  const text = (s.reading?.warnings ?? []).map((w) => w.text).join('\n')
  expect(s.tools).toEqual(['dogtag', 'revenge'])
  expect(text).toContain("The Torture Instrument panel shows: Felon's Dog Tag, Avenger's Casket.")
})
