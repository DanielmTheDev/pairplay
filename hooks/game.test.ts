import { expect, test } from 'claude-code/testing'

import type { Action, Duel, Player } from '../types'
import {
  acceptSnapshot,
  applyIntent,
  beats,
  CHAOS_EVENTS,
  INITIAL_DUEL,
  isAction,
  isDuel,
  legal,
  maybeChaos,
  seat,
  strike,
  summary,
  whyNot,
  type HostState,
} from './game'

const seated = (): HostState => {
  let d = seat(INITIAL_DUEL, 'h', 'dani')!
  d = seat(d, 'g', 'caren')!
  return { duel: d, picks: {} }
}
/** Both seated: the duel starts right away, every action to hand. */
const start = seated
/** No chaos: the dice never come up. */
const calm = () => 0.99
const act = (s: HostState, id: string, action: string) => applyIntent(s, id, { kind: 'act', action })
/** A state with both players changed by `over` (the same for both, or per id). */
const withPlayers = (h: Partial<Player>, g: Partial<Player> = h): HostState => {
  const s = start()
  const p = s.duel.players
  return { ...s, duel: { ...s.duel, players: { h: { ...p.h!, ...h }, g: { ...p.g!, ...g } } } }
}
const round = (s: HostState, h: Action, g: Action, rand = calm) => {
  const one = act(s, 'h', h)
  expect(one).not.toBe(null)
  const two = applyIntent(one!, 'g', { kind: 'act', action: g }, rand)
  expect(two).not.toBe(null)
  return two!
}
const lm = (s: HostState, id: string) => [s.duel.players[id]!.life, s.duel.players[id]!.mana]

test('elements: each beats exactly one', async () => {
  expect(beats('water', 'fire')).toBe(true)
  expect(beats('fire', 'nature')).toBe(true)
  expect(beats('nature', 'water')).toBe(true)
  expect(beats('fire', 'water')).toBe(false)
  expect(beats('fire', 'fire')).toBe(false)
})

test('actions: the nine picks, nothing else', async () => {
  for (const a of ['pass', 'charge', 'shield', 'drain', 'heal', 'avatar', 'fire', 'water', 'nature']) {
    expect(isAction(a)).toBe(true)
  }
  for (const gone of ['supercharge', 'fire+', 'water+', 'nature+', 'lava']) expect(isAction(gone)).toBe(false)
  expect(isAction(3)).toBe(false)
})

const FRESH = { life: 3, mana: 1, picked: false, shieldCooldown: 0, drainCooldown: 0, healCooldown: 0, avatarRounds: 0, avatarCooldown: 0 }

test('seat: two players with 3 life and 1 mana, a third is refused, reseat is a no-op', async () => {
  const s = seated()
  const fresh = FRESH
  expect(s.duel.players).toEqual({ h: { name: 'dani', ...fresh }, g: { name: 'caren', ...fresh } })
  expect(s.duel.seq).toBe(2)
  expect(seat(s.duel, 'x', 'eve')).toBe(null)
  expect(seat(s.duel, 'g', 'caren')).toBe(null)
})

test('legal: mana, charge cap, shield cooldown, drain cooldown, heal at full life', async () => {
  const p = start().duel.players.h!
  expect(legal(p, 'charge')).toBe(true)
  expect(legal(p, 'shield')).toBe(true)
  expect(legal(p, 'fire')).toBe(true)
  expect(legal(p, 'drain')).toBe(true)
  expect(legal({ ...p, mana: 0 }, 'fire')).toBe(true)
  expect(legal({ ...p, mana: 0 }, 'drain')).toBe(false)
  expect(legal({ ...p, mana: 3 }, 'charge')).toBe(false)
  expect(legal({ ...p, shieldCooldown: 2 }, 'shield')).toBe(false)
  expect(legal({ ...p, drainCooldown: 1 }, 'drain')).toBe(false)
  expect(legal({ ...p, mana: 2 }, 'heal')).toBe(false)
  expect(legal({ ...p, mana: 1, life: 2 }, 'heal')).toBe(true)
  expect(legal({ ...p, mana: 0, life: 2 }, 'heal')).toBe(false)
  expect(legal({ ...p, life: 2, healCooldown: 1 }, 'heal')).toBe(false)
})

