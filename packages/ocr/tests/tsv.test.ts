import { describe, expect, test } from 'bun:test'
import { parseTsv } from '../src/index'

const HEADER = 'level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext'

/** One TSV row: level, block, paragraph, line, then the word's box, confidence and text. */
function row(
  level: number | string,
  key: [number, number, number],
  box: [number, number, number, number],
  conf: number | string,
  text: string,
): string {
  return [level, 1, key[0], key[1], key[2], 1, ...box, conf, text].join('\t')
}

const tsv = (...rows: string[]): string => [HEADER, ...rows].join('\n')

describe('parseTsv', () => {
  test('empty input and a header alone give no lines', () => {
    expect(parseTsv('')).toEqual([])
    expect(parseTsv(HEADER)).toEqual([])
    expect(parseTsv(`${HEADER}\n`)).toEqual([])
  })

  test('words of one line join with a space and the line box covers them all', () => {
    const lines = parseTsv(tsv(row(5, [1, 1, 1], [10, 20, 30, 12], 90, 'Fire'), row(5, [1, 1, 1], [50, 22, 40, 14], 88, 'Burst')))
    expect(lines).toEqual([{ text: 'Fire Burst', rect: [10, 20, 80, 16] }])
  })

  test('a different block, paragraph or line starts a new line', () => {
    const lines = parseTsv(
      tsv(
        row(5, [1, 1, 1], [0, 0, 10, 10], 90, 'a'),
        row(5, [1, 1, 2], [12, 0, 10, 10], 90, 'b'),
        row(5, [1, 2, 2], [24, 0, 10, 10], 90, 'c'),
        row(5, [2, 2, 2], [36, 0, 10, 10], 90, 'd'),
      ),
    )
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c', 'd'])
  })

  test('only word rows (level 5) are read', () => {
    const lines = parseTsv(
      tsv(
        row(1, [0, 0, 0], [0, 0, 100, 100], -1, ''),
        row(2, [1, 0, 0], [0, 0, 100, 100], -1, ''),
        row(4, [1, 1, 1], [0, 0, 100, 10], -1, 'line'),
        row(5, [1, 1, 1], [0, 0, 10, 10], 95, 'word'),
      ),
    )
    expect(lines).toEqual([{ text: 'word', rect: [0, 0, 10, 10] }])
  })

  test('words of negative confidence are dropped, zero is kept', () => {
    const lines = parseTsv(
      tsv(row(5, [1, 1, 1], [0, 0, 10, 10], -1, 'junk'), row(5, [1, 1, 2], [0, 20, 10, 10], 0, 'zero'), row(5, [1, 1, 3], [0, 40, 10, 10], 0.5, 'half')),
    )
    expect(lines.map((l) => l.text)).toEqual(['zero', 'half'])
  })

  test('a non-numeric confidence does not drop the word', () => {
    expect(parseTsv(tsv(row(5, [1, 1, 1], [0, 0, 10, 10], 'x', 'kept'))).map((l) => l.text)).toEqual(['kept'])
  })

  test('a dropped word does not split the line around it', () => {
    const lines = parseTsv(
      tsv(row(5, [1, 1, 1], [0, 0, 20, 10], 90, 'a'), row(5, [1, 1, 1], [25, 0, 20, 10], -1, 'junk'), row(5, [1, 1, 1], [40, 0, 20, 10], 90, 'b')),
    )
    expect(lines).toEqual([{ text: 'a b', rect: [0, 0, 60, 10] }])
  })

  test('blank and whitespace-only text is skipped; text is trimmed', () => {
    const lines = parseTsv(
      tsv(row(5, [1, 1, 1], [0, 0, 10, 10], 90, '   '), row(5, [1, 1, 1], [0, 0, 10, 10], 90, ''), row(5, [1, 1, 1], [0, 0, 10, 10], 90, '  Hi \r')),
    )
    expect(lines).toEqual([{ text: 'Hi', rect: [0, 0, 10, 10] }])
  })

  test('garbage, short and blank lines are ignored without throwing', () => {
    const rows = ['', 'not a tsv line', '5\t1\t1', row(5, [1, 1, 1], [0, 0, 10, 10], 90, 'ok').split('\t').slice(0, 11).join('\t'), '\t\t\t', row(5, [1, 1, 1], [0, 0, 10, 10], 90, 'ok')]
    expect(parseTsv(tsv(...rows))).toEqual([{ text: 'ok', rect: [0, 0, 10, 10] }])
  })

  test('the first line is always taken as the header', () => {
    expect(parseTsv(row(5, [1, 1, 1], [0, 0, 10, 10], 90, 'first'))).toEqual([])
  })

  test('non-numeric box fields count as zero', () => {
    const r = ['5', '1', '1', '1', '1', '1', 'a', 'b', '10', 'c', '90', 'w'].join('\t')
    expect(parseTsv(tsv(r))).toEqual([{ text: 'w', rect: [0, 0, 10, 0] }])
  })

  test('words far apart in one row are separate lines, close ones join', () => {
    // Height 10: the gap limit is 2 * max(10, 12) = 24 pixels.
    const joined = parseTsv(tsv(row(5, [1, 1, 1], [0, 0, 10, 10], 90, 'a'), row(5, [1, 1, 1], [34, 0, 10, 10], 90, 'b')))
    expect(joined.map((l) => l.text)).toEqual(['a b'])
    const split = parseTsv(tsv(row(5, [1, 1, 1], [0, 0, 10, 10], 90, 'a'), row(5, [1, 1, 1], [35, 0, 10, 10], 90, 'b')))
    expect(split.map((l) => l.text)).toEqual(['a', 'b'])
  })

  test('the gap limit grows with a tall word', () => {
    // Height 30: the limit is 60 pixels, so a 50 pixel gap still joins.
    const lines = parseTsv(tsv(row(5, [1, 1, 1], [0, 0, 10, 30], 90, 'a'), row(5, [1, 1, 1], [60, 0, 10, 30], 90, 'b')))
    expect(lines.map((l) => l.text)).toEqual(['a b'])
  })

  test('a word left of the line grows the box to the left', () => {
    const lines = parseTsv(tsv(row(5, [1, 1, 1], [40, 10, 10, 10], 90, 'b'), row(5, [1, 1, 1], [30, 5, 5, 20], 90, 'a')))
    expect(lines).toEqual([{ text: 'b a', rect: [30, 5, 20, 20] }])
  })

  test('words are joined only to the line directly before them', () => {
    const lines = parseTsv(
      tsv(row(5, [1, 1, 1], [0, 0, 10, 10], 90, 'a'), row(5, [1, 1, 2], [0, 20, 10, 10], 90, 'b'), row(5, [1, 1, 1], [12, 0, 10, 10], 90, 'c')),
    )
    expect(lines.map((l) => l.text)).toEqual(['a', 'b', 'c'])
  })

  test('tabs in the text field are not part of it; quotes pass through', () => {
    const r = row(5, [1, 1, 1], [0, 0, 10, 10], 90, '"Fire"\textra')
    expect(parseTsv(tsv(r))[0].text).toBe('"Fire"')
  })

  test('CRLF line endings leave the text clean', () => {
    const text = [HEADER, row(5, [1, 1, 1], [0, 0, 10, 10], 90, 'Hi')].join('\r\n')
    expect(parseTsv(text)).toEqual([{ text: 'Hi', rect: [0, 0, 10, 10] }])
  })
})
