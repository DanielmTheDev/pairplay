// Host-authoritative shared state, pure: the host alone applies intents and
// broadcasts numbered snapshots; guests send intents and keep the newest snapshot.

import type { GameState } from '../types'

export const INITIAL_GAME: GameState = { seq: 0, pokes: {} }

export type Intent = { kind: 'poke' }

export function isGameState(raw: unknown): raw is GameState {
  if (!raw || typeof raw !== 'object') return false
  const s = raw as { seq?: unknown; pokes?: unknown }
  return (
    typeof s.seq === 'number' &&
    !!s.pokes &&
    typeof s.pokes === 'object' &&
    Object.values(s.pokes).every(n => typeof n === 'number')
  )
}

/** Host side: the next state, or null when the intent is not allowed. */
export function applyIntent(state: GameState, player: string, intent: unknown): GameState | null {
  if (!intent || typeof intent !== 'object' || (intent as Intent).kind !== 'poke') return null
  return { seq: state.seq + 1, pokes: { ...state.pokes, [player]: (state.pokes[player] ?? 0) + 1 } }
}

/** Guest side: a replayed or reordered snapshot never rolls the state back. */
export function acceptSnapshot(current: GameState, incoming: unknown): GameState {
  return isGameState(incoming) && incoming.seq > current.seq ? incoming : current
}
