//! The Monte Carlo solver and the trainer helpers (js/solver.js 562-790):
//! playouts, the candidate moves with their labels, `solve`, `instant` and
//! the reasons behind the strategy's pick.

import { BEAST_KEYS, RAINBOW, beastIndex, data } from '@/engine/data'
import { apply, type Action } from '@/engine/actions'
import { canDevourNow, huntTargets, startOptions } from '@/engine/devour'
import { CHAIN_REACTION, EXECUTION_EFFICIENCY, executionVictims } from '@/engine/incidents'
import { clockwisePath, drawIncident, markerSeen, patrolOptions } from '@/engine/rules'
import type { Inmate, State } from '@/engine/state'
import { cellLabel, describe, incidentName, plural, tierName, toolName } from '@/engine/text'

import { chainOdds } from './chain'
import { Rng32, TOOL_RANK, TUNED, composition, decide, decideBite, sameAction, type Params } from './mod'
import { patrolWhy } from './scores'

/** The first round count where racing drops trailing candidates. */
const RACE_FROM = 200
/** Rounds between racing checkpoints after `RACE_FROM`. */
const RACE_EVERY = 100
/** The paired standard errors a candidate may trail the leader by. */
const RACE_Z = 3.0

/** playout: plays the run to the end with the strategy. A failed move is
 * followed by an End Day; if that fails too, the playout stops. */
export function playout(st: State, p: Params, roll: Rng32): void {
  for (let i = 0; i < 2000; i++) {
    if (st.phase === 'ended') break
    const action = decide(st, p, roll)
    if (action === null) break
    if (!apply(st, action).ok && !(action.type !== 'end' && apply(st, { type: 'end' }).ok)) break
  }
}

/** hideFuture: re-rolls everything the player can't see, the game's dice and
 * any occupant behind a door that hasn't been fully revealed. */
export function hideFuture(st: State, seed: number): void {
  const random = new Rng32(seed)
  st.rng = (random.roll() * 4294967296) >>> 0
  // A marker whose incident the player can't see is any that fits its
  // cell, drawn by weight.
  for (let n = 0; n < st.cells.length; n++) {
    if (st.cells[n].event === null || markerSeen(st)) continue
    const id = drawIncident(st, [n])
    if (id !== null) st.cells[n].event = id
  }
  for (const c of st.cells) {
    if (!c.sealed || c.known >= 2) continue
    if (c.hidden === null) continue
    if (c.known === 1) {
      c.hidden.beast = BEAST_KEYS[Math.floor(random.roll() * 4)]
    } else {
      c.hidden = null
    }
  }
}

/** A move worth comparing, with its label. */
export interface Candidate {
  action: Action
  label: string
}

/** candidate: a move worth comparing, with its label. */
export function candidate(action: Action, label: string): Candidate {
  return { action, label }
}

/** huntReason: why a Hunt on the target in cell `n`: the prey and its Lion
 * rise each morning. */
export function huntReason(st: State, n: number): string {
  const prey = st.cells[n].inmate!
  return `The ${describe(prey)} in ${cellLabel(n)} and the Berserk Lion rise a tier on each of the next ${plural(
    st.params.preyRounds,
    'morning',
  )}.`
}

/** huntLabel: the label of a Hunt on the target in cell `n`. */
export function huntLabel(st: State, n: number): string {
  const prey = st.cells[n].inmate!
  return `${data().huntName}: mark the ${describe(prey)} in ${cellLabel(n)} as prey`
}

