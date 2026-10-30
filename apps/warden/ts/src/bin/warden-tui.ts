#!/usr/bin/env bun
//! Warden in a terminal, for Linux under Niri: captures the game window (niri
//! screenshot-window), reads the board when the screen changes and shows the
//! move it recommends. Never clicks or types in the game.
//!
//!   warden-tui [--title TEXT] [--rollouts N]
//!   warden-tui --image <frame.png> [--rollouts N]    read one screenshot, print, exit
//!
//! Keys: r read now, q quit.
//!
//! A port of src/bin/warden-tui.rs. The window is taken with `@tli/capture`,
//! which holds the Rust `app/niri.rs` logic.

import { createCapture } from '@tli/capture'
import { asBytes } from '@tli/png'
import { Session, Watch, fingerprint } from '@/app/session'
import type { CellModel, EventMark, Model } from '@/board/board'
import type { Action } from '@/engine/actions'
import { beastIndex, data, type Beast } from '@/engine/data'
import { cellLabel, tierName } from '@/engine/text'
import { fixed } from '@/format'
import { problem } from '@/reader/ocr'
import { Rgba, loadPng } from '@/reader/mod'
import { alsoGood } from '@/solver/advise'

/** How often the game is looked at, in milliseconds (4 a second). */
const SAMPLE = 250
const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const GREEN = '\x1b[32m'
const YELLOW = '\x1b[33m'
const RED = '\x1b[31m'
const REVERSE = '\x1b[7m'
const RESET = '\x1b[0m'

interface Args {
  title: string
  rollouts: number
  image: string | null
}

function args(): Args {
  const a: Args = { title: 'Torchlight', rollouts: 1600, image: null }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    switch (arg) {
      case '--title': {
        const value = argv[++i]
        if (value === undefined) throw new Error('--title needs a text')
        a.title = value
        break
      }
      case '--rollouts': {
        const raw = argv[++i]
        const n = raw !== undefined && /^\+?\d+$/.test(raw) ? Number(raw) : NaN
        if (!Number.isFinite(n) || n <= 0) throw new Error('--rollouts needs a number above 0')
        a.rollouts = n
        break
      }
      case '--image': {
        const value = argv[++i]
        if (value === undefined) throw new Error('--image needs a file')
        a.image = value
        break
      }
      default:
        throw new Error(
          `unexpected argument ${arg}; usage: warden-tui [--title TEXT] [--rollouts N] | warden-tui --image <frame.png>`,
        )
    }
  }
  return a
}

/** The terminal in cbreak mode on the alternate screen, put back on leave. */
class Terminal {
  private constructor(private readonly saved: string) {}

  /** The terminal in cbreak mode on the alternate screen; null when there is
   * no terminal to set (the keys are then not read). */
  static enter(): Terminal | null {
    const saved = stty(['-g'])
    if (saved === null) return null
    if (stty(['-icanon', '-echo', '-isig']) === null) return null
    process.stdout.write('\x1b[?1049h\x1b[?25l')
    return new Terminal(saved.trim())
  }

  /** The terminal as it was, and the screen as it was. */
  leave(): void {
    process.stdout.write('\x1b[?25h\x1b[?1049l')
    stty([this.saved])
  }
}

/** `stty` with the given arguments; its output, or null when it failed. */
function stty(args: string[]): string | null {
  const p = Bun.spawnSync(['stty', ...args], { stdin: 'inherit', stdout: 'pipe', stderr: 'ignore' })
  if (p.exitCode !== 0) return null
  return p.stdout.toString()
}

/** The keys pressed, in the order they came. */
function keys(): number[] {
  const pressed: number[] = []
  process.stdin.on('data', (chunk: Buffer | string) => {
    const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
    for (const b of bytes) pressed.push(b)
  })
  process.stdin.resume()
  return pressed
}

/** The game window's picture, as the reader takes it. */
function asRgba(img: { width: number; height: number; data: Uint8ClampedArray }): Rgba {
  const bytes = asBytes(img)
  return new Rgba(bytes.width, bytes.height, bytes.data)
}

/** The text of a title as a pattern that matches it as it stands. */
function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function run(): Promise<void> {
  const a = args()
  const session = new Session(a.rollouts, [], null, null)
  if (a.image !== null) {
    const frame = loadPng(a.image)
    session.readInBackground(frame)
    await session.wait()
    for (const line of screen(session, null, `screenshot ${a.image}`)) process.stdout.write(`${line}\n`)
    return
  }
  const term = Terminal.enter()
  const pressed = term !== null ? keys() : null
  try {
    await live(session, a, pressed)
  } finally {
    term?.leave()
  }
}

