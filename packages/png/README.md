# @tli/png

A PNG decoder and encoder over `node:zlib`, with no dependencies. It is the
codec both readers use (Vorax's helper and Warden's reader).

The decoder expands what the Rust `png` crate expands with
`normalize_to_color8`: the palette to RGB, `tRNS` to alpha and 16-bit samples
to 8-bit. It reads greyscale, RGB, palette and alpha images, 1 to 16 bits per
sample, interlaced or not.

## The image type

```ts
export interface Image<D extends Uint8Array | Uint8ClampedArray = Uint8Array | Uint8ClampedArray> {
  width: number
  height: number
  data: D
}
```

An image is RGBA, four bytes a pixel, rows top to bottom. The pixels are the
same in a plain byte array and in a clamped one; a clamped array holds a write
inside 0-255, which is what a resizer wants.

## What it gives

- `decodePng(bytes)` — the picture as a plain byte array.
- `decodePngClamped(bytes)` — the same picture in a clamped array.
- `asBytes(img)` — a clamped picture as a plain one: the same memory, no copy.
- `encodePng(img, gray)` — the picture as an 8-bit PNG, in colour or in
  greyscale.
