import { expect, test } from 'claude-code/testing'

import type { Action, ChaosEvent, Duel, Player } from '../types'
import { CHAOS_EVENTS } from './game'
import {
  AVATAR_PRELUDE,
  CARD_COLS,
  CARD_PX_H,
  CHAOS_MS,
  COLORS,
  GROUND_Y,
  SPRITES,
  SPRITE_TOP,
  STAGE_PX_H,
  REMATCH_COLS,
  drawCards,
  drawRematch,
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
  shieldCooldown: 0,
  drainCooldown: 0,
  healCooldown: 0,
  avatarRounds: 0,
  avatarCooldown: 0,
  ...over,
})

const duel = (over: Partial<Duel> = {}): Duel => ({
  seq: 3,
  round: 1,
  players: { h: P('dani'), g: P('caren') },
  ...over,
})

/**
 * The duel right after round 1: host cast `hp`, guest `gp`; `loser` takes `dmg`, down to `life`.
 * `buffed`: who was in the Avatar State that round; `rounds`: how long the host's holds on.
 */
const resolved = (hp: Action, gp: Action, loser: 'h' | 'g' | null, life = 2, dmg = 1, buffed: string[] = [], rounds = hp === 'avatar' ? 3 : 0): Duel => {
  const lethal = loser !== null && life === 0
  return duel({
    round: 2,
    players: {
      h: P('dani', { life: loser === 'h' ? life : 3, avatarRounds: rounds }),
      g: P('caren', { life: loser === 'g' ? life : 3 }),
    },
    last: { round: 1, picks: { h: hp, g: gp }, loser, dmg: loser ? dmg : 0, stole: false, healed: {}, buffed },
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

const view = (over: { me?: string; myPick?: Action; t?: number; now?: number; chaosT?: number } = {}) => ({ now: 0, ...over })

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

test('mana: gems set in the ground under each wizard, lit for mana held', async () => {
  const d = duel({ players: { h: P('dani', { mana: 3 }), g: P('caren', { mana: 0 }) } })
  const px = drawStage(d, W, view())
  const underL: Box = { ...LEFT, y0: GROUND_Y + 1 }
  const underR: Box = { ...RIGHT, y0: GROUND_Y + 1 }
  expect(count(px, COLORS.gem[1], underL)).toBe(12)
  expect(count(px, COLORS.gem[1], underR)).toBe(0)
  expect(count(px, COLORS.manaEmpty, underR)).toBe(33)
  // Lit gems glow into the dirt around them, and twinkle.
  expect(has(px, COLORS.gemGlow, LEFT)).toBe(true)
  const frames = new Set([0, 200, 400, 600, 800].map(now => drawStage(d, W, view({ now })).join()))
  expect(frames.size).toBeGreaterThan(1)
  expect(count(drawStage(duel(), W, view()), COLORS.gem[1], LEFT)).toBe(4)
})

test('avatar charge: twice the sparks of a charge', async () => {
  const d = resolved('charge', 'charge', null, 2, 1, ['h'], 2)
  const px = drawStage(d, W, view({ t: 800 }))
  expect(count(px, COLORS.mana, LEFT)).toBeGreaterThan(count(px, COLORS.mana, RIGHT) + 5)
})

test('selection: a spell pick shows its element icon; other picks a rune of their own', async () => {
  const d = duel({ players: { h: P('dani', { picked: true }), g: P('caren', { picked: true }) } })
  expect(has(drawStage(d, W, view({ me: 'g', myPick: 'water' })), COLORS.icon.water, RIGHT)).toBe(true)
  for (const a of ['charge', 'shield', 'drain', 'heal', 'avatar'] as const) {
    const px = drawStage(d, W, view({ me: 'g', myPick: a }))
    expect(has(px, COLORS.pickIcon[a], RIGHT)).toBe(true)
  }
})

test('an avatar\'s spells blaze bigger than plain ones', async () => {
  const basic = count(drawStage(resolved('fire', 'charge', 'g'), W, view({ t: 800 })), COLORS.spell.fire)
  const big = count(drawStage(resolved('fire', 'charge', 'g', 1, 2, ['h'], 2), W, view({ t: 800 })), COLORS.spell.fire)
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
  const d = resolved('fire', 'water', 'h', 1, 2)
  expect(count(drawStage(d, W, view({ t: 700 })), COLORS.heartLost)).toBe(0)
  expect(count(drawStage(d, W, view({ t: roundMs(d) - 50 })), COLORS.heartLost, LEFT)).toBe(12)
})

test('heal: sparkles rise and the heart comes back', async () => {
  const d = duel({
    round: 2,
    players: { h: P('dani', { life: 3 }), g: P('caren') },
    last: { round: 1, picks: { h: 'heal', g: 'charge' }, loser: null, dmg: 0, stole: false, healed: { h: 1 }, buffed: [] },
  })
  expect(count(drawStage(d, W, view({ t: 400 })), COLORS.heartLost, LEFT)).toBe(6)
  expect(has(drawStage(d, W, view({ t: 1700 })), COLORS.healSpark, LEFT)).toBe(true)
  expect(has(drawStage(d, W, view({ t: roundMs(d) - 50 })), COLORS.heartLost)).toBe(false)
})

test('heal hit: fizzles, no sparkles', async () => {
  const d = duel({
    round: 2,
    players: { h: P('dani', { life: 1 }), g: P('caren') },
    last: { round: 1, picks: { h: 'heal', g: 'fire' }, loser: 'h', dmg: 1, stole: false, healed: {}, buffed: [] },
  })
  for (const t of [800, 1700, 2300]) expect(has(drawStage(d, W, view({ t })), COLORS.healSpark)).toBe(false)
})

// ─── action cards ────────────────────────────────────────────────────────────

const CW = CARD_COLS
const card = (px: Uint32Array, i: number, n: number) => {
  const out: number[] = []
  for (let y = 0; y < CARD_PX_H; y++) for (let x = i * CW; x < (i + 1) * CW; x++) out.push(px[y * n * CW + x]!)
  return out
}
const gray = (c: number) => ((c >> 16) & 255) === ((c >> 8) & 255) && ((c >> 8) & 255) === (c & 255)

test('cards: one per action, side by side, a transparent gap between', async () => {
  const px = drawCards(['charge', 'fire'], P('dani'), 0)
  expect(px.length).toBe(2 * CW * CARD_PX_H)
  for (let y = 0; y < CARD_PX_H; y++) expect(px[y * 2 * CW + CW - 1]).toBe(0)
})

test('cards: a ready spell is drawn in its colors, and moves', async () => {
  const a = card(drawCards(['fire'], P('dani'), 0), 0, 1)
  expect(a.some(c => (COLORS.spell.fire as readonly number[]).includes(c))).toBe(true)
  const frames = new Set([0, 150, 300, 450].map(now => drawCards(['fire'], P('dani'), now).join()))
  expect(frames.size).toBeGreaterThan(1)
  for (const act of ['charge', 'shield', 'drain', 'water', 'nature'] as const) {
    expect(card(drawCards([act], P('dani', { life: 2 }), 0), 0, 1).some(c => c !== 0 && !gray(c))).toBe(true)
  }
  // Each its own drawing.
  const looks = new Set((['pass', 'charge', 'shield', 'drain', 'heal', 'fire', 'water', 'nature', 'avatar'] as const).map(a => drawCards([a], P('dani', { life: 2, mana: 3 }), 0).join()))
  expect(looks.size).toBe(9)
})

test('cards: in the Avatar State, elements and charge glow gold', async () => {
  for (const a of ['fire', 'water', 'nature', 'charge'] as const) {
    const plain = card(drawCards([a], P('dani', { mana: 1 }), 0), 0, 1)
    const buffed = card(drawCards([a], P('dani', { mana: 1, avatarRounds: 2 }), 0), 0, 1)
    expect(plain.includes(COLORS.cardGold)).toBe(false)
    expect(buffed.includes(COLORS.cardGold)).toBe(true)
  }
  expect(card(drawCards(['shield'], P('dani', { avatarRounds: 2 }), 0), 0, 1).includes(COLORS.cardGold)).toBe(false)
  // Out of mana, an element is cast plain.
  expect(card(drawCards(['fire'], P('dani', { mana: 0, avatarRounds: 2 }), 0), 0, 1).includes(COLORS.cardGold)).toBe(false)
})

test('cards: the one under the pointer lights up', async () => {
  const p = P('dani', { life: 2, mana: 2 })
  const px = drawCards(['fire', 'water'], p, 0, {}, 1)
  expect(card(px, 1, 2).includes(COLORS.cardHover)).toBe(true)
  expect(card(px, 0, 2).includes(COLORS.cardHover)).toBe(false)
  expect(card(drawCards(['fire', 'water'], p, 0), 1, 2).includes(COLORS.cardHover)).toBe(false)
})

test('cards: what is not allowed is grey; a cooldown shows its rounds left in red', async () => {
  const p = P('dani', { mana: 1, shieldCooldown: 2, drainCooldown: 2 })
  const px = drawCards(['avatar', 'shield', 'drain', 'fire'], p, 0)
  const [big, shield, drain, fire] = [0, 1, 2, 3].map(i => card(px, i, 4))
  expect(big!.every(c => c === 0 || gray(c) || c === COLORS.manaShort)).toBe(true)
  expect(big!.includes(COLORS.cooldown)).toBe(false)
  expect(shield!.includes(COLORS.cooldown)).toBe(true)
  expect(drain!.includes(COLORS.cooldown)).toBe(true)
  expect(fire!.includes(COLORS.cooldown)).toBe(false)
})

test('cards: cost shown as mana pips, missing ones marked', async () => {
  const pips = (a: 'charge' | 'fire' | 'avatar', mana: number, avatarRounds = 0) => {
    const c = card(drawCards([a], P('dani', { mana, avatarRounds }), 0), 0, 1)
    return [c.filter(x => x === COLORS.mana).length, c.filter(x => x === COLORS.manaShort).length]
  }
  expect(pips('charge', 1)).toEqual([0, 0])
  // The elements are free; in the Avatar State they cost 1, unless cast plain.
  expect(pips('fire', 1)).toEqual([0, 0])
  expect(pips('fire', 1, 2)).toEqual([2, 0])
  expect(pips('fire', 0, 2)).toEqual([0, 0])
  // The Avatar State costs 2 but needs a full 3: the third pip only asks for it.
  expect(pips('avatar', 3)).toEqual([4, 0])
  expect(pips('avatar', 2)).toEqual([0, 6])
})

test('rematch: a card of its own, wider; an hourglass runs out, turns, runs again; lit under the pointer', async () => {
  const px = drawRematch(0)
  expect(px.length).toBe(REMATCH_COLS * CARD_PX_H)
  expect(px.some(c => c !== 0 && !gray(c))).toBe(true)
  expect(px.includes(COLORS.sand)).toBe(true)
  const frames = new Set([0, 600, 1200, 1800, 2400].map(now => drawRematch(now).join()))
  expect(frames.size).toBeGreaterThan(2)
  // Sand runs down: the bottom bulb fills as the top one empties.
  const sandIn = (now: number, top: boolean) => {
    const p = drawRematch(now)
    let n = 0
    for (let y = top ? 0 : 5; y < (top ? 5 : CARD_PX_H); y++) for (let x = 0; x < REMATCH_COLS; x++) if (p[y * REMATCH_COLS + x] === COLORS.sand) n++
    return n
  }
  expect(sandIn(100, true)).toBeGreaterThan(sandIn(1500, true))
  expect(sandIn(100, false)).toBeLessThan(sandIn(1500, false))
  expect(drawRematch(0).includes(COLORS.cardHover)).toBe(false)
  expect(drawRematch(0, true).includes(COLORS.cardHover)).toBe(true)
})

// ─── the Avatar State ────────────────────────────────────────────────────────

test('avatar: enters the Avatar State first, the round waits for it', async () => {
  const d = resolved('avatar', 'fire', 'h', 2, 1)
  expect(roundMs(d)).toBe(roundMs(resolved('charge', 'fire', 'h', 2, 1)) + AVATAR_PRELUDE)
  // Nothing flies yet, nobody bleeds.
  const rising = drawStage(d, W, view({ t: AVATAR_PRELUDE - 200 }))
  expect(has(rising, COLORS.blood)).toBe(false)
  expect(has(rising, COLORS.heartLost)).toBe(false)
})

test('avatar: eyes and arrow tattoo aglow, rising inside a sphere of the four elements', async () => {
  const d = resolved('avatar', 'charge', null)
  const px = drawStage(d, W, view({ t: 1200 }))
  expect(has(px, COLORS.avatar.eye, LEFT)).toBe(true)
  expect(has(px, COLORS.avatar.arrow, LEFT)).toBe(true)
  expect(has(px, COLORS.avatar.aura, LEFT)).toBe(true)
  for (const col of COLORS.avatar.pal.slice(1)) expect(has(px, col, LEFT)).toBe(true)
  // Lifted off the ground.
  const plain = resolved('charge', 'charge', null)
  expect(bbox(px, COLORS.host.R).y0).toBeLessThan(bbox(drawStage(plain, W, view()), COLORS.host.R).y0)
  // Entering is no attack: nothing of it flies across.
  const later = drawStage(d, W, view({ t: AVATAR_PRELUDE + 900 }))
  const middle: Box = { ...ALL, x0: 18, x1: 30, y1: GROUND_Y }
  expect(has(later, COLORS.avatar.pal.slice(1), middle)).toBe(false)
})

test('avatar: while it holds, the wizard floats softly, eyes aglow; the other stays as they are', async () => {
  const d = duel({ players: { h: P('dani', { avatarRounds: 2 }), g: P('caren') } })
  const a = drawStage(d, W, view({ now: 0 }))
  expect(has(a, COLORS.avatar.eye, LEFT)).toBe(true)
  expect(has(a, COLORS.avatar.aura, LEFT)).toBe(true)
  expect(has(a, COLORS.avatar.eye, RIGHT)).toBe(false)
  const grounded = bbox(drawStage(duel(), W, view({ now: 0 })), COLORS.host.R).y0
  const ys = new Set([0, 300, 600, 900, 1200].map(now => bbox(drawStage(d, W, view({ now })), COLORS.host.R).y0))
  for (const y of ys) expect(y).toBeLessThan(grounded)
  expect(ys.size).toBeGreaterThan(1)
  // Without it, none of that.
  const idle = drawStage(duel(), W, view())
  for (const col of [COLORS.avatar.eye, COLORS.avatar.arrow, COLORS.avatar.aura]) expect(has(idle, col)).toBe(false)
})

test('avatar: its last round played, the glow goes out and the wizard comes down', async () => {
  const d = resolved('fire', 'charge', 'g', 1, 2, ['h'], 0)
  expect(has(drawStage(d, W, view({ t: 400 })), COLORS.avatar.eye, LEFT)).toBe(true)
  const end = drawStage(d, W, view({ t: roundMs(d) - 50 }))
  expect(has(end, COLORS.avatar.eye)).toBe(false)
  const grounded = bbox(drawStage(duel(), W, view()), COLORS.host.R).y0
  expect(bbox(end, COLORS.host.R).y0).toBe(grounded)
  expect(has(drawStage(d, W, view()), COLORS.avatar.eye)).toBe(false)
})

// ─── chaos ───────────────────────────────────────────────────────────────────

/** Round 4, just struck by `event`: both went from 1 to 3 mana (whatever the event, for the stage). */
const struck = (event: ChaosEvent, over: Partial<Duel> = {}): Duel =>
  duel({
    round: 4,
    players: { h: P('dani', { mana: 3 }), g: P('caren', { mana: 3 }) },
    chaos: { event, round: 4, until: event === 'volcano' || event === 'eclipse' ? 5 : 4, before: { h: { life: 3, mana: 1 }, g: { life: 3, mana: 1 } } },
    chaosCount: 1,
    ...over,
  })

test('chaos: every event has an animation of its own, the same on both screens', async () => {
  const looks = new Set<string>()
  for (const e of CHAOS_EVENTS) {
    const d = struck(e)
    const px = drawStage(d, W, view({ chaosT: 1500 }))
    expect([...px].every(c => c !== 0)).toBe(true)
    expect([...px]).toEqual([...drawStage(d, W, view({ chaosT: 1500 }))])
    const frames = new Set([300, 1200, 2000, 2900, 3600].map(chaosT => drawStage(d, W, view({ chaosT })).join()))
    expect(frames.size).toBeGreaterThan(3)
    looks.add(px.join())
  }
  expect(looks.size).toBe(CHAOS_EVENTS.length)
})

test('chaos: mana changes on cue, once the world has struck', async () => {
  const d = struck('lightning')
  const underL: Box = { ...LEFT, y0: GROUND_Y + 1 }
  expect(count(drawStage(d, W, view({ chaosT: 500 })), COLORS.gem[1], underL)).toBe(4)
  expect(count(drawStage(d, W, view()), COLORS.gem[1], underL)).toBe(12)
  // The round before it still plays with the old values.
  const played = { ...d, last: { round: 3, picks: { h: 'shield', g: 'shield' }, loser: null, dmg: 0, stole: false, healed: {}, buffed: [] } } satisfies Duel
  expect(count(drawStage(played, W, view({ t: 500 })), COLORS.gem[1], underL)).toBe(4)
})

test('chaos: healing rain gives the heart back on cue', async () => {
  const d = struck('rain', {
    players: { h: P('dani', { life: 3 }), g: P('caren') },
    chaos: { event: 'rain', round: 4, until: 4, before: { h: { life: 2, mana: 1 }, g: { life: 3, mana: 1 } } },
  })
  expect(count(drawStage(d, W, view({ chaosT: 500 })), COLORS.heartLost, LEFT)).toBe(6)
  expect(count(drawStage(d, W, view()), COLORS.heartLost)).toBe(0)
})

test('chaos: nobody bleeds from it', async () => {
  for (const e of CHAOS_EVENTS) {
    for (const chaosT of [500, 1500, 2500, 3500]) expect(has(drawStage(struck(e), W, view({ chaosT })), [COLORS.hit, ...COLORS.blood])).toBe(false)
  }
})

test('eclipse: the moon stays dark while it holds', async () => {
  const d = struck('eclipse')
  expect(has(drawStage(d, W, view()), COLORS.moon)).toBe(false)
  expect(has(drawStage(d, W, view()), COLORS.chaos.corona)).toBe(true)
  expect(has(drawStage(duel({ round: 6, chaos: d.chaos! }), W, view()), COLORS.moon)).toBe(true)
})

test('volcano: smokes on the horizon while it holds', async () => {
  const d = struck('volcano')
  expect(has(drawStage(d, W, view()), COLORS.chaos.rock)).toBe(true)
  expect(has(drawStage(duel({ round: 6, chaos: d.chaos! }), W, view()), COLORS.chaos.rock)).toBe(false)
})

test('chaos runs a fixed length', async () => {
  expect(CHAOS_MS).toBeGreaterThan(3000)
})
