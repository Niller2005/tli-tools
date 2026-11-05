// When a tool opens by itself, because its minigame opened.
//
// The rule (docs/plan-dashboard.md, item 5) is opt-in, per tool, and never closes anything: a tool
// opens in a window when its minigame turns open and it is not already running, once per open
// transition — not once per second. Any program that reads the game's log can do it, not only the
// dashboard: with the loot tracker open and nothing else, the Tartarus board opening opens Warden.
//
// The first sample a program takes does not count as a transition: a board that is already open
// when the program comes up has been open all along, and opening a window for it would be a
// surprise rather than a help. The board has to close and open again first.
//
// "Already running" is asked of the launcher's memory and of the tools themselves (`running.ts`),
// and a claim keeps two programs that see the same board open from both opening the tool.

import { watchMinigames, type GameName, type MinigameState, type MinigameView } from '@tli/gamelog'
import { Launcher, type OpenResult } from './launcher'
import { openTool } from './open'
import { claimOpen, isRunning, registerRunning, releaseClaim, runtimeDir } from './running'
import { readSettings, settingsPath, toolSettings, type Settings } from './settings'
import { TOOLS, type Tool } from './tools'

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
}

/** Takes a sample of the minigames now and then, and opens the tools whose minigame opened. */
export class AutoLauncher {
  private previous: MinigameStates = null
  private readonly dir: string

  constructor(private readonly options: AutoLauncherOptions) {
    this.dir = options.dir ?? runtimeDir()
  }

  /** One sample: the tools opened because of it, with what came of each. */
  step(view: MinigameView | null, settings: Settings): AutoLaunched[] {
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
      if (!result.ok) releaseClaim(tool.id, this.dir)
      launched.push({ tool, result })
    }
    return launched
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
  })
  const file = options.settingsFile ?? settingsPath()

  const timer = setInterval(() => {
    for (const launched of auto.step(view(), readSettings(file))) options.onOpened?.(launched)
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
