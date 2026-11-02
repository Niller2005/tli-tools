//! A board model from a read S16 screen: the scene gives the cells and the
//! warden, the panels give the step, the day, the doors and the vault. Every
//! low-confidence read and every part the screen does not show becomes a
//! warning for the player to check.

import { blankModel, cloneCell, cloneModel, Model, type CellModel } from '@/board/board'
import { beastIndex, data, IRON_LAW, type Tool } from '@/engine/data'
import { eats } from '@/engine/devour'
import { Params } from '@/engine/state'
import { cellLabel, cellList, tierName } from '@/engine/text'
import { CELLS, GLOW_MIN, type CellRead, type Scene } from './scene'
import type { Panels } from './panels'

/** Length of an S16 run: the counter starts at 20 days until Riot, except
 * under the Iron Law theme, which extends the run (see [`ironLawDays`]). */
export const RUN_DAYS = 20

/** Length of an Iron Law run. */
export function ironLawDays(): number {
  const theme = data().theme(IRON_LAW)
  return theme?.value ?? RUN_DAYS
}

/** Padlock, beast, incident and warden reads below this confidence are flagged. */
const CONF = 0.3
/** Tier reads below this confidence are flagged (tests/reader.rs measures it). */
export const TIER_CONF = 0.4

/** The model index of a screen cell number (1 = the Interrogation Room). */
function index(cell: number): number {
  return cell - 1
}

/** What kind of warning it is. */
export type WarningKind =
  /** A low-confidence or missing read, or a screen the solver can't use as
   * is: something for the player to check. */
  | 'read'
  /** A doubtful read of one cell's content: which read is doubtful and what
   * it gave are data (see [`CellReadDetail`]) and the sentence is built
   * from them (see [`warningText`]), so the same read on the same cell is
   * the same warning whatever its confidence. */
  | 'cellRead'
  /** The Consume targets a target screen marks differ from the ones the
   * board read allows (see [`consumeTargets`] in the session). */
  | 'targetsDiffer'
  /** The held instruments show as icons only, so the player has to name them. */
  | 'heldToolsUnknown'
  /** A routine line on what was read or kept, such as a pick over the
   * board or a hidden days counter: nothing to check. */
  | 'note'
  /** A line over a reading kept in place of a read, see [`KeptKind`]. */
  | 'kept'

/** Which read of a cell is doubtful, for a `cellRead` warning. */
export type CellReadDetail =
  /** Locked or open. */
  | 'lock'
  /** The Prison Incident marker. */
  | 'event'
  /** The rarity glow behind a locked door. */
  | 'glow'
  /** The cell read as empty. */
  | 'empty'
  /** The beast in the cell. */
  | 'beast'
  /** The rarity of the beast. */
  | 'rarity'
  /** A tooltip panel covers the cell. */
  | 'tooltip'
  /** The portrait shows no rarity glow (the game draws none after a
   * reconnect), so the rarity is kept or assumed. */
  | 'glowless'
  /** A Prey mark with no Lion to link it to. */
  | 'prey'

/** Which keep held the last reading in place of a read. */
export type KeptKind =
  /** A game dialog covers the board. */
  | 'popup'
  /** The prison board is not on screen. */
  | 'offBoard'
  /** The board fades in after a Consume target screen. */
  | 'fading'
  /** The run theme scroll. */
  | 'theme'
  /** A game window narrower than 16:9, whose layout is untested. */
  | 'shape'

/** Something the reader asks the player to check before trusting the pick.
 * The sentence the player sees is [`warningText`]: a `cellRead` and a
 * `kept` line are built from their data, the rest carry theirs. */
export type Warning =
  | { kind: 'read'; cell: number | null; text: string }
  | { kind: 'cellRead'; cell: number; detail: CellReadDetail; read?: string; confidence?: number }
  | { kind: 'targetsDiffer'; cell: number; text: string }
  | { kind: 'heldToolsUnknown'; cell: null; text: string }
  | { kind: 'note'; cell: null; text: string }
  | { kind: 'kept'; cell: null; keep: 'popup' | 'offBoard' | 'fading' }
  | { kind: 'kept'; cell: null; keep: 'theme'; theme: string }
  | { kind: 'kept'; cell: null; keep: 'shape'; size: [number, number] }

