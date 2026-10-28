// Surface module: a row of cards, drawn as half blocks and animated here, that a
// click presses. A Raster takes no presses, so the cards are Text in a Client;
// a press goes to the hooks module as a post, { action }, or { rematch: true }.
// The card under the pointer lights up: hover is the module's own state.

import type { ClientModule } from 'claude-code'

import type { Action, Duel, Player } from '../types'
import { CARD_COLS, CARD_PX_H, FRAME_MS, REMATCH_COLS, drawCards, drawRematch } from './scene'

export type CardsProps =
  | { kind: 'cards'; actions: Action[]; player: Player | null; duel: Duel; pressable: Action[] }
  | { kind: 'rematch' }

type Run = { text: string; fg?: string; bg?: string }

const DEFAULT = 0x01000000
const hex = (c: number) => (c === DEFAULT ? undefined : `#${c.toString(16).padStart(6, '0')}`)

/** The pixels as rows of cells, two pixel rows a cell, joined into runs of one color pair. */
export function runs(px: Uint32Array, width: number): Run[][] {
  const out: Run[][] = []
  for (let r = 0; r < CARD_PX_H / 2; r++) {
    const row: Run[] = []
    for (let x = 0; x < width; x++) {
      const top = px[2 * r * width + x]!
      const bottom = px[(2 * r + 1) * width + x]!
      const cell: Run = top && bottom ? { text: '▀', fg: hex(top), bg: hex(bottom) } : top ? { text: '▀', fg: hex(top) } : bottom ? { text: '▄', fg: hex(bottom) } : { text: ' ' }
      const last = row.at(-1)
      if (last && last.fg === cell.fg && last.bg === cell.bg && last.text.at(-1) === cell.text) last.text += cell.text
      else row.push(cell)
    }
    out.push(row)
  }
  return out
}

/** The clock, moved on by the surface's frame clock, and the card under the pointer (-1: none). */
type State = { t: number; hover: number }

const Cards: ClientModule<CardsProps, State> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ t: Date.now(), hover: -1 })
    surface.every(FRAME_MS, () => {
      const st = surface.state ?? { t: Date.now(), hover: -1 }
      surface.setState({ ...st, t: st.t + FRAME_MS })
    })
  }
  const now = surface.state?.t ?? Date.now()
  const hover = surface.state?.hover ?? -1
  const rematch = props.kind === 'rematch'
  const width = rematch ? REMATCH_COLS : props.actions.length * CARD_COLS
  const px = rematch ? drawRematch(now, hover === 0) : drawCards(props.actions, props.player ?? undefined, now, { duel: props.duel }, hover)
  const cardAt = (x: number) => (rematch ? (x >= 0 && x < REMATCH_COLS ? 0 : -1) : Math.floor(x / CARD_COLS))
  surface.onPointer(e => {
    if (e.type === 'leave') {
      if (hover !== -1) surface.setState({ t: now, hover: -1 })
      return
    }
    if (e.type === 'move' || e.type === 'enter') {
      const i = cardAt(e.x)
      if (i !== hover) surface.setState({ t: now, hover: i })
      return
    }
    if (e.type !== 'down' || e.button !== 'left') return
    if (rematch) {
      if (cardAt(e.x) === 0) surface.post({ rematch: true })
      return
    }
    const a = props.actions[cardAt(e.x)]
    if (a && props.pressable.includes(a)) surface.post({ action: a })
  })
  return (
    <Box flexDirection="column">
      {runs(px, width).map(row => (
        <Text>
          {row.map(r => (
            <Text {...(r.fg ? { color: r.fg } : {})} {...(r.bg ? { backgroundColor: r.bg } : {})}>
              {r.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}

export default Cards
