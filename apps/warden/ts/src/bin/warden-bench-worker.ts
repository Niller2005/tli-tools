//! The bench's worker: plays a chunk of the bench's games and sends the
//! numbers back, so the run spreads over the cores as the Rust build's does.
//! See `warden-cli.ts`.

import type { Tool } from '@/engine/data'
import { play, playStrategy } from '@/solver/bench'
import { TUNED, type Params } from '@/solver/mod'

/** A chunk of the bench's games to play. */
export interface BenchJob {
  /** 'play': the strategy alone and the advice; 'strategy': the strategy
   * alone, on the weights given. */
  kind: 'play' | 'strategy'
  seed: number
  /** The first game to play. */
  from: number
  /** The game to stop before. */
  to: number
  rollouts: number
  held: Tool[]
  rerolls: number
  params: Params | null
}

const scope = globalThis as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null
  postMessage: (data: unknown) => void
}

scope.onmessage = (e: { data: unknown }) => {
  const job = e.data as BenchJob
  const results: unknown[] = []
  for (let k = job.from; k < job.to; k++) {
    results.push(
      job.kind === 'play'
        ? play(job.seed, k, job.rollouts)
        : playStrategy(job.seed, k, job.held, job.rerolls, job.params ?? TUNED),
    )
  }
  scope.postMessage(results)
}