/** A line over a reading kept in place of a read, see [`KeptKind`]. */
export type KeptWarning = Extract<Warning, { kind: 'kept' }>

/** The sentence of a warning, for the command line, the run log and the
 * screen: the one place the player's words are chosen. */
export function warningText(w: Warning): string {
  if (w.kind === 'cellRead') return cellReadText(w)
  if (w.kind === 'kept') return keptText(w)
  return w.text
}

/** The sentence of a doubtful cell read. */
function cellReadText(w: Extract<Warning, { kind: 'cellRead' }>): string {
  const at = cellLabel(w.cell)
  const conf = fmt2(w.confidence ?? 0)
  switch (w.detail) {
    case 'lock':
      return `Check cell ${at}: read as ${w.read} (confidence ${conf}).`
    case 'event':
      return `Check cell ${at}: ${data().incidentTerm} marker read with confidence ${conf}.`
    case 'glow':
      return `Check cell ${at}: the glow behind the locked door read as ${w.read} (confidence ${conf}).`
    case 'empty':
      return `Check cell ${at}: read as an empty cell (confidence ${conf}).`
    case 'beast':
      return `Check cell ${at}: beast read as ${w.read} (confidence ${conf}).`
    case 'rarity':
      return `Check cell ${at}: rarity read as ${w.read} (confidence ${conf}).`
    case 'tooltip':
      return `Check cell ${at}: a tooltip covers it.`
    case 'glowless':
      return `Check cell ${at}: the portrait shows no rarity glow, so it is read as ${w.read}.`
    case 'prey':
      return `Check cell ${at}: a Prey mark read with no ${data().beastNames[beastIndex('lion')]} to link it to.`
  }
}

/** The sentence of a line over a reading kept in place of a read. */
function keptText(w: KeptWarning): string {
  switch (w.keep) {
    case 'popup':
      return 'A popup covers the game: showing the last reading.'
    case 'offBoard':
      return 'The prison board is not on screen: showing the last reading.'
    case 'fading':
      return 'The board is still coming in: showing the last reading.'
    case 'theme':
      return `The run's theme: ${w.theme}.`
    case 'shape':
      return `The game window is ${w.size[0]} x ${w.size[1]}, narrower than 16:9: that layout is untested and isn't read. Set the game to a 16:9 or wider size: fullscreen or borderless, or a window such as 1920 x 1080 that is not maximized.`
  }
}

/** The line shown over the last reading while a frame was kept, not read
 * (see [`KeptKind`]): which keep it was, with the theme name or the frame
 * size it tells of. */
export function keptWarning(keep: 'popup' | 'offBoard' | 'fading'): KeptWarning
export function keptWarning(keep: 'theme', theme: string): KeptWarning
export function keptWarning(keep: 'shape', size: [number, number]): KeptWarning
export function keptWarning(keep: KeptKind, about?: string | [number, number]): KeptWarning {
  if (keep === 'theme') return { kind: 'kept', cell: null, keep, theme: about as string }
  if (keep === 'shape') return { kind: 'kept', cell: null, keep, size: about as [number, number] }
  return { kind: 'kept', cell: null, keep }
}

/** A warning to check. */
function read(text: string): Warning {
  return { kind: 'read', cell: null, text }
}

/** A warning that is nothing to check. */
function note(text: string): Warning {
  return { kind: 'note', cell: null, text }
}

/** A warning about a cell that is not a read of its content (the warden's
 * place, a meal the session assumed). */
function cellWarning(cell: number, text: string): Warning {
  return { kind: 'read', cell, text }
}

/** A doubtful read of cell `cell` (a model index) the reader measured at
 * `confidence`: what it gave is `read`, so the same read again on the same
 * cell is the same warning. */
function lowConf(cell: number, detail: CellReadDetail, read: string | undefined, confidence: number): Warning {
  return { kind: 'cellRead', cell, detail, read, confidence }
}

