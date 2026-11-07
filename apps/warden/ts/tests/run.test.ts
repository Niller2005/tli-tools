//! The run tracker on synthetic reads, through `Run.take` and its hooks: the
//! rules for where a run starts and ends, the screens kept in place of a
//! read, the days count, the held instruments and theme, the Warden's
//! Treasure, the Consume target screen and the low-confidence warnings. The
//! input is `(scene, panels)` built by hand, so none of it needs a saved
//! frame (the frame tests are git-ignored data and skip without it).

import { describe, expect, test } from 'bun:test'

import { Run, type Meal, type RunHooks, type Taken } from '@/app/run'
import { IRON_LAW, OPULENCE, type Tool } from '@/engine/data'
import { treasurePicks } from '@/engine/rules'
import { ironLawDays, RUN_DAYS } from '@/reader/model'
import type { Panels, Screen } from '@/reader/panels'
import type { CellRead, Scene } from '@/reader/scene'
import { syntheticPanels, syntheticScene } from './session-common'

/** Hooks that count what the run asks of the session. */
class Hooks implements RunHooks {
  solves = 0
  drops = 0
  newRuns = 0
  ends: (number | null)[] = []
  mealAsked = 0
  meal: Meal | null = null

  advisedMeal(): Meal | null {
    this.mealAsked += 1
    return this.meal
  }
  solve(): void {
    this.solves += 1
  }
  solveDropped(): void {
    this.drops += 1
  }
  logNewRun(): void {
    this.newRuns += 1
  }
  logRunEnd(vaulted: number | null): void {
    this.ends.push(vaulted)
  }
}

const REF: [number, number] = [1920, 1080]

/** The warden's cell, screen cell 3, read as a Normal Wolf. */
const WOLF: Record<number, Partial<CellRead>> = { 3: { locked: false, inmate: { beast: 'wolf', tier: 1 } } }
/** The wolf with a Normal Rat in screen cell 4 to eat. */
const WOLF_RAT: Record<number, Partial<CellRead>> = { ...WOLF, 4: { locked: false, inmate: { beast: 'rat', tier: 1 } } }

/** A run and its hooks, and a `take` that reads one synthetic frame. */
function setup(tools: Tool[] = [], theme: number | null = null, days: number | null = null) {
  const run = new Run(tools, theme, days)
  const hooks = new Hooks()
  const take = (
    screen: Screen,
    daysRead: number | null,
    cells: Record<number, Partial<CellRead>> = WOLF,
    over: Partial<Panels> = {},
    o: { live?: boolean; size?: [number, number]; scene?: Scene } = {}
  ): Taken =>
    run.take(o.scene ?? syntheticScene(3, cells), syntheticPanels(screen, daysRead, over), o.size ?? REF, o.live ?? false, hooks)
  return { run, hooks, take }
}

/** The inmate model cell `n` (screen cell n + 1) of the reading on show. */
function cellOf(run: Run, n: number) {
  return run.reading!.model.cells[n]
}

/** How many warnings of `kind` the reading on show carries. */
function warned(run: Run, kind: string): number {
  return run.reading!.warnings.filter((w) => w.kind === kind).length
}

