//! The board model: fixture boards in tests/boards build the same state as
//! the analyzer's buildState (tests/fixtures/board-states.jsonl, recorded from
//! the earlier JS engine), problems read as in the JS, and the model's own
//! rules. A port of the Rust crate's tests/board.rs.

import { expect, test } from 'bun:test'

import { apply, type Action } from '@/engine/actions'
import { CAGE_FIGHT, beastIndex, data, toolFromKey, type Beast, type Gift, type Tool } from '@/engine/data'
import { bites, devourOptions, eaterMask } from '@/engine/devour'
import { CHAIN_REACTION, EXECUTION_EFFICIENCY, SEWER_RATWAY } from '@/engine/incidents'
import { markerSeen, openCell, stepsBetween } from '@/engine/rules'
import type { Phase, State } from '@/engine/state'
import { toolName } from '@/engine/text'
import { buildState, modelFromJson, type CellModel, type Model } from '@/board/board'
import { Rng32, TUNED, composition, context, decide, doorDist } from '@/solver/mod'
import { bite, chainOdds, devourDelta, replaceOdds, rise } from '@/solver/chain'
import { devourScores, patrolScores, swapGainHere } from '@/solver/scores'
import { swapValue } from '@/solver/values'
import { instant, reason, solve, type SolveOption } from '@/solver/solve'
import { preferChange, whyShown, type Advice } from '@/solver/advise'
import { start } from '@/solver/bench'

import { buildBoard, firstDiff, normalize, rawBoard, recorded } from './common'

const GOOD = ['patrol.json', 'manage.json', 'choice.json', 'ratway.json']

/** The cells of a raw board, as plain objects. */
function cellsOf(board: Record<string, unknown>): Record<string, unknown>[] {
  return board['cells'] as Record<string, unknown>[]
}

/** The board of `name` with these instruments held. */
function withTools(name: string, tools: Tool[]): State {
  const m = rawBoard(name)
  m['tools'] = tools
  return buildState(modelFromJson(m), 1)[0]
}

/** manage.json with `objective` set as the board JSON carries it. */
function withObjective(objective: unknown): Model {
  const m = rawBoard('manage.json')
  m['objective'] = objective
  return modelFromJson(m)
}

/** A block of two open inmates, the eater in cell 5 and its meal in cell 9,
 * every other cell sealed, with these instruments held; the meal is the
 * first beast the eater counters, at `mealTier`. */
function duel(tools: Tool[], eater: Beast, eaterTier: number, mealTier: number): State {
  const m = rawBoard('coin-pair-day15.json')
  m['tools'] = tools
  const meal = data().foodChain[beastIndex(eater)][0]
  const cells = cellsOf(m)
  for (let n = 1; n < cells.length; n++) {
    cells[n] = { kind: 'sealed', event: null }
    if (n === 5 || n === 9) {
      const [beast, tier] = n === 5 ? [eater, eaterTier] : [meal, mealTier]
      cells[n] = { kind: 'inmate', beast, tier }
    }
  }
  return buildState(modelFromJson(m), 1)[0]
}

/** The value of a bite by the Rare eater of a duel on its Rare meal, as the
 * day's first bite or a chained one, with these instruments held. */
function duelBite(tools: Tool[], eater: Beast, chained: boolean): number {
  const st = duel(tools, eater, 2, 2)
  const ctx = context(st, TUNED)
  const [comp, crowd] = composition(st, 5)
  const meal = st.cells[9].inmate
  if (meal === null) throw new Error('no meal')
  const beast = beastIndex(meal.beast)
  comp[2 * 4 + beast] -= 1
  return bite(ctx, 2, beastIndex(eater), { tier: 2, beast, base: 1, chance: 1.0 }, chained, comp, crowd)
}

/** The guillotine-last-day board (a Rare Wolf in 02, a Legendary Lion in 08,
 * a Normal Lion in 11, the warden in 12) with the warden's inmate and these
 * open inmates set as (cell, tier), and these instruments held. */
function replaceBoard(tools: Tool[], wardenTier: number, set: [number, number][]): State {
  const m = rawBoard('guillotine-last-day.json')
  m['tools'] = tools
  const cells = cellsOf(m)
  cells[12] = { kind: 'inmate', beast: 'wolf', tier: wardenTier }
  for (const [n, tier] of set) {
    cells[n]['tier'] = tier
  }
  return buildState(modelFromJson(m), 1)[0]
}

/** The tier odds of a Replace in the warden's cell, and its value. */
function replace(st: State): [number[], number] {
  const ctx = context(st, TUNED)
  const [comp, crowd] = composition(st, 12)
  const inmate = st.cells[12].inmate
  if (inmate === null) throw new Error('no inmate')
  const dist = replaceOdds(ctx, inmate.tier, comp, crowd - 1)[0]
  return [dist, swapValue(ctx, inmate.tier, comp, crowd - 1)]
}

/** The JS pending choice has no `reason` or `picks` and its `used` no
 * `hunt`; the engine reads those absences as Start, 1 and 0. */
function dropRustOnly(rust: Record<string, unknown>, js: Record<string, unknown>): void {
  const used = rust['used'] as Record<string, unknown>
  const jsUsed = (js['used'] ?? {}) as Record<string, unknown>
  if (!('hunt' in jsUsed)) delete used['hunt']
  const params = rust['params'] as Record<string, unknown>
  const jsParams = (js['params'] ?? {}) as Record<string, unknown>
  if (!('vaultCap' in jsParams)) delete params['vaultCap']
  for (const key of ['maiden', 'hiddenIncidents', 'markersAvoidWarden']) {
    if (!(key in jsParams)) delete params[key]
  }
  const pending = rust['pending'] as Record<string, unknown>[]
  const jsPending = (js['pending'] ?? []) as Record<string, unknown>[]
  for (let i = 0; i < pending.length && i < jsPending.length; i++) {
    for (const key of ['reason', 'picks']) {
      if (!(key in jsPending[i])) delete pending[i][key]
    }
  }
}

