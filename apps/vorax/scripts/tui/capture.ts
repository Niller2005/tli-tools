// A picture of the game window on Linux. Default: Niri (`niri msg action screenshot-window --id N`, the window alone,
// even behind others, the clipboard untouched). Any other compositor: --capture-cmd 'cmd … {out}' writes a PNG of the
// game to {out}.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Img } from '@/reader/scan/pixels'
import { decodePng } from '../png'

export const STEAM_APP = '1974050'

export interface Capture {
  /** the capture's state for the header: which window, or why there is none */
  status(): string
  /** a picture of the game window; throws when there is none */
  grab(): Promise<Img>
  close(): void
}

const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

async function run(cmd: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe' })
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { ok: (await p.exited) === 0, out, err }
}

/** The file once the compositor has written all of it (niri answers before the PNG is on disk). */
async function readWhole(path: string): Promise<Buffer> {
  for (let i = 0; i < 150; i++) {
    if (existsSync(path)) {
      const b = readFileSync(path)
      if (b.length > 8 + IEND.length && b.subarray(b.length - IEND.length).equals(IEND)) return b
    }
    const { promise, resolve } = Promise.withResolvers<void>()
    setTimeout(resolve, 20)
    await promise
  }
  throw new Error('the screenshot never appeared')
}

export function createCapture(o: { title: RegExp; command?: string }): Capture {
  const dir = mkdtempSync(join(tmpdir(), 'vorax-'))
  let n = 0
  let state = 'looking for the game window'
  const nextPath = () => join(dir, `shot${++n}.png`)
  const finish = async (path: string) => {
    try { return decodePng(await readWhole(path)) } finally { rmSync(path, { force: true }) }
  }

  if (o.command) {
    return {
      status: () => state,
      async grab() {
        const out = nextPath()
        const r = await run(['sh', '-c', o.command!.split('{out}').join(JSON.stringify(out))])
        if (!r.ok) { state = 'capture command failed'; throw new Error(`capture command failed: ${r.err.trim() || 'no output'}`) }
        state = 'capture command'
        return finish(out)
      },
      close: () => rmSync(dir, { recursive: true, force: true }),
    }
  }

  interface Win { id: number; title: string | null; app_id: string | null; workspace_id: number; layout: { window_size: [number, number] } }
  const find = async (): Promise<Win> => {
    const r = await run(['niri', 'msg', '--json', 'windows'])
    if (!r.ok) throw new Error(`niri msg failed: ${r.err.trim() || 'is niri running?'}`)
    const all = JSON.parse(r.out) as Win[]
    const w = all.find(x => x.app_id === `steam_app_${STEAM_APP}`) ?? all.find(x => o.title.test(x.title ?? ''))
    if (!w) { state = 'game window not found: start Torchlight: Infinite'; throw new Error(state) }
    state = `window ${w.id} "${w.title}"`
    return w
  }
  const json = async (what: string) => JSON.parse((await run(['niri', 'msg', '--json', what])).out)
  // Niri sends a "Screenshot captured" notification for every screenshot-window and can't turn it off. A game that fills
  // its output and is its workspace's active window (a neighbour scrolled in beside it would be in the picture too)
  // is taken with grim instead (the whole output, silent).
  const filledOutput = async (w: Win): Promise<string | null> => {
    const ws = (await json('workspaces') as { id: number; output: string; is_active: boolean; active_window_id: number | null }[]).find(s => s.id === w.workspace_id && s.is_active && s.active_window_id === w.id)
    if (!ws) return null
    const l = ((await json('outputs')) as Record<string, { logical: { width: number; height: number } }>)[ws.output]?.logical
    return l && l.width === w.layout.window_size[0] && l.height === w.layout.window_size[1] ? ws.output : null
  }
  const grim = async (output: string) => {
    const p = Bun.spawn(['grim', '-l', '0', '-o', output, '-'], { stdout: 'pipe', stderr: 'pipe' })
    const [bytes, err] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text()])
    if ((await p.exited) !== 0) throw new Error(`grim failed: ${err.trim()}`)
    return decodePng(Buffer.from(bytes))
  }
  const niriShot = async (id: number) => {
    const out = nextPath()
    const r = await run(['niri', 'msg', 'action', 'screenshot-window', '--id', String(id), '--path', out])
    if (!r.ok) throw new Error(`niri screenshot failed: ${r.err.trim()}`)
    return finish(out)
  }
  return {
    status: () => state,
    async grab() {
      const w = await find()
      const output = Bun.which('grim') ? await filledOutput(w) : null
      if (output) {
        try { const img = await grim(output); state += ` (${img.width} x ${img.height}, silent)`; return img } catch { /* the Niri screenshot below */ }
      }
      return niriShot(w.id)
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}
