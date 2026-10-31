import { afterEach, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { liveNiriSocket, niriScreenshotEnabled } from '../src/index'

const dirs: string[] = []
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function runtime(...names: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'niri-'))
  dirs.push(dir)
  for (const n of names) writeFileSync(join(dir, n), '')
  return dir
}

test('a stale NIRI_SOCKET (its process is gone) is replaced by the socket of the live niri', () => {
  const dir = runtime('niri.wayland-1.999999999.sock', `niri.wayland-1.${process.pid}.sock`)
  const stale = join(dir, 'niri.wayland-1.999999999.sock')
  expect(liveNiriSocket({ NIRI_SOCKET: stale, XDG_RUNTIME_DIR: dir })).toBe(join(dir, `niri.wayland-1.${process.pid}.sock`))
})

test('a NIRI_SOCKET of a live process is kept', () => {
  const dir = runtime(`niri.wayland-1.${process.pid}.sock`)
  const mine = join(dir, `niri.wayland-1.${process.pid}.sock`)
  expect(liveNiriSocket({ NIRI_SOCKET: mine, XDG_RUNTIME_DIR: dir })).toBe(mine)
})

test('without NIRI_SOCKET the live socket in the runtime dir is found', () => {
  const dir = runtime('niri.wayland-1.999999999.sock', `niri.wayland-1.${process.pid}.sock`)
  expect(liveNiriSocket({ XDG_RUNTIME_DIR: dir })).toBe(join(dir, `niri.wayland-1.${process.pid}.sock`))
})

test("Niri's window screenshot needs an explicit opt-in", () => {
  expect(niriScreenshotEnabled(undefined, {})).toBe(false)
  expect(niriScreenshotEnabled(undefined, { TLI_NIRI_SCREENSHOT: '1' })).toBe(true)
  expect(niriScreenshotEnabled(true, {})).toBe(true)
  expect(niriScreenshotEnabled(false, { TLI_NIRI_SCREENSHOT: '1' })).toBe(false)
})