test('problem boards read as in the js', () => {
  const cases: [string, string][] = [
    ['problem-prey.json', 'The prey mark from the Lion in cell 03 needs a same-rarity meal in cell 02.'],
    [
      'problem-doors.json',
      "Mark today's doors: tick them under \u201cSelect a Destination\u201d, or select a cell and press Today's door.",
    ],
    [
      'problem-event.json',
      "A Prison Incident needs the Inmate that came out of the door in the warden's cell: put the warden there and set its Inmate.",
    ],
  ]
  for (const [name, text] of cases) {
    expect(buildBoard(name)[1], name).toEqual([text])
  }
})

test('good boards build the model', () => {
  const d = data()
  for (const name of GOOD) {
    const m = rawBoard(name)
    const [st, problems] = buildBoard(name)
    expect(problems, name).toEqual([])
    const raw = cellsOf(m)
    for (let n = 0; n < raw.length; n++) {
      const c = raw[n]
      const inmate = st.cells[n].inmate
      if (c['kind'] === 'inmate') {
        if (inmate === null) throw new Error(`${name} cell ${n}: no inmate`)
        expect(st.cells[n].sealed, `${name} cell ${n}`).toBe(false)
        expect(inmate.beast, `${name} cell ${n}`).toEqual(c['beast'] as Beast)
        expect(inmate.tier, `${name} cell ${n}`).toEqual(c['tier'] as number)
      } else {
        expect(inmate, `${name} cell ${n}`).toBeNull()
      }
    }
    expect(st.position, name).toEqual(m['warden'] as number)
    const step = m['step'] as string
    const phase: Phase = step === 'patrol' ? 'patrol' : step === 'event' ? 'event' : 'manage'
    expect(st.phase, name).toEqual(phase)
    for (let i = 1; i < st.destinations.length; i++) {
      expect(stepsBetween(st.position, st.destinations[i - 1]), name).toBeLessThanOrEqual(
        stepsBetween(st.position, st.destinations[i]),
      )
    }
    const tools = ((m['tools'] ?? []) as string[])
      .map((key) => toolFromKey(key))
      .filter((t): t is Tool => t !== null)
    const order = d.toolIds.filter((t) => tools.includes(t))
    expect(st.tools, name).toEqual(order)
    if (phase !== 'patrol') {
      const used = {
        swap: m['swapUsed'] === true ? 1 : 0,
        devour: m['devourUsed'] === true ? 1 : 0,
        hunt: m['huntUsed'] === true ? 1 : 0,
      }
      expect(st.used, name).toEqual(used)
    }
    const action = decide(st, TUNED, new Rng32(1))
    if (action === null) throw new Error(`${name}: no action`)
    expect(apply(st.clone(), action).ok, `${name}: ${JSON.stringify(action)} refused`).toBe(true)
  }
  const [patrol] = buildBoard('patrol.json')
  expect(patrol.destinations).toEqual([5, 9, 14])
  expect(patrol.vault.map((v) => v.beast)).toEqual(['wolf'])
  expect(patrol.prey.length).toBe(1)
  expect(patrol.cells[5].event !== null && !markerSeen(patrol)).toBe(true)
})

/** The Sewer Ratway cell pick: every cell but the room is an option, the
 * solver moves the warden to one, and markers on open cells reach the state. */
test('ratway board picks a cell', () => {
  const d = data()
  const [st, problems] = buildBoard('ratway.json')
  expect(problems).toEqual([])
  const all: number[] = []
  for (let n = 0; n < d.cellCount; n++) {
    if (n !== d.room) all.push(n)
  }
  expect(st.pending).toEqual([{ kind: 'cell', id: SEWER_RATWAY, options: all }])
  expect(st.cells[3].event).toEqual(CHAIN_REACTION)
  expect(markerSeen(st)).toBe(false)
  expect([st.cells[5].event, st.cells[5].sealed]).toEqual([EXECUTION_EFFICIENCY, false])
  expect(st.cells[12].event).toBeNull()
  const pick = instant(st)
  if (pick === null) throw new Error('no pick')
  expect(pick.label.startsWith('Move to ')).toBe(true)
  const options = solve(st, 20, 1, TUNED)
  expect(options.length > 0 && options.every((o) => o.label.startsWith('Move to '))).toBe(true)
})

/** The new fields survive a JSON round trip, and an open cell without an
 * `event` (older board files) has none. */
test('open cell markers round trip', () => {
  const model = modelFromJson(rawBoard('ratway.json'))
  expect(model.choice.kind).toEqual('cell')
  expect(model.cells[5]).toEqual({ kind: 'empty', event: 'execution' })
  expect(model.cells[12]).toEqual({ kind: 'empty', event: null })
  const marked = model.cells[3]
  expect(marked.kind).toEqual('inmate')
  expect(marked.kind === 'inmate' && marked.event).toEqual('unknown')
  const plain = model.cells[1]
  expect(plain.kind).toEqual('inmate')
  expect(plain.kind === 'inmate' && plain.event).toBeNull()
  const json = JSON.parse(JSON.stringify(model)) as Record<string, unknown>
  expect((json['choice'] as Record<string, unknown>)['kind']).toEqual('cell')
  expect((cellsOf(json)[5])['event']).toEqual('execution')
  const back = modelFromJson(json)
  expect(back.toJSON()).toEqual(model.toJSON())
})

/** `huntUsed`: absent from older board files, where it reads false; it
 * survives a JSON round trip and goes into the built state's day's uses. */
test('hunt used round trips', () => {
  const json = rawBoard('manage.json')
  expect(json['huntUsed']).toBeUndefined()
  const model = modelFromJson(json)
  expect(model.huntUsed).toBe(false)
  expect(buildState(model, 1)[0].used.hunt).toBe(0)
  json['huntUsed'] = true
  const marked = modelFromJson(json)
  expect(marked.huntUsed).toBe(true)
  const back = JSON.parse(JSON.stringify(marked)) as Record<string, unknown>
  expect(back['huntUsed']).toBe(true)
  expect(modelFromJson(back).toJSON()).toEqual(marked.toJSON())
  const [st] = buildState(marked, 1)
  expect([st.phase, st.used.hunt]).toEqual(['manage', 1])
})