/** candidates: the moves worth comparing at this point of the run. */
export function candidates(st: State): Candidate[] {
  const out: Candidate[] = []
  if (st.phase === 'ended') return out
  const choice = st.pending.at(0)
  if (choice !== undefined) {
    switch (choice.kind) {
      case 'chain':
        for (const n of choice.options) {
          out.push(candidate({ type: 'chain', to: n }, `Chain on into ${cellLabel(n)}`))
        }
        out.push(candidate({ type: 'endChain' }, 'End the chain'))
        break
      case 'cell':
        for (const n of choice.options) {
          out.push(candidate({ type: 'choose', id: n }, `Move to ${cellLabel(n)}`))
        }
        break
      case 'prey':
        for (const n of choice.options) {
          out.push(candidate({ type: 'choose', id: n }, huntLabel(st, n)))
        }
        break
      case 'interrogation':
        for (const c of choice.options) {
          out.push(candidate({ type: 'choose', id: c }, toolName(c)))
        }
        break
      case 'tool':
        for (const t of choice.options) {
          out.push(candidate({ type: 'choose', id: t }, `Take ${toolName(t)}`))
        }
        if (st.rerolls > 0) {
          out.push(candidate({ type: 'reroll' }, 'Re-roll'))
        }
        break
      case 'gift':
        for (const g of choice.options) {
          out.push(candidate({ type: 'choose', id: g }, `Take ${toolName(g)}`))
        }
        break
    }
    return out
  }
  if (st.phase === 'event' && st.event !== null) {
    out.push(candidate({ type: 'event' }, `Confirm ${incidentName(st.event.id)}`))
    return out
  }
  if (st.phase === 'patrol') {
    for (const n of patrolOptions(st)) {
      const c = st.cells[n]
      let what: string
      if (st.chain) {
        const opens = clockwisePath(st, n).filter((k) => st.cells[k].sealed).length
        what = `the chain opens ${plural(opens, 'door')}`
      } else if (n === data().room) {
        what = 'Instigate or Bestow'
      } else if (c.event !== null) {
        what = !markerSeen(st) ? 'a Prison Incident marker' : `the ${incidentName(c.event)} marker`
      } else if (c.sealed) {
        what = c.nest !== null ? 'the Rat Nest' : 'a locked door'
      } else if (c.inmate !== null) {
        what = `the ${describe(c.inmate)}`
      } else {
        what = 'an empty cell'
      }
      const to = n === data().room ? 'the Interrogation Room' : `cell ${cellLabel(n)}`
      out.push(candidate({ type: 'patrol', cell: n }, `Go to ${to} (${what})`))
    }
    return out
  }
  const here = st.cells.at(st.position)
  for (const o of startOptions(st)) {
    const meal = o.scratch ? 'the scratched door' : `the ${describe(st.cells[o.cell].inmate!)}`
    out.push(candidate({ type: 'devour', to: o.cell }, `Consume ${meal} in ${cellLabel(o.cell)}`))
  }
  if (here !== undefined && here.inmate !== null && !here.sealed && st.used.swap < st.params.swapsPerDay) {
    out.push(candidate({ type: 'swap' }, `Replace the ${describe(here.inmate)} in ${cellLabel(here.n)}`))
  }
  for (const n of huntTargets(st)) {
    out.push(candidate({ type: 'hunt', cell: n }, huntLabel(st, n)))
  }
  out.push(candidate({ type: 'end' }, st.day >= st.maxDays ? 'Finish the run' : 'End the day'))
  return out
}

/** pairedSe: the standard error of the mean difference between two options'
 * values on the same dice (rounds an option couldn't play are NaN, skipped). */
export function pairedSe(a: number[], b: number[]): number {
  let n = 0
  let sum = 0
  let sq = 0
  const len = Math.min(a.length, b.length)
  for (let i = 0; i < len; i++) {
    const d = a[i] - b[i]
    if (Number.isNaN(d)) continue
    n += 1
    sum += d
    sq += d * d
  }
  if (n < 2) return Infinity
  const m = sum / n
  return Math.sqrt(Math.max(0, sq / n - m * m) / n)
}

/** stats: the playouts that count (NaN skipped), their mean and its standard error. */
export function stats(v: number[]): [number, number, number] {
  let n = 0
  let sum = 0
  let sq = 0
  for (const x of v) {
    if (Number.isNaN(x)) continue
    n += 1
    sum += x
    sq += x * x
  }
  const count = n
  const mean = n > 0 ? sum / count : 0
  const sd = n > 1 ? Math.sqrt(Math.max(0, sq / count - mean * mean)) : 0
  return [n, mean, n > 1 ? sd / Math.sqrt(count) : 0]
}

