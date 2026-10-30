//! The public actions (js/engine.js lines 1144-1783), each wrapped like the
//! JS `bounded`: the incident markers are synced after every action.

import {
  BEAST_KEYS,
  RAINBOW,
  cardFromKey,
  data,
  giftFromKey,
  toolFromKey,
  type Card,
  type Gift,
  type Tool,
} from './data'
import { devour, devourNext, endChain, hunt, refreshChain } from './devour'
import { applyGift, interrogate } from './gifts'
import { ratwayMove, resolveEvent } from './incidents'
import { pickIndex, shuffle } from './rng'
import {
  advanceDay,
  afterGrowth,
  checkPrey,
  destinationsFromDice,
  drawTools,
  emptyCell,
  fires,
  land,
  makeInmate,
  openRandom,
  rollInmate,
  syncMarkers,
  weights,
} from './rules'
import { pendingIsEmpty, type Inmate, type Pending, type State } from './state'
import { boardInmates, promote, scout } from './tools'

/** What a choice names: an option key, or a cell for the cell choices. */
export type ChoiceId = number | string

/** A move as the JS solver writes it (js/solver.js apply). */
export type Action =
  | { type: 'choose'; id: ChoiceId }
  | { type: 'event' }
  | { type: 'patrol'; cell: number }
  | { type: 'devour'; to: number }
  | { type: 'chain'; to: number }
  | { type: 'endChain' }
  | { type: 'swap' }
  /** The Hunt marks the inmate in `cell` as the Lion's prey. */
  | { type: 'hunt'; cell: number }
  | { type: 'end' }
  /** Re-roll the pending instrument offer. */
  | { type: 'reroll' }

/** The JS `{ ok }` result: a refused action changes nothing but the markers. */
export type Outcome = { ok: true } | { ok: false; reason: string }

/** A successful action. */
export const Ok: Outcome = { ok: true }

/** A refused action, and why. */
export function fail(reason: string): Outcome {
  return { ok: false, reason }
}

/** Whether an action went through. */
export function isOk(outcome: Outcome): boolean {
  return outcome.ok
}

/** Runs one action, then syncs the markers as `bounded` does. */
export function apply(s: State, action: Action): Outcome {
  let out: Outcome
  switch (action.type) {
    case 'choose':
      out = choose(s, action.id)
      break
    case 'event':
      out = resolveEvent(s)
      break
    case 'patrol':
      out = patrol(s, action.cell)
      break
    case 'devour':
      out = devour(s, action.to)
      break
    case 'chain':
      out = devourNext(s, action.to)
      break
    case 'endChain':
      out = endChain(s)
      break
    case 'swap':
      out = swap(s)
      break
    case 'hunt':
      out = hunt(s, action.cell)
      break
    case 'end':
      out = endDay(s)
      break
    case 'reroll':
      out = reroll(s)
      break
  }
  syncMarkers(s)
  return out
}

/** What an action needs before it may run. */
export type Need = 'patrol' | 'manage'

/** Why an action may not run now, or null when it may. */
export function guard(s: State, need: Need): string | null {
  if (s.phase === 'ended') return 'This run is over. Start a new run to keep playing.'
  if (s.pending.length > 0) return 'Make your pending choice first.'
  if (s.phase === 'event') return 'Confirm the Prison Incident first.'
  if (need === 'manage' && s.phase === 'patrol') return 'Move first: go to one of today’s destinations.'
  if (need === 'patrol' && s.phase !== 'patrol') return 'Today’s move is done.'
  return null
}

/** Moves the warden to one of today's destinations. */
export function patrol(s: State, n: number): Outcome {
  const reason = guard(s, 'patrol')
  if (reason !== null) return fail(reason)
  if (!s.destinations.includes(n)) return fail('Move to one of today’s destinations.')
  s.stats.patrols += 1
  land(s, n)
  return Ok
}

