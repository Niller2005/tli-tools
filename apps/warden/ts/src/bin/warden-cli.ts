#!/usr/bin/env bun
//! The command line: `warden-cli` is the console build, so it prints to the
//! terminal it runs from and the shell waits for its exit code. `warden` is
//! the window.
//!
//!   warden-cli solve <board.json | frame.png> [--rollouts N] [--seed S] [--tools id,id]
//!   warden-cli read <frame.png> [--tools id,id]
//!   warden-cli capture [--frames N] [--capture-cmd <command writing a PNG of the game to {out}>] <title text> <out.png>
//!   warden-cli bench [--games N] [--rollouts R] [--seed S] [--threads T]
//!   warden-cli bench --strategy-only [--set name=value,...] [--hold id,id] [--rerolls N] [--save file] [--against file] [--games N] [--seed S] [--threads T]
//!   warden-cli --version
//!
//! A port of src/bin/warden-cli.rs.

import { readFileSync, writeFileSync } from 'node:fs'
import { extname } from 'node:path'
import { createCapture } from '@tli/capture'
import { asBytes } from '@tli/png'
import { buildState, modelFromJson, type Model } from '@/board/board'
import { toolFromKey, type Tool } from '@/engine/data'
import { Rgba, readModel, savePng } from '@/reader/mod'
import { LOW, bench, isLow, meanSe, spread, strategyBench, summarize, type Game, type Solo } from '@/solver/bench'
import { cloneParams, setWeight, TUNED, type Params } from '@/solver/mod'
import { instant, solve } from '@/solver/solve'
import { fixed, signed } from '@/format'
import type { BenchJob } from './warden-bench-worker'

const USAGE =
  'usage: warden-cli solve <board.json | frame.png> [--rollouts N] [--seed S] [--tools id,id] | warden-cli read <frame.png> [--tools id,id] | warden-cli capture [--frames N] [--capture-cmd COMMAND] <title text> <out.png> | warden-cli bench [--games N] [--rollouts R] [--seed S] [--threads T] | warden-cli bench --strategy-only [--set name=value,...] [--hold id,id] [--rerolls N] [--save file] [--against file] [--games N] [--seed S] [--threads T] | warden-cli --version'

/** A closed pipe (`| head`) is not an error here, as in the Rust build. */
process.stdout.on('error', (e: NodeJS.ErrnoException) => {
  if (e.code === 'EPIPE') process.exit(0)
})

/** `println!`: a line on stdout. */
function out(text = ''): void {
  process.stdout.write(`${text}\n`)
}

/** Rust's `{:>width$}` and `{:<width$}`: padding counted in characters. */
function pad(text: string, width: number, right: boolean): string {
  const chars = [...text]
  if (chars.length >= width) return text
  const fill = ' '.repeat(width - chars.length)
  return right ? fill + text : text + fill
}

/** Rust's `{:?}` for an f64: the shortest form that reads back, with a
 * decimal point on a whole number. */
function debugFloat(x: number): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  if (Number.isInteger(x)) return `${x}.0`
  return String(x)
}

/** Rust's `{:?}` for the strategy weights, as the bench prints them. */
function debugParams(p: Params): string {
  const fields: [string, number][] = [
    ['tier_base', p.tierBase],
    ['rainbow_mult', p.rainbowMult],
    ['w_open', p.wOpen],
    ['w_now', p.wNow],
    ['w_walk', p.wWalk],
    ['w_step', p.wStep],
    ['w_chain', p.wChain],
    ['w_event', p.wEvent],
    ['w_stair', p.wStair],
    ['min_devour', p.minDevour],
    ['swap_max_tier', p.swapMaxTier],
    ['w_goal', p.wGoal],
    ['w_incident', p.wIncident],
    ['reroll_rank', p.rerollRank],
    ['room_tyranny', p.roomTyranny],
  ]
  return `Params { ${fields.map(([name, value]) => `${name}: ${debugFloat(value)}`).join(', ')} }`
}

