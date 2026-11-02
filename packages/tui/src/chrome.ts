// The small pieces of design the tools share: the bar along the top, the keys at the bottom, the
// chips, the meters and the border of a panel.
//
// They are built from the tones in `theme.ts`, so they follow the palette and turn plain when the
// colours are off: a chip becomes `[text]`, a key hint becomes `key label`, and a focused panel is
// still told apart by its heavy border.

import type { RGBA, TextChunk } from '@opentui/core'
import { clip, fitEnd, visibleLength } from './format'
import { color, colorEnabled, defaultBackground, theme, tone, toneColor, type Tone } from './theme'

/** The red, green and blue of a colour written as `#rrggbb`. */
function channels(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]
}

/** A colour between two others: `amount` 0 is `from`, 1 is `to`. */
export function mix(from: string, to: string, amount: number): string {
  const a = channels(from)
  const b = channels(to)
  const part = (index: 0 | 1 | 2): string =>
    Math.round(a[index] + (b[index] - a[index]) * amount)
      .toString(16)
      .padStart(2, '0')
  return `#${part(0)}${part(1)}${part(2)}`
}

/** The colour of the bars along the top and the bottom. */
export function surfaceColor(): RGBA {
  if (!colorEnabled()) return defaultBackground()
  return color(theme.surface)
}

/** The border of a panel: heavy when it has the focus, so it shows even without colours. */
export function panelBorderStyle(focused: boolean): 'rounded' | 'heavy' {
  return focused ? 'heavy' : 'rounded'
}

/** The title of a panel. `focused` adds a dot in front of it: filled when the panel has the focus. */
export function panelTitle(text: string, focused?: boolean): string {
  if (focused === undefined) return ` ${text} `
  return focused ? ` ● ${text} ` : ` ○ ${text} `
}

/** A short label with a background of its own: a switch, a state. Plain `[text]` without colours. */
export function chip(text: string, style: Tone): TextChunk {
  if (!colorEnabled()) return { __isChunk: true, text: `[${text}]` }
  const base = toneColor(style)
  if (base === undefined) return tone(style, ` ${text} `)
  return {
    __isChunk: true,
    text: ` ${text} `,
    fg: color(base),
    bg: color(mix(theme.background, base, 0.2)),
    attributes: 1,
  }
}

/** A key and what it does: the key on a cap, the label quiet. */
export function keyHint(key: string, label: string): TextChunk[] {
  if (!colorEnabled()) return [tone('default', `${key} ${label}`)]
  return [tone('key', ` ${key} `), tone('dim', label)]
}

/** A row of key hints with a gap between them. */
export function hintChunks(hints: readonly (readonly [string, string])[]): TextChunk[] {
  const gap = tone('default', colorEnabled() ? '   ' : '  ')
  const chunks: TextChunk[] = []
  hints.forEach(([key, label], index) => {
    if (index > 0) chunks.push(gap)
    chunks.push(...keyHint(key, label))
  })
  return chunks
}

/** A label with its value: the label quiet, the value in a tone. */
export function stat(label: string, value: string, style: Tone = 'accent'): TextChunk[] {
  return [tone('dim', `${label} `), tone(style, value)]
}

/** The name of a tool, the way the bar along the top shows it. */
export function brandChunks(name: string, sub = ''): TextChunk[] {
  const chunks = [tone('brand', '◆ '), tone('brand', name)]
  if (sub !== '') chunks.push(tone('dim', `  ${sub}`))
  return chunks
}

/** The tone of a change: green when it went up, red when it went down, quiet when it did not move. */
export function signTone(value: number): Tone {
  if (value > 0) return 'green'
  if (value < 0) return 'red'
  return 'dim'
}

/** A line that fills `fraction` of `width` columns: a progress bar. */
export function meter(fraction: number, width: number, style: Tone = 'accent'): TextChunk[] {
  const cells = Math.max(0, Math.floor(width))
  const filled = Math.min(cells, Math.max(0, Math.round(Math.min(1, Math.max(0, fraction)) * cells)))
  const full = '━'.repeat(filled)
  const rest = '─'.repeat(cells - filled)
  if (!colorEnabled()) return [{ __isChunk: true, text: full + rest }]
  const chunks: TextChunk[] = []
  if (full !== '') chunks.push({ __isChunk: true, text: full, fg: color(toneColor(style) ?? theme.text) })
  if (rest !== '') chunks.push({ __isChunk: true, text: rest, fg: color(theme.border) })
  return chunks
}

const SPARKS = '▁▂▃▄▅▆▇█'

