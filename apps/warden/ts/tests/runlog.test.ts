//! The run log's folder names, pruning and frame numbering, and the
//! settings file's defaults. A port of the `#[cfg(test)]` modules of the
//! Rust crate's src/app/runlog.rs and src/app/settings.rs.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, test } from 'bun:test'

import { folderName, isRunFolder, prune, RunLog, timestamp } from '@/app/runlog'
import { defaultSettings, heldTools, parseSettings } from '@/app/settings'
import { blankModel } from '@/board/board'
import { Rgba } from '@/reader/mod'

/** A fresh folder in the temp directory. */
function temp(name: string): string {
  return mkdtempSync(join(tmpdir(), `warden-runlog-${name}-`))
}

test('run folder names sort by time', () => {
  const at = (s: number) => new Date(s * 1000)
  expect(folderName(at(0))).toBe('1970-01-01_00-00-00')
  expect(folderName(at(1_792_286_625))).toBe('2026-10-18_01-23-45')
  expect(timestamp(new Date(1_792_286_625_007))).toBe('2026-10-18T01:23:45.007Z')
  expect(folderName(at(951_782_400))).toBe('2000-02-29_00-00-00')
  const times = [9, 10, 59, 3599, 86_399, 86_400, 31_535_999, 31_536_000, 1_792_286_625]
  const names = times.map((s) => folderName(at(s)))
  for (let k = 1; k < names.length; k++) expect(names[k - 1] < names[k]).toBe(true)
  expect(names.every(isRunFolder)).toBe(true)
  expect(isRunFolder('notes')).toBe(false)
  expect(isRunFolder('2026-10-18_01-23-45-2')).toBe(true)
})

test('prune keeps the newest', () => {
  const root = temp('prune')
  for (let k = 0; k < 12; k++) mkdirSync(join(root, `2026-10-${String(k + 1).padStart(2, '0')}_00-00-00`))
  mkdirSync(join(root, 'mine'))
  prune(root, 10)
  const left = readdirSync(root).sort()
  expect(left.length).toBe(11)
  expect(left[0]).toBe('2026-10-03_00-00-00')
  expect(left[9]).toBe('2026-10-12_00-00-00')
  expect(left[10]).toBe('mine')
  rmSync(root, { recursive: true })
})

test('frames are numbered once per board', async () => {
  const root = temp('frames')
  const log = new RunLog(root)
  const pixel = () => new Rgba(1, 1, new Uint8Array([0, 0, 0, 255]))
  const board = blankModel()
  const other = blankModel()
  other.day += 1
  expect(log.frame('patrol', board, pixel())).toBe('frame-0001.png')
  expect(log.frame('patrol', board, pixel())).toBe(null)
  expect(log.frame('manage', board, pixel())).toBe('frame-0002.png')
  expect(log.frame('manage', other, pixel())).toBe('frame-0003.png')
  // A frame without a board is saved once per screen.
  expect(log.frame('unknown', null, pixel())).toBe('frame-0004.png')
  expect(log.frame('unknown', null, pixel())).toBe(null)
  expect(log.frame('popup', null, pixel())).toBe('frame-0005.png')
  log.event('read', new Date(), { screen: 'Patrol' })
  await log.wait()
  const first = log.dir()
  expect(statSync(join(first, 'frame-0005.png')).isFile() && statSync(join(first, 'log.jsonl')).isFile()).toBe(true)

  // A new run numbers from 1 again, in another folder, which starts with
  // the window line again.
  log.window({ window: 'w', ocr: 'en-US' })
  log.newRun()
  expect(log.dir()).not.toBe(first)
  expect(log.frame('manage', other, pixel())).toBe('frame-0001.png')
  await log.wait()
  const text = readFileSync(join(log.dir(), 'log.jsonl'), 'utf8')
  const line = JSON.parse(text.split('\n')[0])
  expect([line.kind, line.window, line.ocr]).toEqual(['window', 'w', 'en-US'])
  expect(existsSync(join(log.dir(), 'frame-0001.png'))).toBe(true)
  rmSync(root, { recursive: true })
})

test('an old hotkey field', () => {
  const s = parseSettings('{"hotkey": "F7", "rollouts": 300}')
  expect(s).not.toBe(null)
  expect([s?.readHotkey, s?.autoHotkey, s?.rollouts, s?.toolsDays, s?.theme, s?.runLog]).toEqual(['F9', 'F8', 300, null, null, true])
})

test('the old default of 400 rollouts is raised', () => {
  const rollouts = (text: string) => parseSettings(text)?.rollouts ?? null
  expect(rollouts('{"rollouts": 400}')).toBe(1600)
  expect(rollouts('{"rollouts": 300}')).toBe(300)
  expect(rollouts('{}')).toBe(1600)
  expect(rollouts('not json')).toBe(null)
})

test('held tools drop the unknown keys', () => {
  const s = { ...defaultSettings(), tools: ['saw', 'nonsense', 'coin'] }
  expect(heldTools(s)).toEqual(['saw', 'coin'])
})