/** A doubtful read of cell `cell` (a model index) that no confidence measures. */
function cellDoubt(cell: number, detail: 'tooltip' | 'glowless' | 'prey', read?: string): Warning {
  return { kind: 'cellRead', cell, detail, read }
}

/** A warning that the held instruments have to be named. */
function heldToolsUnknown(text: string): Warning {
  return { kind: 'heldToolsUnknown', cell: null, text }
}

/** `under` is the last board read before this frame: an instrument or treasure
 * pick covers the board, so the cells, the warden and the day come from it, or
 * from the run start (every cell locked) without one. On a board frame it
 * gives the cells a tooltip panel covers. `runDays` is the run's length. */
export function toModel(scene: Scene, panels: Panels, heldTools: Tool[], under: Model | null, runDays: number): [Model, Warning[]] {
  const d = data()
  const warn: Warning[] = []
  const covered = panels.screen === 'instrumentPick' || panels.screen === 'treasurePick'
  let m: Model
  if (under !== null && covered) {
    warn.push(note(`The pick covers the board: the cells are from the last board read (day ${under.day}).`))
    m = cloneModel(under)
  } else if (covered) {
    warn.push(
      read(
        'The pick covers the board and no board was read before it: the run start is assumed (every cell locked). For a pick later in the run, read the board first.'
      )
    )
    m = blankModel()
  } else {
    m = blankModel()
  }
  m.maxDays = runDays
  m.dest = []
  if (!covered) readBoard(scene, under, m, warn)

  if (panels.days !== null) {
    m.day = Math.max(m.maxDays - panels.days, 1)
  } else if (!(covered && under !== null)) {
    warn.push(read('The days counter did not read: day 1 assumed.'))
  }

  switch (panels.screen) {
    case 'patrol': {
      m.step = 'patrol'
      panels.doors.forEach((door, k) => {
        if (door !== null) m.dest.push(index(door))
        else warn.push(read(`Card ${k + 1} did not read: check today's doors.`))
      })
      if (panels.doors.length === 0) warn.push(read("No destination card read: check today's doors."))
      break
    }
    case 'manage': {
      m.step = 'manage'
      m.devourUsed = !panels.decision.includes('Consume')
      m.swapUsed = !panels.decision.includes('Replace')
      m.huntUsed = !panels.decision.includes('Hunt')
      break
    }
    case 'instrumentPick': {
      m.step = 'choice'
      m.choice.kind = 'tool'
      m.choice.options = panels.instruments.slice()
      m.choice.rerolls = panels.rerolls
      if (panels.instruments.length !== 3) {
        warn.push(read(`Read ${panels.instruments.length} of the 3 ${d.instrumentName}s on offer.`))
      }
      break
    }
    case 'treasurePick': {
      m.step = 'choice'
      m.choice.kind = 'gift'
      m.choice.options = []
      break
    }
    // The Hunt's target pick, played with the Blood-Stained Trap from a
    // Lion's cell, else the Sewer Ratway's cell pick.
    case 'cellPick': {
      m.step = 'choice'
      const cell = m.cells[m.warden]
      const lion = cell !== undefined && cell.kind === 'inmate' && cell.beast === 'lion'
      m.choice.kind = lion && heldTools.includes('trap') ? 'prey' : 'cell'
      m.choice.options = []
      break
    }
    case 'interrogation': {
      m.step = 'choice'
      m.choice.kind = 'interrogation'
      m.choice.options = []
      break
    }
    // The session solves a Consume target pick from the manage board before it.
    case 'chainTarget': {
      m.step = 'manage'
      break
    }
    // The board under a pick, with no decision on screen: the treasure
    // pick follows the day's consume, so it reads as the manage step with
    // nothing left but to end the day.
    case 'prisonStatus': {
      m.step = 'manage'
      m.devourUsed = true
      m.swapUsed = true
      m.huntUsed = true
      break
    }
    case 'dayBanner': {
      m.step = 'manage'
      warn.push(note("This screen (the day banner) can't be solved: the board is read as the manage step."))
      break
    }
    case 'popup': {
      m.step = 'patrol'
      warn.push(read('A game dialog covers the board: close it and read again.'))
      break
    }
    case 'theme': {
      m.step = 'patrol'
      const name = d.themeName(panels.theme) ?? 'unknown'
      warn.push(note(`The run's theme: ${name}. Nothing to solve on this screen.`))
      break
    }
    case 'runEnd': {
      m.step = 'patrol'
      warn.push(note('The riot screen: the run is over, nothing to solve.'))
      break
    }
    case 'unknown': {
      m.step = 'patrol'
      warn.push(read('No destination cards or decision buttons on screen: take the screenshot when they show.'))
      break
    }
  }

  if (panels.vault.length > 0) m.vault = []
  panels.vault.forEach((slot, k) => {
    if (slot.beast !== null && slot.conf >= CONF) m.vault.push(slot.beast)
    else {
      m.vault.push('mammoth')
      warn.push(read(`Chromatic Prisoner ${k + 1}: beast not read, Mammoth assumed.`))
    }
  })

  // A pick, a tooltip or a dialog can hide the objective panel: the last
  // board's objective stands until the panel reads again.
  m.objective = panels.objective !== null ? { id: panels.objective.id, progress: panels.objective.progress } : (under?.objective ?? null)

  m.tools = heldTools.slice()
  if (heldTools.length === 0 && panels.toolIcons && panels.held === null) {
    warn.push(heldToolsUnknown(`The ${d.instrumentName} panel shows icons the reader can't name: pass them with --tools.`))
  }
  return [m, warn]
}

