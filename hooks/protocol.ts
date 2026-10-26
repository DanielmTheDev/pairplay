// Pure wire logic: no `$`, so tests cover it without an engine.

import type { Peer } from '../types'

export const PROTOCOL = 1
// Presence: ping rarely (ntfy.sh caps messages per IP per day), call a peer gone after missing two.
export const PING_MS = 240_000
export const STALE_MS = 600_000

// Crockford-ish alphabet: no 0/O/1/I/L confusion when read aloud.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

export type Envelope = {
  v: number
  from: string
  name: string
  type: string
  payload?: unknown
}

export type Inbound =
  | { kind: 'open' }
  | { kind: 'message'; id: string; env: Envelope }
  | { kind: 'skip' }

/** 8 chars (~40 bits) as XXXX-XXXX: the code is the only secret guarding the topic. */
export function makeRoomCode(random: Uint8Array): string {
  const chars = Array.from(random.slice(0, 8), b => ALPHABET[b % ALPHABET.length])
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`
}

/** Accepts sloppy typing: lower case, spaces, missing dash. */
export function normalizeRoomCode(raw: string): string | null {
  const clean = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (clean.length !== 8 || [...clean].some(c => !ALPHABET.includes(c))) return null
  return `${clean.slice(0, 4)}-${clean.slice(4)}`
}

export function topicFor(code: string): string {
  return `pairplay-${code.replace('-', '').toLowerCase()}`
}

export function subscribeUrl(relay: string, code: string, lastId?: string): string {
  const base = `${relay.replace(/\/+$/, '')}/${topicFor(code)}/json`
  return lastId ? `${base}?since=${encodeURIComponent(lastId)}` : base
}

/**
 * curl holding the stream. ntfy sends a keepalive every 45s, so a link silent
 * for 100s is dead (sleep, network switch, NAT drop): curl exits and we resume.
 */
export function curlArgs(url: string): string[] {
  return ['curl', '-sN', '--fail', '--connect-timeout', '10', '--speed-time', '100', '--speed-limit', '1', url]
}

/**
 * Wait before resend `attempt` (0-based) of a failed publish; null: give up.
 * A rate limit is never retried: on ntfy.sh it is a daily quota, and every try counts.
 */
export function retryDelay(attempt: number, status: number): number | null {
  if (attempt >= 4 || status === 429) return null
  return 500 * 2 ** attempt
}

/** A relay base URL as typed (`https://host/`), or null when it is not http(s). */
export function normalizeRelay(raw: string): string | null {
  const url = raw.trim().replace(/\/+$/, '')
  return /^https?:\/\/[^\s/]+(\/[^\s]*)?$/.test(url) ? url : null
}

export function publishUrl(relay: string, code: string): string {
  return `${relay.replace(/\/+$/, '')}/${topicFor(code)}`
}

/** Splits a stream buffer into whole lines plus the unfinished tail. */
export function splitLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts.filter(l => l.trim() !== ''), rest }
}

/** One ntfy NDJSON line → what the transport cares about. */
export function parseLine(line: string): Inbound {
  let raw: unknown
  try {
    raw = JSON.parse(line)
  } catch {
    return { kind: 'skip' }
  }
  if (!raw || typeof raw !== 'object') return { kind: 'skip' }
  const ev = raw as { event?: string; id?: string; message?: string }
  if (ev.event === 'open') return { kind: 'open' }
  if (ev.event !== 'message' || typeof ev.message !== 'string' || !ev.id) return { kind: 'skip' }
  try {
    const env = JSON.parse(ev.message) as Envelope
    if (env.v !== PROTOCOL || typeof env.from !== 'string' || typeof env.type !== 'string') {
      return { kind: 'skip' }
    }
    return { kind: 'message', id: ev.id, env: { ...env, name: String(env.name ?? '?').slice(0, 24) } }
  } catch {
    return { kind: 'skip' }
  }
}

export function livePeers(peers: Record<string, Peer>, now: number): [string, Peer][] {
  return Object.entries(peers).filter(([, p]) => now - p.lastSeen < STALE_MS)
}