/** One ranked option of `solve`. */
export interface SolveOption {
  label: string
  action: Action
  /** Riot loot per playout, in Chromatics (`State::loot`). */
  mean: number
  se: number
  /** The paired standard error of the margin to the leader (0 for the
   * leader, infinite with fewer than 2 paired rounds). */
  gapSe: number
  /** Playouts that ran: fewer than the rounds for a move the playouts
   * dropped early (see `Rollouts`) or one that could not apply. */
  n: number
  /** The best rarity reached, averaged. */
  best: number
  /** The strategy's own pick. */
  policy: boolean
}

/** solve: plays every candidate out `rollouts` times and ranks them by
 * Riot loot. Each round shares its dice across candidates (common
 * random numbers), so the differences between moves are measured, not the
 * luck. Past `RACE_FROM` rounds, moves that clearly trail stop early and
 * the solve ends once one move is left (see `Rollouts`). */
export function solve(st: State, rollouts: number, seed: number, p: Params): SolveOption[] {
  const r = new Rollouts(st, seed, p)
  r.run(rollouts)
  return r.ranking()
}

/** A stretch of rounds to play: the seeds in round order, the candidates
 * that play them, and whether the stretch ends on a racing checkpoint. */
export interface Stretch {
  seeds: number[]
  live: number[]
  race: boolean
}

/** `solve` in steps: `run` adds rounds and `ranking` ranks the rounds so far,
 * so a caller can show partial rankings. Running N rounds in any number of
 * steps, on any number of threads, gives the same ranking as `solve` with N
 * rollouts. A round depends on its seed alone, so the rounds of a stretch
 * (`next`, `playRounds`, `commit`) can be played on other threads: the seeds
 * are drawn in order first and the results taken in seed order.
 *
 * Racing: at round `RACE_FROM` and every `RACE_EVERY` rounds after, a
 * candidate whose mean trails the leader's (the best of those still
 * running) by more than `RACE_Z` paired standard errors plays no more
 * rounds and keeps the values it has. The checkpoints fall on fixed round
 * counts, so racing keeps the ranking independent of steps and threads.
 * With one candidate left the solve is over and `run` plays nothing more. */
export class Rollouts {
  private base: State
  private p: Params
  private list: Candidate[]
  private pick: Action | null
  private random: Rng32
  private vals: number[][]
  private best: number[]
  /** The candidates still playing rounds. */
  private live: boolean[]
  /** The rounds played so far. */
  private played: number

  constructor(st: State, seed: number, p: Params, bite: number[] | null = null) {
    this.base = st.clone()
    this.p = p
    const only = bite
    let list = candidates(this.base)
    if (only !== null) {
      list = list.filter((c) => {
        if (c.action.type !== 'devour') return false
        return only.includes(c.action.to)
      })
    }
    this.list = list
    const roll = new Rng32(seed ^ 0x5bd1e995)
    this.pick =
      list.length === 0
        ? null
        : only !== null
          ? decideBite(this.base, p, roll, only)
          : decide(this.base, p, roll)
    this.random = new Rng32(seed)
    const n = list.length
    this.vals = Array.from({ length: n }, () => [] as number[])
    this.best = new Array<number>(n).fill(0)
    this.live = new Array<boolean>(n).fill(true)
    this.played = 0
  }

  /** With `bite`, a Consume target pick: only today's first bites into
   * those cells compete, and the strategy's pick is its best bite (see
   * `decideBite`). */
  static with(st: State, seed: number, p: Params, bite: number[] | null): Rollouts {
    return new Rollouts(st, seed, p, bite)
  }

  /** Rounds played so far. */
  rounds(): number {
    return this.played
  }

  /** Plays up to `rounds` more rounds and returns how many ran (none with
   * fewer than two candidates running: there is nothing to compare). */
  run(rounds: number): number {
    let ran = 0
    for (;;) {
      const stretch = this.next(rounds - ran)
      if (stretch === null) return ran
      this.commit(stretch, this.playRounds(stretch.seeds, stretch.live))
      ran += stretch.seeds.length
    }
  }

