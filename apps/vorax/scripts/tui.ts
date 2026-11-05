#!/usr/bin/env bun
// Vorax Helper in a terminal, for Linux (built for Niri on Wayland). Follows the game's log, takes a picture of the
// game window after every move, reads the board and shows the best move. It only reads and advises: it never clicks
// or types in the game.
//
//   bun scripts/tui.ts                      follow the running game
//   bun scripts/tui.ts --image=shot.png     read one screenshot, print the advice, exit
//
// Options: --log=<UE_game.log>  --game-title=<regex>  --target=<score>  --no-deep  --no-log
//          --capture-cmd='<command writing a PNG of the game to {out}>'   (any compositor but Niri)
//          --niri-screenshot  (allow Niri's announced window screenshot)
//          --no-color
//
// Keys: r read now · t target (600k, 700k, 925k, 1.12M) · d deep check on/off · q quit.
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
import { findLog, minigameCaptureGate, retryCapture, watchMinigames, type MinigameView, type Watcher } from '@tli/gamelog'
import { startApp } from '@tli/tui'
import { publishCard } from '@tli/overlay'
import { startAutoLaunch } from '@tli/launch'
import { cardOf } from './tui/card'
import { VoraxApp } from './tui/app'
import { createAdvisor } from './tui/advice'
import { fileHandle } from './tui/log'
import { readWithTesseract } from './tui/ocr'
import { createReader } from './tui/read'
import { reportLines } from './tui/report'
import { freshView, type Board } from './tui/view'

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
const target = Number(arg('target')) || 925_000
const deepOn = !flag('no-deep')
const noLog = flag('no-log')
let gen = 0

const view = freshView(target, deepOn)

/** Draws the screen. The terminal is only there in the live loop, so it starts as a nothing. */
let draw = () => {}

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
  draw()
  advisor.ahead(x).then(a => {
    if (mine !== gen || !a) return
    view.ahead = a; view.aheadPending = false
    draw()
    if (board.phase === 'potion' && view.deepOn) startDeep(board, mine)
  }).catch(err => { if (mine === gen) { view.aheadPending = false; view.status = `look-ahead failed: ${err}`; draw() } })
}

function startDeep(board: Board, mine = gen) {
  advisor.cancelDeep()
  view.deep = { rows: [], done: 0, total: 60, finished: false }
  advisor.deep(board.x, view.target, {
    rows: (rows, done, total) => { if (mine === gen) { view.deep = { rows, done, total, finished: false }; draw() } },
    done: rows => { if (mine === gen) { view.deep = { rows, done: 60, total: 60, finished: true }; draw() } },
    error: message => { if (mine === gen) { view.deep = { rows: [], done: 0, total: 0, finished: true, error: message }; draw() } },
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
  console.log(reportLines(view).join('\n'))
  if (result === 'kept') process.exitCode = 2
  advisor.close()
  process.exit()
}

/* ---------- the live loop ---------- */

const cap: Capture = createCapture({
  title: new RegExp(arg('game-title') || '^Torchlight: Infinite\\s*$'),
  command: arg('capture-cmd') ?? undefined,
  niriScreenshot: flag('niri-screenshot') ? true : undefined,
})
const watch = createWatch()
let snapping = false, pending: string | null = null, rebase = true, watchBusy = false, firstLook = true
let minigames: Watcher | null = null
let minigamesPath: string | null = null
// the capture's back-off window: a failed grab holds the next automatic one back for 2 s
const retry = retryCapture<Img>(cap)

/** What the game's log says about the Vorax board now. */
function minigameView(): MinigameView | null {
  return noLog ? null : minigames?.state() ?? null
}

async function snap(kind: string) {
  if (snapping) { pending = kind; return }
  const manual = kind === 'manual'
  const gate = minigameCaptureGate(minigameView(), 'vorax')
  const held = retry.heldUp(gate, manual)
  if (held !== '') {
    view.capture = held
    draw()
    return
  }

  snapping = true
  const gateNote = !gate.allowed ? `${gate.status} (manual read forced)` : gate.status
  let captureStatus = gateNote
  try {
    // a watched change has already held still; a log trigger waits for the cards to land
    const grab = () => retry.grab({ force: manual })
    const img = kind === 'manual' || kind === 'watch' ? await grab() : await waitStable(() => grab() as never) as unknown as Img
    const r = await readPicture(img, kind)
    if (kind === 'watch') { if (r === 'new') watch.settle(); else if (r === 'same') watch.falseAlarm() }
    captureStatus = gateNote === '' ? cap.status() : `${gateNote} · ${cap.status()}`
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    view.status = message
    captureStatus = message
  } finally {
    view.capture = captureStatus
    snapping = false; rebase = true
    draw()
    if (pending) { const k = pending; pending = null; void snap(k) }
  }
}

// the screen watch: a picture after every move, from the screen itself (works with the game's log detail off too)
async function look() {
  if (watchBusy || snapping) return
  const gate = minigameCaptureGate(minigameView(), 'vorax')
  const held = retry.heldUp(gate)
  if (held !== '') {
    view.capture = held
    draw()
    return
  }

  watchBusy = true
  try {
    if (firstLook) { firstLook = false; void snap('watch'); return }
    const t = watchThumb(await retry.grab())
    view.capture = gate.status === '' ? cap.status() : `${gate.status} · ${cap.status()}`
    if (rebase) { watch.setBase(t); rebase = false; return }
    if (watch.feed(t, Date.now())) void snap('watch')
  } catch (err) {
    view.capture = err instanceof Error ? err.message : String(err)
    firstLook = true
    draw()
  } finally { watchBusy = false }
}

/** The log follower's loop: polled every POLL_MS, checked every CHECK_MS. */
interface Loop { poll(): Promise<void>; check(): void }
let loop: Loop | null = null
function connectLog() {
  const found = findLog(arg('log') ?? undefined)
  if (!found) {
    view.log = 'Torchlight: Infinite is not in a Steam library (use --log=<UE_game.log>)'
    if (!noLog && minigames === null) {
      minigames = watchMinigames()
      minigamesPath = null
    }
    return
  }
  if (!noLog && minigamesPath !== found.file) {
    minigames?.close()
    minigames = watchMinigames({ log: found.file })
    minigamesPath = found.file
  }
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

/* ---------- the terminal ---------- */

const terminal = await startApp({
  onShutdown: () => {
    advisor.close()
    cap.close()
    minigames?.close()
    autoLaunch.stop()
    publishCard('vorax', null)
  },
  onKey: (key) => {
    app.key(key)
  },
  onTick: () => {
    draw()
  },
})
const renderer = terminal.renderer

const app = new VoraxApp(renderer, view, {
  onQuit: () => {
    void terminal.quit()
  },
  onSnap: () => {
    void snap('manual')
  },
  onTarget: () => {
    if (view.board && view.ahead && view.deepOn && view.board.phase === 'potion') startDeep(view.board)
  },
  onDeep: deep => {
    if (!deep) { advisor.cancelDeep(); view.deep = null }
    else if (view.board && view.ahead && view.board.phase === 'potion') startDeep(view.board)
  },
})
draw = () => {
  app.draw()
  publishCard('vorax', cardOf(view))
  renderer.requestRender()
}


connectLog()

// the tools the player turned auto-launch on for open when their minigame opens, with no dashboard;
// the states are the ones this helper already watches
const autoLaunch = startAutoLaunch({ self: 'vorax', view: () => minigames?.state() ?? null })
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
setInterval(look, 450)

draw()

await terminal.done
