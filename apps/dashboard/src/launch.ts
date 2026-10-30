// Starts the chosen tools. Two full-screen programs cannot share one terminal, so several tools run in tmux panes
// (a new window when already inside tmux, else a new session); a single tool simply takes over this terminal.
import type { Tool } from './tools'

const sh = (t: Tool) => `cd ${q(t.cwd)} && ${t.command.map(q).join(' ')}; echo; read -n1 -s -p "${t.name} exited, press a key"`
const q = (s: string) => `'${s.replaceAll("'", `'\\''`)}'`

async function tmux(...args: string[]): Promise<string> {
  const p = Bun.spawn(['tmux', ...args], { stdin: 'inherit', stdout: 'pipe', stderr: 'inherit' })
  const out = await new Response(p.stdout).text()
  if ((await p.exited) !== 0) throw new Error(`tmux ${args[0]} failed`)
  return out.trim()
}

/** Resolves when the tools are started (tmux) or finished (single tool). */
export async function launch(tools: Tool[]): Promise<void> {
  if (tools.length === 1) {
    const t = tools[0]
    const p = Bun.spawn(t.command, { cwd: t.cwd, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' })
    await p.exited
    return
  }
  if (Bun.which('tmux') === null) throw new Error('Running several tools at once needs tmux; select one tool instead.')
  const inside = !!process.env.TMUX
  const [first, ...rest] = tools
  // a window id (@N) names the window wherever it lives, so the splits below cannot land elsewhere
  const window = inside
    ? await tmux('new-window', '-P', '-F', '#{window_id}', '-n', 'tli', sh(first))
    : await tmux('new-session', '-d', '-P', '-F', '#{window_id}', '-s', `tli-${Date.now()}`, '-n', 'tli', sh(first))
  for (const t of rest) await tmux('split-window', '-t', window, sh(t))
  await tmux('select-layout', '-t', window, 'tiled')
  if (!inside) await tmux('attach-session', '-t', window)
}
