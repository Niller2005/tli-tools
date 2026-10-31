// Starting and stopping a terminal app.
//
// The app owns the renderer and puts the terminal back on every way out: the key that quits, the
// signals, and a failure. Nothing else has to remember to do it.

import { type CliRenderer, createCliRenderer } from '@opentui/core'
import { setColorEnabled } from './theme'

/** How the app is set up. */
export interface StartAppOptions {
  /** false turns the colours off; `NO_COLOR` and `--no-color` do the same. */
  color?: boolean
  /** the arguments to look for `--no-color` in; the process arguments by default. */
  argv?: string[]
  /** what to do before the terminal is put back. */
  onShutdown?: () => void | Promise<void>
  /** the signals that end the app. */
  signals?: NodeJS.Signals[]
}

/** A running app. */
export interface App {
  /** the renderer the app draws on */
  renderer: CliRenderer
  /** Ends the app: runs `onShutdown`, puts the terminal back and waits for it. */
  stop: () => Promise<void>
  /** Resolves once the app has stopped. */
  done: Promise<void>
}

/** Makes a renderer, and guarantees that the terminal is put back. */
export async function startApp(options: StartAppOptions = {}): Promise<App> {
  const argv = options.argv ?? process.argv
  if (options.color === false || argv.includes('--no-color')) setColorEnabled(false)

  const renderer = await createCliRenderer({
    screenMode: 'alternate-screen',
    exitOnCtrlC: false,
    exitSignals: [],
    autoFocus: false,
    useMouse: true,
    targetFps: 30,
  })

  const signals = options.signals ?? ['SIGINT', 'SIGTERM', 'SIGHUP']
  const { promise, resolve } = Promise.withResolvers<void>()
  let stopped = false

  const stop = async (): Promise<void> => {
    if (stopped) return
    stopped = true
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

  const onSignal = (): void => {
    void stop().then(() => process.exit(0))
  }
  for (const signal of signals) process.on(signal, onSignal)
  renderer.on('destroy', () => {
    for (const signal of signals) process.off(signal, onSignal)
  })

  return { renderer, stop, done: promise }
}
