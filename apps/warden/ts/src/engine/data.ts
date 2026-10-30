//! Game data from data/warden-data.json and the tables js/engine.js derives
//! from it (lines 18-310). Parsed once.

import raw from '../../../data/warden-data.json'

/** Chromatic, the top tier; an inmate reaching it leaves for the vault. */
export const RAINBOW = 5
/** The vault holds at most this many Chromatics (confirmed in-game). */
export const VAULT_CAP = 10
/** What one inmate left at the Riot pays, in Chromatics, by tier (Normal,
 * Magic, Rare, Legendary, Ultimate, Chromatic). */
export const LOOT: readonly number[] = [0, 0, 0, 0.05, 0.2, 1]
/** Relative worth of one inmate per tier; the advisor ranks moves with it. */
export const WORTH: readonly number[] = [1, 3, 9, 27, 81, 400]
/** The count of "all Inmates" (the Rust engine's usize::MAX). */
export const ALL_INMATES = Number.MAX_SAFE_INTEGER

/** In-game species in the order of the data's species list. */
export const BEAST_KEYS = ['mammoth', 'lion', 'wolf', 'rat'] as const
export type Beast = (typeof BEAST_KEYS)[number]
export const BEASTS: readonly Beast[] = BEAST_KEYS

/** The index of a species in the data's species list. */
const BEAST_INDEX: Record<Beast, number> = { mammoth: 0, lion: 1, wolf: 2, rat: 3 }
export function beastIndex(beast: Beast): number {
  return BEAST_INDEX[beast]
}

/** Torture Instruments by the engine's short ids (TOOL_KEYS). */
export const TOOL_KEYS = [
  'muzzle',
  'chains',
  'collar',
  'revenge',
  'beastcage',
  'whip',
  'saw',
  'blacklist',
  'keys',
  'coin',
  'fire',
  'dogtag',
  'forgedkey',
  'hook',
  'scapegoat',
  'axe',
  'maiden',
  'scales',
  'rope',
  'stake',
  'pestle',
  'shortchain',
  'longchain',
  'tongs',
  'maul',
  'trap',
  'crown',
  'claws',
  'guillotine',
  'ironbox',
  'skewer',
] as const
export type Tool = (typeof TOOL_KEYS)[number]
export const TOOLS: readonly Tool[] = TOOL_KEYS

/** The data's instrument id (TOOL_KEYS), by tool index. */
const TOOL_RL: readonly number[] = [
  101, 102, 103, 104, 105, 106, 107, 111, 112, 113, 114, 115, 116, 117, 121, 122, 123, 124, 125, 126, 127, 131, 132, 141,
  142, 143, 144, 145, 146, 147, 148,
]

/** The index of an instrument in the engine's instrument list. */
export function toolIndex(tool: Tool): number {
  return TOOL_KEYS.indexOf(tool)
}

/** The instrument of a short id, or null. */
export function toolFromKey(key: string): Tool | null {
  const i = (TOOL_KEYS as readonly string[]).indexOf(key)
  return i < 0 ? null : TOOL_KEYS[i]
}

/** The instrument of a data id, or null. */
export function toolFromRl(rl: number): Tool | null {
  const i = TOOL_RL.indexOf(rl)
  return i < 0 ? null : TOOL_KEYS[i]
}

/** The Warden's Treasure rewards (GIFT_ROWS), in GIFT_IDS order. */
export const GIFT_KEYS = ['ring', 'horn', 'wine', 'brand'] as const
export type Gift = (typeof GIFT_KEYS)[number]

/** The index of a reward in the reward list. */
export function giftIndex(gift: Gift): number {
  return GIFT_KEYS.indexOf(gift)
}

/** The reward of a short id, or null. */
export function giftFromKey(key: string): Gift | null {
  const i = (GIFT_KEYS as readonly string[]).indexOf(key)
  return i < 0 ? null : GIFT_KEYS[i]
}

/** The Interrogation Room's two cards (INTERROGATION_IDS). */
export const CARD_KEYS = ['instigate', 'bestow'] as const
export type Card = (typeof CARD_KEYS)[number]

