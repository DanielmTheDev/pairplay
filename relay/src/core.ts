// Pure relay logic: the slice of ntfy that pairplay uses, kept in memory per topic.

export type Message = { id: string; time: number; event: 'message'; topic: string; message: string }

export const MAX_KEPT = 200
export const MAX_BODY = 8192
export const KEEP_MS = 12 * 3600_000
export const KEEPALIVE_MS = 30_000

export function isTopic(raw: string): boolean {
  return /^[A-Za-z0-9_-]{1,64}$/.test(raw)
}

/** One NDJSON line, ntfy-shaped: seconds for `time`. */
export function line(ev: { event: 'open' | 'keepalive'; topic: string } | Message, now: number): string {
  const head = 'id' in ev ? {} : { id: ev.event, time: Math.floor(now / 1000) }
  return JSON.stringify({ ...head, ...ev }) + '\n'
}

/** A topic's recent messages, oldest first. */
export class Log {
  private kept: (Message & { at: number })[] = []
  private n = 0

  add(topic: string, message: string, now: number): Message {
    const id = `${now.toString(36)}${(this.n++).toString(36).padStart(4, '0')}`
    const msg: Message = { id, time: Math.floor(now / 1000), event: 'message', topic, message }
    this.kept.push({ ...msg, at: now })
    if (this.kept.length > MAX_KEPT) this.kept.splice(0, this.kept.length - MAX_KEPT)
    return msg
  }

  /** What a subscriber resuming from `since` missed: nothing new without it, all for `all` or an id no longer kept. */
  since(since: string | undefined, now: number): Message[] {
    this.kept = this.kept.filter(m => now - m.at < KEEP_MS)
    if (!since) return []
    const i = this.kept.findIndex(m => m.id === since)
    return this.kept.slice(i + 1).map(({ at: _at, ...m }) => m)
  }
}
