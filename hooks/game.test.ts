import { expect, test } from 'claude-code/testing'

import { acceptSnapshot, applyIntent, INITIAL_GAME, isGameState } from './game'

test('host applies a poke: seq bumps, player count grows', async () => {
  const one = applyIntent(INITIAL_GAME, 'bob', { kind: 'poke' })
  expect(one).toEqual({ seq: 1, pokes: { bob: 1 } })
  const two = applyIntent(one!, 'bob', { kind: 'poke' })
  expect(two).toEqual({ seq: 2, pokes: { bob: 2 } })
})

test('host rejects unknown or malformed intents', async () => {
  expect(applyIntent(INITIAL_GAME, 'bob', { kind: 'nuke' })).toBe(null)
  expect(applyIntent(INITIAL_GAME, 'bob', 'poke')).toBe(null)
  expect(applyIntent(INITIAL_GAME, 'bob', undefined)).toBe(null)
})

test('guest keeps the newest snapshot, ignores stale or junk ones', async () => {
  const s3 = { seq: 3, pokes: { alice: 2, bob: 1 } }
  expect(acceptSnapshot(INITIAL_GAME, s3)).toEqual(s3)
  expect(acceptSnapshot(s3, { seq: 2, pokes: { alice: 9 } })).toEqual(s3)
  expect(acceptSnapshot(s3, { seq: 'x' })).toEqual(s3)
  expect(acceptSnapshot(s3, null)).toEqual(s3)
})

test('snapshot shape check', async () => {
  expect(isGameState({ seq: 0, pokes: {} })).toBe(true)
  expect(isGameState({ seq: 1, pokes: { a: 'x' } })).toBe(false)
  expect(isGameState({ pokes: {} })).toBe(false)
})
