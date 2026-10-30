//! The game state, shaped like the JS state (js/engine.js newGame) so that
//! `JSON.stringify` diffs cleanly against a JS state without its log.

import {
  BEAST_KEYS,
  CARD_KEYS,
  GIFT_KEYS,
  LOOT,
  RAINBOW,
  TOOL_KEYS,
  VAULT_CAP,
  asArray,
  asBool,
  asNumber,
  asObject,
  asText,
  data,
  oneOf,
  type Beast,
  type Card,
  type Gift,
  type Tool,
} from './data'

/** The phases of the run. */
const PHASES = ['patrol', 'manage', 'event', 'ended'] as const

/** The phase of the run. */
export type Phase = (typeof PHASES)[number]

/** One inmate on the block. */
export interface Inmate {
  id: number
  beast: Beast
  tier: number
}

/** A rat nest waiting to hatch. */
export interface Nest {
  due: number
}

/** One cell of the ring. */
export interface Cell {
  n: number
  sealed: boolean
  inmate: Inmate | null
  hidden: Inmate | null
  known: number
  scratch: boolean
  nest: Nest | null
  event: number | null
  ivory: boolean
}

/** The incident waiting for its confirm. */
export interface EventRef {
  id: number
  cell: number
}

/** A Chromatic in the vault. */
export interface VaultEntry {
  id: number
  beast: Beast
  day: number
}

/** Why an instrument is on offer. */
const TOOL_REASONS = ['start', 'objective'] as const

export type ToolReason = (typeof TOOL_REASONS)[number]

/** A choice the player makes before anything else. */
export type Pending =
  | { kind: 'tool'; options: Tool[]; reason: ToolReason }
  | { kind: 'gift'; options: Gift[]; picks: number }
  | { kind: 'interrogation'; options: Card[] }
  /** A chain consume: the eater in cell `from` may bite one of `options`. */
  | { kind: 'chain'; from: number; eaterId: number; options: number[] }
  /** A cell to move to, for the incident `id` (Sewer Ratway). */
  | { kind: 'cell'; id: number; options: number[] }
  /** The Hunt's "Select an Objective": the Lion's Consumable targets, one
   * to mark as prey. Only a board read on that screen sets it. */
  | { kind: 'prey'; options: number[] }

/** Whether a pending choice has nothing left to pick. */
export function pendingIsEmpty(pending: Pending): boolean {
  return pending.options.length === 0
}

/** The run's objective and its progress. */
export interface ObjectiveState {
  id: number
  progress: number
  done: boolean
}

/** Actions used today (freshDay). */
export interface Used {
  swap: number
  devour: number
  hunt: number
}

/** A prey mark: the lion, the prey and the rounds left. */
export interface PreyLink {
  lion: number
  prey: number
  preyBeast: Beast
  rounds: number
  next: number
}

/** What the run did. */
export interface Stats {
  patrols: number
  opened: number
  devours: number
  chains: number
  swaps: number
  executions: number
  best: number
}

/** One row of the end-of-run roster. */
export interface RosterRow {
  beast: Beast
  tier: number
  where: string
}

/** The end-of-run roster. */
export interface Roster {
  rows: RosterRow[]
  byTier: number[]
}

/** What a finished run leaves behind. */
export interface RunResult {
  day: number
  early: boolean
  roster: Roster
  cache: number
  best: number
  stats: Stats
}

/** The defaults of normalizeParams (DEFAULT_PARAMS); Lab editing is not ported. */
export interface ParamsInit {
  drillDays?: number
  destinations?: number
  fewerDoorsChance?: number
  swapsPerDay?: number
  reusableCells?: boolean
  tierWeights?: number[]
  beastWeights?: number[]
  incidentSpawnChance?: number
  executionRerolls?: boolean
  ivoryCount?: number
  ivoryIncludesSwapped?: boolean
  preyRounds?: number
  scratchStacksBase?: boolean
  nestDays?: number
  nestTier?: number
  rewards?: boolean
  startTools?: number
  objective?: number
  theme?: number
  /** Chromatics the vault holds; once full, inmates stop at Ultimate. Null
   * means no cap, as in the JS engine (its traces deserialize to null). */
  vaultCap?: number | null
  /** Whether the Severed Iron Maiden's rise applies. The JS engine has no
   * such field, so a state that keeps the rise leaves it out. */
  maiden?: boolean
  /** Whether a marker's incident stays unseen until it fires, as in the
   * game; the JS engine shows it, and its traces leave the field out. */
  hiddenIncidents?: boolean
  /** Whether a new marker stays off the warden's cell, as the run logs
   * show; the JS engine allowed it, and its traces leave the field out. */
  markersAvoidWarden?: boolean
}

