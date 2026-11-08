// The cards as a page for an OBS browser source.
//
// The layer-shell overlay is a separate surface, so a PipeWire window capture of the game never has it in it.
// This serves the same cards (`readCards`) over HTTP on localhost: `/` is a transparent page that draws them,
// `/cards` is the JSON the page polls. In OBS: Sources, Browser, URL `http://127.0.0.1:<port>/?tool=tracker`.
import { overlayDir, readCards, type StoredCard } from './index'

export const OBS_PORT = 7391

/** The cards of the tools in `tools`, or all of them when none is named. */
export function cardsFor(cards: readonly StoredCard[], tools: readonly string[]): StoredCard[] {
  return tools.length === 0 ? [...cards] : cards.filter(c => tools.includes(c.tool))
}

const PAGE = `<!doctype html>
<meta charset="utf-8">
<title>Torchlight tools</title>
<style>
  html, body { margin: 0; background: transparent; font: 16px/1.3 sans-serif; color: #e6e6ef; }
  .card { display: inline-block; margin: 0 8px 8px 0; padding: 6px 10px; border-radius: 10px; background: rgba(16,16,24,.45);
          text-shadow: 0 1px 3px rgba(0,0,0,.95); vertical-align: top; }
  .title { font-size: 13px; color: #8b8fa3; }
  .head { font-size: 22px; font-weight: 700; }
  .basis { font-size: 14px; color: #aeb2c4; }
  .dim { color: #8b8fa3 } .accent { color: #5fd7ff } .gold { color: #ffd75f } .green { color: #7ee787 }
  .yellow { color: #f2cc60 } .red { color: #ff7b72 } .blue { color: #79c0ff } .purple { color: #d2a8ff }
  .orange { color: #ffa657 } .teal { color: #56d4c4 } .pink { color: #ff9bce } .bold { color: #fff }
</style>
<body></body>
<script>
  const tools = new URLSearchParams(location.search).get('tool') || ''
  const row = (cls, text) => { const d = document.createElement('div'); d.className = cls; d.textContent = text; return d }
  let shown = ''
  async function tick() {
    try {
      const text = await (await fetch('/cards?tool=' + encodeURIComponent(tools), { cache: 'no-store' })).text()
      if (text !== shown) {
        shown = text
        document.body.replaceChildren(...JSON.parse(text).map(card => {
          const el = document.createElement('div')
          el.className = 'card'
          el.append(row('title', card.title || ''), row('head ' + (card.headTone || 'green'), card.head || ''))
          if (card.basis) el.append(row('basis', card.basis))
          for (const line of card.lines || []) el.append(row('line ' + (line.tone || ''), line.text || ''))
          return el
        }))
      }
    } catch {}
    setTimeout(tick, 500)
  }
  tick()
</script>
`

/** Serves the page and the cards on 127.0.0.1 only. */
export function serveCards(port = OBS_PORT, dir = overlayDir()) {
  return Bun.serve({
    hostname: '127.0.0.1',
    port,
    fetch(req) {
      const url = new URL(req.url)
      if (url.pathname === '/cards') {
        const tools = (url.searchParams.get('tool') ?? '').split(',').filter(Boolean)
        return Response.json(cardsFor(readCards(dir), tools))
      }
      if (url.pathname === '/') return new Response(PAGE, { headers: { 'content-type': 'text/html; charset=utf-8' } })
      return new Response('not found', { status: 404 })
    },
  })
}
