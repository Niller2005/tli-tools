#!/usr/bin/env bun
// The TLI tools dashboard: the tools, what they are doing, and the keys that start them.
//
// The list is drawn with OpenTUI. Before a tool starts, the renderer is destroyed and the terminal
// is put back; the tool then owns it. When the tool exits, a new renderer is made for the list.
//
// The status beside and under the list comes from the packages that know it (the plan in
// docs/plan-dashboard.md): it is read once a second on the tick, away from the drawing, so a slow
// read delays the next tick and never a frame. A tool that the player has asked to open by itself
// is opened when its minigame turns open — once per closed-to-open transition, and never on the
// first sample, however open the board already is when the dashboard comes up.

import { watchMinigames, type Watcher } from '@tli/gamelog'
import {
  AutoLauncher,
  Launcher,
  openTool,
  readSettings,
  settingsPath,
  toolSettings,
  writeSettings,
  type Tool,
} from '@tli/launch'
import { itemTableAge, refreshBaselineStatus } from '@tli/tracker'
import { startApp } from '@tli/tui'
import { DashboardApp, freshState } from './app'
import { launch } from './launch'
import { readStatus } from './status'

/** The log to watch, when it is said on the command line. */
const givenLog = process.argv.find((a) => a.startsWith('--log='))?.slice('--log='.length) ?? null

/** Where the player's settings are. */
const settingsFile = settingsPath()

/** What happened while the dashboard was on the screen. */
type Outcome = { kind: 'quit' } | { kind: 'run'; tools: Tool[] }

/** Runs the dashboard, and runs the tools the player picks. */
async function dashboard(): Promise<void> {
  const state = freshState(readSettings(settingsFile))
  const ignoreSigint = (): void => {}
  const launcher = new Launcher()

  // the item-name table changes only when the repo is rebuilt, so its age is read once
  const itemAge = await itemTableAge()
  // whether the community prices are being fetched just now
  let fetching = false

  /** Keeps the settings the player has made on disk; the state is the truth, the file the memory. */
  const keepSettings = (): void => {
    try {
      writeSettings(settingsFile, state.settings)
    } catch (error) {
      state.message = { text: `the settings could not be kept: ${(error as Error).message}`, tone: 'red' }
    }
  }

  /** Fetches the community prices and says what happened; the screen keeps going while it runs. */
  const fetchPrices = (draw: () => void): void => {
    if (fetching) {
      state.message = 'the community prices are already being fetched'
      draw()
      return
    }
    fetching = true
    void refreshBaselineStatus().then((refresh) => {
      fetching = false
      state.message = refresh.ok ? refresh.message : { text: refresh.message, tone: 'red' }
      draw()
    })
  }

  while (true) {
    let watcher: Watcher | null = null
    // opens the tools the player asked for when their minigame opens; the first sample is no
    // transition, however open a board already is
    const auto = new AutoLauncher({ launcher, argv: process.argv })
    // whether a read of the status is still going: the tick skips itself rather than pile up
    let reading = false
    const stopWatching = (): void => {
      watcher?.close()
      watcher = null
    }
    const { promise: outcome, resolve: settleOutcome } = Promise.withResolvers<Outcome>()
    // the dashboard on the terminal this round; made as soon as the renderer is
    let app: DashboardApp
    const refresh = async (): Promise<void> => {
      const view = watcher?.state() ?? null
      state.view = view
      state.status = await readStatus({ view, launcher, log: givenLog, itemAge })

      // a tool the player asked for opens by itself: once per open transition, never twice. One
      // it opened itself closes again when its minigame has been over for a few seconds.
      const step = auto.step(view, state.settings)
      for (const { result } of step.opened) state.message = `opened by itself: ${result.message}`
      for (const { result } of step.closed) state.message = `closed by itself: ${result.message}`

      app.draw()
    }
    const terminal = await startApp({
      argv: process.argv,
      onKey: (key) => {
        app.key(key)
      },
      onQuit: () => {
        stopWatching()
        settleOutcome({ kind: 'quit' })
        void terminal.stop()
      },
      onTick: () => {
        if (reading) return
        reading = true
        void refresh().then(() => {
          reading = false
        })
      },
    })

    try {
      app = new DashboardApp(terminal.renderer, state, {
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
        onOpenWindow: (tool) => {
          // the tool goes into a window of its own, so the dashboard keeps the terminal
          return openTool(launcher, tool, {
            parentArgv: process.argv,
            settings: toolSettings(state.settings, tool.id),
          }).message
        },
        onSettings: (settings) => {
          state.settings = settings
          keepSettings()
          app.draw()
        },
        onClose: (tool) => launcher.close(tool.id).message,
        onFocus: (tool) => launcher.focus(tool.id).message,
        onBaseline: () => {
          fetchPrices(() => app.draw())
          return 'the community prices are being fetched'
        },
      })
      terminal.renderer.root.add(app.screen.root)
      // the tree starts with every pane visible: draw once now, before the first read of the
      // status, so the renderer never paints that first-wide frame
      app.draw()

      watcher = watchMinigames(givenLog === null ? {} : { log: givenLog })
      await refresh()

      terminal.renderer.on('destroy', () => {
        settleOutcome({ kind: 'quit' })
      })

      await terminal.done
    } catch (error) {
      await terminal.stop()
      throw error
    } finally {
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
      state.message = { text: (error as Error).message, tone: 'red' }
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
