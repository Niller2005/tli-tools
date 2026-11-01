import { describe, expect, test } from 'bun:test'
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SETTINGS_VERSION,
  defaultSettings,
  readSettings,
  setToolSettings,
  settingsPath,
  toolSettings,
  writeSettings,
} from '../src/settings'

describe('the path of the settings file', () => {
  test('it is in tli-dashboard under XDG_CONFIG_HOME when that is set', () => {
    expect(settingsPath({ XDG_CONFIG_HOME: '/home/player/.config' })).toBe(
      '/home/player/.config/tli-dashboard/settings.json',
    )
  })

  test('a relative or empty XDG_CONFIG_HOME is ignored, as the spec says', () => {
    expect(settingsPath({ XDG_CONFIG_HOME: 'config', HOME: '/home/player' })).toBe(
      '/home/player/.config/tli-dashboard/settings.json',
    )
    expect(settingsPath({ XDG_CONFIG_HOME: '', HOME: '/home/player' })).toBe(
      '/home/player/.config/tli-dashboard/settings.json',
    )
  })

  test('without XDG_CONFIG_HOME it is in .config under the home', () => {
    expect(settingsPath({ HOME: '/home/player' })).toBe('/home/player/.config/tli-dashboard/settings.json')
  })
})

describe('reading the settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tli-settings-'))
  const path = join(dir, 'settings.json')

  test('a file that is not there gives the default settings', () => {
    expect(readSettings(join(dir, 'missing.json'))).toEqual(defaultSettings())
  })

  test('a file that is not JSON gives the default settings', () => {
    writeFileSync(path, '{not json')
    expect(readSettings(path)).toEqual(defaultSettings())
  })

  test('a file of another version is not ours to interpret', () => {
    writeFileSync(path, JSON.stringify({ version: 2, tools: { vorax: { noColor: true } } }))
    expect(readSettings(path)).toEqual(defaultSettings())
  })

  test('a file that is not an object gives the default settings', () => {
    writeFileSync(path, '["vorax"]')
    expect(readSettings(path)).toEqual(defaultSettings())
  })

  test('the settings a good file holds are read as they are', () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        tools: { vorax: { noColor: true, niriScreenshot: true, captureCmd: 'shot {out}' } },
      }),
    )
    expect(readSettings(path)).toEqual({
      version: 1,
      tools: { vorax: { noColor: true, niriScreenshot: true, captureCmd: 'shot {out}' } },
    })
  })

  test('what a tool entry does not say plainly is left out', () => {
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        tools: {
          vorax: { noColor: 'yes', noLog: true, captureCmd: '', whoKnows: 1 },
          warden: 'no',
          tracker: { autoLaunch: false },
        },
      }),
    )
    expect(readSettings(path)).toEqual({
      version: 1,
      tools: { vorax: { noLog: true }, tracker: { autoLaunch: false } },
    })
  })
})

describe('writing the settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'tli-settings-'))
  const path = join(dir, 'deep', 'settings.json')

  test('the folder is made, and what is written reads back the same', () => {
    const settings = setToolSettings(defaultSettings(), 'vorax', { noLog: true, autoLaunch: true })
    writeSettings(path, settings)
    expect(readSettings(path)).toEqual(settings)
  })

  test('the file is written in one piece: nothing temporary is left beside it', () => {
    writeSettings(path, defaultSettings())
    expect(readdirSync(join(dir, 'deep'))).toEqual(['settings.json'])
  })

  test('a file that is already there is replaced, and stays JSON', () => {
    writeSettings(path, setToolSettings(defaultSettings(), 'vorax', { noColor: true }))
    const settings = setToolSettings(defaultSettings(), 'warden', { noColor: true })
    writeSettings(path, settings)
    const read = JSON.parse(readFileSync(path, 'utf8')) as { version: number }
    expect(read.version).toBe(SETTINGS_VERSION)
    expect(readSettings(path)).toEqual(settings)
  })

  rmSync(dir, { recursive: true, force: true })
})

describe('the settings of one tool', () => {
  test('the settings that are not set are filled in', () => {
    expect(toolSettings({ version: 1, tools: {} }, 'vorax')).toEqual({
      noColor: false,
      noLog: false,
      niriScreenshot: false,
      captureCmd: null,
      autoLaunch: false,
    })
  })

  test('the settings that are set are kept', () => {
    expect(
      toolSettings({ version: 1, tools: { vorax: { noLog: true, captureCmd: 'shot {out}' } } }, 'vorax'),
    ).toEqual({
      noColor: false,
      noLog: true,
      niriScreenshot: false,
      captureCmd: 'shot {out}',
      autoLaunch: false,
    })
  })

  test('changing the settings of one tool leaves the others and the given settings alone', () => {
    const given = setToolSettings(defaultSettings(), 'vorax', { noColor: true })
    const changed = setToolSettings(given, 'warden', { autoLaunch: true })
    expect(changed.tools).toEqual({
      vorax: { noColor: true, noLog: false, niriScreenshot: false, captureCmd: null, autoLaunch: false },
      warden: { noColor: false, noLog: false, niriScreenshot: false, captureCmd: null, autoLaunch: true },
    })
    expect(given.tools).toEqual({ vorax: { noColor: true, noLog: false, niriScreenshot: false, captureCmd: null, autoLaunch: false } })
  })
})
