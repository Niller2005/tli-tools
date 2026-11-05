//! Live frames of the second day of a run, taken on Linux at 2560x1440 with the Ultimate objective done (the Noose
//! and the Coin of Fate held): the destination pick, then the Replace or End decision once the warden stands in cell 7.

import { expect, test } from 'bun:test'
import { loadPng, readModel } from '@/reader/mod'
import { readPanels } from '@/reader/panels'

const FRAME = new URL('./fixtures/s16-destination-day2-1440p.png', import.meta.url).pathname

test('the destination pick reads its doors, the days to the Riot and both held instruments', async () => {
  const panels = await readPanels(loadPng(FRAME))
  expect(panels.screen).toBe('patrol')
  expect(panels.days).toBe(18)
  expect(panels.doors).toEqual([6, 7, 9])
  expect(panels.held).toEqual(['rope', 'coin'])
})

test('the board reads the Ultimate Mammoth in cell 5 and the completed objective', async () => {
  const [model] = await readModel(FRAME)
  expect(model.day).toBe(2)
  expect(model.warden).toBe(4)
  expect(model.dest).toEqual([5, 6, 8])
  expect(model.objective).toEqual({ id: 1, progress: 1 })
  const cell = model.cells[4]
  expect(cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind).toBe('mammoth4')
})

const DECISION = new URL('./fixtures/s16-replace-or-end-day2-1440p.png', import.meta.url).pathname

test('the decision on the Normal Mammoth in cell 7 reads Replace and End', async () => {
  const panels = await readPanels(loadPng(DECISION))
  expect(panels.screen).toBe('manage')
  expect(panels.decision).toEqual(['Replace', 'End'])
  expect(panels.held).toEqual(['rope', 'coin'])
  const [model] = await readModel(DECISION)
  expect(model.warden).toBe(6)
  const cell = model.cells[6]
  expect(cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind).toBe('mammoth0')
})
