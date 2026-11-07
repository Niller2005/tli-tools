import { describe, expect, test } from 'bun:test'
import { Tracker, parseLine, REWARD_WINDOW_MS } from '../src/index'
import { GOLD_UUID, add, chestMove, game, level, ms, pick, proto, sound, trapMove, update } from './helpers'

const OPEN = 'S9Taro Run'
const HIDE = 'S9Taro Hide'
const PROMPT = 'Start Fateful Contest with collected Chests of Destiny?\\n'
const CHEST_OPEN = 'Play_Obj_S9_SMTL_BaoXiang_Open_01'

describe('parseLine on odd lines', () => {
  test('a line cut off inside a name or a number reads as nothing', () => {
    expect(parseLine(game('01.00.00:000', 'S9Taro HandleOrderAni Start Step='))).toBeNull()
    expect(parseLine(game('01.00.00:000', 'S9Taro HandleOrderAni Start Step=1 Type='))).toBeNull()
    expect(parseLine(game('01.00.00:000', '71369_S9Reward Anim_'))).toBeNull()
    expect(parseLine(game('01.00.00:000', '_S9Reward Anim_Zi Start'))).toBeNull()
    expect(parseLine(game('01.00.00:000', '71380_S9Tile Anim_ShowL'))).toBeNull()
    expect(parseLine('[2026.10.30-01.32')).toBeNull()
  })

  test('a rarity the game was never seen to use is a chest of unknown rarity', () => {
    expect(parseLine(game('01.00.00:000', '71369_S9Reward Anim_Purple Start'))).toMatchObject({ t: 'chest', rarity: null })
    expect(parseLine(game('01.00.00:000', '71369_S9TileIcon Anim_Purple_Show01 Start'))).toMatchObject({ t: 'icon', rarity: null })
  })

  test('every rarity the game names is read, on both icon variants', () => {
    for (const rarity of ['Bai', 'Green', 'Blue', 'Zi', 'Jin', 'Hong', 'Cai']) {
      expect(parseLine(game('01.00.00:000', `1_S9Reward Anim_${rarity} Start`))).toMatchObject({ t: 'chest', rarity })
      expect(parseLine(game('01.00.00:000', `1_S9TileIcon Anim_${rarity}_Show01 Start`))).toMatchObject({ t: 'icon', rarity })
    }
  })

  test('animations and cell or hand names the parser does not know are ignored', () => {
    expect(parseLine(game('01.00.00:000', '71380_S9Tile Anim_Kouxue Start'))).toBeNull()
    expect(parseLine(game('01.00.00:000', '71390_S9HandCard Anim_Unknown Start'))).toBeNull()
    expect(parseLine(game('01.00.00:000', '71401_S9LineShort Anim_Other Start'))).toBeNull()
  })

  test('the board and the challenge page are told apart', () => {
    expect(parseLine(game('01.00.00:000', 'S9Challenge Hide'))).toMatchObject({ t: 'challenge', open: false })
    expect(parseLine(game('01.00.00:000', 'S9Challenge Destory'))).toMatchObject({ t: 'challenge', open: false })
    expect(parseLine(game('01.00.00:000', 'S9Taro Running'))).toBeNull()
  })

  test('only the sounds of the season are sounds', () => {
    expect(parseLine(sound('01.00.00:000', 'Play_Obj_Other_Thing'))).toBeNull()
    expect(parseLine(sound('01.00.00:000', 'Play_UI_S9_SMTL_Card_Box_Get'))).toMatchObject({ t: 'sound', name: 'Card_Box_Get' })
  })
})