/** The cells and the warden from the board scene. */
function readBoard(scene: Scene, under: Model | null, m: Model, warn: Warning[]): void {
  const kept: number[] = []
  const unlit: number[] = []
  for (const c of CELLS) {
    const r = scene.cell(c)
    const n = index(c)
    if (r.covered) {
      if (under !== null) {
        m.cells[n] = cloneCell(under.cells[n])
        kept.push(n)
        continue
      }
      warn.push(cellDoubt(n, 'tooltip'))
    }
    if (r.lockedConf < CONF) {
      warn.push(lowConf(n, 'lock', r.locked ? 'locked' : 'open', r.lockedConf))
    }
    if (r.event && r.eventConf < CONF) {
      warn.push(lowConf(n, 'event', undefined, r.eventConf))
    }
    const event = r.event ? 'unknown' : null
    m.cells[n] = cellModel(r, event, n, under, unlit, warn)
  }
  if (kept.length > 0) {
    const it = kept.length === 1 ? 'it is' : 'they are'
    warn.push(note(`A tooltip covers ${cellList(kept)}: ${it} kept from the last board read.`))
  }
  if (unlit.length > 0) {
    warn.push(
      note(
        `The portraits in ${cellList(unlit)} show no rarity glow (the game draws none after a reconnect): the rarities are kept from the last board read.`
      )
    )
  }

  if (scene.warden !== null) {
    m.warden = index(scene.warden)
    if (scene.wardenConf < CONF) {
      warn.push(
        cellWarning(index(scene.warden), `Check the warden: read at cell ${cellLabel(index(scene.warden))} (confidence ${fmt2(scene.wardenConf)}).`)
      )
    }
  } else {
    warn.push(read("The warden's arrow was not found: the warden is put in the Interrogation Room."))
  }

  // A Prey crosshair is drawn on the prey only: it goes to a Lion of the
  // same rarity that eats the prey, the warden's first (the Hunt is played
  // from the Lion's cell), else the lowest cell. A Lion holds one mark.
  for (const c of CELLS) {
    if (!scene.cell(c).prey || scene.cell(c).covered) continue
    const n = index(c)
    const cell = m.cells[n]
    if (cell === undefined || cell.kind !== 'inmate') continue
    const meal = cell.beast
    const tier = cell.tier
    const free = (l: number): boolean => {
      if (l === n) return false
      const other = m.cells[l]
      if (other === undefined || other.kind !== 'inmate') return false
      return other.beast === 'lion' && other.tier === tier && other.prey === null && eats('lion').includes(meal)
    }
    let lion: number | null = null
    if (m.warden >= 0 && m.warden < m.cells.length && free(m.warden)) lion = m.warden
    else {
      for (let l = 0; l < m.cells.length; l++) {
        if (free(l)) {
          lion = l
          break
        }
      }
    }
    if (lion === null) {
      warn.push(cellDoubt(n, 'prey'))
      continue
    }
    const target = m.cells[lion]
    if (target !== undefined && target.kind === 'inmate') {
      target.prey = { cell: n, rounds: new Params().preyRounds }
    }
  }
}

