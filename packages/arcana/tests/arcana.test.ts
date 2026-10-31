import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, truncateSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LogReader } from '@tli/tracker'
import { Tracker, emptyHistory, load, parseLine, save, statePath, STATE_VERSION, REWARD_WINDOW_MS } from '../src/index'

/* ---------- lines, as the game writes them ---------- */

/** The time of a line: "01.32.11:444" on the day the real log was written. */
const stamp = (time: string): string => `[2026.10.30-${time}][162]`
const ms = (time: string): number => {
  const m = /^(\d\d)\.(\d\d)\.(\d\d):(\d{3})$/.exec(time)
  if (m === null) throw new Error(time)
  return Date.UTC(2026, 9, 30, +m[1], +m[2], +m[3], +m[4])
}

/** A line of the game's own words. */
const game = (time: string, text: string): string => `${stamp(time)}TLLua: Display: [Game] ${text}`

/** A sound the game asked for: the engine complains the sound is not in its table, and says its name. */
const sound = (time: string, name: string): string =>
  `${stamp(time)}LogDataTable: Warning: UDataTable::FindRow : '${name}' requested row '${name}' not in DataTable '/Game/Audio/BluePrint/CD/AudioCDTable.AudioCDTable'.`

const T = {
  open: '01.32.11:444',
  draw: '01.32.36:100',
  move: '01.32.36:300',
  end: '01.32.36:900',
  hide: '01.35.09:100',
} as const

