//! Live frames of days 2 and 3 of a run, taken on Linux at 2560x1440 with the Ultimate objective done (the Noose and
//! the Coin of Fate held): the destination picks and the decisions with the warden in cell 7.

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

const CONSUME = new URL('./fixtures/s16-consume-or-end-day2-1440p.png', import.meta.url).pathname

test('the decision after the Replace reads Consume and End, with an Ultimate Rat under the warden', async () => {
  const panels = await readPanels(loadPng(CONSUME))
  expect(panels.screen).toBe('manage')
  expect(panels.decision).toEqual(['Consume', 'End'])
  const [model] = await readModel(CONSUME)
  expect(model.warden).toBe(6)
  const cell = model.cells[6]
  expect(cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind).toBe('rat4')
})

const DAY3 = new URL('./fixtures/s16-destination-day3-1440p.png', import.meta.url).pathname

test('the destination pick of day 3 reads 17 days, the incident door 8 and the doors 11 and 12', async () => {
  const panels = await readPanels(loadPng(DAY3))
  expect(panels.screen).toBe('patrol')
  expect(panels.days).toBe(17)
  expect(panels.doors).toEqual([8, 11, 12])
  const [model] = await readModel(DAY3)
  expect(model.day).toBe(3)
  expect(model.dest).toEqual([7, 10, 11])
})

const INCIDENT = new URL('./fixtures/s16-incident-taste-of-freedom-1440p.png', import.meta.url).pathname

test('the Taste of Freedom incident reads as a popup over the dimmed board', async () => {
  const panels = await readPanels(loadPng(INCIDENT))
  expect(panels.screen).toBe('popup')
  expect(panels.doors).toEqual([])
  expect(panels.decision).toEqual([])
})

const THREE_WAY = new URL('./fixtures/s16-three-way-day3-1440p.png', import.meta.url).pathname

test('Consume, Replace and End read together, with three cells opened by the incident', async () => {
  const panels = await readPanels(loadPng(THREE_WAY))
  expect(panels.screen).toBe('manage')
  expect(panels.decision).toEqual(['Consume', 'Replace', 'End'])
  const [model] = await readModel(THREE_WAY)
  expect(model.warden).toBe(7)
  const kinds = [2, 10, 14].map(i => {
    const cell = model.cells[i]
    return cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind
  })
  expect(kinds).toEqual(['mammoth1', 'rat1', 'lion0'])
})

const DAY4 = new URL('./fixtures/s16-destination-day4-1440p.png', import.meta.url).pathname

test('the destination pick of day 4 reads the Rare Rat the Replace left in cell 8', async () => {
  const panels = await readPanels(loadPng(DAY4))
  expect(panels.screen).toBe('patrol')
  expect(panels.days).toBe(16)
  expect(panels.doors).toEqual([9, 10, 12])
  const [model] = await readModel(DAY4)
  expect(model.day).toBe(4)
  expect(model.warden).toBe(7)
  const cell = model.cells[7]
  expect(cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind).toBe('rat2')
})

const THREE_WAY_DAY4 = new URL('./fixtures/s16-three-way-day4-1440p.png', import.meta.url).pathname

test('the three decisions on day 4 read a Normal Mammoth under the warden in cell 12', async () => {
  const panels = await readPanels(loadPng(THREE_WAY_DAY4))
  expect(panels.screen).toBe('manage')
  expect(panels.days).toBe(16)
  expect(panels.decision).toEqual(['Consume', 'Replace', 'End'])
  const [model] = await readModel(THREE_WAY_DAY4)
  expect(model.warden).toBe(11)
  const cell = model.cells[11]
  expect(cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind).toBe('mammoth0')
})

const CONSUME_DAY4 = new URL('./fixtures/s16-consume-or-end-day4-1440p.png', import.meta.url).pathname

test('the decision after the Replace on day 4 reads a Rare Lion pair in cells 6 and 12', async () => {
  const panels = await readPanels(loadPng(CONSUME_DAY4))
  expect(panels.screen).toBe('manage')
  expect(panels.decision).toEqual(['Consume', 'End'])
  const [model] = await readModel(CONSUME_DAY4)
  expect(model.warden).toBe(11)
  const kinds = [5, 11].map(i => {
    const cell = model.cells[i]
    return cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind
  })
  expect(kinds).toEqual(['lion2', 'lion2'])
})

const DAY5 = new URL('./fixtures/s16-destination-day5-1440p.png', import.meta.url).pathname

test('the destination pick of day 5 reads the Coin of Fate having raised the Lion in cell 12 and emptied cell 6', async () => {
  const panels = await readPanels(loadPng(DAY5))
  expect(panels.screen).toBe('patrol')
  expect(panels.days).toBe(15)
  expect(panels.doors).toEqual([13, 14, 1])
  const [model] = await readModel(DAY5)
  expect(model.day).toBe(5)
  const kinds = [5, 11].map(i => {
    const cell = model.cells[i]
    return cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind
  })
  expect(kinds).toEqual(['sealed', 'lion4'])
})

const THREE_WAY_DAY5 = new URL('./fixtures/s16-three-way-day5-1440p.png', import.meta.url).pathname

test('the three decisions on day 5 read a Normal Alpha Wolf under the warden in cell 14', async () => {
  const panels = await readPanels(loadPng(THREE_WAY_DAY5))
  expect(panels.screen).toBe('manage')
  expect(panels.days).toBe(15)
  expect(panels.decision).toEqual(['Consume', 'Replace', 'End'])
  const [model] = await readModel(THREE_WAY_DAY5)
  expect(model.warden).toBe(13)
  const cell = model.cells[13]
  expect(cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind).toBe('wolf0')
})

const DAY6 = new URL('./fixtures/s16-destination-day6-1440p.png', import.meta.url).pathname

test('the destination pick of day 6 reads the Legendary Lion the Replace left in cell 14', async () => {
  const panels = await readPanels(loadPng(DAY6))
  expect(panels.screen).toBe('patrol')
  expect(panels.days).toBe(14)
  expect(panels.doors).toEqual([15, 16, 1])
  const [model] = await readModel(DAY6)
  expect(model.day).toBe(6)
  const cell = model.cells[13]
  expect(cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind).toBe('lion3')
})

const REPLACE_DAY6 = new URL('./fixtures/s16-replace-or-end-day6-1440p.png', import.meta.url).pathname

test('Replace and End on day 6 read a Normal Rat under the warden in cell 16', async () => {
  const panels = await readPanels(loadPng(REPLACE_DAY6))
  expect(panels.screen).toBe('manage')
  expect(panels.days).toBe(14)
  expect(panels.decision).toEqual(['Replace', 'End'])
  const [model] = await readModel(REPLACE_DAY6)
  expect(model.warden).toBe(15)
  const cell = model.cells[15]
  expect(cell?.kind === 'inmate' ? `${cell.beast}${cell.tier}` : cell?.kind).toBe('rat0')
})
