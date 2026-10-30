//! Consume, chain consumes and Hunt (js/engine.js canEat 451, devourOptions
//! 1015-1069, huntTargets and hunt 1138-1154, doDevour to endChain 1473-1597).

import { BEAST_KEYS, CAGE_FIGHT, RAINBOW, beastIndex, data, type Beast, type Tool } from './data'
import { pickOne, rand } from './rng'
import { advanceObjective, checkPrey, emptyCell, fires, openCell } from './rules'
import type { Inmate, Pending, State } from './state'
import { promote } from './tools'
import { Ok, fail, guard, type Outcome } from './actions'

/** A target of a consume: an open cell, or a scratched door a Wolf eats through. */
export interface Bite {
  cell: number
  scratch: boolean
}

/** Who each beast eats (FOOD_CHAIN). */
export function eats(beast: Beast): Beast[] {
  return data().foodChain[beastIndex(beast)]
}

/** What of the state the eating rules read: the species instruments held and
 * the Cage Fight theme. */
interface Diet {
  guillotine: boolean
  maul: boolean
  crown: boolean
  skewer: boolean
  cageFight: boolean
}

function dietOf(s: State): Diet {
  return {
    guillotine: s.has('guillotine'),
    maul: s.has('maul'),
    crown: s.has('crown'),
    skewer: s.has('skewer'),
    cageFight: s.theme === CAGE_FIGHT,
  }
}

/** Its index in the diet table, one bit per field. */
function dietIndex(diet: Diet): number {
  return (
    (diet.guillotine ? 1 : 0) |
    (diet.maul ? 2 : 0) |
    (diet.crown ? 4 : 0) |
    (diet.skewer ? 8 : 0) |
    (diet.cageFight ? 16 : 0)
  )
}

/** The species instruments widen the chain: the Fanged Guillotine lets a Wolf
 * eat lower rarities, the Elephant-Foot Maul a Mammoth higher ones, the Iron
 * Crown a Lion any same-rarity inmate, the Skewered Rat Heads a Rat a Rat. */
function dietCanEat(diet: Diet, eater: Inmate, meal: Inmate | null): boolean {
  if (meal === null) return false
  if (eater.id === meal.id || eater.tier >= RAINBOW) return false
  const counters = eats(eater.beast).includes(meal.beast)
  if (eater.tier > meal.tier) {
    return counters && ((eater.beast === 'wolf' && diet.guillotine) || diet.cageFight)
  }
  if (eater.tier < meal.tier) {
    return counters && eater.beast === 'mammoth' && diet.maul
  }
  return (
    counters ||
    (eater.beast === 'lion' && diet.crown) ||
    (eater.beast === 'rat' && meal.beast === 'rat' && diet.skewer)
  )
}

/** `dietCanEat` under the state's diet. */
export function canEat(s: State, eater: Inmate, meal: Inmate | null): boolean {
  return dietCanEat(dietOf(s), eater, meal)
}

/** Inmate classes: (rarity, beast) as `tier * 4 + beast`, Normal to Rainbow. */
const CLASSES = (RAINBOW + 1) * 4

function classOf(inmate: Inmate): number {
  return inmate.tier * 4 + beastIndex(inmate.beast)
}

/** By diet and eater class, a bit per meal class it eats, from `dietCanEat`
 * with stand-ins of different ids. */
let dietTable: Uint32Array[] | null = null

function getDietTable(): Uint32Array[] {
  if (dietTable !== null) return dietTable
  const standIn = (k: number, id: number): Inmate => ({
    id,
    beast: BEAST_KEYS[k % 4],
    tier: Math.floor(k / 4),
  })
  const table: Uint32Array[] = []
  for (let d = 0; d < 32; d++) {
    const diet: Diet = {
      guillotine: (d & 1) !== 0,
      maul: (d & 2) !== 0,
      crown: (d & 4) !== 0,
      skewer: (d & 8) !== 0,
      cageFight: (d & 16) !== 0,
    }
    const row = new Uint32Array(CLASSES)
    for (let e = 0; e < CLASSES; e++) {
      let mask = 0
      for (let m = 0; m < CLASSES; m++) {
        if (dietCanEat(diet, standIn(e, 0), standIn(m, 1))) mask |= 1 << m
      }
      row[e] = mask
    }
    table.push(row)
  }
  dietTable = table
  return table
}

/** The consumes open to the inmate in cell n, in cell order. */
export function devourOptions(s: State, n: number): Bite[] {
  return bites(s, n)
}

