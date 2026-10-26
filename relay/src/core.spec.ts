import assert from 'node:assert/strict'
import { test } from 'node:test'

import { MAX_BODY, MAX_KEPT, Log, isTopic, line } from './core.ts'

test('topics: ntfy-style names only', () => {
  assert.equal(isTopic('pairplay-abcd2345'), true)
  assert.equal(isTopic(''), false)
  assert.equal(isTopic('a/b'), false)
  assert.equal(isTopic('x'.repeat(65)), false)
})

test('log: messages get ids and ntfy fields, oldest first', () => {
  const log = new Log()
  const a = log.add('t', 'one', 1000)
  const b = log.add('t', 'two', 2000)
  assert.deepEqual(a, { id: a.id, time: 1, event: 'message', topic: 't', message: 'one' })
  assert.notEqual(a.id, b.id)
  assert.deepEqual(log.since(undefined, 2000).map(m => m.message), [])
  assert.deepEqual(log.since('all', 2000).map(m => m.message), ['one', 'two'])
})

test('log: since an id gives what came after it; an unknown id gives everything kept', () => {
  const log = new Log()
  const a = log.add('t', 'one', 0)
  log.add('t', 'two', 0)
  log.add('t', 'three', 0)
  assert.deepEqual(log.since(a.id, 0).map(m => m.message), ['two', 'three'])
  assert.deepEqual(log.since('nope', 0).map(m => m.message), ['one', 'two', 'three'])
})

test('log: keeps the newest MAX_KEPT, drops what is older than 12h', () => {
  const log = new Log()
  for (let i = 0; i < MAX_KEPT + 5; i++) log.add('t', String(i), 0)
  const all = log.since('all', 0)
  assert.equal(all.length, MAX_KEPT)
  assert.equal(all[0]!.message, '5')
  assert.equal(log.since('all', 13 * 3600_000).length, 0)
})

test('lines: one JSON object per line, open and keepalive events', () => {
  assert.equal(line({ event: 'open', topic: 't' }, 5000), '{"id":"open","time":5,"event":"open","topic":"t"}\n')
  assert.equal(JSON.parse(line({ event: 'keepalive', topic: 't' }, 0)).event, 'keepalive')
  assert.ok(MAX_BODY >= 4096)
})