  /** Draws the seeds of the next stretch: at most `rounds` rounds, and no
   * further than the next racing checkpoint. Null when no round is left to
   * play or fewer than two candidates run. */
  next(rounds: number): Stretch | null {
    if (rounds <= 0 || this.running().length < 2) return null
    const checkpoint = Math.max(RACE_FROM, (Math.floor(this.played / RACE_EVERY) + 1) * RACE_EVERY)
    const step = Math.min(rounds, checkpoint - this.played)
    const seeds: number[] = []
    for (let i = 0; i < step; i++) {
      seeds.push((this.random.roll() * 4294967296) >>> 0)
    }
    return { seeds, live: this.running(), race: this.played + step === checkpoint }
  }

  /** One round per seed for the candidates `live`. The rounds do not touch
   * the ranking, and any `Rollouts` built from the same board, seed and
   * weights plays them the same. */
  playRounds(seeds: number[], live: number[]): [number, number][][] {
    return seeds.map((seed) => this.round(seed, live))
  }

  /** Takes the rounds of a stretch `next` drew, one per seed in the seeds'
   * order, and races at the stretch's end when it ends on a checkpoint. */
  commit(stretch: Stretch, results: [number, number][][]): void {
    for (const round of results) {
      for (let i = 0; i < stretch.live.length; i++) {
        const k = stretch.live[i]
        const [val, best] = round[i]
        this.vals[k].push(val)
        this.best[k] += best
      }
      this.played += 1
    }
    if (stretch.race) this.race()
  }

  /** The indices of the candidates still playing rounds. */
  private running(): number[] {
    const out: number[] = []
    for (let k = 0; k < this.list.length; k++) {
      if (this.live[k]) out.push(k)
    }
    return out
  }

  /** Drops the running candidates that trail the leader by more than
   * `RACE_Z` paired standard errors. */
  private race(): void {
    const means = this.vals.map((v) => stats(v)[1])
    const live = this.running()
    let lead = live[0]
    for (const k of live) {
      if (means[k] > means[lead]) lead = k
    }
    for (const k of live) {
      if (k !== lead && means[lead] - means[k] > RACE_Z * pairedSe(this.vals[lead], this.vals[k])) {
        this.live[k] = false
      }
    }
  }

  /** One round on `seed`: per candidate of `live`, the Riot loot (NaN when
   * the move does not apply) and the best rarity reached (0 then). */
  private round(seed: number, live: number[]): [number, number][] {
    // The hidden future is the same for every candidate of the round.
    const hidden = this.base.clone()
    hideFuture(hidden, seed)
    const out: [number, number][] = []
    for (const k of live) {
      const c = this.list[k]
      const trial = hidden.clone()
      if (!apply(trial, c.action).ok) {
        out.push([NaN, 0])
        continue
      }
      playout(trial, this.p, new Rng32(seed ^ 0x9e3779b9))
      // Second measure: the best rarity reached.
      let top = 0
      for (const cell of trial.cells) {
        if (cell.inmate === null || cell.sealed) continue
        if (cell.inmate.tier > top) top = cell.inmate.tier
      }
      const vaulted = trial.vault.length === 0 ? 0 : RAINBOW
      out.push([trial.loot(), Math.max(top, vaulted, 0)])
    }
    return out
  }

  /** The candidates ranked on the rounds played so far: those still
   * running first, so the first row has played every round. */
  ranking(): SolveOption[] {
    const ranked = this.vals.map((v, k) => ({ k, s: stats(v) }))
    ranked.sort((a, b) => {
      // The running candidates first (Rust's `false < true`).
      const live = (this.live[b.k] ? 1 : 0) - (this.live[a.k] ? 1 : 0)
      if (live !== 0) return live
      // Then the mean and the best rarity, both down, as Rust's
      // `partial_cmp`, which treats a NaN as equal.
      const bm = b.s[1]
      const am = a.s[1]
      if (!Number.isNaN(bm) && !Number.isNaN(am) && bm !== am) return bm > am ? 1 : -1
      const bb = this.best[b.k]
      const ab = this.best[a.k]
      if (!Number.isNaN(bb) && !Number.isNaN(ab) && bb !== ab) return bb > ab ? 1 : -1
      return 0
    })
    const top = ranked.length > 0 ? ranked[0].k : 0
    const pick = this.pick
    return ranked.map(({ k, s }) => ({
      label: this.list[k].label,
      action: this.list[k].action,
      mean: s[1],
      se: s[2],
      gapSe: k === top ? 0 : pairedSe(this.vals[top], this.vals[k]),
      n: s[0],
      best: s[0] > 0 ? this.best[k] / s[0] : 0,
      policy: pick !== null && sameAction(pick, this.list[k].action),
    }))
  }
}


