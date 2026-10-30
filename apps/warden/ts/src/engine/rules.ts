//! Setup, day flow, doors and incident markers (js/engine.js lines 406-1260).
//! Function names follow the JS ones in camel case.

import {
  BEAST_KEYS,
  GIFT_KEYS,
  IRON_LAW,
  OPULENCE,
  RAINBOW,
  data,
  type Beast,
  type Incident,
  type ObjectiveKind,
  type Spawn,
  type Tool,
} from './data'
import { hashSeed, pickIndex, pickOne, rand, shuffle } from './rng'
import {
  Params,
  State,
  blankCell,
  defaultParams,
  type Cell,
  type EventRef,
  type Inmate,
  type ObjectiveState,
  type Pending,
  type Roster,
  type RosterRow,
  type RunResult,
} from './state'
import { afterOpening, hatchNests, morningTools, preyRise, shackles } from './tools'
import { interrogationRoomStop } from './gifts'

const VERSION = 4

/** Who opened a door: a patrol, the run start, a side door (no triggers) or
 * an instrument whose effect lets "after opening" instruments fire. */
export type How = 'patrol' | 'start' | 'side' | 'tool'

/** Steps clockwise from a to b, so 0 means the same cell. */
export function stepsBetween(a: number, b: number): number {
  const cells = data().cellCount
  return (b + cells - a) % cells
}

/** The draw weights of a list of counts. */
export function weights(list: number[]): number[] {
  return list.map((w) => w)
}

/** A held instrument's trigger roll at its data chance; no draw when not held. */
export function fires(s: State, tool: Tool): boolean {
  return s.has(tool) && rand(s) * 100 < data().tool(tool).chance
}

/** A new inmate with the next id. */
export function makeInmate(s: State, beast: Beast, tier: number): Inmate {
  const id = s.nextId
  s.nextId += 1
  return { id, beast, tier: Math.min(Math.max(tier, 0), s.topTier()) }
}

/** Rarity odds for whoever is behind a door. The Sorting Hook keeps out Normals. */
export function doorWeights(s: State): number[] {
  const w = weights(s.params.tierWeights)
  if (s.has('hook') && w.slice(1).some((x) => x > 0)) w[0] = 0
  return w
}

/** An inmate of a drawn rarity and species. */
export function rollInmate(s: State, tierWeights: number[]): Inmate {
  const tier = pickIndex(s, tierWeights)
  const beast = BEAST_KEYS[pickIndex(s, weights(s.params.beastWeights))]
  return makeInmate(s, beast, tier)
}

/** Who comes out of a door: the inmate already behind it, unless the Sorting
 * Hook rules out a Normal the player hasn't seen. */
function doorInmate(s: State, n: number): Inmate {
  const cell = s.cells[n]
  const hidden = cell.hidden
  if (hidden !== null && (hidden.tier > 0 || cell.known > 0 || !s.has('hook'))) return hidden
  return rollInmate(s, doorWeights(s))
}

/** Ends every prey mark that is no longer valid. */
export function checkPrey(s: State): void {
  s.prey = s.prey.filter((link) => {
    const lionCell = s.boardCellOf(link.lion)
    const preyCell = s.boardCellOf(link.prey)
    if (lionCell === null || preyCell === null) return false
    const lion = s.cells[lionCell].inmate as Inmate
    const prey = s.cells[preyCell].inmate as Inmate
    return lion.beast === 'lion' && prey.beast === link.preyBeast
  })
}

/** Empties a cell. With reusable cells it seals again. */
export function emptyCell(s: State, n: number): Inmate | null {
  const sealed = s.params.reusableCells
  const cell = s.cells[n]
  const inmate = cell.inmate
  cell.inmate = null
  cell.hidden = null
  cell.known = 0
  cell.scratch = false
  cell.nest = null
  cell.ivory = false
  cell.sealed = sealed
  return inmate
}

