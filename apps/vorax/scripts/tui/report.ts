// The advice as plain text.
//
// The screen draws the advice in colour; this prints the same advice as plain text, for a bug
// report, a screenshot's advice or a terminal that cannot draw. It is the same rows the screen
// draws, without the colours.

import { num, rowText } from '@tli/tui'
import { boardOf, moveOf, optionBlocks, type ViewState } from './view'

/** The advice as plain text, one line each. */
export function reportLines(v: ViewState, width = 100): string[] {
  const out: string[] = []
  const rule = () => out.push('─'.repeat(Math.max(10, width - 1)))

  out.push(`Vorax Helper · Linux terminal   target ${num(v.target)}`)
  out.push(`game: ${v.capture}`)
  out.push(`log:  ${v.log}${v.logLines > 0 ? ` (${v.logLines} lines read)` : ''} · ${v.pictures} pictures read`)
  rule()

  const b = v.board
  if (!b) {
    out.push(moveOf(v).text)
  } else {
    const board = boardOf(v)
    out.push(board.heading)
    out.push('')
    const move = moveOf(v)
    out.push(move.tone === 'green' ? `  ${move.text}` : move.text)
    if (move.basis !== '') out.push(`  ${move.basis}`)
    out.push('')
    for (const block of optionBlocks(v)) {
      if (block.heading !== '') out.push(block.heading)
      for (const row of block.rows) out.push(rowText(row, width - 2))
    }
    for (const warning of board.warnings) out.push(`! ${warning}`)
    out.push('')
    out.push('Board')
    for (const row of board.rows) out.push(rowText(row, width - 2))
  }

  out.push('')
  rule()
  out.push(`r read now · t target · d deep check ${v.deepOn ? 'on' : 'off'} · q quit`)
  if (v.status !== '' && b !== null) out.push(v.status)
  return out
}