/** One move: a card is played, the marker walks two cells and stops on a blue chest. */
function chestMove(): string[] {
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
function trapMove(): string[] {
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
const add = (time: string, item: number, uuid: string, slot: number, page = 100, num = 1): string =>
  game(time, `ItemChange@ Add Id=${item}_${uuid} BagNum=${num} in PageId=${page} SlotId=${slot}`)

/** A stack that changed. */
const update = (time: string, item: number, uuid: string, num: number, slot: number, page = 102): string =>
  game(time, `ItemChange@ Update Id=${item}_${uuid} BagNum=${num} in PageId=${page} SlotId=${slot}`)

const proto = (time: string, name: string, start: boolean): string =>
  game(time, `ItemChange@ ProtoName=${name} ${start ? 'start' : 'end'}`)

const level = (time: string, type: number): string =>
  game(time, `LevelMgr@ LevelUid, LevelType, LevelId = 3100 ${type} 203013`)

/** The pick-up of a stack that grew to `to`. */
const pick = (time: string, item: number, uuid: string, to: number, slot: number): string[] => [
  proto(time, 'PickItems', true),
  update(time, item, uuid, to, slot),
  proto(time, 'PickItems', false),
]

const FE_UUID = '00000000-0000-0000-0000-000000000001'
const GOLD_UUID = '00000000-0000-0000-0000-000000000002'

/* ---------- the parser ---------- */

describe('parseLine', () => {
  test('the board opening and closing', () => {
    expect(parseLine(game(T.open, 'S9Taro Run'))).toEqual({ t: 'board', open: true, at: ms(T.open) })
    expect(parseLine(game(T.hide, 'S9Taro Hide'))).toEqual({ t: 'board', open: false, at: ms(T.hide) })
    expect(parseLine(game(T.hide, 'S9Taro Destory'))).toEqual({ t: 'board', open: false, at: ms(T.hide) })
  })

  test('the contest prompt and its page', () => {
    const prompt = game(
      '01.35.07:875',
      '<RichText>Start Fateful Contest with collected Chests of Destiny?\\n</><RichText Id="2836">(You won\'t be able to return to the Tarot Path after entering)</>',
    )
    expect(parseLine(prompt)).toEqual({ t: 'contestPrompt', at: ms('01.35.07:875') })
    expect(parseLine(game('01.35.09:124', 'S9Challenge Run'))?.t).toBe('challenge')
  })

  test('the steps of a move', () => {
    expect(parseLine(game(T.draw, 'S9Taro HandleOrderAni Start Step=1 Type=CardDraw'))).toEqual({
      t: 'step',
      kind: 'CardDraw',
      at: ms(T.draw),
    })
    expect(parseLine(game(T.draw, 'S9Taro HandleOrderAni End Step=1 Type=CardDraw From=Callback'))?.t).toBe('stepEnd')
    expect(parseLine(game(T.draw, 'S9Taro HandleOrderAni Start Step=1 Type=Unheard'))).toBeNull()
    expect(parseLine(game(T.end, 'S9Taro HandleOrderAni All done'))?.t).toBe('moveEnd')
  })

  test('the cells, the paths, the icons and the chests', () => {
    expect(parseLine(game(T.move, '71380_S9Tile Anim_ShowL Start'))).toMatchObject({ t: 'cell', id: 71380, what: 'left' })
    expect(parseLine(game(T.move, '71382_S9Tile Anim_ShowR Start'))).toMatchObject({ t: 'cell', what: 'right' })
    expect(parseLine(game(T.move, '71380_S9Tile Anim_Xiaoshi Start'))).toMatchObject({ t: 'cell', what: 'gone' })
    expect(parseLine(game(T.move, '71401_S9LineLong Anim_Light Start'))).toMatchObject({ t: 'path', lit: true, long: true })
    expect(parseLine(game(T.move, '71401_S9LineShort Anim_D Start'))).toMatchObject({ t: 'path', lit: false, long: false })
    expect(parseLine(game(T.move, '71383_S9TileIcon Anim_Blue_Show02 Start'))).toMatchObject({ t: 'icon', rarity: 'Blue' })
    expect(parseLine(game(T.move, '71384_S9TileIcon Anim_Show02 Start'))).toMatchObject({ t: 'icon', rarity: null })
    expect(parseLine(game(T.move, '71369_S9Reward Anim_Zi Start'))).toMatchObject({ t: 'chest', id: 71369, rarity: 'Zi' })
    expect(parseLine(game(T.move, '71369_S9Reward Anim_Taro_RewardUpgrade Start'))).toMatchObject({ t: 'chestUp', id: 71369 })
  })

  test('the hand, the messages and the sounds', () => {
    expect(parseLine(game(T.move, '71390_S9HandCard Anim_Dachu Start'))).toMatchObject({ t: 'hand', what: 'played' })
    expect(parseLine(game(T.move, '71390_S9HandCard Anim_Putong_Jinpai Start'))).toMatchObject({ t: 'hand', what: 'gained' })
    expect(parseLine(game(T.move, '71390_S9HandCard Anim_Xipai Start'))).toMatchObject({ t: 'hand', what: 'shuffled' })
    expect(parseLine(game(T.move, 'MsgMgr@:Show MsgValue = Life -1'))).toMatchObject({ t: 'message', text: 'Life -1' })
    expect(parseLine(sound(T.move, 'Play_Obj_S9_SMTL_BaoXiang_Open_01'))).toMatchObject({ t: 'sound', name: 'BaoXiang_Open_01' })
    expect(parseLine(sound(T.move, 'Play_Obj_S9_SMTL_KaPai_Turn_Slow'))?.t).toBe('trial')
    expect(parseLine(sound(T.move, 'Play_VO_Story_S9_3_11_TheHangedMan'))).toMatchObject({ t: 'trialStory', arcana: 'TheHangedMan' })
  })

  test('lines about other things, and lines without a time', () => {
    expect(parseLine(game(T.open, 'PageBase@ OpenFlow0! Switch = true S16BoardMain 532639'))).toBeNull()
    expect(parseLine('S9Taro Run')).toBeNull()
    expect(parseLine('')).toBeNull()
  })
})

/* ---------- the sessions ---------- */

describe('the tracker', () => {
  test('a session: the moves, the cards, the chests and the life', () => {
    const t = new Tracker()
    t.feed([game(T.open, 'S9Taro Run'), ...chestMove(), ...trapMove(), game(T.hide, 'S9Taro Hide')])

    const { sessions } = t.state
    expect(sessions).toHaveLength(1)
    const s = sessions[0]
    expect(s.openedAt).toBe(ms(T.open))
    expect(s.closedAt).toBe(ms(T.hide))
    expect(s.moves).toHaveLength(2)
    expect(s.played).toBe(2)
    expect(s.cells).toBe(3)
    expect(s.lifeLost).toBe(1)
    expect(s.chests).toEqual([{ slot: 71366, rarity: 'Blue', at: ms(T.draw), upgrades: 0 }])

    const [chest, trap] = s.moves
    expect(chest.steps).toEqual(['CardDraw', 'MoveTo'])
    expect(chest.left).toBe(2)
    expect(chest.right).toBe(1)
    expect(chest.landed).toMatchObject({ kind: 'chest', rarity: 'Blue' })
    expect(trap.life).toBe(-1)
    expect(trap.landed).toMatchObject({ kind: 'trap' })
    expect(t.current).toBeNull()
  })

  test('notes gained, and a chest raised in rarity', () => {
    const t = new Tracker()
    t.feed([
      game(T.open, 'S9Taro Run'),
      game('01.33.16:700', 'S9Taro HandleOrderAni Start Step=1 Type=CardGroupAdd'),
      game('01.33.16:710', '71391_S9HandCard Anim_Putong_Jinpai Start'),
      game('01.33.16:720', '71392_S9HandCard Anim_Putong_Jinpai Start'),
      game('01.33.16:900', 'S9Taro HandleOrderAni All done'),
      game('01.34.17:100', 'S9Taro HandleOrderAni Start Step=2 Type=RewardRarityUp'),
      game('01.34.17:110', '71366_S9Reward Anim_Blue Start'),
      game('01.34.17:120', '71366_S9Reward Anim_Taro_RewardUpgrade Start'),
      game('01.34.17:900', 'S9Taro HandleOrderAni All done'),
    ])
    const s = t.current
    expect(s).not.toBeNull()
    expect(s?.notes).toBe(2)
    expect(s?.chests[0].upgrades).toBe(1)
    expect(s?.moves[1].upgraded).toEqual([71366])
  })

  test('the moves outside a session are not kept', () => {
    const t = new Tracker()
    t.feed(chestMove())
    expect(t.state.sessions).toHaveLength(0)
  })

  test('a cell that held a chest but gave none is a chest left behind', () => {
    const t = new Tracker()
    // the same move as chestMove(), but without the chest entering the carried bar
    t.feed([
      game(T.open, 'S9Taro Run'),
      game('01.32.36:100', 'S9Taro HandleOrderAni Start Step=1 Type=MoveTo'),
      game('01.32.36:370', '71383_S9TileIcon Anim_Blue_Show02 Start'),
      game('01.32.36:900', 'S9Taro HandleOrderAni All done'),
      game(T.hide, 'S9Taro Hide'),
    ])
    const s = t.state.sessions[0]
    expect(s.chests).toHaveLength(0)
    expect(s.chestsSkipped).toBe(1)
    expect(s.moves[0].landed).toMatchObject({ kind: 'chest', rarity: 'Blue' })
  })

  test('a second visit is its own session; a board that opens twice closes the first', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', 'S9Taro Run'), game('01.01.00:000', 'S9Taro Run'), game('01.02.00:000', 'S9Taro Destory')])
    const { sessions } = t.state
    expect(sessions.map((s) => s.id)).toEqual([1, 2])
    expect(sessions[0].closedAt).toBe(ms('01.01.00:000'))
    expect(sessions[1].closedAt).toBe(ms('01.02.00:000'))
  })

  test('trials: a card turns over and its story names the arcana', () => {
    const t = new Tracker()
    t.feed([
      sound('01.31.37:582', 'Play_Obj_S9_SMTL_KaPai_Turn_Slow'),
      sound('01.31.38:296', 'Play_VO_Story_S9_3_11_TheHangedMan'),
      sound('01.35.49:595', 'Play_VO_Story_S9_3_09_TheHermit'),
    ])
    expect(t.state.trials).toEqual([
      { at: ms('01.31.37:582'), arcana: 'TheHangedMan' },
      { at: ms('01.35.49:595'), arcana: 'TheHermit' },
    ])
  })
})

/* ---------- the Fateful Contest ---------- */

describe('the Fateful Contest', () => {
  /** A bag with 5 FE in it and a stack of gold, and a contest being fought. */
  function contest(): { t: Tracker; lines: string[] } {
    const t = new Tracker()
    const lines = [
      update('01.00.00:000', 100300, FE_UUID, 5, 0),
      add('01.00.00:001', 100200, GOLD_UUID, 1, 102, 10),
      game('01.35.07:875', 'Start Fateful Contest with collected Chests of Destiny?\\n'),
      game('01.35.09:124', 'S9Challenge Run'),
      level('01.35.10:000', 19),
    ]
    t.feed(lines)
    return { t, lines }
  }

  test('the prompt, the page and the level make one contest', () => {
    const { t } = contest()
    expect(t.state.contests).toHaveLength(1)
    const c = t.state.contests[0]
    expect(c.askedAt).toBe(ms('01.35.07:875'))
    expect(c.openedAt).toBe(ms('01.35.09:124'))
    expect(c.closedAt).toBeNull()
    expect(t.currentContest).toBe(c)
  })

  test('the closing of the challenge page does not end the fight', () => {
    const { t } = contest()
    t.feed([game('01.35.10:984', 'S9Challenge Destory')])
    expect(t.currentContest).not.toBeNull()
    expect(t.state.contests[0].closedAt).toBeNull()
  })

  test('what is picked up right after a chest opens is that chest\'s reward', () => {
    const { t } = contest()
    t.feed([
      sound('01.35.25:933', 'Play_Obj_S9_SMTL_BaoXiang_Open_01'),
      ...pick('01.35.26:100', 100200, GOLD_UUID, 16, 1),
      proto('01.35.26:200', 'PickItem', true),
      add('01.35.26:201', 3902, 'b01ee6a0-d402-11f1-9c35-000000000079', 38),
      proto('01.35.26:202', 'PickItem', false),
      sound('01.35.31:964', 'Play_Obj_S9_SMTL_BaoXiang_Open_01'),
      ...pick('01.35.32:100', 100300, FE_UUID, 8, 0),
    ])
    const [first, second] = t.state.contests[0].chests
    expect(first.rewards).toEqual([
      { item: 100200, qty: 6 },
      { item: 3902, qty: 1 },
    ])
    expect(second.rewards).toEqual([{ item: 100300, qty: 3 }])
  })

  test('items moved around in the bag are not rewards', () => {
    const { t } = contest()
    t.feed([
      sound('01.35.25:933', 'Play_Obj_S9_SMTL_BaoXiang_Open_01'),
      proto('01.35.26:000', 'ResetItemsLayout', true),
      game('01.35.26:001', 'ItemChange@ Reset PageId=100'),
      add('01.35.26:002', 3902, 'b01ee6a0-d402-11f1-9c35-000000000079', 3),
      proto('01.35.26:003', 'ResetItemsLayout', false),
    ])
    expect(t.state.contests[0].chests[0].rewards).toEqual([])
  })

  test('what is picked up long after, or after the fight, is not a reward', () => {
    const { t } = contest()
    t.feed([sound('01.35.25:933', 'Play_Obj_S9_SMTL_BaoXiang_Open_01')])
    // the window is REWARD_WINDOW_MS: 34 seconds after the chest opened is outside it
    expect(ms('01.36.00:000') - ms('01.35.25:933')).toBeGreaterThan(REWARD_WINDOW_MS)
    t.feed(pick('01.36.00:000', 100200, GOLD_UUID, 99, 1))
    expect(t.state.contests[0].chests[0].rewards).toEqual([])

    t.feed([level('01.41.55:700', 3)])
    expect(t.state.contests[0].closedAt).not.toBeNull()
    expect(t.currentContest).toBeNull()
    t.feed([sound('01.42.00:000', 'Play_Obj_S9_SMTL_BaoXiang_Open_01'), ...pick('01.42.01:000', 100200, GOLD_UUID, 120, 1)])
    expect(t.state.contests[0].chests).toHaveLength(1)
  })

  test('a log that begins again ends the visit and the contest that were open', () => {
    const t = new Tracker()
    t.feed([game(T.open, 'S9Taro Run'), ...chestMove(), game('01.35.07:875', 'Start Fateful Contest with collected Chests of Destiny?\\n'), level('01.35.10:000', 19)])
    t.logRestarted()
    expect(t.current).toBeNull()
    expect(t.currentContest).toBeNull()
    expect(t.state.sessions[0].closedAt).toBe(ms('01.35.10:000'))
    expect(t.state.contests[0].closedAt).toBe(ms('01.35.10:000'))
    // nothing is open any more, so another restart changes nothing
    t.logRestarted()
    expect(t.state.sessions).toHaveLength(1)
  })

  test('a chest that opens with no contest is not a contest\'s', () => {
    const t = new Tracker()
    t.feed([sound('01.35.25:933', 'Play_Obj_S9_SMTL_BaoXiang_Open_01')])
    expect(t.state.contests).toHaveLength(0)
  })

  test('a second contest is its own', () => {
    const { t } = contest()
    t.feed([level('01.41.55:000', 3), game('02.00.00:000', 'Start Fateful Contest with collected Chests of Destiny?\\n')])
    expect(t.state.contests).toHaveLength(2)
    expect(t.state.contests[0].closedAt).toBe(ms('01.41.55:000'))
  })

  test('the exchange teaches the prices the rewards are valued with', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', '----Socket RecvMessage STT----XchgSearchPrice----SynId = 1'),
      game('01.00.00:001', '+prices+1+currency [100300]'),
      game('01.00.00:002', '|      | +unitPrices+1 [5.0]'),
      game('01.00.00:003', '+errCode'),
      game('01.00.00:004', '+itemGoldId [3902]'),
      game('01.00.00:005', '----Socket RecvMessage End----'),
    ])
    expect(t.prices.price(3902)).toBe(5)
    expect(t.prices.price(100300)).toBe(1)
  })
})