describe('where a run ends', () => {
  test('the riot screen drops the reading, the solve, the days, the instruments and the theme', () => {
    const { run, hooks, take } = setup(['chains'], OPULENCE)
    take('manage', 16)
    expect(run.takeToolsChanged()).toBe(false)
    expect(take('runEnd', null)).toEqual({ kind: 'skipped' })
    expect(run.runOver).not.toBe(null)
    expect(run.reading).toBe(null)
    expect(run.stored).toBe(null)
    expect(run.daysLeft()).toBe(null)
    expect(run.tools).toEqual([])
    expect(run.theme).toBe(null)
    expect(run.takeToolsChanged()).toBe(true)
    expect(hooks.drops).toBe(1)
    expect(hooks.ends).toHaveLength(1)
  })

  test('the riot screen read again ends the run once', () => {
    const { run, hooks, take } = setup()
    take('manage', 16)
    take('runEnd', null)
    take('runEnd', null)
    take('runEnd', null)
    expect(hooks.ends).toHaveLength(1)
    expect(hooks.drops).toBe(1)
    expect(run.runOver).not.toBe(null)
  })

  test('the run end carries the most Chromatics any reading showed, or null for none', () => {
    const two = setup()
    two.take('manage', 16, WOLF, { vault: [{ beast: 'wolf', conf: 1 }, { beast: 'rat', conf: 1 }] })
    // a later read with the vault panel unread keeps the board's vault
    two.take('manage', 15, WOLF, { vault: [] })
    expect(two.run.reading!.model.vault).toEqual(['wolf', 'rat'])
    two.take('runEnd', null)
    expect(two.hooks.ends).toEqual([2])

    const none = setup()
    none.take('runEnd', null)
    expect(none.hooks.ends).toEqual([null])
  })

  test('the vault panel reading fewer slots on the same day keeps the longer vault', () => {
    const { run, take } = setup()
    take('manage', 16, WOLF, { vault: [{ beast: 'wolf', conf: 1 }, { beast: 'rat', conf: 1 }] })
    take('manage', 16, WOLF, { vault: [{ beast: 'wolf', conf: 1 }] })
    expect(run.reading!.model.vault).toHaveLength(2)
  })

  test('between runs the days count RUN_DAYS - 1 starts a run and one lower waits', () => {
    const wait = setup()
    wait.take('manage', 16)
    wait.take('runEnd', null)
    const kept = wait.take('manage', RUN_DAYS - 2)
    expect(kept).toMatchObject({ kind: 'kept', saveFrame: false })
    expect(wait.run.reading).toBe(null)
    expect(wait.run.runOver).not.toBe(null)

    for (const days of [RUN_DAYS - 1, RUN_DAYS]) {
      const start = setup()
      start.take('manage', 16)
      start.take('runEnd', null)
      expect(start.take('manage', days)).toEqual({ kind: 'installed' })
      expect(start.run.runOver).toBe(null)
      expect(start.run.daysLeft()).toBe(days)
    }
  })

  test('a pick with the counter hidden starts the next run, a manage screen with it hidden does not', () => {
    const { run, hooks, take } = setup()
    take('manage', 16)
    take('runEnd', null)
    expect(take('manage', null)).toMatchObject({ kind: 'kept' })
    expect(run.reading).toBe(null)
    expect(take('instrumentPick', null)).toEqual({ kind: 'installed' })
    expect(run.runOver).toBe(null)
    expect(run.daysLeft()).toBe(RUN_DAYS)
    expect(hooks.solves).toBe(2)
  })

  test('a missed riot screen needs six cells apart, the last day and a hidden counter', () => {
    /** `n` cells read as Normal Rats in place of the first board's locked cells. */
    const far = (n: number): Record<number, Partial<CellRead>> => {
      const cells: Record<number, Partial<CellRead>> = { ...WOLF }
      for (let c = 4; c < 4 + n; c++) cells[c] = { locked: false, inmate: { beast: 'rat', tier: 3 } }
      return cells
    }
    const ended = (n: number, screen: Screen, days: number | null, left: number): boolean => {
      const { run, take } = setup([], null, left)
      take('manage', left)
      take(screen, days, far(n))
      return run.runOver !== null
    }
    expect(ended(6, 'patrol', null, 0)).toBe(true)
    expect(ended(5, 'patrol', null, 0)).toBe(false)
    expect(ended(6, 'patrol', null, 1)).toBe(false) // not the last day
    expect(ended(6, 'patrol', 0, 0)).toBe(false) // the counter reads
    expect(ended(6, 'cellPick', null, 0)).toBe(false) // a pick does not show around the end
    expect(ended(6, 'chainTarget', null, 0)).toBe(true)
  })
})

