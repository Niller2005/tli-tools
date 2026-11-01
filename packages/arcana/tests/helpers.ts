// Lines of the game's log, written the way the game writes them: the shapes the parser's and the
// store's tests feed the tracker with.

/** The time of a line: "01.32.11:444" on the day the real log was written. */
export const stamp = (time: string): string => `[2026.10.30-${time}][162]`

/** A timestamp as the log's own clock counts them. */
export const ms = (time: string): number => {
  const m = /^(\d\d)\.(\d\d)\.(\d\d):(\d{3})$/.exec(time)
  if (m === null) throw new Error(time)
  return Date.UTC(2026, 9, 30, +m[1], +m[2], +m[3], +m[4])
}

/** A line of the game's own words. */
export const game = (time: string, text: string): string => `${stamp(time)}TLLua: Display: [Game] ${text}`

/** A sound the game asked for: the engine complains the sound is not in its table, and says its name. */
export const sound = (time: string, name: string): string =>
  `${stamp(time)}LogDataTable: Warning: UDataTable::FindRow : '${name}' requested row '${name}' not in DataTable '/Game/Audio/BluePrint/CD/AudioCDTable.AudioCDTable'.`

/** Times the shared moves happen at. */
export const T = {
  open: '01.32.11:444',
  draw: '01.32.36:100',
  move: '01.32.36:300',
  end: '01.32.36:900',
  hide: '01.35.09:100',
} as const

/** One move: a card is played, the marker walks two cells and stops on a blue chest. */
export function chestMove(): string[] {
  return [
    game('01.32.36:100', 'S9Taro HandleOrderAni Start Step=1 Type=CardDraw'),
    game('01.32.36:110', '71390_S9HandCard Anim_Dachu Start'),
    game('01.32.36:200', 'S9Taro HandleOrderAni End Step=1 Type=CardDraw From=Callback'),
    game('01.32.36:300', 'S9Taro HandleOrderAni Start Step=2 Type=MoveTo'),
    game('01.32.36:310', '71401_S9LineShort Anim_D Start'),
    game('01.32.36:320', '71401_S9LineShort Anim_Light Start'),
    game('01.32.36:330', '71402_S9LineLong Anim_Light Start'),
    game('01.32.36:340', '71380_S9Tile Anim_ShowL Start'),
    game('01.32.36:350', '71381_S9Tile Anim_ShowL Start'),
    game('01.32.36:360', '71382_S9Tile Anim_ShowR Start'),
    game('01.32.36:370', '71383_S9TileIcon Anim_Blue_Show02 Start'),
    game('01.32.36:380', '71366_S9Reward Anim_Blue Start'),
    game('01.32.36:800', 'S9Taro HandleOrderAni End Step=2 Type=MoveTo From=Callback'),
    game('01.32.36:900', 'S9Taro HandleOrderAni All done'),
  ]
}

/** One move that costs a life. */
export function trapMove(): string[] {
  return [
    game('01.34.19:400', 'S9Taro HandleOrderAni Start Step=1 Type=CardDraw'),
    game('01.34.19:410', '71390_S9HandCard Anim_Dachu Start'),
    game('01.34.19:500', 'S9Taro HandleOrderAni Start Step=2 Type=MoveTo'),
    game('01.34.19:510', '71401_S9LineShort Anim_Light Start'),
    game('01.34.19:520', '71384_S9TileIcon Anim_Show02 Start'),
    game('01.34.19:600', 'S9Taro HandleOrderAni Start Step=3 Type=HPTo'),
    game('01.34.19:610', '71384_S9Tile Anim_Kouxue Start'),
    game('01.34.19:620', 'MsgMgr@:Show MsgValue = Life -1'),
    game('01.34.19:900', 'S9Taro HandleOrderAni All done'),
  ]
}

/** An item that is added to the bag. */
export const add = (time: string, item: number, uuid: string, slot: number, page = 100, num = 1): string =>
  game(time, `ItemChange@ Add Id=${item}_${uuid} BagNum=${num} in PageId=${page} SlotId=${slot}`)

/** A stack that changed. */
export const update = (time: string, item: number, uuid: string, num: number, slot: number, page = 102): string =>
  game(time, `ItemChange@ Update Id=${item}_${uuid} BagNum=${num} in PageId=${page} SlotId=${slot}`)

/** A protocol block of item changes, opened or closed. */
export const proto = (time: string, name: string, start: boolean): string =>
  game(time, `ItemChange@ ProtoName=${name} ${start ? 'start' : 'end'}`)

/** The player went into a level of the given type. */
export const level = (time: string, type: number): string =>
  game(time, `LevelMgr@ LevelUid, LevelType, LevelId = 3100 ${type} 203013`)

/** The pick-up of a stack that grew to `to`. */
export const pick = (time: string, item: number, uuid: string, to: number, slot: number): string[] => [
  proto(time, 'PickItems', true),
  update(time, item, uuid, to, slot),
  proto(time, 'PickItems', false),
]

export const FE_UUID = '00000000-0000-0000-0000-000000000001'
export const GOLD_UUID = '00000000-0000-0000-0000-000000000002'
