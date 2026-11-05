//! Live frames of days 7 to 20 of the same run as early-days-1440p.test.ts (2560x1440, the Noose and the Coin of
//! Fate held): destination picks, decisions, incident popups, Consume targets, Chromatic treasures, the prison status
//! views and the Riot. The frames are read once each and cached; the board is read only where the screen shows one.
//! Tiers are not asserted: one-shot reads of frames the game drew without rarity glow read Normal.

import { expect, test } from 'bun:test'
import { loadPng, readModel } from '@/reader/mod'
import { type Panels, readPanels } from '@/reader/panels'

const path = (name: string) => new URL(`./fixtures/s16-${name}-1440p.png`, import.meta.url).pathname

const cache = new Map<string, Promise<Panels>>()
function panelsOf(name: string): Promise<Panels> {
  let read = cache.get(name)
  if (!read) {
    read = readPanels(loadPng(path(name)))
    cache.set(name, read)
  }
  return read
}

async function warden(name: string): Promise<[number, number]> {
  const [model] = await readModel(path(name))
  return [model.day, model.warden]
}

const SLOW = 120_000

// [frame, days left, doors, warden cell index, day]
const PATROLS: [string, number, number[], number, number][] = [
  ['destination-day7', 13, [2, 4, 5], 15, 7],
  ['destination-day8', 12, [8, 11, 12], 5, 8],
  ['destination-day10', 11, [12, 16, 1], 10, 9],
  ['destination-day11', 10, [4, 5, 6], 0, 10],
  ['destination-day12', 9, [8, 9, 12], 5, 11],
  ['destination-day12-2', 8, [10, 11, 14], 8, 12],
  ['destination-day13', 7, [1, 2, 3], 13, 13],
  ['destination-day15', 6, [3, 6, 7], 1, 14],
  ['destination-day16', 5, [9, 10, 11], 6, 15],
  ['destination-day17', 4, [11, 13, 14], 8, 16],
  ['destination-day18', 3, [1, 3, 4], 13, 17],
  ['destination-day18-2', 2, [4, 7, 8], 2, 18],
  ['destination-day19', 1, [7, 9, 10], 3, 19],
  ['destination-day20', 0, [11, 14, 15], 9, 20],
]

test('the destination picks of days 7 to 20 read their doors, the days left and both held instruments', async () => {
  for (const [name, days, doors] of PATROLS) {
    const panels = await panelsOf(name)
    expect([name, panels.screen]).toEqual([name, 'patrol'])
    expect([name, panels.days]).toEqual([name, days])
    expect([name, panels.doors]).toEqual([name, doors])
    expect([name, panels.held]).toEqual([name, ['rope', 'coin']])
  }
}, SLOW)

test('the destination picks of days 7 to 20 place the warden and count the day from the days left', async () => {
  for (const [name, , , cell, day] of PATROLS) {
    expect([name, await warden(name)]).toEqual([name, [day, cell]])
  }
}, SLOW)

test('the counter of the last two days reads 1 on day 19 and 0 on the last day', async () => {
  expect((await panelsOf('destination-day19')).days).toBe(1)
  expect((await panelsOf('destination-day20')).days).toBe(0)
})

// [frame, decision, days left, warden cell index, day]
const DECISIONS: [string, string[], number, number, number][] = [
  ['replace-or-end-day7', ['Replace', 'End'], 13, 5, 7],
  ['consume-or-end-day7', ['Consume', 'End'], 13, 5, 7],
  ['three-way-day8', ['Consume', 'Replace', 'End'], 12, 10, 8],
  ['consume-or-end-day8', ['Consume', 'End'], 12, 10, 8],
  ['replace-or-end-day11', ['Replace', 'End'], 10, 5, 10],
  ['three-way-day12', ['Consume', 'Replace', 'End'], 9, 8, 11],
  ['consume-or-end-day12', ['Consume', 'End'], 9, 8, 11],
  ['replace-or-end-day12', ['Replace', 'End'], 8, 13, 12],
  ['consume-or-end-day12-2', ['Consume', 'End'], 8, 13, 12],
  ['four-way-day13', ['Consume', 'Replace', 'End'], 7, 1, 13],
  ['three-way-day15', ['Consume', 'Replace', 'End'], 6, 6, 14],
  ['consume-or-end-day15', ['Consume', 'End'], 6, 6, 14],
  ['replace-or-end-day16', ['Replace', 'End'], 5, 8, 15],
  ['replace-or-end-day17', ['Replace', 'End'], 4, 13, 16],
  ['consume-or-end-day17', ['Consume', 'End'], 4, 13, 16],
  ['six-way-day18', ['Consume', 'Replace', 'End'], 3, 2, 17],
  ['three-way-day18-2', ['Consume', 'Replace', 'End'], 2, 3, 18],
  ['consume-or-end-day18-2', ['Consume', 'End'], 2, 3, 18],
  ['replace-or-end-day19', ['Replace', 'End'], 1, 9, 19],
  ['consume-or-end-day19', ['Consume', 'End'], 1, 9, 19],
  ['replace-or-finish-last-day', ['Replace', 'End'], 0, 13, 20],
  ['consume-or-finish-last-day', ['Consume', 'End'], 0, 13, 20],
]

