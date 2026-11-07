import { describe, expect, test } from 'bun:test'
import { DEFAULT_RULES, classify, createSettler, isAnimation, logTime } from '@/reader/live/triggers'

const line = (text: string): string => `[2026.10.17-14.23.45:703][837]TLLua: Display: [Game] ${text}`
const sound = (name: string): string =>
  `[2026.10.17-14.23.55:151][ 72]LogDataTable: Warning: UDataTable::FindRow : '${name}' requested row '${name}' not in DataTable '/Game/Audio/BluePrint/CD/AudioCDTable.AudioCDTable'.`

const BOARD = line('PushMgr:RecvPushCombineMsg ProtoId = 5619, SynId = 12')
const OVER = line('PushMgr:RecvPushCombineMsg ProtoId = 5621, SynId = 245')
const SCREEN = line('S13GamePlayMain Run')
const DEAL = sound('Play_UI_S13_KYZ_Card_Deal_01')

describe('logTime', () => {
  test('reads the clock at the start of a line, in milliseconds', () => {
    expect(logTime('[2026.10.17-14.24.11:563][12]x')).toBe(Date.UTC(2026, 9, 17, 14, 24, 11, 563))
  })

  test('lines without the stamp at their very start have no time', () => {
    expect(logTime('')).toBeNull()
    expect(logTime(' [2026.10.17-14.24.11:563]')).toBeNull()
    expect(logTime('[2026.10.17-14.24.11]')).toBeNull()
    expect(logTime('[2026.10.17-14.24:563]')).toBeNull()
    expect(logTime('TLLua [2026.10.17-14.24.11:563]')).toBeNull()
  })

  test('later lines have later times, across a day and a month change', () => {
    const a = logTime('[2026.10.31-23.59.59:999]x') as number
    const b = logTime('[2026.11.01-00.00.00:000]x') as number
    expect(b - a).toBe(1)
  })
})

describe('classify', () => {
  test('the game\'s own lines are told apart', () => {
    expect(classify(BOARD)).toBe('board')
    expect(classify(SCREEN)).toBe('screen')
    expect(classify(line('S13GamePlay_C_StartGameBtn'))).toBe('screen')
    expect(classify(line('S13GamePlayMain_C_RefreshBtn clicked'))).toBe('refresh')
    expect(classify(OVER)).toBe('over')
    expect(classify(line('S13GamePlayMain Hide'))).toBe('over')
    expect(classify(line('S13GamePlayReward_C_GiveUpBtn'))).toBe('over')
  })

  test('other lines are nothing', () => {
    expect(classify('')).toBeNull()
    expect(classify(DEAL)).toBeNull()
    expect(classify(line('ProtoId = 9999'))).toBeNull()
  })

  test('a line that matches two kinds gives the earlier of board, screen, refresh, over', () => {
    expect(classify(line('ProtoId = 5619 ProtoId = 5621'))).toBe('board')
    expect(classify(line('S13GamePlayMain Run S13GamePlayMain Hide'))).toBe('screen')
  })

  test('custom rules replace the patterns', () => {
    const rules = { ...DEFAULT_RULES, patterns: { board: ['zzz'], screen: [], refresh: [], over: [] } }
    expect(classify('a zzz b', rules)).toBe('board')
    expect(classify(BOARD, rules)).toBeNull()
  })
})

describe('isAnimation', () => {
  test('card sounds are animations', () => {
    expect(isAnimation(DEAL)).toBe(true)
  })

  test('the player\'s own clicks share the prefix and are not animations', () => {
    expect(isAnimation(sound('Play_UI_S13_KYZ_Card_Selected'))).toBe(false)
    expect(isAnimation(sound('Play_UI_S13_KYZ_Card_Selected_Confirm'))).toBe(false)
    expect(isAnimation(sound('Play_UI_S13_KYZ_Card_Agentia_Use'))).toBe(false)
  })

  test('a line without the prefix is not one', () => {
    expect(isAnimation(line('hello'))).toBe(false)
  })
})