/** hunt-pick: the Hunt's "Select an Objective" with the Lion in cell 3 and
 * two Rare targets, the Rat in cell 2 and the Wolf in cell 6. The pick
 * marks only the chosen one. */
test('hunt pick board offers the lion targets', () => {
  const [st, problems] = buildBoard('hunt-pick.json')
  expect(problems).toEqual([])
  expect(st.pending).toEqual([{ kind: 'prey', options: [1, 5] }])
  const pick = instant(st)
  if (pick === null) throw new Error('no pick')
  expect(pick.label.startsWith(`${data().huntName}: mark the `)).toBe(true)
  const picked = st.clone()
  expect(apply(picked, { type: 'choose', id: 5 }).ok).toBe(true)
  expect(picked.pending.length).toBe(0)
  const marked = picked.prey.map((l) => l.prey)
  const inmate = st.cells[5].inmate
  if (inmate === null) throw new Error('no inmate')
  expect(marked).toEqual([inmate.id])
  const json = rawBoard('hunt-pick.json')
  json['huntUsed'] = true
  const problems2 = buildState(modelFromJson(json), 1)[1]
  expect(problems2.length).toBe(1)
})

/** A Hunt marks the one target it names, once a day, and only a target. */
test('hunt marks one prey', () => {
  const [st] = buildBoard('hunt-pick.json')
  st.pending = []
  const fresh = st.clone()
  expect(apply(st, { type: 'hunt', cell: 9 }).ok).toBe(false)
  expect(apply(st, { type: 'hunt', cell: 6 }).ok).toBe(false)
  expect(st.prey).toEqual(fresh.prey)
  expect(apply(st, { type: 'hunt', cell: 1 }).ok).toBe(true)
  const rat = st.cells[1].inmate
  const lion = st.cells[2].inmate
  if (rat === null || lion === null) throw new Error('no inmate')
  expect(st.prey.length).toBe(1)
  expect([st.prey[0].lion, st.prey[0].prey, st.used.hunt]).toEqual([lion.id, rat.id, 1])
  expect(apply(st, { type: 'hunt', cell: 5 }).ok).toBe(false)
  expect(st.prey.length).toBe(1)
})

test('builds like the js', () => {
  let count = 0
  for (const line of recorded('board-states.jsonl')) {
    const js = line as { board: string; problems: string[]; state: Record<string, unknown> }
    const name = js.board
    const [st, problems] = buildBoard(name)
    expect(problems, `${name} problems`).toEqual(js.problems)
    const rust = JSON.parse(JSON.stringify(st)) as Record<string, unknown>
    dropRustOnly(rust, js.state)
    // The analyzer's leftover dice and incident counts come from the JS newGame: its roll of
    // independent dice repeats a step (4, 3, 3), and the Rust engine draws distinct steps
    // (docs/s16-screen.md), so the markers newGame places after the roll differ too. The board
    // sets the cells itself, so those two fields are left out of the comparison.
    const jsState = JSON.parse(JSON.stringify(js.state)) as Record<string, unknown>
    expect(jsState['dice'], `${name} JS dice`).toEqual([4, 3, 3])
    for (const v of [rust, jsState]) {
      delete v['dice']
      delete v['incidentCounts']
    }
    // The JS engine spawned markers each morning at 117 in 10000 per free cell; the run logs
    // show no morning spawn, so the board's params hold 0.
    const jsParams = jsState['params'] as Record<string, unknown>
    const rustParams = rust['params'] as Record<string, unknown>
    expect(jsParams['incidentSpawnChance'], `${name} JS spawn chance`).toEqual(117)
    expect(rustParams['incidentSpawnChance'], `${name} spawn chance`).toEqual(0)
    for (const v of [rust, jsState]) {
      delete (v['params'] as Record<string, unknown>)['incidentSpawnChance']
    }
    // The JS marks every "scratch" door scratched; the Rust only with Filthy Claws.
    if (!st.has('claws')) {
      for (const cell of cellsOf(jsState)) {
        cell['scratch'] = false
      }
    }
    // The JS marks an unnamed marker eventKnown false; the Rust board hides every incident
    // through params.hiddenIncidents.
    for (const cell of cellsOf(jsState)) {
      delete cell['eventKnown']
    }
    const diff = firstDiff('state', normalize(rust), normalize(jsState))
    if (diff !== null) throw new Error(`${name}: ${diff}`)
    count += 1
  }
  expect(count).toBe(7)
})

// The Rust test `cli_solves_a_board` drives the `warden-cli` binary, which has
// no TypeScript port: it is skipped here.

/** An objective one consume short (Survival of the Fittest, 3 of 4) is in the
 * state, and the consume completes it and queues the instrument pick. */
test('objective in the model reaches the state', () => {
  const model = withObjective({ id: 2, progress: 3 })
  expect(model.objective).toEqual({ id: 2, progress: 3 })
  const back = modelFromJson(JSON.parse(JSON.stringify(model)))
  expect(back.toJSON()).toEqual(model.toJSON())
  const [st, problems] = buildState(model, 1)
  expect(problems).toEqual([])
  expect(st.objective).toEqual({ id: 2, progress: 3, done: false })
  const consume = devourOptions(st, st.position)[0]
  if (consume === undefined) throw new Error('no consume')
  expect(apply(st, { type: 'devour', to: consume.cell }).ok).toBe(true)
  expect(st.objective).toEqual({ id: 2, progress: 4, done: true })
  expect(st.pending.some((p) => p.kind === 'tool' && p.reason === 'objective')).toBe(true)
})

/** A glowing "?" door of the eater's rarity is a Wolf's target only with
 * Filthy Claws: without it the glow is an incident showing the rarity. */
