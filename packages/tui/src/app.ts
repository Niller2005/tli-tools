// Starting and stopping a terminal app.
//
// The app owns the renderer and puts the terminal back on every way out: the key that quits, the
// signals, and a failure. It also owns what every tool once wired for itself: the keys are read in
// one place and ctrl+c quits, the tick that reads what changed and draws it comes on a cadence, and
// the save comes every 30 s and on the way out. The app gives handlers and nothing else; what is
// the app's own policy (arcana's chunked backfill saves, vorax's capture watch) stays in the app.

import { type CliRenderer, type KeyEvent, createCliRenderer } from '@opentui/core'
import { setColorEnabled } from './theme'

/** How often the tick comes, in milliseconds. */
const TICK_MS = 1000

/** How often a save comes, in milliseconds. */
const SAVE_MS = 30_000

/** How the app is set up. */
export interface StartAppOptions {
  /** false turns the colours off; `NO_COLOR` and `--no-color` do the same. */
  color?: boolean
  /** the arguments to look for `--no-color` in; the process arguments by default. */
  argv?: string[]
  /** a renderer that is already made (the tests make one); one is made for the terminal by default. */
  renderer?: CliRenderer
  /** what to do before the terminal is put back. */
  onShutdown?: () => void | Promise<void>
  /** the signals that end the app. */
  signals?: NodeJS.Signals[]
  /** the app's keys. ctrl+c never reaches it: it quits. */
  onKey?: (key: KeyEvent) => void
  /** what the player wanting to leave does; the default is `quit()`, which stops and ends the process. */
  onQuit?: () => void
  /** the app's part of every tick: read what changed and draw it. */
  onTick?: () => void
  /** how often the tick comes, in milliseconds; once a second by default. */
  tickEveryMs?: number
  /** what a save is, done every 30 s; `onShutdown` is the save on the way out. */
  onSave?: () => void | Promise<void>
  /** how often a save comes, in milliseconds; every 30 s by default. */
  saveEveryMs?: number
}

/** A running app. */
export interface App {
  /** the renderer the app draws on */
  renderer: CliRenderer
  /** Ends the app: runs `onShutdown`, puts the terminal back, waits for it, and ends the process. */
  quit: () => Promise<void>
  /** Ends the app without ending the process: runs `onShutdown`, puts the terminal back and waits. */
  stop: () => Promise<void>
  /** Resolves once the app has stopped. */
  done: Promise<void>
}

/** Makes an app, and guarantees that the terminal is put back. */
export async function startApp(options: StartAppOptions = {}): Promise<App> {
  const argv = options.argv ?? process.argv
  if (options.color === false || argv.includes('--no-color')) setColorEnabled(false)

  const renderer =
    options.renderer ??
    (await createCliRenderer({
      screenMode: 'alternate-screen',
      exitOnCtrlC: false,
      exitSignals: [],
      autoFocus: false,
      useMouse: true,
      targetFps: 30,
    }))

  const signals = options.signals ?? ['SIGINT', 'SIGTERM', 'SIGHUP']
  const { promise, resolve } = Promise.withResolvers<void>()
  let stopped = false
  let tick: NodeJS.Timeout | undefined
  let save: NodeJS.Timeout | undefined

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
    clearInterval(tick)
    clearInterval(save)
    try {
      await options.onShutdown?.()
    } catch {
      // the app is leaving; a failure to save is not worth stopping for
    }
    renderer.destroy()
    try {
      await renderer.closed
    } catch {
      // the terminal may already be gone
    }
    resolve()
  }

  const quit = async (): Promise<void> => {
    await stop()
    process.exit(0)
  }

  const leave = options.onQuit ?? quit
  const onKey = options.onKey
  if (onKey !== undefined) {
    const press = (key: KeyEvent): void => {
      if (key.ctrl && key.name === 'c') {
        void leave()
        return
      }
      onKey(key)
    }
    renderer.keyInput.on('keypress', press)
    renderer.on('destroy', () => {
      renderer.keyInput.off('keypress', press)
    })
  }

  if (options.onTick !== undefined) tick = setInterval(options.onTick, options.tickEveryMs ?? TICK_MS)
  if (options.onSave !== undefined) {
    const onSave = options.onSave
    save = setInterval(() => {
      void onSave()
    }, options.saveEveryMs ?? SAVE_MS)
  }

  const onSignal = (): void => {
    void stop().then(() => process.exit(0))
  }
  for (const signal of signals) process.on(signal, onSignal)
  renderer.on('destroy', () => {
    clearInterval(tick)
    clearInterval(save)
    for (const signal of signals) process.off(signal, onSignal)
  })

  return { renderer, quit, stop, done: promise }
}
