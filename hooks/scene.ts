// The duel stage, pure: pixels for a Raster of half blocks (two pixels a cell).
// drawStage(duel, width, view) paints the scene at `view.now` (idle loop), or the
// round in duel.last `view.t` ms into its animation. Host left, guest right, on
// both screens; every random thing is seeded by the round, so both play alike.

import type { Action, Duel, Element, Player } from '../types'
import { COST, elementOf, isEmpowered, MAX_MANA, whyNot } from './game'

export const STAGE_ROWS = 16
export const STAGE_PX_H = STAGE_ROWS * 2
export const FRAME_MS = 66
export const GROUND_Y = 25
export const SPRITE_TOP = 8
const SPRITE_H = 17

// Round timeline, ms from the start of the animation.
const CHARGE_END = 350
const TRAVEL_END = 1150
const CLASH_END = 1450
const TIE_END = 2200
const PUSH_END = 1900
const IMPACT_END = 2600
const FALL_END = 3200
const VICTORY_AT = 3000
const KO_AT = 3300
const DEATH_END = 5200

export const COLORS = {
  host: { H: 0x3355dd, h: 0xffdd33, S: 0xf2c9a0, E: 0x222222, B: 0xeeeeee, R: 0x2b44b8, r: 0x1c2f80, T: 0x8b5a2b, O: 0x99ddff },
  guest: { H: 0x7a1f3d, h: 0xffaa33, S: 0xe0b090, E: 0x221111, L: 0x3a2a1a, R: 0xc0304a, r: 0x80203a, T: 0x6b4a2b, O: 0xffcc88 },
  spell: {
    fire: [0xfff3a0, 0xffc23a, 0xff7a1a, 0xd8401a, 0x9c2a14],
    water: [0xf0ffff, 0xa8e4ff, 0x4fb0ff, 0x2a78e0, 0x1c4fa8],
    nature: [0xf0ffc0, 0xa6e05a, 0x5fbf3a, 0x3a8f2a, 0x24601e],
  } satisfies Record<Element, readonly number[]>,
  smoke: [0x6a6470, 0x4a4552],
  thorn: 0x7a5020,
  petal: 0xff9ad5,
  icon: { fire: 0xff8c1f, water: 0x5cc8ff, nature: 0x7ad65a } satisfies Record<Element, number>,
  iconShade: { fire: 0xffe066, water: 0xffffff, nature: 0x3f8f2f } satisfies Record<Element, number>,
  rune: 0xc58cff,
  mana: 0x3de0f0,
  manaEmpty: 0x26304a,
  manaShort: 0xd04050,
  gem: [0xc8fbff, 0x3de0f0, 0x1f7fb8],
  gemGlow: 0x2a5a6a,
  cooldown: 0xff3b3b,
  card: 0x1a1530,
  cardEdge: 0x3a3060,
  cardGold: 0xe8b830,
  shield: 0xa8f4ff,
  shieldEdge: 0x4a9ad0,
  drain: [0xffd6ff, 0xd070ff, 0x9a30d8, 0x5a1590],
  healSpark: 0x9dffb0,
  pickIcon: { charge: 0xffe94a, supercharge: 0xfff7b0, shield: 0x8ad8ff, drain: 0xb85cff, heal: 0x5cff8a },
  runeGlow: 0x5a3a8a,
  orbPicked: 0xffffff,
  heart: 0xe8334a,
  heartLost: 0x444444,
  hit: 0xff2244,
  dmg: 0xff5060,
  blood: [0x8a0000, 0xb3000c, 0xd4101c, 0x5c0000],
  ko: 0xffe14a,
  koEdge: 0x2a0a00,
  spark: [0xfff6a0, 0xfffffe],
  moon: 0xf3f0d2,
  crater: 0xc9c6a8,
  star: [0xfffbe0, 0x9aa0c8],
  hills: [0x1c1430, 0x241a3c],
  grass: [0x2e6a2a, 0x3b7f33],
  dirt: [0x4a3222, 0x3a271a],
  firefly: 0xe6ff80,
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

const ICONS: Record<Element, string[]> = {
  fire: ['..a..', '.aa..', '.aba.', 'abbba', 'abwba', '.aaa.'],
  water: ['..a..', '..a..', '.aaa.', 'aawaa', 'aaaaa', '.aaa.'],
  nature: ['...aa', '..aaa', '.aaba', 'aaba.', 'ab...', 'b....'],
}
const RUNE = ['XXX', '..X', '.XX', '...', '.X.']
// The viewer's own non-spell pick, over their head like an element icon.
const PICK_ICONS: Record<Move, string[]> = {
  charge: ['..XX', '.XX.', 'XXXX', '.XX.', 'XX..'],
  supercharge: ['.XX.XX', 'XX.XX.', 'XXXXXX', '.XX.XX', 'XX.XX.'],
  shield: ['XXXXX', 'X...X', 'X...X', '.X.X.', '..X..'],
  drain: ['X...X', 'XX.XX', '.XXX.', '..X..'],
  heal: ['..X..', '..X..', 'XXXXX', '..X..', '..X..'],
}
const HEART = ['X.X', 'XXX', '.X.']
const GLYPHS: Record<string, string[]> = {
  K: ['X.X', 'X.X', 'XX.', 'X.X', 'X.X'],
  O: ['XXX', 'X.X', 'X.X', 'X.X', 'XXX'],
  '!': ['X', 'X', 'X', '.', 'X'],
  '-': ['...', '...', 'XXX', '...', '...'],
  '1': ['.X.', 'XX.', '.X.', '.X.', 'XXX'],
  '2': ['XXX', '..X', 'XXX', 'X..', 'XXX'],
  '+': ['...', '.X.', 'XXX', '.X.', '...'],
  '3': ['XXX', '..X', '.XX', '..X', 'XXX'],
  '4': ['X.X', 'X.X', 'XXX', '..X', '..X'],
  '5': ['XXX', 'X..', 'XXX', '..X', 'XXX'],
}

export type StageView = {
  /** The viewer's player id: whose pick may be shown as an icon. */
  me?: string
  /** The viewer's own pick this round, when they have cast. */
  myPick?: Action
  /** Clock time, ms: drives the idle loop (stars, blinks, victory hops). */
  now: number
  /** Ms into the round animation of duel.last; absent when idle. */
  t?: number
}

export function stageColumns(bodyColumns: number) {
  return Math.max(30, Math.min(64, Math.floor(bodyColumns)))
}

/** How long the animation of duel.last runs. */
export function roundMs(duel: Duel) {
  const last = duel.last
  if (!last || last.loser === null) return TIE_END
  return duel.winner !== undefined ? DEATH_END : IMPACT_END
}

// ─── drawing primitives ──────────────────────────────────────────────────────

type Canvas = { w: number; px: Uint32Array; ox: number; oy: number }
type Pt = { x: number; y: number }
type Side = 'host' | 'guest'
type Move = 'charge' | 'supercharge' | 'shield' | 'drain' | 'heal'
/** What flies across the stage: an element, a drain, or nothing. */
type Shot = Element | 'drain'

function shotOf(a: Action): Shot | null {
  return elementOf(a) ?? (a === 'drain' ? 'drain' : null)
}

function palette(shot: Shot): readonly number[] {
  return shot === 'drain' ? COLORS.drain : COLORS.spell[shot]
}

/** The staff orb's color while a round charges up. */
function orbColor(a: Action) {
  const shot = shotOf(a)
  if (shot) return palette(shot)[1]!
  return a === 'charge' || a === 'supercharge' ? COLORS.mana : a === 'shield' ? COLORS.shield : COLORS.healSpark
}

function put(c: Canvas, x: number, y: number, color: number) {
  x = Math.round(x + c.ox)
  y = Math.round(y + c.oy)
  if (x >= 0 && x < c.w && y >= 0 && y < STAGE_PX_H) c.px[y * c.w + x] = color
}

/** Deterministic noise in [0, 1): both screens draw the same particles. */
function rnd(...n: number[]) {
  let h = 2166136261
  for (const v of n) {
    h ^= Math.floor(v * 1000) | 0
    h = Math.imul(h, 16777619)
    h ^= h >>> 13
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507)
  return ((h ^ (h >>> 13)) >>> 0) / 4294967296
}

const clamp01 = (k: number) => Math.max(0, Math.min(1, k))
const lerp = (a: number, b: number, k: number) => a + (b - a) * clamp01(k)
const phase = (t: number, from: number, to: number) => clamp01((t - from) / (to - from))
const pick = <T,>(xs: readonly T[], k: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.floor(k * xs.length)))]!

