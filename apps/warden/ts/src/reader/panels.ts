//! The text panels of the S16 prison screen (docs/s16-screen.md): which
//! screen is up, the destination cards, the decision buttons, the days
//! counter and the instrument or treasure offers, read with the OCR engine
//! from fixed regions of the 1918x1078 frame. The Chromatic Prisoner slots
//! and the instrument icons are read from pixels.

import { readHeld } from './instruments'
import { ocr, ocrAll, ocrDigits, type Line } from './ocr'
import { beastAt, pickShown } from './scene'
import { type Layout } from './layout'
import { Rect, type Rgba } from './mod'
import { data, type Beast, type Tool, GIFT_KEYS } from '@/engine/data'

/** The screen on the frame. */
export type Screen =
  | 'patrol'
  | 'manage'
  | 'chainTarget'
  | 'instrumentPick'
  | 'treasurePick'
  | 'prisonStatus'
  | 'interrogation'
  | 'cellPick'
  | 'dayBanner'
  | 'theme'
  | 'popup'
  | 'runEnd'
  | 'unknown'

/** The screen name used by the labels in data/scan-truth-s16.json. */
export function screenLabel(screen: Screen): string {
  switch (screen) {
    case 'patrol':
    case 'manage':
    case 'unknown':
      return 'board'
    case 'chainTarget':
      return 'chainTarget'
    case 'instrumentPick':
      return 'instrumentPick'
    case 'treasurePick':
      return 'treasurePick'
    case 'prisonStatus':
      return 'prisonStatus'
    case 'interrogation':
      return 'interrogation'
    case 'cellPick':
      return 'cellPick'
    case 'dayBanner':
      return 'dayBanner'
    case 'theme':
      return 'theme'
    case 'popup':
      return 'popup'
    case 'runEnd':
      return 'runEnd'
  }
}

/** A filled Chromatic Prisoner slot: the beast when its portrait matches a
 * board template, with the match confidence. */
export interface VaultSlot {
  beast: Beast | null
  conf: number
}

/** Something the player clicks on a decision screen. */
export type Spot =
  /** A destination card by the screen cell its door leads to (1 = the
   * Interrogation Room). */
  | { kind: 'door'; door: number }
  /** "Consume", "Replace", "Hunt", "End", "Cancel" or "Re-roll". */
  | { kind: 'button'; button: string }
  /** A pick card by its key: an instrument's, "instigate" or "bestow". */
  | { kind: 'card'; card: string }

/** The panels of a frame. */
export interface Panels {
  screen: Screen
  /** "N day(s) until Riot". */
  days: number | null
  /** Destination cards in order, as screen cell numbers (1 = Go to
   * Interrogation Room); null for a card whose text did not read. */
  doors: (number | null)[]
  /** Buttons on screen: "Consume", "Replace", "Hunt", "End", or "Cancel" on a
   * target pick. */
  decision: string[]
  /** The instruments on an instrument pick, in card order. */
  instruments: Tool[]
  /** The re-rolls left on an instrument pick ("Remaining attempts N" over
   * the Re-roll button); 0 without the button and on every other screen. */
  rerolls: number
  /** Filled Chromatic Prisoner slots. */
  vault: VaultSlot[]
  /** The Torture Instrument panel shows at least one icon. */
  toolIcons: boolean
  /** The theme the run theme scroll names; null on every other screen. */
  theme: number | null
  /** The run objective the objective panel names, as (id, progress); see
   * [`objective`]. */
  objective: { id: number; progress: number } | null
  /** The instruments the panel icons name; null off the board screens or
   * when an icon is unsure. */
  held: Tool[] | null
  /** What can be clicked on this screen, with the layout it was read from
   * and its centre on the reference frame. The board cells are not here:
   * see [`../scene::portrait`]. */
  spots: [Spot, Layout, [number, number]][]
}

/** Whether the prison board is not on screen to read: no decision, dialog or riot
 * title was found and the days counter, which every board screen but the
 * Consume target pick shows, did not read (a loading screen, the
 * hideout), or a day banner hides the counter. */
export function offBoard(p: Panels): boolean {
  return (p.screen === 'unknown' || p.screen === 'dayBanner') && p.days === null
}

/** The regions (x, y, w, h) at 1918x1078 and the upscale each reads best at:
 * the days counter, the title band, the heading, the cards, the Consume
 * target pick's heading, its Cancel button, the day banner, the dialogs, the
 * Prison Incident title, the theme scroll's title, the objective panel, the
 * View Prison Status button, the riot title and the pick cards' names. */