describe('screens kept in place of a read', () => {
  test('a window narrower than 16:9 is kept, one as wide as 16:9 or wider is read', () => {
    const narrow = setup()
    narrow.take('manage', 16)
    const before = narrow.run.reading
    const solves = narrow.hooks.solves
    expect(narrow.take('manage', 15, WOLF_RAT, {}, { size: [1920, 1200] })).toMatchObject({ kind: 'kept', saveFrame: true })
    expect(narrow.run.reading).toBe(before)
    expect(narrow.hooks.solves).toBe(solves)
    expect(narrow.run.daysLeft()).toBe(16)

    for (const size of [[1920, 1080], [1280, 720], [2560, 1080], [1920, 1090]] as [number, number][]) {
      const wide = setup()
      expect(wide.take('manage', 16, WOLF, {}, { size })).toEqual({ kind: 'installed' })
    }
  })

  test('with no reading, a kept frame leaves a reason and nothing on show', () => {
    for (const [screen, size] of [
      ['popup', REF],
      ['theme', REF],
      ['manage', [1000, 1000]],
    ] as [Screen, [number, number]][]) {
      const { run, take } = setup()
      const taken = take(screen, null, WOLF, {}, { size })
      expect(taken.kind).toBe('kept')
      expect(run.reading).toBe(null)
      expect(run.missed).not.toBe(null)
      expect(run.onScreen).toBe(false)
    }
  })

  test('a screen with no board and no counter is kept and its frame is not saved', () => {
    for (const screen of ['unknown', 'dayBanner'] as Screen[]) {
      const { run, take } = setup()
      take('manage', 16)
      const before = run.reading
      expect(take(screen, null)).toMatchObject({ kind: 'kept', saveFrame: false })
      expect(run.reading).toBe(before)
      expect(run.onScreen).toBe(false)
    }
    const { run, take } = setup()
    expect(take('unknown', null)).toMatchObject({ kind: 'kept', saveFrame: false })
    expect(run.missed).not.toBe(null)
  })

  test('a kept line is replaced, not stacked, and goes with the next read', () => {
    const { run, take } = setup()
    take('manage', 16)
    take('popup', null)
    take('popup', null)
    take('unknown', null)
    expect(warned(run, 'kept')).toBe(1)
    expect(run.reading!.keptLines()).toHaveLength(1)
    take('manage', 16)
    expect(warned(run, 'kept')).toBe(0)
  })

  test('the theme scroll sets the theme, keeps the reading and marks the instruments to save', () => {
    const { run, take } = setup()
    take('manage', 16)
    const before = run.reading
    run.takeToolsChanged()
    expect(take('theme', null, WOLF, { theme: OPULENCE })).toMatchObject({ kind: 'kept' })
    expect(run.theme).toBe(OPULENCE)
    expect(run.reading).toBe(before)
    expect(run.takeToolsChanged()).toBe(true)
    // the same theme again changes nothing to save
    take('theme', null, WOLF, { theme: OPULENCE })
    expect(run.takeToolsChanged()).toBe(false)
  })

  test('a frame of a narrow window does not set the theme', () => {
    const { run, take } = setup()
    take('theme', null, WOLF, { theme: OPULENCE }, { size: [1000, 1000] })
    expect(run.theme).toBe(null)
  })
})

