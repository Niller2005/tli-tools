//! The theme scroll of the lobby, from a real frame (the run's theme "Tyranny", before the board
//! starts): the reader names the theme and sees no board, and the session keeps the theme, reads no
//! board, says so, and does not recommend a move.

import { expect, test } from 'bun:test'
import { Session } from '@/app/session'
import { data } from '@/engine/data'
import { loadPng } from '@/reader/mod'
import { readPanels, screenLabel } from '@/reader/panels'
import { ROLLOUTS } from './session-common'

const FRAME = new URL('./fixtures/s16-theme-tyranny.png', import.meta.url).pathname

test('the reader names the theme on the lobby scroll and sees no board', async () => {
  const img = loadPng(FRAME)
  const panels = await readPanels(img)
  expect(screenLabel(panels.screen)).toBe('theme')
  expect(data().themeName(panels.theme)).toBe('Tyranny')
  expect(panels.held).toBeNull()
  expect(panels.days).toBeNull()
})

test('the session keeps the theme from the scroll and reads no board', async () => {
  const s = new Session(ROLLOUTS, [], null, null)
  s.readInBackground(loadPng(FRAME))
  await s.wait()
  expect(data().themeName(s.theme)).toBe('Tyranny')
  expect(s.reading).toBeNull()
  expect(s.problems).toEqual([])
  expect(s.ranking).toEqual([])
  expect(s.pick).toBeNull()
  expect(s.missed).toBe("The run's theme: Tyranny.")
})