/** The index of a card in the card list. */
export function cardIndex(card: Card): number {
  return CARD_KEYS.indexOf(card)
}

/** The card of a short id, or null. */
export function cardFromKey(key: string): Card | null {
  const i = (CARD_KEYS as readonly string[]).indexOf(key)
  return i < 0 ? null : CARD_KEYS[i]
}

/** Where an incident's marker may sit. */
export type Spawn = 'any' | 'unopened' | 'opened'

/** What an objective counts. */
export type ObjectiveKind = 'reachRating' | 'devourCount' | 'openCellCount' | 'eventTriggerCount' | 'moveDistance'

/** One instrument: data values plus the numbers TOOL_RULES reads from its text. */
export interface ToolDef {
  weight: number
  exclude: Tool[]
  /** chancePercent; JS compares against null as 0. */
  chance: number
  tiers: number | null
  fewerDice: number
  count: number | null
  maxInmates: number | null
  maxSealed: number | null
  minOthers: number | null
  maxSteps: number | null
  minSteps: number | null
  above: number | null
  tier: number | null
}

/** One Prison Incident: its data values plus the numbers its effect text states. */
export interface Incident {
  id: number
  name: string
  weight: number
  spawn: Spawn
  /** excludeRelic, as held instruments. */
  exclude: Tool[]
  /** 0 for no limit. */
  repeatLimit: number
  /** Counts, tiers, chance and rarity the effect text states (0 when it
   * states none); `count` is ALL_INMATES for "all Inmates". */
  count: number
  tiers: number
  chance: number
  tier: number
  /** The Usurpation stage the text adds to the pool. */
  next: number | null
}

/** One run objective. */
export interface Objective {
  id: number
  /** The objective panel's title: "Objective: Undercurrents". */
  name: string
  kind: ObjectiveKind
  target: number
  /** The rarity reach_rating names; JS compares tiers against null as 0. */
  rating: number
  weight: number
}

/** One run theme. */
export interface Theme {
  id: number
  name: string
  weight: number
  value: number | null
}

export const TYRANNY = 301
export const OPULENCE = 302
export const IRON_LAW = 303
export const CAGE_FIGHT = 304

/** The parsed game data. */
export interface DataInit {
  cellCount: number
  room: number
  diceOptions: number
  minPips: number
  maxPips: number
  days: number
  openRoomsAtStart: number
  instrumentPicks: number
  objectivesPerRun: number
  minMarkers: number
  themeChancePer10000: number
  themePityRuns: number
  /** Rarity draw weights for Normal to Ultimate. */
  tierWeights: number[]
  oppressPerTier: number
  /** Who each beast eats (FOOD_CHAIN), by Beast index. */
  foodChain: Beast[][]
  /** Instruments in data order (TOOL_IDS). */
  toolIds: Tool[]
  tools: ToolDef[]
  incidents: Incident[]
  objectives: Objective[]
  themes: Theme[]
  /** In-game names: rarities Normal to Chromatic (TIERS), species by Beast
   * index, instruments by Tool, gifts by Gift, the cards by Card, and Hunt. */
  tierNames: string[]
  beastNames: string[]
  toolNames: string[]
  giftNames: string[]
  cardNames: string[]
  huntName: string
  /** Glossary names: Prison Incident, Torture Instrument, Warden's Treasure. */
  incidentTerm: string
  instrumentName: string
  treasureName: string
}

/** The parsed game data, with the lookups the engine asks it for. */
export class Data implements DataInit {
  cellCount = 0
  room = 0
  diceOptions = 0
  minPips = 0
  maxPips = 0
  days = 0
  openRoomsAtStart = 0
  instrumentPicks = 0
  objectivesPerRun = 0
  minMarkers = 0
  themeChancePer10000 = 0
  themePityRuns = 0
  tierWeights: number[] = []
  oppressPerTier = 0
  foodChain: Beast[][] = []
  toolIds: Tool[] = []
  tools: ToolDef[] = []
  incidents: Incident[] = []
  objectives: Objective[] = []
  themes: Theme[] = []
  tierNames: string[] = []
  beastNames: string[] = []
  toolNames: string[] = []
  giftNames: string[] = []
  cardNames: string[] = []
  huntName = ''
  incidentTerm = ''
  instrumentName = ''
  treasureName = ''

