#!/usr/bin/env bun
// Serves the overlay's cards as an OBS browser source.
//   bun run overlay:obs [-- --port=7391]
// then in OBS: Sources, Browser, URL http://127.0.0.1:7391/?tool=tracker (tools: tracker, vorax, warden; comma-separated)
import { OBS_PORT, serveCards } from '../src/obs'

const port = Number(process.argv.find(a => a.startsWith('--port='))?.slice(7) ?? OBS_PORT)
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('--port takes a number from 1 to 65535')
  process.exit(1)
}
const server = serveCards(port)
console.log(`OBS browser source URL: http://127.0.0.1:${server.port}/?tool=tracker`)
