export type Room = { code: string; lastId?: string; role?: 'host' | 'guest' }

export type Element = 'fire' | 'water' | 'nature'

/** A basic spell, or `fire+` and the like: empowered. */
export type Spell = Element | `${Element}+`

export type Action = 'charge' | 'supercharge' | 'shield' | 'drain' | 'heal' | 'avatar' | Spell

/** What the world throws at both players, now and then. */
export type ChaosEvent = 'blizzard' | 'lightning' | 'volcano' | 'eclipse' | 'rain' | 'quake' | 'rift' | 'tornado'

/** Public: everything but the pick. The cooldowns count rounds left before that action is back. */
export type Player = {
  name: string
  life: number
  mana: number
  picked: boolean
  shieldCooldown: number
  drainCooldown: number
  superCooldown: number
  healCooldown: number
  /** The Avatar State, once a game. */
  avatarUsed: boolean
  /** Has chosen this game's spells. */
  ready: boolean
}

/** A chaos event: struck at the start of `round`, holds through `until`. */
export type Chaos = {
  event: ChaosEvent
  round: number
  until: number
  /** Life and mana just before it struck, for the stage to change them on cue. */
  before: Record<string, { life: number; mana: number }>
}

/** A resolved round. At most one player is hit: `loser`, for `dmg`. */
export type RoundResult = {
  round: number
  picks: Record<string, Action>
  loser: string | null
  dmg: number
  /** Drain landed and took a mana. */
  stole: boolean
  /** Who healed, by how much (not hit while healing). */
  healed: Record<string, number>
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
  /** The latest chaos event, and how many struck this game. */
  chaos?: Chaos
  chaosCount?: number
  /** Each player's chosen spells, revealed once the game is won. */
  loadouts?: Record<string, Action[]>
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
      relay: Shaped<string | null>
      game: Shaped<Duel>
      picks: Record<string, Action>
      mine: { round: number; action: Action } | null
      loadouts: Record<string, Action[]>
      myLoadout: Action[] | null
      draft: Action[]
    }
  }
}
