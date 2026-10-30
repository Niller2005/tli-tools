//! Rust's number formatting, as the command line and the terminal print the
//! solver's numbers: the exact value of the double, rounded half to even
//! (the JS `toFixed` rounds a tie away from zero, so it does not match).

/** Rust's `{:.d}` for an f64: the exact value of the double, rounded half to
 * even. */
export function fixed(x: number, d: number): string {
  if (Number.isNaN(x)) return 'NaN'
  if (!Number.isFinite(x)) return x > 0 ? 'inf' : '-inf'
  const negative = x < 0 || Object.is(x, -0)
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, Math.abs(x))
  const bits = view.getBigUint64(0)
  const exponent = Number((bits >> 52n) & 0x7ffn)
  const fraction = bits & ((1n << 52n) - 1n)
  // The exact value of the double is m * 2^e.
  const m = exponent === 0 ? fraction : fraction | (1n << 52n)
  const e = exponent === 0 ? -1074 : exponent - 1075
  const pow10 = 10n ** BigInt(d)
  let scaled: bigint
  if (e >= 0) {
    scaled = m * pow10 * (2n ** BigInt(e))
  } else {
    const den = 2n ** BigInt(-e)
    const num = m * pow10
    const q = num / den
    const r = num % den
    const half = den >> 1n
    scaled = r > half || (r === half && (q & 1n) === 1n) ? q + 1n : q
  }
  const digits = scaled.toString().padStart(d + 1, '0')
  const text = d > 0 ? `${digits.slice(0, digits.length - d)}.${digits.slice(digits.length - d)}` : digits
  return negative ? `-${text}` : text
}

/** Rust's `{:+.d}` for an f64: the sign always. */
export function signed(x: number, d: number): string {
  return `${x < 0 ? '-' : '+'}${fixed(Math.abs(x), d)}`
}