async function live(session: Session, a: Args, pressed: number[] | null): Promise<void> {
  const watch = new Watch()
  const capture = createCapture({ title: new RegExp(escapeRegExp(a.title), 'i') })
  let next = performance.now()
  try {
    for (;;) {
      let now = false
      while (pressed !== null && pressed.length > 0) {
        const k = pressed.shift() as number
        if (k === 0x71 || k === 3) return
        if (k === 0x72) now = true
      }
      let captureNote: string
      try {
        const frame = asRgba(await capture.grab())
        captureNote = `${frame.w} x ${frame.h}`
        const print = fingerprint(frame)
        if (now) {
          watch.markRead(print)
          session.readLive(frame)
        } else if (watch.sample(print)) {
          session.readLive(frame)
        }
      } catch (e) {
        captureNote = e instanceof Error ? e.message : String(e)
      }
      session.poll()
      if (session.wantsReread()) watch.readNext()
      let out = '\x1b[H'
      for (const line of screen(session, problem(), captureNote)) out += `${line}\x1b[K\n`
      out += '\x1b[J'
      process.stdout.write(out)
      next += SAMPLE
      const wait = next - performance.now()
      if (wait > 0) await sleep(wait)
      else next = performance.now()
    }
  } finally {
    capture.close()
  }
}

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** Column and row of model cell `n` on the screen's 6x4 ring, clockwise from
 * the Interrogation Room at the top left. */
function ring(n: number): [number, number] {
  if (n <= 5) return [n, 0]
  if (n === 6 || n === 7) return [5, n - 5]
  if (n <= 13) return [13 - n, 3]
  return [0, 16 - n]
}

function moveName(action: Action, label: string): string {
  const short = label.split(' (')[0]
  switch (action.type) {
    case 'devour':
      return `Consume ${cellLabel(action.to)}`
    case 'swap':
      return 'Replace'
    default:
      return short
  }
}

function actionCell(action: Action, warden: number): number | null {
  switch (action.type) {
    case 'patrol':
      return action.cell
    case 'devour':
      return action.to
    case 'chain':
      return action.to
    case 'choose':
      return typeof action.id === 'number' ? action.id : null
    case 'swap':
      return warden >= 0 ? warden : null
    default:
      return null
  }
}

/** What a cell holds in a few letters: "Rar Wolf", "locked", "empty". */
function shortCell(cell: CellModel): string {
  const d = data()
  const beast = (b: Beast): string => {
    const words = d.beastNames[beastIndex(b)].split(/\s+/)
    return words[words.length - 1] ?? ''
  }
  const tier = (t: number): string => [...tierName(t)].slice(0, 3).join('')
  const mark = (e: EventMark | null): string => (e !== null ? '!' : '')
  switch (cell.kind) {
    case 'office':
      return 'Room'
    case 'sealed':
      return `locked${mark(cell.event)}`
    case 'empty':
      return `empty${mark(cell.event)}`
    case 'inmate':
      return `${tier(cell.tier)} ${beast(cell.beast)}${mark(cell.event)}`
    case 'nest':
      return cell.due !== null ? `nest ${cell.due}d` : 'nest 1d'
    case 'scouted':
      return `(${tier(cell.tier)} ${beast(cell.beast)}${mark(cell.event)}`
    case 'scratch':
      return `lock ${tier(cell.tier)}${mark(cell.event)}`
  }
}

/** The ring of cells, two lines each: the cell's number with its marks, and
 * what it holds. */
function ringLines(m: Model, pick: number | null, near: number[], warned: number[]): string[] {
  const W = 12
  const grid: { top: string; body: string; colour: string }[][] = Array.from({ length: 4 }, () =>
    Array.from({ length: 6 }, () => ({ top: '', body: '', colour: '' })),
  )
  m.cells.slice(0, 16).forEach((cell, n) => {
    const [col, row] = ring(n)
    let top = ''
    if (m.warden === n) top += '@'
    top += cellLabel(n)
    if (near.includes(n)) top += '~'
    if (warned.includes(n)) top += '?'
    const colour = pick === n ? REVERSE : m.warden === n ? YELLOW : ''
    grid[row][col] = { top, body: shortCell(cell), colour }
  })
  const out: string[] = []
  for (let row = 0; row < 4; row++) {
    for (let part = 0; part < 2; part++) {
      let line = ''
      for (let col = 0; col < 6; col++) {
        const { top, body, colour } = grid[row][col]
        const text = part === 0 ? top : body
        const chars = [...text]
        const cell = chars.length >= W ? chars.slice(0, W).join('') : text.padEnd(W)
        line += `${colour}${cell}${colour === '' ? '' : RESET} `
      }
      out.push(line)
    }
    out.push('')
  }
  return out
}