/** The run's parameters, as the Lab sets them. */
export class Params implements ParamsInit {
  drillDays: number
  destinations: number
  fewerDoorsChance: number
  swapsPerDay: number
  reusableCells: boolean
  tierWeights: number[]
  beastWeights: number[]
  incidentSpawnChance: number
  executionRerolls: boolean
  ivoryCount: number
  ivoryIncludesSwapped: boolean
  preyRounds: number
  scratchStacksBase: boolean
  nestDays: number
  nestTier: number
  rewards: boolean
  startTools: number
  objective: number
  theme: number
  vaultCap: number | null
  maiden: boolean
  hiddenIncidents: boolean
  markersAvoidWarden: boolean

  constructor(init: ParamsInit = {}) {
    const d = data()
    this.drillDays = init.drillDays ?? d.days
    this.destinations = init.destinations ?? d.diceOptions
    this.fewerDoorsChance = init.fewerDoorsChance ?? 0
    this.swapsPerDay = init.swapsPerDay ?? 1
    this.reusableCells = init.reusableCells ?? true
    this.tierWeights = init.tierWeights ?? [...d.tierWeights]
    this.beastWeights = init.beastWeights ?? [25, 25, 25, 25]
    this.incidentSpawnChance = init.incidentSpawnChance ?? 0
    this.executionRerolls = init.executionRerolls ?? false
    this.ivoryCount = init.ivoryCount ?? 4
    this.ivoryIncludesSwapped = init.ivoryIncludesSwapped ?? true
    this.preyRounds = init.preyRounds ?? 3
    this.scratchStacksBase = init.scratchStacksBase ?? true
    this.nestDays = init.nestDays ?? 2
    this.nestTier = init.nestTier ?? 2
    this.rewards = init.rewards ?? true
    this.startTools = init.startTools ?? 0
    this.objective = init.objective ?? 0
    this.theme = init.theme ?? 0
    this.vaultCap = init.vaultCap === undefined ? VAULT_CAP : init.vaultCap
    this.maiden = init.maiden ?? true
    this.hiddenIncidents = init.hiddenIncidents ?? true
    this.markersAvoidWarden = init.markersAvoidWarden ?? true
  }

  /** A copy of the parameters (the Rust engine's Clone). */
  clone(): Params {
    return new Params({
      drillDays: this.drillDays,
      destinations: this.destinations,
      fewerDoorsChance: this.fewerDoorsChance,
      swapsPerDay: this.swapsPerDay,
      reusableCells: this.reusableCells,
      tierWeights: [...this.tierWeights],
      beastWeights: [...this.beastWeights],
      incidentSpawnChance: this.incidentSpawnChance,
      executionRerolls: this.executionRerolls,
      ivoryCount: this.ivoryCount,
      ivoryIncludesSwapped: this.ivoryIncludesSwapped,
      preyRounds: this.preyRounds,
      scratchStacksBase: this.scratchStacksBase,
      nestDays: this.nestDays,
      nestTier: this.nestTier,
      rewards: this.rewards,
      startTools: this.startTools,
      objective: this.objective,
      theme: this.theme,
      vaultCap: this.vaultCap,
      maiden: this.maiden,
      hiddenIncidents: this.hiddenIncidents,
      markersAvoidWarden: this.markersAvoidWarden,
    })
  }