function regions(): [Rect, number][] {
  return [
    // The days counter.
    [new Rect(800, 0, 320, 60), 2.0],
    // The title band.
    [new Rect(0, 70, 1918, 60), 1.5],
    // The heading.
    [new Rect(420, 680, 1100, 40), 2.0],
    // Wide enough for the four decision cards of a Hunt day, whose Consume and
    // End names sit at about x 440 and 1476 (hunt-run-0005).
    [new Rect(360, 740, 1160, 200), 1.5],
    // The Consume target pick's heading.
    [new Rect(700, 800, 520, 50), 2.0],
    // Its Cancel button.
    [new Rect(1600, 740, 318, 140), 2.0],
    // The day banner.
    [new Rect(760, 400, 400, 130), 2.0],
    // The game's dialogs: "Tip" over "Network request timeout", and the title
    // of a Prison Incident popup.
    [new Rect(560, 340, 800, 260), 1.0],
    // The Prison Incident popup's title.
    [new Rect(1100, 190, 700, 70), 1.0],
    // The title band of the run theme scroll, inside the DIALOG region.
    [new Rect(660, 310, 600, 70), 1.0],
    // The objective panel at the top left of the board: the name, the task and
    // the progress ("0/2") or "Completed". A name on two lines starts higher.
    [new Rect(30, 110, 370, 140), 1.5],
    // The "Return to Selection" button of View Prison Status, where a pick
    // shows "View Prison Status".
    [new Rect(1540, 115, 300, 40), 2.0],
    // The title of the riot screen that ends a run.
    [new Rect(400, 95, 1120, 80), 1.0],
    // The card names on the Select a Torture Instrument screen, one row across
    // the cards at y 480-515 (rec1-t031, a small font for "Ferocious Beast's
    // Ravenous Chains"); the hovered card is raised, its name at about y 435-470.
    // The descriptions start below about y 550.
    [new Rect(0, 420, 1918, 125), 1.0],
  ]
}

/** "Remaining attempts N" over the Re-roll button; read from the title layout (see layout's TITLE_ZONES). */
function rerollsRegion(): [Rect, number] {
  return [new Rect(640, 880, 320, 45), 2.0]
}
/** Distance between the centres of two destination cards. */
const CARD_PITCH = 345
/** Where a lone End button's name sits, centred on the row (day 17 frame: 959, 877). */
function endAlone(): Rect {
  return new Rect(880, 855, 160, 45)
}
/** The middle of the destination cards' row, which spans y 750-920 with the
 * text at y 880 (rec1-t049). */
const DOOR_Y = 835
/** How far above its name a decision button's icon and name centre (the
 * names at y 880, the icons at y 810 on rec1-t055). */
const BUTTON_ABOVE = 35
/** The middle of the Select a Torture Instrument cards, y 187-870 with the
 * names at about y 500 (reroll-2000x837). */
const PICK_Y = 528
/** The Consume target pick's round Cancel button (rec1-t057). */
const CANCEL_AT: [number, number] = [1724, 803]
/** The Re-roll button under "Remaining attempts N" (reroll-2000x837). */
const REROLL_AT: [number, number] = [787, 959]

/** Chromatic Prisoner slots in fill order: two columns, top to bottom. */
const SLOT_X = [1720, 1805]
const SLOT_Y = [240, 335, 430, 525, 620]
/** Mean luma over a slot's centre above which it holds a portrait. */
const SLOT_FILLED = 60.0
/** The first instrument icon of the Torture Instrument panel. */
const ICON: [number, number] = [122, 390]
/** Luma standard deviation over the first icon spot above which an icon is there. */
const ICON_SPREAD = 30.0

/** f32 rounding: the reader's arithmetic is single precision. */
const f = Math.fround

/** Lowercase ASCII letters and digits only: spacing and punctuation are the
 * parts OCR gets wrong most. */
export function squash(s: string): string {
  let out = ''
  for (const c of s) {
    if (/[a-zA-Z0-9]/.test(c)) out += c.toLowerCase()
  }
  return out
}

