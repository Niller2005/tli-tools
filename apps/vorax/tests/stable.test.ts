import { describe, expect, test } from 'bun:test'
import { frameDiff, thumb, waitStable } from '@/reader/live/stable'

/** An image of one grey, as ImageData would hold it. */
function grey(width: number, height: number, value: number): ImageData {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) data.fill(value, i, i + 3), (data[i + 3] = 255)
  return { width, height, data, colorSpace: 'srgb' } as ImageData
}

describe('thumb', () => {
  test('is 96 wide, as tall as the picture\'s shape says, and at least one row', () => {
    expect(thumb(grey(960, 540, 10))).toMatchObject({ w: 96, h: 54 })
    expect(thumb(grey(96, 96, 10))).toMatchObject({ w: 96, h: 96 })
    expect(thumb(grey(10000, 1, 10)).h).toBe(1)
  })

  test('a plain picture gives that grey everywhere, however it is scaled', () => {
    for (const [w, h] of [[960, 540], [200, 130]] as const) {
      const t = thumb(grey(w, h, 100))
      for (const v of t.g) expect(v).toBeCloseTo(100, 3)
    }
  })

  test('colours are weighed as brightness: green counts for most', () => {
    const img = grey(96, 1, 0)
    for (let i = 0; i < img.data.length; i += 4) img.data[i + 1] = 255
    const t = thumb(img)
    expect(t.g[0]).toBeCloseTo(0.587 * 255, 3)
  })
})

describe('frameDiff', () => {
  test('pictures that are the same differ by nothing', () => {
    expect(frameDiff(thumb(grey(96, 54, 80)), thumb(grey(96, 54, 80)))).toBe(0)
  })

  test('the difference is the mean grey distance, whichever picture comes first', () => {
    const a = thumb(grey(96, 54, 80))
    const b = thumb(grey(96, 54, 130))
    expect(frameDiff(a, b)).toBeCloseTo(50, 3)
    expect(frameDiff(b, a)).toBeCloseTo(50, 3)
  })

  test('pictures of different shapes are as different as can be', () => {
    expect(frameDiff(thumb(grey(96, 54, 80)), thumb(grey(96, 96, 80)))).toBe(255)
  })

  test('a small patch of change weighs by its share of the picture', () => {
    const img = grey(96, 100, 0)
    for (let x = 0; x < 96; x++) for (let c = 0; c < 3; c++) img.data[x * 4 + c] = 255
    const d = frameDiff(thumb(grey(96, 100, 0)), thumb(img))
    expect(d).toBeCloseTo(255 / 100, 1)
  })
})

describe('waitStable', () => {
  /** A clock that moves 100 ms with every look at it, and a grabber that hands out the given pictures, the last one for good. */
  function rig(frames: ImageData[]) {
    let clock = 0
    let grabs = 0
    return {
      grab: async () => frames[Math.min(grabs++, frames.length - 1)],
      options: { intervalMs: 0, now: () => (clock += 100) },
      grabs: () => grabs,
    }
  }

  test('a picture that does not move is kept after three grabs', async () => {
    const still = grey(96, 54, 50)
    const r = rig([still])
    expect(await waitStable(r.grab, r.options)).toBe(still)
    expect(r.grabs()).toBe(3)
  })

  test('it waits out a picture that is still changing, and gives the one that settled', async () => {
    const moving = [grey(96, 54, 0), grey(96, 54, 40), grey(96, 54, 80)]
    const settled = grey(96, 54, 120)
    const r = rig([...moving, settled, settled, settled, grey(96, 54, 0)])
    expect(await waitStable(r.grab, r.options)).toBe(settled)
    expect(r.grabs()).toBe(6)
  })

  test('a single match is not enough: change after it starts the count again', async () => {
    const a = grey(96, 54, 10)
    const b = grey(96, 54, 200)
    const r = rig([a, a, b, b, b])
    expect(await waitStable(r.grab, r.options)).toBe(b)
    expect(r.grabs()).toBe(5)
  })

  test('a picture that never settles is given up on at the time limit, as the last one seen', async () => {
    let n = 0
    const frames: ImageData[] = []
    const grab = async () => {
      const f = grey(96, 54, (n++ % 2) * 200)
      frames.push(f)
      return f
    }
    let clock = 0
    const got = await waitStable(grab, { intervalMs: 0, maxMs: 1000, now: () => (clock += 100) })
    expect(got).toBe(frames[frames.length - 1])
    expect(frames.length).toBeGreaterThan(3)
    expect(frames.length).toBeLessThan(15)
  })

  test('a looser threshold and fewer matches settle sooner', async () => {
    const r = rig([grey(96, 54, 10), grey(96, 54, 12)])
    await waitStable(r.grab, { ...r.options, threshold: 5, matches: 1 })
    expect(r.grabs()).toBe(2)
  })

  test('a threshold of zero never counts a changed picture as still', async () => {
    const r = rig([grey(96, 54, 10), grey(96, 54, 11), grey(96, 54, 10), grey(96, 54, 11)])
    let clock = 0
    await waitStable(r.grab, { intervalMs: 0, threshold: 0, maxMs: 500, now: () => (clock += 100) })
    expect(r.grabs()).toBeGreaterThan(3)
  })
})