  /** The JSON shape of serde's Params: the fields the JS engine lacks stay out. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      drillDays: this.drillDays,
      destinations: this.destinations,
      fewerDoorsChance: this.fewerDoorsChance,
      swapsPerDay: this.swapsPerDay,
      reusableCells: this.reusableCells,
      tierWeights: this.tierWeights,
      beastWeights: this.beastWeights,
      incidentSpawnChance: this.incidentSpawnChance,
      executionRerolls: this.executionRerolls,
      ivoryCount: this.ivoryCount,
      ivoryIncludesSwapped: this.ivoryIncludesSwapped,
      preyRounds: this.preyRounds,
      scratchStacksBase: this.scratchStacksBase,
      nestDays: this.nestDays,
      nestTier: this.nestTier,
      rewards: this.rewards,
      startTools: this.startTools,
      objective: this.objective,
      theme: this.theme,
    }
    if (this.vaultCap !== null) out.vaultCap = this.vaultCap
    if (!this.maiden) out.maiden = false
    if (!this.hiddenIncidents) out.hiddenIncidents = false
    if (this.markersAvoidWarden) out.markersAvoidWarden = true
    return out
  }
}

/** The default parameters (DEFAULT_PARAMS). */
export function defaultParams(): Params {
  return new Params()
}

/** The state of a run. */
export interface StateInit {
  v: number
  scenario: string
  seed: string
  rng: number
  params: Params
  day: number
  maxDays: number
  phase: Phase
  position: number
  dice: number[]
  destinations: number[]
  chain: boolean
  event: EventRef | null
  /** Markers placed per incident id; JSON keys are the ids as strings. */
  incidentCounts: Record<string, number>
  /** Draw weights the run changed, by incident id (Usurpation stages). */
  incidentWeights: Record<string, number>
  cells: Cell[]
  vault: VaultEntry[]
  cache: number
  tools: Tool[]
  /** Instrument rerolls left this run, shared by every instrument pick. */
  rerolls?: number
  pending: Pending[]
  objective: ObjectiveState | null
  theme: number | null
  used: Used
  prey: PreyLink[]
  nextId: number
  stats: Stats
  result: RunResult | null
}

/** The state of a run. */
export class State implements StateInit {
  v: number
  scenario: string
  seed: string
  rng: number
  params: Params
  day: number
  maxDays: number
  phase: Phase
  position: number
  dice: number[]
  destinations: number[]
  chain: boolean
  event: EventRef | null
  incidentCounts: Record<string, number>
  incidentWeights: Record<string, number>
  cells: Cell[]
  vault: VaultEntry[]
  cache: number
  tools: Tool[]
  rerolls: number
  pending: Pending[]
  objective: ObjectiveState | null
  theme: number | null
  used: Used
  prey: PreyLink[]
  nextId: number
  stats: Stats
  result: RunResult | null

  constructor(init: StateInit) {
    this.v = init.v
    this.scenario = init.scenario
    this.seed = init.seed
    this.rng = init.rng
    this.params = init.params
    this.day = init.day
    this.maxDays = init.maxDays
    this.phase = init.phase
    this.position = init.position
    this.dice = init.dice
    this.destinations = init.destinations
    this.chain = init.chain
    this.event = init.event
    this.incidentCounts = init.incidentCounts
    this.incidentWeights = init.incidentWeights
    this.cells = init.cells
    this.vault = init.vault
    this.cache = init.cache
    this.tools = init.tools
    this.rerolls = init.rerolls ?? 0
    this.pending = init.pending
    this.objective = init.objective
    this.theme = init.theme
    this.used = init.used
    this.prey = init.prey
    this.nextId = init.nextId
    this.stats = init.stats
    this.result = init.result
  }

  /** Whether the warden holds an instrument. */
  has(tool: Tool): boolean {
    return this.tools.includes(tool)
  }

  /** The highest tier an inmate can reach: Chromatic while the vault has
   * room, Ultimate once it is full. */
  topTier(): number {
    const cap = this.params.vaultCap
    if (cap === null || this.vault.length < cap) return RAINBOW
    return RAINBOW - 1
  }

  /** The Riot loot of this board in Chromatics: each vaulted Chromatic plus
   * the cache of each inmate on an open cell, weighted by `LOOT`. */
  loot(): number {
    let board = 0
    for (const c of this.cells) {
      if (c.sealed || c.inmate === null) continue
      board += LOOT[c.inmate.tier]
    }
    return this.vault.length * LOOT[RAINBOW] + board
  }

