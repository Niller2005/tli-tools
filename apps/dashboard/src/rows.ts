// The pieces of the dashboard's rows: the line of one tool in the list, and the lines of a panel.
// The fitting is here so the screen only places the result.

import type { TextChunk } from '@opentui/core'
import type { MinigameState } from '@tli/gamelog'
import type { Tool } from '@tli/launch'
import { chip, chunksWidth, fit, pad, tone, visibleLength, type Tone } from '@tli/tui'

/** How a minigame's state is shown. */
const BADGE: Record<MinigameState, [string, Tone]> = {
  open: ['● open', 'green'],
  closed: ['○ closed', 'dim'],
  unknown: ['? unknown', 'dim'],
}

/** One tool, as the list shows it. */
export interface ToolRow {
  /** the tool itself */
  tool: Tool
  /** whether the cursor is on it */
  current: boolean
  /** whether it is picked */
  selected: boolean
  /** the programs it needs that are not installed */
  missing: string[]
  /** the minigame's state, when the tool has one */
  badge: [MinigameState, string | null] | null
  /** whether the tool opens by itself when its minigame opens */
  auto: boolean
  /** the tool's status line, when it says something the badge does not */
  line: { text: string; tone: Tone } | null
}

/** One row of a panel: a label and what it says. */
export interface PanelRow {
  /** what the value is about; '' for a blank line */
  label: string
  /** the value itself: one string, or pieces that each carry their own colour */
  value: string | TextChunk[]
  /** how a value written as one string is drawn */
  tone?: Tone
  /** how the label is drawn; dim unless the label is itself a name */
  labelTone?: Tone
}

/** The pieces of one tool's line. */
export function toolRowChunks(row: ToolRow, width: number): TextChunk[] {
  // the cursor is told in the accent colour, the picked tools by their green checkbox, the
  // names in blue; the badge and the auto mark are chips, and what does not fit is left out
  const chunks = [
    tone(row.current ? 'accent' : 'default', row.current ? '>' : ' '),
    tone('default', ' '),
    tone(row.selected ? 'green' : 'dim', row.selected ? '[x]' : '[ ]'),
    tone('default', ' '),
    tone('blue', row.tool.name),
  ]
  // what is left of the row, after what has been drawn already
  const room = () => width - chunksWidth(chunks)
  // a group of chunks with the two columns of quiet space that separate it from the last
  const fits = (...group: TextChunk[]) => 2 + chunksWidth(group) <= room()

  if (row.missing.length > 0) {
    const text = fit(`needs ${row.missing.join(', ')}`, Math.max(0, room() - 2))
    if (text !== '') chunks.push(tone('default', '  '), tone('red', text))
  }
  // the badge, the log's hint, the auto mark and the tool's own line. When they do not all
  // fit, the line is kept ahead of the hint and the auto mark: the bar and the log panel say
  // the hint's news, and the options and the message say the auto mark's.
  let badge: TextChunk | null = null
  let hint: TextChunk | null = null
  if (row.badge !== null) {
    const [state, logHint] = row.badge
    const [text, style] = BADGE[state]
    badge = chip(text, style)
    if (logHint !== null) hint = tone('dim', `  ${logHint}`)
  }
  const auto = row.auto ? chip('⟳ auto', 'purple') : null
  const line = row.line

  if (badge !== null && fits(badge)) chunks.push(tone('default', '  '), badge)

  const hintWidth = hint === null ? 0 : chunksWidth([hint])
  const autoWidth = auto === null ? 0 : 2 + chunksWidth([auto])
  const lineWidth = line === null ? 0 : 2 + visibleLength(line.text)
  const spare = room()
  const hintIn = hint !== null && (line === null ? hintWidth <= spare : hintWidth + autoWidth + lineWidth <= spare)
  const autoIn =
    auto !== null &&
    (line === null
      ? autoWidth <= spare - (hintIn ? hintWidth : 0)
      : autoWidth + lineWidth <= spare - (hintIn ? hintWidth : 0))
  if (hintIn && hint !== null) chunks.push(hint)
  if (autoIn && auto !== null) chunks.push(tone('default', '  '), auto)

  if (line !== null) {
    const text = fit(line.text, Math.max(0, room() - 2))
    if (text !== '') chunks.push(tone('default', '  '), tone(line.tone, text))
  }

  return chunks
}

/** The lines of one panel: a quiet label, and a value in the colour of what it says. */
export function panelChunks(rows: PanelRow[], width: number): TextChunk[] {
  const labelWidth = Math.min(14, Math.max(0, ...rows.map(row => visibleLength(row.label))))
  const chunks: TextChunk[] = []
  for (const row of rows) {
    if (row.label === '') {
      chunks.push(tone('default', '\n'))
      continue
    }
    const room = Math.max(0, width - labelWidth - 2)
    // a value of pieces keeps its colours while it fits; one that does not becomes a plain
    // line, cut to the room the panel has
    const value =
      typeof row.value === 'string'
        ? [tone(row.tone ?? 'default', fit(row.value, room))]
        : chunksWidth(row.value) <= room
          ? row.value
          : [tone(row.tone ?? 'default', fit(row.value.map(chunk => chunk.text).join(''), room))]
    chunks.push(tone(row.labelTone ?? 'dim', pad(row.label, labelWidth + 2)), ...value, tone('default', '\n'))
  }
  return chunks
}
