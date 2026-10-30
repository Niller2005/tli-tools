// A picture of the game to a Reading: the pixel scan (with the title bar / border cut off), then the cards' names by OCR.
// The same steps as the page's scanner (src/web/reader.ts), on this thread.
import data from '@/reader/scan/data.json'
import { unpack, type HandPhase, type PackedScanData } from '@/reader/scan/data'
import { readSlots } from '@/reader/scan/cards'
import { handLayout, layout } from '@/reader/scan/layout'
import { normalColours, readAreas } from '@/reader/scan/levels'
import normal from '@/reader/scan/levels.json'
import type { Img } from '@/reader/scan/pixels'
import { scan } from '@/reader/scan/scan'
import { readTitles, type PictureRead, type ReadText } from '@/reader/scan/titles'
import { windowedGame } from '@/reader/live/windowCrop'
import type { Reading } from '@/reader/types'
import { cropFromArea, cropRows, findChrome, hasCrop, type Crop } from '@/web/chrome'

const DATA = unpack(data as unknown as PackedScanData)
type Frame = Img & { data: Uint8ClampedArray }

// how sure a pixel reading is: the board's own fields that were read clearly
const sureness = (r: Reading) => (r.problems.some(p => p.kind === 'notFound') ? -1 : Object.entries(r.fields).filter(([k, f]) => /^(tank|round|refreshes|phase)/.test(k) && f.sure).length)

export function createReader(readText: ReadText) {
  // the title bar / border decision, kept per picture size (a window keeps its size)
  const crops = new Map<string, Crop>()

  const pixels = (img: Frame, trigger: string | undefined, pictures: boolean) => scan(img, DATA, {}, { pictures, thorough: trigger !== 'watch' })

  function frame(img: Frame, trigger: string | undefined): { img: Frame; base: Reading; crop: Crop } {
    const size = `${img.width}x${img.height}`
    const known = crops.get(size)
    if (known) { const c = cropRows(img, known) as Frame; return { img: c, base: pixels(c, trigger, false), crop: known } }
    const full = pixels(img, trigger, false)
    const seen = new Set<string>()
    const tries: Crop[] = []
    const titled = windowedGame(img)
    for (const c of [findChrome(img), titled ? cropFromArea(img, titled) : null]) if (c && hasCrop(c) && !seen.has(JSON.stringify(c))) { seen.add(JSON.stringify(c)); tries.push(c) }
    let best = { img, base: full, crop: { top: 0, bottom: 0 } as Crop, sure: sureness(full) }
    for (const c of tries) {
      const ci = cropRows(img, c) as Frame
      const r = pixels(ci, trigger, false)
      const sc = sureness(r)
      if (sc >= best.sure) best = { img: ci, base: r, crop: c, sure: sc }
    }
    if (!full.problems.some(p => p.kind === 'animating')) crops.set(size, best.crop)
    return { img: best.img, base: best.base, crop: best.crop }
  }

  return {
    /** skip: asked of the board's first reading; true leaves the cards unread (a picture that will be set aside) */
    async read(img: Frame, trigger?: string, skip?: (base: Reading) => boolean): Promise<Reading & { crop: Crop }> {
      const f = frame(img, trigger)
      if (skip?.(f.base)) return Object.assign(f.base, { crop: f.crop })
      const pictures = async (phase: HandPhase, size: number, which: number[]): Promise<Record<number, PictureRead>> => {
        // the colours the scan read them in (a capture with HDR or another gamma is corrected first)
        const ui = f.base.ui
        const norm = normalColours(f.img, normal, readAreas(layout(f.img, ui ?? 1))).img as Frame
        const { fields, problems, ranks } = readSlots(norm, handLayout(norm, ui, f.base.handShift), size, phase, which, DATA, {})
        return Object.fromEntries(which.map(j => [j, { ranks: ranks[j], field: fields[`hand${j}`], unknown: problems.some(p => p.kind === 'unknownArt' && p.field === `hand${j}`) }]))
      }
      const r = await readTitles(f.img, f.base, readText, pictures)
      return Object.assign(r, { crop: f.crop })
    },
  }
}
