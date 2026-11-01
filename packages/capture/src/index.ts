// A picture of the game window on Linux. Niri (`niri msg action screenshot-window --id N`) can take
// the window alone, but announces every picture with a "Screenshot captured" notification that cannot
// be turned off. The default therefore uses only silent `grim` paths: the whole output when the game
// fills it, and the part of the output the game is in otherwise. Any other compositor: a command that
// writes a PNG of the game to {out}.
//
// Niri's window screenshot needs an explicit opt-in, through `niriScreenshot: true` or
// `TLI_NIRI_SCREENSHOT=1`. `TLI_NO_CAPTURE=1` turns every picture off, which is how the tests keep
// away from the player's own desktop.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
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
import { ppmToRgba } from './ppm'

export const STEAM_APP = '1974050'

export interface GrabOptions {
  /** take the picture now, even after an earlier attempt was backed off */
  force?: boolean
}

export interface Capture {
  /** the capture's state for the header: which window, or why there is none */
  status(): string
  /** a picture of the game window; throws when there is none */
  grab(options?: GrabOptions): Promise<Image<Uint8ClampedArray>>
  close(): void
}

const IEND = Buffer.from([0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82])

/** How long a failed capture waits before it looks at the screen again. */
const BACKOFF_MS = 2000

/**
 * The socket of the niri that is running. A shell that outlives its niri session (a tmux server started
 * before the last login) keeps an old NIRI_SOCKET, and `niri msg` then fails with "error connecting to the
 * niri socket". The sockets are named niri.<display>.<pid>.sock: the one of a live process is the right one.
 */
export function liveNiriSocket(env: Record<string, string | undefined> = process.env): string | undefined {
  const alive = (sock: string): boolean => {
    const pid = /\.(\d+)\.sock$/.exec(sock)?.[1]
    return pid !== undefined && existsSync(`/proc/${pid}`)
  }
  const given = env.NIRI_SOCKET
  if (given !== undefined && (alive(given) || !/\.\d+\.sock$/.test(given))) return given
  const dir = env.XDG_RUNTIME_DIR
  if (dir === undefined) return given
  try {
    const found = readdirSync(dir)
      .filter(name => /^niri\..+\.\d+\.sock$/.test(name))
      .map(name => join(dir, name))
      .filter(alive)
    return found.sort().at(-1) ?? given
  } catch { return given }
}

