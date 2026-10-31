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

  test('a region whose pixels changed is read again', async () => {
    const engine = counting()
    const img = new Rgba(100, 100, new Uint8Array(100 * 100 * 4).fill(7))
    const region: [Rect, number] = [new Rect(10, 10, 40, 20), 2]
    await ocrAll([img], [region])
    img.data[10 * 100 * 4 + 10 * 4] = 9
    await ocrAll([img], [region])
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
