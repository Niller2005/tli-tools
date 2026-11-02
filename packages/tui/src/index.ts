// The parts the terminal tools share.
//
// The colours, the way the numbers are written, the way a row of a table is laid out, and the
// helper that starts a renderer and always puts the terminal back.

export {
  brandChunks,
  chip,
  chunksWidth,
  cutChunks,
  footerChunks,
  hintChunks,
  keyHint,
  meter,
  mix,
  panelBorderStyle,
  panelTitle,
  signTone,
  sparkline,
  stat,
  surfaceColor,
  topBarChunks,
  type FooterBar,
  type TopBar,
} from './chrome'

export {
  backgroundColor,
  borderColor,
  color,
  colorEnabled,
  defaultBackground,
  defaultForeground,
  setColorEnabled,
  textColor,
  titleColor,
  theme,
  tone,
  toneColor,
  toneOn,
  type Theme,
  type Tone,
} from './theme'

export {
  clip,
  clock,
  duration,
  fe,
  fit,
  fitEnd,
  num,
  pad,
  price,
  padStart,
  visibleLength,
} from './format'

export { MARKER, numberWidth, rowChunks, rowText, textWidth, widest, type Cell, type Row } from './rows'

export { startApp, type App, type StartAppOptions } from './app'