test('glowing door is scratched only with filthy claws', () => {
  const model = modelFromJson(rawBoard('manage.json'))
  model.warden = 9
  const door = (st: State): boolean => devourOptions(st, 9).some((b) => b.cell === 8 && b.scratch)
  const [st] = buildState(model, 1)
  expect([st.cells[8].scratch, st.cells[8].known]).toEqual([false, 1])
  expect(door(st)).toBe(false)
  model.tools.push('claws')
  const [withClaws] = buildState(model, 1)
  expect(withClaws.cells[8].scratch).toBe(true)
  expect(door(withClaws)).toBe(true)
})

/** Landing on a scratched door gives up the bite of an open Wolf of its
 * rarity, so the landing scores lower; with no such Wolf the scratch costs nothing. */
test('opening a scratched door gives up the wolf bite', () => {
  const score = (beast: Beast, claws: boolean): number => {
    const model = modelFromJson(rawBoard('manage.json'))
    const cell: CellModel = { kind: 'inmate', beast, tier: 0, ivory: false, prey: null, event: null }
    model.cells[9] = cell
    if (claws) model.tools.push('claws')
    const [st] = buildState(model, 1)
    expect(st.cells[8].scratch).toEqual(claws)
    const ctx = context(st, TUNED)
    return patrolScores(ctx, [8])[0][1]
  }
  expect(score('wolf', true)).toBeLessThan(score('wolf', false))
  expect(score('rat', true)).toEqual(score('rat', false))
})

test('unknown objective is a problem', () => {
  const [st, problems] = buildState(withObjective({ id: 99, progress: 0 }), 1)
  expect(st.objective).toBeNull()
  expect(problems).toEqual(['There is no objective with id 99.'])
})

test('board without objective has none', () => {
  for (const objective of [null, 'x']) {
    const [st, problems] = buildState(withObjective(objective), 1)
    expect(problems).toEqual([])
    expect(st.objective).toBeNull()
  }
  const model = modelFromJson(rawBoard('manage.json'))
  expect(model.objective).toBeNull()
  expect(JSON.parse(JSON.stringify(model))['objective']).toBeUndefined()
  expect(buildState(model, 1)[0].objective).toBeNull()
})

test('guillotine on the last day still replaces', () => {
  // Replace with Scapegoat's Guillotine removes 2 of the 3 others, but on
  // the last day they are worth only their Riot loot, so the Replace pays
  // as with Avenger's Casket (loot playouts: 2.063 against 2.050 for
  // finishing, paired error 0.001).
  for (const tools of [['scapegoat', 'rope'], ['revenge', 'rope']] as Tool[][]) {
    const st = withTools('guillotine-last-day.json', tools)
    expect(decide(st, TUNED, new Rng32(1)), JSON.stringify(tools)).toEqual({ type: 'swap' })
  }
})

test('the end reason names the instrument that decides it', () => {
  const st = withTools('coin-pair-day15.json', ['coin', 'dogtag'])
  const why = reason(st, { type: 'end' })
  expect(why.includes("Kin's Coin of Fate") && why.includes('16') && why.includes('10'), why).toBe(true)
  const last = withTools('guillotine-last-day.json', ['scapegoat', 'rope'])
  expect(reason(last, { type: 'end' }).includes("Scapegoat's Guillotine")).toBe(true)
})

test('chain odds count the avengers casket', () => {
  // The warden's inmate made a Rare Berserk Lion so it has a meal, the Rare
  // Alpha Wolf in 03; no chain on the open block reaches Chromatic.
  const odds = (tools: Tool[]): [number, number] => {
    const m = rawBoard('guillotine-last-day.json')
    m['tools'] = tools
    cellsOf(m)[12] = { kind: 'inmate', beast: 'lion', tier: 2 }
    const st = buildState(modelFromJson(m), 1)[0]
    expect(devourOptions(st, 12).map((o) => o.cell)).toEqual([2])
    return chainOdds(st, 12, 2)
  }
  expect(odds(['rope'])).toEqual([0.0, 1.25])
  const [rainbow] = odds(['revenge', 'rope'])
  expect(rainbow > 0.0, `${rainbow}`).toBe(true)
})

test('coin of fate keeps the last pair', () => {
  // Two Legendary Lions with five mornings left: Kin's Coin of Fate makes a
  // Chromatic of the pair, and a Consume by the warden's Lion breaks it.
  const cases: [Tool[], Action][] = [
    [['coin', 'dogtag'], { type: 'end' }],
    [['dogtag'], { type: 'devour', to: 11 }],
  ]
  for (const [tools, want] of cases) {
    const st = withTools('coin-pair-day15.json', tools)
    expect(decide(st, TUNED, new Rng32(1)), JSON.stringify(tools)).toEqual(want)
  }
})

test('the maul lands a mammoth two tiers above its meal', () => {
  // A Normal Mammoth eats a Rare inmate it counters: the meal leaves the
  // Rare tier and the Mammoth lands at Ultimate, with nothing left to eat.
  const st = duel(['maul'], 'mammoth', 0, 2)
  expect(devourOptions(st, 5).map((o) => o.cell)).toEqual([9])
  const ctx = context(st, TUNED)
  const [comp, crowd] = composition(st, 5)
  const before = [...comp]
  const meal = st.cells[9].inmate
  if (meal === null) throw new Error('no meal')
  const delta = devourDelta(ctx, 0, beastIndex('mammoth'), [2, beastIndex(meal.beast)], false, comp, crowd)
  expect(Math.abs(delta - (ctx.v[4] - ctx.v[2] - ctx.v[0])), `${delta}`).toBeLessThan(1e-9)
  expect(comp).toEqual(before)
})

