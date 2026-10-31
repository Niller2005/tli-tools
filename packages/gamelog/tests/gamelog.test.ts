import { afterAll, describe, expect, test, vi } from 'bun:test'
import { mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  classifyLine,
  follow,
  findLog,
  logHint,
  logTime,
  MinigameTracker,
  scanBack,
  watchMinigames,
  type GameName,
} from '../src/index'

const dir = mkdtempSync(join(tmpdir(), 'tli-gamelog-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

/** The log's text for the lines given, each on its own line. */
const content = (lines: string[]): string => `${lines.join('\n')}\n`

/** A log file in the temp folder, with the lines given. */
const logFile = (name: string, lines: string[]): string => {
  const file = join(dir, name)
  writeFileSync(file, content(lines))
  return file
}

/** A line as the game writes it: the time, then the text. */
const at = (time: string, text: string): string => `[${time}][590]TLLua: Display: [Game] TipMsgShowMgr@DispatchPageRunChange ${text}`

/** The Tartarus board's page, opening or closing. */
const board = (time: string, state: string): string => at(time, `PageName = S16BoardMain , PageRunState = ${state}`)

/** The Vorax game's page, opening or closing. */
const vorax = (time: string, state: string): string => at(time, `PageName = S13GamePlayMain , PageRunState = ${state}`)

/** The Tarot Path's page, opening or closing. */
const taro = (time: string, state: string): string => at(time, `PageName = S9Taro , PageRunState = ${state}`)

/** A line of the game that says nothing about the minigames. */
const noise = (time: string): string => at(time, 'PageBase@ OpenFlow0! Switch = true S16BoardMain 532639')

const T1 = '2026.10.29-21.50.21:034'
const T2 = '2026.10.29-21.50.23:729'
const T3 = '2026.10.29-21.53.11:523'

describe('classifyLine', () => {
  test('the board opening and closing', () => {
    expect(classifyLine(board(T1, 'Run'))).toEqual({ game: 'warden', open: true })
    expect(classifyLine(board(T2, 'Destory'))).toEqual({ game: 'warden', open: false })
  })

  test('the Vorax game opening and closing', () => {
    expect(classifyLine(vorax(T1, 'Run'))).toEqual({ game: 'vorax', open: true })
    expect(classifyLine(vorax(T2, 'Hide'))).toEqual({ game: 'vorax', open: false })
    expect(classifyLine(vorax(T3, 'Destory'))).toEqual({ game: 'vorax', open: false })
  })

  test('the Tarot Path opening and closing', () => {
    expect(classifyLine(taro(T1, 'Run'))).toEqual({ game: 'arcana', open: true })
    expect(classifyLine(taro(T2, 'Hide'))).toEqual({ game: 'arcana', open: false })
    expect(classifyLine(taro(T3, 'Destory'))).toEqual({ game: 'arcana', open: false })
  })

  test('the other lines of the log', () => {
    expect(classifyLine(noise(T1))).toBeNull()
    expect(classifyLine(at(T1, 'PageName = S16BoardMain, PageType = FuncPage, LifeState = Hide'))).toBeNull()
    expect(classifyLine('')).toBeNull()
    expect(classifyLine('[2026.10.29-21.50.21:034][590]TLLua: Display: [Game] GAMEPLAY_ENTER GameplayType=9102')).toBeNull()
  })
})

describe('the tracker', () => {
  test('the state follows the lines', () => {
    const t = new MinigameTracker()
    expect(t.feed([board(T1, 'Run')]).warden.state).toBe('open')
    expect(t.warden.state).toBe('open')
    t.feed([board(T2, 'Destory')])
    expect(t.warden.state).toBe('closed')
    expect(t.vorax.state).toBe('unknown')
  })

  test('the two games are told apart', () => {
    const t = new MinigameTracker()
    t.feed([board(T1, 'Run'), vorax(T2, 'Run'), board(T3, 'Destory')])
    expect(t.warden.state).toBe('closed')
    expect(t.vorax.state).toBe('open')
  })

  test('the Tarot Path has its own state', () => {
    const t = new MinigameTracker()
    t.feed([taro(T1, 'Run')])
    expect(t.arcana.state).toBe('open')
    expect(t.warden.state).toBe('unknown')
    expect(t.vorax.state).toBe('unknown')
    t.feed([taro(T2, 'Hide')])
    expect(t.arcana.state).toBe('closed')
  })

  test('the time of the last change is the line\'s own', () => {
    const t = new MinigameTracker()
    t.feed([board(T1, 'Run'), vorax(T2, 'Run'), board(T3, 'Destory')])
    expect(t.warden.at).toBe(Date.UTC(2026, 9, 29, 21, 53, 11, 523))
    expect(t.vorax.at).toBe(Date.UTC(2026, 9, 29, 21, 50, 23, 729))
    expect(logTime(board(T1, 'Run'))).toBe(Date.UTC(2026, 9, 29, 21, 50, 21, 34))
    expect(logTime('no time here')).toBeNull()
  })

  test('a line without a time leaves the time empty', () => {
    const t = new MinigameTracker()
    t.feed(['TipMsgShowMgr@DispatchPageRunChange PageName = S16BoardMain , PageRunState = Run'])
    expect(t.warden.state).toBe('open')
    expect(t.warden.at).toBeNull()
  })
})

describe('scanBack', () => {
  test('the last state of each game in the log', () => {
    const file = logFile('both.log', [
      noise(T1),
      board(T1, 'Run'),
      vorax(T2, 'Run'),
      board(T3, 'Destory'),
      vorax(T3, 'Hide'),
    ])
    const scan = scanBack(file)
    expect(scan.warden.state).toBe('closed')
    expect(scan.vorax.state).toBe('closed')
    expect(scan.detail).toBe(true)
    expect(scan.size).toBe(statSync(file).size)
  })

  test('a log that ends with the board open', () => {
    const file = logFile('open.log', [noise(T1), board(T1, 'Run'), vorax(T2, 'Run')])
    const scan = scanBack(file)
    expect(scan.warden.state).toBe('open')
    expect(scan.vorax.state).toBe('open')
  })

  test('a file smaller than the tail is read whole', () => {
    const file = logFile('small.log', [board(T1, 'Run'), board(T2, 'Destory')])
    const scan = scanBack(file, 1024 * 1024)
    expect(scan.warden.state).toBe('closed')
  })

  test('a cut tail leaves out the half line it starts with', () => {
    const lines = [noise(T1), board(T1, 'Run'), board(T2, 'Destory')]
    const file = logFile('cut.log', lines)
    const whole = content(lines)
    // the tail starts in the middle of the first line, which is then left out
    const scan = scanBack(file, whole.length - noise(T1).length)
    expect(scan.warden.state).toBe('closed')
  })

  test('a tail that starts at a line keeps it', () => {
    const lines = [noise(T1), board(T1, 'Run')]
    const file = logFile('cut-line.log', lines)
    const whole = content(lines)
    // the tail starts at the board's line, which is whole
    const scan = scanBack(file, whole.length - noise(T1).length - 1)
    expect(scan.warden.state).toBe('open')
  })

  test('a log that is not there', () => {
    const scan = scanBack(join(dir, 'nothing.log'))
    expect(scan.warden.state).toBe('unknown')
    expect(scan.vorax.state).toBe('unknown')
    expect(scan.arcana.state).toBe('unknown')
    expect(scan.detail).toBe(false)
    expect(scan.size).toBe(0)
  })

  test('the Tarot Path in the tail', () => {
    const file = logFile('taro.log', [taro(T1, 'Run'), taro(T2, 'Hide')])
    const scan = scanBack(file)
    expect(scan.arcana.state).toBe('closed')
  })

  test('a log without the game\'s own lines', () => {
    const file = logFile('nodetail.log', ['[2026.10.29-21.50.21:034][590]LogInit: some other line\n'])
    const scan = scanBack(file)
    expect(scan.detail).toBe(false)
    expect(scan.warden.state).toBe('unknown')
  })
})

describe('the follower', () => {
  test('the first poll starts at the end of the log', () => {
    const file = logFile('follow.log', [board(T1, 'Run')])
    const follower = follow(file)
    expect(follower.poll()).toEqual([])
    writeFileSync(file, `${board(T2, 'Destory')}\n`, { flag: 'a' })
    expect(follower.poll()).toEqual([board(T2, 'Destory')])
  })

  test('a line that is not finished yet is not given', () => {
    const file = logFile('half.log', [board(T1, 'Run')])
    const follower = follow(file)
    follower.poll()
    writeFileSync(file, board(T2, 'Destory').slice(0, 40), { flag: 'a' })
    expect(follower.poll()).toEqual([])
    writeFileSync(file, `${board(T2, 'Destory').slice(40)}\n`, { flag: 'a' })
    expect(follower.poll()).toEqual([board(T2, 'Destory')])
  })

  test('a truncated log is read from its beginning again', () => {
    const file = logFile('cut-follow.log', [board(T1, 'Run'), board(T2, 'Destory')])
    const follower = follow(file)
    follower.poll()
    writeFileSync(file, `${vorax(T3, 'Run')}\n`)
    expect(follower.poll()).toEqual([vorax(T3, 'Run')])
  })

  test('a log that is rotated is read from its beginning again', () => {
    const file = logFile('rotated.log', [board(T1, 'Run')])
    const follower = follow(file)
    follower.poll()
    rmSync(file)
    writeFileSync(file, `${vorax(T3, 'Run')}\n`)
    expect(follower.poll()).toEqual([vorax(T3, 'Run')])
  })
})

describe('watchMinigames', () => {
  test('the states follow the log', () => {
    const file = logFile('watch.log', [board(T1, 'Run')])
    vi.useFakeTimers()
    const watcher = watchMinigames({ log: file, intervalMs: 10 })
    expect(watcher.state().warden).toBe('open')
    expect(watcher.state().vorax).toBe('unknown')
    expect(watcher.state().arcana).toBe('unknown')
    expect(watcher.state().log).toBe('ok')
    writeFileSync(file, `${board(T2, 'Destory')}\n`, { flag: 'a' })
    vi.advanceTimersByTime(20)
    expect(watcher.state().warden).toBe('closed')
    watcher.close()
    vi.useRealTimers()
  })

  test('the Tarot Path is watched too', () => {
    const file = logFile('watch-taro.log', [taro(T1, 'Run')])
    const watcher = watchMinigames({ log: file })
    expect(watcher.state().arcana).toBe('open')
    watcher.close()
  })

  test('a log that is not there', () => {
    const watcher = watchMinigames({ log: join(dir, 'nothing.log') })
    expect(watcher.state()).toEqual({ warden: 'unknown', vorax: 'unknown', arcana: 'unknown', log: 'missing' })
    watcher.close()
  })

  test('a log without the game\'s own lines', () => {
    const file = logFile('watch-nodetail.log', ['[2026.10.29-21.50.21:034][590]LogInit: another line'])
    const watcher = watchMinigames({ log: file })
    expect(watcher.state().log).toBe('no-detail')
    watcher.close()
  })

  test('a log that is still empty', () => {
    const file = join(dir, 'empty.log')
    writeFileSync(file, '')
    const watcher = watchMinigames({ log: file })
    expect(watcher.state().log).toBe('ok')
    watcher.close()
  })
})

describe('the hints', () => {
  test('what to say about the log', () => {
    expect(logHint('ok')).toBeNull()
    expect(logHint('missing')).toBe('log: missing')
    expect(logHint('no-detail')).toBe('log: enable log')
  })
})

describe('the game\'s own log', () => {
  const found = findLog()
  test.skipIf(found === null)('the real log is read', () => {
    const file = found?.file as string
    const started = performance.now()
    const scan = scanBack(file)
    const took = performance.now() - started
    expect(['open', 'closed', 'unknown']).toContain(scan.warden.state)
    expect(['open', 'closed', 'unknown']).toContain(scan.vorax.state)
    expect(['open', 'closed', 'unknown']).toContain(scan.arcana.state)
    expect(took).toBeLessThan(5000)
  })
})