describe('the settler', () => {
  const { settleMs, doneDelayMs, maxMs } = DEFAULT_RULES

  test('nothing is due before anything happened', () => {
    const s = createSettler()
    expect(s.due(0)).toBeNull()
    expect(s.due(1e9)).toBeNull()
  })

  test('a board is due once the log has been quiet for the settle time, and only once', () => {
    const s = createSettler()
    s.feed([BOARD], 1000)
    expect(s.due(1000 + settleMs - 1)).toBeNull()
    expect(s.due(1000 + settleMs)).toBe('board')
    expect(s.due(1000 + settleMs + 1)).toBeNull()
  })

  test('each animation line pushes the settling back', () => {
    const s = createSettler()
    s.feed([BOARD], 0)
    s.feed([DEAL], 300)
    expect(s.due(settleMs)).toBeNull()
    expect(s.due(300 + settleMs)).toBe('board')
  })

  test('the player\'s sounds do not push the settling back', () => {
    const s = createSettler()
    s.feed([BOARD], 0)
    s.feed([sound('Play_UI_S13_KYZ_Card_Selected')], 300)
    expect(s.due(settleMs)).toBe('board')
  })

  test('the last animation of a played potion settles it after the short delay', () => {
    const s = createSettler()
    s.feed([BOARD], 0)
    s.feed([sound('Play_UI_S13_KYZ_Card_Figure_Refresh')], 100)
    expect(s.due(100 + doneDelayMs - 1)).toBeNull()
    expect(s.due(100 + doneDelayMs)).toBe('board')
  })

  test('a click of the player settles it at once', () => {
    const s = createSettler()
    s.feed([BOARD], 0)
    s.feed([DEAL], 10)
    s.feed([line('normal-click ComfirmBtn')], 20)
    expect(s.due(20)).toBe('board')
  })

  test('a click with nothing pending settles nothing', () => {
    const s = createSettler()
    s.feed([line('normal-click ComfirmBtn')], 0)
    s.feed([BOARD], 10)
    expect(s.due(10)).toBeNull()
  })

  test('endless animation is cut off at the longest wait', () => {
    const s = createSettler()
    s.feed([BOARD], 0)
    for (let t = 100; t < maxMs; t += 100) {
      s.feed([DEAL], t)
      expect(s.due(t)).toBeNull()
    }
    s.feed([DEAL], maxMs - 100)
    expect(s.due(maxMs)).toBe('board')
  })

  test('a new board while one is pending restarts the wait', () => {
    const s = createSettler()
    s.feed([BOARD], 0)
    s.feed([BOARD], settleMs - 10)
    expect(s.due(settleMs)).toBeNull()
    expect(s.due(settleMs - 10 + settleMs)).toBe('board')
  })

  test('the screen opening is its own kind of snap', () => {
    const s = createSettler()
    s.feed([SCREEN], 0)
    expect(s.due(settleMs)).toBe('screen')
  })

  test('the game ending cancels what is pending and holds back boards until the next screen', () => {
    const s = createSettler()
    s.feed([BOARD, OVER], 0)
    expect(s.over).toBe(true)
    expect(s.due(1e6)).toBeNull()
    s.feed([BOARD], 10)
    expect(s.due(1e6)).toBeNull()
    s.feed([SCREEN], 20)
    expect(s.over).toBe(false)
    expect(s.due(20 + settleMs)).toBe('screen')
  })

  test('refreshes are counted, and a new screen starts the count again', () => {
    const s = createSettler()
    const refresh = line('S13GamePlayMain_C_RefreshBtn')
    s.feed([refresh, refresh], 0)
    expect(s.refreshes).toBe(2)
    s.feed([SCREEN], 1)
    expect(s.refreshes).toBe(0)
    s.feed([refresh], 2)
    expect(s.refreshes).toBe(1)
  })

  test('cancel drops what is pending', () => {
    const s = createSettler()
    s.feed([BOARD], 0)
    s.cancel()
    expect(s.due(1e6)).toBeNull()
  })

  test('lines of no interest change nothing', () => {
    const s = createSettler()
    s.feed(['', 'garbage', line('Something else')], 0)
    expect(s.due(1e6)).toBeNull()
    expect(s.refreshes).toBe(0)
    expect(s.over).toBe(false)
  })
})
