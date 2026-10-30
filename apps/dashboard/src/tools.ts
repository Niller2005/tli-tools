// The tools the dashboard can start. Add a tool here and it shows up in the list.
import { join } from 'node:path'

const ROOT = join(import.meta.dir, '..', '..', '..')

export interface Tool {
  id: string
  name: string
  description: string
  /** the argv to run, from `cwd` */
  command: string[]
  cwd: string
  /** programs it needs on PATH */
  needs: string[]
}

export const TOOLS: Tool[] = [
  {
    id: 'vorax',
    name: 'Vorax Helper',
    description: 'Reads the Vorax encounter from the game window and log and shows the best move.',
    command: ['bun', 'scripts/tui.ts'],
    cwd: join(ROOT, 'apps/vorax'),
    needs: ['bun', 'tesseract'],
  },
  {
    id: 'warden',
    name: 'Tartarus Warden',
    description: 'Reads the Tartarus prison board and recommends the next move.',
    command: ['bun', 'run', 'tui'],
    cwd: join(ROOT, 'apps/warden'),
    needs: ['bun', 'tesseract'],
  },
]

/** The programs a tool needs that are not installed. */
export const missing = (t: Tool): string[] => t.needs.filter(n => Bun.which(n) === null)