function mix(a: number, b: number, k: number) {
  const ch = (s: number) => Math.round(lerp((a >> s) & 255, (b >> s) & 255, k))
  return (ch(16) << 16) | (ch(8) << 8) | ch(0)
}

function blob(c: Canvas, cx: number, cy: number, r: number, color: (d: number) => number) {
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
    for (let x = Math.floor(cx - r - 1); x <= Math.ceil(cx + r + 1); x++) {
      const d = Math.hypot(x - cx, y - cy) / Math.max(r, 0.01)
      if (d <= 1) put(c, x, y, color(d))
    }
  }
}

function glyphs(c: Canvas, rows: string[], x0: number, y0: number, color: number, scale = 1) {
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch !== 'X') return
      for (let sy = 0; sy < scale; sy++) for (let sx = 0; sx < scale; sx++) put(c, x0 + x * scale + sx, y0 + y * scale + sy, color)
    }),
  )
}

function text(c: Canvas, s: string, x0: number, y0: number, color: number, edge: number | null, scale = 1) {
  const draw = (dx: number, dy: number, col: number) => {
    let x = x0
    for (const ch of s) {
      const g = GLYPHS[ch]!
      glyphs(c, g, x + dx, y0 + dy, col, scale)
      x += (g[0]!.length + 1) * scale
    }
  }
  if (edge !== null) for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]] as const) draw(dx, dy, edge)
  draw(0, 0, color)
}

function textWidth(s: string, scale = 1) {
  return [...s].reduce((w, ch) => w + (GLYPHS[ch]![0]!.length + 1) * scale, -scale)
}

// ─── scenery ─────────────────────────────────────────────────────────────────

function backdrop(c: Canvas, now: number, flash: number) {
  const w = c.w
  for (let y = 0; y < GROUND_Y; y++) {
    const sky = mix(0x0a0c24, 0x2b1a45, y / GROUND_Y)
    const col = flash > 0 ? mix(sky, 0xffffff, flash) : sky
    for (let x = 0; x < w; x++) c.px[y * w + x] = col
  }
  if (flash < 0.5) {
    for (let i = 0; i < Math.floor(w / 3); i++) {
      const x = Math.floor(rnd(i, 1) * w)
      const y = Math.floor(rnd(i, 2) * 15)
      const tw = Math.sin(now / 700 + rnd(i, 3) * 6.28)
      if (tw > -0.3) c.px[y * w + x] = tw > 0.6 ? COLORS.star[0]! : COLORS.star[1]!
    }
    const mx = Math.floor(w / 2) - 1
    for (let y = 1; y <= 7; y++) {
      for (let x = mx - 3; x <= mx + 3; x++) {
        const d = Math.hypot(x - mx, y - 4)
        if (d <= 2.6) c.px[y * w + x] = (x === mx - 1 && y === 3) || (x === mx + 1 && y === 5) ? COLORS.crater : COLORS.moon
      }
    }
  }
  // Hills on the horizon.
  for (let x = 0; x < w; x++) {
    const top = GROUND_Y - 2 - Math.floor(3 * (Math.sin(x * 0.35) * 0.5 + 0.5) + 2 * rnd(x, 9))
    for (let y = top; y < GROUND_Y; y++) c.px[y * w + x] = y === top ? COLORS.hills[1]! : COLORS.hills[0]!
  }
  for (let x = 0; x < w; x++) {
    c.px[GROUND_Y * w + x] = rnd(x, 4) > 0.5 ? COLORS.grass[0]! : COLORS.grass[1]!
    c.px[(GROUND_Y + 1) * w + x] = COLORS.dirt[0]!
    for (let y = GROUND_Y + 2; y < STAGE_PX_H; y++) c.px[y * w + x] = rnd(x, y, 5) > 0.7 ? COLORS.dirt[0]! : COLORS.dirt[1]!
    if (rnd(x, 6) > 0.75) c.px[(GROUND_Y - 1) * w + x] = COLORS.grass[1]!
  }
}

function fireflies(c: Canvas, now: number) {
  for (let i = 0; i < 4; i++) {
    const x = (rnd(i, 21) * c.w + now * 0.004 * (rnd(i, 22) - 0.5)) % c.w
    const y = 18 + Math.sin(now / 900 + i * 2) * 2.5
    if (Math.sin(now / 400 + i * 1.7) > -0.2) put(c, (x + c.w) % c.w, y, COLORS.firefly)
  }
}

// ─── wizards ─────────────────────────────────────────────────────────────────

type Pose = {
  orb: number
  tint?: number
  blink?: boolean
  /** Staff raised overhead, arm up. */
  victory?: boolean
  /** Fallen forward by this many radians (0 standing, π/2 flat). */
  fall?: number
  dy?: number
}

function spriteRows(side: Side) {
  return side === 'guest' ? SPRITES.guest.map(r => [...r].reverse().join('')) : SPRITES.host
}

function pixelColor(side: Side, ch: string, pose: Pose) {
  const pal = COLORS[side] as Record<string, number>
  if (ch === 'O') return pose.orb
  if (ch === 'E' && pose.blink) return pal.S!
  return pose.tint ?? pal[ch]!
}

