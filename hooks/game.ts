// Host-authoritative duel, pure: the host alone applies intents and broadcasts
// numbered snapshots; guests send intents and keep the newest snapshot.
// Picks live in HostState.picks, never in the broadcast Duel, until a round resolves.

import type { Duel, Element } from '../types'

export const ELEMENTS: Element[] = ['fire', 'water', 'nature']
export const START_LIFE = 3

const BEATS: Record<Element, Element> = { water: 'fire', fire: 'nature', nature: 'water' }

export const INITIAL_DUEL: Duel = { seq: 0, round: 1, players: {} }

export type HostState = { duel: Duel; picks: Record<string, Element> }

export type Intent = { kind: 'cast'; element: Element } | { kind: 'rematch' }

export function beats(a: Element, b: Element) {
  return BEATS[a] === b
}

export function isElement(raw: unknown): raw is Element {
  return typeof raw === 'string' && (ELEMENTS as string[]).includes(raw)
}

export function isDuel(raw: unknown): raw is Duel {
  if (!raw || typeof raw !== 'object') return false
  const d = raw as Partial<Duel>
  return (
    typeof d.seq === 'number' &&
    typeof d.round === 'number' &&
    !!d.players &&
    typeof d.players === 'object' &&
    Object.values(d.players).every(
      p => !!p && typeof p.name === 'string' && typeof p.life === 'number' && typeof p.picked === 'boolean',
    )
  )
}

/** Host side: seats a player; null when already seated or both seats are taken. */
export function seat(duel: Duel, id: string, name: string): Duel | null {
  if (duel.players[id] || Object.keys(duel.players).length >= 2) return null
  return {
    ...duel,
    seq: duel.seq + 1,
    players: { ...duel.players, [id]: { name, life: START_LIFE, picked: false } },
  }
}

/** Host side: the next state, or null when the intent is not allowed. */
export function applyIntent(state: HostState, player: string, intent: unknown): HostState | null {
  if (!intent || typeof intent !== 'object') return null
  const { duel } = state
  const i = intent as { kind?: unknown; element?: unknown }

  if (i.kind === 'rematch') {
    if (duel.winner === undefined) return null
    const players = Object.fromEntries(
      Object.entries(duel.players).map(([id, p]) => [id, { ...p, life: START_LIFE, picked: false }]),
    )
    return { duel: { seq: duel.seq + 1, round: 1, players }, picks: {} }
  }

  if (i.kind !== 'cast' || !isElement(i.element)) return null
  const me = duel.players[player]
  if (!me || me.picked || duel.winner !== undefined) return null

  const picks = { ...state.picks, [player]: i.element }
  const ids = Object.keys(duel.players)
  if (ids.length < 2 || !ids.every(id => picks[id])) {
    return {
      duel: { ...duel, seq: duel.seq + 1, players: { ...duel.players, [player]: { ...me, picked: true } } },
      picks,
    }
  }
  return { duel: resolve(duel, picks), picks: {} }
}

function resolve(duel: Duel, picks: Record<string, Element>): Duel {
  const [a, b] = Object.keys(duel.players) as [string, string]
  const loser = beats(picks[a]!, picks[b]!) ? b : beats(picks[b]!, picks[a]!) ? a : null
  const players = Object.fromEntries(
    Object.entries(duel.players).map(([id, p]) => [
      id,
      { ...p, picked: false, life: id === loser ? p.life - 1 : p.life },
    ]),
  )
  const dead = loser !== null && players[loser]!.life <= 0
  return {
    seq: duel.seq + 1,
    round: duel.round + 1,
    players,
    last: { round: duel.round, picks: { [a]: picks[a]!, [b]: picks[b]! }, loser },
    ...(dead ? { winner: loser === a ? b : a } : {}),
  }
}

/** Guest side: a replayed or reordered snapshot never rolls the state back. */
export function acceptSnapshot(current: Duel, incoming: unknown): Duel {
  return isDuel(incoming) && incoming.seq > current.seq ? incoming : current
}