/** The consumes open to the inmate in cell n, in cell order. */
export function bites(s: State, n: number): Bite[] {
  const cell = s.cells[n]
  if (cell.sealed || cell.inmate === null) return []
  const eater = cell.inmate
  const out: Bite[] = []
  for (const c of s.cells) {
    if (c.n === n) continue
    if (!c.sealed && canEat(s, eater, c.inmate)) {
      out.push({ cell: c.n, scratch: false })
    } else if (c.sealed && c.scratch && eater.beast === 'wolf' && c.hidden !== null && c.hidden.tier === eater.tier && eater.tier < RAINBOW) {
      out.push({ cell: c.n, scratch: true })
    }
  }
  return out
}

/** A bit per cell whose inmate has a consume open, read from the diet table
 * against the classes on the block. */
export function eaterMask(s: State): number {
  let present = 0
  let twice = 0
  let scratched = 0
  for (const c of s.cells) {
    if (c.sealed) {
      if (c.scratch && c.hidden !== null) scratched |= 1 << c.hidden.tier
    } else if (c.inmate !== null) {
      const bit = 1 << classOf(c.inmate)
      twice |= present & bit
      present |= bit
    }
  }
  const table = getDietTable()[dietIndex(dietOf(s))]
  let mask = 0
  for (const c of s.cells) {
    if (c.sealed || c.inmate === null) continue
    const e = classOf(c.inmate)
    // An eater's own class counts only with a second inmate in it.
    const meals = (present & ~(1 << e)) | (twice & (1 << e))
    const scratch = c.inmate.beast === 'wolf' && c.inmate.tier < RAINBOW && ((scratched >> c.inmate.tier) & 1) !== 0
    if ((table[e] & meals) !== 0 || scratch) mask |= 1 << c.n
  }
  return mask
}

/** One consume a day (canDevourNow); a chain's later bites don't count. */
export function canDevourNow(s: State): boolean {
  return s.used.devour < 1
}

/** Today's first-bite options for the inmate in the warden's cell (startOptions). */
export function startOptions(s: State): Bite[] {
  const cell = s.cells[s.position]
  if (!canDevourNow(s) || s.phase !== 'manage' || cell.sealed || cell.inmate === null) return []
  return devourOptions(s, cell.n)
}

function optionCells(s: State, n: number): number[] {
  return devourOptions(s, n).map((o) => o.cell)
}

/** Oppress (Fanged Guillotine): a Wolf consuming a lower rarity loses upgrade
 * chance per tier of difference. From 0 to 1. */
export function upgradeChance(s: State, eater: Inmate, meal: Inmate): number {
  const diff = eater.tier - meal.tier
  if (diff <= 0 || eater.beast !== 'wolf' || !s.has('guillotine')) return 1
  return Math.max(100 - data().oppressPerTier * diff, 0) / 100
}

/** The tiers a bite adds before any roll; crowd counts the inmates on the
 * block before the meal leaves it. */
export function sureGain(s: State, eater: Inmate, meal: Inmate, scratch: boolean, crowd: number): number {
  const d = data()
  let gain = scratch ? 2 + (s.params.scratchStacksBase ? 1 : 0) : 1
  const tiers = (tool: Tool): number => d.tool(tool).tiers ?? 0
  if (s.has('maul') && eater.beast === 'mammoth') {
    gain = Math.max(gain, meal.tier + (d.tool('maul').above ?? 0) - eater.tier)
  }
  if (s.has('muzzle') && crowd <= (d.tool('muzzle').maxInmates ?? 0)) gain += tiers('muzzle')
  if (s.has('skewer') && eater.beast === 'rat') gain += tiers('skewer')
  if (s.has('crown') && eater.beast === 'lion') gain += tiers('crown')
  return gain
}

/** One bite without the phase checks; `chained` marks a bite after the first
 * of a chain (Maddened Beast's Barbed Collar). */
export function doDevour(s: State, from: number, option: Bite, chained: boolean): void {
  const d = data()
  const eater = s.cells[from].inmate
  const mealCell = s.cells[option.cell]
  const meal = mealCell.sealed ? mealCell.hidden : mealCell.inmate
  if (eater === null || meal === null) return
  const crowd = s.boardCells().length
  const chance = upgradeChance(s, eater, meal)
  let gain = sureGain(s, eater, meal, option.scratch, crowd)
  emptyCell(s, option.cell)
  if (chance < 1 && rand(s) >= chance) {
    gain = 0
  } else {
    const collar: Tool[] = chained ? ['collar'] : []
    for (const tool of ['saw', 'whip', ...collar] as Tool[]) {
      if (fires(s, tool)) gain += d.tool(tool).tiers ?? 0
    }
  }
  const revenge = fires(s, 'revenge')
  const cage = fires(s, 'beastcage')
  // Cage Fight: consuming does not re-roll the eater's beast.
  const grown = promote(s, eater, gain, s.theme !== CAGE_FIGHT)
  s.stats.devours += 1
  advanceObjective(s, 'devourCount', 1)
  checkPrey(s)
  // Crowded Beastcage: the meal's cell opens again at once, with no other effect.
  if (cage && s.cells[option.cell].sealed) openCell(s, option.cell, 'side', null)
  // Avenger's Casket: a random door opens with a meal for the eater.
  if (revenge && s.boardCellOf(grown.id) !== null) {
    const sealed = s.sealedCells()
    if (sealed.length > 0) {
      const door = sealed[pickOne(s, sealed.length)]
      const food = eats(grown.beast)
      const prey = food[pickOne(s, food.length)]
      openCell(s, door, 'side', { beast: prey, tier: grown.tier })
    }
  }
}