function wizard(c: Canvas, side: Side, x0: number, pose: Pose) {
  const rows = spriteRows(side)
  const dir = side === 'host' ? 1 : -1
  const top = SPRITE_TOP + (pose.dy ?? 0)
  if (pose.fall) return fallen(c, side, rows, x0, pose)
  const front = side === 'host' ? 10 : 0
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return
      // The victory pose draws its own staff and arm.
      if (pose.victory && (x === front || (y === 10 && x === front - dir))) return
      put(c, x0 + x, top + y, pixelColor(side, ch, pose))
    }),
  )
  if (!pose.victory) return
  const pal = COLORS[side]
  const fx = x0 + front
  for (let y = -4; y <= 12; y++) put(c, fx, top + y, pose.tint ?? pal.T)
  for (const [x, y] of [[-dir, 9], [-dir, 8], [0, 7]] as const) put(c, fx + x, top + y, pose.tint ?? pal.R)
  put(c, fx, top + 6, pose.tint ?? pal.S)
  put(c, fx, top - 5, pose.orb)
}

/** Rotates the sprite about its front foot: it topples toward the middle, face down. */
function fallen(c: Canvas, side: Side, rows: string[], x0: number, pose: Pose) {
  const dir = side === 'host' ? 1 : -1
  const a = (pose.fall ?? 0) * dir
  const cos = Math.cos(a)
  const sin = Math.sin(a)
  const pl = side === 'host' ? SPRITE_W : 0
  const pw = { x: x0 + pl, y: SPRITE_TOP + SPRITE_H }
  for (let y = SPRITE_TOP - 4; y <= GROUND_Y; y++) {
    for (let x = x0 - SPRITE_H - 2; x <= x0 + SPRITE_W + SPRITE_H + 2; x++) {
      const vx = x + 0.5 - pw.x
      const vy = y + 0.5 - pw.y
      // Inverse rotation back into the sprite.
      const sx = Math.floor(pl + vx * cos + vy * sin)
      const sy = Math.floor(SPRITE_H - vx * sin + vy * cos)
      const ch = rows[sy]?.[sx]
      if (!ch || ch === '.') continue
      put(c, x, y, pixelColor(side, ch, pose))
    }
  }
}

/** Where a point of the standing sprite ends up once fallen by `fall`. */
function fallenPoint(side: Side, x0: number, local: Pt, fall: number): Pt {
  const dir = side === 'host' ? 1 : -1
  const a = fall * dir
  const pl = side === 'host' ? SPRITE_W : 0
  const vx = local.x - pl
  const vy = local.y - SPRITE_H
  return {
    x: x0 + pl + vx * Math.cos(a) - vy * Math.sin(a),
    y: SPRITE_TOP + SPRITE_H + vx * Math.sin(a) + vy * Math.cos(a),
  }
}

function hearts(c: Canvas, x0: number, life: number) {
  for (let i = 0; i < 3; i++) {
    const color = i < life ? COLORS.heart : COLORS.heartLost
    HEART.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && put(c, x0 + i * 4 + x, y, color)))
  }
}

function icon(c: Canvas, el: Element, x0: number, y0: number) {
  ICONS[el].forEach((row, y) =>
    [...row].forEach((ch, x) => {
      if (ch === '.') return
      const color = ch === 'a' ? COLORS.icon[el] : ch === 'b' ? COLORS.iconShade[el] : 0xffffff
      put(c, x0 + x, y0 + y, color)
    }),
  )
}

function pickIcon(c: Canvas, a: Action, x0: number, y0: number) {
  const el = elementOf(a)
  if (el) return icon(c, el, x0, y0)
  glyphs(c, PICK_ICONS[a as Move], x0, y0, COLORS.pickIcon[a as Move])
}

const GEM = ['.a.', 'abc', 'abc', 'bbc', '.c.']

/** Mana gems set in the ground below a wizard: lit, glowing and twinkling for each mana held. */
function crystals(c: Canvas, cx: number, mana: number, now: number, seed: number) {
  for (let i = 0; i < MAX_MANA; i++) {
    const x0 = Math.round(cx - 6 + i * 4)
    const y0 = GROUND_Y + 1
    const lit = i < mana
    if (lit && Math.sin(now / 500 + i * 2.1) > -0.2) {
      for (const [dx, dy] of [[-1, 1], [3, 1], [-1, 3], [3, 3], [1, 5]] as const) put(c, x0 + dx, y0 + dy, COLORS.gemGlow)
    }
    GEM.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch === '.') return
        const color = !lit ? COLORS.manaEmpty : COLORS.gem[ch === 'a' ? 0 : ch === 'b' ? 1 : 2]!
        put(c, x0 + x, y0 + y, color)
      }),
    )
    // A glint runs over a lit gem now and then.
    if (lit && rnd(seed, i, Math.floor(now / 250)) > 0.75) put(c, x0 + 1, y0, 0xffffff)
  }
}

/** A curved wall of light in front of a wizard. */
function shieldWall(c: Canvas, x: number, dir: number, k: number, t: number) {
  const top = SPRITE_TOP - 1
  const h = GROUND_Y - top
  for (let s = 0; s < h * Math.min(1, k * 3); s++) {
    const v = (s / h) * 2 - 1
    const bulge = Math.sqrt(Math.max(0, 1 - v * v)) * 2
    const shimmer = (s + Math.floor(t / 90)) % 5 === 0
    put(c, x + dir * bulge, top + s, shimmer ? 0xffffff : COLORS.shield)
    put(c, x + dir * (bulge - 1), top + s, COLORS.shieldEdge)
  }
}

/** Mana motes spiralling in on a charging wizard; a super charge pulls in twice as many. */
function manaSparks(c: Canvas, at: Pt, k: number, t: number, n = 10) {
  for (let i = 0; i < n; i++) {
    const ang = i * 0.63 + t * 0.01
    const r = lerp(10, 2, (k + (i % 3) * 0.15) % 1)
    put(c, at.x + Math.cos(ang) * r, at.y + Math.sin(ang) * r * 0.7, COLORS.mana)
  }
}

/** Green motes rising off a wizard who heals. */
function healSparks(c: Canvas, at: Pt, k: number, seed: number) {
  for (let i = 0; i < 12; i++) {
    const p = (k * 1.5 + rnd(seed, i, 91)) % 1
    put(c, at.x + (rnd(seed, i, 92) - 0.5) * 10, GROUND_Y - 1 - p * 16, p > 0.8 ? COLORS.heart : COLORS.healSpark)
  }
}

function rune(c: Canvas, x0: number, y0: number, now: number) {
  if (Math.sin(now / 250) > 0) {
    for (let y = -1; y <= 5; y++) for (let x = -1; x <= 3; x++) put(c, x0 + x, y0 + y, COLORS.runeGlow)
  }
  glyphs(c, RUNE, x0, y0, COLORS.rune)
}

// ─── spells ──────────────────────────────────────────────────────────────────

