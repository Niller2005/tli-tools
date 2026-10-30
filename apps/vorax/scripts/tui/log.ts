// Finds the game's UE_game.log on Linux (Steam, Proton: the game's folder is a normal Linux folder) and follows it.
import { closeSync, openSync, readFileSync, readSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import type { FileLike } from '@/reader/live/logFollower'
import { STEAM_APP } from '@tli/capture'

const LOG_IN_GAME = ['UE_game', 'TorchLight', 'Saved', 'Logs', 'UE_game.log']
const mtime = (p: string) => { try { const s = statSync(p); return s.isFile() ? s.mtimeMs : null } catch { return null } }

/** The log: the player's choice, else the newest in each Steam library that holds the game; null if the game isn't installed. */
export function findLog(given?: string): { file: string; exists: boolean } | null {
  if (given) return { file: resolve(given), exists: mtime(given) !== null }
  const home = homedir()
  const roots = new Set<string>()
  for (const r of [join(home, '.steam/steam'), join(home, '.local/share/Steam'), join(home, '.var/app/com.valvesoftware.Steam/.local/share/Steam')]) roots.add(r)
  const libraries = new Set(roots)
  for (const root of roots) {
    try {
      for (const m of readFileSync(join(root, 'steamapps/libraryfolders.vdf'), 'utf8').matchAll(/"path"\s+"([^"]+)"/g)) libraries.add(m[1].replace(/\\\\/g, '\\'))
    } catch { /* not a Steam folder */ }
  }
  const found: { file: string; at: number | null }[] = []
  for (const lib of libraries) {
    try {
      const m = /"installdir"\s+"([^"]+)"/.exec(readFileSync(join(lib, 'steamapps', `appmanifest_${STEAM_APP}.acf`), 'utf8'))
      if (!m) continue
      const file = join(lib, 'steamapps/common', m[1], ...LOG_IN_GAME)
      found.push({ file, at: mtime(file) })
    } catch { /* not in this library */ }
  }
  if (!found.length) return null
  found.sort((a, b) => (b.at ?? -1) - (a.at ?? -1))
  return { file: found[0].file, exists: found[0].at !== null }
}

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