/** Levenshtein distance over chars. */
function distance(a: string, b: string): number {
  const row0 = Array.from({ length: b.length + 1 }, (_, i) => i)
  const row = [...row0]
  let i = 0
  for (const ca of a) {
    let prev = row[0]
    row[0] = i + 1
    for (let j = 0; j < b.length; j++) {
      const cur = row[j + 1]
      row[j + 1] = Math.min(prev + (ca === b[j] ? 0 : 1), row[j] + 1, cur + 1)
      prev = cur
    }
    i += 1
  }
  return row[b.length]
}

/** 1 for the same text up to case, spacing and punctuation, falling with the
 * edit distance. */
export function similarity(a: string, b: string): number {
  const x = squash(a)
  const y = squash(b)
  const n = Math.max(x.length, y.length)
  if (n === 0) return 0.0
  return f(1.0 - f(distance(x, y) / n))
}

/** The candidate closest to `text` and its similarity, when at least `min`. */
export function bestMatch(text: string, candidates: string[], min: number): [number, number] | null {
  let best = -1
  let bestScore = -Infinity
  for (let i = 0; i < candidates.length; i++) {
    const s = similarity(text, candidates[i])
    // The last of several equal bests wins, as Rust's `max_by` does.
    if (s >= bestScore) {
      bestScore = s
      best = i
    }
  }
  if (best < 0 || bestScore < min) return null
  return [best, bestScore]
}

/** Whether any of the lines reads as the target. */
function has(lines: Line[], target: string, min: number): boolean {
  return lines.some((l) => similarity(l.text, target) >= min || squash(l.text).includes(squash(target)))
}

/** A number as OCR writes it: letters that look like digits count as digits. */
export function number(token: string): number | null {
  let digits = ''
  for (const c of token) {
    if (c === 'O' || c === 'o' || c === 'D' || c === 'Q') digits += '0'
    else if (c === 'I' || c === 'l' || c === '|' || c === 'i') digits += '1'
    else if (c === 'Z' || c === 'z') digits += '2'
    else if (c === 'S' || c === 's') digits += '5'
    else if (c === 'B') digits += '8'
    else digits += c
  }
  if (!/^\d+$/.test(digits)) return null
  return Number(digits)
}

/** The number of "N day(s) until Riot" as written, before it is taken as a
 * number, and the box of the line it starts. The number is what comes before
 * "day", or before the first space when "day" misreads. OCR can drop the
 * space ("0day(s)") and reads the red 0 as "()". On a frame scaled up from a
 * short window the number can come as its own line after the text, so the
 * lines go left to right. */
function daysHead(lines: Line[]): [string, Rect] | null {
  const sorted = [...lines].sort((a, b) => a.rect.x - b.rect.x)
  const text = joined(sorted).trim()
  const lower = text.toLowerCase()
  const at = lower.indexOf('day') >= 0 ? lower.indexOf('day') : lower.indexOf(' ')
  if (at < 0) return null
  const head = text.slice(0, at)
  const rest = text.slice(at)
  if (!(similarity(rest, 'day(s) until Riot') >= 0.6 || squash(rest).endsWith('riot'))) return null
  return [head.replace(/ /g, '').replace('()', '0'), sorted[0].rect]
}

/** "N day(s) until Riot" as the line's text gives it. */
export function days(lines: Line[]): number | null {
  const head = daysHead(lines)
  return head === null ? null : number(head[0])
}

/** The width of one digit of the counter in the frame's pixels, and the
 * margin around the digits read alone. */
const DAYS_DIGIT_W = 21
const DAYS_MARGIN = 3

/** [`days`], with a number that came with letters in it ("O day(s)") read
 * again as digits alone: the large digits of the counter read as letters
 * under the line's free read (a 9 as O), and a letter taken for a 0 would
 * count the Riot days down to 0 for good. */
async function daysRead(img: Rgba, lines: Line[]): Promise<number | null> {
  const head = daysHead(lines)
  if (head === null) return null
  const [text, at] = head
  const plain = number(text)
  if (text.length === 0 || /^\d+$/.test(text)) return plain
  const box = new Rect(at.x - DAYS_MARGIN, at.y - DAYS_MARGIN, text.length * DAYS_DIGIT_W + 2 * DAYS_MARGIN, at.h + 2 * DAYS_MARGIN)
  const alone = await ocrDigits(img, box, 2.0)
  return alone.length === text.length ? Number(alone) : plain
}

/** A game dialog: the "Tip" box of a network timeout, the connecting notice,
 * or a Prison Incident popup titled with the incident's name. */