/** Draws up to `count` distinct instruments the warden can still take, by
 * weight, without the held ones and any a held instrument excludes. */
export function drawTools(s: State, count: number): Tool[] {
  const d = data()
  const barred: Tool[] = []
  for (const held of s.tools) {
    for (const excluded of d.tool(held).exclude) barred.push(excluded)
  }
  const pool: Tool[] = d.toolIds.filter((t) => !s.has(t) && !barred.includes(t) && d.tool(t).weight > 0)
  const out: Tool[] = []
  while (out.length < count && pool.length > 0) {
    const w = pool.map((t) => d.tool(t).weight)
    out.push(...pool.splice(pickIndex(s, w), 1))
  }
  return out
}

/** Rewards for growth: objective progress, and the vault for anyone who
 * reaches Chromatic. */
export function afterGrowth(s: State, inmate: Inmate): void {
  const d = data()
  s.stats.best = Math.max(s.stats.best, inmate.tier)
  const goal = s.objective
  if (goal !== null) {
    const objective = d.objective(goal.id)
    if (objective !== null && inmate.tier >= objective.rating) advanceObjective(s, 'reachRating', 1)
  }
  if (inmate.tier < RAINBOW) return
  const n = s.cellOf(inmate.id)
  if (n === null) return
  emptyCell(s, n)
  s.vault.push({ id: inmate.id, beast: inmate.beast, day: s.day })
  s.cache += 1
  if (s.params.rewards) {
    const gift: Pending = { kind: 'gift', options: [...GIFT_KEYS], picks: treasurePicks(s.theme) }
    s.pending.push(gift)
  }
}

/** The picks a Warden's Treasure gives in `theme`: Opulence gives more from the same treasure. */
export function treasurePicks(theme: number | null): number {
  const extra = theme === OPULENCE ? (data().theme(OPULENCE)?.value ?? 0) : 0
  return 1 + extra
}

/** Objective progress; a completed objective queues an instrument pick. */
export function advanceObjective(s: State, kind: ObjectiveKind, amount: number): void {
  const d = data()
  const goal = s.objective
  if (goal === null || goal.done || amount === 0) return
  const objective = d.objective(goal.id)
  if (objective === null || objective.kind !== kind) return
  const progress = Math.min(objective.target, goal.progress + amount)
  const done = progress >= objective.target
  const state: ObjectiveState = { id: goal.id, progress, done }
  s.objective = state
  if (!done || !s.params.rewards) return
  const options = drawTools(s, d.instrumentPicks)
  if (options.length > 0) {
    const pending: Pending = { kind: 'tool', options, reason: 'objective' }
    s.pending.push(pending)
  }
}

/** Opens a sealed cell; `forced` places that beast and tier instead of the
 * occupant behind the door. */
export function openCell(s: State, n: number, how: How, forced: { beast: Beast; tier: number } | null): void {
  if (!s.cells[n].sealed) return
  const inmate = forced !== null ? makeInmate(s, forced.beast, forced.tier) : doorInmate(s, n)
  const cell = s.cells[n]
  cell.sealed = false
  cell.inmate = inmate
  cell.hidden = null
  cell.known = 0
  cell.scratch = false
  cell.nest = null
  s.stats.opened += 1
  if (how !== 'start') advanceObjective(s, 'openCellCount', 1)
  afterGrowth(s, inmate)
  if (how !== 'patrol' && how !== 'tool') return
  afterOpening(s, n, inmate.id)
}

/** Opens `count` random unopened cells for an instrument or incident. */
export function openRandom(s: State, count: number, how: How): void {
  const doors = s.sealedCells()
  shuffle(s, doors)
  if (doors.length > count) doors.length = count
  for (const n of doors) openCell(s, n, how, null)
}

// ---------- Prison Incident markers ----------