test('whyNot: says why a pick is not allowed', async () => {
  const p = start().duel.players.h!
  expect(whyNot(p, 'fire')).toBe(null)
  expect(whyNot({ ...p, mana: 0 }, 'fire')).toBe(null)
  expect(whyNot({ ...p, life: 2, mana: 0 }, 'heal')).toBe('needs 1 mana')
  expect(whyNot({ ...p, life: 2, healCooldown: 1 }, 'heal')).toBe('heal in 1')
  expect(whyNot({ ...p, mana: 2 }, 'heal')).toBe('life full')
  expect(whyNot({ ...p, mana: 3 }, 'charge')).toBe('mana full')
  expect(whyNot({ ...p, shieldCooldown: 2 }, 'shield')).toBe('shield in 2')
  expect(whyNot({ ...p, drainCooldown: 2 }, 'drain')).toBe('drain in 2')
})

test('pass: always allowed, even with nothing else left; does nothing, takes hits', async () => {
  // No mana, life full, shield and drain cooling: stuck but for charge, the elements and pass.
  const p = { ...seated().duel.players.h!, mana: 0, shieldCooldown: 1, drainCooldown: 1 }
  expect(['shield', 'heal', 'drain', 'avatar'].filter(a => legal(p, a as Action))).toEqual([])
  expect(legal(p, 'pass')).toBe(true)
  expect(lm(round(withPlayers({ mana: 3 }, { mana: 2 }), 'pass', 'charge'), 'h')).toEqual([3, 3])
  expect(lm(round(withPlayers({ mana: 3 }, { mana: 2 }), 'pass', 'fire'), 'h')).toEqual([2, 3])
})

test('host rejects an illegal intent', async () => {
  const s = start()
  expect(act(s, 'h', 'avatar')).toBe(null)
  expect(act(s, 'h', 'heal')).toBe(null)
  expect(act(withPlayers({ mana: 3 }), 'h', 'charge')).toBe(null)
})

// Both at 2 life, 2 mana. [host, guest, host [life, mana], guest [life, mana]]
const MATRIX: [Action, Action, number[], number[]][] = [
  ['charge', 'charge', [2, 3], [2, 3]],
  ['charge', 'shield', [2, 3], [2, 2]],
  // The elements are free.
  ['charge', 'fire', [1, 3], [2, 2]],
  // Gains, then loses the mana to the drainer.
  ['charge', 'drain', [1, 2], [2, 2]],
  // Heal: +2, but never past 3.
  ['charge', 'heal', [2, 3], [3, 1]],
  ['shield', 'shield', [2, 2], [2, 2]],
  ['shield', 'fire', [2, 2], [2, 2]],
  ['shield', 'drain', [2, 2], [2, 1]],
  ['shield', 'heal', [2, 2], [3, 1]],
  ['fire', 'water', [1, 2], [2, 2]],
  ['fire', 'fire', [2, 2], [2, 2]],
  ['fire', 'drain', [2, 2], [1, 1]],
  ['fire', 'heal', [2, 2], [1, 1]],
  ['drain', 'drain', [2, 1], [2, 1]],
  ['drain', 'heal', [2, 2], [1, 0]],
  ['heal', 'heal', [3, 1], [3, 1]],
  // Entering the Avatar State takes any hit, like a pass: 2 of its 3 mana spent.
  ['pass', 'avatar', [2, 2], [2, 1]],
]

for (const [h, g, hx, gx] of MATRIX) {
  test(`matrix: ${h} vs ${g}`, async () => {
    const mana = (a: Action) => ({ life: 2, mana: a === 'avatar' ? 3 : 2 })
    const s = round(withPlayers(mana(h), mana(g)), h, g)
    expect(lm(s, 'h')).toEqual(hx)
    expect(lm(s, 'g')).toEqual(gx)
    // Mirrored, the same outcome.
    const m = round(withPlayers(mana(g), mana(h)), g, h)
    expect(lm(m, 'h')).toEqual(gx)
    expect(lm(m, 'g')).toEqual(hx)
  })
}

