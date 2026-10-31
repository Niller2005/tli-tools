// How a row of a table is laid out.
//
// A row is a list of cells. The cells with a fixed width keep it; the others share what is left.
// The row that is picked out is marked and put on the background of the selection.
//
// The rows are plain data, so they can be looked at without a terminal.

import type { TextChunk } from '@opentui/core'
import { clip, fit, pad, padStart, visibleLength } from './format'
import { theme, tone, toneOn, type Tone } from './theme'

/** One piece of a row. */
export interface Cell {
  /** the text of the cell */
  text: string
  /** the colour of the cell */
  tone?: Tone
  /** a fixed width in columns; a cell without one shares what is left */
  width?: number
  /** which way the text sits in its width */
  align?: 'left' | 'right'
}

/** A row of a table. */
export interface Row {
  /** the cells of the row, from left to right */
  cells: Cell[]
  /** whether this is the row that is picked out */
  selected?: boolean
}

/** The marker in front of the row that is picked out. */
export const MARKER = '▸'

/** The width the marker takes up. */
const MARKER_WIDTH = 2

/** The gap between two cells. */
const GAP = 2

/** The cells of a row, laid out in `inner` columns. */
export function rowChunks(row: Row, inner: number): TextChunk[] {
  const count = row.cells.length
  const gaps = Math.max(0, count - 1) * GAP
  const available = Math.max(0, inner - MARKER_WIDTH - gaps)

  const widths = row.cells.map((cell) => cell.width ?? 0)
  const loose = row.cells.map((cell) => cell.width === undefined)
  const fixedTotal = widths.reduce((sum, width, index) => (loose[index] === true ? sum : sum + width), 0)
  const looseCount = loose.filter(Boolean).length
  const minimumLoose = looseCount === 0 ? 0 : Math.min(8, available)
  let overflow = fixedTotal - (available - minimumLoose)

  for (let index = widths.length - 1; index >= 0 && overflow > 0; index -= 1) {
    if (loose[index] === true) continue
    const shrink = Math.min(overflow, Math.max(0, (widths[index] ?? 0) - 1))
    widths[index] = (widths[index] ?? 0) - shrink
    overflow -= shrink
  }

  let looseRoom = Math.max(0, available - widths.reduce((sum, width) => sum + width, 0))
  const chunks: TextChunk[] = []
  const selected = row.selected === true

  for (let index = 0; index < count; index += 1) {
    const cell = row.cells[index]
    if (cell === undefined) continue
    let width = widths[index] ?? 0
    if (cell.width === undefined) {
      width = looseCount === 0 ? 0 : Math.floor(looseRoom / looseCount)
      looseRoom -= width
    }
    const text =
      cell.align === 'right'
        ? padStart(cell.text, width)
        : cell.width === undefined
          ? pad(fit(cell.text, width), width)
          : clip(cell.text, width)
    chunks.push(selected ? toneOn(cell.tone, text, theme.selection) : tone(cell.tone, text))
    if (index < count - 1) {
      const gap = ' '.repeat(GAP)
      chunks.push(selected ? toneOn('default', gap, theme.selection) : tone('default', gap))
    }
  }

  const marker = selected ? `${MARKER} ` : '  '
  chunks.unshift(selected ? toneOn('accent', marker, theme.selection) : tone('default', marker))

  const used = chunks.reduce((sum, chunk) => sum + visibleLength(chunk.text), 0)
  const last = chunks[chunks.length - 1]
  if (last !== undefined && inner > used) {
    last.text = `${last.text}${' '.repeat(inner - used)}`
  }
  return chunks
}

/** The plain text of a row, without the colours. */
export function rowText(row: Row, inner: number): string {
  return rowChunks(row, inner)
    .map((chunk) => chunk.text)
    .join('')
}

/** How wide the widest text of a list of rows is. */
export function widest(rows: Row[]): number {
  let width = 0
  for (const row of rows) {
    for (const cell of row.cells) width = Math.max(width, visibleLength(cell.text))
  }
  return width
}

/** The width a column of numbers needs. */
export function numberWidth(values: number[]): number {
  let width = 0
  for (const value of values) width = Math.max(width, visibleLength(String(value)))
  return width
}

/** The width a column of text needs. */
export function textWidth(values: string[]): number {
  let width = 0
  for (const value of values) width = Math.max(width, visibleLength(value))
  return width
}
