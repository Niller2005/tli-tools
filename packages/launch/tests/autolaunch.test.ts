import { describe, expect, test } from 'bun:test'
import type { MinigameView } from '@tli/gamelog'
import { defaultSettings, setToolSettings, toolById } from '@tli/launch'
import { newlyOpen, statesOf, toolsToAutoLaunch } from '../src/autolaunch'

const view = (warden: MinigameView['warden'], vorax: MinigameView['vorax'], arcana: MinigameView['arcana']): MinigameView => ({
  warden,
  vorax,
  arcana,
  log: 'ok',
})

describe('the auto-launch transitions', () => {
  test('a closed board that opens is a transition', () => {
    expect(newlyOpen(statesOf(view('closed', 'closed', 'closed')), view('open', 'closed', 'closed'))).toEqual(['warden'])
    expect(newlyOpen(statesOf(view('closed', 'closed', 'closed')), view('closed', 'open', 'closed'))).toEqual(['vorax'])
    expect(newlyOpen(statesOf(view('closed', 'closed', 'closed')), view('closed', 'closed', 'open'))).toEqual(['arcana'])
  })

  test('a board that stays open is not a transition, and neither is one that closes', () => {
    expect(newlyOpen(statesOf(view('open', 'closed', 'unknown')), view('open', 'closed', 'unknown'))).toEqual([])
    expect(newlyOpen(statesOf(view('open', 'closed', 'unknown')), view('closed', 'closed', 'unknown'))).toEqual([])
  })

  test('the first sample is not a transition, however open the board already is', () => {
    expect(newlyOpen(statesOf(null), view('open', 'open', 'open'))).toEqual([])
  })

  test('a log that said nothing and then says the board is open is a transition', () => {
    expect(newlyOpen(statesOf(view('unknown', 'unknown', 'unknown')), view('open', 'unknown', 'unknown'))).toEqual(['warden'])
  })

  test('no view means nothing opens', () => {
    expect(newlyOpen(statesOf(view('closed', 'closed', 'closed')), null)).toEqual([])
  })
})

describe('the tools that open by themselves', () => {
  test('only the tools of the minigames that opened, with auto-launch on and nothing running', () => {
    const settings = setToolSettings(
      setToolSettings(defaultSettings(), 'warden', { autoLaunch: true }),
      'arcana',
      { autoLaunch: true },
    )
    const tools = toolsToAutoLaunch(['warden', 'arcana'], settings, () => false)
    expect(tools.map(tool => tool.id)).toEqual(['warden', 'arcana'])
  })

  test('a tool that is already running is not opened again', () => {
    const settings = setToolSettings(defaultSettings(), 'warden', { autoLaunch: true })
    const tools = toolsToAutoLaunch(['warden'], settings, id => id === 'warden')
    expect(tools).toEqual([])
  })

  test('auto-launch is off unless the player turns it on', () => {
    expect(toolsToAutoLaunch(['warden', 'vorax', 'arcana'], defaultSettings(), () => false)).toEqual([])
  })

  test('a tool without the minigame that opened is not opened', () => {
    const settings = setToolSettings(defaultSettings(), 'tracker', { autoLaunch: true })
    expect(toolsToAutoLaunch(['warden'], settings, () => false)).toEqual([])
    expect(toolById('tracker')?.game).toBeUndefined()
  })
})
