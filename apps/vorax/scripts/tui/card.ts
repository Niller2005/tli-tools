// The card Vorax puts on the overlay: the move, why, and the best other options.
import { type Card, type Rect, toCardTone } from '@tli/overlay'
import { stepBoxes } from './steps'
import { choiceOf, moveOf, optionBlocks, phaseName, type ViewState } from './view'

/** The boxes of the advised move on the screen, in the compositor's logical pixels. `area` is where the picture was
 * taken from; without it, or without a picture that still matches the screen, there is nothing to outline. */
function marksOf(v: ViewState, area: Rect | null): Rect[] | undefined {
  const place = v.board?.place
  const choice = choiceOf(v)
  if (!area || !place || !choice) return undefined
  const sx = area.width / place.width, sy = area.height / place.height
  const marks = stepBoxes(place, choice).map(b => ({ x: area.x + b.x * sx, y: area.y + b.y * sy, width: b.width * sx, height: b.height * sy }))
  return marks.length ? marks : undefined
}

/** The card for the board on show; null when there is no board, so nothing is drawn over the game. */
export function cardOf(v: ViewState, area: Rect | null = null): Card | null {
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
    marks: marksOf(v, area),
    lines,
  }
}
