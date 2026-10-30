// The cards' printed names, read by the tesseract program (the browser uses tesseract.js, the Windows app Windows' own reader).
import type { ReadText } from '@/reader/scan/titles'
import { encodePng } from '@tli/png'
import { runTesseract } from '@tli/ocr'

export const readWithTesseract: ReadText = async img => (await runTesseract(encodePng(img))).out
