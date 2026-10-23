import { expect, test } from 'claude-code/testing'

import type { Duel, Element } from '../types'
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

const duel = (over: Partial<Duel> = {}): Duel => ({
  seq: 3,
  round: 1,
  players: {
    h: { name: 'dani', life: 3, picked: false },
    g: { name: 'caren', life: 3, picked: false },
  },
  ...over,
})

/** The duel right after round 1: host cast `hp`, guest `gp`; `loser` loses one life (to `life`). */
const resolved = (hp: Element, gp: Element, loser: 'h' | 'g' | null, life = 2): Duel => {
  const lethal = loser !== null && life === 0
  return duel({
    round: 2,
    players: {
      h: { name: 'dani', life: loser === 'h' ? life : 3, picked: false },
      g: { name: 'caren', life: loser === 'g' ? life : 3, picked: false },
    },
    last: { round: 1, picks: { h: hp, g: gp }, loser },
    ...(lethal ? { winner: loser === 'g' ? 'h' : 'g' } : {}),
  })
}

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

const view = (over: { me?: string; myPick?: Element; t?: number; now?: number } = {}) => ({ now: 0, ...over })

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
    players: {
      h: { name: 'dani', life: 3, picked: true },
      g: { name: 'caren', life: 3, picked: true },
    },
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