describe('a visit', () => {
  test('with no moves has nothing in it and still closes', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', OPEN), game('01.00.30:000', HIDE)])
    expect(t.state.sessions).toEqual([
      {
        id: 1,
        openedAt: ms('01.00.00:000'),
        closedAt: ms('01.00.30:000'),
        cells: 0,
        moves: [],
        chests: [],
        chestsSkipped: 0,
        notes: 0,
        played: 0,
        lifeLost: 0,
        lifeWon: 0,
      },
    ])
  })

  test('with moves but no chest taken keeps no chests', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', OPEN), ...trapMove(), game('01.40.00:000', HIDE)])
    const s = t.state.sessions[0]
    expect(s.moves).toHaveLength(1)
    expect(s.chests).toEqual([])
    expect(s.chestsSkipped).toBe(0)
  })

  test('closing the board flushes the move that was under way', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=MoveTo'),
      game('01.00.01:100', '1_S9LineShort Anim_Light Start'),
      game('01.00.02:000', HIDE),
    ])
    const s = t.state.sessions[0]
    expect(s.moves).toHaveLength(1)
    expect(s.moves[0].cells).toBe(1)
    expect(s.cells).toBe(1)
    expect(s.closedAt).toBe(ms('01.00.02:000'))
  })

  test('closing a board that was never opened makes no session', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', HIDE), game('01.00.01:000', 'S9Taro Destory')])
    expect(t.state.sessions).toEqual([])
    expect(t.current).toBeNull()
  })

  test('closing twice keeps the first closing time', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', OPEN), game('01.00.10:000', HIDE), game('01.00.20:000', 'S9Taro Destory')])
    expect(t.state.sessions[0].closedAt).toBe(ms('01.00.10:000'))
  })

  test('pieces of a move that arrive without its first step are dropped', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', '1_S9LineShort Anim_Light Start'),
      game('01.00.01:100', '71380_S9Tile Anim_ShowL Start'),
      game('01.00.01:200', '71383_S9TileIcon Anim_Blue_Show02 Start'),
      game('01.00.01:300', '71366_S9Reward Anim_Blue Start'),
      game('01.00.01:400', '71366_S9Reward Anim_Taro_RewardUpgrade Start'),
      game('01.00.01:500', 'MsgMgr@:Show MsgValue = Life -1'),
      game('01.00.01:900', 'S9Taro HandleOrderAni All done'),
    ])
    const s = t.current
    expect(s?.moves).toEqual([])
    expect(s?.chests).toEqual([])
    expect(s?.cells).toBe(0)
    // the life message still counts: it is the session's, not the move's
    expect(s?.lifeLost).toBe(1)
  })

  test('a move that ends twice is kept once', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', OPEN), ...chestMove(), game('01.32.37:000', 'S9Taro HandleOrderAni All done')])
    expect(t.current?.moves).toHaveLength(1)
  })

  test('a step with no visit open starts nothing that a later visit inherits', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', 'S9Taro HandleOrderAni Start Step=1 Type=CardDraw'), game('01.00.00:100', OPEN), game('01.00.00:200', 'S9Taro HandleOrderAni All done')])
    expect(t.current?.moves).toEqual([])
  })

  test('a raise of a chest that was never taken is told in the move and changes no chest', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=RewardRarityUp'),
      game('01.00.01:100', '999_S9Reward Anim_Taro_RewardUpgrade Start'),
      game('01.00.01:200', 'S9Taro HandleOrderAni All done'),
    ])
    expect(t.current?.moves[0].upgraded).toEqual([999])
    expect(t.current?.chests).toEqual([])
  })

  test('a chest raised twice counts both raises', () => {
    const t = new Tracker()
    const raise = (time: string): string[] => [
      game(time, 'S9Taro HandleOrderAni Start Step=1 Type=RewardRarityUp'),
      game(time, '71366_S9Reward Anim_Taro_RewardUpgrade Start'),
      game(time, 'S9Taro HandleOrderAni All done'),
    ]
    t.feed([game('01.00.00:000', OPEN), ...chestMove(), ...raise('01.40.00:000'), ...raise('01.41.00:000')])
    expect(t.current?.chests[0].upgrades).toBe(2)
  })

  test('life won marks the cell an event and counts as won, not lost', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=MoveTo'),
      game('01.00.01:100', '5_S9TileIcon Anim_Show02 Start'),
      game('01.00.01:200', 'MsgMgr@:Show MsgValue = Life +2'),
      game('01.00.01:900', 'S9Taro HandleOrderAni All done'),
    ])
    const s = t.current
    expect(s?.lifeWon).toBe(2)
    expect(s?.lifeLost).toBe(0)
    expect(s?.moves[0].life).toBe(2)
    expect(s?.moves[0].landed?.kind).toBe('event')
  })

  test('gaining notes marks the cell an event and a life loss outranks it', () => {
    const t = new Tracker()
    const move = (time: string, extra: string[]): string[] => [
      game(time, 'S9Taro HandleOrderAni Start Step=1 Type=MoveTo'),
      game(time, '5_S9TileIcon Anim_Blue_Show02 Start'),
      ...extra,
      game(time, 'S9Taro HandleOrderAni All done'),
    ]
    t.feed([
      game('01.00.00:000', OPEN),
      ...move('01.00.01:000', [game('01.00.01:001', '7_S9HandCard Anim_Putong_Jinpai Start')]),
      ...move('01.00.02:000', [game('01.00.02:001', '7_S9HandCard Anim_Putong_Jinpai Start'), game('01.00.02:002', 'MsgMgr@:Show MsgValue = Life -1')]),
    ])
    const [event, trap] = t.current?.moves ?? []
    expect(event.landed?.kind).toBe('event')
    expect(event.landed?.rarity).toBe('Blue')
    expect(trap.landed?.kind).toBe('trap')
    // an event on a chest icon is not a skipped chest
    expect(t.current?.chestsSkipped).toBe(0)
  })

  test('messages that are not life changes leave the life alone but stay in the move', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=MoveTo'),
      game('01.00.01:100', 'MsgMgr@:Show MsgValue = Life -x'),
      game('01.00.01:200', 'MsgMgr@:Show MsgValue = Notes +3'),
      game('01.00.01:900', 'S9Taro HandleOrderAni All done'),
    ])
    const s = t.current
    expect(s?.lifeLost).toBe(0)
    expect(s?.moves[0].life).toBe(0)
    expect(s?.moves[0].messages).toHaveLength(2)
  })

  test('a hand shuffle is marked on the move and counts no notes or plays', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=CardGroupAdd'),
      game('01.00.01:100', '7_S9HandCard Anim_Xipai Start'),
      game('01.00.01:900', 'S9Taro HandleOrderAni All done'),
    ])
    expect(t.current?.moves[0].shuffled).toBe(true)
    expect(t.current?.notes).toBe(0)
    expect(t.current?.played).toBe(0)
  })

  test('cards gained between moves count as notes of the visit', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', OPEN), game('01.00.01:000', '7_S9HandCard Anim_Putong_Jinpai Start')])
    expect(t.current?.notes).toBe(1)
    expect(t.current?.moves).toEqual([])
  })

  test('the same cell shown twice in a move counts once; its last side wins', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=MoveTo'),
      game('01.00.01:100', '1_S9Tile Anim_ShowL Start'),
      game('01.00.01:200', '1_S9Tile Anim_ShowR Start'),
      game('01.00.01:300', '2_S9Tile Anim_ShowL Start'),
      game('01.00.01:400', '3_S9Tile Anim_Chuxian Start'),
      game('01.00.01:500', '9_S9LineShort Anim_Light Start'),
      game('01.00.01:600', '9_S9LineShort Anim_Light Start'),
      game('01.00.01:900', 'S9Taro HandleOrderAni All done'),
    ])
    const m = t.current?.moves[0]
    expect(m?.left).toBe(1)
    expect(m?.right).toBe(1)
    expect(m?.cells).toBe(1)
  })

  test('the last icon of a move is where it landed', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=MoveTo'),
      game('01.00.01:100', '1_S9TileIcon Anim_Blue_Show01 Start'),
      game('01.00.01:200', '2_S9TileIcon Anim_Show02 Start'),
      game('01.00.01:900', 'S9Taro HandleOrderAni All done'),
    ])
    expect(t.current?.moves[0].landed).toEqual({ id: 2, kind: 'plain', rarity: null })
  })

  test('a move with no icon landed nowhere and skips no chest', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', OPEN), game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=CardDraw'), game('01.00.01:900', 'S9Taro HandleOrderAni All done')])
    expect(t.current?.moves[0].landed).toBeNull()
    expect(t.current?.chestsSkipped).toBe(0)
  })

  test('session ids keep counting across closed visits', () => {
    const t = new Tracker()
    t.feed([game('01.00.00:000', OPEN), game('01.00.10:000', HIDE), game('01.01.00:000', OPEN), game('01.01.10:000', HIDE), game('01.02.00:000', OPEN)])
    expect(t.state.sessions.map((s) => s.id)).toEqual([1, 2, 3])
    expect(t.state.nextId).toBe(4)
    expect(t.current?.id).toBe(3)
  })

  test('a log restart mid-move keeps the move and closes the visit at the last line', () => {
    const t = new Tracker()
    t.feed([
      game('01.00.00:000', OPEN),
      game('01.00.01:000', 'S9Taro HandleOrderAni Start Step=1 Type=MoveTo'),
      game('01.00.01:100', '1_S9LineShort Anim_Light Start'),
    ])
    t.logRestarted()
    const s = t.state.sessions[0]
    expect(s.closedAt).toBe(ms('01.00.01:100'))
    expect(s.moves).toHaveLength(1)
  })
})