function charge(c: Canvas, el: Element, tip: Pt, body: Pt, k: number, t: number, seed: number) {
  const pal = COLORS.spell[el]
  if (el === 'fire') {
    blob(c, tip.x, tip.y, 0.8 + k * 1.2, d => pick(pal, d * 0.6))
    for (let i = 0; i < 10; i++) {
      const p = (t / 300 + rnd(seed, i, 1)) % 1
      put(c, tip.x + (rnd(seed, i, 2) - 0.5) * 3, tip.y - p * 6, p > 0.8 ? COLORS.smoke[0]! : pick(pal, p))
    }
  } else if (el === 'water') {
    for (let i = 0; i < 10; i++) {
      const ang = i * 0.63 + t * 0.012
      const r = (1 - k) * 6 + 0.5 + (i % 3)
      put(c, tip.x + Math.cos(ang) * r, tip.y + Math.sin(ang) * r * 0.7, pal[1 + (i % 3)]!)
    }
    blob(c, tip.x, tip.y, 0.6 + k, d => (d < 0.5 ? pal[0]! : pal[2]!))
  } else {
    for (let i = 0; i < 7; i++) {
      const ang = i * 0.9 + t * 0.01
      put(c, body.x + Math.cos(ang) * 6, body.y + Math.sin(ang) * 4, pal[1 + (i % 3)]!)
    }
    for (let i = 0; i < 4; i++) put(c, body.x - 4 + i * 3, GROUND_Y - 1 - Math.round(k * 2 * rnd(seed, i)), pal[3]!)
    put(c, tip.x, tip.y, pal[1]!)
  }
}

function fireball(c: Canvas, head: Pt, dir: number, t: number, seed: number, r = 2.6) {
  const pal = COLORS.spell.fire
  for (let i = 14; i >= 1; i--) {
    const age = i / 14
    const jitter = (rnd(seed, i, Math.floor(t / 66)) - 0.5) * 2
    const color = age > 0.75 ? COLORS.smoke[age > 0.9 ? 1 : 0]! : pick(pal.slice(1), age * 1.3)
    put(c, head.x - dir * i * 0.9, head.y - age * 3 + jitter * age, color)
  }
  for (let y = Math.floor(head.y - r - 2); y <= Math.ceil(head.y + r + 2); y++) {
    for (let x = Math.floor(head.x - r - 2); x <= Math.ceil(head.x + r + 2); x++) {
      const dx = x - head.x
      const dy = y - head.y
      const flicker = rnd(seed, x, y, Math.floor(t / 66)) * 0.9
      const d = Math.hypot(dx, dy) / (r + flicker - (dx * dir < 0 ? 0 : 0.4))
      if (d <= 1) put(c, x, y, d < 0.35 ? pal[0]! : d < 0.6 ? pal[1]! : d < 0.85 ? pal[2]! : pal[3]!)
    }
  }
}

function torrent(c: Canvas, from: Pt, head: Pt, t: number, seed: number) {
  const pal = COLORS.spell.water
  const len = Math.abs(head.x - from.x)
  const dir = Math.sign(head.x - from.x) || 1
  for (let s = 0; s <= len; s++) {
    const k = len ? s / len : 1
    const env = Math.sin(k * Math.PI) * 1.6 + 0.3
    const x = from.x + dir * s
    const y = lerp(from.y, head.y, k) + Math.sin(s * 0.55 - t * 0.018) * env
    put(c, x, y - 1, pal[1]!)
    put(c, x, y, pal[2]!)
    put(c, x, y + 1, pal[3]!)
    if (rnd(seed, s, Math.floor(t / 132)) > 0.85) put(c, x, y - 1, pal[0]!)
  }
  for (let i = 0; i < 8; i++) {
    const s = rnd(seed, i, 7) * len
    const age = (t / 500 + rnd(seed, i, 8)) % 1
    put(c, from.x + dir * s, lerp(from.y, head.y, len ? s / len : 1) + 2 + age * age * 9, pal[2]!)
  }
  blob(c, head.x, head.y, 2.2, d => (d < 0.4 ? pal[0]! : d < 0.75 ? pal[1]! : pal[2]!))
}

function vine(c: Canvas, fromX: number, toX: number, t: number, seed: number) {
  const pal = COLORS.spell.nature
  const dir = Math.sign(toX - fromX) || 1
  const len = Math.abs(toX - fromX)
  for (let s = 0; s <= len; s++) {
    const x = fromX + dir * s
    const y = GROUND_Y - 1 - (Math.sin(s * 0.7 + seed) > 0.3 ? 1 : 0)
    put(c, x, y, pal[3]!)
    put(c, x, y + 1, pal[4]!)
    if (s % 4 === 2) {
      put(c, x, y - 1, rnd(seed, s) > 0.5 ? pal[1]! : pal[2]!)
      put(c, x + dir, y - 2, pal[1]!)
    }
    if (s % 6 === 5) put(c, x, y - 1, COLORS.thorn)
  }
  const sway = Math.sin(t / 80) > 0 ? 1 : 0
  put(c, toX, GROUND_Y - 2 - sway, pal[0]!)
  put(c, toX + dir, GROUND_Y - 3, COLORS.thorn)
}

/** One spell in flight, its head at `head`; `from` is where it left the caster. Empowered ones blaze. */
function travel(c: Canvas, shot: Shot, from: Pt, head: Pt, t: number, seed: number, big = false) {
  const dir = Math.sign(head.x - from.x) || 1
  const pal = palette(shot)
  if (big) blob(c, head.x, head.y, 4.5 + Math.sin(t / 60) * 0.4, d => pal[d < 0.7 ? 2 : 3]!)
  if (shot === 'fire') fireball(c, head, dir, t, seed, big ? 3.2 : 2.6)
  else if (shot === 'water') torrent(c, from, head, t, seed)
  else if (shot === 'nature') vine(c, from.x, head.x, t, seed)
  else {
    for (let i = 1; i < 8; i++) put(c, head.x - dir * i, head.y + Math.sin(i + t / 70), pal[i % 2 ? 2 : 3]!)
    blob(c, head.x, head.y, 2.2, d => pal[d < 0.4 ? 0 : 1]!)
  }
}

/** A charging staff, by what it is about to cast. */
function windUp(c: Canvas, shot: Shot, tip: Pt, body: Pt, k: number, t: number, seed: number) {
  if (shot !== 'drain') return charge(c, shot, tip, body, k, t, seed)
  blob(c, tip.x, tip.y, 0.8 + k * 1.4, d => COLORS.drain[d < 0.5 ? 0 : 1]!)
}

function burst(c: Canvas, at: Pt, k: number, pals: (readonly number[])[], seed: number) {
  if (k < 0.25) blob(c, at.x, at.y, 1 + k * 8, () => 0xffffff)
  const r = 1.5 + k * 7
  for (let a = 0; a < 28; a++) {
    const ang = (a / 28) * Math.PI * 2
    put(c, at.x + Math.cos(ang) * r, at.y + Math.sin(ang) * r * 0.6, pals[a % pals.length]![1]!)
  }
  for (let i = 0; i < 26; i++) {
    const ang = rnd(seed, i, 31) * Math.PI * 2
    const v = 6 + rnd(seed, i, 32) * 8
    const x = at.x + Math.cos(ang) * v * k
    const y = at.y + Math.sin(ang) * v * k * 0.7 + 10 * k * k
    put(c, x, y, pick(pals[i % pals.length]!, 0.2 + k * 0.7))
  }
}

