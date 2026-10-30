//! The text helpers of js/engine.js (an, plural, tierName, cellLabel,
//! describe, toolName) with the in-game names from the data.

import { RAINBOW, beastIndex, cardFromKey, cardIndex, data, giftFromKey, giftIndex, toolFromKey, toolIndex } from './data'
import type { Inmate } from './state'

/** an: "an" before a vowel, else "a". */
export function an(text: string): string {
  const first = text.charAt(0)
  const vowel = first !== '' && 'AEIOUaeiou'.includes(first)
  return `${vowel ? 'an' : 'a'} ${text}`
}

/** plural: "1 cell", "2 cells". */
export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** The name of a rarity tier. */
export function tierName(tier: number): string {
  return data().tierNames[Math.min(Math.max(tier, 0), RAINBOW)]
}

/** cellLabel: cell 0 is "01". */
export function cellLabel(n: number): string {
  return String(n + 1).padStart(2, '0')
}

/** "cell 04", "cells 04 and 08", "cells 04, 08 and 14", or "none". */
export function cellList(cells: number[]): string {
  const labels = cells.map(cellLabel)
  if (labels.length === 0) return 'none'
  if (labels.length === 1) return `cell ${labels[0]}`
  return `cells ${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`
}

/** The name of an inmate: its rarity and its species. */
export function describe(inmate: Inmate): string {
  return `${tierName(inmate.tier)} ${data().beastNames[beastIndex(inmate.beast)]}`
}

/** toolName: the name of whatever a pending choice offers by key (an
 * instrument, a gift or a card), or the key itself. */
export function toolName(key: string): string {
  const d = data()
  const tool = toolFromKey(key)
  if (tool !== null) return d.toolNames[toolIndex(tool)]
  const gift = giftFromKey(key)
  if (gift !== null) return d.giftNames[giftIndex(gift)]
  const card = cardFromKey(key)
  if (card !== null) return d.cardNames[cardIndex(card)]
  return key
}

/** The name of a Prison Incident. */
export function incidentName(id: number): string {
  return data().incident(id).name
}