describe('trials on odd input', () => {
  const turn = (time: string): string => sound(time, 'Play_Obj_S9_SMTL_KaPai_Turn_Slow')
  const story = (time: string, name: string): string => sound(time, `Play_VO_Story_S9_3_11_${name}`)

  test('a story with no card before it is a trial of its own', () => {
    const t = new Tracker()
    t.feed([story('01.00.00:000', 'TheSun')])
    expect(t.state.trials).toEqual([{ at: ms('01.00.00:000'), arcana: 'TheSun' }])
  })

  test('a story five seconds or more after the card does not name it', () => {
    const t = new Tracker()
    t.feed([turn('01.00.00:000'), story('01.00.05:000', 'TheSun')])
    expect(t.state.trials).toEqual([
      { at: ms('01.00.00:000'), arcana: '' },
      { at: ms('01.00.05:000'), arcana: 'TheSun' },
    ])
  })

  test('a story just under five seconds after the card names it', () => {
    const t = new Tracker()
    t.feed([turn('01.00.00:000'), story('01.00.04:999', 'TheSun')])
    expect(t.state.trials).toEqual([{ at: ms('01.00.00:000'), arcana: 'TheSun' }])
  })

  test('a named trial is not named again by a second story', () => {
    const t = new Tracker()
    t.feed([turn('01.00.00:000'), story('01.00.01:000', 'TheSun'), story('01.00.02:000', 'TheHermit')])
    expect(t.state.trials.map((x) => x.arcana)).toEqual(['TheSun', 'TheHermit'])
  })

  test('two cards turned in a row leave the first unnamed', () => {
    const t = new Tracker()
    t.feed([turn('01.00.00:000'), turn('01.00.01:000'), story('01.00.02:000', 'TheSun')])
    expect(t.state.trials.map((x) => x.arcana)).toEqual(['', 'TheSun'])
  })
})

