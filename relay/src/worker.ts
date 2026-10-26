// pairplay relay: a Cloudflare Worker speaking the slice of ntfy the plugin uses.
//   POST /<topic>              publish the body
//   GET  /<topic>/json?since=  NDJSON stream: open, missed messages, live ones, keepalives
// One Durable Object per topic holds its log and its open streams.

import { DurableObject } from 'cloudflare:workers'

import { KEEPALIVE_MS, Log, MAX_BODY, isTopic, line } from './core.ts'

type Env = { ROOMS: DurableObjectNamespace<Room> }

const CORS = { 'access-control-allow-origin': '*' }

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const [topic, kind, ...rest] = new URL(req.url).pathname.split('/').filter(Boolean)
    if (!topic || !isTopic(topic) || rest.length || (kind && kind !== 'json')) return text(404, 'not found')
    if (req.method === 'POST' && !kind) {
      const body = await req.text()
      if (body.length > MAX_BODY) return text(413, 'too large')
      return env.ROOMS.get(env.ROOMS.idFromName(topic)).publish(topic, body)
    }
    if (req.method === 'GET' && kind === 'json') {
      const since = new URL(req.url).searchParams.get('since') ?? undefined
      return env.ROOMS.get(env.ROOMS.idFromName(topic)).subscribe(topic, since)
    }
    return text(405, 'method not allowed')
  },
}

function text(status: number, body: string) {
  return new Response(body, { status, headers: CORS })
}

export class Room extends DurableObject<Env> {
  private log = new Log()
  private streams = new Set<WritableStreamDefaultWriter<Uint8Array>>()
  private beat: ReturnType<typeof setInterval> | undefined
  private enc = new TextEncoder()

  async publish(topic: string, body: string): Promise<Response> {
    const msg = this.log.add(topic, body, Date.now())
    this.broadcast(line(msg, Date.now()))
    return new Response(JSON.stringify(msg), { headers: { ...CORS, 'content-type': 'application/json' } })
  }

  async subscribe(topic: string, since: string | undefined): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>()
    const w = writable.getWriter()
    const now = Date.now()
    const first = line({ event: 'open', topic }, now) + this.log.since(since, now).map(m => line(m, now)).join('')
    void w.write(this.enc.encode(first)).catch(() => this.drop(w))
    this.streams.add(w)
    this.beat ??= setInterval(() => this.broadcast(line({ event: 'keepalive', topic }, Date.now())), KEEPALIVE_MS)
    return new Response(readable, {
      headers: { ...CORS, 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache, no-transform' },
    })
  }

  private broadcast(text: string) {
    const bytes = this.enc.encode(text)
    for (const w of this.streams) w.write(bytes).catch(() => this.drop(w))
  }

  private drop(w: WritableStreamDefaultWriter<Uint8Array>) {
    this.streams.delete(w)
    void w.close().catch(() => {})
    if (this.streams.size === 0 && this.beat) {
      clearInterval(this.beat)
      this.beat = undefined
    }
  }
}
