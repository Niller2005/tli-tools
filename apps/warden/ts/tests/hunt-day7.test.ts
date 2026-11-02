//! Two real frames of one run (day 7, holding the Blood-Stained Trap), taken on Linux at 2560x1440 and kept at
//! 1918x1078. The destination pick carries a Prey crosshair on cell 16, and its three cards pulse, so tesseract
//! reads junk above them: that junk must never count as a decision button, or the cards are dropped. The second
//! frame is the instrument pick the run reached next, with the board dimmed behind it.

import { expect, test } from 'bun:test'
import { Session } from '@/app/session'
import { loadPng, readModel } from '@/reader/mod'
import { readPanels } from '@/reader/panels'
import { ROLLOUTS } from './session-common'

const DESTINATION = new URL('./fixtures/s16-hunt-day7-destination.png', import.meta.url).pathname
const PICK = new URL('./fixtures/s16-instrument-pick-day7.png', import.meta.url).pathname

test('the destination pick reads its three cards and no decision button', async () => {
  const panels = await readPanels(loadPng(DESTINATION))
  expect(panels.screen).toBe('patrol')
  expect(panels.days).toBe(13)
  expect(panels.decision).toEqual([])
  // Go to Cell 15, the Interrogation Room, Go to Cell 2
  expect(panels.doors).toEqual([15, 1, 2])
  expect(panels.held).toEqual(['trap'])
})

test('the board of the destination pick: rarities, the warden and the Lion that hunts', async () => {
  const [model] = await readModel(DESTINATION, ['trap'])
  expect(model.day).toBe(7)
  expect(model.warden).toBe(12)
  expect(model.dest).toEqual([14, 0, 1])
  expect(model.cells.map((c) => (c.kind === 'inmate' ? `${c.beast}${c.tier}` : c.kind))).toEqual([
    'office', 'sealed', 'wolf0', 'sealed', 'rat0', 'sealed', 'lion2', 'sealed',
    'mammoth4', 'mammoth4', 'rat1', 'sealed', 'lion2', 'lion0', 'sealed', 'wolf2',
  ])
  // the crosshair on the Rare Wolf in cell 16 belongs to the Rare Lion under the warden, in cell 13
  const lion = model.cells[12]
  expect(lion?.kind === 'inmate' ? lion.prey?.cell : undefined).toBe(15)
  expect(model.cells.filter((c) => c.kind === 'inmate' && c.prey !== null)).toHaveLength(1)
})

test('the session ranks the three destinations of the pick', async () => {
  const s = new Session(ROLLOUTS, ['trap'], null, null)
  s.readInBackground(loadPng(DESTINATION))
  await s.wait()
  expect(s.ranking).toHaveLength(3)
  expect(s.pick).not.toBeNull()
})

test('the instrument pick that follows names its three offers', async () => {
  const panels = await readPanels(loadPng(PICK))
  expect(panels.screen).toBe('instrumentPick')
  expect(panels.instruments).toEqual(['fire', 'chains', 'blacklist'])
  // the pick covers the days counter
  expect(panels.days).toBeNull()
})
