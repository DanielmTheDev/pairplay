import { expect, test } from 'claude-code/testing'

import type { Action, Duel, Player } from '../types'
import {
  COLORS,
  GROUND_Y,
  SPRITES,
  SPRITE_TOP,
  STAGE_PX_H,
  drawStage,
  encodeCells,
  roundMs,
  stageColumns,
} from './scene'

const W = 48

const P = (name: string, over: Partial<Player> = {}): Player => ({
  name,
  life: 3,
  mana: 1,
  picked: false,
  shieldLocked: false,
  drainCooldown: 0,
  ...over,
})

const duel = (over: Partial<Duel> = {}): Duel => ({
  seq: 3,
  round: 1,
  players: { h: P('dani'), g: P('caren') },
  ...over,
})

/** The duel right after round 1: host cast `hp`, guest `gp`; `loser` takes `dmg`, down to `life`. */
const resolved = (hp: Action, gp: Action, loser: 'h' | 'g' | null, life = 2, dmg = 1): Duel => {
  const lethal = loser !== null && life === 0
  return duel({
    round: 2,
    players: {
      h: P('dani', { life: loser === 'h' ? life : 3 }),
      g: P('caren', { life: loser === 'g' ? life : 3 }),
    },
    last: { round: 1, picks: { h: hp, g: gp }, loser, dmg: loser ? dmg : 0, stole: false, healed: [] },
    ...(lethal ? { winner: loser === 'g' ? 'h' : 'g' } : {}),
  })
}
const SPELL = [...COLORS.spell.fire, ...COLORS.spell.water, ...COLORS.spell.nature]

type Box = { x0: number; x1: number; y0: number; y1: number }
const ALL: Box = { x0: 0, x1: W, y0: 0, y1: STAGE_PX_H }
const LEFT: Box = { ...ALL, x1: W / 2 }
const RIGHT: Box = { ...ALL, x0: W / 2 }

function count(px: Uint32Array, colors: number | readonly number[], b: Box = ALL) {
  const set = new Set(typeof colors === 'number' ? [colors] : colors)
  let n = 0
  for (let y = b.y0; y < b.y1; y++) for (let x = b.x0; x < b.x1; x++) if (set.has(px[y * W + x]!)) n++
  return n
}
const has = (px: Uint32Array, colors: number | readonly number[], b: Box = ALL) => count(px, colors, b) > 0

function bbox(px: Uint32Array, colors: number | readonly number[]) {
  const set = new Set(typeof colors === 'number' ? [colors] : colors)
  let x0 = W, x1 = -1, y0 = STAGE_PX_H, y1 = -1
  for (let y = 0; y < STAGE_PX_H; y++) {
    for (let x = 0; x < W; x++) {
      if (!set.has(px[y * W + x]!)) continue
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y)
    }
  }
  return { w: x1 - x0 + 1, h: y1 - y0 + 1, y0 }
}

const G = COLORS.guest
const GUEST_BODY = [G.H, G.h, G.S, G.L, G.R, G.r]

const view = (over: { me?: string; myPick?: Action; t?: number; now?: number } = {}) => ({ now: 0, ...over })

test('sprites are rectangular', async () => {
  for (const s of Object.values(SPRITES)) expect(new Set(s.map(r => r.length)).size).toBe(1)
})

test('stage width follows the pane, within bounds', async () => {
  expect(stageColumns(20)).toBe(30)
  expect(stageColumns(48)).toBe(48)
  expect(stageColumns(200)).toBe(64)
})

test('scene is fully painted: sky, ground, no holes', async () => {
  const px = drawStage(duel(), W, view())
  expect(px.length).toBe(W * STAGE_PX_H)
  expect([...px].every(c => c !== 0)).toBe(true)
  expect(has(px, COLORS.moon)).toBe(true)
})

test('same inputs, same pixels: both screens play the same frame', async () => {
  const d = resolved('fire', 'water', 'h')
  expect([...drawStage(d, W, view({ t: 1700, now: 99 }))]).toEqual([...drawStage(d, W, view({ t: 1700, now: 99 }))])
})

test('idle: host robe left, guest robe right, 6 full hearts', async () => {
  const px = drawStage(duel(), W, view())
  expect(has(px, COLORS.host.R, LEFT)).toBe(true)
  expect(has(px, COLORS.host.R, RIGHT)).toBe(false)
  expect(has(px, COLORS.guest.R, RIGHT)).toBe(true)
  expect(has(px, COLORS.heartLost)).toBe(false)
})