/** SpawnCellState; the Interrogation Room never carries a marker. */
export function incidentFits(id: number, cell: Cell): boolean {
  const d = data()
  if (cell.n === d.room) return false
  const spawn: Spawn = d.incident(id).spawn
  if (spawn === 'any') return true
  if (spawn === 'unopened') return cell.sealed
  return !cell.sealed
}

/** The draw weight of an incident. */
export function incidentWeight(s: State, id: number): number {
  const weight = s.incidentWeights[id]
  return weight === undefined ? data().incident(id).weight : weight
}

/** Whether an incident can be drawn now: weight above 0, no held instrument
 * in excludeRelic, under repeatLimit when the data sets one. */
function drawable(s: State, e: Incident): boolean {
  return (
    incidentWeight(s, e.id) > 0 &&
    !e.exclude.some((t) => s.has(t)) &&
    !(e.repeatLimit > 0 && (s.incidentCounts[String(e.id)] ?? 0) >= e.repeatLimit)
  )
}

function incidentPool(s: State): number[] {
  return data()
    .incidents.filter((e) => drawable(s, e))
    .map((e) => e.id)
}

/** The incidents a marker on cell `n` could carry, with their draw weights. */
export function fittingIncidents(s: State, n: number): { id: number; weight: number }[] {
  const cell = s.cells[n]
  return data()
    .incidents.filter((e) => drawable(s, e) && incidentFits(e.id, cell))
    .map((e) => ({ id: e.id, weight: incidentWeight(s, e.id) }))
}

/** Whether the player sees a marker's incident: not in a game whose
 * incidents stay hidden, which includes every read board. */
export function markerSeen(s: State): boolean {
  return !s.params.hiddenIncidents
}

/** Draws an incident by weight among those that fit at least one of `spots`. */
export function drawIncident(s: State, spots: number[]): number | null {
  const pool = incidentPool(s).filter((id) => spots.some((n) => incidentFits(id, s.cells[n])))
  if (pool.length === 0) return null
  const w = pool.map((id) => incidentWeight(s, id))
  return pool[pickIndex(s, w)]
}

/** Cells a new marker can go on: no marker yet, not the Interrogation Room,
 * and not the warden's cell when the params keep markers off it. */
function freeCells(s: State): number[] {
  const room = data().room
  const warden = s.params.markersAvoidWarden ? s.position : null
  const out: number[] = []
  for (const c of s.cells) {
    if (c.n !== room && c.event === null && c.n !== warden) out.push(c.n)
  }
  return out
}

/** Puts a marker on `cell`, or on a random free cell that fits the drawn incident. */
export function addMarker(s: State, cell: number | null): boolean {
  const free = cell !== null ? [cell] : freeCells(s)
  const id = drawIncident(s, free)
  if (id === null) return false
  const fit = free.filter((n) => incidentFits(id, s.cells[n]))
  const at = fit[pickOne(s, fit.length)]
  s.cells[at].event = id
  const key = String(id)
  s.incidentCounts[key] = (s.incidentCounts[key] ?? 0) + 1
  return true
}

/** Drops markers whose cell no longer fits and tops the board up to the minimum. */
export function syncMarkers(s: State): void {
  for (const c of s.cells) {
    if (c.event !== null && !incidentFits(c.event, c)) c.event = null
  }
  let count = s.cells.filter((c) => c.event !== null).length
  while (count < data().minMarkers && addMarker(s, null)) count += 1
}

// ---------- Setup ----------

/** newGame for the `empty` scenario (a full run) with default params. */
export function newGame(seed: string): State {
  return newGameWith(seed, defaultParams())
}