/** The version of the crate the port follows. */
function version(): string {
  try {
    const text = readFileSync(new URL('../../../Cargo.toml', import.meta.url), 'utf8')
    const found = /^version\s*=\s*"([^"]+)"/m.exec(text)
    if (found !== null) return found[1]
  } catch {
    // No Cargo.toml beside the build: the fallback below stands.
  }
  return '0.8.0'
}

/** A flag's number, as Rust's `parse` reads it: digits, an optional sign. */
function number(flag: string, value: string | undefined): number {
  const text = value ?? ''
  const n = /^\+?\d+$/.test(text) ? Number(text) : NaN
  if (!Number.isFinite(n) || !Number.isSafeInteger(n)) throw new Error(`${flag} needs a number; ${USAGE}`)
  return n
}

/** `--tools id,id`: instrument keys such as coin or chains. */
function tools(value: string | undefined): Tool[] {
  if (value === undefined) throw new Error(`--tools needs instrument ids; ${USAGE}`)
  const out: Tool[] = []
  for (const part of value.split(',')) {
    const key = part.trim()
    if (key === '') continue
    const tool = toolFromKey(key)
    if (tool === null) throw new Error(`unknown instrument id ${key}`)
    out.push(tool)
  }
  return out
}

function isPng(file: string): boolean {
  const ext = extname(file).toLowerCase()
  return ext === '.png'
}

/** The picture of the game window, as the reader takes it. */
function asRgba(img: { width: number; height: number; data: Uint8ClampedArray }): Rgba {
  const bytes = asBytes(img)
  return new Rgba(bytes.width, bytes.height, bytes.data)
}

/** `capture [--frames N] [--capture-cmd COMMAND] <title text> <out.png>`: saves
 * the client area of the first visible window whose title contains the text, as
 * the reader takes it. With `--frames` it grabs N frames through one capture
 * session, as auto read does, and prints the mean time per frame after the
 * first. With `--capture-cmd` the picture comes from that command instead of
 * from niri. */
async function runCapture(args: string[]): Promise<number> {
  let frames: number | null = null
  let captureCmd: string | null = null
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--frames') {
      frames = number('--frames', args[++i])
    } else if (args[i] === '--capture-cmd') {
      captureCmd = args[++i]
      if (captureCmd === undefined) throw new Error('--capture-cmd needs a command')
    } else {
      rest.push(args[i])
    }
  }
  if (rest.length !== 2) throw new Error(USAGE)
  const [title, target] = rest
  const capture = createCapture({ title: new RegExp(escapeRegExp(title), 'i'), command: captureCmd ?? undefined })
  let img: Rgba
  try {
    if (frames === null) {
      img = asRgba(await capture.grab())
    } else {
      const times: number[] = []
      let last: Rgba | null = null
      for (let i = 0; i < Math.max(frames, 1); i++) {
        const start = performance.now()
        last = asRgba(await capture.grab())
        times.push(performance.now() - start)
      }
      out(`first frame ${fixed(times[0], 1)} ms (opens the session)`)
      const after = times.slice(1)
      if (after.length > 0) {
        const mean = after.reduce((sum, t) => sum + t, 0) / after.length
        out(`${after.length} more frames, ${fixed(mean, 1)} ms per frame (grab and fingerprint)`)
      }
      img = last as Rgba
    }
  } finally {
    capture.close()
  }
  savePng(target, img)
  out(`${img.w}x${img.h} saved to ${target}`)
  return 0
}

/** The text of a title as a pattern that matches it as it stands. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** `bench`: Chromatics and loot per run for the strategy alone and following
 * the advice, on the same seeds; see `warden::solver::bench`. With
 * `--strategy-only`, the strategy alone; see `runStrategyBench`. */