function impact(c: Canvas, shot: Shot, at: Pt, k: number, t: number, seed: number) {
  if (shot === 'drain') return burst(c, at, k, [COLORS.drain], seed)
  const el = shot
  const pal = COLORS.spell[el]
  if (el === 'fire') {
    if (k < 0.5) blob(c, at.x, at.y, 2 + k * 9, d => pick(pal, d * (0.5 + k)))
    for (let i = 0; i < 20; i++) {
      const ang = rnd(seed, i, 41) * Math.PI * 2
      const v = 5 + rnd(seed, i, 42) * 9
      put(c, at.x + Math.cos(ang) * v * k, at.y + Math.sin(ang) * v * k * 0.8 + 9 * k * k, pick(pal, 0.3 + k * 0.7))
    }
    for (let i = 0; i < 6; i++) blob(c, at.x + (rnd(seed, i, 43) - 0.5) * 8, at.y - k * 7 - i, 1.2 * k, () => COLORS.smoke[i % 2]!)
  } else if (el === 'water') {
    const r = 2 + k * 8
    for (let x = -r; x <= r; x++) put(c, at.x + x, GROUND_Y - 1, Math.abs(x) > r - 1.5 ? pal[0]! : pal[2]!)
    for (let i = 0; i < 24; i++) {
      const vx = (rnd(seed, i, 51) - 0.5) * 16
      const vy = -(4 + rnd(seed, i, 52) * 8)
      const y = at.y + vy * k + 16 * k * k
      if (y < GROUND_Y) put(c, at.x + vx * k, y, pal[1 + (i % 3)]!)
    }
  } else {
    for (let n = 0; n < 3; n++) {
      const h = Math.min(1, k * 1.6) * 15
      for (let s = 0; s < h; s++) {
        const x = at.x + Math.sin(s * 0.6 + n * 2.1) * (3 - n * 0.5)
        const y = GROUND_Y - 1 - s
        put(c, x, y, s % 5 === 4 ? COLORS.thorn : pal[2 + (n % 2)]!)
        if (s % 4 === 1) put(c, x + (n % 2 ? 1 : -1), y, pal[1]!)
      }
    }
    for (let i = 0; i < 8; i++) {
      const p = (k + rnd(seed, i, 61)) % 1
      put(c, at.x + (rnd(seed, i, 62) - 0.5) * 12, SPRITE_TOP + p * 14, i % 3 ? pal[0]! : COLORS.petal)
    }
  }
}

// ─── blood ───────────────────────────────────────────────────────────────────

type Gush = { from: Pt; start: number; spread: number; count: number; every: number; seed: number }

/** Particles flung from `from`, falling under gravity, staining where they land. */
function gush(c: Canvas, g: Gush, t: number) {
  const G = 0.00011
  for (let i = 0; i < g.count; i++) {
    const born = g.start + i * g.every
    if (t < born) break
    const age = t - born
    const vx = (rnd(g.seed, i, 71) - 0.5) * g.spread
    const vy = -(0.02 + rnd(g.seed, i, 72) * 0.045)
    const color = COLORS.blood[i % COLORS.blood.length]!
    // When it lands: from.y + vy*a + G/2*a² = ground.
    const ground = GROUND_Y - 0.5
    const dy = ground - g.from.y
    const land = (-vy + Math.sqrt(vy * vy + 2 * G * dy)) / G
    if (age < land) {
      put(c, g.from.x + vx * age, g.from.y + vy * age + 0.5 * G * age * age, color)
    } else {
      const x = g.from.x + vx * land
      put(c, x, GROUND_Y, color)
      if (i % 3 === 0) put(c, x + 1, GROUND_Y, COLORS.blood[0]!)
      if (i % 4 === 0) put(c, x, GROUND_Y - 1, COLORS.blood[1]!)
    }
  }
}

function pool(c: Canvas, cx: number, k: number) {
  const hw = 1 + k * 13
  for (let x = Math.floor(cx - hw); x <= Math.ceil(cx + hw); x++) {
    const d = Math.abs(x - cx) / hw
    if (d > 1) continue
    put(c, x, GROUND_Y, d > 0.85 ? COLORS.blood[0]! : COLORS.blood[3]!)
    if (d < 0.75) put(c, x, GROUND_Y + 1, COLORS.blood[0]!)
    if (d < 0.6) put(c, x, GROUND_Y - 1, COLORS.blood[1]!)
  }
}

/** Blood on the lens: splats that drip down over time. */
function lensSplats(c: Canvas, k: number, now: number, seed: number) {
  for (let i = 0; i < 6; i++) {
    const x = 2 + rnd(seed, i, 81) * (c.w - 4)
    const y = 2 + rnd(seed, i, 82) * 12
    const r = 0.8 + rnd(seed, i, 83) * 1.8
    blob(c, x, y, r * Math.min(1, k * 4), d => (d < 0.5 ? COLORS.blood[2]! : COLORS.blood[1]!))
    const drip = Math.min(7, k * 12 * (0.5 + rnd(seed, i, 84)))
    for (let s = 0; s < drip; s++) put(c, x + (i % 2 ? 0.4 : -0.4), y + r + s, COLORS.blood[s > drip - 2 ? 2 : 0]!)
    // A fresh drop now and then, even long after.
    const p = (now / 2600 + rnd(seed, i, 85)) % 1
    if (k >= 1 && p < 0.5) put(c, x, y + r + drip + p * 6, COLORS.blood[2]!)
  }
}

// ─── the stage ───────────────────────────────────────────────────────────────