describe('the Fateful Contest on odd input', () => {
  const FE = '00000000-0000-0000-0000-000000000001'
  const prepared = (): Tracker => {
    const t = new Tracker()
    t.feed([
      update('01.00.00:000', 100300, FE, 5, 0),
      add('01.00.00:001', 100200, GOLD_UUID, 1, 102, 10),
      game('01.35.07:875', PROMPT),
      level('01.35.10:000', 19),
    ])
    return t
  }

  test('a contest that closes without its chest giving anything keeps the chest, empty', () => {
    const t = prepared()
    t.feed([sound('01.35.25:000', CHEST_OPEN), level('01.40.00:000', 3)])
    const c = t.state.contests[0]
    expect(c.chests).toEqual([{ at: ms('01.35.25:000'), rewards: [] }])
    expect(c.closedAt).toBe(ms('01.40.00:000'))
    expect(t.currentContest).toBeNull()
  })

  test('a contest closed with no chest opened has no chests', () => {
    const t = prepared()
    t.feed([level('01.40.00:000', 3)])
    expect(t.state.contests[0].chests).toEqual([])
    expect(t.state.contests[0].closedAt).toBe(ms('01.40.00:000'))
  })

  test('a prompt that is answered no leaves a contest that never opened', () => {
    const t = new Tracker()
    t.feed([game('01.35.07:875', PROMPT)])
    const c = t.state.contests[0]
    expect(c.askedAt).toBe(ms('01.35.07:875'))
    expect(c.openedAt).toBeNull()
    expect(c.closedAt).toBeNull()
    // a level that is not the contest's, with no fight begun, closes nothing
    t.feed([level('01.36.00:000', 3)])
    expect(t.currentContest).toBe(c)
    expect(c.closedAt).toBeNull()
  })

  test('a second prompt while one is open makes no second contest', () => {
    const t = new Tracker()
    t.feed([game('01.35.07:875', PROMPT), game('01.35.08:875', PROMPT)])
    expect(t.state.contests).toHaveLength(1)
  })

  test('the page opening with no prompt makes a contest with no asking time', () => {
    const t = new Tracker()
    t.feed([game('01.35.09:124', 'S9Challenge Run')])
    expect(t.state.contests[0]).toMatchObject({ askedAt: null, openedAt: ms('01.35.09:124') })
  })

  test('the level keeps the page\'s opening time when the page came first', () => {
    const t = new Tracker()
    t.feed([game('01.35.07:875', PROMPT), game('01.35.09:124', 'S9Challenge Run'), level('01.35.10:000', 19)])
    expect(t.state.contests[0].openedAt).toBe(ms('01.35.09:124'))
    expect(t.state.contests).toHaveLength(1)
  })

  test('the contest level alone makes a contest', () => {
    const t = new Tracker()
    t.feed([level('01.35.10:000', 19)])
    expect(t.state.contests[0]).toMatchObject({ askedAt: null, openedAt: ms('01.35.10:000'), closedAt: null })
  })

  test('a reward exactly at the window\'s edge counts; one millisecond later does not', () => {
    const t = prepared()
    const opened = ms('01.35.25:000')
    t.feed([sound('01.35.25:000', CHEST_OPEN), ...pick('01.35.55:000', 100200, GOLD_UUID, 11, 1)])
    expect(ms('01.35.55:000') - opened).toBe(REWARD_WINDOW_MS)
    expect(t.state.contests[0].chests[0].rewards).toEqual([{ item: 100200, qty: 1 }])
    t.feed(pick('01.35.55:001', 100200, GOLD_UUID, 12, 1))
    expect(t.state.contests[0].chests[0].rewards).toHaveLength(1)
  })

  test('a stack that shrinks while a chest is open is not a reward', () => {
    const t = prepared()
    t.feed([sound('01.35.25:000', CHEST_OPEN), ...pick('01.35.26:000', 100200, GOLD_UUID, 4, 1)])
    expect(t.state.contests[0].chests[0].rewards).toEqual([])
  })

  test('an item added outside a pick-up block is not a reward', () => {
    const t = prepared()
    t.feed([sound('01.35.25:000', CHEST_OPEN), add('01.35.26:000', 3902, 'b01ee6a0-d402-11f1-9c35-000000000079', 38)])
    expect(t.state.contests[0].chests[0].rewards).toEqual([])
  })

  test('the pick-up block ending ends what counts as a reward', () => {
    const t = prepared()
    t.feed([
      sound('01.35.25:000', CHEST_OPEN),
      proto('01.35.26:000', 'PickItem', true),
      proto('01.35.26:001', 'PickItem', false),
      update('01.35.26:002', 100200, GOLD_UUID, 99, 1),
    ])
    expect(t.state.contests[0].chests[0].rewards).toEqual([])
  })

  test('a log restart drops the open block: items after it are not rewards', () => {
    const t = prepared()
    t.feed([sound('01.35.25:000', CHEST_OPEN), proto('01.35.26:000', 'PickItem', true)])
    t.logRestarted()
    expect(t.state.contests[0].closedAt).toBe(ms('01.35.26:000'))
    t.feed([update('01.35.27:000', 100200, GOLD_UUID, 99, 1)])
    expect(t.state.contests[0].chests[0].rewards).toEqual([])
  })

  test('chests opened in different contests stay with their contests', () => {
    const t = prepared()
    t.feed([sound('01.35.25:000', CHEST_OPEN), level('01.40.00:000', 3), game('02.00.00:000', PROMPT), level('02.00.05:000', 19), sound('02.00.10:000', CHEST_OPEN)])
    expect(t.state.contests.map((c) => c.chests.length)).toEqual([1, 1])
  })
})
