// The game's log, line by line: what each line says about the level the player is in, about the
// items in the bag, and about the protocol blocks the game wraps its item changes in.
//
// The lines all look like this:
//
//   [2026.10.29-21.28.06:033][676]TLLua: Display: [Game] LevelMgr@ LevelUid, LevelType, LevelId = 1071008 3 4708
//   [2026.10.29-21.28.06:034][676]TLLua: Display: [Game] PageApplyBase@ EnterScene ScenePath = World'/Game/Art/Maps/01SD/SD_GeBuLinShanZhai/...'
//   [2026.10.29-21.28.21:751][925]TLLua: Display: [Game] ItemChange@ Update Id=5140_4a4fdeb8-... BagNum=26 in PageId=102 SlotId=23
//   [2026.10.29-21.28.21:751][925]TLLua: Display: [Game] BagMgr@:Modfy BagItem PageId = 102 SlotId = 23 ConfigBaseId = 5140 Num = 26
//
// and the pages of the game open and close like this:
//
//   [2026.10.31-02.57.37:312][681]TLLua: Display: [Game] S16BoardMain Run
//   [2026.10.31-03.10.06:232][500]TLLua: Display: [Game] S16BoardMain Destory
//
// A line's time is in its bracket at the front. Everything after "Display: [Game]" is the game's own
// words; the rest is the engine's.

/** The time at the start of a log line, "[2026.10.17-14.24.11:563]", in ms since the epoch; null if it has none. */
export function logTime(line: string): number | null {
  const m = /^\[(\d{4})\.(\d\d)\.(\d\d)-(\d\d)\.(\d\d)\.(\d\d):(\d{3})\]/.exec(line)
  return m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6], +m[7]) : null
}

/** One thing the log said. */
export type Fact =
  /** the level the player is in: its uid, its type (3 is a map) and its id */
  | { t: 'level'; uid: number; ltype: number; lid: number; at: number }
  /** the map's path, from the level manager or from the scene that was entered */
  | { t: 'path'; path: string; at: number }
  /** an item in a slot of a bag page: its config id, how many, and the instance it belongs to */
  | {
      t: 'bagSet'
      page: number
      slot: number
      item: number
      num: number
      uuid: string | null
      /** how the slot came to hold it: a new item, a stack that changed, or the whole page */
      op: 'add' | 'update' | 'init'
      at: number
    }
  /** a slot that lost its item */
  | { t: 'bagClear'; page: number; slot: number; item: number; uuid: string | null; at: number }
  /** a whole page was emptied (the bag was sorted) */
  | { t: 'pageReset'; page: number; at: number }
  /** the start or the end of a protocol block: the item changes inside it share a cause */
  | { t: 'proto'; name: string; start: boolean; at: number }
  /** the player put something on: the base of the gear and the legendary it is, if any */
  | { t: 'equip'; base: number; legendary: number; slot: number; at: number }
  /** a page of the game opened, was hidden, or was destroyed */
  | { t: 'screen'; name: string; state: 'run' | 'hide' | 'destory'; at: number }
  /** the experience bar moved: the experience in the level, and the level (it starts again at every level) */
  | { t: 'exp'; exp: number; level: number; at: number }
  /** the character that is logged in; its id is too big for a number, so it is kept as text */
  | { t: 'player'; id: string; at: number }
  /** a modifier of the map was applied (`ok`), or the game turned it away */
  | { t: 'modifier'; id: number; ok: boolean; at: number }

const RE_LEVEL = /LevelMgr@ LevelUid, LevelType, LevelId = (\d+) (\d+) (\d+)/
const RE_LEVEL_PATH = /LevelMgr@:LevelPath, Model = \S*?\/Maps\/(\S+?)\.umap/
const RE_SCENE = /PageApplyBase@ EnterScene ScenePath = World'\/Game\/Art\/Maps\/(\S+?)'/
const RE_BAG_MODIFY = /BagMgr@:Modfy BagItem PageId = (-?\d+) SlotId = (\d+) ConfigBaseId = (\d+) Num = (\d+)/
const RE_BAG_INIT = /BagMgr@:InitBagData PageId = (-?\d+) SlotId = (\d+) ConfigBaseId = (\d+) Num = (\d+)/
const RE_BAG_REMOVE = /BagMgr@:RemoveBagItem PageId = (-?\d+) SlotId = (\d+)/
const RE_ITEM_SET = /ItemChange@ (Add|Update) Id=(\d+)_([0-9a-fA-F-]+)(?: BagNum=(\d+))? in PageId=(-?\d+) SlotId=(\d+)/
const RE_ITEM_DEL = /ItemChange@ Delete Id=(\d+)_([0-9a-fA-F-]+) in PageId=(-?\d+) SlotId=(\d+)/
const RE_ITEM_RESET = /ItemChange@ Reset PageId=(-?\d+)/
const RE_PROTO = /ItemChange@ ProtoName=(\w+) (start|end)/
const RE_EQUIP = /AttributeMgr:SetPlayerEquipment\(BaseId=(\d+), GoldId=(\d+), (\d+)\)/
const RE_SCREEN = /\] (\w+) (Run|Hide|Destory)\b/
const RE_EXP = /ExpMgr@UpdateExp Percent:(\d+) (\d+)/
const RE_PLAYER = /PlayerIdTrace@LoginDataMgr:SetPlayerId old=\d+ new=(\d+)/
const RE_MODIFIER = /UCLevelSingleton::AddMapModifier\((\d+)\) success (\d+)/

