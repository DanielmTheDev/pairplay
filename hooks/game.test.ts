import { expect, test } from 'claude-code/testing'

import type { Duel } from '../types'
import { acceptSnapshot, applyIntent, beats, INITIAL_DUEL, isDuel, seat, type HostState } from './game'

const start = (): HostState => {
  let d = seat(INITIAL_DUEL, 'h', 'dani')!
  d = seat(d, 'g', 'caren')!
  return { duel: d, picks: {} }
}
const cast = (s: HostState, id: string, element: string) => applyIntent(s, id, { kind: 'cast', element })

test('elements: each beats exactly one', async () => {
  expect(beats('water', 'fire')).toBe(true)
  expect(beats('fire', 'nature')).toBe(true)
  expect(beats('nature', 'water')).toBe(true)
  expect(beats('fire', 'water')).toBe(false)
  expect(beats('fire', 'fire')).toBe(false)
})

test('seat: two players with 3 life, a third is refused, reseat is a no-op', async () => {
  const s = start()
  expect(s.duel.players).toEqual({
    h: { name: 'dani', life: 3, picked: false },
    g: { name: 'caren', life: 3, picked: false },
  })
  expect(s.duel.seq).toBe(2)
  expect(seat(s.duel, 'x', 'eve')).toBe(null)
  expect(seat(s.duel, 'g', 'caren')).toBe(null)
})

test('first cast is hidden: only picked flag is public', async () => {
  const one = cast(start(), 'g', 'fire')!
  expect(one.picks).toEqual({ g: 'fire' })
  expect(one.duel.players.g?.picked).toBe(true)
  expect(JSON.stringify(one.duel)).not.toContain('fire')
  expect(one.duel.seq).toBe(3)
})

test('second cast resolves: loser -1, picks revealed and cleared', async () => {
  const two = cast(cast(start(), 'g', 'fire')!, 'h', 'water')!
  expect(two.picks).toEqual({})
  expect(two.duel.players.g).toEqual({ name: 'caren', life: 2, picked: false })
  expect(two.duel.players.h).toEqual({ name: 'dani', life: 3, picked: false })
  expect(two.duel.last).toEqual({ round: 1, picks: { g: 'fire', h: 'water' }, loser: 'g' })
  expect(two.duel.round).toBe(2)
})

test('tie: nobody loses life', async () => {
  const two = cast(cast(start(), 'g', 'fire')!, 'h', 'fire')!
  expect(two.duel.players.g?.life).toBe(3)
  expect(two.duel.players.h?.life).toBe(3)
  expect(two.duel.last?.loser).toBe(null)
})

test('recast: changes the hidden pick while the other has not picked', async () => {
  const one = cast(start(), 'g', 'fire')!
  const two = cast(one, 'g', 'water')!
  expect(two.picks).toEqual({ g: 'water' })
  expect(two.duel.players.g?.picked).toBe(true)
  expect(two.duel.seq).toBe(one.duel.seq + 1)
  expect(JSON.stringify(two.duel)).not.toContain('water')
  // The same pick again (a resent intent) changes nothing.
  expect(cast(two, 'g', 'water')).toBe(null)
  // Once the other picks, the round resolves with the changed pick.
  const done = cast(two, 'h', 'nature')!
  expect(done.duel.last?.picks).toEqual({ g: 'water', h: 'nature' })
})

test('rejects: unseated, bad element, junk', async () => {
  const s = start()
  expect(cast(s, 'x', 'fire')).toBe(null)
  expect(cast(s, 'g', 'lava')).toBe(null)
  expect(applyIntent(s, 'g', undefined)).toBe(null)
  expect(applyIntent(s, 'g', { kind: 'nuke' })).toBe(null)
})

test('three lost rounds: winner set, casts refused, rematch resets', async () => {
  let s = start()
  for (let i = 0; i < 3; i++) s = cast(cast(s, 'g', 'fire')!, 'h', 'water')!
  expect(s.duel.players.g?.life).toBe(0)
  expect(s.duel.winner).toBe('h')
  expect(cast(s, 'g', 'fire')).toBe(null)

  const again = applyIntent(s, 'g', { kind: 'rematch' })!
  expect(again.duel.winner).toBe(undefined)
  expect(again.duel.last).toBe(undefined)
  expect(again.duel.round).toBe(1)
  expect(again.duel.players.g?.life).toBe(3)
  expect(again.duel.players.h?.life).toBe(3)
})

test('rematch refused while the game is still on', async () => {
  expect(applyIntent(start(), 'g', { kind: 'rematch' })).toBe(null)
})

test('guest keeps the newest snapshot, ignores stale or junk ones', async () => {
  const s3: Duel = { ...INITIAL_DUEL, seq: 3 }
  expect(acceptSnapshot(INITIAL_DUEL, s3)).toEqual(s3)
  expect(acceptSnapshot(s3, { ...INITIAL_DUEL, seq: 2 })).toEqual(s3)
  expect(acceptSnapshot(s3, { seq: 'x' })).toEqual(s3)
  expect(acceptSnapshot(s3, null)).toEqual(s3)
})

test('duel shape check', async () => {
  expect(isDuel(INITIAL_DUEL)).toBe(true)
  expect(isDuel({ seq: 1, round: 1, players: { a: { name: 'a', life: 'x', picked: false } } })).toBe(false)
  expect(isDuel({ seq: 1, players: {} })).toBe(false)
})
