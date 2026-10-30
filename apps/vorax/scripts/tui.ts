// Vorax Helper in a terminal, for Linux (built for Niri on Wayland). Follows the game's log, takes a picture of the
// game window after every move, reads the board and shows the best move. It only reads and advises: it never clicks
// or types in the game.
//
//   bun scripts/tui.ts                      follow the running game
//   bun scripts/tui.ts --image=shot.png     read one screenshot, print the advice, exit
//
// Options: --log=<UE_game.log>  --game-title=<regex>  --target=<score>  --no-deep
//          --capture-cmd='<command writing a PNG of the game to {out}>'   (any compositor but Niri)
import { readFileSync } from 'node:fs'
import { CHECK_MS, createLiveLoop, POLL_MS, type LiveEvent } from '@/reader/live/liveLoop'
import { createFollower } from '@/reader/live/logFollower'
import { waitStable } from '@/reader/live/stable'
import { createWatch, watchThumb } from '@/reader/live/watch'
import type { Img } from '@/reader/scan/pixels'
import { newTracker, trackInstruments } from '@/reader/track'
import type { Reading } from '@/reader/types'
import { instrumentAdvice, quick, type HelperInput } from '@/web/helper'
import { decodePngClamped } from '@tli/png'
import { tesseractFound } from '@tli/ocr'
import { createCapture, type Capture } from '@tli/capture'
import { findLog } from '@tli/gamelog'
import { createAdvisor } from './tui/advice'
import { fileHandle } from './tui/log'
import { readWithTesseract } from './tui/ocr'
import { createReader } from './tui/read'
import { render, TARGETS, type Board, type View } from './tui/render'

