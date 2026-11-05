//! A live frame of the second day of a run, taken on Linux at 2560x1440: the Ultimate objective is done (the Noose and
//! the Coin of Fate are held) and the destination pick offers a Lion and two locked doors.

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
