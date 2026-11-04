//! The solve's workers: the playouts of a solve are spread over several
//! worker threads. The pool draws the seeds and takes the results in seed
//! order (see `Rollouts`), so the ranking is the one a single thread gives.
//! The workers load once and serve every solve; they do not keep the
//! process alive.

import { availableParallelism } from 'node:os'

import { Params, State, type StateInit } from '@/engine/state'
import { TUNED } from '@/solver/mod'
import { Rollouts, type SolveOption, type Stretch } from '@/solver/solve'
import type { FromWorker, ToWorker } from './solve-worker'

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

/** A solve that runs in the pool. */
export interface SolveRun {
  /** Ends when the solve is over or cancelled. */
  done: Promise<void>
  /** Stops the solve at its next stretch; its ranking stays as it was. */
  cancel(): void
}

/** The workers' file. */
const WORKER = new URL('./solve-worker.ts', import.meta.url)

/** How many workers a solve uses: a quarter of the machine's threads, so the
 * game and the screen reader keep theirs (more workers add little: a
 * 16-thread machine solves in 0.75 s on 4 and 0.6 s on 8), and at most 8.
 * The environment variable `WARDEN_SOLVE_THREADS` sets it. */
export function solveThreads(): number {
  const set = Number(process.env.WARDEN_SOLVE_THREADS)
  if (Number.isInteger(set) && set >= 1) return set
  return Math.max(1, Math.min(8, Math.floor(availableParallelism() / 4)))
}

/** A worker and what it is doing. */
interface Slot {
  worker: Worker
  /** loaded and not playing a chunk */
  idle: boolean
  /** the chunk it is playing, which goes back in the queue if it dies */
  chunk: { id: number; index: number } | null
}

/** The chunks of the stretch being played. */
interface Pending {
  id: number
  seeds: number[][]
  live: number[]
  /** the chunks not handed to a worker yet */
  queue: number[]
  results: ([number, number][][] | null)[]
  left: number
  finish: (results: [number, number][][] | null) => void
}

/** Worker threads that play the rounds of a solve. */
export class SolvePool {
  private readonly size: number
  private slots: Slot[] = []
  /** The number of the latest solve; a solve that is not the latest has been
   * replaced and ends at its next stretch. */
  private latest = 0
  /** The stretch being played. */
  private pending: Pending | null = null

  constructor(size: number) {
    this.size = Math.max(1, size)
  }

  /** Starts the workers that are not running, so the first solve does not
   * wait for them to load. */
  warm(): void {
    while (this.slots.length < this.size) this.spawn()
  }

  /** Plays `job`, reporting the ranking after every `job.round` playouts
   * and once more when the solve is over. A new solve replaces the one that
   * is running. */
  solve(job: SolveJob, onProgress: (progress: SolveProgress) => void): SolveRun {
    const id = ++this.latest
    this.release(null)
    this.warm()
    for (const slot of this.slots) {
      const msg: ToWorker = { kind: 'init', id, state: job.state, seed: job.seed, bite: job.bite }
      slot.worker.postMessage(msg)
    }
    // A solve in flight keeps the process alive: a caller that awaits it
    // has nothing else to wait on.
    this.hold(true)
    // The pool plays the same solve as the workers, to draw the seeds and
    // to rank the results.
    const st = new State({ ...job.state, params: new Params(job.state.params) })
    const r = job.bite !== null ? Rollouts.with(st, job.seed, TUNED, job.bite) : new Rollouts(st, job.seed, TUNED)
    const cancelled = (): boolean => this.latest !== id
    const done = (async () => {
      try {
        for (;;) {
          const want = Math.min(job.round, job.rollouts - r.rounds())
          let ran = 0
          while (ran < want) {
            const stretch = r.next(want - ran)
            if (stretch === null) break
            const results = await this.play(id, stretch)
            if (results === null || cancelled()) return
            r.commit(stretch, results)
            ran += stretch.seeds.length
          }
          const finished = ran === 0 || r.rounds() >= job.rollouts
          onProgress({ rounds: r.rounds(), done: finished, options: r.ranking() })
          if (finished) return
        }
      } finally {
        // A replaced solve leaves the workers to the one that replaced it.
        if (!cancelled()) this.hold(false)
      }
    })()
    return {
      done,
      cancel: () => {
        if (this.latest === id) {
          this.latest += 1
          this.release(null)
          this.hold(false)
        }
      },
    }
  }

  /** Keeps the process alive for the workers, or lets it end with them idle. */
  private hold(on: boolean): void {
    for (const slot of this.slots) {
      if (on) slot.worker.ref()
      else slot.worker.unref()
    }
  }

  /** Plays the rounds of `stretch`, in chunks over the workers; null when
   * the solve is replaced or no worker is left. */
  private play(id: number, stretch: Stretch): Promise<[number, number][][] | null> {
    const { promise, resolve } = Promise.withResolvers<[number, number][][] | null>()
    // Chunks of a few rounds, so a worker that loads late or a slow core
    // does not hold the stretch up.
    const per = Math.max(1, Math.ceil(stretch.seeds.length / (this.size * 3)))
    const seeds: number[][] = []
    for (let i = 0; i < stretch.seeds.length; i += per) seeds.push(stretch.seeds.slice(i, i + per))
    this.pending = {
      id,
      seeds,
      live: stretch.live,
      queue: seeds.map((_, i) => i),
      results: seeds.map(() => null),
      left: seeds.length,
      finish: resolve,
    }
    this.dispatch()
    return promise
  }

  /** Hands the queued chunks to the idle workers. */
  private dispatch(): void {
    const p = this.pending
    if (p === null) return
    for (const slot of this.slots) {
      if (p.queue.length === 0) return
      if (!slot.idle) continue
      const chunk = p.queue.shift() as number
      slot.idle = false
      slot.chunk = { id: p.id, index: chunk }
      const msg: ToWorker = { kind: 'play', id: p.id, chunk, seeds: p.seeds[chunk], live: p.live }
      slot.worker.postMessage(msg)
    }
  }

  /** Ends the stretch being played with `results`. */
  private release(results: [number, number][][] | null): void {
    const p = this.pending
    this.pending = null
    p?.finish(results)
  }

  private spawn(): void {
    const worker = new Worker(WORKER)
    const slot: Slot = { worker, idle: false, chunk: null }
    this.slots.push(slot)
    worker.unref()
    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data as FromWorker
      slot.idle = true
      slot.chunk = null
      const p = this.pending
      if (msg.kind === 'played' && p !== null && msg.id === p.id) {
        p.results[msg.chunk] = msg.results
        p.left -= 1
        if (p.left === 0) {
          const rounds: [number, number][][] = []
          for (const chunk of p.results) rounds.push(...(chunk ?? []))
          this.release(rounds)
        }
      }
      this.dispatch()
    }
    worker.onerror = () => this.lose(slot)
  }

  /** Drops a worker that died: the chunk it was playing goes to another
   * one, and the stretch ends when no worker is left. */
  private lose(slot: Slot): void {
    this.slots = this.slots.filter((s) => s !== slot)
    slot.worker.terminate()
    const p = this.pending
    if (p !== null && slot.chunk !== null && slot.chunk.id === p.id) p.queue.unshift(slot.chunk.index)
    if (this.slots.length === 0) this.release(null)
    else this.dispatch()
  }
}

/** The pool of the process, made at the first use. */
let shared: SolvePool | null = null

/** The pool of the process. */
export function solvePool(): SolvePool {
  shared ??= new SolvePool(solveThreads())
  return shared
}
