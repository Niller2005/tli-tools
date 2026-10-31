// A picture in the PPM format (P6): the header, then the pixels, three bytes
// a pixel, red first. `grim` writes the screen this way, so a capture needs
// no PNG to be decoded.

/** An RGBA image: `width` x `height` pixels, four bytes each. */
export interface RgbaImage {
  width: number
  height: number
  data: Uint8ClampedArray
}

/** The header of a PPM: its magic number, its size and its deepest value. */
interface Header {
  width: number
  height: number
  max: number
}

/** The PPM header at the start of `bytes`, or null when the bytes are not a
 * PPM: the magic number `P6`, then the size and the deepest value, each
 * separated by white space, with `#` comments to the end of their line. */
function header(bytes: Uint8Array): { head: Header; at: number } | null {
  if (bytes.length < 2 || bytes[0] !== 0x50 || bytes[1] !== 0x36) return null
  let at = 2
  const numbers: number[] = []
  while (numbers.length < 3) {
    while (at < bytes.length && bytes[at] <= 0x20) at += 1
    if (at < bytes.length && bytes[at] === 0x23) {
      while (at < bytes.length && bytes[at] !== 0x0a) at += 1
      continue
    }
    let text = ''
    while (at < bytes.length && bytes[at] > 0x20) {
      text += String.fromCharCode(bytes[at] as number)
      at += 1
    }
    if (text === '') return null
    const value = Number(text)
    if (!Number.isFinite(value)) return null
    numbers.push(value)
  }
  // One white space byte ends the header.
  at += 1
  const [width, height, max] = numbers as [number, number, number]
  if (width <= 0 || height <= 0 || max <= 0 || max > 65535) return null
  return { head: { width, height, max }, at }
}

/**
 * The picture in `bytes`, a PPM, as RGBA. Null when the bytes are not a PPM:
 * the caller then reads them as a PNG.
 */
export function ppmToRgba(bytes: Uint8Array): RgbaImage | null {
  const parsed = header(bytes)
  if (parsed === null) return null
  const { head, at } = parsed
  const count = head.width * head.height
  // A PPM with a deepest value of 255 has one byte a sample; the rest have
  // two, big-endian.
  const wide = head.max > 255
  const need = count * 3 * (wide ? 2 : 1)
  if (bytes.length - at < need) return null
  const data = new Uint8ClampedArray(count * 4)
  for (let i = 0; i < count; i++) {
    const from = at + i * 3 * (wide ? 2 : 1)
    const o = i * 4
    if (wide) {
      const scale = head.max / 255
      data[o] = ((bytes[from] as number) * 256 + (bytes[from + 1] as number)) / scale
      data[o + 1] = ((bytes[from + 2] as number) * 256 + (bytes[from + 3] as number)) / scale
      data[o + 2] = ((bytes[from + 4] as number) * 256 + (bytes[from + 5] as number)) / scale
    } else {
      const scale = head.max / 255
      data[o] = (bytes[from] as number) / scale
      data[o + 1] = (bytes[from + 1] as number) / scale
      data[o + 2] = (bytes[from + 2] as number) / scale
    }
    data[o + 3] = 255
  }
  return { width: head.width, height: head.height, data }
}
