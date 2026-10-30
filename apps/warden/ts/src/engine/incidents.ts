//! Prison Incident effects (js/engine.js chainReaction to resolveEvent): the
//! confirm, each incident's effect and the Sewer Ratway move.

import { ALL_INMATES, BEAST_KEYS, data } from './data'
import { eats, refreshChain } from './devour'
import { pickIndex, pickOne, rand, shuffle } from './rng'
import {
  advanceObjective,
  afterGrowth,
  checkPrey,
  doorWeights,
  emptyCell,
  incidentWeight,
  land,
  openCell,
  openRandom,
} from './rules'
import type { Inmate, Pending, State } from './state'
import { boardInmates, hiddenOf, promote } from './tools'
import { Ok, fail, type Outcome } from './actions'

export const EXECUTION_EFFICIENCY = 222
export const SEWER_RATWAY = 241
export const CHAIN_REACTION = 242

/** The incident popup's one Confirm button: there is no decline. */
export function resolveEvent(s: State): Outcome {
  const event = s.event
  if (event === null || s.phase !== 'event') return fail('There is no Prison Incident to confirm.')
  if (s.pending.length > 0) return fail('Make your pending choice first.')
  s.event = null
  s.phase = 'manage'
  incidentEffect(s, event.id, event.cell)
  advanceObjective(s, 'eventTriggerCount', 1)
  return Ok
}

/** INCIDENT_EFFECTS: the effect of incident `id` fired on cell `n`. */
function incidentEffect(s: State, id: number, n: number): void {
  switch (id) {
    case 201:
      highRiskConvict(s)
      break
    case 202:
      openRandom(s, data().incident(202).count, 'side')
      break
    case 203:
      behindClosedDoors(s, n)
      break
    case 211:
      ravenousAppetite(s)
      break
    case 212:
      extraPortion(s)
      break
    case 213:
      sharedFortune(s, n)
      break
    case 221:
      archenemy(s, n)
      break
    case EXECUTION_EFFICIENCY:
      executionEfficiency(s, n)
      break
    case 231:
      crowWhispers(s)
      break
    case 232:
      treasureHunt(s)
      break
    case SEWER_RATWAY:
      sewerRatway(s)
      break
    case CHAIN_REACTION:
      // The next move opens every unopened cell on its path (see land).
      s.chain = true
      break
    case 251:
      transferOfConvicts(s, n)
      break
    case 252:
    case 253:
    case 254:
    case 255:
      usurpation(s, id)
      break
    default:
      throw new Error(`incident ${id} has no effect`)
  }
}

/** The inmate in the incident's cell, if the cell is open. */
function incidentInmate(s: State, n: number): Inmate | null {
  const inmate = s.cells[n].inmate
  if (inmate === null || s.cells[n].sealed) return null
  return inmate
}

function randomSealed(s: State): number | null {
  const sealed = s.sealedCells()
  if (sealed.length === 0) return null
  return sealed[pickOne(s, sealed.length)]
}

/** Execution Efficiency: the lower-tier inmates the cell's inmate counters. */
export function executionVictims(s: State, n: number): number[] {
  const exec = incidentInmate(s, n)
  if (exec === null) return []
  const prey = eats(exec.beast)
  return s
    .boardCells()
    .filter((c) => {
      if (c === n) return false
      const inmate = s.cells[c].inmate
      return inmate !== null && prey.includes(inmate.beast) && inmate.tier < exec.tier
    })
}

/** Execution Efficiency (EV 222): the inmate removes every victim and rises
 * one tier per removal. */
function executionEfficiency(s: State, n: number): void {
  const exec = incidentInmate(s, n)
  if (exec === null) return
  const victims = executionVictims(s, n)
  for (const c of victims) emptyCell(s, c)
  s.stats.executions += 1
  checkPrey(s)
  if (victims.length > 0) promote(s, exec, victims.length, s.params.executionRerolls)
}

/** High-Risk Convict (EV 201): a random unopened cell opens with an inmate of
 * the text's rarity or better, rolled by the door odds above that floor. */
function highRiskConvict(s: State): void {
  const cell = randomSealed(s)
  if (cell === null) return
  const hidden = hiddenOf(s, cell)
  const floor = data().incident(201).tier
  let tier = hidden.tier
  if (tier < floor) {
    const w = doorWeights(s).map((x, t) => (t >= floor ? x : 0))
    tier = w.some((x) => x > 0) ? pickIndex(s, w) : floor
  }
  openCell(s, cell, 'side', { beast: hidden.beast, tier })
}

/** Behind Closed Doors (EV 203): the cell's inmate takes the beast with the
 * fewest inmates on the board (ties drawn) and the text's rarity. */
function behindClosedDoors(s: State, n: number): void {
  const current = incidentInmate(s, n)
  if (current === null) return
  const inmate: Inmate = { ...current }
  const board = boardInmates(s)
  const counts = BEAST_KEYS.map((b) => board.filter((i) => i.beast === b).length)
  const fewest = Math.min(...counts)
  const pool = BEAST_KEYS.filter((_, i) => counts[i] === fewest)
  inmate.beast = pool[pickOne(s, pool.length)]
  inmate.tier = data().incident(203).tier
  s.cells[n].inmate = inmate
  checkPrey(s)
  afterGrowth(s, inmate)
}

/** Ravenous Appetite (EV 211): a random lowest-rarity inmate gets some tries
 * at a chance to rise one tier each. */