test('result: loser, damage, theft and heals are recorded', async () => {
  const hit = round(withPlayers({ life: 2, mana: 2 }), 'fire', 'water')
  expect(hit.duel.last).toEqual({ round: 1, picks: { h: 'fire', g: 'water' }, loser: 'h', dmg: 1, stole: false, healed: {}, buffed: [] })
  const tie = round(withPlayers({ life: 2, mana: 2 }), 'fire', 'fire')
  expect(tie.duel.last).toMatchObject({ loser: null, dmg: 0 })
  const drain = round(withPlayers({ life: 2, mana: 2 }), 'drain', 'charge')
  expect(drain.duel.last).toMatchObject({ loser: 'g', dmg: 1, stole: true })
  const heal = round(withPlayers({ life: 2, mana: 2 }), 'shield', 'heal')
  expect(heal.duel.last).toMatchObject({ loser: null, healed: { g: 1 } })
  const fizzle = round(withPlayers({ life: 2, mana: 2 }), 'fire', 'heal')
  expect(fizzle.duel.last).toMatchObject({ loser: 'g', healed: {} })
})

test('drain steals from a healer with mana left', async () => {
  const s = round(withPlayers({ life: 2, mana: 2 }, { life: 2, mana: 3 }), 'drain', 'heal')
  expect(lm(s, 'h')).toEqual([2, 2])
  expect(lm(s, 'g')).toEqual([1, 1])
  expect(s.duel.last?.stole).toBe(true)
})

test('drain blocked by a shield steals nothing', async () => {
  const s = round(withPlayers({ life: 2, mana: 2 }), 'drain', 'shield')
  expect(s.duel.last).toMatchObject({ loser: null, stole: false })
})

test('shield cooldown: shield in round 1, out in rounds 2 and 3, back in round 4', async () => {
  let s = round(start(), 'shield', 'charge')
  expect(s.duel.players.h?.shieldCooldown).toBe(2)
  expect(s.duel.players.g?.shieldCooldown).toBe(0)
  expect(act(s, 'h', 'shield')).toBe(null)
  s = round(s, 'charge', 'shield')
  expect(s.duel.players.h?.shieldCooldown).toBe(1)
  expect(act(s, 'h', 'shield')).toBe(null)
  s = round(s, 'charge', 'charge')
  expect(s.duel.round).toBe(4)
  expect(s.duel.players.h?.shieldCooldown).toBe(0)
  expect(act(s, 'h', 'shield')).not.toBe(null)
})

test('drain cooldown: out for two rounds whatever happened, back in the third', async () => {
  let s = round(withPlayers({ mana: 2 }), 'drain', 'shield')
  expect(s.duel.players.h?.drainCooldown).toBe(2)
  expect(act(s, 'h', 'drain')).toBe(null)
  s = round(s, 'charge', 'charge')
  expect(s.duel.players.h?.drainCooldown).toBe(1)
  expect(act(s, 'h', 'drain')).toBe(null)
  s = round(s, 'shield', 'fire')
  expect(s.duel.players.h?.drainCooldown).toBe(0)
  expect(act(s, 'h', 'drain')).not.toBe(null)
})

test('first pick is hidden: only the picked flag is public', async () => {
  const one = act(start(), 'g', 'fire')!
  expect(one.picks).toEqual({ g: 'fire' })
  expect(one.duel.players.g?.picked).toBe(true)
  expect(one.duel.players.g?.mana).toBe(1)
  expect(JSON.stringify(one.duel)).not.toContain('fire')
  expect(one.duel.seq).toBe(3)
})

test('second pick resolves: picks revealed and cleared, round advances', async () => {
  const two = round(start(), 'water', 'fire')
  expect(two.picks).toEqual({})
  expect(two.duel.players.g).toMatchObject({ life: 2, mana: 1, picked: false })
  expect(two.duel.players.h).toMatchObject({ life: 3, mana: 1, picked: false })
  expect(two.duel.round).toBe(2)
})

