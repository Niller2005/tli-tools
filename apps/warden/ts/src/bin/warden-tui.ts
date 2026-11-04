#!/usr/bin/env bun
//! Warden in a terminal, for Linux under Niri: captures the game window with
//! silent grim, reads the board when the screen changes and shows the move it
//! recommends. Never clicks or types in the game.
//!
//!   warden-tui [--title TEXT] [--rollouts N] [--log FILE] [--no-log] [--no-color]
//!   warden-tui [--capture-cmd <command writing a PNG of the game to {out}>]
//!   warden-tui [--niri-screenshot]  allow Niri's announced window screenshot
//!   warden-tui --image <frame.png> [--rollouts N]    read one screenshot, print, exit
//!
//! Keys: r read now, q quit.
//!
//! The game's log says whether the Tartarus board is on screen: while it is
//! closed the game window is not looked at, and the board is read as soon as
//! it opens. Without the log (or with `--no-log`) the window is watched as
//! before.
//!
//! The window is taken with `@tli/capture`, which holds the Rust
//! `app/niri.rs` logic.

import { createCapture } from '@tli/capture'
import { captureMinigame, logHint, minigameCaptureGate, retryCapture, watchMinigames } from '@tli/gamelog'
import { asBytes } from '@tli/png'
import { startApp } from '@tli/tui'
import { Session, Watch, fingerprint } from '@/app/session'
import { timed } from '@/app/profile'
import { solvePool } from '@/app/solve-pool'
import { Rgba, loadPng } from '@/reader/mod'
import { publishCard } from '@tli/overlay'
import { WardenApp } from '@/tui/app'
import { plainScreen, stateFromSession } from '@/tui/view'

/** How often the game is looked at, in milliseconds (4 a second). */
const SAMPLE = 250

interface Args {
  title: string
  rollouts: number
  image: string | null
  noLog: boolean
  captureCmd: string | null
  logPath: string | null
  niriScreenshot: boolean | undefined
}

function args(): Args {
  const a: Args = {
    title: 'Torchlight',
    rollouts: 1600,
    image: null,
    noLog: false,
    captureCmd: null,
    logPath: null,
    niriScreenshot: undefined,
  }
  const argv = process.argv.slice(2)
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    switch (arg) {
      case '--title': {
        const value = argv[++i]
        if (value === undefined) throw new Error('--title needs a text')
        a.title = value
        break
      }
      case '--capture-cmd': {
        const value = argv[++i]
        if (value === undefined) throw new Error('--capture-cmd needs a command')
        a.captureCmd = value
        break
      }
      case '--log': {
        const value = argv[++i]
        if (value === undefined) throw new Error('--log needs a file')
        a.logPath = value
        break
      }
      case '--niri-screenshot':
        a.niriScreenshot = true
        break
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
      case '--no-log':
        a.noLog = true
        break
      case '--no-color':
        break
      default:
        throw new Error(
          `unexpected argument ${arg}; usage: warden-tui [--title TEXT] [--rollouts N] [--capture-cmd COMMAND] [--log FILE] [--niri-screenshot] [--no-log] [--no-color] | warden-tui --image <frame.png>`,
        )
    }
  }
  return a
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

function sleep(ms: number): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>()
  setTimeout(resolve, ms)
  return promise
}

/** The plain text of a one-image read, for the non-interactive mode. */
function imageOutput(session: Session, path: string): string[] {
  return plainScreen(stateFromSession(session, `screenshot ${path}`, null))
}

async function run(): Promise<void> {
  const a = args()
  const session = new Session(a.rollouts, [], null, null)
  if (a.image !== null) {
    const frame = loadPng(a.image)
    session.readInBackground(frame)
    await session.wait()
    for (const line of imageOutput(session, a.image)) process.stdout.write(`${line}\n`)
    return
  }

  // The workers load while the first frame is captured and read.
  solvePool().warm()
  let readNow = false
  let quitting = false

  /** What the player wanting to leave does: the loop ends, and the terminal is put back. */
  function leave(): void {
    quitting = true
    void terminal.stop()
  }

  const terminal = await startApp({
    onKey: (key) => {
      app.key(key)
    },
    onQuit: leave,
  })
  const renderer = terminal.renderer
  const app = new WardenApp(renderer, session, {
    onRead: () => {
      readNow = true
    },
    onQuit: leave,
  })



  const watch = new Watch()
  const capture = createCapture({
    title: new RegExp(escapeRegExp(a.title), 'i'),
    command: a.captureCmd ?? undefined,
    niriScreenshot: a.niriScreenshot,
  })
  app.area = () => capture.area()
  // The game's log says whether the board is on screen; without it (the log is
  // missing, or it has no detail) the window is watched as before.
  const log = a.noLog ? null : watchMinigames(a.logPath === null ? {} : { log: a.logPath })
  let wasClosed = false
  let next = performance.now()
  // the capture's back-off window: a failed grab holds the next automatic one back for 2 s
  const shots = retryCapture(capture)
  try {
    app.draw('looking for the game window…')
    while (!quitting) {
      const view = log === null ? null : log.state()
      const gate = minigameCaptureGate(view, 'warden')
      const closed = !gate.allowed
      if (wasClosed && !closed) watch.readNext()
      wasClosed = closed

      let captureNote: string
      const held = shots.heldUp(gate, readNow)
      if (held !== '') {
        captureNote = held
      } else {
        try {
          const started = performance.now()
          const attempt = await captureMinigame(shots, view, 'warden', readNow)
          timed('capture', performance.now() - started)
          if (attempt.image === null) {
            captureNote = attempt.status
          } else {
            const frame = asRgba(attempt.image)
            captureNote = attempt.status === '' ? `${frame.w} x ${frame.h}` : `${attempt.status} · ${frame.w} x ${frame.h}`
            const marked = performance.now()
            const print = fingerprint(frame)
            timed('fingerprint', performance.now() - marked)
            if (readNow) {
              watch.markRead(print)
              session.readLive(frame)
            } else if (watch.sample(print)) {
              session.readLive(frame)
            }
          }
        } catch (e) {
          captureNote = e instanceof Error ? e.message : String(e)
        }
      }
      if (quitting) break
      readNow = false
      const hint = view === null ? null : logHint(view.log)
      if (hint !== null) captureNote += `  ${hint}`
      session.poll()
      if (session.wantsReread()) watch.readNext()
      const drawn = performance.now()
      app.draw(captureNote)
      timed('draw', performance.now() - drawn)

      next += SAMPLE
      const wait = next - performance.now()
      if (wait > 0) await sleep(wait)
      else next = performance.now()
    }
  } finally {
    publishCard('warden', null)
    capture.close()
    log?.close()
    await terminal.stop()
  }
}

run()
  .then(() => {
    process.exit(0)
  })
  .catch((e: unknown) => {
    process.stderr.write(`${e instanceof Error ? e.message : String(e)}\n`)
    process.exit(1)
  })
