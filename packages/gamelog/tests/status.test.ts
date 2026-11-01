import { describe, expect, test } from 'bun:test'
import { MinigameTracker, minigameStatus, type ToolStatus } from '../src/index'

/** A line as the game writes it: the time, then the text. */
const at = (time: string, text: string): string =>
  `[${time}][590]TLLua: Display: [Game] TipMsgShowMgr@DispatchPageRunChange ${text}`

/** The Tartarus board's page, opening or closing. */
const board = (time: string, state: string): string =>
  at(time, `PageName = S16BoardMain , PageRunState = ${state}`)

/** The Vorax game's page, opening or closing. */
const vorax = (time: string, state: string): string =>
  at(time, `PageName = S13GamePlayMain , PageRunState = ${state}`)

const T1 = '2026.10.29-21.50.21:034'
const T2 = '2026.10.29-21.53.11:523'

describe('minigameStatus', () => {
  test('an open minigame is a line that says so', () => {
    const t = new MinigameTracker()
    t.feed([board(T1, 'Run')])
    expect(minigameStatus('warden', t.warden)).toEqual({
      id: 'warden',
      line: 'open',
      tone: 'ok',
      at: Date.UTC(2026, 9, 29, 21, 50, 21, 34),
    } satisfies ToolStatus)
  })

  test('a closed minigame is drawn quietly', () => {
    const t = new MinigameTracker()
    t.feed([board(T1, 'Run'), board(T2, 'Destory')])
    const status = minigameStatus('warden', t.warden)
    expect(status.line).toBe('closed')
    expect(status.tone).toBe('dim')
    expect(status.at).toBe(Date.UTC(2026, 9, 29, 21, 53, 11, 523))
  })

  test('a minigame the log says nothing about has nothing to say', () => {
    const t = new MinigameTracker()
    t.feed([vorax(T1, 'Run')])
    const status = minigameStatus('warden', t.warden)
    expect(status.line).toBe('')
    expect(status.tone).toBe('dim')
    expect(status.at).toBe(0)
  })

  test('the id is the game the state is about', () => {
    const t = new MinigameTracker()
    t.feed([vorax(T1, 'Run')])
    expect(minigameStatus('vorax', t.vorax).id).toBe('vorax')
    expect(minigameStatus('vorax', t.vorax).line).toBe('open')
  })
})