/** Pixels, row-major, width × STAGE_PX_H, every one painted. */
export function drawStage(duel: Duel, width: number, view: StageView): Uint32Array {
  const c: Canvas = { w: width, px: new Uint32Array(width * STAGE_PX_H), ox: 0, oy: 0 }
  const ids = Object.keys(duel.players)
  const id = { host: ids[0], guest: ids[1] } as Record<Side, string | undefined>
  const xs: Record<Side, number> = { host: 2, guest: width - 2 - SPRITE_W }
  const tips: Record<Side, Pt> = {
    host: { x: xs.host + 10, y: SPRITE_TOP + 4 },
    guest: { x: xs.guest, y: SPRITE_TOP + 3 },
  }
  const body = (side: Side): Pt => ({ x: xs[side] + SPRITE_W / 2, y: SPRITE_TOP + 9 })
  const dirOf = (side: Side) => (side === 'host' ? 1 : -1)
  const other = (side: Side): Side => (side === 'host' ? 'guest' : 'host')
  const sideOf = (pid: string | null | undefined): Side | null =>
    pid == null ? null : pid === id.host ? 'host' : pid === id.guest ? 'guest' : null

  const t = view.t
  const last = duel.last
  const seed = (last?.round ?? duel.round) * 7919
  const playing = t !== undefined && last !== undefined
  const loser = sideOf(last?.loser)
  const action = (side: Side) => last!.picks[id[side]!]!
  const shot = (side: Side) => shotOf(action(side))
  const shooters = playing && id.host && id.guest ? (['host', 'guest'] as const).filter(side => shot(side)) : []
  const clash = shooters.length === 2
  /** How much `side` healed this round; 0 when not healing, or hit. */
  const healed = (side: Side) => (playing && id[side] ? (last.healed[id[side]!] ?? 0) : 0)
  /** Life as the round shows it at `t`: a hit lands at PUSH_END, a heal at CLASH_END. */
  const shownLife = (side: Side) => {
    const life = duel.players[id[side]!]!.life
    if (!playing) return life
    if (side === loser && t < PUSH_END) return life + last.dmg
    if (healed(side) && t < CLASH_END) return life - healed(side)
    return life
  }
  const winnerSide = sideOf(duel.winner)
  const deadSide = winnerSide ? other(winnerSide) : null
  const lethal = playing && deadSide !== null && loser === deadSide
  // Idle after a won duel: everything as the death animation left it.
  const tt = playing ? t : deadSide ? DEATH_END : undefined
  const clock = playing ? t : view.now

  const flash = playing && clash && t >= TRAVEL_END && t < TRAVEL_END + 100 ? 0.45 : 0
  backdrop(c, view.now, flash)
  if (!playing && !deadSide) fireflies(c, view.now)
  for (const side of ['host', 'guest'] as const) {
    if (id[side]) crystals(c, body(side).x, duel.players[id[side]!]!.mana, view.now, side === 'host' ? 1 : 2)
  }

  const shaking = playing && ((clash && t >= TRAVEL_END && t < CLASH_END) || (loser && t >= PUSH_END && t < PUSH_END + 260))
  const shake = () => {
    if (shaking) {
      c.ox = Math.floor(t! / 50) % 2 ? 1 : -1
      c.oy = Math.floor(t! / 75) % 2 ? 1 : 0
    }
  }
  const still = () => {
    c.ox = 0
    c.oy = 0
  }

  // Blood under everything else: the pool and what has landed.
  const fallK = (tt ?? 0) < IMPACT_END ? 0 : phase(tt!, IMPACT_END, FALL_END)
  const fall = deadSide && tt !== undefined && (lethal || !playing) ? fallAngle(fallK) : 0
  if (deadSide && tt !== undefined && tt >= IMPACT_END) {
    const neck = fallenPoint(deadSide, xs[deadSide], { x: 5, y: 7 }, fall)
    pool(c, fallenPoint(deadSide, xs[deadSide], { x: 5, y: 12 }, Math.PI / 2).x, phase(tt, FALL_END - 200, DEATH_END - 400))
    gush(c, { from: neck, start: IMPACT_END + 150, spread: 0.11, count: 150, every: 11, seed: seed + 1 }, tt)
  }
  // Every lost heart leaves a stain at the wizard's feet.
  for (const side of ['host', 'guest'] as const) {
    const pid = id[side]
    if (!pid) continue
    const lost = 3 - shownLife(side)
    for (let i = 0; i < lost * 3; i++) put(c, body(side).x + (rnd(seed, side === 'host' ? 1 : 2, i) - 0.5) * 9, GROUND_Y, COLORS.blood[i % 2 ? 0 : 3]!)
  }

  shake()
  for (const side of ['host', 'guest'] as const) {
    const pid = id[side]
    if (!pid) continue
    const p = duel.players[pid]!
    const hitDone = playing && side === loser && t >= PUSH_END

    const blink = (clock + (side === 'host' ? 0 : 1400)) % 3300 < 130
    const flicker = rnd(seed, side === 'host' ? 3 : 4, Math.floor(clock / 200)) > 0.7
    let orb: number = p.picked ? COLORS.orbPicked : flicker ? mix(COLORS[side].O, 0xffffff, 0.5) : COLORS[side].O
    if (playing && t < CHARGE_END) orb = orbColor(last.picks[pid]!)
    const victorious = side === winnerSide && tt !== undefined && tt >= VICTORY_AT
    const hop = victorious && Math.floor(clock / 350) % 2 === 0 ? -1 : 0
    const tint = hitDone && t < PUSH_END + 300 && Math.floor(t / 66) % 2 === 0 ? COLORS.hit : undefined
    if (side === deadSide && fall > 0) {
      wizard(c, side, xs[side], { orb: COLORS[side].O, fall, ...(tint ? { tint } : {}) })
    } else {
      wizard(c, side, xs[side], {
        orb: victorious ? COLORS.spark[0]! : orb,
        blink,
        dy: hop,
        ...(victorious ? { victory: true } : {}),
        ...(tint ? { tint } : {}),
      })
    }
    if (victorious) {
      const o = { x: tips[side].x + (side === 'guest' ? 0 : 0), y: SPRITE_TOP - 5 + hop }
      for (let i = 0; i < 6; i++) {
        const ang = i * 1.05 + clock * 0.006
        const r = 2 + (i % 2) * 1.5
        put(c, o.x + Math.cos(ang) * r, o.y + Math.sin(ang) * r * 0.8, COLORS.spark[i % 2]!)
      }
    }

    // Selection marks, only while waiting for picks.
    if (!playing && !duel.winner && p.picked) {
      still()
      const ix = side === 'host' ? xs.host + 2 : xs.guest + 4
      const bob = Math.sin(view.now / 300) > 0 ? 0 : 1
      if (pid === view.me && view.myPick) pickIcon(c, view.myPick, ix, 3 + bob)
      else rune(c, ix + 1, 3 + bob, view.now)
      shake()
    }
  }

  if (playing && id.host && id.guest) {
    const midX = width / 2
    const midY = SPRITE_TOP + 6
    const start = (side: Side): Pt => (shot(side) === 'nature' ? { x: body(side).x + dirOf(side) * 6, y: GROUND_Y - 1 } : tips[side])
    const meet = (side: Side): Pt => (shot(side) === 'nature' ? { x: midX - dirOf(side), y: GROUND_Y - 1 } : { x: midX - dirOf(side) * 2, y: midY })
    const aimAt = (win: Side, side: Side): Pt => (shot(win) === 'nature' ? { x: body(side).x, y: GROUND_Y - 1 } : body(side))
    const wallX = (side: Side) => body(side).x + dirOf(side) * 8
    const fly = (side: Side, from: Pt, head: Pt, s: number) => travel(c, shot(side)!, from, head, t, s, isEmpowered(action(side)))

    // What each wizard does for themselves: charge up, raise a shield, heal.
    for (const side of ['host', 'guest'] as const) {
      const a = action(side)
      if (a === 'charge' && t < CLASH_END) manaSparks(c, body(side), phase(t, 0, CLASH_END), t)
      if (a === 'supercharge' && t < CLASH_END) manaSparks(c, body(side), phase(t, 0, CLASH_END), t, 24)
      if (a === 'shield' && t >= CHARGE_END / 2) shieldWall(c, wallX(side), dirOf(side), phase(t, CHARGE_END / 2, CHARGE_END * 2), t)
      if (healed(side) && t >= CHARGE_END && t < TIE_END) {
        healSparks(c, body(side), phase(t, CHARGE_END, TIE_END), seed + (side === 'host' ? 5 : 6))
        if (t >= CLASH_END) {
          still()
          text(c, `+${healed(side)}`, body(side).x - 3, SPRITE_TOP - 2 - phase(t, CLASH_END, TIE_END) * 6, COLORS.healSpark, null)
          shake()
        }
      }
    }

    /** The winning shot lands on `side`: impact, damage, blood, and a stolen mana flying home. */
    const land = (win: Side, side: Side) => {
      const target = aimAt(win, side)
      if (t >= PUSH_END && t < IMPACT_END) {
        const k = phase(t, PUSH_END, IMPACT_END)
        impact(c, shot(win)!, target, k, t, seed + 40)
        if (last.stole) blob(c, lerp(body(side).x, body(win).x, k), body(side).y - Math.sin(k * Math.PI) * 6, 1.4, () => COLORS.mana)
        still()
        text(c, `-${last.dmg}`, body(side).x - 3, SPRITE_TOP - 2 - k * 6, COLORS.dmg, null)
        shake()
      }
      // Even a graze bleeds.
      if (t >= PUSH_END) {
        gush(c, { from: body(side), start: PUSH_END, spread: 0.06, count: 12 * last.dmg + 12, every: 8, seed: seed + 2 }, Math.min(t, IMPACT_END))
      }
    }

    if (t < CHARGE_END) {
      for (const side of shooters) windUp(c, shot(side)!, tips[side], body(side), t / CHARGE_END, t, seed)
    } else if (clash) {
      if (t < TRAVEL_END) {
        const k = phase(t, CHARGE_END, TRAVEL_END)
        for (const side of shooters) {
          const from = start(side)
          const to = meet(side)
          const arc = shot(side) === 'nature' ? 0 : Math.sin(k * Math.PI) * 3
          fly(side, from, { x: lerp(from.x, to.x, k), y: lerp(from.y, to.y, k) - arc }, seed + (side === 'host' ? 10 : 20))
        }
      } else if (t < CLASH_END) {
        const k = phase(t, TRAVEL_END, CLASH_END)
        for (const side of shooters) if (shot(side) === 'water' && k < 0.4) torrent(c, start(side), meet(side), t, seed)
        burst(c, { x: midX, y: midY }, k, [palette(shot('host')!), palette(shot('guest')!)], seed)
      } else if (!loser) {
        const k = phase(t, CLASH_END, TIE_END)
        for (let i = 0; i < 16; i++) {
          const ang = (i / 16) * Math.PI * 2
          const pal = palette(shot(i % 2 ? 'host' : 'guest')!)
          const color = k > 0.7 ? COLORS.smoke[i % 2]! : pal[2]!
          put(c, midX + Math.cos(ang) * lerp(6, 14, k), midY + Math.sin(ang) * lerp(3, 7, k) + k * k * 4, color)
        }
      } else {
        const win = other(loser)
        if (t < PUSH_END) {
          const k = phase(t, CLASH_END, PUSH_END)
          const target = aimAt(win, loser)
          const from = shot(win) === 'water' ? start(win) : meet(win)
          fly(win, from, { x: lerp(meet(win).x, target.x, k), y: lerp(meet(win).y, target.y, k) }, seed + 30)
        }
        land(win, loser)
      }
    } else if (shooters.length === 1) {
      // Nothing to clash with: the shot flies the whole way, to a shield or a body.
      const win = shooters[0]!
      const side = other(win)
      const blocked = action(side) === 'shield'
      const from = start(win)
      const end = blocked ? { x: wallX(side), y: shot(win) === 'nature' ? GROUND_Y - 1 : midY } : aimAt(win, side)
      if (t < PUSH_END) {
        const k = phase(t, CHARGE_END, PUSH_END)
        const arc = shot(win) === 'nature' ? 0 : Math.sin(k * Math.PI) * 3
        fly(win, from, { x: lerp(from.x, end.x, k), y: lerp(from.y, end.y, k) - arc }, seed + 10)
      } else if (blocked) {
        burst(c, end, phase(t, PUSH_END, TIE_END), [palette(shot(win)!), [COLORS.shield, COLORS.shieldEdge]], seed)
      }
      if (!blocked && side === loser) land(win, side)
    }
  }

  still()
  // The HUD, over every effect.
  for (const side of ['host', 'guest'] as const) if (id[side]) hearts(c, xs[side], shownLife(side))
  if (deadSide && tt !== undefined && tt >= IMPACT_END + 300) {
    lensSplats(c, phase(tt, IMPACT_END + 300, DEATH_END - 600), view.now, seed + 3)
  }
  if (deadSide && tt !== undefined && tt >= KO_AT) {
    const k = phase(tt, KO_AT, KO_AT + 300)
    const bounce = k < 1 ? (1 - k) * -14 : 0
    text(c, 'KO!', Math.floor((width - textWidth('KO!', 2)) / 2), 3 + bounce, COLORS.ko, COLORS.koEdge, 2)
  }
  return c.px
}

