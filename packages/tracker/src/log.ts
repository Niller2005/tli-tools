// Reading the game's log file.
//
// The log can be hundreds of megabytes, so it is read in pieces and never held in memory all at
// once. The reader keeps its place in the file, so the tracker can be stopped and started again
// and carry on where it left off. A log that was truncated (the game was restarted) or rotated (a
// new file was made) is read from its beginning again.

import { closeSync, openSync, readSync, statSync, type Stats } from 'node:fs'

/** How much is read at a time. */
const CHUNK = 1 << 20

/** How much of the log's tail is read when the tracker starts without a saved place. */
export const TAIL_BYTES = 4 * 1024 * 1024

/** A batch of lines, and where in the file they are. */
export interface Batch {
  /** the lines that were read */
  lines: string[]
  /** the place in the file after them */
  offset: number
  /** whether the file was shorter than the last time, and was read from its start again */
  restarted: boolean
  /** the file's size */
  size: number
}

/** Reads the game's log, line by line. */
export class LogReader {
  private offset = 0
  private inode: number | null = null
  private readonly from: number | 'end' | null

  /**
   * @param file the log to read
   * @param start where to start; `null` and `'end'` mean the end of the file (only the new lines
   *   are read), a number is a place in the file
   */
  constructor(
    readonly file: string,
    start: number | 'end' | null = null,
  ) {
    this.from = start
  }

  /** Where the reader is in the file. */
  get position(): number {
    return this.offset
  }

  /** Sets where the reader is in the file. */
  seek(offset: number): void {
    this.offset = offset
  }

  /** Reads the lines written since the last read. */
  read(): Batch {
    let st: Stats
    try {
      st = statSync(this.file)
    } catch {
      return { lines: [], offset: this.offset, restarted: false, size: 0 }
    }
    if (!st.isFile()) return { lines: [], offset: this.offset, restarted: false, size: 0 }

    let restarted = false
    if (this.inode !== null && st.ino !== this.inode) {
      // the log was rotated: a new file is where the old one was
      this.offset = 0
      restarted = true
    }
    this.inode = st.ino

    if (this.from === 'end' && this.offset === 0 && !restarted) {
      this.offset = st.size
      return { lines: [], offset: this.offset, restarted, size: st.size }
    }
    if (typeof this.from === 'number' && this.offset === 0 && !restarted) this.offset = this.from
    else if (st.size < this.offset) {
      // the log was truncated: the game was restarted
      this.offset = 0
      restarted = true
    }
    if (st.size === this.offset) return { lines: [], offset: this.offset, restarted, size: st.size }

    const want = Math.min(CHUNK, st.size - this.offset)
    const buf = Buffer.allocUnsafe(want)
    const fd = openSync(this.file, 'r')
    let read = 0
    try {
      read = readSync(fd, buf, 0, want, this.offset)
    } finally {
      closeSync(fd)
    }
    this.offset += read
    const text = buf.subarray(0, read).toString('utf8')
    const lines = text.split('\n')
    // The last piece is only whole when the file ends with a newline.
    const tail = lines.pop() ?? ''
    if (tail !== '') this.offset -= Buffer.byteLength(tail, 'utf8')
    return { lines, offset: this.offset, restarted, size: st.size }
  }

  /** Reads the log from its beginning, in pieces, until it is all read. */
  readAll(onBatch: (batch: Batch) => void): void {
    for (;;) {
      const batch = this.read()
      if (batch.lines.length > 0) onBatch(batch)
      if (batch.offset >= batch.size || batch.size === 0) break
      if (batch.lines.length === 0 && batch.offset === 0) break
    }
  }
}

/** Reads the log's tail: the last `bytes` of it, as whole lines. */
export function readTail(file: string, bytes: number): string[] {
  let st: Stats
  try {
    st = statSync(file)
  } catch {
    return []
  }
  if (!st.isFile() || st.size === 0) return []
  const want = Math.min(bytes, st.size)
  const buf = Buffer.allocUnsafe(want)
  const fd = openSync(file, 'r')
  let read = 0
  try {
    read = readSync(fd, buf, 0, want, st.size - want)
  } finally {
    closeSync(fd)
  }
  const lines = buf.subarray(0, read).toString('utf8').split('\n')
  if (st.size - want > 0) lines.shift() // the first line is only half there
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop() // the file ends with a newline
  return lines
}