test('the fanged guillotine prices oppress', () => {
  // An Ultimate Wolf eats a Normal Rat: Oppress lets it rise to Chromatic
  // 80% of the time (5% per tier below); else it stays Ultimate.
  const st = duel(['guillotine'], 'wolf', 4, 0)
  expect(devourOptions(st, 5).map((o) => o.cell)).toEqual([9])
  const p = 1.0 - (4.0 * data().oppressPerTier) / 100.0
  expect(Math.abs(p - 0.8)).toBeLessThan(1e-12)
  const ctx = context(st, TUNED)
  const [comp, crowd] = composition(st, 5)
  expect(st.cells[9].inmate?.beast).toEqual('rat')
  const delta = devourDelta(ctx, 4, beastIndex('wolf'), [0, beastIndex('rat')], false, comp, crowd)
  const want = -ctx.v[0] + p * ctx.r + (1.0 - p) * ctx.v[4] - ctx.v[4]
  expect(Math.abs(delta - want), `${delta} ${want}`).toBeLessThan(1e-9)
})

test('the barbed collar rolls on chained bites only', () => {
  const plain = duelBite([], 'wolf', false)
  expect(Math.abs(duelBite(['collar'], 'wolf', false) - plain)).toBeLessThan(1e-12)
  expect(duelBite(['collar'], 'wolf', true)).toBeGreaterThan(plain + 1e-6)
})

test('the barbed whip raises a chained bite', () => {
  const plain = duelBite([], 'wolf', true)
  const whip = duelBite(['whip'], 'wolf', true)
  expect(whip, `${whip} ${plain}`).toBeGreaterThan(plain + 1e-6)
})

test('the avengers casket spawns a meal for the new form', () => {
  // An Ultimate Lion on an empty block, with the Iron Crown: the Casket's
  // counter is always eaten and lands it at Chromatic.
  const st = duel(['revenge', 'crown'], 'lion', 4, 0)
  const ctx = context(st, TUNED)
  const c = data().tool('revenge').chance / 100.0
  const value = rise(ctx, 4, beastIndex('lion'), new Array<number>(24).fill(0), 1)
  const want = c * ctx.r + (1.0 - c) * ctx.v[4]
  expect(Math.abs(value - want), `${value} ${want}`).toBeLessThan(1e-9)
})

test('the crowded beastcage counts the reopened cell with reusable cells', () => {
  const st = duel(['beastcage'], 'wolf', 2, 2)
  const gain = (state: State): number => {
    const ctx = context(state, TUNED)
    const plain = context(state, TUNED)
    plain.beastcage = 0.0
    return (
      rise(ctx, 3, beastIndex('wolf'), new Array<number>(24).fill(0), 1) -
      rise(plain, 3, beastIndex('wolf'), new Array<number>(24).fill(0), 1)
    )
  }
  const c = data().tool('beastcage').chance / 100.0
  const sideValue = context(st, TUNED).sideValue
  expect(Math.abs(gain(st) - c * sideValue)).toBeLessThan(1e-9)
  expect(gain(st)).toBeGreaterThan(0.0)
  st.params.reusableCells = false
  expect(gain(st)).toBe(0.0)
})

test('the burning stake moves low rolls to legendary', () => {
  const [plain] = replace(replaceBoard([], 0, []))
  const [stake] = replace(replaceBoard(['stake'], 0, []))
  const c = data().tool('stake').chance / 100.0
  expect(Math.abs(c - 0.4)).toBeLessThan(1e-12)
  let low = 0.0
  for (let t = 0; t < 3; t++) low += plain[t]
  expect(Math.abs(stake[3] - (plain[3] + c * low)), `${JSON.stringify(stake)}`).toBeLessThan(1e-12)
  let sum = 0.0
  for (const p of stake) sum += p
  expect(Math.abs(sum - 1.0)).toBeLessThan(1e-12)
})

test('the severed iron maiden lifts a rare among rares', () => {
  // Every other open inmate is Rare: a Rare roll has none above and none
  // below, so it rises 3 tiers to Chromatic.
  const rares: [number, number][] = [
    [2, 2],
    [8, 2],
    [11, 2],
  ]
  const [plain, plainValue] = replace(replaceBoard([], 1, rares))
  // A read board gives the Maiden no rise; price it as the engine rule has it.
  const st = replaceBoard(['maiden'], 1, rares)
  st.params.maiden = true
  const [maiden, maidenValue] = replace(st)
  expect(maiden[2]).toBe(0.0)
  expect(Math.abs(maiden[5] - plain[2]), `${JSON.stringify(maiden)}`).toBeLessThan(1e-12)
  expect(maidenValue, `${maidenValue} ${plainValue}`).toBeGreaterThan(plainValue + 1e-6)
})

test('a read board gives the maiden no rise', () => {
  const rares: [number, number][] = [
    [2, 2],
    [8, 2],
    [11, 2],
  ]
  const [plain, plainValue] = replace(replaceBoard([], 1, rares))
  const [maiden, maidenValue] = replace(replaceBoard(['maiden'], 1, rares))
  expect(maiden).toEqual(plain)
  expect(Math.abs(maidenValue - plainValue), `${maidenValue} ${plainValue}`).toBeLessThan(1e-12)
})

test('the execution axe counts the burning stake', () => {
  // The Axe's part of a Replace's gain grows with the Stake's Legendaries;
  // before the last day, when the doors it opens still count.
  const gain = (tools: Tool[]): number => {
    const st = replaceBoard(tools, 0, [])
    st.day = 10
    return swapGainHere(context(st, TUNED))
  }
  const axe = gain(['axe']) - gain([])
  const axeWithStake = gain(['axe', 'stake']) - gain(['stake'])
  expect(axe > 0.0 && axeWithStake > axe + 1e-6, `${axeWithStake} ${axe}`).toBe(true)
})