/** The cell's model, as the board scene read it. */
function cellModel(
  r: CellRead,
  event: 'unknown' | null,
  n: number,
  under: Model | null,
  unlit: number[],
  warn: Warning[],
): CellModel {
  if (r.locked) {
    if (r.glow !== null && r.glowConf >= TIER_CONF) return { kind: 'scratch', tier: r.glow, event }
    if (r.glow !== null) {
      warn.push(lowConf(n, 'glow', tierName(r.glow), r.glowConf))
    }
    return { kind: 'sealed', event }
  }
  if (r.inmate === null) {
    if (r.beastConf < CONF) {
      warn.push(lowConf(n, 'empty', undefined, r.beastConf))
    }
    return { kind: 'empty', event }
  }
  const beast = r.inmate.beast
  // After a reconnect the game draws the portraits with no
  // rarity glow, so a portrait with none keeps the rarity
  // the last board read gave the same beast in this cell.
  const glowless = r.halo < GLOW_MIN
  const before = under?.cells[n]
  const was = before !== undefined && before.kind === 'inmate' && before.beast === beast ? before.tier : null
  const tier = was !== null && glowless ? (unlit.push(n), was) : r.inmate.tier
  const name = `${tierName(tier)} ${data().beastNames[beastIndex(beast)]}`
  if (r.beastConf < CONF) {
    warn.push(lowConf(n, 'beast', name, r.beastConf))
  } else if (glowless && was === null) {
    warn.push(cellDoubt(n, 'glowless', name))
  } else if (!glowless && r.tierConf < TIER_CONF) {
    warn.push(lowConf(n, 'rarity', name, r.tierConf))
  }
  return { kind: 'inmate', beast, tier, ivory: r.tusk, prey: null, event }
}

/** Rust's `{:.2}`: the number rounded to two decimals, ties to even. */
function fmt2(x: number): string {
  const { digits, exp, negative } = exactDecimal(x)
  // The value is digits * 10^exp; scale it by 100 and round to an integer.
  const scaled = digits * 100n
  let q: bigint
  if (exp >= 0) {
    q = scaled * 10n ** BigInt(exp)
  } else {
    const p = 10n ** BigInt(-exp)
    q = scaled / p
    const rest = scaled % p
    const twice = rest * 2n
    if (twice > p || (twice === p && q % 2n === 1n)) q += 1n
  }
  const whole = q / 100n
  const frac = (q % 100n).toString().padStart(2, '0')
  return `${negative ? '-' : ''}${whole.toString()}.${frac}`
}

/** The exact decimal expansion of a finite double: `digits * 10^exp`. */
function exactDecimal(x: number): { digits: bigint; exp: number; negative: boolean } {
  if (!Number.isFinite(x)) return { digits: 0n, exp: 0, negative: false }
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, x)
  const hi = view.getUint32(0)
  const lo = view.getUint32(4)
  const expBits = (hi >>> 20) & 0x7ff
  let mant = (BigInt(hi & 0xfffff) << 32n) | BigInt(lo)
  let exp = expBits - 1075
  if (expBits === 0) exp = -1074
  else mant |= 1n << 52n
  const negative = (hi >>> 31) === 1
  if (mant === 0n) return { digits: 0n, exp: 0, negative }
  if (exp >= 0) {
    mant *= 2n ** BigInt(exp)
    return { digits: mant, exp: 0, negative }
  }
  // value = mant * 2^exp = mant * 5^(-exp) * 10^exp.
  mant *= pow5(-exp)
  return { digits: mant, exp, negative }
}

/** 5 to the power of a small exponent. */
function pow5(n: number): bigint {
  let out = 1n
  let base = 5n
  let e = n
  while (e > 0) {
    if (e & 1) out *= base
    base *= base
    e >>= 1
  }
  return out
}
