//! The card Warden puts on the overlay: the move, why, and the best other moves.

import { type Card, type Rect } from '@tli/overlay'
import { dayText, moveName, type ViewState } from './view'

/** The card for the board on show; null when there is no board, so nothing is drawn over the game. */
export function cardOf(state: ViewState, mark: Rect | null = null): Card | null {
  if (state.model === null) return null
  const title = state.day !== null ? `Warden · ${dayText(state.day)}` : 'Warden'
  const advice = state.advice
  return {
    tool: 'warden',
    title,
    head: advice !== null ? moveName(advice.action, advice.label) : state.solving ? 'working it out…' : 'no move',
    headTone: advice !== null ? 'green' : 'dim',
    basis: advice?.why ?? undefined,
    marks: mark === null ? undefined : [mark],
    lines: state.ranking.map(r => ({ text: `${r.rank}. ${r.mean}  ${r.label}`, tone: r.chosen ? 'green' : undefined })),
  }
}