describe('the days count and a new run', () => {
  test('a hidden counter keeps the last count, a lower read takes, one higher read waits', () => {
    const { run, take } = setup()
    take('manage', 16)
    take('manage', null)
    expect(run.daysLeft()).toBe(16)
    expect(run.reading!.daysLeft).toBe(16)
    expect(warned(run, 'note')).toBeGreaterThan(0)
    take('manage', 15)
    expect(run.daysLeft()).toBe(15)
    expect(run.reading!.warnings.filter((w) => w.cell === null && w.kind === 'note')).toHaveLength(0)
    take('manage', 17)
    expect(run.daysLeft()).toBe(15)
    expect(run.reading!.daysLeft).toBe(15)
    expect(warned(run, 'read')).toBeGreaterThan(0)
  })

  test('a higher count read twice logs one new run, the first read logs none', () => {
    const { hooks, take } = setup()
    take('manage', 16)
    take('manage', 18)
    expect(hooks.newRuns).toBe(0)
    take('manage', 18)
    expect(hooks.newRuns).toBe(1)
    take('manage', 18)
    expect(hooks.newRuns).toBe(1)
  })

  test('a higher count seen once and then a lower one is no new run', () => {
    const { hooks, run, take } = setup(['chains'])
    take('manage', 16)
    take('manage', 18)
    take('manage', 15)
    take('manage', 18)
    expect(hooks.newRuns).toBe(0)
    expect(run.tools).toEqual(['chains'])
    expect(run.daysLeft()).toBe(15)
  })

  test('a pick over no board read assumes day one whatever count was kept', () => {
    const fresh = setup()
    fresh.take('instrumentPick', null)
    expect(fresh.run.daysLeft()).toBe(RUN_DAYS)
    expect(fresh.run.reading!.daysLeft).toBe(RUN_DAYS)
    expect(fresh.hooks.newRuns).toBe(0)

    const iron = setup([], IRON_LAW)
    iron.take('treasurePick', null)
    expect(iron.run.daysLeft()).toBe(ironLawDays())
  })

  test('a pick over no board read after a lower kept count is a new run that clears the held instruments', () => {
    const { run, hooks, take } = setup(['chains'], null, 5)
    take('instrumentPick', null)
    expect(hooks.newRuns).toBe(1)
    expect(run.daysLeft()).toBe(RUN_DAYS)
    expect(run.tools).toEqual([])
    expect(run.takeToolsChanged()).toBe(true)
  })

  test('a pick over a board read keeps the count', () => {
    const { run, hooks, take } = setup()
    take('manage', 16)
    take('instrumentPick', null)
    expect(run.daysLeft()).toBe(16)
    expect(hooks.newRuns).toBe(0)
  })

  test('a count above the run length names the Iron Law theme', () => {
    const { run, take } = setup()
    take('manage', ironLawDays())
    expect(run.theme).toBe(IRON_LAW)
    expect(run.takeToolsChanged()).toBe(true)
    expect(run.reading!.model.maxDays).toBe(ironLawDays())
  })

  test('a count at the run length does not', () => {
    const { run, take } = setup()
    take('manage', RUN_DAYS)
    expect(run.theme).toBe(null)
  })

  test('a new run clears the theme unless it was set after the last board read', () => {
    const stale = setup([], OPULENCE)
    stale.take('manage', 16)
    stale.take('manage', 18)
    stale.take('manage', 18)
    expect(stale.run.theme).toBe(null)

    const fresh = setup([], null)
    fresh.take('manage', 16)
    fresh.run.setTheme(OPULENCE)
    fresh.take('manage', 18)
    fresh.take('manage', 18)
    expect(fresh.run.theme).toBe(OPULENCE)
    // the exemption is for one run: the next new run clears it
    fresh.take('manage', 19)
    fresh.take('manage', 19)
    expect(fresh.run.theme).toBe(null)
  })
})

