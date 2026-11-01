// The status the dashboard shows, gathered from the packages that know.
//
// The dashboard plan (docs/plan-dashboard.md) has the packages say what they know as plain
// objects — contract C1 for the lines, C2 for the log and the capture — and the dashboard only
// draws them. Everything here is read on the 1 s tick, away from the drawing: the log's health
// and the saved states are small files, and a read that is slow only delays the next tick, never
// a frame.

import { historyOf, load, arcanaStatus } from '@tli/arcana'
import { logHealth, minigameStatus, type LogHealth, type MinigameView, type ToolStatus } from '@tli/gamelog'
import { captureStatus, type CaptureStatus, type CaptureStatusOptions } from '@tli/capture'
import { TOOLS, type RunningEntry } from '@tli/launch'
import {
  Tracker,
  baselineAge,
  loadTracker,
  readBaseline,
  sessionSummary,
  trackerStatus,
  type SessionSummary,
} from '@tli/tracker'

/** Everything the dashboard draws beside and under the tool list. */
export interface StatusData {
  /** each tool's contract-C1 line, by the tool's id; a tool with nothing to say is left out */
  lines: Record<string, ToolStatus>
  /** what the player has been doing, from the tracker's saved state */
  summary: SessionSummary
  /** the log's health: where it is, how big, how fresh, whether the game writes its own lines */
  health: LogHealth
  /** what a capture would do right now, without taking any picture */
  capture: CaptureStatus
  /** how old the community prices on disk are, in ms; null when there are none */
  baselineAge: number | null
  /** how old the shipped item-name table is, in ms; null when it does not say */
  itemAge: number | null
  /** the tools the launcher has opened, running or ended */
  running: RunningEntry[]
  /** when all of this was read, in ms since the epoch */
  at: number
}

/** The status before anything was read: the panels say that they are waiting. */
export function emptyStatus(): StatusData {
  return {
    lines: {},
    summary: sessionSummary(new Tracker().snapshot(), 0),
    health: { path: null, size: 0, modifiedAt: null, detail: 'missing' },
    capture: { tools: [], noCapture: false, path: 'none' },
    baselineAge: null,
    itemAge: null,
    running: [],
    at: 0,
  }
}

/** What the status is read from; the paths and the capture options are the tests' to choose. */
export interface StatusInputs {
  /** what the game's log says about the minigames, as the dashboard's watcher tells it */
  view: MinigameView | null
  /** the launcher the dashboard opens windows with */
  launcher: { list(): RunningEntry[] }
  /** the log the dashboard was told to watch, when it was told one */
  log?: string | null
  /** how old the item-name table is, read once by the caller (it changes only with the repo) */
  itemAge?: number | null
  /** where the saved states and the prices are; the tools' own places by default */
  paths?: { tracker?: string; arcana?: string; baseline?: string }
  /** the options `captureStatus` is asked with; the machine's own by default */
  capture?: CaptureStatusOptions
}

/**
 * Reads everything the panels show, from the packages that know it.
 *
 * The tracker's and Arcana's lines come from their saved state, so a tracker that has never run
 * says nothing rather than failing: an empty state is read off a fresh `Tracker`. The Vorax and
 * Warden lines are the minigame states the watcher already keeps — a package that says something
 * about its own tool wins over the minigame's bare state. Nothing reads the log's new lines and
 * nothing takes a picture.
 */
export async function readStatus(inputs: StatusInputs, now = Date.now()): Promise<StatusData> {
  const saved = await loadTracker(inputs.paths?.tracker)
  const trackerState = saved?.tracker ?? new Tracker().snapshot()
  const history = historyOf(await load(inputs.paths?.arcana))
  const baseline = await readBaseline(inputs.paths?.baseline)

  const lines: Record<string, ToolStatus> = {
    tracker: trackerStatus(trackerState, now),
    arcana: arcanaStatus(history),
  }
  if (inputs.view !== null) {
    for (const tool of TOOLS) {
      if (tool.game === undefined) continue
      if (lines[tool.id] !== undefined) continue
      lines[tool.id] = minigameStatus(tool.game, { state: inputs.view[tool.game], at: null })
    }
  }

  return {
    lines,
    summary: sessionSummary(trackerState, now),
    health: logHealth(inputs.log ?? undefined),
    capture: captureStatus(inputs.capture ?? {}),
    baselineAge: baselineAge(baseline, now),
    itemAge: inputs.itemAge ?? null,
    running: inputs.launcher.list(),
    at: now,
  }
}