/** Replace: the inmate in the warden's cell makes way for a new one. */
export function swap(s: State): Outcome {
  const reason = guard(s, 'manage')
  if (reason !== null) return fail(reason)
  const d = data()
  const n = s.position
  const cell = s.cells[n]
  const old = cell.inmate
  if (old === null || cell.sealed) return fail('The warden’s cell has no Inmate to replace.')
  if (s.used.swap >= s.params.swapsPerDay) return fail('No Replace left today.')
  const tierWeights = weights(s.params.tierWeights)
  if (s.has('rope')) {
    tierWeights[0] = 0
    tierWeights[1] = 0
  }
  if (!tierWeights.some((w) => w > 0)) {
    return fail('No rarity is left to roll. Adjust the rarity weights in the Lab.')
  }
  cell.inmate = null
  checkPrey(s)
  // Scapegoat's Guillotine: with enough other inmates on the block, some are
  // removed and the new inmate is sure to be rarer than the old.
  const scapegoat = d.tool('scapegoat')
  let others = s.boardCells()
  const sacrifice = s.has('scapegoat') && others.length >= (scapegoat.minOthers ?? 0)
  if (sacrifice) {
    shuffle(s, others)
    if (others.length > (scapegoat.count ?? 0)) others.length = scapegoat.count ?? 0
    for (const c of others) emptyCell(s, c)
    checkPrey(s)
    for (let i = 0; i <= Math.max(old.tier, 0) && i < tierWeights.length; i++) tierWeights[i] = 0
  }
  let fresh: Inmate
  if (sacrifice && !tierWeights.some((w) => w > 0)) {
    const beast = BEAST_KEYS[pickIndex(s, weights(s.params.beastWeights))]
    fresh = makeInmate(s, beast, old.tier + 1)
  } else {
    fresh = rollInmate(s, tierWeights)
  }
  if (s.has('pestle')) fresh.beast = old.beast
  // Burning Stake: a replaced inmate below Legendary can bring in a Legendary.
  const stake = d.tool('stake').tier ?? RAINBOW
  if (old.tier < stake && fires(s, 'stake') && fresh.tier < stake) fresh.tier = stake
  cell.inmate = fresh
  s.used.swap += 1
  s.stats.swaps += 1
  afterGrowth(s, fresh)
  // Severed Iron Maiden: as many rarer inmates as less rare ones on the block.
  if (s.params.maiden && s.has('maiden') && s.boardCellOf(fresh.id) !== null) {
    const rest = boardInmates(s)
      .filter((i) => i.id !== fresh.id)
      .map((i) => i.tier)
    const higher = rest.filter((t) => t > fresh.tier).length
    const lower = rest.filter((t) => t < fresh.tier).length
    if (higher === lower) fresh = promote(s, fresh, d.tool('maiden').tiers ?? 0, false)
  }
  if (fires(s, 'scales')) scout(s)
  // Gaoler's Execution Axe: a swap that raised the rarity opens random cells.
  if (s.has('axe') && fresh.tier > old.tier) openRandom(s, d.tool('axe').count ?? 0, 'tool')
  // Tusk: inmates on the block each gain a tier.
  if (cell.ivory && s.boardCellOf(fresh.id) !== null) {
    const pool = boardInmates(s).filter((i) => s.params.ivoryIncludesSwapped || i.id !== fresh.id)
    shuffle(s, pool)
    if (pool.length > s.params.ivoryCount) pool.length = s.params.ivoryCount
    for (const inmate of pool) {
      if (s.boardCellOf(inmate.id) !== null) promote(s, inmate, 1, false)
    }
  }
  return Ok
}

/** Ends the day. */
export function endDay(s: State): Outcome {
  const reason = guard(s, 'manage')
  if (reason !== null) return fail(reason)
  advanceDay(s)
  return Ok
}