describe('the held instruments', () => {
  test('the instrument advised on a pick is held from the next board screen, once', () => {
    const { run, take } = setup()
    take('manage', 16)
    take('instrumentPick', 16)
    run.advisedTool = 'coin'
    take('instrumentPick', 16) // the pick read again
    take('prisonStatus', 16)
    take('unknown', 16)
    expect(run.tools).toEqual([])
    take('manage', 16)
    expect(run.tools).toEqual(['coin'])
    expect(run.advisedTool as string | null).toBe(null)
    expect(run.takeToolsChanged()).toBe(true)

    run.advisedTool = 'coin' // a held one is not held twice
    take('manage', 16)
    expect(run.tools).toEqual(['coin'])
    expect(run.advisedTool as string | null).toBe(null)
  })

  test('a sure panel read names the held list', () => {
    const { run, take } = setup()
    take('manage', 16, WOLF, { held: ['coin', 'keys'] })
    expect(run.tools).toEqual(['coin', 'keys'])
    expect(run.takeToolsChanged()).toBe(true)
    expect(warned(run, 'note')).toBeGreaterThan(0)
    take('manage', 16, WOLF, { held: ['coin', 'keys'] })
    expect(run.takeToolsChanged()).toBe(false)
  })

  test('an empty or unsure panel read keeps the held list, a run loses no instrument', () => {
    const { run, take } = setup(['coin'])
    take('manage', 16, WOLF, { held: [] })
    expect(run.tools).toEqual(['coin'])
    take('manage', 16, WOLF, { held: null })
    expect(run.tools).toEqual(['coin'])
    expect(run.takeToolsChanged()).toBe(false)
  })

  test('a list the player set stands while the panel reads as it did, and gives way when it changes', () => {
    const { run, hooks, take } = setup()
    take('manage', 16, WOLF, { held: ['coin'] })
    run.setTools(['keys'], hooks)
    expect(run.reading!.model.tools).toEqual(['keys'])
    take('manage', 16, WOLF, { held: ['coin'] })
    expect(run.tools).toEqual(['keys'])
    take('manage', 16, WOLF, { held: ['saw'] })
    expect(run.tools).toEqual(['saw'])
  })

  test('setting the list on a pick names it, so the advised instrument is not added', () => {
    const { run, hooks, take } = setup()
    take('manage', 16)
    take('instrumentPick', 16)
    run.advisedTool = 'coin'
    run.setTools(['keys'], hooks)
    expect(run.advisedTool as string | null).toBe(null)
    expect(run.pickNamed).toBe(true)
    take('manage', 16)
    expect(run.tools).toEqual(['keys'])
    expect(run.pickNamed).toBe(false)
  })

  test('a screen that is not a board screen leaves the pick state alone', () => {
    const { run, take } = setup()
    take('manage', 16)
    take('instrumentPick', 16)
    run.advisedTool = 'coin'
    run.pickNamed = true
    for (const screen of ['instrumentPick', 'prisonStatus', 'unknown'] as Screen[]) {
      take(screen, 16)
      expect(run.advisedTool).toBe('coin')
      expect(run.pickNamed).toBe(true)
    }
  })

  test('a new run clears the held list, but keeps an instrument picked at its start', () => {
    const { run, take } = setup(['chains'])
    take('manage', 16)
    take('manage', 18) // waits
    run.advisedTool = 'coin' // picked on the new run's first screen
    take('manage', 18)
    expect(run.tools).toEqual(['coin'])
    expect(warned(run, 'note')).toBeGreaterThan(0)
  })
})

