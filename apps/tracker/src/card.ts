// The card the tracker puts over the game: the run that is going on, or the last one when none is, and the session's pace.
import type { Card } from '@tli/overlay'
import type { Tracker } from '@tli/tracker'
import { duration, fe, num } from '@tli/tui'
import { lootRows } from './view'

/** How many items of the run's loot the card lists. */
const ITEMS = 8

/** A pace over less than this is noise, so the card does not show it. */
const PACE_AFTER_MS = 60_000

/** The card for a bottom corner; null while the tracker has not seen a run, so nothing is drawn over the game. */
export function lootCard(tracker: Tracker, corner: NonNullable<Card['corner']>, now = Date.now()): Card | null {
  const going = tracker.currentRun
  const run = going ?? tracker.runs.at(-1) ?? null
  if (run === null) return null
  const worth = tracker.valueOfRun(run).gross
  const took = Math.max(0, (run.end ?? now) - run.start)
  const basis = [duration(took)]
  if (took >= PACE_AFTER_MS) basis.push(`${fe(Math.round(worth / (took / 3_600_000)))}/h`)
  const session = tracker.session === null ? null : tracker.sessionTotals(tracker.session.id, now)
  const pace = session !== null && session.runs > 0 ? [{ text: `Session  ${num(session.fePerHour)} FE/h · ${session.runs} runs`, tone: 'gold' as const }] : []
  if (run.fe > 0) basis.push(`${fe(run.fe)} picked up`)
  return {
    tool: 'tracker',
    corner,
    title: `${going === null ? 'Last run' : 'Current run'} · ${run.name}`,
    head: fe(worth),
    headTone: 'gold',
    basis: basis.join(' · '),
    lines: [...pace, ...lootRows(tracker, run.loot)
      .slice(0, ITEMS)
      .map((row) => ({ text: `${num(row.qty)}× ${row.name}  ${fe(row.worth)}` }))],
  }
}
