// How the numbers are written.

/** A number with thousands separators: 1234567 -> "1,234,567". */
export function num(n: number): string {
  const rounded = Math.round(n * 100) / 100
  return rounded.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

/** An amount of FE: "1,234.5 FE". */
export function fe(n: number): string {
  return `${num(n)} FE`
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

/** Fits a text in a width, with dots when it is too long. */
export function fit(text: string, width: number): string {
  if (width <= 0) return ''
  if (text.length <= width) return text
  if (width <= 3) return text.slice(0, width)
  return `${text.slice(0, width - 3)}...`
}

/** Fits a text in a width, cut off when it is too long. */
export function clip(text: string, width: number): string {
  if (width <= 0) return ''
  return text.length <= width ? text : text.slice(0, width)
}
