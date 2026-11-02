// The card Vorax puts on the overlay: the move, why, and the best other options.
import { type Card, toCardTone } from '@tli/overlay'
import { moveOf, optionBlocks, phaseName, type ViewState } from './view'

/** The card for the board on show; null when there is no board, so nothing is drawn over the game. */
export function cardOf(v: ViewState): Card | null {
  const b = v.board
  if (!b) return null
  const move = moveOf(v)
  const block = optionBlocks(v).find(x => x.rows.length > 0)
  const lines = block
    ? [
        { text: block.heading, tone: 'dim' as const },
        ...block.rows.map(r => ({ text: r.cells.map(c => c.text).join('  ') })),
      ]
    : []
  return {
    tool: 'vorax',
    title: `Vorax · round ${b.round} · ${phaseName(b.phase)}`,
    head: move.text,
    headTone: toCardTone(move.tone),
    basis: move.basis || undefined,
    lines,
  }
}