test('recast: changes the hidden pick while the other has not picked', async () => {
  const one = act(start(), 'g', 'fire')!
  const two = act(one, 'g', 'charge')!
  expect(two.picks).toEqual({ g: 'charge' })
  expect(two.duel.seq).toBe(one.duel.seq + 1)
  expect(JSON.stringify(two.duel)).not.toContain('charge')
  // The same pick again (a resent intent) changes nothing.
  expect(act(two, 'g', 'charge')).toBe(null)
  const done = act(two, 'h', 'nature')!
  expect(done.duel.last?.picks).toEqual({ g: 'charge', h: 'nature' })
})

test('rejects: unseated, bad action, junk', async () => {
  const s = start()
  expect(act(s, 'x', 'fire')).toBe(null)
  expect(act(s, 'g', 'lava')).toBe(null)
  expect(applyIntent(s, 'g', undefined)).toBe(null)
  expect(applyIntent(s, 'g', { kind: 'nuke' })).toBe(null)
})

test('life never goes below 0; death sets the winner, picks refused, rematch resets all', async () => {
  let s = round(withPlayers({ life: 1, mana: 2, shieldCooldown: 2, drainCooldown: 2 }), 'charge', 'fire')
  expect(s.duel.players.h?.life).toBe(0)
  expect(s.duel.winner).toBe('g')
  expect(act(s, 'g', 'charge')).toBe(null)

  const again = applyIntent(s, 'h', { kind: 'rematch' })!
  expect(again.duel.winner).toBe(undefined)
  expect(again.duel.last).toBe(undefined)
  expect(again.duel.round).toBe(1)
  expect(again.duel.players.h).toEqual({ name: 'dani', ...FRESH })
  expect(again.duel.players.g).toEqual({ name: 'caren', ...FRESH })
  // A new game starts right away.
  expect(act(again, 'h', 'charge')).not.toBe(null)
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
  expect(isDuel(start().duel)).toBe(true)
  expect(isDuel({ seq: 1, round: 1, players: { a: { name: 'a', life: 'x', picked: false } } })).toBe(false)
  // An old-format player (no mana) is refused.
  expect(isDuel({ seq: 1, round: 1, players: { a: { name: 'a', life: 3, picked: false } } })).toBe(false)
  expect(isDuel({ seq: 1, players: {} })).toBe(false)
})

test('tally: every pick counted once revealed, cleared on rematch', async () => {
  let s = round(start(), 'charge', 'fire')
  s = round(s, 'charge', 'shield')
  expect(s.duel.tally).toEqual({ charge: 2, fire: 1, shield: 1 })
  // A hidden pick is not counted yet.
  expect(act(s, 'h', 'fire')!.duel.tally).toEqual({ charge: 2, fire: 1, shield: 1 })
  const won = round(withPlayers({ life: 1, mana: 2 }), 'charge', 'fire')
  expect(applyIntent(won, 'h', { kind: 'rematch' })!.duel.tally).toBe(undefined)
})

test('summary: winner, rounds, share of picks, overused and unused actions', async () => {
  const d: Duel = {
    ...start().duel,
    round: 6,
    winner: 'g',
    last: { round: 5, picks: { h: 'charge', g: 'fire' }, loser: 'h', dmg: 1, stole: false, healed: {}, buffed: [] },
    tally: { charge: 5, fire: 3, shield: 2 },
  }
  expect(summary(d)).toBe(
    'caren won in 5 rounds · charge 5 (50%) ⚠, fire 3 (30%), shield 2 (20%) · never: drain, heal, water, nature, avatar',
  )
})

test('heal: +2 from 1 life', async () => {
  const s = round(withPlayers({ life: 1, mana: 1 }), 'heal', 'shield')
  expect(lm(s, 'h')).toEqual([3, 0])
  expect(s.duel.last?.healed).toEqual({ h: 2 })
})

test('heal cooldown: out for seven rounds, hit or not; back in the eighth', async () => {
  let s = round(withPlayers({ life: 2, mana: 3 }), 'heal', 'fire')
  expect(s.duel.players.h?.healCooldown).toBe(7)
  for (const left of [6, 5, 4, 3, 2, 1, 0]) {
    expect(act(s, 'h', 'heal')).toBe(null)
    s = round(s, 'pass', 'pass')
    expect(s.duel.players.h?.healCooldown).toBe(left)
  }
  expect(act(s, 'h', 'heal')).not.toBe(null)
})