/* ---------- saving, resuming and the log ---------- */

describe('saving and resuming', () => {
  let dir = ''
  const xdg = process.env.XDG_DATA_HOME
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arcana-test-'))
    process.env.XDG_DATA_HOME = dir
  })
  afterAll(() => {
    if (xdg === undefined) delete process.env.XDG_DATA_HOME
    else process.env.XDG_DATA_HOME = xdg
    rmSync(dir, { recursive: true, force: true })
  })

  test('the state lives under XDG_DATA_HOME/tli-arcana', () => {
    expect(statePath()).toBe(join(dir, 'tli-arcana', 'state.json'))
  })

  test('nothing saved, an unreadable file and another version all read as nothing', async () => {
    const path = join(dir, 'x', 'state.json')
    expect(await load(path)).toBeNull()
    await save({ version: STATE_VERSION, log: { file: 'a', offset: 1 }, history: emptyHistory(), snapshot: new Tracker().snapshot() }, path)
    expect(await load(path)).not.toBeNull()
    writeFileSync(path, '{not json')
    expect(await load(path)).toBeNull()
    writeFileSync(path, JSON.stringify({ version: 1, history: emptyHistory() }))
    expect(await load(path)).toBeNull()
  })

  test('a saved tracker carries on: the open session, the open contest and the bag', async () => {
    const first = new Tracker()
    first.feed([
      add('01.00.00:001', 100200, GOLD_UUID, 1, 102, 10),
      game(T.open, 'S9Taro Run'),
      ...chestMove(),
      game('01.35.07:875', 'Start Fateful Contest with collected Chests of Destiny?\\n'),
      level('01.35.10:000', 19),
      sound('01.35.25:933', 'Play_Obj_S9_SMTL_BaoXiang_Open_01'),
    ])
    const path = join(dir, 'resume', 'state.json')
    await save({ version: STATE_VERSION, log: { file: 'UE_game.log', offset: 1234 }, history: first.state, snapshot: first.snapshot() }, path)

    const saved = await load(path)
    expect(saved?.log).toEqual({ file: 'UE_game.log', offset: 1234 })
    if (saved === null) throw new Error('not saved')
    const second = new Tracker(saved.history)
    second.restore(saved.snapshot)
    expect(second.current?.id).toBe(1)
    expect(second.currentContest).not.toBeNull()

    // the stack was known before the restart, so the growth is a reward
    second.feed(pick('01.35.26:100', 100200, GOLD_UUID, 15, 1))
    expect(second.state.contests[0].chests[0].rewards).toEqual([{ item: 100200, qty: 5 }])
    second.feed([game(T.hide, 'S9Taro Hide')])
    expect(second.state.sessions[0].closedAt).toBe(ms(T.hide))
  })
})

