// The tracker's status line and session summary, as the dashboard draws them.
//
// The dashboard plan (docs/plan-dashboard.md) asks each package for plain objects instead of a
// screen: contract C1 is the one-line status of a tool, and item 4 is the session summary panel.
// Both are worked out from the engine's own state — the snapshot a live tracker gives, or what
// `loadTracker` reads back — so nothing here reads the log; a summary of the 500 runs the tracker
// keeps is a few milliseconds.

import type { ToolStatus } from '@tli/gamelog'
import { Tracker, type SavedState } from './engine'
import type { Run, RunKind } from './runs'
import { durationOf, perHour } from './valuation'

/** One run of the summary: what the panel says about it, without the log's item ids. */
export interface SummaryRun {
  /** the run's number */
  id: number
  /** what kind of run it is */
  kind: RunKind
  /** the map's English name */
  name: string
  /** the FE picked up in the run */
  fe: number
  /** what the run's loot was worth, in FE */
  worth: number
  /** when the run started, in ms */
  startedAt: number
  /** when the run ended; null while it is still going */
  endedAt: number | null
}

/** The session summary the dashboard draws (plan item 4). */
export interface SessionSummary {
  /** the runs that started today, the one going on included */
  runsToday: number
  /** the FE picked up in today's runs */
  feToday: number
  /** the FE picked up in an hour of today's runs */
  fePerHour: number
  /** today's run that was worth the most, when one of them was worth anything */
  bestRun: SummaryRun | null
  /** the last run of all, the one going on included */
  lastRun: SummaryRun | null
  /** the FE picked up in every run the state knows */
  feTotal: number
  /** when the runs last changed: the end of the last one, or `now` when one is going on */
  at: number
}

/** The start of the day `now` is in, on the player's own clock: the day a run counts as "today" on. */
function startOfDay(now: number): number {
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  return day.getTime()
}

/** One run, as the summary shows it. */
function summaryRun(tracker: Tracker, run: Run): SummaryRun {
  return {
    id: run.id,
    kind: run.kind,
    name: run.name === '' ? run.zone : run.name,
    fe: run.fe,
    worth: tracker.valueOfRun(run).gross,
    startedAt: run.start,
    endedAt: run.end,
  }
}

/**
 * What the player has been doing, from the tracker's state.
 *
 * The day is the player's own: a run counts for today when it started after the local midnight
 * before `now`. The best run is the one of today whose loot was worth the most, so a day of
 * unsold loot honestly says there was no best run yet; the last run and the FE total are of the
 * whole state, today or not.
 */
export function sessionSummary(state: SavedState, now = Date.now()): SessionSummary {
  const tracker = new Tracker()
  tracker.restore(state)
  const runs = [...tracker.runs]
  const current = tracker.currentRun
  if (current !== null) runs.push(current)

  const dayStart = startOfDay(now)
  let runsToday = 0
  let feToday = 0
  let timeToday = 0
  let feTotal = 0
  let best: Run | null = null
  let bestWorth = 0
  for (const run of runs) {
    feTotal += run.fe
    if (run.start < dayStart) continue
    runsToday += 1
    feToday += run.fe
    timeToday += durationOf(run.start, run.end, now)
    const worth = tracker.valueOfRun(run).gross
    if (worth > bestWorth) {
      best = run
      bestWorth = worth
    }
  }

  const last = runs[runs.length - 1] ?? null
  return {
    runsToday,
    feToday,
    fePerHour: perHour(feToday, timeToday),
    bestRun: best === null ? null : summaryRun(tracker, best),
    lastRun: last === null ? null : summaryRun(tracker, last),
    feTotal,
    at: last === null ? 0 : last.end ?? now,
  }
}

/**
 * The tracker's status line (contract C1 of the dashboard plan).
 *
 * The line says what today's farming did and what the last run was; a tracker with no runs at
 * all has nothing to say. The numbers are the summary's, so the panel and the line can never
 * disagree.
 */
export function trackerStatus(state: SavedState, now = Date.now()): ToolStatus {
  const summary = sessionSummary(state, now)
  const parts: string[] = []
  if (summary.runsToday > 0) {
    parts.push(`${summary.runsToday} runs today`, `${summary.fePerHour.toFixed(1)} FE/h`)
  }
  if (summary.lastRun !== null) parts.push(`last: ${summary.lastRun.name}`)
  if (summary.feTotal > 0) parts.push(`${Math.round(summary.feTotal)} FE total`)
  return {
    id: 'tracker',
    line: parts.join(' · '),
    tone: summary.runsToday > 0 ? 'ok' : 'dim',
    at: summary.at,
  }
}
