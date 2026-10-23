import { expect, test } from 'claude-code/testing'

import {
  livePeers,
  makeRoomCode,
  normalizeRoomCode,
  parseLine,
  splitLines,
  subscribeUrl,
  STALE_MS,
} from './protocol'

test('room codes round-trip through sloppy typing', async () => {
  const code = makeRoomCode(new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7]))
  expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/)
  expect(normalizeRoomCode(code.toLowerCase().replace('-', ' '))).toBe(code)
  expect(normalizeRoomCode('ABC')).toBe(null)
  expect(normalizeRoomCode('ABCD-EFG0')).toBe(null)
})

test('subscribe url resumes from the last id', async () => {
  expect(subscribeUrl('https://ntfy.sh/', 'ABCD-EFGH')).toBe('https://ntfy.sh/pairplay-abcdefgh/json')
  expect(subscribeUrl('https://ntfy.sh', 'ABCD-EFGH', 'x1')).toBe(
    'https://ntfy.sh/pairplay-abcdefgh/json?since=x1',
  )
})

test('lines split across chunks are kept whole', async () => {
  const a = splitLines('{"a":1}\n{"b"')
  expect(a.lines).toEqual(['{"a":1}'])
  const b = splitLines(a.rest + ':2}\n')
  expect(b.lines).toEqual(['{"b":2}'])
  expect(b.rest).toBe('')
})

test('ntfy events parse into open, message or skip', async () => {
  expect(parseLine('{"event":"open"}')).toEqual({ kind: 'open' })
  expect(parseLine('{"event":"keepalive"}')).toEqual({ kind: 'skip' })
  expect(parseLine('not json')).toEqual({ kind: 'skip' })
  const env = { v: 1, from: 's1', name: 'ann', type: 'say', payload: 'hi' }
  const line = JSON.stringify({ event: 'message', id: 'm1', message: JSON.stringify(env) })
  expect(parseLine(line)).toEqual({ kind: 'message', id: 'm1', env })
  const foreign = JSON.stringify({ event: 'message', id: 'm2', message: 'plain text' })
  expect(parseLine(foreign)).toEqual({ kind: 'skip' })
})

test('peers go stale', async () => {
  const peers = { a: { name: 'a', lastSeen: 0 }, b: { name: 'b', lastSeen: 100 } }
  expect(livePeers(peers, STALE_MS + 50).map(([id]) => id)).toEqual(['b'])
})
