#!/usr/bin/env bun
// The TLI tools dashboard: pick the tools to run, press Enter. Plain ANSI, no dependencies.
import { launch } from './launch'
import { missing, TOOLS } from './tools'

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', green: '\x1b[32m', amber: '\x1b[33m', red: '\x1b[31m', cyan: '\x1b[36m', inv: '\x1b[7m' }
const picked = new Set<string>()
let cursor = 0
let message = ''

function draw() {
  const out = ['\x1b[H\x1b[2J', `${C.bold}Torchlight: Infinite tools${C.reset}\n\n`]
  TOOLS.forEach((t, i) => {
    const gone = missing(t)
    const box = picked.has(t.id) ? `${C.green}[x]${C.reset}` : '[ ]'
    const line = `${box} ${C.bold}${t.name}${C.reset}${gone.length ? `  ${C.red}needs ${gone.join(', ')}${C.reset}` : ''}`
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

function quit(code = 0): never {
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
  process.stdout.write('\x1b[?25h\x1b[?1049l')
  try {
    await launch(chosen)
    message = ''
  } catch (e) {
    message = (e as Error).message
  }
  process.stdout.write('\x1b[?1049h\x1b[?25l')
  setRaw(true)
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
draw()
