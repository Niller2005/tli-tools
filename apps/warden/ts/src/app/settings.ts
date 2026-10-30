//! The app's settings, kept as JSON in the user's config folder
//! ($XDG_CONFIG_HOME/warden/settings.json, or ~/.config/warden).
//!
//! A port of src/app/settings.rs. The Windows-only settings (the window
//! placement, the updater, the installer, the desktop shortcut, the shared
//! logs and the highlight overlay) are dropped: the app has no window of its
//! own on Linux and no updater, installer or sharing.

import { toolFromKey, type Tool } from '@/engine/data'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** The app's settings, as they are kept in the settings file. */
export interface Settings {
  /** Reads the game now; such as "F9" or "Ctrl+Shift+R". */
  readHotkey: string
  /** Turns auto read on or off. */
  autoHotkey: string
  /** A part of the game window's title. */
  windowTitle: string
  rollouts: number
  /** Held instrument keys. */
  tools: string[]
  /** Days until Riot when `tools` were saved: a higher count read twice
   * at start is a new run and clears them. */
  toolsDays: number | null
  /** The run's theme, an id of the game data's themes; null for a run
   * without one. */
  theme: number | null
  /** Read the game by itself when its screen changes and settles. */
  autoRead: boolean
  /** Keep a log of each run's reads, advice and corrections, with the
   * frames read, in the config folder's `runs` (the newest 10 runs), see
   * [`./runlog`]. */
  runLog: boolean
}

/** The settings a fresh install has. */
export function defaultSettings(): Settings {
  return {
    readHotkey: 'F9',
    autoHotkey: 'F8',
    windowTitle: 'Torchlight',
    rollouts: 1600,
    tools: [],
    toolsDays: null,
    theme: null,
    autoRead: true,
    runLog: true,
  }
}

/** The folder the app keeps its files in; null when the home directory is
 * not known. */
export function appDir(): string | null {
  const base = process.env.XDG_CONFIG_HOME ?? (homedir() ? join(homedir(), '.config') : null)
  if (base === null || base === '') return null
  return join(base, 'warden')
}

/** The settings file's path; null when the home directory is not known. */
export function settingsPath(): string | null {
  const dir = appDir()
  return dir === null ? null : join(dir, 'settings.json')
}

/** The saved settings, or the defaults when there are none or they don't
 * parse. */
export function loadSettings(): Settings {
  const path = settingsPath()
  if (path === null) return defaultSettings()
  try {
    return parseSettings(readFileSync(path, 'utf8')) ?? defaultSettings()
  } catch {
    return defaultSettings()
  }
}

/** Settings from saved JSON: the defaults for every field the file leaves
 * out. Every save stores the whole struct, so installs from before 0.7.1
 * hold its default of 400 playouts: that count is raised to the current
 * default. */
export function parseSettings(text: string): Settings | null {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const v = raw as Record<string, unknown>
  const d = defaultSettings()
  const s: Settings = { ...d }
  if (v.read_hotkey !== undefined) {
    if (typeof v.read_hotkey !== 'string') return null
    s.readHotkey = v.read_hotkey
  }
  if (v.auto_hotkey !== undefined) {
    if (typeof v.auto_hotkey !== 'string') return null
    s.autoHotkey = v.auto_hotkey
  }
  if (v.window_title !== undefined) {
    if (typeof v.window_title !== 'string') return null
    s.windowTitle = v.window_title
  }
  if (v.rollouts !== undefined) {
    if (typeof v.rollouts !== 'number' || !Number.isFinite(v.rollouts)) return null
    s.rollouts = v.rollouts
  }
  if (v.tools !== undefined) {
    if (!Array.isArray(v.tools) || v.tools.some((t) => typeof t !== 'string')) return null
    s.tools = v.tools as string[]
  }
  if (v.tools_days !== undefined && v.tools_days !== null) {
    if (typeof v.tools_days !== 'number' || !Number.isFinite(v.tools_days)) return null
    s.toolsDays = v.tools_days
  }
  if (v.theme !== undefined && v.theme !== null) {
    if (typeof v.theme !== 'number' || !Number.isFinite(v.theme)) return null
    s.theme = v.theme
  }
  if (v.auto_read !== undefined) {
    if (typeof v.auto_read !== 'boolean') return null
    s.autoRead = v.auto_read
  }
  if (v.run_log !== undefined) {
    if (typeof v.run_log !== 'boolean') return null
    s.runLog = v.run_log
  }
  if (s.rollouts === 400) s.rollouts = d.rollouts
  return s
}

/** Writes the settings; throws when the folder or the file cannot be
 * written. */
export function saveSettings(s: Settings): void {
  const path = settingsPath()
  if (path === null) throw new Error('the home directory is not known')
  const dir = join(path, '..')
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, `${JSON.stringify(s, null, 2)}\n`)
}

/** The held instruments; unknown keys are dropped. */
export function heldTools(s: Settings): Tool[] {
  const out: Tool[] = []
  for (const key of s.tools) {
    const tool = toolFromKey(key)
    if (tool !== null) out.push(tool)
  }
  return out
}
