// The card the tracker puts over the game: the run that is going on, or the last one when none is, and the session's pace.
import type { Card, CardLine } from '@tli/overlay'
import type { RunTotals, Tracker } from '@tli/tracker'
import { duration, fe, fit, num } from '@tli/tui'
import { lootRows } from './view'

/** How many items of the run's loot the card lists. */
const ITEMS = 8

/** The longest session name the card shows. */
const SESSION_NAME = 24

/** What the card's pace lines add up: the named session going on, else the runs that started today. */
function sessionTotals(tracker: Tracker, now: number): (RunTotals & { label: string }) | null {
  if (tracker.session !== null) {
    const totals = tracker.sessionTotals(tracker.session.id, now)
    return totals === null ? null : { ...totals, label: `Session ${fit(tracker.session.name, SESSION_NAME)}` }
  }
  const day = new Date(now)
  day.setHours(0, 0, 0, 0)
  const runs = [...tracker.runs, ...(tracker.currentRun === null ? [] : [tracker.currentRun])].filter((run) => run.start >= day.getTime())
  return { ...tracker.totalsOf(runs, now), label: 'Today' }
}

/** The card for a bottom corner; null while the tracker has not seen a run, so nothing is drawn over the game. */
export function lootCard(tracker: Tracker, corner: NonNullable<Card['corner']>, now = Date.now()): Card | null {
  const going = tracker.currentRun
  const run = going ?? tracker.runs.at(-1) ?? null
  if (run === null) return null
  const worth = tracker.valueOfRun(run).gross
  const took = Math.max(0, (run.end ?? now) - run.start)
  const basis = [duration(took)]
  if (took > 0) basis.push(`${fe(Math.round(worth / (took / 3_600_000)))}/h`)
  const totals = sessionTotals(tracker, now)
  const pace: CardLine[] = []
  if (totals !== null && totals.runs > 0) {
    // like the run's own pace above, this is what the loot is worth, not only the FE that dropped as currency
    const perHour = totals.totalTime > 0 ? totals.lootValue / (totals.totalTime / 3_600_000) : 0
    pace.push(
      { text: `${totals.label} · ${totals.runs} runs · ${duration(totals.totalTime)}`, tone: 'gold' },
      { text: `${num(perHour)} FE/h · ${fe(totals.lootValue)} · ${num(totals.lootValue / totals.runs)}/run`, tone: 'gold' },
    )
  }
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