describe('the Warden\'s Treasure', () => {
  test('a treasure pick opens it and the next decision screen closes it', () => {
    const { run, take } = setup()
    take('manage', 16)
    expect(run.treasure).toBe(null)
    take('treasurePick', 16)
    expect(run.treasure).toBe(0)
    take('treasurePick', 16)
    expect(run.treasure).toBe(0)
    take('patrol', 15)
    expect(run.treasure).toBe(null)
  })

  test('the board after the one pick is the pick\'s effect and closes the treasure', () => {
    const { run, take } = setup()
    take('manage', 16, WOLF_RAT)
    take('treasurePick', 16)
    const taken = take('unknown', 16, { 3: { locked: false, inmate: { beast: 'wolf', tier: 2 } }, 4: WOLF_RAT[4] })
    expect(taken).toEqual({ kind: 'installed' })
    expect(run.treasure).toBe(null)
    expect(run.reading!.screen).toBe('unknown')
    expect(cellOf(run, 2)).toMatchObject({ kind: 'inmate', tier: 2 })
  })

  test('the board after a pick that changed nothing is skipped as a flicker', () => {
    const { run, hooks, take } = setup()
    take('manage', 16, WOLF_RAT)
    take('treasurePick', 16)
    const shown = run.reading
    const solves = hooks.solves
    // the pick's board has the eater's cell locked, as the board after a Chromatic consume shows it
    expect(take('unknown', 16, { 4: WOLF_RAT[4] })).toEqual({ kind: 'skipped' })
    expect(run.reading).toBe(shown)
    expect(hooks.solves).toBe(solves)
    expect(run.treasure).toBe(0)
  })

  test('with Opulence each pick keeps the pick on show until the last', () => {
    const picks = treasurePicks(OPULENCE)
    expect(picks).toBeGreaterThan(1)
    const { run, take } = setup([], OPULENCE)
    take('manage', 16, WOLF_RAT)
    take('treasurePick', 16)
    for (let n = 1; n < picks; n++) {
      take('unknown', 16, { 3: { locked: false, inmate: { beast: 'wolf', tier: 1 + n } }, 4: WOLF_RAT[4] })
      expect(run.treasure).toBe(n)
      expect(run.reading!.screen).toBe('treasurePick')
      expect(cellOf(run, 2)).toMatchObject({ kind: 'inmate', tier: 1 + n })
    }
    take('unknown', 16, { 3: { locked: false, inmate: { beast: 'wolf', tier: 1 + picks } }, 4: WOLF_RAT[4] })
    expect(run.treasure).toBe(null)
    expect(run.reading!.screen).toBe('unknown')
  })

  test('a pick keeps the longest vault of the run when its board reads fewer', () => {
    const { run, take } = setup()
    take('manage', 16, {}, { vault: [{ beast: 'wolf', conf: 1 }, { beast: 'rat', conf: 1 }] })
    take('treasurePick', 16, {}, { vault: [] })
    expect(run.reading!.model.vault).toHaveLength(2)
  })

  test('a treasure after a Chromatic consume sends the eater to the vault and locks its cell', () => {
    const { run, take } = setup()
    take('manage', 16, WOLF_RAT)
    take('treasurePick', 16)
    expect(cellOf(run, 2)).toMatchObject({ kind: 'sealed' })
    expect(cellOf(run, 3)).toMatchObject({ kind: 'inmate', beast: 'rat' })
    expect(run.reading!.model.vault).toEqual(['wolf'])
  })

  test('the meal advised on the Consume target screen is locked too, asked when that screen goes', () => {
    const { run, hooks, take } = setup()
    hooks.meal = { cell: 3, certain: true }
    take('manage', 16, WOLF_RAT)
    take('chainTarget', null, WOLF_RAT)
    expect(hooks.mealAsked).toBe(0)
    take('treasurePick', 16)
    expect(hooks.mealAsked).toBe(1)
    expect(cellOf(run, 2)).toMatchObject({ kind: 'sealed' })
    expect(cellOf(run, 3)).toMatchObject({ kind: 'sealed' })
    expect(run.reading!.model.vault).toEqual(['wolf'])
  })

  test('View Prison Status over a pick gives the board under it and keeps the pick on show', () => {
    const { run, take } = setup()
    take('manage', 16, WOLF_RAT)
    take('instrumentPick', 16)
    const status = take('prisonStatus', 16, { 3: WOLF_RAT[3], 4: { locked: false, inmate: { beast: 'rat', tier: 3 } } }, {}, { live: true })
    expect(status).toEqual({ kind: 'installed' })
    expect(run.reading!.screen).toBe('instrumentPick')
    expect(cellOf(run, 3)).toMatchObject({ kind: 'inmate', beast: 'rat', tier: 3 })
    expect(run.onScreen).toBe(false)
  })
})