// ─── action cards ────────────────────────────────────────────────────────────

/** One card per action, CARD_COLS wide (the last column a gap), CARD_ROWS tall. */
export const CARD_COLS = 10
export const CARD_ROWS = 5
export const CARD_PX_H = CARD_ROWS * 2
const CARD_W = CARD_COLS - 1

/**
 * The pane's action cards: a little animated drawing each, cost as mana pips.
 * What `p` may not pick is grey, with the rounds left in red when on cooldown.
 */
export function drawCards(actions: Action[], p: Player | undefined, now: number): Uint32Array {
  const w = actions.length * CARD_COLS
  const px = new Uint32Array(w * CARD_PX_H)
  actions.forEach((a, i) => {
    const c: Canvas = { w, px, ox: i * CARD_COLS, oy: 0 }
    const why = p ? whyNot(p, a) : 'not seated'
    for (let y = 0; y < CARD_PX_H; y++) {
      for (let x = 0; x < CARD_W; x++) {
        const corner = (x === 0 || x === CARD_W - 1) && (y === 0 || y === CARD_PX_H - 1)
        if (!corner) put(c, x, y, x === 0 || y === 0 || x === CARD_W - 1 || y === CARD_PX_H - 1 ? (isEmpowered(a) ? COLORS.cardGold : COLORS.cardEdge) : COLORS.card)
      }
    }
    art(c, a, now + i * 137)
    const short = !!why?.startsWith('needs')
    for (let k = 0; k < COST[a]; k++) for (let y = 7; y <= 8; y++) put(c, 2 + k * 2, y, short ? COLORS.manaShort : COLORS.mana)
    if (why) {
      for (let y = 0; y < CARD_PX_H; y++) {
        for (let x = 0; x < CARD_W; x++) {
          const at = y * w + i * CARD_COLS + x
          const col = px[at]!
          if (col && col !== COLORS.manaShort) px[at] = grey(col)
        }
      }
      const left = cooldownOf(p, a)
      if (left > 0) glyphs(c, GLYPHS[String(left)]!, 3, 2, COLORS.cooldown)
    }
  })
  return px
}

