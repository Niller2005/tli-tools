import { afterEach, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { captureStatus } from '../src/index'

// The tests must never touch the player's own desktop: every `niri`, `grim` and
// `tesseract` the PATH offers is a shim that only writes a line to a file, and
// the file must stay empty: `captureStatus` runs nothing.

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

/** A folder on the PATH whose programs record that they were run. */
function shims(...names: string[]): { path: string; ran: string } {
  const dir = mkdtempSync(join(tmpdir(), 'tli-shims-'))
  dirs.push(dir)
  const ran = join(dir, 'ran')
  for (const name of names) {
    writeFileSync(join(dir, name), `#!/bin/sh\necho "${name}" >> ${JSON.stringify(ran)}\nexit 1\n`, { mode: 0o755 })
  }
  return { path: dir, ran }
}

/** Nothing was run. */
function silent(ran: string) {
  expect(existsSync(ran)).toBe(false)
}

const env = (path: string, extra: Record<string, string> = {}): Record<string, string> => ({
  PATH: path,
  ...extra,
})

test('every tool on the PATH: grim is the way, and nothing is run', () => {
  const { path, ran } = shims('grim', 'niri', 'tesseract')
  expect(captureStatus({ env: env(path) })).toEqual({
    tools: [
      { name: 'grim', found: true },
      { name: 'niri', found: true },
      { name: 'tesseract', found: true },
    ],
    noCapture: false,
    path: 'grim',
  })
  silent(ran)
})

test('a command beats grim, without running the command', () => {
  const { path, ran } = shims('grim', 'niri', 'tesseract')
  expect(captureStatus({ command: 'shot {out}', env: env(path) }).path).toBe('command')
  silent(ran)
})

test('TLI_NO_CAPTURE turns every picture off, whatever is on the PATH', () => {
  const { path, ran } = shims('grim', 'niri', 'tesseract')
  const status = captureStatus({ command: 'shot {out}', env: env(path, { TLI_NO_CAPTURE: '1' }) })
  expect(status.noCapture).toBe(true)
  expect(status.path).toBe('none')
  silent(ran)
})

test('TLI_NO_CAPTURE set to nothing does not turn the pictures off', () => {
  const { path } = shims('grim')
  expect(captureStatus({ env: env(path, { TLI_NO_CAPTURE: '' }) }).noCapture).toBe(false)
})

test('without grim, Niri\'s own screenshot is the way only with the opt-in', () => {
  const withNiri = shims('niri')
  expect(captureStatus({ env: env(withNiri.path) }).path).toBe('none')
  expect(captureStatus({ env: env(withNiri.path, { TLI_NIRI_SCREENSHOT: '1' }) }).path).toBe('niri')
  expect(captureStatus({ niriScreenshot: true, env: env(withNiri.path) }).path).toBe('niri')
  expect(captureStatus({ niriScreenshot: true, env: env(withNiri.path, { TLI_NIRI_SCREENSHOT: '1' }) }).path).toBe('niri')
  expect(captureStatus({ niriScreenshot: false, env: env(withNiri.path, { TLI_NIRI_SCREENSHOT: '1' }) }).path).toBe('none')
  silent(withNiri.ran)
})

test('no tools on the PATH: no way to take a picture', () => {
  const { path, ran } = shims()
  const status = captureStatus({ env: env(path, { TLI_NIRI_SCREENSHOT: '1' }) })
  expect(status.tools).toEqual([
    { name: 'grim', found: false },
    { name: 'niri', found: false },
    { name: 'tesseract', found: false },
  ])
  expect(status.path).toBe('none')
  silent(ran)
})

test('niri without the opt-in and without grim is none, even with niri on the PATH', () => {
  const { path, ran } = shims('niri', 'tesseract')
  expect(captureStatus({ env: env(path) }).path).toBe('none')
  silent(ran)
})

test('the PATH shims are really the ones Bun.which finds (the test can see them)', () => {
  const { path, ran } = shims('grim')
  const status = captureStatus({ env: env(path) })
  expect(status.tools[0]).toEqual({ name: 'grim', found: true })
  expect(status.tools[1]).toEqual({ name: 'niri', found: false })
  silent(ran)
})

test('the environment defaults to the process\'s own', () => {
  const status = captureStatus()
  expect(status.noCapture).toBe(Boolean(process.env.TLI_NO_CAPTURE))
  expect(status.path === 'none' || status.path === 'grim' || status.path === 'niri' || status.path === 'command').toBe(true)
})

test('the ran marker really records an invocation (the test\'s own sanity)', () => {
  const { path, ran } = shims('grim')
  Bun.spawnSync(['sh', join(path, 'grim')])
  expect(readFileSync(ran, 'utf8')).toContain('grim')
})
