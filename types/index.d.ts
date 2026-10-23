export type Room = { code: string; lastId?: string; role?: 'host' | 'guest' }

export type Element = 'fire' | 'water' | 'nature'

/** A basic spell, or `fire+` and the like: empowered. */
export type Spell = Element | `${Element}+`

export type Action = 'charge' | 'shield' | 'drain' | 'heal' | Spell

/** Public: everything but the pick. `drainCooldown` counts rounds left before Drain is back. */
export type Player = {
  name: string
  life: number
  mana: number
  picked: boolean
  shieldLocked: boolean
  drainCooldown: number
}

/** A resolved round. At most one player is hit: `loser`, for `dmg`. */
export type RoundResult = {
  round: number
  picks: Record<string, Action>
  loser: string | null
  dmg: number
  /** Drain landed and took a mana. */
  stole: boolean
  /** Who healed (not hit while healing). */
  healed: string[]
}

/** Public duel state: what the host broadcasts. Picks stay on the host until a round resolves. */
export type Duel = {
  seq: number
  round: number
  players: Record<string, Player>
  last?: RoundResult
  winner?: string
  /** How often each action was picked this game, counted once revealed. */
  tally?: Partial<Record<Action, number>>
}

export type Peer = { name: string; lastSeen: number }

export type LogLine = { t: number; who: string; text: string; kind: 'chat' | 'info' }

export type Conn = 'off' | 'connecting' | 'live' | 'retrying'

declare module 'claude-code' {
  interface PluginState {
    'pairplay': {
      room: Shaped<Room | null>
      peers: Shaped<Record<string, Peer>>
      log: Shaped<LogLine[]>
      conn: Conn
      game: Shaped<Duel>
      picks: Record<string, Action>
      mine: { round: number; action: Action } | null
    }
  }
}