// ─── the Avatar State ────────────────────────────────────────────────────────

test('avatar: needs 3 mana, costs 2; not again while it holds or cools down', async () => {
  const p = start().duel.players.h!
  expect(whyNot({ ...p, mana: 2 }, 'avatar')).toBe('needs 3 mana')
  expect(whyNot({ ...p, mana: 3 }, 'avatar')).toBe(null)
  expect(whyNot({ ...p, mana: 3, avatarRounds: 2 }, 'avatar')).toBe('avatar active')
  expect(whyNot({ ...p, mana: 3, avatarCooldown: 2 }, 'avatar')).toBe('avatar in 2')
  const s = round(withPlayers({ mana: 3 }), 'avatar', 'shield')
  expect(s.duel.players.h).toMatchObject({ mana: 1, avatarRounds: 3, avatarCooldown: 0 })
})

/** Host in the Avatar State with `rounds` left, both at 2 life and 2 mana. */
const buffed = (rounds = 3, g: Partial<Player> = {}) => withPlayers({ life: 2, mana: 2, avatarRounds: rounds }, { life: 2, mana: 2, ...g })

test('avatar: every element costs 1 and hits for 1 more', async () => {
  const s = round(buffed(), 'fire', 'charge')
  expect(lm(s, 'g')).toEqual([0, 3])
  expect(lm(s, 'h')).toEqual([2, 1])
  expect(s.duel.last).toMatchObject({ loser: 'g', dmg: 2, buffed: ['h'] })
  // Wins a clash for 2 too.
  expect(lm(round(buffed(), 'water', 'fire'), 'g')).toEqual([0, 2])
  // Same element: still a tie.
  expect(lm(round(buffed(), 'fire', 'fire'), 'g')).toEqual([2, 2])
  // Losing a clash is losing it.
  expect(lm(round(buffed(), 'fire', 'water'), 'h')).toEqual([1, 1])
  // A drain is no element: 1, as ever.
  expect(lm(round(buffed(), 'drain', 'charge'), 'g')).toEqual([1, 2])
  // The shield still holds.
  expect(lm(round(buffed(), 'fire', 'shield'), 'g')).toEqual([2, 2])
})

test('avatar: out of mana, an element is cast plain: free, hits for 1', async () => {
  const s0 = buffed(3, {})
  const s = { ...s0, duel: { ...s0.duel, players: { ...s0.duel.players, h: { ...s0.duel.players.h!, mana: 0 } } } }
  expect(whyNot(s.duel.players.h!, 'fire', { duel: s.duel })).toBe(null)
  const after = round(s, 'fire', 'charge')
  expect(lm(after, 'h')).toEqual([2, 0])
  expect(lm(after, 'g')).toEqual([1, 3])
  expect(after.duel.last).toMatchObject({ loser: 'g', dmg: 1 })
})

test('avatar: a charge gives 2 mana, never past 3', async () => {
  expect(lm(round(buffed(3), 'charge', 'shield'), 'h')).toEqual([2, 3])
  expect(lm(round(withPlayers({ mana: 0, avatarRounds: 3 }), 'charge', 'shield'), 'h')).toEqual([3, 2])
})

test('avatar: holds three rounds, then cools down three', async () => {
  let s = round(withPlayers({ mana: 3 }), 'avatar', 'pass')
  expect(s.duel.last?.buffed).toEqual([])
  for (const left of [2, 1, 0]) {
    s = round(s, 'pass', 'pass')
    expect(s.duel.last?.buffed).toEqual(['h'])
    expect(s.duel.players.h?.avatarRounds).toBe(left)
  }
  expect(s.duel.players.h?.avatarCooldown).toBe(3)
  s = { ...s, duel: { ...s.duel, players: { ...s.duel.players, h: { ...s.duel.players.h!, mana: 3 } } } }
  for (const left of [2, 1, 0]) {
    expect(act(s, 'h', 'avatar')).toBe(null)
    s = round(s, 'pass', 'pass')
    expect(s.duel.players.h?.avatarCooldown).toBe(left)
    expect(s.duel.last?.buffed).toEqual([])
  }
  expect(act(s, 'h', 'avatar')).not.toBe(null)
})

