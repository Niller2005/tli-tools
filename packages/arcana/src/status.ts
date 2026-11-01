// The Arcana tool's status line, as the dashboard draws it.
//
// The dashboard plan (docs/plan-dashboard.md) asks each package for a plain object instead of a
// screen — contract C1. This one is worked out from the tracker's own history (the `state` a live
// tracker gives, or the `history` of what `load` reads back), so nothing here reads the log.

import type { ToolStatus } from '@tli/gamelog'
import type { Contest, History, Session } from './session'

/** The chests of destiny the player took, over every visit. */
function chestsTaken(sessions: Session[]): number {
  return sessions.reduce((total, session) => total + session.chests.length, 0)
}

/** The chests of destiny the Fateful Contests opened. */
function chestsOpened(contests: Contest[]): number {
  return contests.reduce((total, contest) => total + contest.chests.length, 0)
}

/** When the history last changed: the end of what went on, or its last move. */
function lastChange(history: History): number {
  const times: number[] = []
  const session = history.sessions[history.sessions.length - 1]
  if (session !== undefined) {
    times.push(session.openedAt, session.closedAt ?? 0, session.moves[session.moves.length - 1]?.at ?? 0)
  }
  const contest = history.contests[history.contests.length - 1]
  if (contest !== undefined) {
    times.push(contest.askedAt ?? 0, contest.openedAt ?? 0, contest.closedAt ?? 0)
    times.push(contest.chests[contest.chests.length - 1]?.at ?? 0)
  }
  const trial = history.trials[history.trials.length - 1]
  if (trial !== undefined) times.push(trial.at)
  return Math.max(0, ...times)
}

/**
 * The Arcana tool's status line (contract C1 of the dashboard plan).
 *
 * The line says whether the Tarot Path is open, the life of the visit that is going on, the chests
 * of destiny still waiting for a Fateful Contest, and how many trials were fought. The open and
 * the closed are read off the visits — a visit that never ended is one that is still going on —
 * and a log that never showed a visit leaves the tool with nothing to say.
 */
export function arcanaStatus(history: History): ToolStatus {
  const session = history.sessions[history.sessions.length - 1]
  if (session === undefined) return { id: 'arcana', line: '', tone: 'dim', at: lastChange(history) }

  // the tracker can have seen a contest without the visit that took the chests, so the count is
  // never allowed below zero
  const held = Math.max(0, chestsTaken(history.sessions) - chestsOpened(history.contests))
  const trials = history.trials.length
  const open = session.closedAt === null
  if (open) {
    const life = `life -${session.lifeLost} +${session.lifeWon}`
    return {
      id: 'arcana',
      line: `Tarot Path open · ${life} · ${held} chests held · ${trials} trials`,
      tone: 'ok',
      at: lastChange(history),
    }
  }
  return {
    id: 'arcana',
    line: `Tarot Path closed · ${held} chests held · ${trials} trials`,
    tone: 'dim',
    at: lastChange(history),
  }
}
