// Warden's timings on real frames: how long each stage of a read takes,
// how long it takes from a frame to the advice, and how long the main
// thread is held up while the board is read and the move is solved.
//
//   bun run ts/tools/profile.ts [frame.png ...]

import { readFileSync } from 'node:fs'
import { decodePngClamped } from '@tli/png'
import { ppmToRgba } from '../../../../packages/capture/src/ppm'
import { Rgba } from '@/reader/mod'
import { layOut, layOutScaled, uiScale } from '@/reader/layout'
import { readScene } from '@/reader/scene'
import { readPanelsTitled } from '@/reader/panels'
import { fingerprint, Session } from '@/app/session'
import { toModel } from '@/reader/model'
import { buildState } from '@/board/board'

/** How long a stage took, in milliseconds. */
function ms(t0: number): number {
  return performance.now() - t0
}

/** Waits a little while. */
async function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  await promise
}

/** The median and the 95th percentile of the times, in milliseconds. */
function stats(times: number[]): string {
  if (times.length === 0) return '-'
  const sorted = [...times].sort((a, b) => a - b)
  const at = (q: number): number => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
  return `${at(0.5).toFixed(1)} / ${at(0.95).toFixed(1)}`
}

/** A timer that runs every so often, to see how long the main thread was
 * held up. */
class Blocking {
  private longest = 0
  private timer: ReturnType<typeof setInterval> | null = null
  private last = performance.now()

  start(): void {
    this.last = performance.now()
    this.timer = setInterval(() => {
      const now = performance.now()
      this.longest = Math.max(this.longest, now - this.last)
      this.last = now
    }, 10)
  }

  stop(): number {
    clearInterval(this.timer)
    this.timer = null
    return this.longest
  }
}

/** The picture of a PPM file, as the capture reads it. */
function fromPpm(bytes: Uint8Array): Rgba | null {
  const img = ppmToRgba(bytes)
  if (img === null) return null
  return new Rgba(img.width, img.height, img.data)
}

async function main(): Promise<void> {
  const paths = process.argv.slice(2)
  for (const path of paths) {
    console.log(`\n=== ${path} ===`)
    const bytes = readFileSync(path)
    const ppm = fromPpm(bytes)
    let img: Rgba
    let capture = 0
    if (ppm !== null) {
      img = ppm
      const t = performance.now()
      fromPpm(bytes)
      capture = ms(t)
      console.log(`  capture picture (PPM): ${capture.toFixed(1)} ms`)
    } else {
      const raw = decodePngClamped(bytes)
      img = new Rgba(raw.width, raw.height, new Uint8Array(raw.data.buffer, raw.data.byteOffset, raw.data.byteLength))
      const t = performance.now()
      decodePngClamped(bytes)
      capture = ms(t)
      console.log(`  capture picture (PNG): ${capture.toFixed(1)} ms`)
    }
    console.log(`  size: ${img.w} x ${img.h}`)

    const scales: number[] = []
    const layouts: number[] = []
    const scenes: number[] = []
    const prints: number[] = []
    const ocrs: number[] = []
    for (let i = 0; i < 3; i++) {
      let t = performance.now()
      const u = uiScale(img, i === 0 ? null : 1.0)
      scales.push(ms(t))
      t = performance.now()
      layOut(img, u ?? 1)
      layouts.push(ms(t))
      t = performance.now()
      readScene(layOut(img, u ?? 1))
      scenes.push(ms(t))
      t = performance.now()
      fingerprint(img)
      prints.push(ms(t))
    }
    console.log(`  uiScale (median/p95 ms): ${stats(scales)}`)
    console.log(`  layOut:                   ${stats(layouts)}`)
    console.log(`  readScene:                ${stats(scenes)}`)
    console.log(`  fingerprint:              ${stats(prints)}`)

    // The panels: the first read and the reads after it, which find the
    // regions the same.
    const board = layOutScaled(img, 1.0)
    let t = performance.now()
    await readPanelsTitled(board[0], board[1] ?? board[0])
    const first = ms(t)
    t = performance.now()
    await readPanelsTitled(board[0], board[1] ?? board[0])
    const again = ms(t)
    console.log(`  readPanels (first/again): ${first.toFixed(1)} / ${again.toFixed(1)} ms`)
    ocrs.push(first, again)

    // The whole read and the solve, as the app does them.
    const session = new Session(1600, [], null, null)
    const blocking = new Blocking()
    blocking.start()
    t = performance.now()
    session.readInBackground(img)
    // The advice is on show as soon as the read is in: the playouts only
    // tell whether it is the best move.
    for (let i = 0; i < 400 && session.advice() === null && session.reading === null; i++) {
      session.poll()
      await sleep(5)
    }
    const advice = ms(t)
    const adviceBlock = blocking.stop()
    console.log(`  frame to advice:          ${advice.toFixed(1)} ms (the main thread held ${adviceBlock.toFixed(1)} ms)`)

    const solving = new Blocking()
    solving.start()
    t = performance.now()
    await session.wait()
    const solve = ms(t)
    const solveBlock = solving.stop()
    console.log(`  read and solve:           ${solve.toFixed(1)} ms (the main thread held ${solveBlock.toFixed(1)} ms)`)
    console.log(`  ranking:                  ${session.ranking.length} moves, ${session.rounds} rounds`)
    void toModel
    void buildState
  }
}

await main()