  constructor(init: DataInit) {
    Object.assign(this, init)
  }

  /** The definition of an instrument. */
  tool(tool: Tool): ToolDef {
    return this.tools[toolIndex(tool)]
  }

  /** The incident of an id. */
  incident(id: number): Incident {
    const found = this.incidents.find((e) => e.id === id)
    if (found === undefined) throw new Error(`incident id ${id}`)
    return found
  }

  /** The objective of an id, if the run has one. */
  objective(id: number): Objective | null {
    return this.objectives.find((o) => o.id === id) ?? null
  }

  /** The theme of an id, if there is one. */
  theme(id: number): Theme | null {
    return this.themes.find((t) => t.id === id) ?? null
  }

  /** The name of `theme`, an id of `themes`. */
  themeName(theme: number | null): string | null {
    if (theme === null) return null
    return this.theme(theme)?.name ?? null
  }
}

// ---------- JSON readers ----------

/** A JSON object, or a throw. */
export function asObject(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${what}: object expected, got ${JSON.stringify(value)}`)
  }
  return value as Record<string, unknown>
}

/** A JSON array, or a throw. */
export function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${what}: array expected, got ${JSON.stringify(value)}`)
  }
  return value
}

/** A JSON number, or a throw. */
export function asNumber(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`number expected, got ${JSON.stringify(value)}`)
  }
  return value
}

/** A JSON string, or a throw. */
export function asText(value: unknown): string {
  if (typeof value !== 'string') {
    throw new Error(`string expected, got ${JSON.stringify(value)}`)
  }
  return value
}

/** A member of a key list, or a throw. */
export function oneOf<T extends string>(value: unknown, keys: readonly T[], what: string): T {
  const key = asText(value)
  const found = keys.find((k) => k === key)
  if (found === undefined) throw new Error(`unknown ${what} ${key}`)
  return found
}

/** A JSON boolean, or a throw. */
export function asBool(value: unknown): boolean {
  if (typeof value !== 'boolean') {
    throw new Error(`boolean expected, got ${JSON.stringify(value)}`)
  }
  return value
}

/** The `{ value }` wrapper the data puts on text-read numbers. */
function wrapped(value: unknown): number | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const inner = (value as Record<string, unknown>)['value']
  return typeof inner === 'number' ? inner : null
}

/** textNumber: the first `before<digits>after` in the instrument's texts. */
function textNumber(r: Record<string, unknown>, before: string, after: string): number {
  const parts: string[] = []
  for (const key of ['triggerPlain', 'plain']) {
    const s = r[key]
    if (typeof s === 'string' && s.length > 0) parts.push(s)
  }
  const body = parts.join(' ')
  let from = 0
  while (from < body.length) {
    const at = body.indexOf(before, from)
    if (at < 0) break
    const start = at + before.length
    let end = start
    while (end < body.length) {
      const code = body.charCodeAt(end)
      if (code < 48 || code > 57) break
      end += 1
    }
    const digits = body.slice(start, end)
    if (digits.length > 0 && body.startsWith(after, end)) return Number(digits)
    const code = body.codePointAt(at) as number
    from = at + (code > 0xffff ? 2 : 1)
  }
  throw new Error(`${String(r['Id'])}: no match for ${before}(\\d+)${after}`)
}

/** The rarity a text names after `before` (a `(\w+)` in the JS patterns). */
function rarityAfter(r: Record<string, unknown>, before: string, names: string[]): number {
  const plain = typeof r['plain'] === 'string' ? (r['plain'] as string) : ''
  const at = plain.indexOf(before)
  if (at < 0) throw new Error(`${String(r['Id'])}: no ${JSON.stringify(before)}`)
  let end = at + before.length
  while (end < plain.length && /[\p{Alphabetic}\p{N}_]/u.test(plain[end])) end += 1
  const name = plain.slice(at + before.length, end)
  const index = names.indexOf(name)
  if (index < 0) throw new Error(`${String(r['Id'])}: rarity ${name}`)
  return index
}

