// The game's log as the follower reads it: its size now, and a range of bytes.
// Finding the log is `@tli/gamelog`'s job (the dashboard and the Wardener use it too).
import { closeSync, openSync, readSync, statSync } from 'node:fs'
import type { FileLike } from '@/reader/live/logFollower'

/** The log as the follower reads it: its size now, and a range of bytes. */
export function fileHandle(path: string): FileLike {
  return {
    async getFile() {
      const size = statSync(path).size
      return {
        size,
        slice: (a: number, b = size) => ({
          arrayBuffer: async () => {
            const fd = openSync(path, 'r')
            try {
              const buf = Buffer.alloc(b - a)
              const got = readSync(fd, buf, 0, buf.length, a)
              return buf.buffer.slice(buf.byteOffset, buf.byteOffset + got) as ArrayBuffer
            } finally { closeSync(fd) }
          },
        }),
      }
    },
  }
}
