// The tools that can be started, and what they need.
//
// The table lives here so that every app that starts a tool reads the same one: the dashboard
// lists them, and the tracker opens them in a window of their own.

import { join } from 'node:path'
import type { GameName } from '@tli/gamelog'

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
  /** the minigame the tool reads, when the game log says whether it is open */
  game?: GameName
  /** the tool reads the game's log, so it can be given the log its parent reads */
  readsLog?: boolean
  /** the per-tool settings the command takes, and the flag each is spelled as */
  accepts?: ToolAccepts
}

/** The settings a tool's command takes, and how each is spelled in its argv. */
export interface ToolAccepts {
  /** the flag that turns the colours off */
  noColor?: string
  /** the flag that keeps the tool from reading the game's log */
  noLog?: string
  /** the flag that allows Niri's own window screenshot */
  niriScreenshot?: string
  /** the flag the capture command follows; it ends with `=` when the command is glued onto it */
  captureCmd?: string
}

export const TOOLS: Tool[] = [
  {
    id: 'vorax',
    name: 'Vorax Helper',
    description: 'Reads the Vorax encounter from the game window and log and shows the best move.',
    command: ['bun', 'scripts/tui.ts'],
    cwd: join(ROOT, 'apps/vorax'),
    needs: ['bun', 'tesseract'],
    game: 'vorax',
    readsLog: true,
    accepts: {
      noColor: '--no-color',
      noLog: '--no-log',
      niriScreenshot: '--niri-screenshot',
      captureCmd: '--capture-cmd=',
    },
  },
  {
    id: 'warden',
    name: 'Tartarus Warden',
    description: 'Reads the Tartarus prison board and recommends the next move.',
    command: ['bun', 'run', 'tui'],
    cwd: join(ROOT, 'apps/warden'),
    needs: ['bun', 'tesseract'],
    game: 'warden',
    accepts: {
      noColor: '--no-color',
      noLog: '--no-log',
      niriScreenshot: '--niri-screenshot',
      captureCmd: '--capture-cmd',
    },
  },
  {
    id: 'tracker',
    name: 'Loot Tracker',
    description: "Reads the game's log and shows what each map run gave and what it is worth.",
    command: ['bun', 'src/tui.ts'],
    cwd: join(ROOT, 'apps/tracker'),
    needs: ['bun'],
    readsLog: true,
    accepts: { noColor: '--no-color' },
  },
  {
    id: 'arcana',
    name: 'Arcana (Tarot Path)',
    description: "Reads the game's log and tracks the Tarot Path visits, the Fateful Contests and what their chests gave.",
    command: ['bun', 'src/tui.ts'],
    cwd: join(ROOT, 'apps/arcana'),
    needs: ['bun'],
    game: 'arcana',
    readsLog: true,
    accepts: { noColor: '--no-color' },
  },
]

/** The programs a tool needs that are not installed. */
export const missing = (
  t: Tool,
  which: (program: string) => string | null = (program: string) => Bun.which(program),
): string[] => t.needs.filter(n => which(n) === null)

/** The tool with this id. */
export const toolById = (id: string): Tool | undefined => TOOLS.find(tool => tool.id === id)