test('avatar: at most one player hit, never a draw', async () => {
  for (const g of ['pass', 'charge', 'shield', 'drain', 'heal', 'fire', 'water', 'nature'] as Action[]) {
    for (const h of ['fire', 'water', 'nature', 'drain', 'charge'] as Action[]) {
      const s = round(buffed(3, { life: 2, avatarRounds: 3 }), h, g)
      const hit = Object.values(s.duel.players).filter(p => p.life < 2)
      expect(hit.length).toBeLessThanOrEqual(1)
    }
  }
})

// ─── chaos ───────────────────────────────────────────────────────────────────

/** A duel at the start of `round`, nothing struck yet. */
const at = (round: number, over: Partial<Duel> = {}): Duel => ({ ...start().duel, round, ...over })
const dice = (...rolls: number[]) => () => rolls.shift() ?? 0.99

test('chaos: never in the first two rounds', async () => {
  expect(maybeChaos(at(1), dice(0, 0)).chaos).toBe(undefined)
  expect(maybeChaos(at(2), dice(0, 0)).chaos).toBe(undefined)
  expect(maybeChaos(at(3), dice(0, 0)).chaos).toMatchObject({ event: CHAOS_EVENTS[0], round: 3 })
})

test('chaos: by chance from round 3; for sure by round 6 if none struck yet', async () => {
  expect(maybeChaos(at(3), dice(0.5)).chaos).toBe(undefined)
  expect(maybeChaos(at(5), dice(0.5)).chaos).toBe(undefined)
  expect(maybeChaos(at(6), dice(0)).chaos).toMatchObject({ event: CHAOS_EVENTS[0], round: 6 })
  // Forced: no chance roll, only which event.
  expect(maybeChaos(at(6), dice(0.99)).chaos?.event).toBe(CHAOS_EVENTS.at(-1))
  // Once one struck, later ones stay chance: games with one, games with many.
  expect(maybeChaos(at(9, { chaosCount: 1, chaos: { event: 'rain', round: 4, until: 4, before: {} } }), dice(0.5)).chaos?.round).toBe(4)
  const again = maybeChaos(at(9, { chaosCount: 1, chaos: { event: 'rain', round: 4, until: 4, before: {} } }), dice(0.1, 0))
  expect(again.chaos).toMatchObject({ event: CHAOS_EVENTS[0], round: 9 })
  expect(again.chaosCount).toBe(2)
})

test('chaos: never two rounds in a row, never over a lasting one', async () => {
  const rain = { event: 'rain' as const, round: 4, until: 4, before: {} }
  expect(maybeChaos(at(5, { chaosCount: 1, chaos: rain }), dice(0, 0)).chaos).toBe(rain)
  const eclipse = { event: 'eclipse' as const, round: 4, until: 5, before: {} }
  expect(maybeChaos(at(6, { chaosCount: 1, chaos: eclipse }), dice(0, 0)).chaos).toBe(eclipse)
  expect(maybeChaos(at(7, { chaosCount: 1, chaos: eclipse }), dice(0, 0)).chaos?.round).toBe(7)
})

test('chaos: strikes as a round resolves, and remembers life and mana from before', async () => {
  let s = round(start(), 'charge', 'charge')
  s = round(s, 'shield', 'shield', dice(0, CHAOS_EVENTS.indexOf('blizzard') / CHAOS_EVENTS.length))
  expect(s.duel.round).toBe(3)
  expect(s.duel.chaos).toEqual({ event: 'blizzard', round: 3, until: 3, before: { h: { life: 3, mana: 2 }, g: { life: 3, mana: 2 } } })
  expect(lm(s, 'h')).toEqual([3, 0])
  expect(lm(s, 'g')).toEqual([3, 0])
})

test('chaos: no event once the game is won', async () => {
  const s = round(withPlayers({ life: 1, mana: 2 }), 'charge', 'fire', dice(0, 0))
  expect(s.duel.winner).toBe('g')
  expect(s.duel.chaos).toBe(undefined)
})

const both = (d: Duel) => Object.values(d.players).map(p => [p.life, p.mana])