/** What a log line says; null when the line is about none of the things we follow. */
export function parseLine(line: string): Fact | null {
  const at = logTime(line)
  if (at === null) return null

  let m = RE_LEVEL.exec(line)
  if (m) return { t: 'level', uid: +m[1], ltype: +m[2], lid: +m[3], at }

  m = RE_LEVEL_PATH.exec(line)
  if (m) return { t: 'path', path: m[1], at }

  m = RE_SCENE.exec(line)
  if (m) return { t: 'path', path: m[1], at }

  m = RE_PROTO.exec(line)
  if (m) return { t: 'proto', name: m[1], start: m[2] === 'start', at }

  m = RE_EXP.exec(line)
  if (m) return { t: 'exp', exp: +m[1], level: +m[2], at }

  m = RE_MODIFIER.exec(line)
  if (m) return { t: 'modifier', id: +m[1], ok: +m[2] > 0, at }

  m = RE_PLAYER.exec(line)
  if (m && m[1] !== '0') return { t: 'player', id: m[1], at }

  m = RE_EQUIP.exec(line)
  if (m) return { t: 'equip', base: +m[1], legendary: +m[2], slot: +m[3], at }

  m = RE_ITEM_SET.exec(line)
  if (m) {
    return {
      t: 'bagSet',
      page: +m[5],
      slot: +m[6],
      item: +m[2],
      num: m[4] === undefined ? 1 : +m[4],
      uuid: m[3],
      op: m[1] === 'Add' ? 'add' : 'update',
      at,
    }
  }

  m = RE_ITEM_DEL.exec(line)
  if (m) return { t: 'bagClear', page: +m[3], slot: +m[4], item: +m[1], uuid: m[2], at }

  m = RE_BAG_MODIFY.exec(line)
  if (m) return { t: 'bagSet', page: +m[1], slot: +m[2], item: +m[3], num: +m[4], uuid: null, op: 'update', at }

  m = RE_BAG_INIT.exec(line)
  if (m) return { t: 'bagSet', page: +m[1], slot: +m[2], item: +m[3], num: +m[4], uuid: null, op: 'init', at }

  m = RE_BAG_REMOVE.exec(line)
  if (m) return { t: 'bagClear', page: +m[1], slot: +m[2], item: 0, uuid: null, at }

  m = RE_ITEM_RESET.exec(line)
  if (m) return { t: 'pageReset', page: +m[1], at }

  m = RE_SCREEN.exec(line)
  if (m) return { t: 'screen', name: m[1], state: m[2] === 'Run' ? 'run' : m[2] === 'Hide' ? 'hide' : 'destory', at }

  return null
}

/** The map's folder in a path like "01SD/SD_GeBuLinShanZhai": the part that names the zone. */
export function zoneOf(path: string): string {
  const parts = path.split('/').filter(Boolean)
  if (parts.length === 0) return path
  const last = parts[parts.length - 1] as string
  const dot = last.indexOf('.')
  return dot > 0 ? last.slice(0, dot) : last
}

const RE_DUMP_ID = /\+Id \[(\d+)_([0-9a-fA-F-]{36})\]/
const RE_DUMP_LEGENDARY = /\+UniqueItmId \[(\d+)\]/

/**
 * The scope a line of a dump is in: the part of the line before the field it names.
 *
 * The game dumps the bag as the raw lines of its protocol, each field on its own line, with the
 * nesting in the bars at the front. The fields of one item are the ones in the same scope.
 */
function dumpScope(line: string): string {
  const at = line.indexOf('+')
  return at < 0 ? '' : line.slice(0, at)
}

/** The item a line of a dump names, and the scope it was in. */
export function parseDumpItem(line: string): { scope: string; uuid: string; base: number } | null {
  const m = RE_DUMP_ID.exec(line)
  if (m === null) return null
  return { scope: dumpScope(line), uuid: m[2], base: +m[1] }
}

/** The legendary a line of a dump names, and the scope it was in. */
export function parseDumpLegendary(line: string): { scope: string; legendary: number } | null {
  const m = RE_DUMP_LEGENDARY.exec(line)
  if (m === null) return null
  return { scope: dumpScope(line), legendary: +m[1] }
}
