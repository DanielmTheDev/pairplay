// The duel stage, pure: pixels for a Raster of half blocks (two pixels a cell).
// drawStage(duel, width, t) paints the idle scene, or the round in duel.last at
// animation time t in [0, 1]. Host stands left, guest right, on both screens.

import type { Duel, Element } from '../types'

export const STAGE_ROWS = 12
export const STAGE_PX_H = STAGE_ROWS * 2
export const ANIM_MS = 2200
export const FRAME_MS = 66

const GROUND_Y = 22
const SPRITE_TOP = 5

// 0 is "no pixel": the terminal's own background shows through.
export const COLORS = {
  host: { H: 0x3355dd, h: 0xffdd33, S: 0xf2c9a0, E: 0x222222, B: 0xeeeeee, R: 0x2b44b8, r: 0x1c2f80, T: 0x8b5a2b, O: 0x99ddff },
  guest: { H: 0x7a1f3d, h: 0xffaa33, S: 0xe0b090, E: 0x222222, L: 0x3a2a1a, R: 0xc0304a, r: 0x80203a, T: 0x6b4a2b, O: 0xffcc88 },
  spell: {
    fire: [0xffee66, 0xff7a1a, 0xc02810],
    water: [0xe0ffff, 0x44aaff, 0x1f5fd0],
    nature: [0xeaffb0, 0x66cc33, 0x2f7a1f],
  } satisfies Record<Element, [number, number, number]>,
  orbPicked: 0xffffff,
  heart: 0xe8334a,
  heartLost: 0x444444,
  hit: 0xff2244,
  ground: [0x3d2f4f, 0x2a2036],
}

// Facing right; the guest is drawn mirrored so both staffs face the middle.
export const SPRITES = {
  host: [
    '....H......',
    '...HH......',
    '...HHH.....',
    '..HHhHH....',
    '..HHHHH...O',
    '.HHHHHHH..T',
    '...SSSS...T',
    '...SESE...T',
    '...BBBB...T',
    '..RBBBBR..T',
    '.RRRBBRRRST',
    '.RRRRRRRR.T',
    '.RRrRRRrR.T',
    '.RRrRRRrR.T',
    'RRRrRRRrRRT',
    'RRRRRRRRRRT',
    '.rr....rr.T',
  ],
  guest: [
    '...........',
    '...........',
    '....HHH....',
    '...HHHHH..O',
    '...HhhhH..T',
    'HHHHHHHHH.T',
    '..LSSSSL..T',
    '..LSESEL..T',
    '..LSSSSL..T',
    '..RRRRRR..T',
    '.RRRRRRRRST',
    '.RRRrrRRR.T',
    '.RRRrrRRR.T',
    '.RRRrrRRR.T',
    'RRRRrrRRRRT',
    'RRRRRRRRRRT',
    '.rr....rr.T',
  ],
}
const SPRITE_W = SPRITES.host[0]!.length
const HEART = ['X.X', 'XXX', '.X.']

export function stageColumns(bodyColumns: number) {
  return Math.max(30, Math.min(64, Math.floor(bodyColumns)))
}

type Canvas = { w: number; px: Uint32Array }

function put(c: Canvas, x: number, y: number, color: number) {
  x = Math.round(x)
  y = Math.round(y)
  if (x >= 0 && x < c.w && y >= 0 && y < STAGE_PX_H) c.px[y * c.w + x] = color
}

function grey(color: number) {
  const v = Math.round(((color >> 16) & 255) * 0.3 + ((color >> 8) & 255) * 0.59 + (color & 255) * 0.11) * 0.6
  const g = Math.round(v)
  return (g << 16) | (g << 8) | g
}

function sprite(c: Canvas, side: 'host' | 'guest', x0: number, opts: { orb: number; grey: boolean }) {
  const rows = SPRITES[side]
  const pal = COLORS[side] as Record<string, number>
  rows.forEach((row, y) => {
    const cols = side === 'guest' ? [...row].reverse() : [...row]
    cols.forEach((ch, x) => {
      if (ch === '.') return
      const color = ch === 'O' ? opts.orb : pal[ch]!
      put(c, x0 + x, SPRITE_TOP + y, opts.grey ? grey(color) : color)
    })
  })
}

function hearts(c: Canvas, x0: number, life: number) {
  for (let i = 0; i < 3; i++) {
    const color = i < life ? COLORS.heart : COLORS.heartLost
    HEART.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && put(c, x0 + i * 4 + x, 1 + y, color)))
  }
}

function orb(c: Canvas, cx: number, cy: number, r: number, pal: readonly number[]) {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x - cx, y - cy)
      if (d <= r) put(c, x, y, d <= r * 0.4 ? pal[0]! : d <= r * 0.75 ? pal[1]! : pal[2]!)
    }
  }
}

function ring(c: Canvas, cx: number, cy: number, r: number, color: number) {
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2
    put(c, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.7, color)
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k))
const phase = (t: number, from: number, to: number) => (t - from) / (to - from)

