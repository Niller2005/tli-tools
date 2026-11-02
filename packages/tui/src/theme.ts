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
  /** the bars along the top and the bottom, and the keys in the hints */
  surface: string
  /** the key caps in the hints */
  keycap: string
  /** the ordinary text */
  text: string
  /** the quiet text: labels, hints and paths */
  dim: string
  /** the main accent: the focus, the marker of the selected row */
  accent: string
  /** the brand: the name of the tool in the bar along the top */
  brand: string
  /** money: FE amounts */
  gold: string
  /** what is on, or what made a profit */
  green: string
  /** what is a warning */
  yellow: string
  /** what is wrong */
  red: string
  /** a name, a thing that can be opened */
  blue: string
  /** a rare thing: experience, a special state */
  purple: string
  /** heat and effort: a run that is on, a count that grows */
  orange: string
  /** a calm second accent: times, a quiet success */
  teal: string
  /** a loud second accent: a mark that should not be missed */
  pink: string
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
  background: '#0f1115',
  surface: '#171a21',
  keycap: '#2a303b',
  text: '#d8dce3',
  dim: '#8a919e',
  accent: '#54d1e0',
  brand: '#f0944d',
  gold: '#e8c06a',
  green: '#7ec97e',
  yellow: '#d7b25a',
  red: '#e06c75',
  blue: '#6cb2f5',
  purple: '#c29bf0',
  orange: '#ef8f4a',
  teal: '#4fd1b5',
  pink: '#ee8fb8',
  border: '#454c59',
  borderFocused: '#54d1e0',
  panelTitle: '#e6e6e6',
  selection: '#2b4352',
  scrollTrack: '#232731',
  scrollThumb: '#5b6370',
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
  | 'brand'
  | 'gold'
  | 'green'
  | 'yellow'
  | 'red'
  | 'blue'
  | 'purple'
  | 'orange'
  | 'teal'
  | 'pink'
  | 'key'
  | 'paused'

const BOLD = TextAttributes.BOLD
const INVERSE = TextAttributes.INVERSE

/** The colour a tone is written in; `undefined` for the tones that are not a colour of their own. */
export function toneColor(style: Tone | undefined): string | undefined {
  switch (style) {
    case 'dim':
      return theme.dim
    case 'accent':
    case 'cyan':
      return theme.accent
    case 'brand':
      return theme.brand
    case 'gold':
      return theme.gold
    case 'green':
      return theme.green
    case 'yellow':
    case 'paused':
      return theme.yellow
    case 'red':
      return theme.red
    case 'blue':
      return theme.blue
    case 'purple':
      return theme.purple
    case 'orange':
      return theme.orange
    case 'teal':
      return theme.teal
    case 'pink':
      return theme.pink
    default:
      return undefined
  }
}

/** A piece of text in one of the tools' colours. */
export function tone(style: Tone | undefined, text: string): TextChunk {
  if (text === '' || !colorEnabled()) return { __isChunk: true, text }
  switch (style) {
    case 'bold':
      return { __isChunk: true, text, fg: color(theme.text), attributes: BOLD }
    case 'key':
      return { __isChunk: true, text, fg: color(theme.text), bg: color(theme.keycap), attributes: BOLD }
    case 'paused':
      return { __isChunk: true, text, fg: color(theme.yellow), attributes: INVERSE }
    case 'accent':
    case 'brand':
    case 'gold':
    case 'green':
      return { __isChunk: true, text, fg: color(toneColor(style) ?? theme.text), attributes: BOLD }
    case 'dim':
    case 'cyan':
    case 'yellow':
    case 'red':
    case 'blue':
    case 'purple':
    case 'orange':
    case 'teal':
    case 'pink':
      return { __isChunk: true, text, fg: color(toneColor(style) ?? theme.text) }
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