describe('the Consume target screen', () => {
  test('a bite since the board marks the chain and locks the eaten cell', () => {
    const { run, take } = setup()
    take('manage', 16, WOLF_RAT)
    expect(run.chained).toBe(false)
    take('chainTarget', null, { 3: WOLF_RAT[3], 4: { locked: false, inmate: null } })
    expect(run.chained).toBe(true)
    expect(cellOf(run, 3)).toMatchObject({ kind: 'sealed' })
    expect(run.reading!.model.devourUsed).toBe(true)
    // the next board read starts the chain over
    take('manage', 16, WOLF_RAT)
    expect(run.chained).toBe(false)
  })

  test('with no bite the day\'s first Consume is still open and the board stays', () => {
    const { run, take } = setup()
    take('manage', 16, WOLF_RAT)
    take('chainTarget', null, WOLF_RAT)
    expect(run.chained).toBe(false)
    expect(run.reading!.model.devourUsed).toBe(false)
    expect(cellOf(run, 3)).toMatchObject({ kind: 'inmate', beast: 'rat' })
  })

  test('the eater changing its rarity is a bite', () => {
    const { run, take } = setup()
    take('manage', 16, WOLF_RAT)
    take('chainTarget', null, { 3: { locked: false, inmate: { beast: 'wolf', tier: 2 } }, 4: WOLF_RAT[4] })
    expect(run.chained).toBe(true)
  })

  test('the screen takes the board\'s cell for a cell it reads unsure, unless the player corrected it', () => {
    const unsure: Record<number, Partial<CellRead>> = {
      3: WOLF_RAT[3],
      4: { locked: false, inmate: { beast: 'lion', tier: 1 }, beastConf: 0.1 },
    }
    const kept = setup()
    kept.take('manage', 16, WOLF_RAT)
    kept.take('chainTarget', null, unsure)
    expect(cellOf(kept.run, 3)).toMatchObject({ kind: 'inmate', beast: 'rat' })
    expect(kept.run.reading!.warnings.filter((w) => w.kind === 'cellRead' && w.cell === 3)).toHaveLength(0)

    const edited = setup()
    edited.take('manage', 16, WOLF_RAT)
    edited.take('chainTarget', null, unsure)
    edited.run.edits.set(4, { kind: 'inmate', beast: 'mammoth', tier: 2 })
    edited.run.rebuild(edited.hooks)
    expect(edited.run.reading!.warnings.filter((w) => w.kind === 'cellRead' && w.cell === 3).length).toBeGreaterThan(0)
  })

  test('the Hunt\'s prey pick shows the same day\'s manage board, not its own cells', () => {
    const { run, take } = setup(['trap'])
    const lion = { 3: { locked: false, inmate: { beast: 'lion' as const, tier: 1 } }, 4: WOLF_RAT[4] }
    take('manage', 16, lion, { decision: ['Replace', 'End'] })
    take('cellPick', 16, { 3: lion[3], 4: { locked: true } })
    expect(run.reading!.model.choice.kind).toBe('prey')
    expect(cellOf(run, 3)).toMatchObject({ kind: 'inmate', beast: 'rat' })
    expect(run.reading!.model.devourUsed).toBe(true)
    expect(run.reading!.model.swapUsed).toBe(false)
  })
})