/** Pixels, row-major, width × STAGE_PX_H; 0 = empty. */
export function drawStage(duel: Duel, width: number, t?: number): Uint32Array {
  const c: Canvas = { w: width, px: new Uint32Array(width * STAGE_PX_H) }
  const [hostId, guestId] = Object.keys(duel.players)
  const ids = { host: hostId, guest: guestId }
  const xs = { host: 1, guest: width - 1 - SPRITE_W }
  // Staff tips: the 'O' pixel, guest mirrored.
  const tips = {
    host: { x: xs.host + 10, y: SPRITE_TOP + 4 },
    guest: { x: xs.guest, y: SPRITE_TOP + 3 },
  }
  const last = t === undefined ? undefined : duel.last
  const loserId = last?.loser ?? null
  const loserSide = loserId === null ? null : loserId === hostId ? 'host' : 'guest'
  const hitDone = last !== undefined && t !== undefined && t >= 0.85

  for (let x = 0; x < width; x++) {
    put(c, x, GROUND_Y, COLORS.ground[0]!)
    put(c, x, GROUND_Y + 1, COLORS.ground[1]!)
  }

  for (const side of ['host', 'guest'] as const) {
    const id = ids[side]
    if (!id) continue
    const p = duel.players[id]!
    // Mid-animation the loser keeps the heart until the hit lands.
    const life = last && side === loserSide && !hitDone ? p.life + 1 : p.life
    hearts(c, xs[side], life)
    const shake = last && side === loserSide && hitDone ? (Math.round(t! * 40) % 2 ? 1 : -1) : 0
    const isLoser = t === undefined && duel.winner !== undefined && duel.winner !== id
    const charging = last && t! < 0.5
    const spellPal = last ? COLORS.spell[last.picks[id]!] : undefined
    const orbColor = charging && spellPal ? spellPal[1]! : p.picked ? COLORS.orbPicked : COLORS[side].O
    sprite(c, side, xs[side] + shake, { orb: orbColor, grey: isLoser })
  }

  if (!last || t === undefined || !hostId || !guestId) return c.px
  const midX = width / 2
  const midY = 12
  const pal = (side: 'host' | 'guest') => COLORS.spell[last.picks[ids[side]!]!]

  if (t < 0.15) {
    // Charge: the tips swell.
    for (const side of ['host', 'guest'] as const) orb(c, tips[side].x, tips[side].y, lerp(0.5, 1.5, phase(t, 0, 0.15)), pal(side))
  } else if (t < 0.5) {
    // Fly: both orbs to the middle, leaving a short trail.
    const k = phase(t, 0.15, 0.5)
    for (const side of ['host', 'guest'] as const) {
      const dir = side === 'host' ? 1 : -1
      const x = lerp(tips[side].x, midX - dir * 2, k)
      const y = lerp(tips[side].y, midY, k) - Math.sin(k * Math.PI) * 2
      for (let i = 1; i <= 3; i++) put(c, x - dir * (i + 2), y, pal(side)[2]!)
      orb(c, x, y, 2, pal(side))
    }
  } else if (t < 0.62) {
    // Clash: rings of both colors burst in the middle.
    const r = lerp(2, 5, phase(t, 0.5, 0.62))
    ring(c, midX, midY, r, pal('host')[1]!)
    ring(c, midX, midY, r - 1, pal('guest')[1]!)
    orb(c, midX, midY, 1.5, [0xffffff, 0xffffff, 0xffffff])
  } else if (loserSide === null) {
    // Tie: sparks drift out and fade.
    const k = phase(t, 0.62, 1)
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * Math.PI * 2
      const side = a % 2 ? 'host' : 'guest'
      put(c, midX + Math.cos(ang) * lerp(5, 12, k), midY + Math.sin(ang) * lerp(3, 7, k), pal(side)[k < 0.6 ? 1 : 2]!)
    }
  } else {
    const winnerSide = loserSide === 'host' ? 'guest' : 'host'
    const target = { x: xs[loserSide] + SPRITE_W / 2, y: SPRITE_TOP + 9 }
    if (t < 0.85) {
      // The winning spell pushes through to the loser.
      const k = phase(t, 0.62, 0.85)
      orb(c, lerp(midX, target.x, k), lerp(midY, target.y, k), 2.5, pal(winnerSide))
    } else {
      // Hit: a red burst over the loser.
      const k = phase(t, 0.85, 1)
      ring(c, target.x, target.y, lerp(2, 6, k), COLORS.hit)
      orb(c, target.x, target.y, lerp(2.5, 1, k), [COLORS.hit, pal(winnerSide)[1]!, COLORS.hit])
    }
  }
  return c.px
}

const DEFAULT = 0x01000000
const UPPER = 0x2580
const LOWER = 0x2584

/** Raster cells for a pixel canvas: half blocks, two pixel rows a cell row. */
export function encodeCells(px: Uint32Array, width: number, heightPx: number): string {
  const rows = heightPx / 2
  const words = new Uint32Array(width * rows * 3)
  for (let r = 0; r < rows; r++) {
    for (let x = 0; x < width; x++) {
      const top = px[2 * r * width + x]!
      const bottom = px[(2 * r + 1) * width + x]!
      const i = (r * width + x) * 3
      if (top && bottom) words.set([UPPER, top, bottom], i)
      else if (top) words.set([UPPER, top, DEFAULT], i)
      else if (bottom) words.set([LOWER, bottom, DEFAULT], i)
      else words.set([0x20, DEFAULT, DEFAULT], i)
    }
  }
  return toBase64(new Uint8Array(words.buffer))
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

function toBase64(bytes: Uint8Array) {
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0)
    out += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]!
    out += i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '='
    out += i + 2 < bytes.length ? B64[n & 63]! : '='
  }
  return out
}