/** The strategy's pick with its label and a short reason (instant: no playouts). */
export interface Instant {
  action: Action
  label: string
  why: string
}

/** instant: the strategy's pick with its label and a short reason. */
export function instant(st: State): Instant | null {
  const action = decide(st, TUNED, new Rng32(1))
  return action === null ? null : labelled(st, action)
}

/** `instant` on a Consume target pick: the strategy's best bite into one of
 * the cells of `only`. */
export function instantBite(st: State, only: number[]): Instant | null {
  const action = decideBite(st, TUNED, new Rng32(1), only)
  return action === null ? null : labelled(st, action)
}

/** labelled: the pick with the label of its candidate, or the move's own
 * kind when it is none of them. */
export function labelled(st: State, action: Action): Instant {
  const found = candidates(st).find((c) => sameAction(c.action, action))
  const label = found !== undefined ? found.label : action.type
  const why = reason(st, action)
  return { action, label, why }
}

/** toFixed: like Rust's `{:.d$}`, but a tie rounds up as in the JS. */
export function toFixed(x: number, d: number): string {
  // Rust's `{:.d}` rounds a tie to even, but its own `to_fixed` bumps an
  // exact tie up by one ULP, so a tie rounds away from zero: what the JS
  // `toFixed` does.
  return x.toFixed(d)
}

/** coinReason: with Kin's Coin of Fate and a morning left, the match a
 * Consume or Replace available now would break (the warden's inmate or a
 * meal in it), as the reason to end the day instead. */
export function coinReason(st: State): string | null {
  if (!st.has('coin') || st.day >= st.maxDays) return null
  const [board] = composition(st, null)
  const matched = (i: Inmate): boolean => i.tier < RAINBOW && board[i.tier * 4 + beastIndex(i.beast)] >= 2
  const cell = st.cells.at(st.position)
  const here = cell !== undefined && cell.inmate !== null && !cell.sealed ? cell.inmate : null
  const starts = startOptions(st)
  const acts = starts.length > 0 || st.used.swap < st.params.swapsPerDay
  const meals = starts
    .filter((o) => !o.scratch)
    .map((o) => st.cells[o.cell].inmate)
    .filter((i): i is Inmate => i !== null)
  const kept = here !== null && acts && matched(here) ? here : (meals.find(matched) ?? null)
  if (kept === null) return null
  const cells = st.cells
    .filter((c) => c.inmate !== null && !c.sealed && c.inmate.beast === kept.beast && c.inmate.tier === kept.tier)
    .map((c) => c.n)
  cells.sort((a, b) => Number(a !== st.position) - Number(b !== st.position))
  const labels = cells.map(cellLabel)
  const last = labels.pop() ?? ''
  const coin = data().tool('coin')
  const pair = cells.length === 2
  return `Keep the ${describe(kept)} ${pair ? 'pair' : 'match'} in ${labels.join(', ')} and ${last}: ${toolName(
    'coin',
  )} has a ${toFixed(coin.chance, 0)}% chance each morning to remove one and raise ${
    pair ? 'the other' : 'another'
  } to ${tierName(kept.tier + (coin.tiers ?? 0))}.`
}

/** guillotineCut: with Scapegoat's Guillotine armed for a Replace in the
 * warden's cell, how many of the other inmates on the block it removes, and
 * how many there are. */
export function guillotineCut(st: State): [number, number] | null {
  const def = data().tool('scapegoat')
  const cell = st.cells.at(st.position)
  if (!st.has('scapegoat') || cell === undefined || cell.inmate === null || cell.sealed) return null
  const others = st.boardCells().length - 1
  if (others <= 0 || others < (def.minOthers ?? 0)) return null
  return [Math.min(def.count ?? 0, others), others]
}

