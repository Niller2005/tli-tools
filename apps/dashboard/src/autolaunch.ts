// When a tool opens by itself, because its minigame opened.
//
// The rule (docs/plan-dashboard.md, item 5) is opt-in, per tool, and never closes anything: a tool
// opens in a window when its minigame turns open and it is not already running, once per open
// transition — not once per second. Both halves of that are plain functions here, so the rule can
// be looked at without a watcher or a launcher being anywhere near.
//
// The first sample after the dashboard starts does not count as a transition: a board that is
// already open when the dashboard comes up has been open all along, and opening a window for it
// would be a surprise rather than a help. The board has to close and open again first.

import type { GameName, MinigameState, MinigameView } from '@tli/gamelog'
import { TOOLS, toolSettings, type Settings, type Tool } from '@tli/launch'

/** What each minigame was, the last time the dashboard looked. */
export type MinigameStates = Record<GameName, MinigameState> | null

/** The states of the view, as the previous sample had them. */
export function statesOf(view: MinigameView | null): MinigameStates {
  if (view === null) return null
  return { warden: view.warden, vorax: view.vorax, arcana: view.arcana }
}

/**
 * The minigames that turned open since the last sample.
 *
 * A null `previous` is the first sample after the dashboard started: nothing counts as a
 * transition, however open the board already is. After that, anything that was not open — closed,
 * or unknown, which only means the log had said nothing yet — and is open now is a transition.
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
 * settings, and that are not already running — the launcher's own memory of what it opened, so a
 * window is never opened twice.
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
