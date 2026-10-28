// Surface module: a row of cards, drawn as half blocks and animated here, that a
// click presses. A Raster takes no presses, so the cards are Text in a Client;
// a press goes to the hooks module as a post, { action }.

import type { ClientModule } from 'claude-code'

import type { Action, Duel, Player } from '../types'
import { CARD_COLS, CARD_PX_H, FRAME_MS, drawCards, drawDraft } from './scene'

export type CardsProps =
  | { kind: 'cards'; actions: Action[]; player: Player | null; duel: Duel; loadout: Action[] | null; pressable: Action[] }
  | { kind: 'draft'; actions: Action[]; chosen: Action[]; cell: number }

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

const Cards: ClientModule<CardsProps, { t: number }> = (props, surface) => {
  const { Box, Text } = surface.elements
  if (surface.state === undefined) {
    surface.setState({ t: Date.now() })
    surface.every(FRAME_MS, () => surface.setState({ t: Date.now() }))
  }
  const now = Date.now()
  const cell = props.kind === 'draft' ? props.cell : CARD_COLS
  const width = props.actions.length * cell
  const px =
    props.kind === 'cards'
      ? drawCards(props.actions, props.player ?? undefined, now, { duel: props.duel, loadout: props.loadout })
      : drawDraft(props.actions, props.chosen, now, props.cell)
  surface.onPointer(e => {
    if (e.type !== 'down' || e.button !== 'left') return
    const a = props.actions[Math.floor(e.x / cell)]
    if (a && (props.kind === 'draft' || props.pressable.includes(a))) surface.post({ action: a })
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
