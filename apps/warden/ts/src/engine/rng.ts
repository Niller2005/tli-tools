//! Seeded randomness, bit for bit as js/engine.js (lines 314-352).

/** A random stream: the state's own counter, or a stream of its own. */
export interface RngStream {
  rng: number
}

/** FNV-1a over the code points of `text` (hashSeed). */
export function hashSeed(text: string): number {
  let h = 2166136261
  for (const ch of text) {
    h = (h ^ (ch.codePointAt(0) as number)) >>> 0
    h = Math.imul(h, 16777619) >>> 0
  }
  return h
}

/** mulberry32 (rand): advances `stream` and returns a number in [0, 1). */
export function rand(stream: RngStream): number {
  stream.rng = (stream.rng + 0x6d2b79f5) >>> 0
  let t = stream.rng
  t = Math.imul(t ^ (t >>> 15), t | 1) >>> 0
  t = (t ^ ((t + Math.imul(t ^ (t >>> 7), t | 61)) >>> 0)) >>> 0
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

/** pickIndex: an index drawn by weight; negative weights count as 0. */
export function pickIndex(stream: RngStream, weights: number[]): number {
  let total = 0
  for (const w of weights) total += w > 0 ? w : 0
  if (total <= 0) return 0
  let r = rand(stream) * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i] > 0 ? weights[i] : 0
    if (r < 0) return i
  }
  return weights.length - 1
}

/** pickOne, as an index into a list of `len` items. */
export function pickOne(stream: RngStream, len: number): number {
  return Math.floor(rand(stream) * len)
}

/** shuffle: Fisher-Yates from the back, in place. */
export function shuffle<T>(stream: RngStream, list: T[]): void {
  for (let i = list.length - 1; i >= 1; i--) {
    const j = Math.floor(rand(stream) * (i + 1))
    const swapped = list[i]
    list[i] = list[j]
    list[j] = swapped
  }
}