/** newGame for the `empty` scenario with the given params. */
export function newGameWith(seed: string, params: Params): State {
  const d = data()
  const trimmed = Array.from(seed.trim().toUpperCase()).slice(0, 40).join('')
  const scenario = 'empty'
  const s = new State({
    v: VERSION,
    scenario,
    seed: trimmed,
    rng: hashSeed(`${trimmed}|${scenario}`),
    params,
    day: 1,
    maxDays: params.drillDays,
    phase: 'patrol',
    position: d.room,
    dice: [],
    destinations: [],
    chain: false,
    event: null,
    incidentCounts: {},
    incidentWeights: {},
    cells: Array.from({ length: d.cellCount }, (_, n) => blankCell(n)),
    vault: [],
    cache: 0,
    tools: [],
    rerolls: 0,
    pending: [],
    objective: null,
    theme: null,
    used: { swap: 0, devour: 0, hunt: 0 },
    prey: [],
    nextId: 1,
    stats: { patrols: 0, opened: 0, devours: 0, chains: 0, swaps: 0, executions: 0, best: 0 },
    result: null,
  })
  drawRunGoals(s)
  runStart(s)
  beginDay(s)
  syncMarkers(s)
  return s
}

/** The run's objective and special theme, from a stream of their own. */
function drawRunGoals(s: State): void {
  const d = data()
  const stream = { rng: hashSeed(`${s.seed}|goals`) }
  let objective = d.objective(s.params.objective)
  if (objective === null && d.objectivesPerRun > 0) {
    const w = d.objectives.map((o) => o.weight)
    objective = d.objectives[pickIndex(stream, w)]
  }
  s.objective = objective !== null ? { id: objective.id, progress: 0, done: false } : null
  let theme: number | null = s.params.theme >= 0 ? s.params.theme : null
  if (theme !== null && d.theme(theme) === null) theme = null
  if (s.params.theme === 0) {
    const roll = rand(stream) * 10000
    // The caller's runsWithoutTheme is 0 here.
    const pity = d.themePityRuns === 0
    if (pity || roll < d.themeChancePer10000) {
      const w = d.themes.map((t) => t.weight)
      theme = d.themes[pickIndex(stream, w)].id
    }
  }
  s.theme = theme
  if (theme === IRON_LAW) {
    const days = d.theme(IRON_LAW)?.value ?? 0
    s.maxDays = Math.max(s.maxDays, days)
  }
}

/** The run start: random rooms open and the player picks an instrument. */
function runStart(s: State): void {
  const d = data()
  const rooms = s.sealedCells()
  shuffle(s, rooms)
  if (rooms.length > d.openRoomsAtStart) rooms.length = d.openRoomsAtStart
  for (const n of rooms) openCell(s, n, 'start', null)
  const options = drawTools(s, d.instrumentPicks)
  if (options.length > 0) {
    const pending: Pending = { kind: 'tool', options, reason: 'start' }
    s.pending.unshift(pending)
  }
}

// ---------- Day flow ----------

/** Today's moves from the dice: the cells they land on, nearest first, the room only when a die
 * lands there (the S16 cards, docs/s16-screen.md). `rollDice` draws distinct steps, so only a
 * state copied from a JS trace (tests/common `followJsRepeat`) can hold a repeated step. */
export function destinationsFromDice(s: State): void {
  const d = data()
  const pos = s.position
  const ahead: number[] = []
  for (const pips of s.dice) {
    const n = (pos + pips) % d.cellCount
    if (!ahead.includes(n)) ahead.push(n)
  }
  ahead.sort((a, b) => stepsBetween(pos, a) - stepsBetween(pos, b))
  s.destinations = ahead
}

/** "-1 daily destination option" (Barbed Whip, Forged Key, Burning Stake). */
export function fewerDice(s: State): number {
  let sum = 0
  for (const t of s.tools) sum += data().tool(t).fewerDice
  return sum
}

/** Rolls today's dice and derives today's moves from them. The game draws the steps as distinct
 * values (46 of 46 recorded three-card mornings showed three different steps), so a die that
 * repeats an earlier one is redrawn: uniform over the distinct sets, and the same rng stream as
 * independent dice on a morning without a repeat. */
