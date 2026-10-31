import { describe, expect, test } from 'bun:test'
import {
  grimGeometry,
  planCapture,
  type NiriOutput,
  type NiriWindow,
  type NiriWorkspace,
} from '../src/geometry'

const output = (logical: Partial<NiriOutput['logical']> = {}): NiriOutput => ({
  logical: { x: 0, y: 0, width: 2560, height: 1440, scale: 1, ...logical },
})

interface WindowSpec {
  id?: number
  title?: string
  floating?: boolean
  focused?: boolean
  workspace?: number
  size?: [number, number]
  offset?: [number, number]
  tile?: [number, number] | null
}

const win = (s: WindowSpec = {}): NiriWindow => ({
  id: s.id ?? 1,
  title: s.title ?? 'Torchlight: Infinite',
  app_id: 'steam_app_1974050',
  workspace_id: s.workspace ?? 2,
  is_focused: s.focused ?? false,
  is_floating: s.floating ?? false,
  layout: {
    window_size: s.size ?? [2560, 1440],
    window_offset_in_tile: s.offset ?? [0, 0],
    tile_pos_in_workspace_view: s.tile === undefined ? null : s.tile,
  },
})

const workspace = (s: Partial<NiriWorkspace> = {}): NiriWorkspace => ({
  id: 2,
  output: 'DP-1',
  is_active: true,
  active_window_id: 1,
  ...s,
})

const plan = (o: {
  window?: NiriWindow
  windows?: NiriWindow[]
  workspaces?: NiriWorkspace[]
  outputs?: Record<string, NiriOutput | undefined>
  overviewOpen?: boolean
}) =>
  planCapture({
    window: o.window ?? win(),
    windows: o.windows ?? [win()],
    workspaces: o.workspaces ?? [workspace()],
    outputs: o.outputs ?? { 'DP-1': output() },
    overviewOpen: o.overviewOpen ?? false,
  })

describe('a game that fills its output', () => {
  test('is taken with the whole output', () => {
    expect(plan({})).toEqual({ kind: 'output', output: 'DP-1' })
  })

  test('is taken with the whole output when Niri says where it is', () => {
    expect(plan({ window: win({ tile: [0, 0] }) })).toEqual({ kind: 'output', output: 'DP-1' })
  })

  test('is not taken silently when another window floats over it', () => {
    const windows = [win(), win({ id: 2, floating: true, tile: [0, 0], size: [2560, 1440] })]
    expect(plan({ windows })).toEqual({ kind: 'window' })
  })
})

describe('a game that does not fill its output', () => {
  test('is taken with the part of the output it is in', () => {
    const game = win({ size: [1280, 720], tile: [100, 200] })
    expect(plan({ window: game })).toEqual({
      kind: 'region',
      output: 'DP-1',
      region: { x: 100, y: 200, width: 1280, height: 720 },
    })
  })

  test('is taken with the window inside its tile', () => {
    const game = win({ size: [1280, 720], tile: [100, 200], offset: [4, 8] })
    expect(plan({ window: game })).toEqual({
      kind: 'region',
      output: 'DP-1',
      region: { x: 104, y: 208, width: 1280, height: 720 },
    })
  })

  test('is taken with the picture of Niri when Niri does not say where it is', () => {
    const game = win({ size: [1280, 720] })
    expect(plan({ window: game })).toEqual({ kind: 'window' })
  })

  test('is taken with the picture of Niri when the workspace is not on the screen', () => {
    const game = win({ size: [1280, 720], tile: [100, 200] })
    expect(plan({ window: game, workspaces: [workspace({ is_active: false })] })).toEqual({ kind: 'window' })
  })

  test('is taken with the picture of Niri when the overview is open', () => {
    const game = win({ size: [1280, 720], tile: [100, 200] })
    expect(plan({ window: game, overviewOpen: true })).toEqual({ kind: 'window' })
  })

  test('is cut off at the edge of the output', () => {
    const game = win({ size: [1280, 720], tile: [-200, 0] })
    expect(plan({ window: game })).toEqual({
      kind: 'region',
      output: 'DP-1',
      region: { x: 0, y: 0, width: 1080, height: 720 },
    })
  })

  test('is taken with the picture of Niri when it is off the output', () => {
    const game = win({ size: [1280, 720], tile: [3000, 0] })
    expect(plan({ window: game })).toEqual({ kind: 'window' })
  })
})

