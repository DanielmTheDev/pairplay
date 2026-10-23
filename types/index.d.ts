export type Room = { code: string; lastId?: string; role?: 'host' | 'guest' }

export type GameState = { seq: number; pokes: Record<string, number> }

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
      game: Shaped<GameState>
    }
  }
}
