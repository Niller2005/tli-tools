// A worker thread: plays slices of a board's futures, or runs the deep check.
import { playWork, type Work } from '@/strategy/advisor'
import { check, type HelperInput } from '@/web/helper'

type In =
  | { type: 'slice'; id: number; work: Work; from: number; to: number }
  | { type: 'check'; id: number; x: HelperInput; target: number; playouts: number }
  | { type: 'cancel' }

declare const self: { onmessage: ((e: { data: In }) => void) | null; postMessage(m: unknown): void }

let current = 0
self.onmessage = async ({ data: m }) => {
  if (m.type === 'slice') self.postMessage({ type: 'slice', id: m.id, tallies: playWork(m.work, m.from, m.to) })
  else if (m.type === 'cancel') current = 0
  else {
    current = m.id
    try {
      const rows = await check(m.x, m.target, {
        playouts: m.playouts, maxOptions: 6,
        shouldStop: () => current !== m.id,
        onUpdate: (rows, done, total) => { if (current === m.id) self.postMessage({ type: 'rows', id: m.id, rows, done, total }) },
      })
      if (current === m.id) self.postMessage({ type: 'done', id: m.id, rows })
    } catch (err) {
      if (current === m.id) self.postMessage({ type: 'error', id: m.id, message: String(err) })
    }
  }
}