export function popup(dialog: Line[], incident: Line[]): boolean {
  const names = data().incidents.map((e) => e.name)
  return (
    dialog.some((l) => squash(l.text) === 'tip') ||
    has(dialog, 'Network request timeout', 0.75) ||
    has(dialog, 'Connecting to server', 0.75) ||
    incident.some((l) => bestMatch(l.text, names, 0.75) !== null)
  )
}

/** The theme a run theme scroll's title names. */
export function theme(title: Line[]): number | null {
  const found = data().themes.find((t) => has(title, t.name, 0.75))
  return found === undefined ? null : found.id
}

/** The objective the panel names, as (id, progress). The name can wrap onto
 * two lines, so the panel's text joined also counts. "Completed" is the
 * objective's target (1 for a rating objective). When the name reads but the
 * progress does not, the progress is 0: the objective still steers the
 * solve, and a later read corrects the count. */
export function objective(lines: Line[]): { id: number; progress: number } | null {
  const sorted = [...lines].sort((a, b) => a.rect.y - b.rect.y)
  const text = squash(joined(sorted))
  const goal = data().objectives.find((o) => has(lines, o.name, 0.75) || text.includes(squash(o.name)))
  if (goal === undefined) return null
  let progress = 0
  for (const l of lines) {
    const p = progressOf(l.text, goal.target)
    if (p !== null) {
      progress = p
      break
    }
  }
  return { id: goal.id, progress }
}

/** A progress line: "N/M" gives N, "Completed" gives `target`. "Completed"
 * ends the task's line ("Move 18 tiles Completed"), and OCR can glue it to
 * the word before ("UltimateCompleted"), so the last word or its tail counts.
 * OCR glues the count to the task too ("times0/2") and can read its 1 as an
 * l ("timesl/2"), so the digits and digit-like letters next to the slash
 * count first, then the whole word read as a number. No task's last word
 * ends in one of those letters. The count after the slash is the known
 * target, so only a count above it is refused. */
export function progressOf(text: string, target: number): number | null {
  if (similarity(text, 'Completed') >= 0.75 || completedTail(text)) return target
  const at = text.trim().lastIndexOf('/')
  if (at < 0) return null
  const head = text.trim().slice(0, at)
  const parts = head.split(/\s+/)
  const word = parts[parts.length - 1]
  if (word === undefined) return null
  const count = word.replace(/[0-9OoIl|i]+$/, '')
  const done = number(count.length < word.length ? word.slice(count.length) : word)
  if (done === null || done > target) return null
  return done
}

/** Whether the line's last word, or its last 8 to 10 letters, reads as
 * "Completed". */
export function completedTail(text: string): boolean {
  const parts = text.split(/\s+/)
  const word = parts[parts.length - 1]
  if (word === undefined) return false
  const chars = [...squash(word)]
  for (let n = 8; n <= 10 && n <= chars.length; n++) {
    const tail = chars.slice(chars.length - n).join('')
    if (similarity(tail, 'Completed') >= 0.75) return true
  }
  return false
}

/** The re-rolls left on an instrument pick: the N of "Remaining attempts N".
 * OCR can glue the count to the word and read its 1 as an l
 * ("Remaining attemptsl"). The game shows the text only with re-rolls left,
 * so a text whose count does not read gives 1; no text gives 0. */
export function rerolls(lines: Line[]): number {
  for (const l of lines) {
    const text = [...l.text].filter((c) => !/\s/.test(c)).join('')
    const words = text.replace(/[0-9OoIl|i]+$/, '')
    if (similarity(words, 'Remaining attempts') >= 0.75) {
      const n = number(text.slice(words.length))
      if (n === null || n <= 0) return 1
      return Math.min(n, 255)
    }
  }
  return 0
}

/** One destination card's text: "Go to Cell N" or "Go to Interrogation Room". */
export function door(text: string): number | null {
  const s = squash(text)
  if (s.includes('room') || similarity(text, 'Go to Interrogation Room') >= 0.6) return 1
  let tail: string
  const at = s.lastIndexOf('cell')
  if (at >= 0) {
    // OCR reads the digits 1 and 0 as I, l and O ("Go to Cell IL").
    tail = [...s.slice(at + 4)]
      .map((c) => (c === 'i' || c === 'l' ? '1' : c === 'o' ? '0' : c))
      .join('')
  } else {
    const digits = [...s].reverse()
    let n = 0
    while (n < digits.length && /[0-9]/.test(digits[n])) n += 1
    tail = digits
      .slice(0, n)
      .reverse()
      .join('')
  }
  if (!/^\d+$/.test(tail)) return null
  const v = Number(tail)
  return v >= 2 && v <= 16 ? v : null
}