/** The numbers an incident's effect reads from its text (INCIDENT_EFFECTS,
 * USURPATION_STEPS); the caller fills the other fields. */
function incidentRules(e: Record<string, unknown>, all: Record<string, unknown>[], names: string[]): Incident {
  const plain = typeof e['plain'] === 'string' ? (e['plain'] as string) : ''
  const x: Incident = {
    id: 0,
    name: '',
    weight: 0,
    spawn: 'any',
    exclude: [],
    repeatLimit: 0,
    count: 0,
    tiers: 0,
    chance: 0,
    tier: 0,
    next: null,
  }
  switch (asNumber(e['Id'])) {
    case 201:
      x.tier = rarityAfter(e, 'with a ', names)
      break
    case 202:
      x.count = textNumber(e, 'open ', ' cells')
      break
    case 203:
      x.tier = rarityAfter(e, 'rarity to ', names)
      break
    case 211:
      x.count = textNumber(e, 'make ', ' consecutive attempts')
      x.chance = textNumber(e, '', '% chance')
      break
    case 212:
      x.count = textNumber(e, 'up to ', ' Inmates')
      x.tiers = textNumber(e, 'by ', ' tier')
      break
    case 213:
      x.tiers = textNumber(e, 'by ', ' tier')
      break
    case 231:
      x.count = textNumber(e, 'next ', ' unopened')
      break
    case 232:
      x.tier = rarityAfter(e, 'rarity below ', names)
      break
    case 252:
    case 253:
    case 254:
    case 255: {
      x.count = plain.includes('Increase all Inmates') ? ALL_INMATES : textNumber(e, 'increase ', ' Inmate')
      x.tiers = textNumber(e, 'by ', ' tier')
      const addAt = plain.indexOf('Add [')
      if (addAt >= 0) {
        const rest = plain.slice(addAt + 'Add ['.length)
        const close = rest.indexOf(']')
        if (close < 0) throw new Error('usurpation next')
        const name = rest.slice(0, close)
        const stage = all.find((o) => o['name'] === name)
        if (stage === undefined) throw new Error('usurpation stage')
        x.next = asNumber(stage['Id'])
      }
      break
    }
    default:
      break
  }
  return x
}

/** The spawn rule of an incident. */
function spawnOf(value: unknown): Spawn {
  switch (value) {
    case 'any':
      return 'any'
    case 'unopened':
      return 'unopened'
    case 'opened':
      return 'opened'
    default:
      throw new Error(`spawnCellEnum ${JSON.stringify(value)}`)
  }
}

/** The repeat limit of an incident; "" and missing read as no limit. */
function repeatLimitOf(value: unknown): number {
  if (typeof value === 'number') return Math.trunc(Math.max(value, 0))
  if (typeof value === 'string') {
    const parsed = Number(value.trim())
    if (!Number.isFinite(parsed)) return 0
    return Math.trunc(Math.max(parsed, 0))
  }
  return 0
}

/** The task type of an objective. */
function objectiveKind(value: unknown): ObjectiveKind {
  switch (value) {
    case 'reach_rating':
      return 'reachRating'
    case 'devour_count':
      return 'devourCount'
    case 'open_cell_count':
      return 'openCellCount'
    case 'event_trigger_count':
      return 'eventTriggerCount'
    case 'move_distance':
      return 'moveDistance'
    default:
      throw new Error(`taskTypeEnum ${JSON.stringify(value)}`)
  }
}

/** The instruments of a data list, by the tools the engine knows. */
function toolExcludes(value: unknown): Tool[] {
  if (!Array.isArray(value)) return []
  const out: Tool[] = []
  for (const entry of value) {
    const tool = toolFromRl(asNumber(entry))
    if (tool !== null) out.push(tool)
  }
  return out
}

