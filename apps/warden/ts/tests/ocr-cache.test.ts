//! The OCR cache: a region whose pixels are the same is not read again.

import { describe, expect, test } from 'bun:test'
import { Rect, Rgba } from '@/reader/mod'
import { ocrAll, setOcrEngine } from '@/reader/ocr'

/** An engine that counts the images it is given. */
function counting(): { calls: () => number } {
  let count = 0
  setOcrEngine({
    language: () => 'en',
    async recognizeAll(imgs) {
      count += imgs.filter((img) => img !== null).length
      return imgs.map(() => [])
    },
  })
  return { calls: () => count }
}

describe('the OCR cache', () => {
  test('a region with the same pixels is not read again', async () => {
    const engine = counting()
    const img = new Rgba(100, 100, new Uint8Array(100 * 100 * 4).fill(7))
    const region: [Rect, number] = [new Rect(10, 10, 40, 20), 2]
    await ocrAll([img], [region])
    expect(engine.calls()).toBe(1)
    await ocrAll([img], [region])
    expect(engine.calls()).toBe(1)
    setOcrEngine(null)
  })

  test('a shift of a few levels, as the animated art makes, is not read again', async () => {
    const engine = counting()
    const img = new Rgba(100, 100, new Uint8Array(100 * 100 * 4).fill(60))
    const region: [Rect, number] = [new Rect(10, 10, 40, 20), 2]
    await ocrAll([img], [region])
    img.data.fill(66)
    await ocrAll([img], [region])
    expect(engine.calls()).toBe(1)
    setOcrEngine(null)
  })

  test('a region where a glyph changed is read again', async () => {
    const engine = counting()
    const img = new Rgba(100, 100, new Uint8Array(100 * 100 * 4).fill(7))
    const region: [Rect, number] = [new Rect(10, 10, 40, 20), 2]
    await ocrAll([img], [region])
    for (let y = 12; y < 20; y++) for (let x = 12; x < 18; x++) img.data.fill(200, (y * 100 + x) * 4, (y * 100 + x) * 4 + 4)
    await ocrAll([img], [region])
    expect(engine.calls()).toBe(2)
    setOcrEngine(null)
  })

  test('a slow drift ends in a new read', async () => {
    const engine = counting()
    const img = new Rgba(100, 100, new Uint8Array(100 * 100 * 4).fill(60))
    const region: [Rect, number] = [new Rect(10, 10, 40, 20), 2]
    await ocrAll([img], [region])
    for (const level of [70, 80]) {
      img.data.fill(level)
      await ocrAll([img], [region])
    }
    expect(engine.calls()).toBe(2)
    setOcrEngine(null)
  })

  test('the same pixels at another scale are read again', async () => {
    const engine = counting()
    const img = new Rgba(100, 100, new Uint8Array(100 * 100 * 4).fill(7))
    await ocrAll([img], [[new Rect(10, 10, 40, 20), 2]])
    await ocrAll([img], [[new Rect(10, 10, 40, 20), 3]])
    expect(engine.calls()).toBe(2)
    setOcrEngine(null)
  })

  test('another engine reads the regions again', async () => {
    counting()
    const img = new Rgba(100, 100, new Uint8Array(100 * 100 * 4).fill(7))
    await ocrAll([img], [[new Rect(10, 10, 40, 20), 2]])
    setOcrEngine(null)
    const other = counting()
    await ocrAll([img], [[new Rect(10, 10, 40, 20), 2]])
    expect(other.calls()).toBe(1)
    setOcrEngine(null)
  })
})
