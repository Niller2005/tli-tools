// The exchange (交易行): what an item sells for.
//
// The game sends a search request and gets a list of prices back, each in its own block of lines:
//
//   ----Socket SendMessage STT----XchgSearchPrice----SynId = 3720
//   +filters+1+key [4]
//   |       | +refer [8312]
//   +typ3 [58]
//   ----Socket SendMessage End----
//   ...
//   ----Socket RecvMessage STT----XchgSearchPrice----SynId = 3720
//   +prices+1+currency [100300]
//   |      | +unitPrices+1 [5.0]
//   |      | |          +2 [5.0]
//   ...
//   +errCode
//   +itemGoldId [8312]
//   ----Socket RecvMessage End----
//
// `refer` in the request and `itemGoldId` in the answer are the item's config id; `currency` is the
// currency the prices are in (100300 is Flame Elementium, the game's FE).

/** What one search of the exchange found. */
export interface Quote {
  /** the item that was searched for */
  item: number
  /** the prices of the listings, in FE, low to high */
  prices: number[]
}

const RE_SEND = /----Socket SendMessage STT----XchgSearchPrice----SynId = (\d+)/
const RE_RECV = /----Socket RecvMessage STT----XchgSearchPrice----SynId = (\d+)/
const RE_SEND_END = /----Socket SendMessage End----/
const RE_RECV_END = /----Socket RecvMessage End----/
const RE_REFER = /\+refer \[(\d+)\]/
const RE_ITEM_GOLD = /\+itemGoldId \[(\d+)\]/
const RE_CURRENCY = /\+currency \[(\d+)\]/
const RE_PRICE = /\+(?:unitPrices\+)?\d+ \[([0-9.]+)\]/g
const RE_PRICES_SECTION = /\+prices\+\d+/

/** Flame Elementium, the currency the exchange prices things in. */
export const FE_ITEM = 100300

/** Reads the exchange's blocks of lines and gives back what each search found. */
export class ExchangeParser {
  private mode: 'idle' | 'send' | 'recv' = 'idle'
  private body: string[] = []
  private synId = ''
  /** The item each recent request asked for, by SynId: some answers (currency, materials) don't name the item. */
  private readonly asked = new Map<string, number>()

  /** A line of the log; a quote when the line finished an answer. */
  feed(line: string): Quote | null {
    const send = RE_SEND.exec(line)
    if (send !== null) {
      this.mode = 'send'
      this.synId = send[1]
      this.body = []
      return null
    }
    const recv = RE_RECV.exec(line)
    if (recv !== null) {
      this.mode = 'recv'
      this.synId = recv[1]
      this.body = []
      return null
    }
    if (this.mode === 'send' && RE_SEND_END.test(line)) {
      const item = parseRequest(this.body.join('\n'))
      if (item !== null && item !== 0) {
        this.asked.set(this.synId, item)
        if (this.asked.size > 32) this.asked.delete(this.asked.keys().next().value as string)
      }
      this.mode = 'idle'
      this.body = []
      return null
    }
    if (this.mode === 'recv' && RE_RECV_END.test(line)) {
      const body = this.body.join('\n')
      const asked = this.asked.get(this.synId) ?? null
      this.asked.delete(this.synId)
      this.mode = 'idle'
      this.body = []
      return parseQuote(body, asked)
    }
    if (this.mode !== 'idle') this.body.push(line)
    return null
  }

  /** Whether the parser is in the middle of a block. */
  get busy(): boolean {
    return this.mode !== 'idle'
  }
}

/** The item and the prices in the body of an answer; `asked` is the item the request named, for answers that don't. */
export function parseQuote(body: string, asked: number | null = null): Quote | null {
  const named = RE_ITEM_GOLD.exec(body)
  const item = named !== null ? +named[1] : asked
  if (item === null) return null

  // The body holds one or more price sections, each with its own currency.
  const sections = body.split(RE_PRICES_SECTION).slice(1)
  const prices: number[] = []
  let found = false
  for (const section of sections) {
    const currency = RE_CURRENCY.exec(section)
    if (currency === null || +currency[1] !== FE_ITEM) continue
    found = true
    for (const m of section.matchAll(RE_PRICE)) prices.push(Number(m[1]))
  }
  if (!found || prices.length === 0) return null
  return { item, prices }
}

/** The item a search asked for, from the body of a request. */
export function parseRequest(body: string): number | null {
  const m = RE_REFER.exec(body)
  return m === null ? null : +m[1]
}