async function runBench(args: string[]): Promise<number> {
  const threads = availableParallelism()
  let games: number | null = null
  let rollouts = 400
  let seed = 1
  let threadCount = threads
  let strategyOnly = false
  let changed: Params | null = null
  let rerolls = 0
  let held: Tool[] = []
  let save: string | null = null
  let against: string | null = null
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--games':
        games = number('--games', args[++i])
        break
      case '--rollouts':
        rollouts = number('--rollouts', args[++i])
        break
      case '--seed':
        seed = number('--seed', args[++i])
        break
      case '--threads':
        threadCount = number('--threads', args[++i])
        break
      case '--strategy-only':
        strategyOnly = true
        break
      case '--set':
        if (changed === null) changed = cloneParams(TUNED)
        setWeights(changed, args[++i])
        break
      case '--hold':
        held = tools(args[++i])
        break
      case '--rerolls':
        rerolls = number('--rerolls', args[++i])
        break
      case '--save':
        save = args[++i] ?? null
        if (save === null) throw new Error(`--save needs a file; ${USAGE}`)
        break
      case '--against':
        against = args[++i] ?? null
        if (against === null) throw new Error(`--against needs a file; ${USAGE}`)
        break
      default:
        throw new Error(`unexpected argument ${arg}; ${USAGE}`)
    }
  }
  if (!strategyOnly && (changed !== null || held.length > 0 || rerolls > 0 || save !== null || against !== null)) {
    throw new Error(`--set, --hold, --rerolls, --save and --against need --strategy-only; ${USAGE}`)
  }
  const gameCount = games ?? (strategyOnly ? 2000 : 100)
  if (gameCount === 0 || rollouts === 0 || threadCount === 0) {
    throw new Error(`--games, --rollouts and --threads must be at least 1; ${USAGE}`)
  }
  if (strategyOnly) {
    return runStrategyBench(gameCount, seed, threadCount, held, rerolls, changed, save, against)
  }
  const clock = performance.now()
  const s = summarize(await benchGames(gameCount, rollouts, seed, threadCount))
  const secs = (performance.now() - clock) / 1000
  out(
    `strategy  ${fixed(s.strategy[0], 3)} +- ${fixed(s.strategy[1], 3)} Chromatics, ${fixed(
      s.strategyLoot[0],
      3,
    )} +- ${fixed(s.strategyLoot[1], 3)} loot per run`,
  )
  out(
    `advice    ${fixed(s.advice[0], 3)} +- ${fixed(s.advice[1], 3)}, ${fixed(s.adviceLoot[0], 3)} +- ${fixed(
      s.adviceLoot[1],
      3,
    )}`,
  )
  out(`advice - strategy  ${signed(s.gain[0], 3)} +- ${fixed(s.gain[1], 3)} loot (paired)`)
  out(`advice overruled the strategy at ${s.overruled} of ${s.decisions} decisions with 2+ options`)
  out(`${gameCount} games, ${rollouts} playouts per option, seed ${seed}, ${threadCount} threads, ${fixed(secs, 1)} s`)
  return 0
}

/** The worker that plays a chunk of the bench's games. */
const WORKER = new URL('./warden-bench-worker.ts', import.meta.url)

/** The bench's games, played over `threads` workers, in game order: the Rust
 * spreads the games over OS threads and sorts them back by game index, so the
 * numbers do not depend on the thread count. Falls back to the games one by
 * one when workers are not allowed here. */
async function benchGames(games: number, rollouts: number, seed: number, threads: number): Promise<Game[]> {
  const job: BenchJob = { kind: 'play', seed, from: 0, to: games, rollouts, held: [], rerolls: 0, params: null }
  if (threads <= 1 || games <= 1) return bench(games, rollouts, seed, 1)
  try {
    return (await playChunks(job, games, threads)) as Game[]
  } catch {
    return bench(games, rollouts, seed, 1)
  }
}