test('selection: own pick shows its icon, the opponent sees only a rune', async () => {
  const d = duel({
    players: { h: P('dani', { picked: true }), g: P('caren', { picked: true }) },
  })
  const asGuest = drawStage(d, W, view({ me: 'g', myPick: 'fire' }))
  expect(has(asGuest, COLORS.icon.fire, RIGHT)).toBe(true)
  expect(has(asGuest, COLORS.rune, LEFT)).toBe(true)
  for (const el of ['water', 'nature'] as const) expect(has(asGuest, COLORS.icon[el])).toBe(false)
  const unpicked = drawStage(duel(), W, view({ me: 'g' }))
  expect(has(unpicked, COLORS.rune)).toBe(false)
  expect(has(unpicked, COLORS.icon.fire)).toBe(false)
})

test('round length: tie < hit < death', async () => {
  const tie = roundMs(resolved('fire', 'fire', null))
  const hit = roundMs(resolved('water', 'fire', 'g'))
  const death = roundMs(resolved('water', 'fire', 'g', 0))
  expect(tie).toBeLessThan(hit)
  expect(hit).toBeLessThan(death)
})

test('fire and water fly through the air, nature creeps along the ground', async () => {
  const air: Box = { ...ALL, y1: GROUND_Y - 6 }
  const low: Box = { ...ALL, y0: GROUND_Y - 4, y1: GROUND_Y + 1 }
  const fw = drawStage(resolved('water', 'fire', 'g'), W, view({ t: 800 }))
  expect(has(fw, COLORS.spell.fire, air)).toBe(true)
  expect(has(fw, COLORS.spell.water, air)).toBe(true)
  const nn = drawStage(resolved('nature', 'nature', null), W, view({ t: 800 }))
  expect(has(nn, COLORS.spell.nature, low)).toBe(true)
  expect(has(nn, COLORS.spell.nature, air)).toBe(false)
})

test('hit: loser keeps the heart until impact, then bleeds and loses it', async () => {
  const d = resolved('water', 'fire', 'g')
  const flying = drawStage(d, W, view({ t: 700 }))
  expect(has(flying, COLORS.heartLost)).toBe(false)
  expect(has(flying, COLORS.blood)).toBe(false)
  const impact = drawStage(d, W, view({ t: 2300 }))
  expect(has(impact, COLORS.heartLost, RIGHT)).toBe(true)
  expect(has(impact, [COLORS.hit, ...COLORS.blood], RIGHT)).toBe(true)
})

test('tie: nobody is hit or bleeds', async () => {
  const d = resolved('fire', 'fire', null)
  for (const t of [400, 1300, 2000]) {
    const px = drawStage(d, W, view({ t }))
    expect(has(px, COLORS.hit)).toBe(false)
    expect(has(px, COLORS.blood)).toBe(false)
  }
})

test('death: loser falls flat in an excessive amount of blood, KO! shown', async () => {
  const d = resolved('water', 'fire', 'g', 0)
  const end = drawStage(d, W, view({ t: roundMs(d) - 50 }))
  const body = bbox(end, GUEST_BODY)
  expect(body.w).toBeGreaterThan(body.h)
  expect(count(end, COLORS.blood)).toBeGreaterThan(80)
  expect(has(end, COLORS.ko)).toBe(true)
  // Standing at the start of the round.
  const start = bbox(drawStage(d, W, view({ t: 100 })), GUEST_BODY)
  expect(start.h).toBeGreaterThan(start.w)
})

test('victory: winner raises the staff above the hat', async () => {
  const d = resolved('water', 'fire', 'g', 0)
  const idle = drawStage(d, W, view({ now: 5000 }))
  expect(bbox(idle, COLORS.host.T).y0).toBeLessThan(SPRITE_TOP)
  expect(bbox(drawStage(duel(), W, view()), COLORS.host.T).y0).toBeGreaterThanOrEqual(SPRITE_TOP)
  // The corpse stays down, in its blood, until the rematch.
  const body = bbox(idle, GUEST_BODY)
  expect(body.w).toBeGreaterThan(body.h)
  expect(count(idle, COLORS.blood)).toBeGreaterThan(80)
})

test('cells: half blocks pack two pixels per cell, default color for empty', async () => {
  const D = 0x01000000
  const px = Uint32Array.of(0xff0000, 0, 0, 0x00ff00, 0, 0x0000ff, 0, 0x111111)
  const words = decode(encodeCells(px, 2, 4))
  expect([...words]).toEqual([
    0x2580, 0xff0000, D,
    0x2584, 0x00ff00, D,
    0x20, D, D,
    0x2580, 0x0000ff, 0x111111,
  ])
})

function decode(b64: string) {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new Uint32Array(bytes.buffer)
}

test('mana: crystals in the ground under each wizard, lit for mana held', async () => {
  const d = duel({ players: { h: P('dani', { mana: 3 }), g: P('caren', { mana: 0 }) } })
  const px = drawStage(d, W, view())
  expect(count(px, COLORS.mana, LEFT)).toBe(12)
  expect(count(px, COLORS.mana, RIGHT)).toBe(0)
  expect(count(px, COLORS.manaEmpty, RIGHT)).toBe(12)
  const one = drawStage(duel(), W, view())
  expect(count(one, COLORS.mana, LEFT)).toBe(4)
})