describe('following the log', () => {
  let dir = ''
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'arcana-log-'))
  })
  afterAll(() => rmSync(dir, { recursive: true, force: true }))

  test('what is appended is read, and a truncated log is read from its start', () => {
    const file = join(dir, 'UE_game.log')
    writeFileSync(file, `${[game(T.open, 'S9Taro Run'), ...chestMove()].join('\n')}\n`)
    const reader = new LogReader(file, 0)
    const t = new Tracker()

    const first = reader.read()
    t.feed(first.lines)
    expect(t.current?.moves).toHaveLength(1)

    appendFileSync(file, `${[...trapMove(), game(T.hide, 'S9Taro Hide')].join('\n')}\n`)
    const second = reader.read()
    expect(second.restarted).toBe(false)
    t.feed(second.lines)
    expect(t.state.sessions[0].moves).toHaveLength(2)
    expect(t.current).toBeNull()

    // the game restarted: the log is shorter than it was
    truncateSync(file, 0)
    writeFileSync(file, `${game('02.00.00:000', 'S9Taro Run')}\n`)
    const third = reader.read()
    expect(third.restarted).toBe(true)
    t.feed(third.lines)
    expect(t.state.sessions).toHaveLength(2)
    expect(t.current?.openedAt).toBe(ms('02.00.00:000'))
  })

  test('a log that is not there reads as nothing', () => {
    const reader = new LogReader(join(dir, 'missing.log'), 0)
    expect(reader.read().size).toBe(0)
  })
})
