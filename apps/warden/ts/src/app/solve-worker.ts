//! A worker of the solve pool: it plays the rounds the pool hands it and
//! sends the results back, so the playouts of one solve spread over the
//! cores while the window keeps painting and the capture keeps its pace.
//! See `solve-pool.ts`.

import { Params, State, type StateInit } from '@/engine/state'
import { TUNED } from '@/solver/mod'
import { Rollouts } from '@/solver/solve'

/** What the pool tells a worker. */
export type ToWorker =
  /** a new solve: the board to play from, built again here, as the pool
   * builds it */
  | { kind: 'init'; id: number; state: StateInit; seed: number; bite: number[] | null }
  /** rounds of the solve `id` to play: chunk `chunk` of the stretch, for
   * the candidates `live` */
  | { kind: 'play'; id: number; chunk: number; seeds: number[]; live: number[] }

/** What a worker tells the pool. */
export type FromWorker =
  /** the worker has loaded and takes work */
  | { kind: 'ready' }
  /** the rounds of a chunk, one per seed */
  | { kind: 'played'; id: number; chunk: number; results: [number, number][][] }

const scope = globalThis as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null
  postMessage: (data: FromWorker) => void
}

/** The solve being played: messages arrive in order, so a play always
 * follows the init of its own solve. */
let rollouts: Rollouts | null = null

scope.onmessage = (e: { data: unknown }) => {
  const msg = e.data as ToWorker
  if (msg.kind === 'init') {
    // The state comes over the wire as plain data: its classes are built
    // again here.
    const st = new State({ ...msg.state, params: new Params(msg.state.params) })
    rollouts = msg.bite !== null ? Rollouts.with(st, msg.seed, TUNED, msg.bite) : new Rollouts(st, msg.seed, TUNED)
    return
  }
  const results = rollouts === null ? [] : rollouts.playRounds(msg.seeds, msg.live)
  scope.postMessage({ kind: 'played', id: msg.id, chunk: msg.chunk, results })
}

scope.postMessage({ kind: 'ready' })
