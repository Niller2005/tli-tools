// The look-ahead over every CPU core but one, and the deep check on a core of its own (worker threads).
// Mirrors ahead() in src/web/helper.ts, which needs the browser's Worker.
import { addSettled, addTallies, conclude, prepare, settleWork, type Advice, type Work } from '@/strategy/advisor'
import type { Tally } from '@/strategy/bot'
import { futuresFor, type HelperInput, type Row } from '@/web/helper'
import { cpus } from 'node:os'

interface Slice { id: number; work: Work; from: number; to: number; done: (t: Tally[] | null) => void; tag: number }

export function createAdvisor() {
  const url = new URL('./worker.ts', import.meta.url)
  const size = Math.max(1, Math.min(16, cpus().length - 1))
  const workers: Worker[] = []
  const idle: Worker[] = []
  const busy = new Map<Worker, Slice>()
  const queue: Slice[] = []
  let ids = 0, tag = 0

  const next = () => {
    while (idle.length && queue.length) {
      const w = idle.shift()!, s = queue.shift()!
      busy.set(w, s)
      w.postMessage({ type: 'slice', id: s.id, work: s.work, from: s.from, to: s.to })
    }
  }
  for (let i = 0; i < size; i++) {
    const w = new Worker(url)
    w.onmessage = (e: MessageEvent<{ type: string; id: number; tallies: Tally[] }>) => {
      const s = busy.get(w)
      busy.delete(w); idle.push(w)
      s?.done(e.data.tallies)
      next()
    }
    w.onerror = () => { const s = busy.get(w); busy.delete(w); s?.done(null) }
    workers.push(w); idle.push(w)
  }

  const deepWorker = new Worker(url)
  let deepId = 0
  let onDeep: ((m: { type: string; id: number; rows: Row[]; done: number; total: number; message: string }) => void) | null = null
  deepWorker.onmessage = (e: MessageEvent) => { if (e.data.id === deepId) onDeep?.(e.data) }

  /** Drops the slices of older boards no worker has taken yet. */
  function cancelAhead() {
    tag++
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].tag !== tag) queue.splice(i, 1)[0].done(null)
  }

  return {
    threads: size + 1,
    cancelAhead,
    /** The whole-run look-ahead; null when a newer board replaced it. */
    async ahead(x: HelperInput): Promise<Advice | null> {
      cancelAhead()
      const mine = tag
      const p = prepare(x, futuresFor(size + 1))
      if ('advice' in p) return p.advice
      const runAll = async (work: Work, from: number, to: number) => {
        const n = to - from, parts = Math.min(size * 4, n)
        const run = (a: number, b: number) => {
          const { promise, resolve } = Promise.withResolvers<Tally[] | null>()
          queue.push({ id: ++ids, work, from: a, to: b, done: resolve, tag: mine })
          next()
          return promise
        }
        const got = await Promise.all(Array.from({ length: parts }, (_, i) => run(from + Math.floor((i * n) / parts), from + Math.floor(((i + 1) * n) / parts))))
        return got.some(t => t === null) ? null : addTallies(got as Tally[][])
      }
      let tallies = await runAll(p.work, 0, p.work.futures)
      if (!tallies) return null
      // a close call is played out further before one is picked
      const more = settleWork(p, tallies)
      if (more) {
        const extra = await runAll(more.work, more.from, more.to)
        if (!extra) return null
        tallies = addSettled(tallies, more.idx, extra)
      }
      return conclude(p, tallies)
    },
    /** Deep check to the player's target; a newer call or cancelDeep() stops this one. */
    deep(x: HelperInput, target: number, on: { rows(rows: Row[], done: number, total: number): void; done(rows: Row[]): void; error(message: string): void }, playouts = 60) {
      const id = ++deepId
      onDeep = m => {
        if (m.type === 'rows') on.rows(m.rows, m.done, m.total)
        else if (m.type === 'done') on.done(m.rows)
        else if (m.type === 'error') on.error(m.message)
      }
      deepWorker.postMessage({ type: 'check', id, x, target, playouts })
    },
    cancelDeep() { deepId++; onDeep = null; deepWorker.postMessage({ type: 'cancel' }) },
    close() { for (const w of workers) w.terminate(); deepWorker.terminate() },
  }
}
