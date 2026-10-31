// A picture of the game window on Linux. Default: Niri (`niri msg action screenshot-window --id N`, the window alone,
// even behind others, the clipboard untouched). Any other compositor: a command that writes a PNG of the game to {out}.
//
// Niri sends a "Screenshot captured" notification for every `screenshot-window` and can't turn it off, so the picture is
// taken with `grim` whenever the game is on the screen: the whole output when the game fills it, and the part of the
// output the game is in otherwise. `TLI_NO_CAPTURE=1` turns every picture off, which is how the tests keep away from the
// player's own desktop.
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decodePngClamped, type Image } from '@tli/png'
import {
  grimGeometry,
  planCapture,
  type NiriOutput,
  type NiriWindow,
  type NiriWorkspace,
  type Plan,
} from './geometry'

export const STEAM_APP = '1974050'

export interface Capture {
  /** the capture's state for the header: which window, or why there is none */
  status(): string
  /** a picture of the game window; throws when there is none */
  grab(): Promise<Image<Uint8ClampedArray>>
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
  const dir = mkdtempSync(join(tmpdir(), 'tli-capture-'))
  let n = 0
  let state = 'looking for the game window'
  const nextPath = () => join(dir, `shot${++n}.png`)
  const finish = async (path: string) => {
    try { return decodePngClamped(await readWhole(path)) } finally { rmSync(path, { force: true }) }
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

  const niriJson = async (what: string): Promise<unknown> => {
    const r = await run(['niri', 'msg', '--json', what])
    if (!r.ok) throw new Error(`niri msg ${what} failed: ${r.err.trim() || 'is niri running?'}`)
    return JSON.parse(r.out)
  }
  const find = async (windows: NiriWindow[]): Promise<NiriWindow> => {
    const w = windows.find(x => x.app_id === `steam_app_${STEAM_APP}`) ?? windows.find(x => o.title.test(x.title ?? ''))
    if (!w) { state = 'game window not found: start Torchlight: Infinite'; throw new Error(state) }
    state = `window ${w.id} "${w.title ?? ''}"`
    return w
  }
  // The silent ways need the game to be on the screen, which needs the workspace
  // to be the active one on its output. Only then are the output and the
  // overview worth asking for.
  const plan = async (w: NiriWindow, windows: NiriWindow[]): Promise<Plan> => {
    const workspaces = (await niriJson('workspaces')) as NiriWorkspace[]
    const workspace = workspaces.find(s => s.id === w.workspace_id)
    if (!workspace || !workspace.is_active) return { kind: 'window' }
    const [outputs, overview] = await Promise.all([
      niriJson('outputs') as Promise<Record<string, NiriOutput>>,
      niriJson('overview-state') as Promise<{ is_open: boolean }>,
    ])
    return planCapture({ window: w, windows, workspaces, outputs, overviewOpen: overview.is_open })
  }
  const grim = async (args: string[]): Promise<Image<Uint8ClampedArray>> => {
    const p = Bun.spawn(['grim', '-l', '0', ...args, '-'], { stdout: 'pipe', stderr: 'pipe' })
    const [bytes, err] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text()])
    if ((await p.exited) !== 0) throw new Error(`grim failed: ${err.trim()}`)
    return decodePngClamped(Buffer.from(bytes))
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
      const windows = (await niriJson('windows')) as NiriWindow[]
      const w = await find(windows)
      if (Bun.which('grim')) {
        const p = await plan(w, windows)
        if (p.kind === 'output' || p.kind === 'region') {
          // grim takes the whole output, or the part of it the game is in. Its
          // region is in the layout's logical pixels, so grim scales it itself.
          const args = p.kind === 'output' ? ['-o', p.output] : ['-g', grimGeometry(p.region)]
          try {
            const img = await grim(args)
            state += ` (${img.width} x ${img.height}, silent)`
            return img
          } catch { /* the Niri screenshot below */ }
        }
      }
      return niriShot(w.id)
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}