/** Picks an option of the first pending choice. */
export function choose(s: State, id: ChoiceId): Outcome {
  const choice = s.pending[0]
  if (choice === undefined) return fail('There is nothing to choose right now.')
  // A chain choice's options are target cells: picking one is the next bite.
  if (choice.kind === 'chain') {
    return typeof id === 'number' ? devourNext(s, id) : fail('That Inmate cannot consume that target.')
  }
  // A cell choice (Sewer Ratway) moves the warden to the picked cell.
  if (choice.kind === 'cell') {
    return typeof id === 'number' ? ratwayMove(s, id) : fail('The Sewer Ratway cannot lead there.')
  }
  // The Hunt's target pick marks the picked cell's inmate as prey.
  if (choice.kind === 'prey') {
    if (typeof id !== 'number') return fail('The Hunt cannot mark that target.')
    s.pending.shift()
    return hunt(s, id)
  }
  let picked: { kind: 'tool'; tool: Tool } | { kind: 'gift'; gift: Gift } | { kind: 'card'; card: Card } | null = null
  if (typeof id === 'string') {
    if (choice.kind === 'tool') {
      const tool = toolFromKey(id)
      if (tool !== null && choice.options.includes(tool)) picked = { kind: 'tool', tool }
    } else if (choice.kind === 'gift') {
      const gift = giftFromKey(id)
      if (gift !== null && choice.options.includes(gift)) picked = { kind: 'gift', gift }
    } else if (choice.kind === 'interrogation') {
      const card = cardFromKey(id)
      if (card !== null && choice.options.includes(card)) picked = { kind: 'card', card }
    }
  }
  if (picked === null) return fail('That option is not on offer.')
  const removed = s.pending.shift() as Pending
  if (picked.kind === 'card') {
    interrogate(s, picked.card)
  } else if (picked.kind === 'gift') {
    // Opulence: the next pick of the same Warden's Treasure, without this reward.
    if (removed.kind === 'gift') {
      const rest = removed.options.filter((g) => g !== picked.gift)
      if (removed.picks > 1 && rest.length > 0) {
        const pending: Pending = { kind: 'gift', options: rest, picks: removed.picks - 1 }
        s.pending.unshift(pending)
      }
    }
    applyGift(s, picked.gift)
  } else {
    takeTool(s, picked.tool)
  }
  refreshChain(s)
  return Ok
}

/** Adds `tool` to the held instruments with the effects of picking it. */
export function takeTool(s: State, tool: Tool): void {
  s.tools.push(tool)
  // A "-1 daily destination option" instrument taken before today's move drops a die now.
  const fewer = data().tool(tool).fewerDice
  if (fewer > 0 && s.phase === 'patrol' && s.dice.length > 1) {
    const keep = Math.max(s.dice.length - fewer, 1)
    if (s.dice.length > keep) s.dice.length = keep
    destinationsFromDice(s)
  }
  // A later tool pick drawn before this one may offer the same tool.
  for (const next of s.pending) {
    if (next.kind === 'tool') next.options = next.options.filter((t) => t !== tool)
  }
  s.pending = s.pending.filter((p) => !pendingIsEmpty(p))
}

/** Re-roll: a new draw replaces every instrument of the pending pick, from
 * the same pool as a fresh offer, so the old offer may come back. */
export function reroll(s: State): Outcome {
  const first = s.pending[0]
  if (first === undefined || first.kind !== 'tool') return fail('There is no instrument offer to re-roll.')
  if (s.rerolls === 0) return fail('No Re-roll left this run.')
  const count = first.options.length
  s.rerolls -= 1
  const fresh = drawTools(s, count)
  const pending = s.pending[0]
  if (pending !== undefined && pending.kind === 'tool') pending.options = fresh
  return Ok
}

/** The action of a recorded JS move, read back into the engine's shape. */
export function actionFromJson(value: unknown): Action {
  const v = value as Record<string, unknown>
  switch (v['type']) {
    case 'choose':
      return { type: 'choose', id: v['id'] as ChoiceId }
    case 'event':
      return { type: 'event' }
    case 'patrol':
      return { type: 'patrol', cell: v['cell'] as number }
    case 'devour':
      return { type: 'devour', to: v['to'] as number }
    case 'chain':
      return { type: 'chain', to: v['to'] as number }
    case 'endChain':
      return { type: 'endChain' }
    case 'swap':
      return { type: 'swap' }
    case 'hunt':
      return { type: 'hunt', cell: v['cell'] as number }
    case 'end':
      return { type: 'end' }
    case 'reroll':
      return { type: 'reroll' }
    default:
      throw new Error(`unknown action ${JSON.stringify(v['type'])}`)
  }
}