test('the sorting hook and the dog tag raise an unseen door', () => {
  const ctxOf = (tools: Tool[]): [number[], number] => {
    const st = duel(tools, 'wolf', 2, 2)
    const ctx = context(st, TUNED)
    return [doorDist(st, null, true)[0], ctx.openValue]
  }
  const [plainDist, plain] = ctxOf([])
  const [hookDist, hook] = ctxOf(['hook'])
  expect(plainDist[0] > 0.0 && hookDist[0] === 0.0, `${JSON.stringify(hookDist)}`).toBe(true)
  expect(hook, `${hook} ${plain}`).toBeGreaterThan(plain + 1e-6)
  // With its chance the Dog Tag lifts the opened inmate its tiers.
  const [tagDist, tag] = ctxOf(['dogtag'])
  const def = data().tool('dogtag')
  const c = def.chance / 100.0
  const by = def.tiers ?? 0
  for (let t = 0; t < tagDist.length; t++) {
    const want = (1.0 - c) * plainDist[t] + (t >= by ? c * plainDist[t - by] : 0.0)
    expect(Math.abs(tagDist[t] - want), `${JSON.stringify(tagDist)}`).toBeLessThan(1e-12)
  }
  expect(tag, `${tag} ${plain}`).toBeGreaterThan(plain + 1e-6)
})

test('a revealed legendary door outscores an unseen one', () => {
  const st = duel([], 'wolf', 2, 2)
  const door = 7
  const score = (state: State): number => {
    const ctx = context(state, TUNED)
    return patrolScores(ctx, [door])[0][1]
  }
  // The solver stays blind to the inmate behind an unseen door.
  st.cells[door].hidden = { id: 999, beast: 'lion', tier: 3 }
  const unseen = score(st)
  st.cells[door].hidden = null
  expect(score(st)).toEqual(unseen)
  st.cells[door].hidden = { id: 999, beast: 'lion', tier: 3 }
  st.cells[door].known = 1
  const rarity = score(st)
  st.cells[door].known = 2
  const both = score(st)
  expect(rarity > unseen + 1e-6 && both > unseen + 1e-6, `${rarity} ${both} ${unseen}`).toBe(true)
})

test('the ring of keys prices the sealed doors beside a patrolled one', () => {
  // Door 7 sits between two sealed cells; door 12's neighbours are open.
  const st = duel([], 'wolf', 2, 2)
  for (const n of [11, 13]) {
    st.cells[n].sealed = false
  }
  const gap = (state: State): [number, number] => {
    const ctx = context(state, TUNED)
    const scores = patrolScores(ctx, [7, 12])
    const of = (n: number): number => {
      const found = scores.find((s) => s[0] === n)
      if (found === undefined) throw new Error(`no score for ${n}`)
      return found[1]
    }
    return [of(7) - of(12), ctx.sideValue]
  }
  const [plain] = gap(st)
  st.tools = ['keys']
  const [keys, side] = gap(st)
  // The Keys open their doors from the side: no "after opening" instrument.
  const want = 2.0 * (data().tool('keys').chance / 100.0) * TUNED.wOpen * side
  expect(Math.abs(keys - plain - want), `${keys} ${plain} ${want}`).toBeLessThan(1e-9)
})

test('the blacklist fires once fewer than its cells stay locked', () => {
  // Run logs: the game raises inmates only when at most 4 doors stay
  // locked after the open, one fewer than the instrument text's 5.
  const black = data().tool('blacklist')
  const max = black.maxSealed ?? 0
  const count = black.count ?? 0
  const tiers = black.tiers ?? 0
  expect(max).toBe(5)
  const rises = (left: number): number[] => {
    const st = duel(['blacklist'], 'wolf', 1, 0)
    while (st.sealedCells().length > left + 1) {
      const n = st.sealedCells()[0]
      st.cells[n].sealed = false
      st.cells[n].inmate = null
    }
    const door = st.sealedCells()[0]
    const before = st.cells.map((c) => (c.inmate === null ? 0 : c.inmate.tier))
    openCell(st, door, 'patrol', { beast: 'wolf', tier: 0 })
    expect(st.sealedCells().length).toBe(left)
    const out: number[] = []
    st.cells.forEach((c, i) => {
      const d = (c.inmate === null ? 0 : c.inmate.tier) - before[i]
      if (d !== 0) out.push(d)
    })
    return out
  }
  expect(rises(max)).toEqual([])
  // The opened inmate is on the board too, so it may be one of the picks.
  expect(rises(max - 1)).toEqual(new Array<number>(count).fill(tiers))
})

test('the short shackles price a short move only', () => {
  const st = duel([], 'wolf', 2, 2)
  const short = data().tool('shortchain')
  const max = short.maxSteps ?? 0
  expect(max).toBeGreaterThanOrEqual(2)
  expect(max).toBeLessThan(5)
  const at = (steps: number): number => {
    const found = st.sealedCells().find((n) => stepsBetween(st.position, n) === steps)
    if (found === undefined) throw new Error(`no door ${steps} steps away`)
    return found
  }
  const near = at(2)
  const far = at(5)
  const score = (state: State, n: number): [number, number] => {
    const ctx = context(state, TUNED)
    return [patrolScores(ctx, [n])[0][1], ctx.sideValue]
  }
  const nearPlain = score(st, near)[0]
  const farPlain = score(st, far)[0]
  st.tools = ['shortchain']
  const [nearHeld, side] = score(st, near)
  const doors = Math.min(short.count ?? 0, st.sealedCells().length - 1)
  const want = (short.chance / 100.0) * TUNED.wOpen * doors * side
  expect(want > 0.0, `${want}`).toBe(true)
  expect(Math.abs(nearHeld - nearPlain - want), `${nearHeld} ${nearPlain} ${want}`).toBeLessThan(1e-9)
  expect(Math.abs(score(st, far)[0] - farPlain)).toBeLessThan(1e-12)
})