function grey(col: number) {
  const l = Math.round((((col >> 16) & 255) * 0.3 + ((col >> 8) & 255) * 0.59 + (col & 255) * 0.11) * 0.55) || 1
  return (l << 16) | (l << 8) | l
}

/** Rounds until `a` is back; 0 when no cooldown holds it. */
function cooldownOf(p: Player | undefined, a: Action) {
  if (!p) return 0
  if (a === 'shield') return p.shieldLocked ? 1 : 0
  if (a === 'drain') return p.drainCooldown
  if (a === 'supercharge') return p.superCooldown
  if (a === 'heal') return p.healCooldown
  return 0
}

/** An empowered card's ring of motes, circling its drawing. */
function aura(c: Canvas, pal: readonly number[], now: number) {
  for (let i = 0; i < 8; i++) {
    const ang = now / 260 + (i / 8) * Math.PI * 2
    put(c, 4 + Math.cos(ang) * 3.4, 3.8 + Math.sin(ang) * 2.9, i % 2 ? pal[0]! : pal[1]!)
  }
}

/** The drawing on a card, inside x 1..7, y 1..6; animated by `now`. */
function art(c: Canvas, a: Action, now: number) {
  const el = elementOf(a)
  const big = isEmpowered(a)
  const cx = 4
  if (el === 'fire') {
    const pal = COLORS.spell.fire
    if (big) aura(c, pal, now)
    const width = [0.5, 0.8, 1.3, 1.7, 2.1, 2.2]
    for (let y = 1; y <= 6; y++) {
      const sway = Math.round(Math.sin(now / 110 + y * 0.9) * (6 - y) * 0.18)
      const half = width[y - 1]! * (big ? 1.25 : 1) + (rnd(y, Math.floor(now / 90)) > 0.6 ? 0.5 : 0)
      for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
        const d = Math.abs(x - cx) / Math.max(half, 0.5)
        put(c, x + sway, y, pick(pal, 1 - (y / 6) * 0.8 + d * 0.4))
      }
    }
    if (rnd(7, Math.floor(now / 120)) > 0.5) put(c, cx + 1, 0.5, pal[1]!)
  } else if (el === 'water') {
    const pal = COLORS.spell.water
    const fall = (now / 700) % 1
    const rows = ['...a...', '..aab..', '.aaabb.', '.aaaab.', '..aaa..']
    if (big) aura(c, pal, now)
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => ch !== '.' && put(c, x + 1, y + 1, ch === 'b' ? pal[1]! : pal[2 + ((x + y + Math.floor(now / 200)) % 2)]!)),
    )
    put(c, 3, 3, pal[0]!)
    // A ripple spreads under the drop.
    const r = Math.floor(fall * 4)
    put(c, cx - r, 6, pal[1]!)
    put(c, cx + r, 6, pal[1]!)
  } else if (el === 'nature') {
    const pal = COLORS.spell.nature
    if (big) aura(c, pal, now)
    const sway = Math.sin(now / 300)
    for (let y = 2; y <= 6; y++) put(c, cx + (y < 4 ? Math.round(sway * 0.6) : 0), y, pal[3]!)
    const lx = cx - 2 + Math.round(sway * 0.5)
    put(c, lx, 3, pal[1]!)
    put(c, lx + 1, 3, pal[2]!)
    put(c, lx - 1, 2, pal[1]!)
    const rx = cx + 2 + Math.round(sway * 0.5)
    put(c, rx, 4, pal[1]!)
    put(c, rx - 1, 4, pal[2]!)
    put(c, rx + 1, 3, pal[1]!)
    put(c, cx + Math.round(sway), 1, Math.sin(now / 400) > 0 ? COLORS.petal : pal[0]!)
  } else if (a === 'charge' || a === 'supercharge') {
    const on = Math.sin(now / 150) > -0.4
    const bolt = (x0: number) =>
      ['..X', '.X.', 'XXX', '.X.', 'X..', 'X..'].forEach((row, y) =>
        [...row].forEach((ch, x) => ch === 'X' && put(c, x0 + x, y + 1, on ? COLORS.pickIcon.charge : COLORS.spark[0]!)),
      )
    if (a === 'supercharge') {
      blob(c, cx, 3.5, 3 + Math.sin(now / 200) * 0.6, () => COLORS.gemGlow)
      bolt(1)
      bolt(5)
    } else bolt(3)
    const ang = now / 160
    put(c, cx + Math.cos(ang) * 3, 3.5 + Math.sin(ang) * 2.5, COLORS.gem[0]!)
  } else if (a === 'shield') {
    const rows = ['XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...']
    const shine = Math.floor(now / 120) % 14
    rows.forEach((row, y) =>
      [...row].forEach((ch, x) => {
        if (ch !== 'X') return
        const edge = x === 0 || x === 6 || y === 0 || row[x - 1] !== 'X' || row[x + 1] !== 'X'
        put(c, x + 1, y + 1, x + y === shine ? 0xffffff : edge ? COLORS.shieldEdge : COLORS.shield)
      }),
    )
  } else if (a === 'drain') {
    blob(c, cx, 3.5, 1.2, () => COLORS.drain[1]!)
    for (let i = 0; i < 6; i++) {
      const ang = now / 180 + i * 1.05
      const r = 1.5 + ((i % 3) * 0.6 + now / 500) % 1.8
      put(c, cx + Math.cos(ang) * r, 3.5 + Math.sin(ang) * r * 0.9, COLORS.drain[i % 2 ? 0 : 2]!)
    }
  } else if (a === 'heal') {
    const beat = Math.sin(now / 180) > 0.3
    const s = beat ? 3 : 2
    for (let k = -s; k <= s; k++) {
      put(c, cx + k, 3.5, COLORS.pickIcon.heal)
      put(c, cx, 3.5 + k, COLORS.pickIcon.heal)
    }
    put(c, cx, 3.5, COLORS.healSpark)
  }
}

/** Topples with gravity, a small bounce at the bottom. */
function fallAngle(k: number) {
  const flat = Math.PI / 2
  if (k < 0.75) return flat * (k / 0.75) ** 2
  const b = (k - 0.75) / 0.25
  return flat - Math.sin(b * Math.PI) * 0.18
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
