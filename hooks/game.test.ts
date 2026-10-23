import { expect, test } from 'claude-code/testing'

import type { Action, Duel, Player } from '../types'
import { acceptSnapshot, applyIntent, beats, INITIAL_DUEL, isAction, isDuel, legal, seat, summary, whyNot, type HostState } from './game'

const start = (): HostState => {
  let d = seat(INITIAL_DUEL, 'h', 'dani')!
  d = seat(d, 'g', 'caren')!
  return { duel: d, picks: {} }
}
const act = (s: HostState, id: string, action: string) => applyIntent(s, id, { kind: 'act', action })
/** A state with both players changed by `over` (the same for both, or per id). */
const withPlayers = (h: Partial<Player>, g: Partial<Player> = h): HostState => {
  const s = start()
  const p = s.duel.players
  return { ...s, duel: { ...s.duel, players: { h: { ...p.h!, ...h }, g: { ...p.g!, ...g } } } }
}
const round = (s: HostState, h: Action, g: Action) => {
  const one = act(s, 'h', h)
  expect(one).not.toBe(null)
  const two = act(one!, 'g', g)
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

test('actions: the eleven picks, nothing else', async () => {
  for (const a of ['charge', 'supercharge', 'shield', 'drain', 'heal', 'fire', 'water', 'nature', 'fire+', 'water+', 'nature+']) {
    expect(isAction(a)).toBe(true)
  }
  expect(isAction('lava')).toBe(false)
  expect(isAction('lava+')).toBe(false)
  expect(isAction(3)).toBe(false)
})

test('seat: two players with 3 life and 1 mana, a third is refused, reseat is a no-op', async () => {
  const s = start()
  const fresh = { life: 3, mana: 1, picked: false, shieldLocked: false, drainCooldown: 0, superCooldown: 0, healCooldown: 0 }
  expect(s.duel.players).toEqual({ h: { name: 'dani', ...fresh }, g: { name: 'caren', ...fresh } })
  expect(s.duel.seq).toBe(2)
  expect(seat(s.duel, 'x', 'eve')).toBe(null)
  expect(seat(s.duel, 'g', 'caren')).toBe(null)
})

test('legal: mana, charge cap, shield lock, drain cooldown, heal at full life', async () => {
  const p = start().duel.players.h!
  expect(legal(p, 'charge')).toBe(true)
  expect(legal(p, 'shield')).toBe(true)
  expect(legal(p, 'fire')).toBe(true)
  expect(legal(p, 'drain')).toBe(true)
  expect(legal(p, 'fire+')).toBe(false)
  expect(legal({ ...p, mana: 2 }, 'fire+')).toBe(true)
  expect(legal({ ...p, mana: 0 }, 'fire')).toBe(false)
  expect(legal({ ...p, mana: 0 }, 'drain')).toBe(false)
  expect(legal({ ...p, mana: 3 }, 'charge')).toBe(false)
  expect(legal({ ...p, shieldLocked: true }, 'shield')).toBe(false)
  expect(legal({ ...p, drainCooldown: 1 }, 'drain')).toBe(false)
  expect(legal({ ...p, mana: 2 }, 'heal')).toBe(false)
  expect(legal({ ...p, mana: 1, life: 2 }, 'heal')).toBe(true)
  expect(legal({ ...p, mana: 0, life: 2 }, 'heal')).toBe(false)
  expect(legal({ ...p, life: 2, healCooldown: 1 }, 'heal')).toBe(false)
})

test('whyNot: says why a pick is not allowed', async () => {
  const p = start().duel.players.h!
  expect(whyNot(p, 'fire')).toBe(null)
  expect(whyNot(p, 'fire+')).toBe('needs 2 mana')
  expect(whyNot({ ...p, life: 2, mana: 0 }, 'heal')).toBe('needs 1 mana')
  expect(whyNot({ ...p, life: 2, healCooldown: 1 }, 'heal')).toBe('heal in 1')
  expect(whyNot({ ...p, mana: 2 }, 'heal')).toBe('life full')
  expect(whyNot({ ...p, mana: 3 }, 'charge')).toBe('mana full')
  expect(whyNot({ ...p, shieldLocked: true }, 'shield')).toBe('shield locked')
  expect(whyNot({ ...p, drainCooldown: 2 }, 'drain')).toBe('drain in 2')
  expect(whyNot({ ...p, superCooldown: 4 }, 'supercharge')).toBe('super in 4')
  expect(whyNot({ ...p, mana: 3 }, 'supercharge')).toBe('mana full')
  expect(whyNot({ ...p, mana: 2 }, 'supercharge')).toBe(null)
})

test('host rejects an illegal intent', async () => {
  const s = start()
  expect(act(s, 'h', 'fire+')).toBe(null)
  expect(act(s, 'h', 'heal')).toBe(null)
  expect(act(withPlayers({ mana: 3 }), 'h', 'charge')).toBe(null)
})

// Both at 2 life, 2 mana. [host, guest, host [life, mana], guest [life, mana]]
const MATRIX: [Action, Action, number[], number[]][] = [
  ['charge', 'charge', [2, 3], [2, 3]],
  ['charge', 'shield', [2, 3], [2, 2]],
  // Super charge: +2, but never past 3.
  ['supercharge', 'charge', [2, 3], [2, 3]],
  ['supercharge', 'shield', [2, 3], [2, 2]],
  ['supercharge', 'fire', [1, 3], [2, 1]],
  // Drain takes 2 from a super charger: 2 +2 (cap 3) -2.
  ['supercharge', 'drain', [1, 1], [2, 3]],
  ['charge', 'fire', [1, 3], [2, 1]],
  ['charge', 'fire+', [0, 3], [2, 0]],
  // Gains, then loses the mana to the drainer.
  ['charge', 'drain', [1, 2], [2, 2]],
  // Heal: +2, but never past 3.
  ['charge', 'heal', [2, 3], [3, 1]],
  ['shield', 'shield', [2, 2], [2, 2]],
  ['shield', 'fire', [2, 2], [2, 1]],
  ['shield', 'water+', [2, 2], [2, 0]],
  ['shield', 'drain', [2, 2], [2, 1]],
  ['shield', 'heal', [2, 2], [3, 1]],
  ['fire', 'water', [1, 1], [2, 1]],
  ['fire', 'fire', [2, 1], [2, 1]],
  ['fire', 'water+', [0, 1], [2, 0]],
  // The basic's element wins: its own 1 damage.
  ['fire+', 'water', [1, 0], [2, 1]],
  ['water+', 'fire', [2, 0], [0, 1]],
  // Same element: empowered wins, for 1.
  ['fire', 'fire+', [1, 1], [2, 0]],
  ['water+', 'fire+', [2, 0], [0, 0]],
  ['fire+', 'fire+', [2, 0], [2, 0]],
  ['fire', 'drain', [2, 1], [1, 1]],
  ['fire+', 'drain', [2, 0], [0, 1]],
  ['fire', 'heal', [2, 1], [1, 1]],
  ['nature+', 'heal', [2, 0], [0, 1]],
  ['drain', 'drain', [2, 1], [2, 1]],
  ['drain', 'heal', [2, 2], [1, 0]],
  ['heal', 'heal', [3, 1], [3, 1]],
]

for (const [h, g, hx, gx] of MATRIX) {
  test(`matrix: ${h} vs ${g}`, async () => {
    const s = round(withPlayers({ life: 2, mana: 2 }), h, g)
    expect(lm(s, 'h')).toEqual(hx)
    expect(lm(s, 'g')).toEqual(gx)
    // Mirrored, the same outcome.
    const m = round(withPlayers({ life: 2, mana: 2 }), g, h)
    expect(lm(m, 'h')).toEqual(gx)
    expect(lm(m, 'g')).toEqual(hx)
  })
}

test('result: loser, damage, theft and heals are recorded', async () => {
  const hit = round(withPlayers({ life: 2, mana: 2 }), 'fire', 'water+')
  expect(hit.duel.last).toEqual({ round: 1, picks: { h: 'fire', g: 'water+' }, loser: 'h', dmg: 2, stole: false, healed: {} })
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

test('shield lock: no shield the round after, back the round after that', async () => {
  let s = round(start(), 'shield', 'charge')
  expect(s.duel.players.h?.shieldLocked).toBe(true)
  expect(s.duel.players.g?.shieldLocked).toBe(false)
  expect(act(s, 'h', 'shield')).toBe(null)
  s = round(s, 'charge', 'charge')
  expect(s.duel.players.h?.shieldLocked).toBe(false)
  expect(act(s, 'h', 'shield')).not.toBe(null)
})

test('drain cooldown: out for two rounds whatever happened, back in the third', async () => {
  let s = round(withPlayers({ mana: 2 }), 'drain', 'shield')
  expect(s.duel.players.h?.drainCooldown).toBe(2)
  expect(act(s, 'h', 'drain')).toBe(null)
  s = round(s, 'charge', 'charge')
  expect(s.duel.players.h?.drainCooldown).toBe(1)
  expect(act(s, 'h', 'drain')).toBe(null)
  s = round(s, 'shield', 'shield')
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
  expect(two.duel.players.g).toMatchObject({ life: 2, mana: 0, picked: false })
  expect(two.duel.players.h).toMatchObject({ life: 3, mana: 0, picked: false })
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
  let s = round(withPlayers({ life: 1, mana: 2, shieldLocked: true, drainCooldown: 2 }), 'charge', 'fire+')
  expect(s.duel.players.h?.life).toBe(0)
  expect(s.duel.winner).toBe('g')
  expect(act(s, 'g', 'charge')).toBe(null)

  const again = applyIntent(s, 'h', { kind: 'rematch' })!
  expect(again.duel.winner).toBe(undefined)
  expect(again.duel.last).toBe(undefined)
  expect(again.duel.round).toBe(1)
  const fresh = { life: 3, mana: 1, picked: false, shieldLocked: false, drainCooldown: 0, superCooldown: 0, healCooldown: 0 }
  expect(again.duel.players.h).toEqual({ name: 'dani', ...fresh })
  expect(again.duel.players.g).toEqual({ name: 'caren', ...fresh })
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
  const won = round(withPlayers({ life: 1, mana: 2 }), 'charge', 'fire+')
  expect(applyIntent(won, 'h', { kind: 'rematch' })!.duel.tally).toBe(undefined)
})

test('summary: winner, rounds, share of picks, overused and unused actions', async () => {
  const d: Duel = {
    ...start().duel,
    round: 6,
    winner: 'g',
    last: { round: 5, picks: { h: 'charge', g: 'fire' }, loser: 'h', dmg: 1, stole: false, healed: {} },
    tally: { charge: 5, fire: 3, shield: 2 },
  }
  expect(summary(d)).toBe(
    'caren won in 5 rounds · charge 5 (50%) ⚠, fire 3 (30%), shield 2 (20%) · never: supercharge, drain, heal, water, nature, fire+, water+, nature+',
  )
})

test('super charge: +2 mana from empty', async () => {
  const s = round(withPlayers({ mana: 0 }), 'supercharge', 'charge')
  expect(lm(s, 'h')).toEqual([3, 2])
})

test('super charge drained: 2 mana taken, the drainer capped at 3', async () => {
  const s = round(withPlayers({ mana: 0 }, { mana: 3 }), 'supercharge', 'drain')
  expect(lm(s, 'h')).toEqual([2, 0])
  expect(lm(s, 'g')).toEqual([3, 3])
  expect(s.duel.last).toMatchObject({ loser: 'h', stole: true })
})

test('super charge cooldown: out for five rounds, back in the sixth', async () => {
  let s = round(withPlayers({ mana: 0 }), 'supercharge', 'charge')
  expect(s.duel.players.h?.superCooldown).toBe(5)
  for (let left = 4; left >= 0; left--) {
    expect(act(s, 'h', 'supercharge')).toBe(null)
    s = round(s, 'shield', 'shield')
    expect(s.duel.players.h?.superCooldown).toBe(left)
    s = { ...s, duel: { ...s.duel, players: Object.fromEntries(Object.entries(s.duel.players).map(([id, p]) => [id, { ...p, shieldLocked: false, mana: 0 }])) } }
  }
  expect(act(s, 'h', 'supercharge')).not.toBe(null)
})

test('heal: +2 from 1 life', async () => {
  const s = round(withPlayers({ life: 1, mana: 1 }), 'heal', 'shield')
  expect(lm(s, 'h')).toEqual([3, 0])
  expect(s.duel.last?.healed).toEqual({ h: 2 })
})

test('heal cooldown: not the round after, hit or not; back the round after that', async () => {
  let s = round(withPlayers({ life: 2, mana: 3 }), 'heal', 'fire')
  expect(s.duel.players.h?.healCooldown).toBe(1)
  expect(act(s, 'h', 'heal')).toBe(null)
  s = round(s, 'charge', 'charge')
  expect(s.duel.players.h?.healCooldown).toBe(0)
  expect(act(s, 'h', 'heal')).not.toBe(null)
})