test('ravenous chains price a meal beside the top inmate', () => {
  // A Magic Wolf in cell 5 eats Magic meals in cells 9, 11 and 13; the
  // Legendary in cell 10 is the top inmate the Chains feed with 9 and 11.
  const st = duel([], 'wolf', 1, 1)
  const meal = st.cells[9].inmate
  if (meal === null) throw new Error('no meal')
  for (const [n, id, tier] of [
    [10, 900, 3],
    [11, 901, 1],
    [13, 902, 1],
  ] as [number, number, number][]) {
    st.cells[n].sealed = false
    st.cells[n].inmate = { ...meal, id, tier }
  }
  st.position = 5
  expect(devourOptions(st, 5).map((o) => o.cell)).toEqual([9, 11, 13])
  const scores = (state: State): [number, number][] => {
    const ctx = context(state, TUNED)
    return devourScores(ctx, devourOptions(state, 5))
  }
  const plain = scores(st)
  st.tools = ['chains']
  const held = scores(st)
  const loss = (n: number): number => {
    const of = (s: [number, number][]): number => {
      const found = s.find((row) => row[0] === n)
      if (found === undefined) throw new Error(`no score for ${n}`)
      return found[1]
    }
    return of(plain) - of(held)
  }
  // Eating cell 9 leaves the Legendary one Magic neighbour to remove and one
  // roll, against two of each; the meal in cell 13 changes nothing.
  const ctx = context(st, TUNED)
  const v = ctx.v
  const r = ctx.r
  const p = data().tool('chains').chance / 100.0
  const one = p * (v[4] - v[3])
  const two = 2.0 * p * (1.0 - p) * (v[4] - v[3]) + p * p * (r - v[3])
  const want = two - one - v[1]
  expect(Math.abs(loss(13)) < 1e-9 && Math.abs(loss(9) - loss(11)) < 1e-9, `${loss(9)} ${loss(13)}`).toBe(true)
  expect(Math.abs(loss(9) - want), `${loss(9)} ${want}`).toBeLessThan(1e-9)
})

test('a tusk cell outscores the same cell unmarked', () => {
  const st = duel(['tongs'], 'wolf', 2, 2)
  const score = (state: State): number => {
    const ctx = context(state, TUNED)
    return patrolScores(ctx, [9])[0][1]
  }
  const plain = score(st)
  st.cells[9].ivory = true
  expect(score(st), `${plain}`).toBeGreaterThan(plain + 1e-6)
})

test('a rat nest due in the run scores below a plain door', () => {
  const st = duel(['ironbox'], 'wolf', 2, 2)
  const score = (state: State): number => {
    const ctx = context(state, TUNED)
    return patrolScores(ctx, [7])[0][1]
  }
  const plain = score(st)
  expect(st.day < st.maxDays).toBe(true)
  st.cells[7].nest = { due: st.day + 1 }
  expect(score(st), `${plain}`).toBeLessThan(plain - 1e-6)
})

test('the last day keeps a legendary over a long shot chromatic', () => {
  // The warden's Legendary Wolf has no meal, and an Ultimate Lion sits in
  // 08: a new inmate may bite it into a Chromatic today. The Legendary's
  // Riot loot outweighs that chance on both days (loot playouts on day 20:
  // 2.250 for finishing against 2.214 for the Replace, paired error 0.001).
  const pick = (day: number): Action | null => {
    const st = replaceBoard([], 3, [[8, 4]])
    st.day = day
    expect(devourOptions(st, 12).length).toBe(0)
    return decide(st, TUNED, new Rng32(1))
  }
  expect(pick(19)).toEqual({ type: 'end' })
  expect(pick(20)).toEqual({ type: 'end' })
})

test('an early gift opens doors over raising one rare', () => {
  // Day 5, a Rare Wolf in the warden's cell with no target and every other
  // door sealed. Under 2.75^t tiers Wine (the Rare rises to Epic) outweighed
  // three doors; under 2^t the doors win.
  const m = rawBoard('guillotine-last-day.json')
  m['day'] = 5
  m['tools'] = []
  m['vault'] = []
  const cells = cellsOf(m)
  for (let n = 1; n < 16; n++) {
    cells[n] = { kind: 'sealed', event: null }
  }
  cells[12] = { kind: 'inmate', beast: 'wolf', tier: 2 }
  const st = buildState(modelFromJson(m), 1)[0]
  expect(devourOptions(st, 12).length).toBe(0)
  st.pending = [{ kind: 'gift', options: ['ring', 'wine'], picks: 1 }]
  expect(decide(st, TUNED, new Rng32(1))).toEqual({ type: 'choose', id: 'ring' })
})

test('an extra portion marker beats a plain door', () => {
  // Day 5, three Rares on the block and every other door sealed. The
  // patrol picks a door over an empty cell; an Extra Portion there, which
  // raises inmates, turns the pick around.
  const d = data()
  const m = rawBoard('guillotine-last-day.json')
  m['day'] = 5
  m['tools'] = []
  m['vault'] = []
  const cells = cellsOf(m)
  for (let n = 1; n < 16; n++) {
    cells[n] = { kind: 'sealed', event: null }
  }
  for (const n of [2, 3, 4]) {
    cells[n] = { kind: 'inmate', beast: 'wolf', tier: 2 }
  }
  const st = buildState(modelFromJson(m), 1)[0]
  const free: number[] = []
  for (let n = 5; n < 16; n++) {
    if (n !== d.room) free.push(n)
    if (free.length === 2) break
  }
  const marker = free[0]
  const door = free[1]
  st.cells[marker].sealed = false
  st.cells[marker].inmate = null
  st.pending = []
  st.event = null
  st.phase = 'patrol'
  st.destinations = [marker, door]
  const plain = decide(st, TUNED, new Rng32(1))
  expect(plain).toEqual({ type: 'patrol', cell: door })
  st.cells[marker].event = 212
  // A read board hides every incident; this one shows its marker's.
  st.params.hiddenIncidents = false
  expect(decide(st, TUNED, new Rng32(1))).toEqual({ type: 'patrol', cell: marker })
})

/** `eater_mask` agrees with `bites` on every cell of every board a few hundred
 * strategy games pass through, with the species instruments and Cage Fight. */