async function run(cmd: string[]): Promise<{ ok: boolean; out: string; err: string }> {
  const socket = liveNiriSocket()
  const p = Bun.spawn(cmd, { stdout: 'pipe', stderr: 'pipe', env: socket === undefined ? process.env : { ...process.env, NIRI_SOCKET: socket } })
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

/**
 * Whether Niri's announced window screenshot may be used.
 *
 * The option is the per-capture choice; when it is absent the environment decides. An explicit
 * `false` always wins, so a caller can keep a process-wide opt-in from reaching it.
 */
export function niriScreenshotEnabled(
  option?: boolean,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return option ?? env.TLI_NIRI_SCREENSHOT === '1'
}

export function createCapture(o: { title: RegExp; command?: string; niriScreenshot?: boolean }): Capture {
  const allowNiriScreenshot = niriScreenshotEnabled(o.niriScreenshot)
  // The tests run where the player is: no picture at all, and nothing is run.
  if (process.env.TLI_NO_CAPTURE) {
    return {
      status: () => 'capture disabled (TLI_NO_CAPTURE)',
      async grab() {
        throw new Error('capture disabled')
      },
      close: () => {},
    }
  }

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
  // to be the active one on its output.
  const plan = async (w: NiriWindow, windows: NiriWindow[]): Promise<Plan> => {
    const workspaces = (await niriJson('workspaces')) as NiriWorkspace[]
    const [outputs, overview] = await Promise.all([
      niriJson('outputs') as Promise<Record<string, NiriOutput>>,
      // An older niri cannot say whether the overview is open: the picture is
      // then taken as if it were closed.
      niriJson('overview-state').catch(() => ({ is_open: false })) as Promise<{ is_open: boolean }>,
    ])
    return planCapture({
      window: w,
      windows,
      workspaces,
      outputs,
      overviewOpen: overview.is_open,
      niriScreenshot: allowNiriScreenshot,
    })
  }
  const grim = async (args: string[]): Promise<Image<Uint8ClampedArray>> => {
    // grim writes the pixels as they are, in a PPM: there is no PNG to
    // decode, which is the dearest part of a capture.
    const p = Bun.spawn(['grim', '-t', 'ppm', ...args, '-'], { stdout: 'pipe', stderr: 'pipe' })
    const [bytes, err] = await Promise.all([new Response(p.stdout).arrayBuffer(), new Response(p.stderr).text()])
    if ((await p.exited) !== 0) throw new Error(`grim failed: ${err.trim()}`)
    const raw = Buffer.from(bytes)
    const img = ppmToRgba(raw)
    // A grim without the PPM format writes a PNG.
    return img ?? decodePngClamped(raw)
  }
  const niriShot = async (id: number) => {
    const out = nextPath()
    const r = await run(['niri', 'msg', 'action', 'screenshot-window', '--id', String(id), '--path', out])
    if (!r.ok) throw new Error(`niri screenshot failed: ${r.err.trim()}`)
    return finish(out)
  }
  let retryAt = 0
  let lastFailure = ''
  return {
    status: () => state,
    async grab(options: GrabOptions = {}) {
      if (options.force !== true && Date.now() < retryAt) {
        state = lastFailure
        throw new Error(lastFailure)
      }
      try {
        const windows = (await niriJson('windows')) as NiriWindow[]
        const w = await find(windows)
        if (!Bun.which('grim')) {
          if (!allowNiriScreenshot) {
            throw new Error('grim is not installed; no picture taken so that niri does not notify')
          }
          const img = await niriShot(w.id)
          retryAt = 0
          lastFailure = ''
          return img
        }

        const p = await plan(w, windows)
        if (p.kind === 'none') {
          state = p.reason
          throw new Error(p.reason)
        }
        if (p.kind === 'output' || p.kind === 'region') {
          // grim takes the whole output, or the part of it the game is in. Its
          // region is in the layout's logical pixels, so grim scales it itself.
          const args = p.kind === 'output' ? ['-o', p.output] : ['-g', grimGeometry(p.region)]
          try {
            const img = await grim(args)
            state = `window ${w.id} "${w.title ?? ''}" (${img.width} x ${img.height}, silent)`
            retryAt = 0
            lastFailure = ''
            return img
          } catch (err) {
            if (!allowNiriScreenshot) {
              const detail = err instanceof Error ? err.message : String(err)
              throw new Error(`${detail}; no picture taken so that niri does not notify`)
            }
          }
        }
        const img = await niriShot(w.id)
        retryAt = 0
        lastFailure = ''
        return img
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        state = message
        lastFailure = message
        retryAt = Date.now() + BACKOFF_MS
        throw err instanceof Error ? err : new Error(message)
      }
    },
    close: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/* ---------- what a capture would do, without capturing ---------- */

/** What the dashboard asks about the capture: which tools are there, and what a capture would do. */
export interface CaptureStatus {
  /** the tools a capture needs, and whether each is on the PATH */
  tools: { name: string; found: boolean }[]
  /** whether `TLI_NO_CAPTURE` has turned every picture off */
  noCapture: boolean
  /** the way a capture would take its next picture: a `command` beats `grim`, `grim` beats Niri's announced one, `none` when there is no way */
  path: 'grim' | 'niri' | 'command' | 'none'
}

/** The options of `captureStatus`, the ones `createCapture` plans with. */
export interface CaptureStatusOptions {
  /** a shell command that writes a PNG of the game to `{out}` */
  command?: string
  /** Niri's announced window screenshot needs an explicit opt-in */
  niriScreenshot?: boolean
  /** the environment to read `TLI_NO_CAPTURE`, `TLI_NIRI_SCREENSHOT` and `PATH` from; defaults to the process's */
  env?: Record<string, string | undefined>
}

/**
 * What a capture would do right now, without taking any picture: whether the
 * tools are on the PATH, whether `TLI_NO_CAPTURE` has turned them all off, and
 * which way the planner would go. Nothing is run: neither Niri nor `grim` is
 * asked anything.
 */
export function captureStatus(o: CaptureStatusOptions = {}): CaptureStatus {
  const env = o.env ?? process.env
  const onPath = (name: string) => Bun.which(name, { PATH: env.PATH ?? process.env.PATH }) !== null
  const tools = [
    { name: 'grim', found: onPath('grim') },
    { name: 'niri', found: onPath('niri') },
    { name: 'tesseract', found: onPath('tesseract') },
  ]
  const noCapture = Boolean(env.TLI_NO_CAPTURE)
  let path: CaptureStatus['path'] = 'none'
  if (!noCapture) {
    if (o.command) path = 'command'
    else if (tools[0].found) path = 'grim'
    else if (tools[1].found && niriScreenshotEnabled(o.niriScreenshot, env)) path = 'niri'
  }
  return { tools, noCapture, path }
}
