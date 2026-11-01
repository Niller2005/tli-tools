// The modifiers on a map.
//
// When a map opens the game does two things. It applies each modifier of the map one by one:
//
//   [2026.10.31-02.21.38:964][701]TLGame: Display: [Game] UCLevelSingleton::AddMapModifier(5112006) success 2
//
// (the parser turns these into facts), and it dumps the list of the modifiers the player can read
// on the map, with the text of each:
//
//   [2026.10.31-02.21.38:969][701]TLLua: Display: [Game] AffixInfos
//   +BAffixInfoList+1+Description [<p>-30</p>% additional Physical Damage for you]
//   |              | +DangerNumbers
//   |              | +Tier [0]
//   |              | +Id [5112006]
//
// This file reads the dump, so an id the log applied can be shown by its words. Most ids of a map
// are the game's own plumbing and are never in the dump; they have no text and are not shown. Some
// entries of the dump are only a key of the game's text table (`affix_class|description|...`): the
// log does not say what they mean, so they are left out too.

/** One modifier the dump named: its id and what it says. */
export interface AffixText {
  id: number
  text: string
}

const RE_START = /\[Game\] AffixInfos\s*$/
const RE_TIMESTAMP = /^\[\d{4}\.\d\d\.\d\d-\d\d\.\d\d\.\d\d:\d{3}\]/
const RE_BLANK = /\[Game\]\s*$/
const RE_DESCRIPTION = /\+Description \[(.*)\]\s*$/
const RE_ID = /\+Id \[(\d+)\]\s*$/
const RE_KEY = /^\w+\|description\|/

/** The words of a modifier, without the game's markup: `<p>-30</p>% damage` is `-30% damage`. */
export function cleanDescription(text: string): string {
  return text
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Reads the dump of a map's modifiers out of the log, line by line. */
export class AffixDumpReader {
  private inside = false
  private text: string | null = null

  /** Takes one line of the log; gives the modifier the line finished, if it finished one. */
  feed(line: string): AffixText | null {
    if (!this.inside && !line.includes('AffixInfos')) return null
    if (RE_TIMESTAMP.test(line)) {
      if (RE_START.test(line)) {
        this.inside = true
        this.text = null
      } else if (this.inside && !RE_BLANK.test(line)) {
        // the dump is the lines that follow the one that opened it, until the game says anything else
        this.inside = false
        this.text = null
      }
      return null
    }
    if (!this.inside) return null

    const description = RE_DESCRIPTION.exec(line)
    if (description !== null) {
      this.text = cleanDescription(description[1] ?? '')
      return null
    }
    const id = RE_ID.exec(line)
    if (id !== null && this.text !== null) {
      const text = this.text
      this.text = null
      if (text === '' || RE_KEY.test(text)) return null
      return { id: Number(id[1]), text }
    }
    return null
  }
}