test('eater mask matches bites', () => {
  const species: Tool[] = ['crown', 'skewer', 'guillotine', 'maul']
  for (let k = 0; k < 300; k++) {
    const held: Tool[] = k % 3 === 0 ? [] : species
    const [st, roll] = start(11, k, held)
    if (k % 5 === 0) {
      st.theme = CAGE_FIGHT
    }
    for (let i = 0; i < 2000; i++) {
      const mask = eaterMask(st)
      for (let n = 0; n < st.cells.length; n++) {
        expect((mask & (1 << n)) !== 0, `game ${k} cell ${n}`).toEqual(bites(st, n).length > 0)
      }
      if (st.phase === 'ended') break
      const action = decide(st, TUNED, roll)
      if (action === null) break
      const out = apply(st, action)
      if (!out.ok && !(action.type !== 'end' && apply(st, { type: 'end' }).ok)) break
    }
  }
})

/** The gift key of the option with that name. */
function giftKey(options: Gift[], name: string): string {
  const found = options.find((g) => toolName(g) === name)
  if (found === undefined) throw new Error(`no ${name}`)
  return found
}

/** On a treasure pick where the treasures tie, the advice names the Ring, the
 * one that acts, and the why names the ones that change nothing; with the
 * Ring behind, the Horn's why says it changes nothing. */
test('shown names the gifts that change nothing', () => {
  const [st, problems] = buildBoard('gift-noop.json')
  expect(problems).toEqual([])
  const pending = st.pending[0]
  if (pending === undefined || pending.kind !== 'gift') throw new Error('no gift pick')
  const options = pending.options
  const row = (name: string, mean: number, gapSe: number): SolveOption => ({
    label: `Take ${name}`,
    action: { type: 'choose', id: giftKey(options, name) },
    mean,
    se: 0.01,
    gapSe,
    n: 400,
    best: 0.0,
    policy: false,
  })
  const ranking = (ring: number): SolveOption[] => [
    row('Brass Horn of Strife', 9.164, 0.0),
    row('Crimson Vintage', 9.164, 0.0),
    row('Brand of Original Sin', 9.164, 0.0),
    row('Three-Headed Thumb Ring', ring, 0.002),
  ]
  const advice = (ranking: SolveOption[]): Advice => ({
    action: { ...ranking[0].action },
    label: ranking[0].label,
    why: 'The playouts rate it best.',
    option: 0,
  })
  const tied = ranking(9.162)
  const a = preferChange(st, tied, advice(tied))
  expect(a.label).toEqual('Take Three-Headed Thumb Ring')
  expect(whyShown(st, tied, a)).toEqual(
    "The playouts can't tell it from Brass Horn of Strife, Crimson Vintage and Brand of Original Sin, which change nothing on this board.",
  )
  const behind = ranking(9.0)
  // Vintage and Brand sit level with the Horn, inside its margin.
  expect(whyShown(st, behind, advice(behind))).toEqual(
    'Brass Horn of Strife, Crimson Vintage and Brand of Original Sin change nothing on this board, and the other treasures score lower.',
  )
})

/** On a treasure pick where the advised treasure changes nothing and a tied
 * one acts, the advice takes the one that acts. */
test('the advice prefers a tied treasure that changes something', () => {
  const [st, problems] = buildBoard('gift-tie.json')
  expect(problems).toEqual([])
  const pending = st.pending[0]
  if (pending === undefined || pending.kind !== 'gift') throw new Error('no gift pick')
  const options = pending.options
  const row = (name: string, mean: number, gapSe: number): SolveOption => ({
    label: `Take ${name}`,
    action: { type: 'choose', id: giftKey(options, name) },
    mean,
    se: 0.01,
    gapSe,
    n: 400,
    best: 0.0,
    policy: false,
  })
  const ranking = [
    row('Brass Horn of Strife', 5.492, 0.0),
    row('Crimson Vintage', 5.478, 0.034),
    row('Brand of Original Sin', 5.475, 0.030),
    row('Three-Headed Thumb Ring', 5.333, 0.034),
  ]
  const advice: Advice = {
    action: { ...ranking[0].action },
    label: ranking[0].label,
    why: "The playouts found a better move than the strategy's pick (Take Three-Headed Thumb Ring).",
    option: 0,
  }
  const why =
    "The playouts can't tell it from Brass Horn of Strife and Brand of Original Sin, which change nothing on this board."
  const a = preferChange(st, ranking, advice)
  expect([a.label, a.option, a.why]).toEqual(['Take Crimson Vintage', 1, why])
  expect(a.action).toEqual(ranking[1].action)
  expect(whyShown(st, ranking, a)).toEqual(why)
})

/** An instrument pick with a re-roll left: the count goes to the state, the
 * solve weighs a Re-roll, and the model writes it back; at 0 the model
 * writes no count, so the fixtures stay as they are. */
test('reroll count builds', () => {
  const raw = rawBoard('choice.json')
  const plain = modelFromJson(raw)
  expect(plain.choice.rerolls).toBe(0)
  const plainJson = JSON.parse(JSON.stringify(plain)) as Record<string, unknown>
  expect((plainJson['choice'] as Record<string, unknown>)['rerolls']).toBeUndefined()
  const choice = raw['choice'] as Record<string, unknown>
  choice['rerolls'] = 1
  const model = modelFromJson(raw)
  expect(model.choice.rerolls).toBe(1)
  expect((JSON.parse(JSON.stringify(model))['choice'] as Record<string, unknown>)['rerolls']).toBe(1)
  const [st, problems] = buildState(model, 1)
  expect(problems).toEqual([])
  expect(st.rerolls).toBe(1)
  const options = solve(st, 20, 1, TUNED)
  expect(options.some((o) => o.label === 'Re-roll' && o.action.type === 'reroll')).toBe(true)
  const [plainState] = buildState(plain, 1)
  expect(plainState.rerolls).toBe(0)
  expect(solve(plainState, 20, 1, TUNED).every((o) => o.action.type !== 'reroll')).toBe(true)
})
