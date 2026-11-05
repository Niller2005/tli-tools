// When a tool opens by itself, because its minigame opened, and closes again when it is over.
//
// The rule (docs/plan-dashboard.md, item 5) is opt-in, per tool: a tool opens in a window when its
// minigame turns open and it is not already running, once per open transition — not once per
// second. Any program that reads the game's log can do it, not only the dashboard: with the loot
// tracker open and nothing else, the Tartarus board opening opens Warden.
//
// The first sample a program takes does not count as a transition: a board that is already open
// when the program comes up has been open all along, and opening a window for it would be a
// surprise rather than a help. The board has to close and open again first.
//
// What a program opened by itself it closes by itself: when the log says the minigame is closed,
// the tool is asked to stop after a few seconds (`AUTO_CLOSE_MS`), unless the minigame opens again
// first. A tool the player opened is never closed by this, and neither is one another program
// opened.
//
// "Already running" is asked of the launcher's memory and of the tools themselves (`running.ts`),
// and a claim keeps two programs that see the same board open from both opening the tool.

import { watchMinigames, type GameName, type MinigameState, type MinigameView } from '@tli/gamelog'
import { Launcher, type CloseResult, type OpenResult } from './launcher'
import { openTool } from './open'
import { claimOpen, isRunning, registerRunning, releaseClaim, runtimeDir } from './running'
import { readSettings, settingsPath, toolSettings, type Settings } from './settings'
import { TOOLS, toolById, type Tool } from './tools'

/** What each minigame was, the last time a program looked. */
export type MinigameStates = Record<GameName, MinigameState> | null

/** The states of the view, as the previous sample had them. */
export function statesOf(view: MinigameView | null): MinigameStates {
  if (view === null) return null
  return { warden: view.warden, vorax: view.vorax, arcana: view.arcana }
}

/**
 * The minigames that turned open since the last sample.
 *
 * A null `previous` is the first sample: nothing counts as a transition, however open the board
 * already is. After that, anything that was not open — closed, or unknown, which only means the
 * log had said nothing yet — and is open now is a transition.
 */
export function newlyOpen(previous: MinigameStates, view: MinigameView | null): GameName[] {
  if (view === null) return []
  if (previous === null) return []
  const opened: GameName[] = []
  for (const game of ['warden', 'vorax', 'arcana'] as const) {
    if (previous[game] !== 'open' && view[game] === 'open') opened.push(game)
  }
  return opened
}

/**
 * The tools that should be opened for minigames that just turned open.
 *
 * Only the tools that watch one of those minigames, that have auto-launch turned on in the
 * settings, and that are not already running.
 */
export function toolsToAutoLaunch(
  opened: readonly GameName[],
  settings: Settings,
  isRunning: (id: string) => boolean,
): Tool[] {
  return TOOLS.filter(
    tool =>
      tool.game !== undefined &&
      opened.includes(tool.game) &&
      toolSettings(settings, tool.id).autoLaunch &&
      !isRunning(tool.id),
  )
}

/** A tool that was opened by itself, and what came of it. */
export interface AutoLaunched {
  tool: Tool
  result: OpenResult
}

/** A tool that was closed by itself, because its minigame was over, and what came of it. */
export interface AutoClosed {
  tool: Tool
  result: CloseResult
}

/** What one sample did. */
export interface AutoStep {
  opened: AutoLaunched[]
  closed: AutoClosed[]
}

/** How long a minigame stays closed before the tool that was opened for it is closed, in milliseconds. */
export const AUTO_CLOSE_MS = 5000

/** How an auto-launcher is set up. */
export interface AutoLauncherOptions {
  /** what opens the windows, and remembers them */
  launcher: Launcher
  /** the arguments of the program that opens them, for the flags the child takes from it */
  argv: readonly string[]
  /** where the tools say they run; `runtimeDir()` by default */
  dir?: string
  /** looks for the programs a tool needs; `Bun.which` by default */
  which?: (program: string) => string | null
  /** how long its minigame has to stay closed before a tool is closed; `AUTO_CLOSE_MS` by default */
  closeAfterMs?: number
}

/**
 * Takes a sample of the minigames now and then, opens the tools whose minigame opened, and closes
 * the ones it opened when their minigame has been closed for a while.
 */
export class AutoLauncher {
  private previous: MinigameStates = null
  private readonly dir: string
  /** the tools this launcher opened and still has open, with when each is to be closed; null while its minigame is open */
  private readonly opened = new Map<string, { closeAt: number | null }>()

  constructor(private readonly options: AutoLauncherOptions) {
    this.dir = options.dir ?? runtimeDir()
  }

