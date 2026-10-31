// The Arcana season's log lines: what the game says about the Tarot Path, the Fateful
// Contest and the Notes of Arcana.
//
// The Arcana season (SS7) puts a board of cells in front of the player. The player walks
// along it, spending Notes of Arcana, and collects Chests of Destiny. The board is drawn by
// widgets, and the game narrates what happens through the widgets' animations and through
// the sounds it asks for:
//
//   [2026.10.30-01.32.36:379][142]TLLua: Display: [Game] 71380_S9Tile Anim_Xiaoshi Start
//   [2026.10.30-01.32.36:379][142]TLLua: Display: [Game] 71406_S9LineShort Anim_D Start
//   [2026.10.30-01.33.35:170][236]TLShipping: Display: [Game] S9Taro HandleOrderAni Start Step=3 Type=MoveTo
//
// The lines this module reads:
//
//   S9Taro Run | Hide | Destory            the board opened, was hidden, or was destroyed
//   S9Challenge Run | Hide | Destory       the Fateful Contest's page
//   S9Taro HandleOrderAni Start/End/All done   one move, and the steps it is made of
//   <id>_S9Tile Anim_Xiaoshi|Chuxian|ShowL|ShowR   the cells of the board
//   <id>_S9LineShort|S9LineLong Anim_D|Light the path between the cells
//   <id>_S9TileIcon Anim_<Rarity>_Show01|Show02   a cell's icon, and the rarity it shows
//   <id>_S9Reward Anim_<Rarity>|Taro_RewardUpgrade a chest, and its rarity
//   <id>_S9HandCard Anim_Putong_Jinpai|Dachu|Xipai the cards in hand
//   MsgMgr@:Show MsgValue = ...              the messages the game shows the player
//   Play_UI_S9_SMTL_<Sound>                  the sounds the game asks for
//
// The names are the game's own: the rarities are Chinese colours (Bai, Green, Blue, Zi,
// Jin, Hong, Cai), and the sounds say what they are in the game's words.
//
// The parser here only reads the Arcana lines. The items that a chest of destiny gives are
// read by the tracker package, which already knows the game's item changes.

import { logTime } from '@tli/tracker'

/**
 * The rarity of a chest of destiny, by the name the game gives it.
 *
 * The game names its rarities after colours, in Chinese: Bai is white, Green green, Blue
 * blue, Zi purple, Jin gold, Hong red, Cai rainbow. The wiki lists the same six tiers as
 * Green, Blue, Purple, Orange, Red and Rainbow, so the game's own names are kept here and
 * the one name that has no wiki counterpart (Bai, the plain base tier) is called White.
 */
export type Rarity = 'Bai' | 'Green' | 'Blue' | 'Zi' | 'Jin' | 'Hong' | 'Cai'

/** The rarities, weakest first. The order is the game's own. */
export const RARITIES: Rarity[] = ['Bai', 'Green', 'Blue', 'Zi', 'Jin', 'Hong', 'Cai']

/** What a rarity is called in English. */
export const RARITY_NAMES: Record<Rarity, string> = {
  Bai: 'White',
  Green: 'Green',
  Blue: 'Blue',
  Zi: 'Purple',
  Jin: 'Orange',
  Hong: 'Red',
  Cai: 'Rainbow',
}

/** The step of a move, by the name the game gives it. */
export type StepKind = 'CardDraw' | 'MoveTo' | 'CardGroupAdd' | 'RewardRarityUp' | 'HPTo'

/** What a cell of the board did. */
export type CellWhat = 'gone' | 'new' | 'left' | 'right'

/** What happened to a card in hand. */
export type HandWhat = 'gained' | 'played' | 'shuffled'

/** One thing the log said about the Arcana season. */
export type Fact =
  /** the board opened, was hidden or was destroyed */
  | { t: 'board'; open: boolean; at: number }
  /** the Fateful Contest's page opened, was hidden or was destroyed */
  | { t: 'challenge'; open: boolean; at: number }
  /** the game asked the player whether to start the Fateful Contest */
  | { t: 'contestPrompt'; at: number }
  /** a step of a move began */
  | { t: 'step'; kind: StepKind; at: number }
  /** a step of a move ended */
  | { t: 'stepEnd'; at: number }
  /** the move is over */
  | { t: 'moveEnd'; at: number }
  /** a cell of the board vanished, appeared, or was shown to the left or the right */
  | { t: 'cell'; id: number; what: CellWhat; at: number }
  /** a path between two cells was drawn, and lit */
  | { t: 'path'; id: number; lit: boolean; long: boolean; at: number }
  /** a cell showed its icon, and the rarity it shows */
  | { t: 'icon'; id: number; rarity: Rarity | null; at: number }
  /** a chest of destiny, and the rarity it is */
  | { t: 'chest'; id: number; rarity: Rarity | null; at: number }
  /** a chest of destiny's rarity was raised */
  | { t: 'chestUp'; id: number; at: number }
  /** a card came into the hand, was played, or the hand was shuffled */
  | { t: 'hand'; id: number; what: HandWhat; at: number }
  /** the game showed the player a message */
  | { t: 'message'; text: string; at: number }
  /** the game asked for a sound */
  | { t: 'sound'; name: string; at: number }
  /** a tarot card turned over in a stage: a trial showed itself */
  | { t: 'trial'; at: number }
  /** the story of a trial played: the trial was fought */
  | { t: 'trialStory'; arcana: string; at: number }