test('chaos: every event hits both players alike', async () => {
  const d = at(4, { players: { h: { ...start().duel.players.h!, life: 2, mana: 1, drainCooldown: 2, shieldCooldown: 1 }, g: { ...start().duel.players.g!, life: 3, mana: 2, avatarCooldown: 2 } } })
  expect(both(strike(d, 'blizzard'))).toEqual([[2, 0], [3, 0]])
  expect(both(strike(d, 'lightning'))).toEqual([[2, 3], [3, 3]])
  expect(both(strike(d, 'rain'))).toEqual([[3, 1], [3, 2]])
  // 1 + 2 mana, whirled together: 2 each.
  expect(both(strike(d, 'tornado'))).toEqual([[2, 2], [3, 2]])
  const rift = strike(d, 'rift')
  for (const p of Object.values(rift.players)) {
    expect([p.shieldCooldown, p.drainCooldown, p.healCooldown, p.avatarCooldown]).toEqual([0, 0, 0, 0])
  }
  for (const e of ['volcano', 'eclipse', 'quake'] as const) expect(both(strike(d, e))).toEqual(both(d))
  // None of them ever deals damage.
  for (const e of CHAOS_EVENTS) for (const p of Object.values(strike(d, e).players)) expect(p.life).toBeGreaterThan(0)
})

test('chaos: a time rift cuts no Avatar State short', async () => {
  const d = at(4, { players: { h: { ...start().duel.players.h!, avatarRounds: 2 }, g: start().duel.players.g! } })
  expect(strike(d, 'rift').players.h?.avatarRounds).toBe(2)
})

test('volcano: elements hit for 1 more, for two rounds', async () => {
  let s = { ...start(), duel: strike(at(4, { players: start().duel.players }), 'volcano') }
  expect(s.duel.chaos).toMatchObject({ round: 4, until: 5 })
  s = round(s, 'fire', 'water')
  expect(lm(s, 'h')).toEqual([1, 1])
  expect(s.duel.last).toMatchObject({ loser: 'h', dmg: 2 })
  // A drain is no element.
  s = round(s, 'drain', 'shield')
  s = round(s, 'charge', 'nature')
  expect(s.duel.round).toBe(7)
  expect(s.duel.last).toMatchObject({ loser: 'h', dmg: 1 })
})

test('volcano: stacks with the Avatar State', async () => {
  const s0 = buffed(3)
  const s = round({ ...s0, duel: { ...strike({ ...s0.duel, round: 4 }, 'volcano') } }, 'fire', 'charge')
  expect(s.duel.last).toMatchObject({ loser: 'g', dmg: 3 })
})

test('eclipse: elements beat each other the other way round', async () => {
  expect(beats('fire', 'water', true)).toBe(true)
  expect(beats('water', 'fire', true)).toBe(false)
  const s = round({ ...start(), duel: strike(at(4, { players: withPlayers({ life: 2, mana: 2 }).duel.players }), 'eclipse') }, 'fire', 'water')
  expect(lm(s, 'h')).toEqual([2, 2])
  expect(lm(s, 'g')).toEqual([1, 2])
})

test('earthquake: no shield that round', async () => {
  const d = strike(at(4), 'quake')
  expect(whyNot(d.players.h!, 'shield', { duel: d })).toBe('earthquake')
  expect(act({ ...start(), duel: d }, 'h', 'shield')).toBe(null)
  const after = round({ ...start(), duel: d }, 'charge', 'charge')
  expect(whyNot(after.duel.players.h!, 'shield', { duel: after.duel })).toBe(null)
})

test('chaos survives the wire, and a rematch clears it', async () => {
  const d = strike(at(4), 'tornado')
  expect(isDuel(d)).toBe(true)
  expect(isDuel({ ...d, chaos: { event: 'meteor', round: 4, until: 4, before: {} } })).toBe(false)
  const won = round(withPlayers({ life: 1, mana: 2 }), 'charge', 'fire')
  const again = applyIntent({ ...won, duel: { ...won.duel, chaos: d.chaos!, chaosCount: 1 } }, 'h', { kind: 'rematch' })!
  expect(again.duel.chaos).toBe(undefined)
  expect(again.duel.chaosCount).toBe(undefined)
})
