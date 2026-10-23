export type Room = { code: string; lastId?: string }

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
    }
  }
}