describe('a live read that changes the board', () => {
  const tier = (t: number) => ({ 3: { locked: false, inmate: { beast: 'wolf' as const, tier: t } } })

  test('a read from a file is taken at once', () => {
    const { run, hooks, take } = setup()
    take('manage', 16, tier(1))
    take('manage', 16, tier(2))
    expect(cellOf(run, 2)).toMatchObject({ tier: 2 })
    expect(run.wantsReread()).toBe(false)
    expect(hooks.solves).toBe(2)
  })

  test('the held read leaves the reading, the solve and the corrections alone', () => {
    const { run, hooks, take } = setup()
    take('manage', 16, tier(1), {}, { live: true })
    run.edits.set(5, { kind: 'locked' })
    run.rebuild(hooks)
    const solves = hooks.solves
    const held = take('manage', 16, tier(2), {}, { live: true })
    expect(held).toMatchObject({ kind: 'kept', saveFrame: true })
    expect(hooks.solves).toBe(solves)
    expect(run.edits.size).toBe(1)
    expect(cellOf(run, 2)).toMatchObject({ tier: 1 })
    expect(run.onScreen).toBe(false)
    // the blip showing the old board again is taken as the same read: corrections stay
    take('manage', 16, tier(1), {}, { live: true })
    expect(run.edits.size).toBe(1)
    expect(hooks.solves).toBe(solves)
    expect(run.wantsReread()).toBe(true)
  })

  test('a confirmed change is taken, clears the corrections and solves', () => {
    const { run, hooks, take } = setup()
    take('manage', 16, tier(1), {}, { live: true })
    run.edits.set(5, { kind: 'locked' })
    run.rebuild(hooks)
    const solves = hooks.solves
    take('manage', 16, tier(2), {}, { live: true })
    take('manage', 16, tier(2), {}, { live: true })
    expect(run.edits.size).toBe(0)
    expect(hooks.solves).toBe(solves + 1)
    expect(run.onScreen).toBe(true)
  })

  test('a changed day or screen is not held', () => {
    const day = setup()
    day.take('manage', 16, tier(1), {}, { live: true })
    expect(day.take('manage', 15, tier(2), {}, { live: true })).toEqual({ kind: 'installed' })

    const screen = setup()
    screen.take('manage', 16, tier(1), {}, { live: true })
    expect(screen.take('patrol', 16, tier(2), {}, { live: true })).toEqual({ kind: 'installed' })
  })

  test('a screen that is no live board is not held', () => {
    const { take } = setup()
    take('manage', 16, tier(1), {}, { live: true })
    take('prisonStatus', 16, tier(1), {}, { live: true })
    expect(take('prisonStatus', 16, tier(2), {}, { live: true })).toEqual({ kind: 'installed' })
  })

  test('a read that gives the scene on show again keeps the corrections and the solve', () => {
    const { run, hooks, take } = setup()
    take('manage', 16, tier(1))
    run.edits.set(5, { kind: 'locked' })
    run.rebuild(hooks)
    const solves = hooks.solves
    expect(take('manage', 16, tier(1))).toEqual({ kind: 'installed' })
    expect(run.edits.size).toBe(1)
    expect(hooks.solves).toBe(solves)
  })
})

describe('a low-confidence cell warning', () => {
  const low = { 3: { lockedConf: 0.2 } }
  const sure = {}

  test('stops after the same read came twice, and starts over when a sure read breaks the streak', () => {
    const { run, take } = setup()
    const lock = (cells: Record<number, Partial<CellRead>>): number => {
      take('manage', 16, cells)
      return run.reading!.warnings.filter((w) => w.kind === 'cellRead' && w.cell === 2 && w.detail === 'lock').length
    }
    expect([lock(low), lock(low), lock(low), lock(low)]).toEqual([1, 1, 0, 0])
    expect(lock(sure)).toBe(0)
    expect(lock(low)).toBe(1)
  })

  test('a new run warns again', () => {
    const { run, take } = setup()
    const lock = (days: number): number => {
      take('manage', days, low)
      return run.reading!.warnings.filter((w) => w.kind === 'cellRead' && w.cell === 2).length
    }
    expect([lock(16), lock(16), lock(16)]).toEqual([1, 1, 0])
    expect(lock(18)).toBe(0) // the higher count waits
    expect(lock(18)).toBe(1) // the new run
  })

  test('a different cell or detail counts on its own', () => {
    const { run, take } = setup()
    take('manage', 16, low)
    take('manage', 16, low)
    take('manage', 16, low)
    take('manage', 16, { 3: { lockedConf: 0.2 }, 5: { lockedConf: 0.2 } })
    const cells = run.reading!.warnings.filter((w) => w.kind === 'cellRead').map((w) => w.cell)
    expect(cells).toEqual([4])
  })
})
