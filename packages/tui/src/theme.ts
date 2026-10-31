// The colours the tools use, and how to turn them off.
//
// Every terminal app in this repo draws with the same palette, so the colours live here and the
// apps ask for a tone by name instead of picking a colour of their own.
//
// The colours can be turned off with `--no-color` or with the `NO_COLOR` environment variable.
// When they are off the text is drawn in the terminal's own colours: no colour, no bold, no dim.

import { RGBA, TextAttributes, type TextChunk } from '@opentui/core'

/** The colours of the tools. */
export interface Theme {
  /** the background of the screen */
  background: string
  /** the ordinary text */
  text: string
  /** the quiet text: labels, hints and paths */
  dim: string
  /** the main accent: titles, the marker of the selected row */
  accent: string
  /** money: FE amounts */
  gold: string
  /** what is on, or what made a profit */
  green: string
  /** what is a warning */
  yellow: string
  /** what is wrong */
  red: string
  /** the border of a panel that does not have the focus */
  border: string
  /** the border of the panel that has the focus */
  borderFocused: string
  /** the title of a panel */
  panelTitle: string
  /** the background of the row that is picked out */
  selection: string
  /** the track of a scrollbar */
  scrollTrack: string
  /** the thumb of a scrollbar */
  scrollThumb: string
}

/** The colours of the tools. */
export const theme: Theme = {
  background: '#101010',
  text: '#d4d4d4',
  dim: '#8b8b8b',
  accent: '#54d1e0',
  gold: '#e8c06a',
  green: '#7ec97e',
  yellow: '#d7b25a',
  red: '#e06c75',
  border: '#585858',
  borderFocused: '#54d1e0',
  panelTitle: '#e6e6e6',
  selection: '#2f4653',
  scrollTrack: '#333333',
  scrollThumb: '#6f6f6f',
}

let colorOverride: boolean | undefined

/** Turns the colours off (or back on when `enabled` is undefined). */
export function setColorEnabled(enabled: boolean | undefined): void {
  colorOverride = enabled
}

/** Whether the text should be coloured. */
export function colorEnabled(): boolean {
  if (colorOverride !== undefined) return colorOverride
  return process.env.NO_COLOR === undefined
}

const colors = new Map<string, RGBA>()

/** The colour, ready to be used. */
export function color(hex: string): RGBA {
  let value = colors.get(hex)
  if (value === undefined) {
    value = RGBA.fromHex(hex)
    colors.set(hex, value)
  }
  return value
}

/** The colour the terminal uses when nothing else is asked for. */
export function defaultForeground(): RGBA {
  return RGBA.defaultForeground()
}

/** The background the terminal uses when nothing else is asked for. */
export function defaultBackground(): RGBA {
  return RGBA.defaultBackground()
}

/** The ways the tools write text. */
export type Tone =
  | 'default'
  | 'dim'
  | 'bold'
  | 'accent'
  | 'cyan'
  | 'gold'
  | 'green'
  | 'yellow'
  | 'red'
  | 'paused'

const BOLD = TextAttributes.BOLD
const INVERSE = TextAttributes.INVERSE

/** A piece of text in one of the tools' colours. */
export function tone(style: Tone | undefined, text: string): TextChunk {
  if (text === '' || !colorEnabled()) return { __isChunk: true, text }
  switch (style) {
    case 'dim':
      return { __isChunk: true, text, fg: color(theme.dim) }
    case 'bold':
      return { __isChunk: true, text, fg: color(theme.text), attributes: BOLD }
    case 'accent':
      return { __isChunk: true, text, fg: color(theme.accent), attributes: BOLD }
    case 'cyan':
      return { __isChunk: true, text, fg: color(theme.accent) }
    case 'gold':
      return { __isChunk: true, text, fg: color(theme.gold), attributes: BOLD }
    case 'green':
      return { __isChunk: true, text, fg: color(theme.green), attributes: BOLD }
    case 'yellow':
      return { __isChunk: true, text, fg: color(theme.yellow) }
    case 'red':
      return { __isChunk: true, text, fg: color(theme.red) }
    case 'paused':
      return { __isChunk: true, text, fg: color(theme.yellow), attributes: INVERSE }
    default:
      return { __isChunk: true, text, fg: color(theme.text) }
  }
}

/** The same piece of text, on the background of the row that is picked out. */
export function toneOn(style: Tone | undefined, text: string, background: string): TextChunk {
  const piece = tone(style, text)
  if (!colorEnabled()) return piece
  return { ...piece, bg: color(background) }
}

/** The colour of the border of a panel. */
export function borderColor(focused: boolean): RGBA {
  if (!colorEnabled()) return defaultForeground()
  return color(focused ? theme.borderFocused : theme.border)
}

/** The colour of the text of a piece of text. */
export function textColor(): RGBA {
  if (!colorEnabled()) return defaultForeground()
  return color(theme.text)
}

/** The colour behind the screen. */
export function backgroundColor(): RGBA {
  if (!colorEnabled()) return defaultBackground()
  return color(theme.background)
}

/** The colour of the title of a panel. */
export function titleColor(focused: boolean): RGBA {
  if (!colorEnabled()) return defaultForeground()
  return color(focused ? theme.accent : theme.dim)
}