test('the decisions of days 7 to 20 read their buttons, the days left and both held instruments', async () => {
  for (const [name, decision, days] of DECISIONS) {
    const panels = await panelsOf(name)
    expect([name, panels.screen]).toEqual([name, 'manage'])
    expect([name, panels.decision]).toEqual([name, decision])
    expect([name, panels.days]).toEqual([name, days])
    expect([name, panels.held]).toEqual([name, ['rope', 'coin']])
  }
}, SLOW)

test('the decisions of days 7 to 20 place the warden and count the day from the days left', async () => {
  for (const [name, , , cell, day] of DECISIONS) {
    expect([name, await warden(name)]).toEqual([name, [day, cell]])
  }
}, SLOW)

const INCIDENTS = [
  'incident-sewer-ratway',
  'incident-chain-reaction',
  'incident-high-risk-convict',
  'incident-treasure-hunt',
  'incident-archenemy',
  'incident-crow-whispers',
]

test('every incident reads as a popup', async () => {
  for (const name of INCIDENTS) {
    const panels = await panelsOf(name)
    expect([name, panels.screen, panels.decision, panels.doors]).toEqual([name, 'popup', [], []])
  }
}, SLOW)

test('the Sewer Ratway cell pick reads the days left and the instruments', async () => {
  const panels = await panelsOf('sewer-ratway-select-day7')
  expect(panels.screen).toBe('cellPick')
  expect(panels.days).toBe(13)
  expect(panels.held).toEqual(['rope', 'coin'])
  expect(await warden('sewer-ratway-select-day7')).toEqual([7, 3])
}, SLOW)

test('the Instigate or Bestow pick reads as the interrogation with the days left', async () => {
  const panels = await panelsOf('instigate-or-bestow-day10')
  expect(panels.screen).toBe('interrogation')
  expect(panels.days).toBe(11)
  expect(panels.held).toEqual(['rope', 'coin'])
})

const TARGETS = [
  'consume-target-day7',
  'consume-target-day12',
  'chain-consume-target',
  'chain-consume-second',
  'consume-target-day18',
  'consume-target-day19',
  'consume-target-last-day',
]

test('every Consume target pick reads as a chainTarget with only Cancel to click', async () => {
  for (const name of TARGETS) {
    const panels = await panelsOf(name)
    expect([name, panels.screen, panels.decision]).toEqual([name, 'chainTarget', ['Cancel']])
  }
}, SLOW)

const TREASURES = [
  'chromatic-treasure-day7',
  'chromatic-treasure-day9',
  'chromatic-treasure-day10',
  'chromatic-treasure-day11',
  'chromatic-treasure-day14',
  'chromatic-treasure-day16',
  'chromatic-treasure-day18',
]

test('every Chromatic treasure reward reads as a treasurePick', async () => {
  for (const name of TREASURES) {
    expect([name, (await panelsOf(name)).screen]).toEqual([name, 'treasurePick'])
  }
}, SLOW)

test('the instrument picks of the start read as instrumentPick', async () => {
  for (const n of [1, 2, 3, 4]) {
    const name = `instrument-pick-start-1440p-${n}`
    const panels = await readPanels(loadPng(new URL(`./fixtures/s16-${name}.png`, import.meta.url).pathname))
    expect([name, panels.screen]).toEqual([name, 'instrumentPick'])
  }
}, SLOW)

// [frame, days left, Chromatic Prisoner slots filled, warden cell index, day]
const STATUS: [string, number, number, number, number][] = [
  ['treasure-board-inspection-day7', 13, 1, 5, 7],
  ['treasure-board-inspection-day9', 11, 2, 10, 9],
  ['treasure-board-inspection-day10', 11, 3, 0, 9],
  ['treasure-board-inspection-day11', 10, 4, 0, 10],
  ['treasure-board-inspection-day11-2', 9, 5, 8, 11],
  ['treasure-board-inspection-day14', 6, 6, 1, 14],
  ['treasure-board-inspection-day16', 5, 7, 6, 15],
  ['treasure-board-inspection-day18', 3, 8, 13, 17],
  ['treasure-board-inspection-day18-2', 2, 9, 2, 18],
  ['treasure-board-inspection-day18-3', 1, 10, 3, 19],
]

test('the prison status views read the days left, including the 2 that used to read null', async () => {
  for (const [name, days] of STATUS) {
    const panels = await panelsOf(name)
    expect([name, panels.screen]).toEqual([name, 'prisonStatus'])
    expect([name, panels.days]).toEqual([name, days])
  }
}, SLOW)

test('the prison status views of days 7 to 19 read the vault, the warden and the day', async () => {
  for (const [name, , filled, cell, day] of STATUS) {
    const [model] = await readModel(path(name))
    expect([name, model.vault.length, model.warden, model.day]).toEqual([name, filled, cell, day])
  }
}, SLOW)

test('the counter reads 2 on the three day-18-2 frames and the status view that used to read null', async () => {
  for (const name of ['destination-day18-2', 'three-way-day18-2', 'consume-or-end-day18-2', 'treasure-board-inspection-day18-2']) {
    expect([name, (await panelsOf(name)).days]).toEqual([name, 2])
  }
})

test('the Riot reads as the end of the run', async () => {
  expect((await panelsOf('riot')).screen).toBe('runEnd')
})