/** Everything on the screen, a line each. */
function screen(s: Session, ocrProblem: string | null, captureNote: string): string[] {
  const l: string[] = [
    `${BOLD}Warden${RESET} ${DIM}Tartarus prison board, Linux terminal${RESET}`,
    `${DIM}game:${RESET} ${captureNote}`,
    '',
  ]
  if (s.runOver !== null) {
    l.push(`${BOLD}${s.runOver}${RESET}`)
    return footer(l)
  }
  const reading = s.reading
  if (reading === null) {
    if (s.scanning()) {
      l.push('Reading the board…')
    } else {
      l.push('No board read yet.')
      if (ocrProblem !== null) l.push(`${YELLOW}${ocrProblem}${RESET}`)
      if (s.missed !== null) l.push(`${DIM}${s.missed}${RESET}`)
    }
    return footer(l)
  }
  for (const p of s.problems) l.push(`${RED}${p}${RESET}`)
  for (const w of reading.warnings) {
    if (w.cell === null && w.kind !== 'note') l.push(`${YELLOW}${w.text}${RESET}`)
  }
  const advice = s.advice()
  const m = reading.model
  const pick = advice !== null ? actionCell(advice.action, m.warden) : null
  const near: number[] =
    advice === null
      ? []
      : alsoGood(s.ranking, advice.option)
          .map((k) => actionCell(s.ranking[k].action, m.warden))
          .filter((c): c is number => c !== null && c !== pick)
  const warned: number[] = reading.warnings.flatMap((w) => (w.cell !== null ? [w.cell] : []))

  let day =
    reading.daysLeft !== null
      ? `Day ${m.day} · ${reading.daysLeft} to Riot`
      : `Day ${m.day} · Riot not read`
  if (reading.keptLines().length > 0) day += ' · last reading'
  if (m.objective !== null) {
    const o = data().objective(m.objective.id)
    if (o !== null) {
      const name = o.name.replace(/^(Objective: )+/, '')
      const progress =
        m.objective.progress >= o.target ? 'done' : `${m.objective.progress}/${o.target}`
      day += ` · ${name} ${progress}`
    }
  }
  l.push(day)
  for (const line of reading.keptLines()) l.push(`${YELLOW}${line}${RESET}`)
  l.push('')
  if (advice !== null) {
    const playing = s.solving ? `  ${DIM}(playing it out: ${s.rounds} of ${s.rollouts} playouts)${RESET}` : ''
    l.push(`${DIM}NEXT MOVE${RESET}${playing}`)
    l.push(`  ${BOLD}${GREEN}${moveName(advice.action, advice.label)}${RESET}`)
    l.push(`  ${DIM}${s.whyShown(advice)}${RESET}`)
  } else if (s.solving) {
    l.push(`${DIM}Solving…${RESET}`)
  }
  l.push('')
  l.push(...ringLines(m, pick, near, warned))
  for (const w of reading.warnings) {
    if (w.cell !== null) l.push(`${YELLOW}? ${w.text}${RESET}`)
  }
  const advised = advice !== null ? advice.option : null
  if (s.ranking.length > 0) {
    l.push(`${DIM}Moves by Riot loot per run (Chromatic 1, Ultimate 0.2, Legendary 0.05)${RESET}`)
    const shown: number[] = []
    for (let k = 0; k < Math.min(s.ranking.length, 5); k++) shown.push(k)
    if (advised !== null && advised >= 5) shown[4] = advised
    for (const k of shown) {
      const o = s.ranking[k]
      const chosen = advised === k
      const mean = fixed(o.mean, 2).padStart(5)
      l.push(`  ${chosen ? GREEN : ''}${String(k + 1).padStart(2)}  ${mean}  ${moveName(o.action, o.label)}${RESET}`)
    }
  }
  for (const w of reading.warnings) {
    if (w.kind === 'note') l.push(`${DIM}${w.text}${RESET}`)
  }
  return footer(l)
}

function footer(l: string[]): string[] {
  l.push('')
  l.push(
    `${DIM}r read now · q quit · @ warden · [highlight] advised cell · ~ nearly as good · ? check this cell${RESET}`,
  )
  return l
}

run()
  .then(() => {
    process.exit(0)
  })
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  })
