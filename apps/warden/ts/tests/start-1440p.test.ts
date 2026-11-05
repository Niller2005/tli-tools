//! Two live frames of the first day of a run, taken on Linux at 2560x1440 (19 days until the Riot, holding the
//! Hangman's Noose): the destination pick, then the Replace or End decision once the warden stands in cell 5.

import { expect, test } from 'bun:test'
import type { CellModel } from '@/board/board'
import { loadPng, readModel } from '@/reader/mod'
import { readPanels } from '@/reader/panels'

const DESTINATION = new URL('./fixtures/s16-destination-start-1440p.png', import.meta.url).pathname
const DECISION = new URL('./fixtures/s16-replace-or-end-start-1440p.png', import.meta.url).pathname

const KINDS = (cells: CellModel[]): string[] =>
  cells.map((c) => (c.kind === 'inmate' ? `${c.beast}${c.tier}` : c.kind))

test('the destination pick reads its three doors and the days to the Riot', async () => {
  const panels = await readPanels(loadPng(DESTINATION))
  expect(panels.screen).toBe('patrol')
  expect(panels.days).toBe(19)
  expect(panels.doors).toEqual([2, 4, 5])
  expect(panels.decision).toEqual([])
  expect(panels.held).toEqual(['rope'])
})

test('the board of the destination pick: the Magic Wolf, two Lions and a Rat among locked cells', async () => {
  const [model] = await readModel(DESTINATION, ['rope'])
  expect(model.day).toBe(1)
  expect(model.warden).toBe(0)
  expect(model.dest).toEqual([1, 3, 4])
  expect(KINDS(model.cells)).toEqual([
    'office', 'wolf1', 'sealed', 'sealed', 'sealed', 'lion0', 'sealed', 'sealed',
    'sealed', 'sealed', 'sealed', 'sealed', 'sealed', 'lion0', 'sealed', 'rat0',
  ])
})

test('the decision reads Replace and End, and the Rare Lion the warden stands by in cell 5', async () => {
  const panels = await readPanels(loadPng(DECISION))
  expect(panels.screen).toBe('manage')
  expect(panels.decision).toEqual(['Replace', 'End'])
  expect(panels.doors).toEqual([])
  const [model] = await readModel(DECISION, ['rope'])
  expect(model.warden).toBe(4)
  const lion = model.cells[4]
  expect(lion?.kind === 'inmate' ? `${lion.beast}${lion.tier}` : lion?.kind).toBe('lion2')
})
