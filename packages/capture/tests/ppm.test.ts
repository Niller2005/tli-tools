// The PPM reader: the pixels of a picture `grim` wrote.

import { describe, expect, test } from 'bun:test'
import { ppmToRgba } from '../src/ppm'

describe('the PPM reader', () => {
  test('reads a picture', () => {
    const bytes = new Uint8Array([...Buffer.from('P6\n2 1\n255\n'), 10, 20, 30, 40, 50, 60])
    const img = ppmToRgba(bytes)
    expect(img).not.toBeNull()
    expect(img?.width).toBe(2)
    expect(img?.height).toBe(1)
    expect([...(img?.data ?? [])]).toEqual([10, 20, 30, 255, 40, 50, 60, 255])
  })

  test('reads a picture with comments in its header', () => {
    const bytes = new Uint8Array([...Buffer.from('P6\n# a comment\n2 1\n255\n'), 1, 2, 3, 4, 5, 6])
    const img = ppmToRgba(bytes)
    expect([...(img?.data ?? [])]).toEqual([1, 2, 3, 255, 4, 5, 6, 255])
  })

  test('reads a picture with two bytes a sample', () => {
    const bytes = new Uint8Array([...Buffer.from('P6\n1 1\n65535\n'), 0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc])
    const img = ppmToRgba(bytes)
    expect([...(img?.data ?? [])]).toEqual([18, 86, 154, 255])
  })

  test('gives null for bytes that are not a PPM', () => {
    expect(ppmToRgba(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toBeNull()
    expect(ppmToRgba(Buffer.from('P5\n2 1\n255\n'))).toBeNull()
  })

  test('gives null for a picture whose pixels are missing', () => {
    expect(ppmToRgba(new Uint8Array([...Buffer.from('P6\n4 4\n255\n'), 1, 2, 3]))).toBeNull()
  })
})
