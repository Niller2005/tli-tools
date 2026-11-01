// The settings of the dashboard: one file, read tolerantly, written in one piece.
//
// The player sets a few things per tool: whether its colours are off, whether it reads the game's
// log, how its pictures are taken, and whether it opens by itself when its minigame opens. The
// file is the player's: whatever is wrong with it, reading it still works — the dashboard starts
// from the default settings and says nothing, rather than refusing to run.
//
// `autoLaunch` is only stored here. The dashboard acts on it; nothing in this package opens a
// window because of it.

import { readFileSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { homedir } from 'node:os'

/** The version of the settings file this package reads and writes. */
export const SETTINGS_VERSION = 1

/** What the player can set for one tool. */
export interface ToolSettings {
  /** the colours of the tool are off */
  noColor?: boolean
  /** the tool does not read the game's log (only the tools that can be told that) */
  noLog?: boolean
  /** Niri's own window screenshot is allowed (only the tools that take pictures) */
  niriScreenshot?: boolean
  /** a command that writes a PNG of the game to {out}, instead of the capture of the compositor */
  captureCmd?: string | null
  /** the tool opens by itself when its minigame opens; stored here, acted on by the dashboard */
  autoLaunch?: boolean
}

/** The whole settings file. */
export interface Settings {
  version: number
  tools: Record<string, ToolSettings>
}

/** The path of the settings file: `$XDG_CONFIG_HOME/tli-dashboard/settings.json`. */
export function settingsPath(env: Record<string, string | undefined> = process.env): string {
  const given = env.XDG_CONFIG_HOME
  // the XDG spec ignores a relative or empty XDG_CONFIG_HOME
  if (given !== undefined && given !== '' && isAbsolute(given)) {
    return join(given, 'tli-dashboard', 'settings.json')
  }
  const home = env.HOME !== undefined && env.HOME !== '' ? env.HOME : homedir()
  return join(home, '.config', 'tli-dashboard', 'settings.json')
}

/** The settings when there is nothing set: no version trouble, no tool entries. */
export function defaultSettings(): Settings {
  return { version: SETTINGS_VERSION, tools: {} }
}

/**
 * The settings as they are stored, or the default settings when the file cannot be read.
 *
 * A file of another version, a file that is not JSON, a file that is not there: all of them give
 * the default settings. A tool entry keeps the settings it says plainly (a boolean where a
 * boolean belongs, a string where the capture command belongs) and loses the rest.
 */
export function readSettings(path: string): Settings {
  let text: string
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    return defaultSettings()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return defaultSettings()
  }
  return settingsFrom(parsed)
}

/** Writes the settings so that a reader never sees half of them. */
export function writeSettings(path: string, settings: Settings): void {
  const directory = dirname(path)
  mkdirSync(directory, { recursive: true })
  // a neighbour of the real file, so the rename stays on one filesystem: that is what makes the
  // write one piece
  const temporary = join(directory, `.${basename(path)}.${process.pid}.tmp`)
  writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`)
  try {
    renameSync(temporary, path)
  } catch (error) {
    rmSync(temporary, { force: true })
    throw error
  }
}

/** The settings of one tool, with the ones that are not set filled in. */
export function toolSettings(settings: Settings, id: string): Required<ToolSettings> {
  const stored = settings.tools[id] ?? {}
  return {
    noColor: stored.noColor === true,
    noLog: stored.noLog === true,
    niriScreenshot: stored.niriScreenshot === true,
    captureCmd: stored.captureCmd ?? null,
    autoLaunch: stored.autoLaunch === true,
  }
}

/** The settings with one tool's settings changed, as a new object: the given one is left as it is. */
export function setToolSettings(settings: Settings, id: string, patch: ToolSettings): Settings {
  return {
    version: settings.version,
    tools: { ...settings.tools, [id]: { ...toolSettings(settings, id), ...patch } },
  }
}

/** The settings a parsed file stands for, when it stands for any. */
function settingsFrom(value: unknown): Settings {
  if (typeof value !== 'object' || value === null) return defaultSettings()
  const file = value as Record<string, unknown>
  // a file of another version is not ours to interpret
  if (file.version !== SETTINGS_VERSION) return defaultSettings()
  if (typeof file.tools !== 'object' || file.tools === null) return defaultSettings()

  const tools: Record<string, ToolSettings> = {}
  for (const [id, entry] of Object.entries(file.tools)) {
    const read = toolSettingsFrom(entry)
    if (read !== null) tools[id] = read
  }
  return { version: SETTINGS_VERSION, tools }
}

/** The settings one entry of the file stands for, when it says anything plainly. */
function toolSettingsFrom(value: unknown): ToolSettings | null {
  if (typeof value !== 'object' || value === null) return null
  const entry = value as Record<string, unknown>
  const settings: ToolSettings = {}
  for (const name of ['noColor', 'noLog', 'niriScreenshot', 'autoLaunch'] as const) {
    if (entry[name] === true || entry[name] === false) settings[name] = entry[name]
  }
  const command = entry.captureCmd
  // an empty command is no command; a null one is said plainly and kept
  if (command === null || (typeof command === 'string' && command !== '')) settings.captureCmd = command
  return Object.keys(settings).length > 0 ? settings : null
}
