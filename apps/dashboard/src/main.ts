#!/usr/bin/env bun
// The TLI tools dashboard: pick the tools to run, press Enter.
//
// The list is drawn with OpenTUI. Before a tool starts, the renderer is destroyed and the terminal
// is put back; the tool then owns it. When the tool exits, a new renderer is made for the list.

import type { KeyEvent } from '@opentui/core'
import { watchMinigames, type Watcher } from '@tli/gamelog'
import { startApp } from '@tli/tui'
import { DashboardApp, freshState, viewSignature } from './app'
import { launch } from './launch'
import { type Tool } from './tools'

/** The log to watch, when it is said on the command line. */
const givenLog = process.argv.find((a) => a.startsWith('--log='))?.slice('--log='.length) ?? null

/** What happened while the dashboard was on the screen. */
type Outcome = { kind: 'quit' } | { kind: 'run'; tools: Tool[] }

/** Runs the dashboard, and runs the tools the player picks. */
async function dashboard(): Promise<void> {
  const state = freshState()
  const ignoreSigint = (): void => {}

  while (true) {
    let watcher: Watcher | null = null
    let tick: NodeJS.Timeout | undefined
    const stopWatching = (): void => {
      watcher?.close()
      watcher = null
    }
    const { promise: outcome, resolve: settleOutcome } = Promise.withResolvers<Outcome>()
    const terminal = await startApp({ argv: process.argv })

    try {
      const app = new DashboardApp(terminal.renderer, state, {
        onQuit: () => {
          stopWatching()
          settleOutcome({ kind: 'quit' })
          void terminal.stop()
        },
        onRun: (tools) => {
          stopWatching()
          process.on('SIGINT', ignoreSigint)
          settleOutcome({ kind: 'run', tools })
          void terminal.stop()
        },
      })
      terminal.renderer.root.add(app.screen.root)

      watcher = watchMinigames(givenLog === null ? {} : { log: givenLog })
      state.view = watcher.state()
      let shown = viewSignature(state.view)
      app.draw()

      tick = setInterval(() => {
        const view = watcher?.state()
        if (view === null || view === undefined) return
        const next = viewSignature(view)
        if (next === shown) return
        shown = next
        state.view = view
        app.draw()
      }, 1000)

      const onKey = (key: KeyEvent): void => app.key(key)
      terminal.renderer.keyInput.on('keypress', onKey)
      terminal.renderer.on('destroy', () => {
        terminal.renderer.keyInput.off('keypress', onKey)
        settleOutcome({ kind: 'quit' })
      })

      await terminal.done
    } catch (error) {
      await terminal.stop()
      throw error
    } finally {
      clearInterval(tick)
      stopWatching()
    }

    const result = await outcome
    if (result.kind === 'quit') return

    // The child shares the terminal with us. A Ctrl+C in the child's terminal is a signal to the
    // whole process group, so keep this process alive until the child has gone.
    try {
      await launch(result.tools)
      state.message = ''
    } catch (error) {
      state.message = (error as Error).message
    } finally {
      process.off('SIGINT', ignoreSigint)
    }
  }
}

if (!process.stdin.isTTY) {
  console.error('The dashboard needs a terminal.')
  process.exit(1)
}

try {
  await dashboard()
} catch (error) {
  console.error(error)
  process.exit(1)
}
