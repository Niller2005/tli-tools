//! A real board from the game (day 11, 9 days until Riot, the warden on cell 8, three destination cards),
//! taken on Linux at 2560x1440 and kept at 1918x1078. The counter's large 9 reads as an O when the line is
//! read freely at 2x, which counted the Riot days down to 0 (day 20).

import { expect, test } from 'bun:test'
import { loadPng, readModel } from '@/reader/mod'
import { readPanels } from '@/reader/panels'

const FRAME = new URL('./fixtures/s16-days-nine-day11.png', import.meta.url).pathname

test('the 9 of the days counter is not read as a 0', async () => {
  const panels = await readPanels(loadPng(FRAME))
  expect(panels.days).toBe(9)
  const [model] = await readModel(FRAME, [])
  expect(model.day).toBe(11)
  expect(model.maxDays).toBe(20)
})
