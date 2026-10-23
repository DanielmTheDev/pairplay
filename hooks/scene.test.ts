import { expect, test } from 'claude-code/testing'

import type { Duel } from '../types'
import { COLORS, SPRITES, STAGE_PX_H, drawStage, encodeCells, stageColumns } from './scene'

const duel = (over: Partial<Duel> = {}): Duel => ({
  seq: 3,
  round: 1,
  players: {
    h: { name: 'dani', life: 3, picked: false },
    g: { name: 'caren', life: 3, picked: false },
  },
  ...over,
})
const resolved = (loser: string | null): Duel =>
  duel({
    round: 2,
    players: {
      h: { name: 'dani', life: 3, picked: false },
      g: { name: 'caren', life: loser === 'g' ? 2 : 3, picked: false },
    },
    last: { round: 1, picks: { h: 'water', g: 'fire' }, loser },
  })

const W = 40
const has = (px: Uint32Array, color: number, x0 = 0, x1 = W) => {
  for (let y = 0; y < STAGE_PX_H; y++) for (let x = x0; x < x1; x++) if (px[y * W + x] === color) return true
  return false
}

test('sprites are rectangular', async () => {
  for (const s of Object.values(SPRITES)) expect(new Set(s.map(r => r.length)).size).toBe(1)
})

test('stage width follows the pane, within bounds', async () => {
  expect(stageColumns(20)).toBe(30)
  expect(stageColumns(48)).toBe(48)
  expect(stageColumns(200)).toBe(64)
})

test('idle: host robe on the left, guest robe on the right, 6 full hearts', async () => {
  const px = drawStage(duel(), W)
  expect(px.length).toBe(W * STAGE_PX_H)
  expect(has(px, COLORS.host.R, 0, W / 2)).toBe(true)
  expect(has(px, COLORS.host.R, W / 2, W)).toBe(false)
  expect(has(px, COLORS.guest.R, W / 2, W)).toBe(true)
  expect(has(px, COLORS.heartLost)).toBe(false)
})

test('picked: staff orb glows white', async () => {
  expect(has(drawStage(duel(), W), COLORS.orbPicked)).toBe(false)
  const picked = duel({ players: { ...duel().players, g: { name: 'caren', life: 3, picked: true } } })
  expect(has(drawStage(picked, W), COLORS.orbPicked, W / 2, W)).toBe(true)
})

test('animation: both spells fly mid-way, loser flashes at the end', async () => {
  const d = resolved('g')
  const mid = drawStage(d, W, 0.35)
  expect(has(mid, COLORS.spell.fire[1])).toBe(true)
  expect(has(mid, COLORS.spell.water[1])).toBe(true)
  expect(has(mid, COLORS.hit)).toBe(false)
  // Before the hit the loser still shows the heart it is about to lose.
  expect(has(mid, COLORS.heartLost)).toBe(false)
  const hit = drawStage(d, W, 0.9)
  expect(has(hit, COLORS.hit, W / 2, W)).toBe(true)
  expect(has(hit, COLORS.heartLost)).toBe(true)
})

test('tie: no hit flash', async () => {
  const d = resolved(null)
  for (const t of [0.3, 0.6, 0.9]) expect(has(drawStage(d, W, t), COLORS.hit)).toBe(false)
})

test('winner: loser drawn grey, no robe color', async () => {
  const d = { ...resolved('g'), winner: 'h' }
  const px = drawStage(d, W)
  expect(has(px, COLORS.guest.R)).toBe(false)
  expect(has(px, COLORS.host.R)).toBe(true)
})

test('cells: half blocks pack two pixels per cell, default color for empty', async () => {
  const D = 0x01000000
  const px = Uint32Array.of(0xff0000, 0, 0, 0x00ff00, 0, 0x0000ff, 0, 0x111111)
  // 2 columns x 4 pixel rows → 2 x 2 cells
  const words = decode(encodeCells(px, 2, 4))
  expect([...words]).toEqual([
    0x2580, 0xff0000, D, // top only: upper half
    0x2584, 0x00ff00, D, // bottom only: lower half
    0x20, D, D, // empty
    0x2580, 0x0000ff, 0x111111, // both: upper half fg = top, bg = bottom
  ])
})

function decode(b64: string) {
  const bin = atob(b64)
  const bytes = Uint8Array.from(bin, c => c.charCodeAt(0))
  return new Uint32Array(bytes.buffer)
}