describe('a floating window', () => {
  test('over the game hides it, so the picture of Niri is used', () => {
    const game = win({ size: [1280, 720], tile: [100, 200] })
    const over = win({ id: 2, floating: true, size: [640, 480], tile: [200, 300] })
    expect(plan({ window: game, windows: [game, over] })).toEqual({ kind: 'window' })
  })

  test('beside the game does not hide it', () => {
    const game = win({ size: [1280, 720], tile: [100, 200] })
    const beside = win({ id: 2, floating: true, size: [640, 480], tile: [1600, 300] })
    expect(plan({ window: game, windows: [game, beside] })).toEqual({
      kind: 'region',
      output: 'DP-1',
      region: { x: 100, y: 200, width: 1280, height: 720 },
    })
  })

  test('on another workspace does not hide it', () => {
    const game = win({ size: [1280, 720], tile: [100, 200] })
    const over = win({ id: 2, floating: true, workspace: 5, size: [640, 480], tile: [200, 300] })
    expect(plan({ window: game, windows: [game, over] })).toEqual({
      kind: 'region',
      output: 'DP-1',
      region: { x: 100, y: 200, width: 1280, height: 720 },
    })
  })

  test('under the focused game window does not hide it', () => {
    const game = win({ floating: true, focused: true, size: [1280, 720], tile: [100, 200] })
    const under = win({ id: 2, floating: true, size: [640, 480], tile: [200, 300] })
    expect(plan({ window: game, windows: [game, under] })).toEqual({
      kind: 'region',
      output: 'DP-1',
      region: { x: 100, y: 200, width: 1280, height: 720 },
    })
  })

  test('over a game that is not focused hides it', () => {
    const game = win({ floating: true, focused: false, size: [1280, 720], tile: [100, 200] })
    const over = win({ id: 2, floating: true, focused: true, size: [640, 480], tile: [200, 300] })
    expect(plan({ window: game, windows: [game, over] })).toEqual({ kind: 'window' })
  })
})

describe('a scaled output', () => {
  test('keeps the region in logical pixels, so grim scales it', () => {
    const game = win({ size: [1280, 720], tile: [100, 200] })
    const outputs = { 'DP-1': output({ scale: 1.25 }) }
    expect(plan({ window: game, outputs })).toEqual({
      kind: 'region',
      output: 'DP-1',
      region: { x: 100, y: 200, width: 1280, height: 720 },
    })
  })

  test('takes the whole output when the game fills it', () => {
    const outputs = { 'DP-1': output({ scale: 1.25 }) }
    expect(plan({ outputs })).toEqual({ kind: 'output', output: 'DP-1' })
  })
})

describe('an output that is not the first one', () => {
  test('keeps the position in the layout', () => {
    const game = win({ size: [1280, 720], tile: [-2460, 200] })
    const outputs = { 'DP-2': output({ x: -2560, y: 0 }) }
    expect(plan({ window: game, outputs, workspaces: [workspace({ output: 'DP-2' })] })).toEqual({
      kind: 'region',
      output: 'DP-2',
      region: { x: -2460, y: 200, width: 1280, height: 720 },
    })
  })
})

describe("grim's geometry", () => {
  test('is whole logical pixels', () => {
    expect(grimGeometry({ x: 100.5, y: 200.2, width: 1280.4, height: 720.6 })).toBe('100,200 1281x721')
  })

  test('keeps a negative position', () => {
    expect(grimGeometry({ x: -2460, y: 0, width: 1280, height: 720 })).toBe('-2460,0 1280x720')
  })
})
