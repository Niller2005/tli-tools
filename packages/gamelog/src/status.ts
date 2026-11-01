//! The status of a tool, as the dashboard draws it.
//!
//! The dashboard plan (docs/plan-dashboard.md) has each package say what its tool is doing as a
//! plain object — contract C1 — and the dashboard draws it. Nothing here looks at the screen or
//! reads the log: the states are the ones the `MinigameTracker` already keeps, so a status is
//! worked out in no time at all.

import type { GameName, GameStatus } from './index'

/**
 * What one tool says about itself (contract C1 of the dashboard plan).
 *
 * The line is the whole message: the dashboard draws it as it is and never asks for more. A tool
 * with nothing to say returns an empty line.
 */
export interface ToolStatus {
  /** the tool's id, the one the dashboard's tool list knows it by */
  id: string
  /** one line about the tool; '' when it has nothing to say */
  line: string
  /** how the line is drawn: something going on, something quiet, something to look at */
  tone: 'ok' | 'dim' | 'warn'
  /** when the line last became true, in ms since the epoch; 0 when that is not known */
  at: number
}

/**
 * What the log says about a minigame, as one line for the dashboard.
 *
 * The Vorax and the Warden tools read a minigame the log names the pages of, so all their status
 * can say is whether it is on screen. The state is the one the `MinigameTracker` keeps: a watcher
 * fed the log's lines, and the tool's status is read off it without touching the log again.
 */
export function minigameStatus(game: GameName, state: GameStatus): ToolStatus {
  return {
    id: game,
    line: state.state === 'unknown' ? '' : state.state,
    tone: state.state === 'open' ? 'ok' : 'dim',
    at: state.at ?? 0,
  }
}