/** reason: why the strategy plays `action`, in a sentence. */
export function reason(st: State, action: Action): string {
  const here = st.cells.at(st.position)
  switch (action.type) {
    case 'patrol': {
      if (!patrolOptions(st).includes(action.cell)) return ''
      const why = patrolWhy(st, action.cell)
      const chars = Array.from(why)
      if (chars.length === 0) return ''
      return `${chars[0].toUpperCase()}${chars.slice(1).join('')}.`
    }
    case 'devour': {
      const [rainbow, bites] = chainOdds(st, st.position, action.to)
      return `The best first meal: its chain averages ${toFixed(bites, 1)} bites, with ${toFixed(
        100 * rainbow,
        0,
      )}% to reach Chromatic.`
    }
    case 'swap': {
      const cell = st.cells[st.position]
      const cut = guillotineCut(st)
      if (cut !== null) {
        return `${toolName('scapegoat')} removes ${cut[0]} of the ${cut[1]} other Inmates, and the new Inmate is sure to be rarer than ${tierName(
          cell.inmate!.tier,
        )}.`
      }
      if (cell.ivory) {
        return 'A Tusk cell: replacing it raises other Inmates a tier.'
      }
      if (st.day >= st.maxDays) {
        return 'The last day: only a Chromatic counts now, and the new Inmate may still consume its way to one today.'
      }
      return `${tierName(cell.inmate!.tier)} Inmates are worth less than a fresh roll on average.`
    }
    case 'end': {
      const coin = coinReason(st)
      if (coin !== null) return coin
      const cut = guillotineCut(st)
      if (cut !== null && st.used.swap < st.params.swapsPerDay) {
        return `Skip the Replace: ${toolName('scapegoat')} would remove ${cut[0]} of the ${cut[1]} other Inmates.`
      }
      const starts = startOptions(st)
      if (!canDevourNow(st) || starts.length === 0) {
        return 'Nothing left today is worth doing.'
      }
      // A devour is skipped only when it costs more than it gains:
      // nearly always because it would end a prey mark.
      const marked =
        (here !== undefined && here.inmate !== null && st.linkOf(here.inmate.id) !== null) ||
        starts.some((o) => {
          const i = st.cells[o.cell].inmate
          return i !== null && st.linkOf(i.id) !== null
        })
      if (marked) {
        return 'Skip today’s consume: it would end a prey mark, and the free tier each morning is worth more than one bite.'
      }
      return 'Every consume here would cost more than it gains today.'
    }
    case 'event': {
      const event = st.event!
      if (event.id === CHAIN_REACTION) {
        return 'Your next walk opens every sealed door on the way.'
      }
      const exec = event.id === EXECUTION_EFFICIENCY ? st.cells[event.cell].inmate : null
      if (exec === null) return 'An incident can only be confirmed.'
      const victims = executionVictims(st, event.cell).length
      return `The ${describe(exec)} removes ${plural(victims, 'inmate')} and rises as many tiers.`
    }
    case 'chain':
      return 'This bite is worth more than stopping here.'
    case 'endChain':
      return 'Every next bite would cost more than it gains.'
    case 'hunt':
      return huntReason(st, action.cell)
    case 'reroll':
      return 'A new offer is likely to beat every instrument here.'
    case 'choose': {
      const id = action.id
      const choice = st.pending.at(0)
      if (choice !== undefined) {
        switch (choice.kind) {
          case 'gift':
            return 'Worth the most on this board right now.'
          case 'cell':
            return 'The best landing by the patrol scores.'
          case 'prey': {
            if (typeof id !== 'number') return ''
            return huntReason(st, id)
          }
          case 'interrogation': {
            if (typeof id !== 'string') return ''
            return `${toolName(id)} leaves this board worth more than the other card, on average.`
          }
          default:
            break
        }
      }
      // An instrument offer: the rank of the offered instrument.
      if (typeof id !== 'string') return ''
      const rank = TOOL_RANK.findIndex((t) => t === id)
      return rank < 0 ? '' : `Ranked #${rank + 1} of ${TOOL_RANK.length} Torture Instruments in training.`
    }
  }
  return ''
}
