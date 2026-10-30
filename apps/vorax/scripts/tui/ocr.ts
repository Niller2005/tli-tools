// The cards' printed names, read by the tesseract program (the browser uses tesseract.js, the Windows app Windows' own reader).
import type { ReadText } from '@/reader/scan/titles'
import { encodePng } from '../png'

export const tesseractFound = () => Bun.which('tesseract') !== null

export const readWithTesseract: ReadText = async img => {
  // one thread per run: the title crops are small and several are read at once
  const p = Bun.spawn(['tesseract', 'stdin', 'stdout', '--psm', '6', '-l', 'eng'], {
    stdin: new Blob([encodePng(img)]), stdout: 'pipe', stderr: 'ignore', env: { ...process.env, OMP_THREAD_LIMIT: '1' },
  })
  const text = await new Response(p.stdout).text()
  await p.exited
  return text
}