/** The text of the lines, joined with a space. */
function joined(lines: Line[]): string {
  return lines.map((l) => l.text).join(' ')
}

/** The cards sit in a centred row, as many as today's doors (two with Burning
 * Stake): lines whose centres are within half a card pitch are one card. OCR
 * can drop "Go" or put junk before it and garble "Cell" ("eGo to Cell 11",
 * "to celgl"), so "to" and "cel" also mark card text. A card whose text
 * doesn't parse goes to `reread` with its centre. Each card comes with the
 * centre of its first line. */
export async function doors(lines: Line[], reread: (x: number) => Promise<number | null>): Promise<[number | null, number][]> {
  const sorted = lines
    .filter((l) => {
      const s = squash(l.text)
      // A bare number is no card: the labels of the board's cells, the numbers on the End panel and the
      // art all read as digits, and a card says "Go to Cell N" (OCR may garble the words, not drop them all).
      // A line with none of those words needs three letters ("ot 4" off the End panel's art is no card).
      const letters = s.replace(/[0-9]/g, '').length
      return s.startsWith('go') || s.startsWith('to') || s.includes('cel') || (door(l.text) !== null && letters >= 3)
    })
    .sort((a, b) => a.rect.centre()[0] - b.rect.centre()[0])
  const cards: Line[][] = []
  for (const l of sorted) {
    const last = cards[cards.length - 1]
    if (last !== undefined && l.rect.centre()[0] - last[0].rect.centre()[0] < CARD_PITCH / 2) last.push(l)
    else cards.push([l])
  }
  const out: [number | null, number][] = []
  for (const card of cards) {
    card.sort((a, b) => a.rect.y - b.rect.y)
    const x = card[0].rect.centre()[0]
    let read = door(joined(card))
    if (read === null) read = await reread(x)
    out.push([read, x])
  }
  return out
}

/** The card centred near `x` read alone at larger scales: the card under the
 * mouse is raised and dimmed, and its "Cell 11" reads as "celV1" or "celgl"
 * at the row's 1.5x but as "Cell 11" at 2.5x or 3x. */
async function reread(img: Rgba, x: number): Promise<number | null> {
  const rect = new Rect(x - Math.trunc(CARD_PITCH / 2), 840, CARD_PITCH - 15, 80)
  for (const scale of [2.5, 3.0]) {
    const read = door(joined(await ocr(img, rect, scale)))
    if (read !== null) return read
  }
  return null
}

/** The Interrogation Room's cards: both titles, Instigate left of Bestow,
 * as the centre x of the two titles. */
export function interrogation(lines: Line[]): [number, number] | null {
  const at = (name: string): number | null => {
    const found = lines.find((l) => similarity(l.text, name) >= 0.75)
    return found === undefined ? null : found.rect.centre()[0]
  }
  const a = at('Instigate')
  const b = at('Bestow')
  if (a === null || b === null || a >= b) return null
  return [a, b]
}

/** The least y of a decision button's name: the names sit at y 880 and the
 * door labels at 860, while the cards' art and the buttons' icons (y 810)
 * read as short junk above them, and "e n-.z" matches "End" at 0.67. */
const BUTTON_NAME_Y = 850

/** The decision buttons left to right, each with its name's centre. */
export function buttons(lines: Line[]): [string, [number, number]][] {
  const found: [string, [number, number]][] = []
  const names = ['Consume', 'Replace', 'Hunt', 'End']
  for (const l of lines) {
    if (l.rect.centre()[1] < BUTTON_NAME_Y) continue
    const m = bestMatch(l.text, names, 0.65)
    if (m === null) continue
    const name = names[m[0]]
    if (!found.some((x) => x[0] === name)) found.push([name, l.rect.centre()])
  }
  found.sort((a, b) => a[1][0] - b[1][0])
  return found
}

/** Card names on a pick screen: lines that match a name, left to right,
 * each with the centre x of its line. */
