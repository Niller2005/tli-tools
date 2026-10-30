#!/usr/bin/env bun
// The TLI tools dashboard: pick the tools to run, press Enter. Plain ANSI, no dependencies.
import { launch } from './launch'
import { missing, TOOLS } from './tools'
import { logHint, watchMinigames, type GameName, type MinigameState, type MinigameView, type Watcher } from '@tli/gamelog'

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', amber: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', inv: '\x1b[7m' }
const picked = new Set<string>()
let cursor = 0
let message = ''

/** The game's log, watched while the dashboard is up: it says which minigame is on screen. */
let watcher: Watcher | null = null
/** The badges' refresh, once a second. */
let tick: ReturnType<typeof setInterval> | undefined
/** The badges as they were last drawn, so the screen is only redrawn when they change. */
let shown = ''

/** How a minigame's state is shown. */
const BADGE: Record<MinigameState, [string, string]> = {
  open: ['● open', C.green],
  closed: ['○ closed', C.dim],
  unknown: ['? unknown', C.dim],
}

/** The state of a minigame, as the badge shows it. */
function badge(game: GameName, view: MinigameView): string {
  const [text, colour] = BADGE[view[game]]
  const hint = logHint(view.log)
  return `  ${colour}${text}${C.reset}${hint === null ? '' : `  ${C.dim}${hint}${C.reset}`}`
}

/** The badges as they are now, so the screen is only redrawn when they change. */
function signature(view: MinigameView | null): string {
  if (view === null) return ''
  return TOOLS.map(t => (t.game === undefined ? '' : badge(t.game, view))).join('|')
}

function draw() {
  const view = watcher === null ? null : watcher.state()
  shown = signature(view)
  const out = ['\x1b[H\x1b[2J', `${C.bold}Torchlight: Infinite tools${C.reset}\n\n`]
  TOOLS.forEach((t, i) => {
    const gone = missing(t)
    const box = picked.has(t.id) ? `${C.green}[x]${C.reset}` : '[ ]'
    const mark = t.game === undefined || view === null ? '' : badge(t.game, view)
    const line = `${box} ${C.bold}${t.name}${C.reset}${gone.length ? `  ${C.red}needs ${gone.join(', ')}${C.reset}` : ''}${mark}`
    out.push(`${i === cursor ? `${C.cyan}>${C.reset}` : ' '} ${line}\n`)
    if (i === cursor) out.push(`      ${C.dim}${t.description}${C.reset}\n`)
  })
  out.push(`\n${C.dim}↑/↓ move   space select   a all   enter run   q quit${C.reset}\n`)
  if (message) out.push(`\n${C.amber}${message}${C.reset}\n`)
  process.stdout.write(out.join(''))
}

const setRaw = (on: boolean) => {
  process.stdin.setRawMode(on)
  if (on) process.stdin.resume()
  else process.stdin.pause()
}

/** Watches the game's log while the dashboard is up. */
function watch(): void {
  watcher = watchMinigames()
  tick = setInterval(() => {
    const view = watcher === null ? null : watcher.state()
    if (signature(view) !== shown) draw()
  }, 1000)
}

/** Stops watching the log: a tool has the terminal now. */
function unwatch(): void {
  watcher?.close()
  watcher = null
  clearInterval(tick)
  tick = undefined
}

function quit(code = 0): never {
  unwatch()
  setRaw(false)
  process.stdout.write('\x1b[?25h\x1b[?1049l')
  process.exit(code)
}

async function run() {
  const chosen = TOOLS.filter(t => picked.has(t.id))
  if (chosen.length === 0) chosen.push(TOOLS[cursor])
  const gone = chosen.flatMap(t => missing(t).map(n => `${t.name} needs ${n}`))
  if (gone.length) { message = gone.join('; '); return draw() }
  setRaw(false)
  unwatch()
  process.stdout.write('\x1b[?25h\x1b[?1049l')
  try {
    await launch(chosen)
    message = ''
  } catch (e) {
    message = (e as Error).message
  }
  process.stdout.write('\x1b[?1049h\x1b[?25l')
  setRaw(true)
  watch()
  draw()
}

if (!process.stdin.isTTY) {
  console.error('The dashboard needs a terminal.')
  process.exit(1)
}
process.stdout.write('\x1b[?1049h\x1b[?25l')
setRaw(true)
process.stdin.on('data', d => {
  const k = d.toString()
  if (k === 'q' || k === '\x03') quit()
  else if (k === '\x1b[A' || k === 'k') cursor = (cursor + TOOLS.length - 1) % TOOLS.length
  else if (k === '\x1b[B' || k === 'j') cursor = (cursor + 1) % TOOLS.length
  else if (k === ' ') { const id = TOOLS[cursor].id; picked.has(id) ? picked.delete(id) : picked.add(id) }
  else if (k === 'a') TOOLS.forEach(t => picked.add(t.id))
  else if (k === '\r') return void run()
  message = ''
  draw()
})
watch()
draw()
