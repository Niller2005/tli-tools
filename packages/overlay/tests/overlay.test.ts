import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { maskOverlay, publishCard, readCards, readRects } from '../src'
import { serveCards } from '../src/obs'

const dirs: string[] = []
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'tli-overlay-test-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

const picture = (width: number, height: number) => ({ width, height, data: new Uint8ClampedArray(width * height * 4).fill(200) })
const black = (img: ReturnType<typeof picture>, x: number, y: number) => img.data[(y * img.width + x) * 4] === 0

test('the mask follows the output scale and leaves the rest alone', () => {
  const img = picture(40, 20) // a 2x picture of a 20 x 10 area at (100, 50)
  const n = maskOverlay(img, { x: 100, y: 50, width: 20, height: 10 }, [{ x: 105, y: 52, width: 4, height: 2 }])
  expect(n).toBe(1)
  expect(black(img, 10, 4)).toBe(true)
  expect(black(img, 17, 7)).toBe(true)
  expect(black(img, 9, 4)).toBe(false)
  expect(black(img, 18, 4)).toBe(false)
  expect(black(img, 10, 8)).toBe(false)
})

test('a rectangle partly or wholly outside the picture is clipped or skipped', () => {
  const img = picture(10, 10)
  const n = maskOverlay(img, { x: 0, y: 0, width: 10, height: 10 }, [
    { x: -5, y: -5, width: 7, height: 7 },
    { x: 50, y: 50, width: 5, height: 5 },
  ])
  expect(n).toBe(1)
  expect(black(img, 1, 1)).toBe(true)
  expect(black(img, 2, 2)).toBe(false)
})

test('cards of tools that have exited are dropped, and a taken-down card is gone', () => {
  const dir = tmp()
  publishCard('vorax', { tool: 'vorax', title: 't', head: 'h' }, dir)
  mkdirSync(join(dir, 'cards'), { recursive: true })
  writeFileSync(join(dir, 'cards', 'old.json'), JSON.stringify({ tool: 'old', title: '', head: '', pid: 2 ** 22 + 12345 }))
  expect(readCards(dir).map(c => c.tool)).toEqual(['vorax'])
  publishCard('vorax', null, dir)
  expect(readCards(dir)).toEqual([])
})

test('rectangles of an overlay that has exited are not used', () => {
  const dir = tmp()
  writeFileSync(join(dir, 'rects.json'), JSON.stringify({ pid: process.pid, rects: [{ x: 1, y: 2, width: 3, height: 4 }] }))
  expect(readRects(dir)).toHaveLength(1)
  writeFileSync(join(dir, 'rects.json'), JSON.stringify({ pid: 2 ** 22 + 12345, rects: [{ x: 1, y: 2, width: 3, height: 4 }] }))
  expect(readRects(dir)).toEqual([])
})

test('the OBS page serves only the cards of the tools asked for', async () => {
  const dir = tmp()
  publishCard('tracker', { tool: 'tracker', title: 'Loot', head: '1 FE' }, dir)
  publishCard('vorax', { tool: 'vorax', title: 'Vorax', head: 'move' }, dir)
  const server = serveCards(0, dir)
  try {
    const get = async (q: string) => (await (await fetch(`http://127.0.0.1:${server.port}/cards${q}`)).json()) as { tool: string }[]
    expect((await get('?tool=tracker')).map(c => c.tool)).toEqual(['tracker'])
    expect((await get('')).map(c => c.tool)).toEqual(['tracker', 'vorax'])
  } finally {
    server.stop(true)
  }
})