export function offers(lines: Line[], names: string[]): [number, number][] {
  const found: [number, number][] = []
  for (const l of lines) {
    const m = bestMatch(l.text, names, 0.75)
    if (m === null) continue
    if (found.some((x) => x[0] === m[0])) continue
    found.push([m[0], l.rect.centre()[0]])
  }
  found.sort((a, b) => a[1] - b[1])
  return found
}

/** The mean luma over a box and its spread. */
export function lumaStats(img: Rgba, at: [number, number], half: number): [number, number] {
  const v: number[] = []
  for (let y = at[1] - half; y < at[1] + half; y++) {
    for (let x = at[0] - half; x < at[0] + half; x++) {
      const [r, g, b] = img.rgb(x, y)
      v.push(f(f(0.299 * r) + f(f(0.587 * g) + f(0.114 * b))))
    }
  }
  const mean = ((): number => {
    let s = 0
    for (const x of v) s = f(s + x)
    return f(s / v.length)
  })()
  let acc = 0
  for (const x of v) acc = f(acc + f(f(x - mean) * f(x - mean)))
  return [mean, f(Math.sqrt(f(acc / v.length)))]
}

/** Mean luma over each Chromatic Prisoner slot, in fill order. */
export function slotScores(img: Rgba): number[] {
  const out: number[] = []
  for (const y of SLOT_Y) {
    for (const x of SLOT_X) out.push(lumaStats(img, [x, y], 22)[0])
  }
  return out
}

/** Luma spread over the first instrument icon spot. */
export function iconScore(img: Rgba): number {
  return lumaStats(img, ICON, 22)[1]
}

/** The panels of a frame whose two layouts are the same, as at interface
 * scale 1 (the tests' saved frames); see [`readPanelsTitled`]. */
export function readPanels(img: Rgba): Promise<Panels> {
  return readPanelsTitled(img, img)
}

/** The panels of `img`, a frame in the board layout, with [`TITLE`],
 * [`INCIDENT`], [`RIOT`] and [`REROLLS`] read from `title`, the same frame in the title layout (see
 * [`../layout::layOutScaled`]). */