  /** One sample: the tools opened and the tools closed because of it, with what came of each. */
  step(view: MinigameView | null, settings: Settings, now: number = Date.now()): AutoStep {
    const opened = newlyOpen(this.previous, view)
    this.previous = statesOf(view)

    const launched: AutoLaunched[] = []
    const alreadyOpen = (id: string): boolean => this.options.launcher.isOpen(id) || isRunning(id, this.dir)
    for (const tool of toolsToAutoLaunch(opened, settings, alreadyOpen)) {
      if (!claimOpen(tool.id, this.dir)) continue
      const result = openTool(this.options.launcher, tool, {
        parentArgv: this.options.argv,
        settings: toolSettings(settings, tool.id),
        ...(this.options.which === undefined ? {} : { which: this.options.which }),
      })
      if (result.ok) this.opened.set(tool.id, { closeAt: null })
      else releaseClaim(tool.id, this.dir)
      launched.push({ tool, result })
    }
    return { opened: launched, closed: this.closeFinished(view, now) }
  }

  /**
   * Closes the tools this launcher opened whose minigame has been closed for long enough.
   *
   * Only a log that says the minigame is closed counts: unknown, or no log at all, closes nothing,
   * and a minigame that opens again before the time is up keeps its tool.
   */
  private closeFinished(view: MinigameView | null, now: number): AutoClosed[] {
    const closed: AutoClosed[] = []
    const delay = this.options.closeAfterMs ?? AUTO_CLOSE_MS
    for (const [id, entry] of this.opened) {
      const tool = toolById(id)
      // the player closed it themselves, or the tool ended: nothing is left to close
      if (tool === undefined || !this.options.launcher.isOpen(id)) {
        this.opened.delete(id)
        continue
      }
      const state = view === null || tool.game === undefined ? null : view[tool.game]
      if (state !== 'closed') {
        entry.closeAt = null
        continue
      }
      entry.closeAt ??= now + delay
      if (now < entry.closeAt) continue
      this.opened.delete(id)
      const result = this.options.launcher.close(id)
      // the way is free for the next time the minigame opens
      releaseClaim(id, this.dir)
      closed.push({ tool, result })
    }
    return closed
  }
}

/** How a program that is not the dashboard takes part. */
export interface StartAutoLaunchOptions {
  /** the tool this program is: it says it runs, so no other program opens a second one */
  self?: string
  /** the log to watch; the game's own by default. Not used when `view` is given. */
  log?: string
  /** where the minigames' states come from, for a program that already watches them */
  view?: () => MinigameView | null
  /** the arguments of this program, for the flags the child takes from it; `process.argv` by default */
  argv?: readonly string[]
  /** the settings file; the dashboard's by default. It is read at every sample, so a change shows at once. */
  settingsFile?: string
  /** where the tools say they run; `runtimeDir()` by default */
  dir?: string
  /** the launcher that opens the windows; a new one by default */
  launcher?: Launcher
  /** how often a sample is taken, in milliseconds; once a second by default */
  everyMs?: number
  /** called for each tool that was opened, so the program can say so on its screen */
  onOpened?: (launched: AutoLaunched) => void
  /** called for each tool that was closed because its minigame was over */
  onClosed?: (closed: AutoClosed) => void
  /** how long a minigame stays closed before its tool is closed, in milliseconds; `AUTO_CLOSE_MS` by default */
  closeAfterMs?: number
}

/**
 * Lets a tool open the others by itself, as the dashboard does: it watches the minigames, and
 * opens the tools the player turned auto-launch on for when their minigame opens. Returns what
 * ends it. A program calls this once, after its terminal is up.
 */
export function startAutoLaunch(options: StartAutoLaunchOptions = {}): { stop(): void } {
  const dir = options.dir ?? runtimeDir()
  const release = options.self === undefined ? () => {} : registerRunning(options.self, dir)
  const watcher = options.view === undefined ? watchMinigames(options.log === undefined ? {} : { log: options.log }) : null
  const view = options.view ?? (() => watcher?.state() ?? null)
  const auto = new AutoLauncher({
    launcher: options.launcher ?? new Launcher(),
    argv: options.argv ?? process.argv,
    dir,
    ...(options.closeAfterMs === undefined ? {} : { closeAfterMs: options.closeAfterMs }),
  })
  const file = options.settingsFile ?? settingsPath()

  const timer = setInterval(() => {
    const step = auto.step(view(), readSettings(file))
    for (const launched of step.opened) options.onOpened?.(launched)
    for (const closed of step.closed) options.onClosed?.(closed)
  }, options.everyMs ?? 1000)
  // a program that has nothing else to do is done, whether or not it was watching
  timer.unref()

  return {
    stop(): void {
      clearInterval(timer)
      watcher?.close()
      release()
    },
  }
}