  /** Index of the cell holding inmate `id`, sealed or open (cellOf). */
  cellOf(id: number): number | null {
    const index = this.cells.findIndex((c) => c.inmate !== null && c.inmate.id === id)
    return index < 0 ? null : index
  }

  /** cellOf, only when the cell is open (boardCellOf). */
  boardCellOf(id: number): number | null {
    const n = this.cellOf(id)
    if (n === null || this.cells[n].sealed) return null
    return n
  }

  /** Index in `prey` of the first mark inmate `id` is part of (linkOf). */
  linkOf(id: number): number | null {
    const index = this.prey.findIndex((l) => l.lion === id || l.prey === id)
    return index < 0 ? null : index
  }

  /** Open cells with an inmate (boardCells), as indices. */
  boardCells(): number[] {
    const out: number[] = []
    for (const c of this.cells) {
      if (!c.sealed && c.inmate !== null) out.push(c.n)
    }
    return out
  }

  /** The sealed cells, as indices. */
  sealedCells(): number[] {
    const out: number[] = []
    for (const c of this.cells) {
      if (c.sealed) out.push(c.n)
    }
    return out
  }

  /** A copy of the state (the Rust engine's Clone). */
  clone(): State {
    return new State({
      v: this.v,
      scenario: this.scenario,
      seed: this.seed,
      rng: this.rng,
      params: this.params.clone(),
      day: this.day,
      maxDays: this.maxDays,
      phase: this.phase,
      position: this.position,
      dice: [...this.dice],
      destinations: [...this.destinations],
      chain: this.chain,
      event: this.event === null ? null : { ...this.event },
      incidentCounts: { ...this.incidentCounts },
      incidentWeights: { ...this.incidentWeights },
      cells: this.cells.map((c) => ({
        ...c,
        inmate: c.inmate === null ? null : { ...c.inmate },
        hidden: c.hidden === null ? null : { ...c.hidden },
        nest: c.nest === null ? null : { ...c.nest },
      })),
      vault: this.vault.map((v) => ({ ...v })),
      cache: this.cache,
      tools: [...this.tools],
      rerolls: this.rerolls,
      pending: this.pending.map((p) => ({ ...p })),
      objective: this.objective === null ? null : { ...this.objective },
      theme: this.theme,
      used: { ...this.used },
      prey: this.prey.map((l) => ({ ...l })),
      nextId: this.nextId,
      stats: { ...this.stats },
      result: this.result === null ? null : { ...this.result },
    })
  }