function load(source: unknown): Data {
  const d = asObject(source, 'warden-data.json')
  const board = asObject(d['board'], 'board')
  const rarities = asArray(d['rarities'], 'rarities').map((r) => asObject(r, 'rarity'))
  const rarityNames = rarities.map((r) => asText(r['name']))
  const species = asArray(d['species'], 'species').map((s) => asObject(s, 'species'))
  const glossary = asArray(d['glossary'], 'glossary').map((g) => asObject(g, 'glossary'))
  const glossaryName = (id: number): string => {
    const found = glossary.find((g) => asNumber(g['Id']) === id)
    if (found === undefined) throw new Error(`glossary id ${id}`)
    return asText(found['name'])
  }
  const beastOf = (id: unknown): Beast => {
    const index = species.findIndex((s) => s['Id'] === id)
    if (index < 0) throw new Error('species id')
    return BEAST_KEYS[index]
  }
  const foodChain = species.map((s) =>
    asArray(s['counters'], 'counters').map((id) => beastOf(id)),
  )

  const tools: ToolDef[] = TOOL_KEYS.map(() => ({
    weight: 0,
    exclude: [],
    chance: 0,
    tiers: null,
    fewerDice: 0,
    count: null,
    maxInmates: null,
    maxSealed: null,
    minOthers: null,
    maxSteps: null,
    minSteps: null,
    above: null,
    tier: null,
  }))
  const toolNames: string[] = TOOL_KEYS.map(() => '')
  const toolIds: Tool[] = []
  for (const item of asArray(d['instruments'], 'instruments')) {
    const r = asObject(item, 'instrument')
    const tool = toolFromRl(asNumber(r['Id']))
    if (tool === null) continue
    const index = toolIndex(tool)
    toolNames[index] = asText(r['name'])
    toolIds.push(tool)
    const def = tools[index]
    def.weight = asNumber(r['Weight'])
    def.exclude = toolExcludes(r['exclude'])
    def.chance = wrapped(r['chancePercent']) ?? 0
    const extra = wrapped(r['extraTiers'])
    def.tiers = extra === null ? null : Math.trunc(extra)
    switch (tool) {
      case 'muzzle':
        def.maxInmates = textNumber(r, 'no more than ', ' Inmates')
        break
      case 'chains':
      case 'dogtag':
        def.tiers = textNumber(r, '+', ' Rarity Tier')
        break
      case 'whip':
        def.fewerDice = 1
        break
      case 'blacklist':
        def.maxSealed = textNumber(r, 'no more than ', ' unopened')
        def.count = textNumber(r, ' Rarity Tier to ', ' random')
        def.tiers = textNumber(r, '+', ' Rarity Tier to')
        break
      case 'coin':
        def.tiers = textNumber(r, '+', ' Rarity Tiers')
        break
      case 'forgedkey':
        def.fewerDice = 1
        def.count = textNumber(r, 'opens ', ' additional')
        break
      case 'scapegoat':
        def.minOthers = textNumber(r, 'at least ', ' other')
        def.count = textNumber(r, 'removes ', ' other')
        break
      case 'axe':
        def.count = textNumber(r, 'opens ', ' cells')
        break
      case 'stake':
        def.fewerDice = 1
        def.tier = rarityAfter(r, 'rarity to ', rarityNames)
        break
      case 'shortchain':
        def.maxSteps = textNumber(r, 'no more than ', ' tiles')
        def.count = textNumber(r, 'opens ', ' cell')
        break
      case 'longchain':
        def.minSteps = textNumber(r, '', ' or more tiles')
        def.tiers = textNumber(r, '+', ' Rarity Tier')
        break
      case 'maul':
        def.above = textNumber(r, '+', ' tiers above')
        break
      default:
        break
    }
  }

  const incidentList = asArray(d['incidents'], 'incidents').map((e) => asObject(e, 'incident'))
  const incidents = incidentList.map((e) => {
    const rules = incidentRules(e, incidentList, rarityNames)
    return {
      id: asNumber(e['Id']),
      name: asText(e['name']),
      weight: asNumber(e['weight']),
      spawn: spawnOf(e['spawnCellEnum']),
      exclude: toolExcludes(e['excludeRelic']),
      repeatLimit: repeatLimitOf(e['repeatLimit']),
      count: rules.count,
      tiers: rules.tiers,
      chance: rules.chance,
      tier: rules.tier,
      next: rules.next,
    }
  })

  const objectives = asArray(d['objectives'], 'objectives').map((item) => {
    const o = asObject(item, 'objective')
    const kind = objectiveKind(o['taskTypeEnum'])
    let target = 0
    let rating = 0
    if (kind === 'reachRating') {
      const index = rarities.findIndex((r) => r['Id'] === o['target'])
      if (index < 0) throw new Error('objective rarity')
      rating = index
      target = 1
    } else {
      target = asNumber(o['target'])
    }
    return {
      id: asNumber(o['Id']),
      name: asText(o['name']),
      kind,
      target,
      rating,
      weight: asNumber(o['weight']),
    }
  })

  const themes = asArray(asObject(d['themes'], 'themes')['relics'], 'themes.relics').map((item) => {
    const t = asObject(item, 'theme')
    const value = wrapped(t['value'])
    return {
      id: asNumber(t['Id']),
      name: asText(t['name']),
      weight: asNumber(t['weight']),
      value: value === null ? null : Math.trunc(value),
    }
  })

  const rewards = asArray(d['chromaticRewards'], 'chromaticRewards').map((r) => asObject(r, 'reward'))
  const cards = asObject(asObject(board['interrogationRoom'], 'interrogationRoom')['cards'], 'cards')

  return new Data({
    cellCount: asNumber(board['cells']),
    room: asNumber(asObject(board['interrogationRoom'], 'interrogationRoom')['cell']),
    diceOptions: asNumber(asObject(board['dice'], 'dice')['options']),
    minPips: asNumber(asObject(board['dice'], 'dice')['minPips']),
    maxPips: asNumber(asObject(board['dice'], 'dice')['maxPips']),
    days: asNumber(board['days']),
    openRoomsAtStart: asNumber(board['openRoomsAtStart']),
    instrumentPicks: asNumber(board['instrumentPicks']),
    objectivesPerRun: asNumber(board['objectivesPerRun']),
    minMarkers: asNumber(board['minIncidentMarkers']),
    themeChancePer10000: asNumber(asObject(board['specialTheme'], 'specialTheme')['chancePer10000']),
    themePityRuns: asNumber(asObject(board['specialTheme'], 'specialTheme')['pityRuns']),
    tierWeights: rarities.slice(0, RAINBOW).map((r) => asNumber(r['weight'])),
    oppressPerTier: asNumber(asObject(asObject(d['oppress'], 'oppress')['penaltyPerTierPercent'], 'penalty')['value']),
    foodChain,
    toolIds,
    tools,
    incidents,
    objectives,
    themes,
    tierNames: rarityNames,
    beastNames: species.map((s) => asText(s['name'])),
    toolNames,
    giftNames: GIFT_KEYS.map((gift) => {
      const row = giftIndex(gift) + 1
      const found = rewards.find((r) => asNumber(r['Id']) === row)
      if (found === undefined) throw new Error('gift row')
      return asText(found['name'])
    }),
    cardNames: CARD_KEYS.map((card) => asText(asObject(cards[card], 'card')['name'])),
    huntName: asText(asObject(asObject(board['actions'], 'actions')['hunt'], 'hunt')['name']),
    incidentTerm: glossaryName(16000103),
    instrumentName: glossaryName(16000105),
    treasureName: glossaryName(16000118),
  })
}

let parsed: Data | null = null

/** The raw data file: the JSON module's shape is checked by the readers. */
const source = raw as unknown

/** The parsed game data. */
export function data(): Data {
  if (parsed === null) parsed = load(source)
  return parsed
}