function ravenousAppetite(s: State): void {
  const board = boardInmates(s)
  if (board.length === 0) return
  let low = board[0].tier
  for (const i of board) {
    if (i.tier < low) low = i.tier
  }
  const pool = board.filter((i) => i.tier === low)
  const who = pool[pickOne(s, pool.length)]
  const e = data().incident(211)
  let rose = 0
  for (let i = 0; i < e.count; i++) {
    if (rand(s) * 100 < e.chance) rose += 1
  }
  if (rose > 0) promote(s, who, rose, false)
}

/** Raises each of `picks` by `tiers`, skipping any that left the board on the way. */
function raiseAll(s: State, picks: Inmate[], tiers: number): void {
  for (const inmate of picks) {
    if (s.boardCellOf(inmate.id) !== null) promote(s, inmate, tiers, false)
  }
}

/** Extra Portion (EV 212): up to a few random inmates rise. */
function extraPortion(s: State): void {
  const e = data().incident(212)
  let picks = boardInmates(s)
  shuffle(s, picks)
  if (picks.length > e.count) picks.length = e.count
  raiseAll(s, picks, e.tiers)
}

/** Shared Fortune (EV 213): the cell's inmate rises per other inmate on the
 * board with its beast. */
function sharedFortune(s: State, n: number): void {
  const inmate = incidentInmate(s, n)
  if (inmate === null) return
  const same = boardInmates(s).filter((i) => i.id !== inmate.id && i.beast === inmate.beast).length
  const by = same * data().incident(213).tiers
  if (by > 0) promote(s, inmate, by, false)
}

/** Archenemy (EV 221): a random unopened cell opens on a same-rarity inmate
 * the cell's inmate counters; after-opening instruments fire. */
function archenemy(s: State, n: number): void {
  const inmate = incidentInmate(s, n)
  if (inmate === null) return
  const cell = randomSealed(s)
  if (cell === null) return
  const prey = eats(inmate.beast)
  const beast = prey[pickOne(s, prey.length)]
  openCell(s, cell, 'tool', { beast, tier: inmate.tier })
}

/** Shows the rarity behind each door in `cells` (Scratch-mark knowledge). */
function revealRarity(s: State, cells: number[]): void {
  for (const c of cells) s.cells[c].known = Math.max(s.cells[c].known, 1)
}

/** Crow Whispers (EV 231): the rarity behind the next unopened cells
 * clockwise from the warden; rat nests are skipped. */
function crowWhispers(s: State): void {
  const d = data()
  const count = d.incident(231).count
  const cells: number[] = []
  for (let k = 1; k < d.cellCount; k++) {
    if (cells.length >= count) break
    const c = (s.position + k) % d.cellCount
    if (s.cells[c].sealed && s.cells[c].nest === null) cells.push(c)
  }
  for (const c of cells) hiddenOf(s, c)
  revealRarity(s, cells)
}

/** "Treasure" Hunt (EV 232): every unopened cell below the text's rarity shows it. */
function treasureHunt(s: State): void {
  const doors: number[] = []
  for (const c of s.cells) {
    if (c.sealed && c.nest === null) doors.push(c.n)
  }
  for (const c of doors) hiddenOf(s, c)
  const below = data().incident(232).tier
  const low = doors.filter((c) => s.cells[c].hidden !== null && (s.cells[c].hidden as Inmate).tier < below)
  revealRarity(s, low)
}

/** Sewer Ratway (EV 241): the player picks any cell but the Interrogation
 * Room; choose() then moves the warden there. */
function sewerRatway(s: State): void {
  const room = data().room
  const options: number[] = []
  for (let n = 0; n < s.cells.length; n++) {
    if (n !== room) options.push(n)
  }
  const pending: Pending = { kind: 'cell', id: SEWER_RATWAY, options }
  s.pending.push(pending)
}

/** The Sewer Ratway move lands like a patrol: door, shackles, marker. */
export function ratwayMove(s: State, n: number): Outcome {
  const first = s.pending[0]
  if (first === undefined || first.kind !== 'cell' || !first.options.includes(n)) {
    return fail('The Sewer Ratway cannot lead there.')
  }
  s.pending.shift()
  land(s, n)
  refreshChain(s)
  return Ok
}

/** Transfer of Convicts (EV 251): the cell's inmate is copied into a random
 * unopened cell, which opens; after-opening instruments fire. */
function transferOfConvicts(s: State, n: number): void {
  const inmate = incidentInmate(s, n)
  if (inmate === null) return
  const cell = randomSealed(s)
  if (cell === null) return
  openCell(s, cell, 'tool', { beast: inmate.beast, tier: inmate.tier })
}

/** Usurpation I-IV (EV 252-255): random inmates rise, then the stage leaves
 * the pool and the next stage takes its weight; markers on the board turn
 * into the next stage (or go, after IV). */
function usurpation(s: State, id: number): void {
  const e = data().incident(id)
  let picks = boardInmates(s)
  if (e.count !== ALL_INMATES) {
    shuffle(s, picks)
    if (picks.length > e.count) picks.length = e.count
  }
  raiseAll(s, picks, e.tiers)
  const weight = incidentWeight(s, id)
  s.incidentWeights[String(id)] = 0
  if (e.next !== null) s.incidentWeights[String(e.next)] = weight
  for (const c of s.cells) {
    if (c.event === id) c.event = e.next
  }
}