/** The strategy's games alone, played over `threads` workers, in game order. */
async function strategyGames(
  games: number,
  seed: number,
  threads: number,
  held: Tool[],
  rerolls: number,
  p: Params,
): Promise<Solo[]> {
  const job: BenchJob = { kind: 'strategy', seed, from: 0, to: games, rollouts: 0, held, rerolls, params: p }
  if (threads <= 1 || games <= 1) return strategyBench(games, seed, 1, held, rerolls, p)
  try {
    return (await playChunks(job, games, threads)) as Solo[]
  } catch {
    return strategyBench(games, seed, 1, held, rerolls, p)
  }
}

/** The games of `job`, played by `threads` workers, in game order. */
async function playChunks(job: BenchJob, games: number, threads: number): Promise<unknown[]> {
  const workers = Math.min(threads, games)
  const size = Math.ceil(games / workers)
  const pool: Worker[] = []
  try {
    for (let i = 0; i < workers; i++) pool.push(new Worker(WORKER))
    const chunks = await Promise.all(
      pool.map((w, i) =>
        runChunk(w, { ...job, from: i * size, to: Math.min((i + 1) * size, games) }),
      ),
    )
    return chunks.flat()
  } finally {
    for (const w of pool) w.terminate()
  }
}

/** One chunk of the bench's games, played by a worker. */
function runChunk(worker: Worker, job: BenchJob): Promise<unknown[]> {
  const { promise, resolve, reject } = Promise.withResolvers<unknown[]>()
  worker.onmessage = (e: MessageEvent) => resolve(e.data as unknown[])
  worker.onerror = (e: unknown) => reject(e instanceof Error ? e : new Error('the bench worker failed'))
  worker.postMessage(job)
  return promise
}

/** `--set name=value,...`: changes strategy weights, by `Params` field name. */
function setWeights(p: Params, value: string | undefined): void {
  if (value === undefined) throw new Error(`--set needs name=value pairs; ${USAGE}`)
  for (const pair of value.split(',')) {
    if (pair.trim() === '') continue
    const at = pair.indexOf('=')
    if (at < 0) throw new Error(`--set ${pair}: expected name=value`)
    const name = pair.slice(0, at)
    const raw = pair.slice(at + 1)
    const x = parseRustFloat(raw.trim())
    if (x === null) throw new Error(`--set ${pair}: ${raw} is not a number`)
    if (!setWeight(p, name.trim(), x)) throw new Error(`--set ${pair}: no strategy weight ${name}`)
  }
}

/** Rust's `f64::from_str`: a decimal, an exponent, "inf" or "nan"; no hex and
 * no other spellings. Null when the text is not a number. */
function parseRustFloat(text: string): number | null {
  if (/^[+-]?(inf|infinity)$/i.test(text)) return text.startsWith('-') ? -Infinity : Infinity
  if (/^[+-]?nan$/i.test(text)) return NaN
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(text)) return null
  return Number(text)
}

/** `bench --strategy-only`: Chromatics, loot and moves per run for the
 * strategy on the tuned weights and, given `changed`, on those too, with the
 * paired difference by game. Every game starts holding `held` with `rerolls`
 * instrument rerolls (`start`). `save` writes the tuned Chromatics per game,
 * one per line, and `against` reads such a file from another build and
 * prints the paired difference to it. */
