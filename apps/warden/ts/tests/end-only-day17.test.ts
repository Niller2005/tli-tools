//! A real board from the game (day 17, 3 days until Riot, holding the Blood-Stained Trap and the Executioner's
//! Blacklist), taken on Linux at 2560x1440 and kept at 1918x1078. The warden stands on an Ultimate Mammoth and
//! nothing is left to do but End, whose button sits alone in the middle of the row. Junk read off the End panel's
//! art ("ot 4") was taken for a destination card and the tool advised "Go to cell 04"; the End button is read.

import { expect, test } from 'bun:test'
import { Session } from '@/app/session'
import { loadPng, readModel } from '@/reader/mod'
import { readPanels } from '@/reader/panels'
import { ROLLOUTS } from './session-common'

const FRAME = new URL('./fixtures/s16-end-only-day17.png', import.meta.url).pathname

test('the End button alone is read as the decision, with no destination card', async () => {
  const panels = await readPanels(loadPng(FRAME))
  expect(panels.screen).toBe('manage')
  expect(panels.days).toBe(3)
  expect(panels.decision).toEqual(['End'])
  expect(panels.doors).toEqual([])
  expect(panels.held).toEqual(['trap', 'blacklist'])
})

test('the board: rarities, the warden, the incident and the Lion that hunts the marked Wolf', async () => {
  const [model] = await readModel(FRAME, ['trap', 'blacklist'])
  expect(model.day).toBe(17)
  expect(model.step).toBe('manage')
  expect(model.dest).toEqual([])
  expect(model.warden).toBe(3)
  expect(model.cells.map((c) => (c.kind === 'inmate' ? `${c.beast}${c.tier}` : c.kind))).toEqual([
    'office', 'mammoth3', 'rat3', 'mammoth4', 'sealed', 'mammoth3', 'sealed', 'rat3',
    'wolf4', 'wolf4', 'lion4', 'sealed', 'lion3', 'sealed', 'rat3', 'mammoth3',
  ])
  // the "!" beside cell 10
  expect(model.cells.flatMap((c, i) => (c.kind === 'inmate' && c.event !== null ? [i] : []))).toEqual([9])
  // the crosshair on the Ultimate Wolf in cell 9 belongs to the one Ultimate Lion, in cell 11
  const lion = model.cells[10]
  expect(lion?.kind === 'inmate' ? lion.prey?.cell : undefined).toBe(8)
  expect(model.vault).toHaveLength(10)
})

test('the session advises to end the day', async () => {
  const s = new Session(ROLLOUTS, ['trap', 'blacklist'], null, null)
  s.readInBackground(loadPng(FRAME))
  await s.wait()
  expect(s.pick?.action).toEqual({ type: 'end' })
})
