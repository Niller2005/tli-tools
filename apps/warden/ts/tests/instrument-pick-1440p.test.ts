//! Four live frames of one instrument pick at the start of a run, taken on Linux at 2560x1440 and kept as taken, a
//! few seconds apart with the screen untouched. The cards' art is animated, so pixels move by a few levels between
//! frames; the frames read the same, and after the first the OCR cache must keep tesseract from reading them again.

import { expect, test } from 'bun:test'
import { loadPng } from '@/reader/mod'
import { readPanels } from '@/reader/panels'
import { setOcrEngine, tesseractEngine } from '@/reader/ocr'

const FRAMES = [1, 2, 3, 4].map(
  (n) => new URL(`./fixtures/s16-instrument-pick-start-1440p-${n}.png`, import.meta.url).pathname,
)
const REWARD = new URL('./fixtures/s16-instrument-reward-1440p.png', import.meta.url).pathname

test('the pick reads its three offers at 2560x1440', async () => {
  const panels = await readPanels(loadPng(FRAMES[0] as string))
  expect(panels.screen).toBe('instrumentPick')
  // Severed Iron Maiden, Hangman's Noose, Rusty Saw
  expect(panels.instruments).toEqual(['maiden', 'rope', 'saw'])
  expect(panels.decision).toEqual([])
})

test('the reward pick after an objective reads its offers, with the prompt over the title', async () => {
  const panels = await readPanels(loadPng(REWARD))
  expect(panels.screen).toBe('instrumentPick')
  // Kin's Coin of Fate, Warden's Scales, Burning Stake
  expect(panels.instruments).toEqual(['coin', 'scales', 'stake'])
  expect(panels.decision).toEqual([])
})

test('frames of the same screen are read once: the animated art does not miss the OCR cache', async () => {
  let reads = 0
  setOcrEngine({
    ...tesseractEngine,
    async recognizeAll(imgs, digits) {
      reads += imgs.filter((img) => img !== null).length
      return tesseractEngine.recognizeAll(imgs, digits)
    },
  })
  try {
    const first = await readPanels(loadPng(FRAMES[0] as string))
    const afterFirst = reads
    expect(afterFirst).toBeGreaterThan(0)
    for (const path of FRAMES.slice(1)) {
      const panels = await readPanels(loadPng(path))
      expect(panels).toEqual(first)
    }
    expect(reads).toBe(afterFirst)
  } finally {
    setOcrEngine(null)
  }
})