async function runStrategyBench(
  games: number,
  seed: number,
  threads: number,
  held: Tool[],
  rerolls: number,
  changed: Params | null,
  save: string | null,
  against: string | null,
): Promise<number> {
  let saved: number[] | null = null
  if (against !== null) {
    let text: string
    try {
      text = readFileSync(against, 'utf8')
    } catch (e) {
      throw new Error(`--against ${against}: ${e instanceof Error ? e.message : String(e)}`)
    }
    const runs: number[] = []
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue
      const n = /^\+?\d+$/.test(line.trim()) ? Number(line.trim()) : NaN
      if (!Number.isFinite(n) || !Number.isSafeInteger(n)) {
        throw new Error(`--against ${against}: ${line} is not a Chromatics count`)
      }
      runs.push(n)
    }
    if (runs.length !== games) {
      throw new Error(`--against ${against} has ${runs.length} games, this run ${games}`)
    }
    saved = runs
  }
  const clock = performance.now()
  const tuned = await strategyGames(games, seed, threads, held, rerolls, TUNED)
  const row = (name: string, runs: Solo[]): void => {
    const [mean, se] = meanSe(runs.map((r) => r.chromatics))
    const [loot, lootSe] = meanSe(runs.map((r) => r.loot))
    const perRun = (f: (r: Solo) => number): number =>
      runs.reduce((sum, r) => sum + f(r), 0) / Math.max(runs.length, 1)
    out(
      `${pad(name, 8, false)}  ${fixed(mean, 3)} +- ${fixed(se, 3)} Chromatics, ${fixed(
        loot,
        3,
      )} +- ${fixed(lootSe, 3)} loot per run; per run ${fixed(perRun((r) => r.stats.devours), 2)} Consumes, ${fixed(
        perRun((r) => r.stats.chains),
        2,
      )} chain bites, ${fixed(perRun((r) => r.stats.swaps), 2)} Replaces, ${fixed(
        perRun((r) => r.stats.opened),
        2,
      )} doors opened`,
    )
    const s = spread(runs.map((r) => r.chromatics))
    const [p10, p25, p50, p75, p90] = s.percentiles
    const done =
      (100 * runs.filter((r) => r.objective).length) / Math.max(runs.length, 1)
    out(
      `${pad('', 8, false)}  ${fixed(s.low, 2)}% runs with <= ${LOW} Chromatics; p10/p25/p50/p75/p90 ${p10}/${p25}/${p50}/${p75}/${p90}, max ${
        s.max
      }; objective done in ${fixed(done, 2)}%`,
    )
  }
  row('tuned', tuned)
  if (save !== null) {
    const text = tuned.map((r) => `${r.chromatics}\n`).join('')
    try {
      writeFileSync(save, text)
    } catch (e) {
      throw new Error(`--save ${save}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  if (saved !== null) {
    const gain = meanSe(tuned.map((t, k) => t.chromatics - saved![k]))
    out(`tuned - saved  ${signed(gain[0], 3)} +- ${fixed(gain[1], 3)} (paired)`)
  }
  if (changed !== null) {
    const runs = await strategyGames(games, seed, threads, held, rerolls, changed)
    row('changed', runs)
    const gain = meanSe(runs.map((c, k) => c.chromatics - tuned[k].chromatics))
    out(`changed - tuned  ${signed(gain[0], 3)} +- ${fixed(gain[1], 3)} (paired)`)
    const low = (r: Solo): number => (isLow(r.chromatics) ? 100.0 : 0.0)
    const fewer = meanSe(runs.map((c, k) => low(c) - low(tuned[k])))
    out(
      `changed - tuned  ${signed(fewer[0], 2)} +- ${fixed(fewer[1], 2)} points of runs with <= ${LOW} Chromatics (paired)`,
    )
    out(`changed weights: ${debugParams(changed)}`)
  }
  const holding = held.length === 0 ? '' : `, holding ${held.join(',')}`
  out(
    `${games} games, seed ${seed}, ${threads} threads${holding}, ${rerolls} rerolls, ${fixed(
      (performance.now() - clock) / 1000,
      1,
    )} s`,
  )
  return 0
}

/** `read <frame.png> [--tools id,id]`: the board model as JSON, and the
 * warnings to check on stderr. */
async function runRead(args: string[]): Promise<number> {
  let file: string | null = null
  let held: Tool[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--tools') {
      held = tools(args[++i])
      continue
    }
    if (file === null && !arg.startsWith('--')) {
      file = arg
      continue
    }
    throw new Error(`unexpected argument ${arg}; ${USAGE}`)
  }
  if (file === null) throw new Error(USAGE)
  const [model, warnings] = await readModel(file, held)
  for (const w of warnings) process.stderr.write(`${w.text}\n`)
  out(JSON.stringify(model.toJSON(), null, 2))
  return 0
}

/** `solve <board.json | frame.png> [--rollouts N] [--seed S] [--tools id,id]`:
 * the move to play and the moves worth comparing. */
async function runSolve(args: string[]): Promise<number> {
  let file: string | null = null
  let rollouts = 400
  let seed = 1
  let held: Tool[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    switch (arg) {
      case '--rollouts':
        rollouts = number('--rollouts', args[++i])
        break
      case '--seed':
        seed = number('--seed', args[++i])
        break
      case '--tools':
        held = tools(args[++i])
        break
      default:
        if (file === null && !arg.startsWith('--')) {
          file = arg
          break
        }
        throw new Error(`unexpected argument ${arg}; ${USAGE}`)
    }
  }
  if (file === null) throw new Error(USAGE)
  if (rollouts === 0) throw new Error(`--rollouts must be at least 1; ${USAGE}`)
  let model: Model
  if (isPng(file)) {
    const [read, warnings] = await readModel(file, held)
    for (const w of warnings) out(w.text)
    if (warnings.length > 0) out()
    model = read
  } else {
    let text: string
    try {
      text = readFileSync(file, 'utf8')
    } catch (e) {
      throw new Error(`cannot read ${file}: ${e instanceof Error ? e.message : String(e)}`)
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch (e) {
      throw new Error(`${file} is not JSON: ${e instanceof Error ? e.message : String(e)}`)
    }
    model = modelFromJson(parsed)
    if (held.length > 0) model.tools = held
  }
  const [st, problems] = buildState(model, seed)
  if (problems.length > 0) {
    for (const p of problems) out(p)
    return 2
  }
  const pick = instant(st)
  if (pick !== null) out(`Pick: ${pick.label}\n  ${pick.why}`)
  else out('No move: the run is over.')
  const options = solve(st, rollouts, seed, TUNED)
  if (options.length === 0) return 0
  const width = Math.max(
    ...options.map((o) => [...o.label].length),
    6,
  )
  out(
    `\n${pad('rank', 4, true)}  ${pad('option', width, false)}  ${pad('mean', 6, true)}  ${pad(
      'gap',
      6,
      true,
    )}  ${pad('best', 5, true)}  ${pad('n', 5, true)}`,
  )
  options.forEach((o, i) => {
    const gap = i === 0 ? '-' : Number.isFinite(o.gapSe) ? fixed(o.gapSe, 3) : 'inf'
    const mark = o.policy ? ' *' : ''
    out(
      `${pad(String(i + 1), 4, true)}  ${pad(o.label, width, false)}  ${pad(fixed(o.mean, 3), 6, true)}  ${pad(
        gap,
        6,
        true,
      )}  ${pad(fixed(o.best, 2), 5, true)}  ${pad(String(o.n), 5, true)}${mark}`,
    )
  })
  out(
    `\nUp to ${rollouts} playouts per option, n of them played: a move that clearly trails stops early; gap is the paired standard error of the margin to the leader; * is the strategy's pick.`,
  )
  return 0
}

/** The cores the run may use, as Rust's `available_parallelism` counts them. */
function availableParallelism(): number {
  const n = navigator.hardwareConcurrency
  return typeof n === 'number' && n > 0 ? n : 1
}

async function main(): Promise<number> {
  const args = process.argv.slice(2)
  const cmd = args[0]
  if (cmd === '--version' && args.length === 1) {
    out(`warden ${version()}`)
    return 0
  }
  switch (cmd) {
    case 'solve':
      return runSolve(args.slice(1))
    case 'read':
      return runRead(args.slice(1))
    case 'bench':
      return runBench(args.slice(1))
    case 'capture':
      return runCapture(args.slice(1))
    default:
      process.stderr.write(`${USAGE}\n`)
      return 1
  }
}

main()
  .then((code) => {
    process.exit(code)
  })
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  })