const arg = (name: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null
const flag = (name: string) => process.argv.includes(`--${name}`)

if (!tesseractFound()) {
  console.error('tesseract is needed to read the cards\' names (Arch: pacman -S tesseract tesseract-data-eng).')
  process.exit(1)
}

// the base stats of a rarity: tank numbers too unclear to read start there rather than at a meaningless 1 x 1
const BASE: Record<string, [number, number]> = { normal: [1, 36], magic: [5, 24], rare: [15, 12], boss: [300, 1] }

const reader = createReader(readWithTesseract)
const advisor = createAdvisor()
let tracker = newTracker()
let lastSig = ''
let target = Number(arg('target')) || 925_000
let deepOn = !flag('no-deep')
let gen = 0

const view: View = {
  capture: 'looking for the game window', log: 'looking for the game log', logLines: 0, pictures: 0, status: '', target,
  deepOn, board: null, quick: null, ahead: null, aheadPending: false, table: null, deep: null,
}

let redraw = () => {}

/* ---------- a reading becomes a board ---------- */

const unclear = (raw: Reading) => {
  let present = 0, shaky = 0
  raw.state.tanks.forEach((t, i) => { if (!t) return; present++; if (raw.fields[`tank${i}.activity`] && !raw.fields[`tank${i}.activity`].sure) shaky++ })
  return !!lastSig && shaky >= 2 && shaky * 2 >= present
}

const handHidden = (raw: Reading) => {
  if (raw.fields.phase?.sure) return false
  const hand = raw.state.hand ?? []
  return !hand.length || hand.some(n => !n) || raw.problems.some(p => p.kind === 'unknownArt')
}

/** 'new': a new board, advised; 'same': the board we had; 'kept': not a usable picture, the last board stands. */
function applyReading(raw: Reading, trigger: string): 'new' | 'same' | 'kept' {
  const st = raw.state
  if (raw.problems.some(p => p.kind === 'animating')) { view.status = 'a card is moving: waiting'; return 'kept' }
  if (raw.problems.some(p => p.kind === 'notFound')) { view.status = 'Waiting for the Surgical Preparation screen (this picture is another screen of the game)'; return 'kept' }
  if (st.phase === 'protocol' && st.round && st.round <= 10 && raw.fields.round?.sure) return 'kept'
  if (unclear(raw)) { view.status = 'unclear picture: the last board stands'; return 'kept' }
  if (handHidden(raw)) { view.status = 'a raised card covers the hand: move the pointer off the cards'; return 'kept' }

  const t = trackInstruments(tracker, raw, trigger)
  tracker = t.tracker
  const sig = JSON.stringify([st.round, st.phase, st.hand, st.tanks, st.potionRefreshes, st.instrumentRefreshes, t.instruments])
  if (sig === lastSig) return 'same'
  lastSig = sig
  view.status = ''

  const fields = { ...Object.fromEntries(Object.entries(raw.fields).filter(([k]) => !k.startsWith('instrument'))), ...t.fields }
  const tanks = st.tanks.map((m, i) => {
    if (!m) return null
    const a = fields[`tank${i}.activity`], q = fields[`tank${i}.quantity`], b = BASE[m.rarity]
    const guess = a && q && !a.sure && !q.sure && b && (m.activity * m.quantity < b[0] * b[1] || m.activity > 3000 || m.quantity > 5000)
    return guess ? { ...m, activity: b[0], quantity: b[1] } : { ...m }
  })
  // a starting item (Limb-Stitching Specimen, the teal ewer) shapes the starting tanks only: never one of the three picks
  const picks: string[] = [], rounds: number[] = []
  t.instruments.forEach((n, i) => { if (n && !/starting item|limb-stitching/i.test(n)) { picks.push(n); rounds.push(t.rounds[i] || 0) } })

  const potion = st.phase === 'potion'
  const n = potion ? (st.hand.length >= 4 || raw.handSize === 5 ? 5 : 3) : raw.handSize === 1 || st.hand.length === 1 ? 1 : 3
  const x: HelperInput = {
    tanks, hand: st.phase === 'protocol' ? [] : st.hand.slice(0, n).filter(Boolean), instruments: picks, instrumentRounds: rounds,
    phase: st.phase === 'protocol' ? 'potion' : st.phase, round: st.round,
    potionRefreshes: Math.min(3, st.potionRefreshes ?? 3), instrumentRefreshes: Math.min(2, st.instrumentRefreshes ?? 2),
    fromBox: potion && n === 5,
  }

  const warnings: string[] = []
  for (const [k, f] of Object.entries(fields)) {
    if (k === 'ultimate' ? /^mismatch/.test(f.note ?? '') : f.sure === false) warnings.push(`check ${k}${f.guess ? ` (read as ${f.guess})` : ''}`)
  }
  const fixed = /^fixed tank(\d)/.exec(fields.ultimate?.note ?? '')
  if (fixed) warnings.push(`tank ${+fixed[1] + 1} was misread; worked out from Ultimate Activity (${fields.ultimate.guess})`)
  const unknown = raw.problems.filter(p => p.kind === 'unknownArt' || p.kind === 'unknownName').length
  if (unknown) warnings.push(`${unknown} card${unknown > 1 ? 's' : ''} not recognised`)
  if (t.ask) warnings.push('check which instrument you picked last')

  const board: Board = { x, round: st.round ?? 1, phase: st.phase, warnings }
  view.board = board
  advise(board)
  return 'new'
}

/* ---------- advice: instant, then the look-ahead, then the deep check ---------- */

function advise(board: Board) {
  const mine = ++gen
  advisor.cancelDeep()
  view.quick = null; view.ahead = null; view.aheadPending = false; view.table = null; view.deep = null
  const x = board.x
  if (board.phase === 'protocol' || (board.phase === 'potion' && board.round > 10)) return
  const need = board.phase === 'potion' || x.hand.length === 1 ? 1 : 3
  if (x.hand.length < need) { board.warnings.push('waiting for the cards'); return }
  if (board.phase === 'instrument') {
    if (x.instruments.length >= 3) return
    if (new Set(x.hand).size < x.hand.length) { board.warnings.push('the offered instruments are not all different: check them'); return }
    view.table = instrumentAdvice(x)
  } else {
    view.quick = quick(x)
    if (view.quick.unknown.length) return
    if (view.quick.note) return
  }
  view.aheadPending = true
  redraw()
  advisor.ahead(x).then(a => {
    if (mine !== gen || !a) return
    view.ahead = a; view.aheadPending = false
    redraw()
    if (board.phase === 'potion' && deepOn) startDeep(board, mine)
  }).catch(err => { if (mine === gen) { view.aheadPending = false; view.status = `look-ahead failed: ${err}`; redraw() } })
}

function startDeep(board: Board, mine = gen) {
  advisor.cancelDeep()
  view.deep = { rows: [], done: 0, total: 60, finished: false }
  advisor.deep(board.x, target, {
    rows: (rows, done, total) => { if (mine === gen) { view.deep = { rows, done, total, finished: false }; redraw() } },
    done: rows => { if (mine === gen) { view.deep = { rows, done: 60, total: 60, finished: true }; redraw() } },
    error: message => { if (mine === gen) { view.deep = { rows: [], done: 0, total: 0, finished: true, error: message }; redraw() } },
  })
}

/* ---------- one picture ---------- */

async function readPicture(img: Img, trigger: string): Promise<'new' | 'same' | 'kept'> {
  view.pictures++
  const raw = await reader.read(img as never, trigger, unclear)
  return applyReading(raw, trigger)
}

/* ---------- one screenshot, for testing and bug reports ---------- */

const image = arg('image')
if (image) {
  const result = await readPicture(decodePngClamped(readFileSync(image)), 'manual')
  view.capture = image; view.log = '-'
  if (view.board && (view.aheadPending || view.deep)) {
    // wait for the look-ahead and the deep check to finish
    for (let i = 0; i < 600 && (view.aheadPending || (view.deep && !view.deep.finished)); i++) await Bun.sleep(100)
  }
  console.log(render(view, 100).join('\n'))
  if (result === 'kept') process.exitCode = 2
  advisor.close()
  process.exit()
}

/* ---------- the live loop ---------- */

const cap: Capture = createCapture({ title: new RegExp(arg('game-title') || '^Torchlight: Infinite\\s*$'), command: arg('capture-cmd') ?? undefined })
const watch = createWatch()
let snapping = false, pending: string | null = null, rebase = true, watchBusy = false, firstLook = true

async function snap(kind: string) {
  if (snapping) { pending = kind; return }
  snapping = true
  try {
    // a watched change has already held still; a log trigger waits for the cards to land
    const img = kind === 'manual' || kind === 'watch' ? await cap.grab() : await waitStable(() => cap.grab() as never) as unknown as Img
    const r = await readPicture(img, kind)
    if (kind === 'watch') { if (r === 'new') watch.settle(); else if (r === 'same') watch.falseAlarm() }
  } catch (err) {
    view.status = err instanceof Error ? err.message : String(err)
  } finally {
    view.capture = cap.status()
    snapping = false; rebase = true
    redraw()
    if (pending) { const k = pending; pending = null; void snap(k) }
  }
}

// the screen watch: a picture after every move, from the screen itself (works with the game's log detail off too)
async function look() {
  if (watchBusy || snapping) return
  watchBusy = true
  try {
    if (firstLook) { firstLook = false; void snap('watch'); return }
    const t = watchThumb(await cap.grab())
    if (rebase) { watch.setBase(t); rebase = false; return }
    if (watch.feed(t, Date.now())) void snap('watch')
  } catch (err) {
    view.capture = err instanceof Error ? err.message : String(err)
    firstLook = true
    redraw()
  } finally { watchBusy = false }
}

/** The log follower's loop: polled every POLL_MS, checked every CHECK_MS. */
interface Loop { poll(): Promise<void>; check(): void }
let loop: Loop | null = null
function connectLog() {
  const found = findLog(arg('log') ?? undefined)
  if (!found) { view.log = 'Torchlight: Infinite is not in a Steam library (use --log=<UE_game.log>)'; return }
  if (!found.exists) { view.log = `${found.file} (not written yet: start the game, Esc → Account Related → Enable Log)`; return }
  view.log = found.file
  loop = createLiveLoop({
    follower: createFollower(fileHandle(found.file)), now: () => Date.now(),
    post: (e: LiveEvent) => {
      if (e.type === 'status') { view.logLines = e.lines; if (e.lines > 400 && !e.detailSeen) view.status = 'the game log has no detail lines: turn on Esc → Account Related → Enable Log (the screen is watched meanwhile)' }
      else if (e.type === 'snap') void snap(e.kind)
    },
  })
}

connectLog()
let polling = false
setInterval(async () => {
  if (!loop) return
  if (polling) return
  polling = true
  try { await loop.poll() } finally { polling = false }
}, POLL_MS)
setInterval(() => loop?.check(), CHECK_MS)
setInterval(() => { if (!loop) connectLog() }, 5000)
setInterval(look, 450)

/* ---------- the terminal ---------- */

const out = process.stdout
redraw = () => {
  view.target = target; view.deepOn = deepOn
  const lines = render(view, out.columns || 100).map(l => l + '\x1b[K')
  out.write('\x1b[H' + lines.join('\n') + '\n\x1b[J')
}
function quit() {
  out.write('\x1b[?25h\x1b[?1049l')
  advisor.close(); cap.close()
  process.exit()
}

out.write('\x1b[?1049h\x1b[?25l')
process.on('SIGINT', quit)
process.on('SIGTERM', quit)
out.on('resize', redraw)
setInterval(redraw, 1000)
if (process.stdin.isTTY) {
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.on('data', d => {
    for (const k of d.toString()) {
      if (k === 'q' || k === '\x03') quit()
      else if (k === 'r') void snap('manual')
      else if (k === 't') {
        target = TARGETS[(TARGETS.indexOf(target) + 1) % TARGETS.length]
        if (view.board && view.ahead && deepOn && view.board.phase === 'potion') startDeep(view.board)
      } else if (k === 'd') {
        deepOn = !deepOn
        if (!deepOn) { advisor.cancelDeep(); view.deep = null }
        else if (view.board && view.ahead && view.board.phase === 'potion') startDeep(view.board)
      }
    }
    redraw()
  })
}
redraw()
