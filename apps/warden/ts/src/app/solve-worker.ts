//! The solver's worker: it plays the rounds of a solve and sends the
//! ranking as it firms up. The playouts take a second or more, and the
//! window keeps painting and the capture keeps its pace while they run.

import { Params, State, type StateInit } from '@/engine/state'
import { TUNED } from '@/solver/mod'
import { Rollouts, type SolveOption } from '@/solver/solve'

/** A solve to play. */
export interface SolveJob {
  /** the board to play from */
  state: StateInit
  /** the seed of the playouts, as in `warden-cli solve` */
  seed: number
  /** how many playouts per option */
  rollouts: number
  /** how many playouts a ranking holds */
  round: number
  /** the cells of a Consume target pick, when the solve is one */
  bite: number[] | null
}

/** The ranking of a solve, as it stands. */
export interface SolveProgress {
  /** the playouts played */
  rounds: number
  /** whether the solve is over */
  done: boolean
  /** the options, ranked */
  options: SolveOption[]
}

const scope = globalThis as unknown as {
  onmessage: ((e: { data: unknown }) => void) | null
  postMessage: (data: unknown) => void
}

scope.onmessage = (e: { data: unknown }) => {
  const job = e.data as SolveJob
  // The state comes over the wire as plain data: its classes are built
  // again here.
  const st = new State({ ...job.state, params: new Params(job.state.params) })
  const r = job.bite !== null ? Rollouts.with(st, job.seed, TUNED, job.bite) : new Rollouts(st, job.seed, TUNED)
  for (;;) {
    const ran = r.runOn(Math.min(job.round, job.rollouts - r.rounds()), 1)
    const done = ran === 0 || r.rounds() >= job.rollouts
    const progress: SolveProgress = { rounds: r.rounds(), done, options: r.ranking() }
    scope.postMessage(progress)
    if (done) return
  }
}
