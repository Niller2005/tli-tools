// How the numbers are written, and how wide the text is.
//
// The helpers here work on plain text: OpenTUI draws the colours itself, so nothing needs to
// carry escape sequences around any more.

/** A number with thousands separators: 1234567 -> "1,234,567". */
export function num(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** An amount of FE: "1,234.5 FE". */
export function fe(n: number): string {
  return `${num(n)} FE`
}

/** A big number in few columns: 292224385 -> "292.2M", 61000 -> "61.0k", 840 -> "840". */
export function compact(value: number): string {
  const sign = value < 0 ? '-' : ''
  const n = Math.abs(value)
  if (n >= 1e9) return `${sign}${(n / 1e9).toFixed(1)}B`
  if (n >= 1e6) return `${sign}${(n / 1e6).toFixed(1)}M`
  if (n >= 1e4) return `${sign}${(n / 1e3).toFixed(1)}k`
  return `${sign}${num(n)}`
}

/** A unit price in FE, small ones keep their first digits: 533 -> "533 FE", 0.0003 -> "0.0003 FE". */
export function price(n: number): string {
  if (n >= 1 || n <= 0) return fe(n)
  const digits = Math.min(8, Math.max(2, 1 - Math.floor(Math.log10(n))))
  return `${Number(n.toFixed(digits)).toString()} FE`
}

/** A time: "3h 37m", "12m 04s", "45s". */
export function duration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m`
  if (m > 0) return `${m}m ${String(s).padStart(2, '0')}s`
  return `${s}s`
}

/** A time of day, as the clock has it: "21:28:06". */
export function clock(ms: number): string {
  const d = new Date(ms)
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

/** Whether a character is a combining mark, which takes no space of its own. */
function isCombining(code: number): boolean {
  return (
    (code >= 0x0300 && code <= 0x036f) ||
    (code >= 0x1ab0 && code <= 0x1aff) ||
    (code >= 0x1dc0 && code <= 0x1dff) ||
    (code >= 0x20d0 && code <= 0x20ff) ||
    (code >= 0xfe20 && code <= 0xfe2f)
  )
}

/** Whether a character takes two terminal columns. */
function isWide(code: number): boolean {
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe10 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6) ||
    (code >= 0x1f300 && code <= 0x1faff)
  )
}

/** The number of terminal columns a string takes. */
export function visibleLength(text: string): number {
  let visible = 0
  let at = 0
  while (at < text.length) {
    const code = text.codePointAt(at) ?? 0
    if (!isCombining(code)) visible += isWide(code) ? 2 : 1
    at += code > 0xffff ? 2 : 1
  }
  return visible
}

/** Cuts text to a width. */
export function clip(text: string, width: number): string {
  if (width <= 0) return ''

  let out = ''
  let visible = 0
  let at = 0
  while (at < text.length) {
    const code = text.codePointAt(at) ?? 0
    const charWidth = isCombining(code) ? 0 : isWide(code) ? 2 : 1
    if (visible + charWidth > width) break
    out += String.fromCodePoint(code)
    visible += charWidth
    at += code > 0xffff ? 2 : 1
  }
  return out
}

/** Cuts text to a width and pads it on the right. */
export function pad(text: string, width: number): string {
  if (width <= 0) return ''
  const cut = clip(text, width)
  const gap = width - visibleLength(cut)
  return gap > 0 ? `${cut}${' '.repeat(gap)}` : cut
}

/** Cuts text to a width and pads it on the left. */
export function padStart(text: string, width: number): string {
  if (width <= 0) return ''
  const cut = clip(text, width)
  const gap = width - visibleLength(cut)
  return gap > 0 ? `${' '.repeat(gap)}${cut}` : cut
}

/** Fits text in a width, with an ellipsis when it is too long. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (visibleLength(text) <= width) return text
  if (width === 1) return '…'
  return `${clip(text, width - 1)}…`
}

/** Fits text in a width, keeping its end and marking that the beginning was cut. */
export function fitEnd(text: string, width: number): string {
  if (width <= 0) return ''
  if (visibleLength(text) <= width) return text
  if (width === 1) return '…'
  const chars = Array.from(text)
  return `…${chars.slice(-(width - 1)).join('')}`
}