/** The day's consume, started by the inmate in the warden's cell. */
export function devour(s: State, to: number): Outcome {
  const reason = guard(s, 'manage')
  if (reason !== null) return fail(reason)
  if (s.used.devour >= 1) return fail('Today’s Consume is used. End the day for another.')
  const from = s.position
  const option = devourOptions(s, from).find((o) => o.cell === to)
  if (option === undefined) return fail('That Inmate cannot consume that target.')
  const eaterId = s.cells[from].inmate?.id ?? 0
  s.used.devour += 1
  doDevour(s, from, option, false)
  offerChain(s, eaterId)
  return Ok
}

/** While the eater has a target, a chain choice queues behind any pick the bite earned. */
export function offerChain(s: State, eaterId: number): void {
  const n = s.boardCellOf(eaterId)
  if (n === null) return
  const options = optionCells(s, n)
  if (options.length > 0) {
    const pending: Pending = { kind: 'chain', from: n, eaterId, options }
    s.pending.push(pending)
  }
}

/** Re-reads queued chain choices after another pick changed the board; drops
 * those whose eater has no target left. */
export function refreshChain(s: State): void {
  const pending = s.pending
  s.pending = []
  for (const p of pending) {
    if (p.kind !== 'chain') {
      s.pending.push(p)
      continue
    }
    const cell = s.boardCellOf(p.eaterId)
    p.options = cell !== null ? optionCells(s, cell) : []
    if (cell !== null) p.from = cell
    if (p.options.length > 0) s.pending.push(p)
  }
}

/** The next bite of a chain: the eater consumes the chosen target. */
export function devourNext(s: State, to: number): Outcome {
  const first = s.pending[0]
  if (first === undefined || first.kind !== 'chain') return fail('There is no Chain Consume to continue.')
  const option = devourOptions(s, first.from).find((o) => o.cell === to)
  if (option === undefined || !first.options.includes(to)) {
    return fail('That Inmate cannot consume that target.')
  }
  const from = first.from
  const eaterId = first.eaterId
  s.pending.shift()
  doDevour(s, from, option, true)
  s.stats.chains += 1
  offerChain(s, eaterId)
  return Ok
}

/** Ends the chain. */
export function endChain(s: State): Outcome {
  const first = s.pending[0]
  if (first === undefined || first.kind !== 'chain') return fail('There is no Chain Consume to end.')
  s.pending.shift()
  return Ok
}

/** Hunt targets: with the Blood-Stained Trap, a Lion in the warden's cell
 * may mark one open Consumable target that has no prey mark yet. */
export function huntTargets(s: State): number[] {
  const n = s.position
  const cell = s.cells[n]
  const lion = cell.inmate
  if (
    s.phase !== 'manage' ||
    !s.has('trap') ||
    s.used.hunt >= 1 ||
    lion === null ||
    cell.sealed ||
    lion.beast !== 'lion'
  ) {
    return []
  }
  const linked = (id: number): boolean => s.prey.some((l) => l.lion === id || l.prey === id)
  return devourOptions(s, n)
    .filter((o) => {
      if (o.scratch) return false
      const inmate = s.cells[o.cell].inmate
      return !(inmate !== null && linked(inmate.id))
    })
    .map((o) => o.cell)
}

/** Why there is no Hunt to play: also a board problem on a Hunt target pick. */
export const HUNT_NEEDS =
  'Hunt needs the Blood-Stained Trap, a Berserk Lion in the warden’s cell and a Consumable target without a Prey mark.'

/** Hunt: the Lion marks the inmate in `cell`, one of its targets, as prey. */
export function hunt(s: State, cell: number): Outcome {
  const reason = guard(s, 'manage')
  if (reason !== null) return fail(reason)
  const targets = huntTargets(s)
  const lion = s.cells[s.position].inmate
  if (lion === null || targets.length === 0) return fail(HUNT_NEEDS)
  if (!targets.includes(cell)) return fail('The Hunt cannot mark that target.')
  const prey = s.cells[cell].inmate
  if (prey === null) throw new Error('prey')
  s.prey.push({ lion: lion.id, prey: prey.id, preyBeast: prey.beast, rounds: s.params.preyRounds, next: s.day + 1 })
  s.used.hunt += 1
  return Ok
}