test('selection: an empowered pick shows its element icon; other picks a rune of their own', async () => {
  const d = duel({ players: { h: P('dani', { picked: true }), g: P('caren', { picked: true }) } })
  expect(has(drawStage(d, W, view({ me: 'g', myPick: 'water+' })), COLORS.icon.water, RIGHT)).toBe(true)
  for (const a of ['charge', 'shield', 'drain', 'heal'] as const) {
    const px = drawStage(d, W, view({ me: 'g', myPick: a }))
    expect(has(px, COLORS.pickIcon[a], RIGHT)).toBe(true)
  }
})

test('empowered spells blaze bigger than basic ones', async () => {
  const basic = count(drawStage(resolved('fire', 'charge', 'g'), W, view({ t: 800 })), COLORS.spell.fire)
  const big = count(drawStage(resolved('fire+', 'charge', 'g', 1, 2), W, view({ t: 800 })), COLORS.spell.fire)
  expect(big).toBeGreaterThan(basic + 10)
})

test('drain flies as a violet orb, no element colors', async () => {
  const px = drawStage(resolved('drain', 'charge', 'g'), W, view({ t: 800 }))
  expect(has(px, COLORS.drain)).toBe(true)
  expect(has(px, SPELL)).toBe(false)
})

test('charge vs charge: mana sparks gather, nothing flies, nobody bleeds', async () => {
  const d = resolved('charge', 'charge', null)
  expect(roundMs(d)).toBe(roundMs(resolved('fire', 'fire', null)))
  const px = drawStage(d, W, view({ t: 800 }))
  expect(count(px, COLORS.mana, LEFT)).toBeGreaterThan(4)
  expect(count(px, COLORS.mana, RIGHT)).toBeGreaterThan(4)
  for (const t of [400, 1300, 2000]) {
    const f = drawStage(d, W, view({ t }))
    expect(has(f, SPELL)).toBe(false)
    expect(has(f, COLORS.blood)).toBe(false)
  }
})

test('shield: a bubble in front, the spell bursts on it, nobody bleeds', async () => {
  const d = resolved('shield', 'fire', null)
  const px = drawStage(d, W, view({ t: 1500 }))
  expect(has(px, COLORS.shield, LEFT)).toBe(true)
  expect(has(px, COLORS.shield, RIGHT)).toBe(false)
  for (const t of [800, 1500, 2000]) {
    const f = drawStage(d, W, view({ t }))
    expect(has(f, COLORS.hit)).toBe(false)
    expect(has(f, COLORS.blood)).toBe(false)
  }
  // The fireball reached the left half, where the shield is.
  expect(has(drawStage(d, W, view({ t: 1700 })), COLORS.spell.fire, LEFT)).toBe(true)
})

test('one-sided: a spell at a charger flies all the way and hits', async () => {
  const d = resolved('charge', 'water', 'h')
  expect(has(drawStage(d, W, view({ t: 1700 })), COLORS.spell.water, LEFT)).toBe(true)
  const impact = drawStage(d, W, view({ t: 2300 }))
  expect(has(impact, [COLORS.hit, ...COLORS.blood], LEFT)).toBe(true)
  expect(has(impact, COLORS.heartLost, LEFT)).toBe(true)
})

test('big hit: -2 takes two hearts at impact', async () => {
  const d = resolved('fire', 'water+', 'h', 1, 2)
  expect(count(drawStage(d, W, view({ t: 700 })), COLORS.heartLost)).toBe(0)
  expect(count(drawStage(d, W, view({ t: roundMs(d) - 50 })), COLORS.heartLost, LEFT)).toBe(12)
})

test('heal: sparkles rise and the heart comes back', async () => {
  const d = duel({
    round: 2,
    players: { h: P('dani', { life: 3 }), g: P('caren') },
    last: { round: 1, picks: { h: 'heal', g: 'charge' }, loser: null, dmg: 0, stole: false, healed: ['h'] },
  })
  expect(count(drawStage(d, W, view({ t: 400 })), COLORS.heartLost, LEFT)).toBe(6)
  expect(has(drawStage(d, W, view({ t: 1700 })), COLORS.healSpark, LEFT)).toBe(true)
  expect(has(drawStage(d, W, view({ t: roundMs(d) - 50 })), COLORS.heartLost)).toBe(false)
})

test('heal hit: fizzles, no sparkles', async () => {
  const d = duel({
    round: 2,
    players: { h: P('dani', { life: 1 }), g: P('caren') },
    last: { round: 1, picks: { h: 'heal', g: 'fire' }, loser: 'h', dmg: 1, stole: false, healed: [] },
  })
  for (const t of [800, 1700, 2300]) expect(has(drawStage(d, W, view({ t })), COLORS.healSpark)).toBe(false)
})
