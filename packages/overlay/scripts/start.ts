#!/usr/bin/env bun
// Starts the overlay (gtk/overlay.py) with libgtk4-layer-shell loaded first, which the layer surface needs.
//   bun run overlay [-- --output=DP-1 --left=24 --top=420 --right --width=38 --opacity=0.86]
import { join } from 'node:path'
import { layerShellLib } from '../src'

const lib = layerShellLib()
if (!lib) {
  console.error('gtk4-layer-shell was not found (Arch: pacman -S gtk4-layer-shell; also needs python-gobject).')
  process.exit(1)
}
const args = process.argv.slice(2)
const p = Bun.spawn(['python3', join(import.meta.dir, '..', 'gtk', 'overlay.py'), ...args], {
  stdio: ['inherit', 'inherit', 'inherit'],
  env: { ...process.env, LD_PRELOAD: [lib, process.env.LD_PRELOAD].filter(Boolean).join(':') },
})
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => p.kill())
process.exit(await p.exited)
