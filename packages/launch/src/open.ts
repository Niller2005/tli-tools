// Opening one of the tools in a window of its own.
//
// The tools are full-screen programs: the tracker cannot show one while it follows the log, so it
// opens a window for it and carries on.

import type { Launcher, OpenResult } from './launcher'
import { missing, type Tool } from './tools'

/** The flags the child needs from the parent. */
export function childFlags(tool: Tool, parentArgv: readonly string[]): string[] {
  const flags: string[] = []
  const log = parentArgv.find(argument => argument.startsWith('--log='))
  if (tool.readsLog === true && log !== undefined) flags.push(log)
  if (parentArgv.includes('--no-color')) flags.push('--no-color')
  return flags
}

/**
 * The environment the child gets from the parent.
 *
 * The colours stay off when they were off, and the path to the programs is the one of the
 * parent: a pane of a tmux session that was started long ago may have an old path.
 */
export function childEnv(
  parentEnv: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const env: Record<string, string> = {}
  const noColor = parentEnv.NO_COLOR
  if (noColor !== undefined) env.NO_COLOR = noColor
  const path = parentEnv.PATH
  if (path !== undefined) env.PATH = path
  return env
}

/** How a tool is opened. */
export interface OpenToolOptions {
  /** the arguments of the parent, whose flags the child gets */
  parentArgv?: readonly string[]
  /** the environment of the parent, whose environment the child gets */
  parentEnv?: Record<string, string | undefined>
  /** finds a program on PATH; the check for what the tool needs */
  which?: (program: string) => string | null
}

/** Opens a tool in a new window, and says what happened. */
export function openTool(
  launcher: Launcher,
  tool: Tool,
  options: OpenToolOptions = {},
): OpenResult {
  const parentArgv = options.parentArgv ?? []
  const gone = missing(tool, options.which)
  if (gone.length > 0) {
    return {
      ok: false,
      terminal: null,
      reason: 'failed',
      message: `${tool.name} needs ${gone.join(', ')}`,
    }
  }

  return launcher.open({
    key: tool.id,
    title: tool.name,
    cwd: tool.cwd,
    command: [...tool.command, ...childFlags(tool, parentArgv)],
    env: childEnv(options.parentEnv),
  })
}