export function rollDice(s: State): void {
  const d = data()
  const fewer = rand(s) * 100 < s.params.fewerDoorsChance
  const pips = d.maxPips - d.minPips + 1
  const count = Math.min(Math.max(s.params.destinations - (fewer ? 1 : 0) - fewerDice(s), 1), pips)
  const dice: number[] = []
  while (dice.length < count) {
    const die = d.minPips + Math.floor(rand(s) * pips)
    if (!dice.includes(die)) dice.push(die)
  }
  s.dice = dice
  destinationsFromDice(s)
}

/** The start of a day. */
export function beginDay(s: State): void {
  const d = data()
  s.phase = 'patrol'
  s.used = { swap: 0, devour: 0, hunt: 0 }
  checkPrey(s)
  preyRise(s)
  checkPrey(s)
  for (let n = 0; n < s.cells.length; n++) {
    if (n !== d.room && s.cells[n].event === null && rand(s) * 10000 < s.params.incidentSpawnChance) {
      addMarker(s, n)
    }
  }
  hatchNests(s)
  morningTools(s)
  rollDice(s)
}

/** The cells a move to `to` walks over. */
export function clockwisePath(s: State, to: number): number[] {
  const cells = data().cellCount
  const path: number[] = []
  let n = s.position
  while (n !== to) {
    n = (n + 1) % cells
    path.push(n)
  }
  if (path.length === 0) return [to]
  return path
}

/** The cells the warden may move to today. */
export function patrolOptions(s: State): number[] {
  if (s.phase === 'patrol') return [...s.destinations]
  return []
}

/** A move onto cell n and what the landing triggers. */
export function land(s: State, n: number): void {
  const d = data()
  const marker = n === d.room ? null : s.cells[n].event
  s.cells[n].event = null
  if (s.chain) {
    // Chain Reaction: every sealed door on the clockwise walk opens.
    for (const k of clockwisePath(s, n)) openCell(s, k, 'side', null)
    s.chain = false
  } else if (n !== d.room && s.cells[n].sealed) {
    openCell(s, n, 'patrol', null)
  }
  const steps = stepsBetween(s.position, n)
  s.position = n
  advanceObjective(s, 'moveDistance', steps)
  shackles(s, steps)
  if (n === d.room) {
    // The Interrogation Room offers its cards.
    interrogationRoomStop(s)
  }
  checkPrey(s)
  if (marker !== null) {
    s.phase = 'event'
    const event: EventRef = { id: marker, cell: n }
    s.event = event
  } else {
    s.phase = 'manage'
  }
}

/** The next day, or the end of the run. */
export function advanceDay(s: State): void {
  if (s.day >= s.maxDays) {
    finish(s, false)
    return
  }
  s.day += 1
  beginDay(s)
}

/** Ends the run and writes its result. */
export function finish(s: State, early: boolean): void {
  s.phase = 'ended'
  s.dice = []
  s.destinations = []
  s.event = null
  s.chain = false
  const roster = rosterOf(s)
  let best = Math.max(s.stats.best, 0)
  for (const r of roster.rows) best = Math.max(best, r.tier)
  const result: RunResult = { day: s.day, early, roster, cache: s.cache, best, stats: s.stats }
  s.result = result
}

/** The roster of the board and the vault. */
export function rosterOf(s: State): Roster {
  const rows: RosterRow[] = []
  for (const c of s.cells) {
    if (c.sealed || c.inmate === null) continue
    rows.push({ beast: c.inmate.beast, tier: c.inmate.tier, where: `Cell ${String(c.n + 1).padStart(2, '0')}` })
  }
  for (const v of s.vault) rows.push({ beast: v.beast, tier: RAINBOW, where: `Vault, day ${v.day}` })
  rows.sort((a, b) => b.tier - a.tier || BEAST_KEYS.indexOf(a.beast) - BEAST_KEYS.indexOf(b.beast))
  const byTier: number[] = []
  for (let t = 0; t <= RAINBOW; t++) byTier.push(rows.filter((r) => r.tier === t).length)
  return { rows, byTier }
}