/** The values as a row of bars, scaled to the highest of them. */
export function sparkline(values: readonly number[], style: Tone = 'accent'): TextChunk {
  const top = Math.max(0, ...values)
  const text = values
    .map((value) => {
      if (top <= 0 || value <= 0) return SPARKS[0]
      return SPARKS[Math.min(SPARKS.length - 1, Math.max(0, Math.ceil((value / top) * SPARKS.length) - 1))]
    })
    .join('')
  return tone(style, text)
}

/** The width of a list of chunks. */
export function chunksWidth(chunks: readonly TextChunk[]): number {
  return chunks.reduce((sum, chunk) => sum + visibleLength(chunk.text), 0)
}

/** A line of pieces, cut to `width` columns so it never runs past the edge of the terminal. */
export function cutChunks(parts: readonly TextChunk[], width: number): TextChunk[] {
  if (chunksWidth(parts) <= width) return [...parts]
  const out: TextChunk[] = []
  let left = width
  for (const part of parts) {
    if (left <= 0) break
    const piece = visibleLength(part.text)
    if (piece <= left) {
      out.push(part)
      left -= piece
    } else {
      out.push({ ...part, text: clip(part.text, left) })
      left = 0
    }
  }
  return out
}

/** The bar along the top: the tool's name, the quieter text after it, and the chips after that. */
export interface TopBar {
  /** the tool's name, as the bar shows it */
  name: string
  /** quieter text after the name (what the tool is for, or where its data comes from) */
  sub?: string
  /** the chips after the sub, most important first */
  chips?: readonly (readonly [string, Tone])[]
}

/**
 * The bar along the top, never wider than `width`. What shrinks first is decided here, once: the
 * sub is cut from the front (its end is the part worth reading), then the chips are left out from
 * the end, and the tool's name is cut last.
 */
export function topBarChunks(bar: TopBar, width: number): TextChunk[] {
  const chunks = brandChunks(bar.name)
  const room = () => width - chunksWidth(chunks)
  if (bar.sub !== undefined && bar.sub !== '') {
    const space = Math.max(0, room() - 2)
    if (space > 0) chunks.push(tone('dim', `  ${fitEnd(bar.sub, space)}`))
  }
  for (const [label, style] of bar.chips ?? []) {
    const gap = tone('default', '  ')
    const flagged = chip(label, style)
    if (room() < visibleLength(gap.text) + visibleLength(flagged.text)) break
    chunks.push(gap, flagged)
  }
  return cutChunks(chunks, width)
}

/** The bar along the bottom: the keys, or a message when there is one. */
export interface FooterBar {
  /** the keys as [cap, label]; the first and the last are the last to go, so the menu key and the quit key survive */
  hints: readonly (readonly [string, string])[]
  /** when it is not '', it replaces the keys, the chips and the pieces after them */
  message?: string
  /** chips before the keys (an active filter), most important first */
  chips?: readonly (readonly [string, Tone])[]
  /** quiet pieces after the keys (a legend, an attribution), most important first */
  after?: readonly (readonly TextChunk[])[]
}

/**
 * The bar along the bottom, never wider than `width`. What shrinks first is decided here, once: a
 * message replaces the lot; otherwise the pieces after the keys go (from the end), then the keys
 * between the first and the last, then the chips before the keys, then the first key. The last key —
 * quit — is the last to go, and what still does not fit is cut.
 */
export function footerChunks(bar: FooterBar, width: number): TextChunk[] {
  if (bar.message !== undefined && bar.message !== '') return [tone('accent', clip(bar.message, width))]
  const gap = tone('default', '  ')
  const hints = [...bar.hints]
  const chips = (bar.chips ?? []).map(([label, style]) => chip(label, style))
  const after = [...(bar.after ?? [])]
  const render = (): TextChunk[] => {
    const chunks: TextChunk[] = []
    chips.forEach((flagged, index) => {
      if (index > 0) chunks.push(gap)
      chunks.push(flagged)
    })
    if (chips.length > 0 && hints.length > 0) chunks.push(gap)
    chunks.push(...hintChunks(hints))
    after.forEach((piece, index) => {
      if (index > 0 || chunks.length > 0) chunks.push(gap)
      chunks.push(...piece)
    })
    return chunks
  }
  let chunks = render()
  while (chunksWidth(chunks) > width) {
    if (after.length > 0) after.pop()
    else if (hints.length > 2) hints.splice(1, 1)
    else if (chips.length > 0) chips.pop()
    else if (hints.length > 1) hints.shift()
    else return cutChunks(chunks, width)
    chunks = render()
  }
  return chunks
}