  /** The JSON shape of serde's State: the fields the JS engine lacks stay out. */
  toJSON(): Record<string, unknown> {
    const out: Record<string, unknown> = {
      v: this.v,
      scenario: this.scenario,
      seed: this.seed,
      rng: this.rng,
      params: this.params,
      day: this.day,
      maxDays: this.maxDays,
      phase: this.phase,
      position: this.position,
      dice: this.dice,
      destinations: this.destinations,
      chain: this.chain,
      event: this.event,
      incidentCounts: this.incidentCounts,
      incidentWeights: this.incidentWeights,
      cells: this.cells,
      vault: this.vault,
      cache: this.cache,
      tools: this.tools,
    }
    if (this.rerolls !== 0) out.rerolls = this.rerolls
    out.pending = this.pending
    out.objective = this.objective
    out.theme = this.theme
    out.used = this.used
    out.prey = this.prey
    out.nextId = this.nextId
    out.stats = this.stats
    out.result = this.result
    return out
  }
}

/** blankCell: the office is never sealed and never holds anyone. */
export function blankCell(n: number): Cell {
  return {
    n,
    sealed: n !== data().room,
    inmate: null,
    hidden: null,
    known: 0,
    scratch: false,
    nest: null,
    event: null,
    ivory: false,
  }
}

// ---------- Reading a state back ----------

function inmateFrom(value: unknown): Inmate {
  const v = asObject(value, 'inmate')
  return { id: asNumber(v['id']), beast: oneOf(v['beast'], BEAST_KEYS, 'beast'), tier: asNumber(v['tier']) }
}

function cellFrom(value: unknown): Cell {
  const v = asObject(value, 'cell')
  return {
    n: asNumber(v['n']),
    sealed: asBool(v['sealed']),
    inmate: v['inmate'] === null || v['inmate'] === undefined ? null : inmateFrom(v['inmate']),
    hidden: v['hidden'] === null || v['hidden'] === undefined ? null : inmateFrom(v['hidden']),
    known: asNumber(v['known']),
    scratch: asBool(v['scratch']),
    nest: v['nest'] === null || v['nest'] === undefined ? null : { due: asNumber(asObject(v['nest'], 'nest')['due']) },
    event: v['event'] === null || v['event'] === undefined ? null : asNumber(v['event']),
    ivory: asBool(v['ivory']),
  }
}

function pendingFrom(value: unknown): Pending {
  const v = asObject(value, 'pending')
  const kind = asText(v['kind'])
  switch (kind) {
    case 'tool':
      return {
        kind: 'tool',
        options: asArray(v['options'], 'options').map((o) => oneOf(o, TOOL_KEYS, 'tool')),
        reason: oneOf(v['reason'], TOOL_REASONS, 'tool reason'),
      }
    case 'gift':
      return {
        kind: 'gift',
        options: asArray(v['options'], 'options').map((o) => oneOf(o, GIFT_KEYS, 'gift')),
        picks: asNumber(v['picks']),
      }
    case 'interrogation':
      return {
        kind: 'interrogation',
        options: asArray(v['options'], 'options').map((o) => oneOf(o, CARD_KEYS, 'card')),
      }
    case 'chain':
      return {
        kind: 'chain',
        from: asNumber(v['from']),
        eaterId: asNumber(v['eaterId']),
        options: asArray(v['options'], 'options').map((o) => asNumber(o)),
      }
    case 'cell':
      return {
        kind: 'cell',
        id: asNumber(v['id']),
        options: asArray(v['options'], 'options').map((o) => asNumber(o)),
      }
    case 'prey':
      return { kind: 'prey', options: asArray(v['options'], 'options').map((o) => asNumber(o)) }
    default:
      throw new Error(`unknown pending kind ${kind}`)
  }
}

function paramsFrom(value: unknown): Params {
  const v = asObject(value, 'params')
  const vaultCap = v['vaultCap']
  return new Params({
    drillDays: asNumber(v['drillDays']),
    destinations: asNumber(v['destinations']),
    fewerDoorsChance: asNumber(v['fewerDoorsChance']),
    swapsPerDay: asNumber(v['swapsPerDay']),
    reusableCells: asBool(v['reusableCells']),
    tierWeights: asArray(v['tierWeights'], 'tierWeights').map((w) => asNumber(w)),
    beastWeights: asArray(v['beastWeights'], 'beastWeights').map((w) => asNumber(w)),
    incidentSpawnChance: asNumber(v['incidentSpawnChance']),
    executionRerolls: asBool(v['executionRerolls']),
    ivoryCount: asNumber(v['ivoryCount']),
    ivoryIncludesSwapped: asBool(v['ivoryIncludesSwapped']),
    preyRounds: asNumber(v['preyRounds']),
    scratchStacksBase: asBool(v['scratchStacksBase']),
    nestDays: asNumber(v['nestDays']),
    nestTier: asNumber(v['nestTier']),
    rewards: asBool(v['rewards']),
    startTools: asNumber(v['startTools']),
    objective: asNumber(v['objective']),
    theme: asNumber(v['theme']),
    vaultCap: vaultCap === undefined || vaultCap === null ? null : asNumber(vaultCap),
    maiden: v['maiden'] === undefined ? undefined : asBool(v['maiden']),
    hiddenIncidents: v['hiddenIncidents'] === undefined ? undefined : asBool(v['hiddenIncidents']),
    markersAvoidWarden: v['markersAvoidWarden'] === undefined ? false : asBool(v['markersAvoidWarden']),
  })
}

/** The state of a recorded JS run, read back into the engine's shape. */
export function stateFromJson(value: unknown): State {
  const v = asObject(value, 'state')
  const event = v['event']
  const objective = v['objective']
  const result = v['result']
  return new State({
    v: asNumber(v['v']),
    scenario: asText(v['scenario']),
    seed: asText(v['seed']),
    rng: asNumber(v['rng']),
    params: paramsFrom(v['params']),
    day: asNumber(v['day']),
    maxDays: asNumber(v['maxDays']),
    phase: oneOf(v['phase'], PHASES, 'phase'),
    position: asNumber(v['position']),
    dice: asArray(v['dice'], 'dice').map((d) => asNumber(d)),
    destinations: asArray(v['destinations'], 'destinations').map((d) => asNumber(d)),
    chain: asBool(v['chain']),
    event:
      event === null || event === undefined
        ? null
        : { id: asNumber(asObject(event, 'event')['id']), cell: asNumber(asObject(event, 'event')['cell']) },
    incidentCounts: countMap(v['incidentCounts']),
    incidentWeights: countMap(v['incidentWeights']),
    cells: asArray(v['cells'], 'cells').map(cellFrom),
    vault: asArray(v['vault'], 'vault').map((entry) => {
      const e = asObject(entry, 'vault entry')
      return { id: asNumber(e['id']), beast: oneOf(e['beast'], BEAST_KEYS, 'beast'), day: asNumber(e['day']) }
    }),
    cache: asNumber(v['cache']),
    tools: asArray(v['tools'], 'tools').map((t) => oneOf(t, TOOL_KEYS, 'tool')),
    rerolls: v['rerolls'] === undefined ? 0 : asNumber(v['rerolls']),
    pending: asArray(v['pending'], 'pending').map(pendingFrom),
    objective:
      objective === null || objective === undefined
        ? null
        : {
            id: asNumber(asObject(objective, 'objective')['id']),
            progress: asNumber(asObject(objective, 'objective')['progress']),
            done: asBool(asObject(objective, 'objective')['done']),
          },
    theme: v['theme'] === null || v['theme'] === undefined ? null : asNumber(v['theme']),
    used: usedFrom(v['used']),
    prey: asArray(v['prey'], 'prey').map((link) => {
      const l = asObject(link, 'prey')
      return {
        lion: asNumber(l['lion']),
        prey: asNumber(l['prey']),
        preyBeast: oneOf(l['preyBeast'], BEAST_KEYS, 'beast'),
        rounds: asNumber(l['rounds']),
        next: asNumber(l['next']),
      }
    }),
    nextId: asNumber(v['nextId']),
    stats: statsFrom(v['stats']),
    result: result === null || result === undefined ? null : resultFrom(result),
  })
}

function countMap(value: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  const v = asObject(value, 'map')
  for (const [key, count] of Object.entries(v)) out[key] = asNumber(count)
  return out
}

function usedFrom(value: unknown): Used {
  const v = asObject(value, 'used')
  return { swap: asNumber(v['swap']), devour: asNumber(v['devour']), hunt: asNumber(v['hunt']) }
}

function statsFrom(value: unknown): Stats {
  const v = asObject(value, 'stats')
  return {
    patrols: asNumber(v['patrols']),
    opened: asNumber(v['opened']),
    devours: asNumber(v['devours']),
    chains: asNumber(v['chains']),
    swaps: asNumber(v['swaps']),
    executions: asNumber(v['executions']),
    best: asNumber(v['best']),
  }
}

function rosterFrom(value: unknown): Roster {
  const v = asObject(value, 'roster')
  return {
    rows: asArray(v['rows'], 'rows').map((row) => {
      const r = asObject(row, 'roster row')
      return { beast: oneOf(r['beast'], BEAST_KEYS, 'beast'), tier: asNumber(r['tier']), where: asText(r['where']) }
    }),
    byTier: asArray(v['byTier'], 'byTier').map((t) => asNumber(t)),
  }
}

function resultFrom(value: unknown): RunResult {
  const v = asObject(value, 'result')
  return {
    day: asNumber(v['day']),
    early: asBool(v['early']),
    roster: rosterFrom(v['roster']),
    cache: asNumber(v['cache']),
    best: asNumber(v['best']),
    stats: statsFrom(v['stats']),
  }
}