/** The board's own page, and the page of the Fateful Contest. */
const RE_BOARD = /\] S9Taro (Run|Hide|Destory)\b/
/** The Fateful Contest's page. */
const RE_CHALLENGE = /\] S9Challenge (Run|Hide|Destory)\b/
/** The question the game asks before the Fateful Contest. */
const RE_PROMPT = /Start Fateful Contest with collected Chests of Destiny/
/** A step of a move. */
const RE_STEP = /S9Taro HandleOrderAni (Start|End) Step=\d+ Type=(\w+)/
/** The move is over. */
const RE_MOVE_END = /S9Taro HandleOrderAni All done/
/** A cell of the board. */
const RE_CELL = /(\d+)_S9Tile Anim_(Xiaoshi|Chuxian|ShowL|ShowR) Start/
/** A path between two cells. */
const RE_PATH = /(\d+)_S9Line(Short|Long) Anim_(D|Light) Start/
/** A cell's icon. The name after "Anim_" is the reward tier the cell holds, if any. */
const RE_ICON = /(\d+)_S9TileIcon Anim_(?:(\w+)_)?Show0[12] Start/
/** A chest of destiny. */
const RE_CHEST = /(\d+)_S9Reward Anim_(\w+) Start/
/** A card in hand. */
const RE_HAND = /(\d+)_S9HandCard Anim_(Putong_Jinpai|Dachu|Xipai) Start/
/** A message the game showed. */
const RE_MESSAGE = /MsgMgr@:Show MsgValue = (.*)/
/** A sound the game asked for. */
const RE_SOUND = /Play_(?:UI|Obj)_S9_SMTL_(\w+)'/
/** A tarot card turning over in a stage. */
const RE_TRIAL = /Play_Obj_S9_SMTL_KaPai_Turn_Slow'/
/** The story of a trial, which names the arcana it is about. */
const RE_STORY = /Play_VO_Story_S9_3_(\d+)_(\w+)/

/** What the cell animations say. */
const CELL_WHAT: Record<string, CellWhat> = {
  Xiaoshi: 'gone',
  Chuxian: 'new',
  ShowL: 'left',
  ShowR: 'right',
}

/** What the hand animations say. */
const HAND_WHAT: Record<string, HandWhat> = {
  Putong_Jinpai: 'gained',
  Dachu: 'played',
  Xipai: 'shuffled',
}

/** The step kinds the game uses. */
const STEP_KINDS: Record<string, true> = {
  CardDraw: true,
  MoveTo: true,
  CardGroupAdd: true,
  RewardRarityUp: true,
  HPTo: true,
}

/** The rarities the game may name. */
const RARITY_SET: Record<string, true> = {
  Bai: true,
  Green: true,
  Blue: true,
  Zi: true,
  Jin: true,
  Hong: true,
  Cai: true,
}

/**
 * What a log line says about the Arcana season; null when it says nothing.
 *
 * The line's own time is used; a line without one has no time.
 */
export function parseLine(line: string): Fact | null {
  const at = logTime(line)
  if (at === null) return null

  let m = RE_BOARD.exec(line)
  if (m !== null) return { t: 'board', open: m[1] === 'Run', at }

  m = RE_CHALLENGE.exec(line)
  if (m !== null) return { t: 'challenge', open: m[1] === 'Run', at }

  if (RE_PROMPT.test(line)) return { t: 'contestPrompt', at }

  m = RE_STEP.exec(line)
  if (m !== null) {
    const kind = m[2]
    if (STEP_KINDS[kind] !== true) return null
    return m[1] === 'End' ? { t: 'stepEnd', at } : { t: 'step', kind: kind as StepKind, at }
  }

  if (RE_MOVE_END.test(line)) return { t: 'moveEnd', at }

  m = RE_CELL.exec(line)
  if (m !== null) {
    const what = CELL_WHAT[m[2]]
    if (what === undefined) return null
    return { t: 'cell', id: +m[1], what, at }
  }

  m = RE_PATH.exec(line)
  if (m !== null) return { t: 'path', id: +m[1], lit: m[3] === 'Light', long: m[2] === 'Long', at }

  m = RE_ICON.exec(line)
  if (m !== null) {
    const name = m[2]
    const rarity = name !== undefined && RARITY_SET[name] === true ? (name as Rarity) : null
    return { t: 'icon', id: +m[1], rarity, at }
  }

  m = RE_CHEST.exec(line)
  if (m !== null) {
    const name = m[2]
    if (name === 'Taro_RewardUpgrade') return { t: 'chestUp', id: +m[1], at }
    const rarity = RARITY_SET[name] === true ? (name as Rarity) : null
    return { t: 'chest', id: +m[1], rarity, at }
  }

  m = RE_HAND.exec(line)
  if (m !== null) {
    const what = HAND_WHAT[m[2]]
    if (what === undefined) return null
    return { t: 'hand', id: +m[1], what, at }
  }

  m = RE_MESSAGE.exec(line)
  if (m !== null) return { t: 'message', text: m[1], at }

  if (RE_TRIAL.test(line)) return { t: 'trial', at }

  m = RE_STORY.exec(line)
  if (m !== null) return { t: 'trialStory', arcana: m[2], at }

  m = RE_SOUND.exec(line)
  if (m !== null) return { t: 'sound', name: m[1], at }

  return null
}

export { logTime }
