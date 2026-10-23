export type Room = { code: string; lastId?: string; role?: 'host' | 'guest' }

export type Element = 'fire' | 'water' | 'nature'

export type Player = { name: string; life: number; picked: boolean }

/** Public duel state: what the host broadcasts. Picks stay on the host until a round resolves. */
export type Duel = {
  seq: number
  round: number
  players: Record<string, Player>
  last?: { round: number; picks: Record<string, Element>; loser: string | null }
  winner?: string
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
      picks: Record<string, Element>
      mine: { round: number; element: Element } | null
    }
  }
}