export async function readPanelsTitled(img: Rgba, title: Rgba): Promise<Panels> {
  const d = data()
  // Every fixed region is read at once, whether the screen needs it or not.
  const REGIONS = regions()
  const imgs = REGIONS.map((_, i) => (i === 1 || i === 8 || i === 12 ? title : img))
  const [
    daysLines,
    titleLines,
    heading,
    cards,
    target,
    cancel,
    banner,
    dialog,
    incident,
    themeLines,
    objectiveLines,
    status,
    riot,
    nameLines,
  ] = await ocrAll(imgs, REGIONS)
  const p: Panels = {
    screen: 'unknown',
    days: await daysRead(img, daysLines),
    doors: [],
    decision: [],
    instruments: [],
    rerolls: 0,
    vault: [],
    toolIcons: iconScore(img) >= ICON_SPREAD,
    theme: null,
    objective: null,
    held: null,
    spots: [],
  }
  const themeId = theme(themeLines)
  if (has(titleLines, 'Select a Torture Instrument', 0.75)) {
    p.screen = 'instrumentPick'
    const names = d.toolIds.map((_, i) => d.toolNames[i])
    for (const [i, x] of offers(nameLines, names)) {
      const tool = d.toolIds[i]
      p.instruments.push(tool)
      p.spots.push([{ kind: 'card', card: tool }, 'board', [x, PICK_Y]])
    }
    // Read on this screen alone, so no other screen pays for the region.
    p.rerolls = rerolls(await ocr(title, rerollsRegion()[0], rerollsRegion()[1]))
    if (p.rerolls > 0) p.spots.push([{ kind: 'button', button: 'Re-roll' }, 'title', REROLL_AT])
  } else if (has(titleLines, "Warden's Treasure", 0.75) || titleLines.some((l) => squash(l.text).includes('treasure'))) {
    p.screen = 'treasurePick'
    // The four cards' middles line up with the instrument cards' (rec1-t085).
    for (const [i, x] of offers(nameLines, d.giftNames)) {
      p.spots.push([{ kind: 'card', card: GIFT_KEYS[i] }, 'board', [x, PICK_Y]])
    }
  } else if (has(status, 'Return to Selection', 0.75)) {
    p.screen = 'prisonStatus'
  } else if (has(target, 'Select an Inmate to Consume', 0.75) || has(cancel, 'Cancel', 0.8)) {
    p.screen = 'chainTarget'
    p.decision = ['Cancel']
    p.spots.push([{ kind: 'button', button: 'Cancel' }, 'board', CANCEL_AT])
  } else if (themeId !== null) {
    p.screen = 'theme'
    p.theme = themeId
  } else if (popup(dialog, incident)) {
    p.screen = 'popup'
  } else {
    const found = buttons(cards)
    p.decision = found.map((b) => b[0])
    // The decision buttons share the doors' row: with buttons on screen there are no door cards.
    let readDoors = found.length === 0 ? await doors(cards, (x) => reread(img, x)) : []
    const read = (d2: [number | null, number][]): number => d2.filter((c) => c[0] !== null).length
    if (found.length === 0) {
      // The row read as a whole can drown the labels in the cards' art (closed doors, with tesseract): their
      // strip alone, at the larger scale the rereads use, reads "Go to Cell 12".
      const LABELS = new Rect(360, 840, 1160, 80)
      const strip = await doors(await ocr(img, LABELS, 2.5), (x) => reread(img, x))
      if (read(strip) > read(readDoors)) readDoors = strip
    }
    if (found.length === 0 && read(readDoors) < 2) {
      // An End button alone (nothing left to Consume, Replace or Hunt) sits in the middle of the row over its
      // medallion, where the row read as a whole loses its name; the name alone, enlarged, reads.
      const lone = buttons(await ocr(img, endAlone(), 3.0)).filter((b) => b[0] === 'End')
      if (lone.length > 0) {
        found.push(...lone)
        p.decision = ['End']
        readDoors = []
      }
    }
    if (has(heading, 'Select an Objective', 0.75)) {
      // Without brackets or a target glow nothing is picked: the board
      // shows between the pick and the next screen.
      if (pickShown(img)) p.screen = 'cellPick'
    } else {
      const cards2 = interrogation(cards)
      if (cards2 !== null) {
        // Its heading is "Make Your Decision", as on the manage step.
        p.screen = 'interrogation'
        p.decision = []
        for (const [key, x] of [
          ['instigate', cards2[0]] as const,
          ['bestow', cards2[1]] as const,
        ]) {
          p.spots.push([{ kind: 'card', card: key }, 'board', [x, DOOR_Y]])
        }
      } else if (has(heading, 'Select a Destination', 0.75) || (readDoors.length > 0 && p.days !== null)) {
        // Door cards or decision buttons alone need the days counter:
        // text on the lobby's objective dialog or any other game screen
        // can read as one.
        p.screen = 'patrol'
        p.doors = readDoors.map((d2) => d2[0])
        p.spots = readDoors
          .filter((d2): d2 is [number, number] => d2[0] !== null)
          .map((d2): [Spot, Layout, [number, number]] => [{ kind: 'door', door: d2[0] }, 'board', [d2[1], DOOR_Y]])
        p.decision = []
      } else if (has(heading, 'Make Your Decision', 0.75) || (p.decision.length > 0 && p.days !== null)) {
        p.screen = 'manage'
        p.spots = found.map(
          ([name, at]): [Spot, Layout, [number, number]] => [
            { kind: 'button', button: name },
            'board',
            [at[0], at[1] - BUTTON_ABOVE],
          ]
        )
      } else if (banner.some((l) => squash(l.text).startsWith('day'))) {
        p.screen = 'dayBanner'
      } else if (has(riot, 'A Riot has broken out in Tartarus', 0.75)) {
        p.screen = 'runEnd'
      }
    }
  }
  // The Consume target pick covers the panel.
  if (p.screen === 'patrol' || p.screen === 'manage' || p.screen === 'cellPick' || p.screen === 'interrogation') {
    p.held = readHeld(img)
  }
  const pickOrEnd = p.screen === 'instrumentPick' || p.screen === 'treasurePick' || p.screen === 'runEnd'
  if (!pickOrEnd && p.screen !== 'theme') p.objective = objective(objectiveLines)
  // The riot screen shows no Chromatic Prisoner slots.
  if (!pickOrEnd) {
    const scores = slotScores(img)
    for (let k = 0; k < scores.length; k++) {
      if (scores[k] < SLOT_FILLED) break
      const x = SLOT_X[k % 2]
      const y = SLOT_Y[Math.trunc(k / 2)]
      const [beast, conf] = beastAt(img, [x, y])
      p.vault.push({ beast, conf })
    }
  }
  return p
}
