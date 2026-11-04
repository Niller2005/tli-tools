//! The `tesseract` program, run over a PNG: the game's text is English, so
//! the program reads it in English, one process per region. The program
//! itself is not here: what it reads and how it is asked to read are the
//! readers' own business.

import { spawn, spawnSync } from 'node:child_process'
import { once } from 'node:events'

/** The arguments the game's text is read with: one block of text, in
 * English. */
export const TESSERACT_ARGS = ['--psm', '6', '-l', 'eng'] as const

/** One line of text and its box (x, y, w, h) in the image's pixels. */
export interface TextLine {
  text: string
  rect: [number, number, number, number]
}

/** What the program made of a picture. */
export interface TesseractResult {
  /** the text the program wrote to its standard output */
  out: string
  /** false when the program failed */
  ok: boolean
}

let found: boolean | null = null

/** Whether the `tesseract` program runs. */
export function tesseractFound(): boolean {
  if (found === null) {
    try {
      found = spawnSync('tesseract', ['--version'], { stdio: 'ignore' }).status === 0
    } catch {
      found = false
    }
  }
  return found
}

/** Runs `tesseract stdin stdout` over a picture (a PNG, or a binary PGM, which skips the cost of compressing one) and
 * gives back what it wrote. Throws when the program could not be run at all. */
export async function runTesseract(picture: Uint8Array, args: readonly string[] = TESSERACT_ARGS): Promise<TesseractResult> {
  const child = spawn('tesseract', ['stdin', 'stdout', ...args], {
    env: { ...process.env, OMP_THREAD_LIMIT: '1' },
    stdio: ['pipe', 'pipe', 'ignore'],
  })
  let failed = false
  child.on('error', () => {
    failed = true
  })
  child.stdin.on('error', () => {
    // The child is gone; the close handler reports it.
  })
  const closed = once(child, 'close') as Promise<[number | null]>
  child.stdin.end(picture)
  const chunks: Buffer[] = []
  for await (const chunk of child.stdout) chunks.push(chunk as Buffer)
  const [code] = await closed
  if (failed) throw new Error('tesseract could not be run')
  return { out: Buffer.concat(chunks).toString('utf8'), ok: code === 0 }
}

/** The lines of tesseract's TSV: its words grouped by block, paragraph and line. */
export function parseTsv(tsv: string): TextLine[] {
  const lines: { key: string; text: string; rect: [number, number, number, number] }[] = []
  const rows = tsv.split('\n')
  for (const row of rows.slice(1)) {
    const f = row.split('\t')
    if (f.length < 12 || f[0] !== '5' || f[11].trim().length === 0) continue
    const conf = Number(f[10])
    if (!Number.isNaN(conf) && conf < 0.0) continue
    const n = (i: number): number => {
      const v = Number(f[i])
      return Number.isNaN(v) ? 0 : v
    }
    const key = `${f[2]}|${f[3]}|${f[4]}`
    const x0 = n(6)
    const y0 = n(7)
    const x1 = x0 + n(8)
    const y1 = y0 + n(9)
    const last = lines[lines.length - 1]
    // Words far apart in one row (three cards' names across a screen) are separate lines, as Windows OCR gives them.
    const near = last !== undefined && x0 - (last.rect[0] + last.rect[2]) <= 2.0 * Math.max(n(9), 12.0)
    if (last !== undefined && last.key === key && near) {
      last.text += ` ${f[11].trim()}`
      const lx1 = last.rect[0] + last.rect[2]
      const ly1 = last.rect[1] + last.rect[3]
      last.rect[0] = Math.min(last.rect[0], x0)
      last.rect[1] = Math.min(last.rect[1], y0)
      last.rect[2] = Math.max(lx1, x1) - last.rect[0]
      last.rect[3] = Math.max(ly1, y1) - last.rect[1]
    } else {
      lines.push({ key, text: f[11].trim(), rect: [x0, y0, x1 - x0, y1 - y0] })
    }
  }
  return lines.map((l) => ({ text: l.text, rect: l.rect }))
}
