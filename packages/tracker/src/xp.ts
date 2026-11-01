// The experience the character gains.
//
// The game says how far the experience bar is each time it moves:
//
//   [2026.10.31-02.21.44:746][899]TLLua: Display: [Game] ExpMgr@UpdateExp Percent:6257480 94
//
// The first number is the experience gathered in the level (the name says "percent", but it counts
// points) and the second is the level. At a level-up the number starts again at zero, so the gain
// across the border is what was left of the old level plus what is in the new one. What a level
// takes is in `data/levels.json`, the game's own table (see `docs/third-party-data.md`).

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Where the table of what a level takes is. */
export const LEVELS_PATH = join(import.meta.dir, '..', 'data', 'levels.json')

/** Reads the table of what a level takes, and checks it is a list of numbers. */
function readLevels(path: string): readonly number[] {
  const table: unknown = JSON.parse(readFileSync(path, 'utf8'))
  if (typeof table === 'object' && table !== null && 'exp' in table) {
    const exp = table.exp
    if (Array.isArray(exp) && exp.every((n) => typeof n === 'number')) return exp
  }
  throw new Error(`${path} is not a table of what each level takes`)
}

/** The experience that takes a character out of each level: `LEVEL_EXP[n - 1]` is level `n`'s. */
export const LEVEL_EXP: readonly number[] = readLevels(LEVELS_PATH)

/** The experience that takes a character out of a level; 0 when the table does not know the level. */
export function expToNext(level: number): number {
  return LEVEL_EXP[level - 1] ?? 0
}

/** Where the experience bar is. */
export interface XpState {
  level: number
  /** the experience gathered in the level */
  exp: number
}

/** Follows the experience bar and says how much was gained each time it moves. */
export class XpMeter {
  private state: XpState | null = null

  /** Where the bar was last. Null until the log has said. */
  get now(): XpState | null {
    return this.state === null ? null : { ...this.state }
  }

  /** How far through its level the character is, from 0 to 1; null when the table does not know the level. */
  get progress(): number | null {
    const state = this.state
    if (state === null) return null
    const need = expToNext(state.level)
    return need === 0 ? null : Math.min(1, state.exp / need)
  }

  /** Puts the bar back where a saved state had it. */
  restore(state: XpState | null): void {
    this.state = state === null ? null : { ...state }
  }

  /** Forgets where the bar was: the next move only says where it is. */
  reset(): void {
    this.state = null
  }

  /**
   * The bar moved. Returns the experience that was gained.
   *
   * The first move after the tracker started gains nothing (there is nothing to measure it against),
   * and neither does a move down: dying takes experience away, and the bar going back is not a gain.
   * A jump of more than one level is not trusted either, because something happened that the log did
   * not say.
   */
  update(level: number, exp: number): number {
    const was = this.state
    this.state = { level, exp }
    if (was === null) return 0
    if (level === was.level) return Math.max(0, exp - was.exp)
    if (level === was.level + 1) {
      const left = expToNext(was.level) - was.exp
      return Math.max(0, left) + exp
    }
    return 0
  }
}
