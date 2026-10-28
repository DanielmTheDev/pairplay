// The duel stage, pure: pixels for a Raster of half blocks (two pixels a cell).
// drawStage(duel, width, view) paints the scene at `view.now` (idle loop), or the
// round in duel.last `view.t` ms into its animation. Host left, guest right, on
// both screens; every random thing is seeded by the round, so both play alike.
// A chaos event plays `view.chaosT` ms into its own animation, after the round.

import type { Action, Duel, Element, Player } from '../types'
import { COST, costOf, elementOf, holds, isEmpowered, LOADOUT_SIZE, MAX_MANA, whyNot, type Ctx } from './game'

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
/** Ms an Avatar State takes to enter and rise, before the round plays. */
export const AVATAR_PRELUDE = 1700
const AVATAR_FLASH = 260

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
  pickIcon: { pass: 0xb8b8c8, charge: 0xffe94a, supercharge: 0xfff7b0, shield: 0x8ad8ff, drain: 0xb85cff, heal: 0x5cff8a, avatar: 0x9ff0ff },
  // The Avatar State: eyes and arrows ablaze, air, water, earth and fire at once.
  avatar: {
    eye: 0xf4ffff,
    arrow: 0xbff8ff,
    aura: 0x7fe8ff,
    glow: 0x9ff0ff,
    /** White-hot core, then fire, water, earth, air. */
    pal: [0xffffff, 0xff8c1f, 0x5cc8ff, 0xb08a5a, 0xe8f4ff],
    earth: [0xb08a5a, 0x7a5a3a, 0x4a3422],
    sky: 0x0c1a44,
  },
  chosen: 0x8affc0,
  chaos: {
    snow: [0xffffff, 0xd8ecff],
    frost: 0xcfeaff,
    ice: [0xe8fbff, 0x9fdcff, 0x5aa8d8],
    cloud: [0x2c2c3a, 0x44445a],
    rainCloud: [0x55607a, 0x6a7590],
    bolt: [0xffffff, 0xfff27a],
    lava: [0xffd24a, 0xff7a1a, 0xe0501a],
    rock: [0x2a1a1a, 0x3e2a26],
    ember: 0xffa040,
    eclipse: 0x1a0a10,
    corona: 0xff6a3a,
    bloodSky: 0x4a0a1a,
    rain: [0x8fc8ff, 0x5a8fd8],
    flower: [0xff9ad5, 0xffe14a, 0xfffff0],
    crack: 0x140c08,
    dust: [0x8a7a62, 0x6a5a48],
    portal: [0xb06cff, 0x5cc8ff, 0xfff0ff, 0x2a1050],
    wind: [0xd8dce8, 0x9aa0b0, 0x6a7080],
  },
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
  pass: ['XXXXX', '.X.X.', '..X..', '.X.X.', 'XXXXX'],
  charge: ['..XX', '.XX.', 'XXXX', '.XX.', 'XX..'],
  supercharge: ['.XX.XX', 'XX.XX.', 'XXXXXX', '.XX.XX', 'XX.XX.'],
  shield: ['XXXXX', 'X...X', 'X...X', '.X.X.', '..X..'],
  drain: ['X...X', 'XX.XX', '.XXX.', '..X..'],
  heal: ['..X..', '..X..', 'XXXXX', '..X..', '..X..'],
  avatar: ['..X..', '.X.X.', 'X.X.X', '.X.X.', '..X..'],
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
  /** Ms into the animation of a chaos event that struck this round; absent when none plays. */
  chaosT?: number
}

export function stageColumns(bodyColumns: number) {
  return Math.max(30, Math.min(64, Math.floor(bodyColumns)))
}

/** How long the animation of duel.last runs: an Avatar State rises first. */
export function roundMs(duel: Duel) {
  const last = duel.last
  const lead = last && Object.values(last.picks).includes('avatar') ? AVATAR_PRELUDE : 0
  if (!last || last.loser === null) return lead + TIE_END
  return lead + (duel.winner !== undefined ? DEATH_END : IMPACT_END)
}

// ─── drawing primitives ──────────────────────────────────────────────────────

type Canvas = { w: number; px: Uint32Array; ox: number; oy: number }
type Pt = { x: number; y: number }
type Side = 'host' | 'guest'
type Move = 'pass' | 'charge' | 'supercharge' | 'shield' | 'drain' | 'heal' | 'avatar'
/** What flies across the stage: an element, a drain, the Avatar State, or nothing. */
type Shot = Element | 'drain' | 'avatar'

function shotOf(a: Action): Shot | null {
  return elementOf(a) ?? (a === 'drain' || a === 'avatar' ? a : null)
}

function palette(shot: Shot): readonly number[] {
  return shot === 'drain' ? COLORS.drain : shot === 'avatar' ? COLORS.avatar.pal : COLORS.spell[shot]
}

/** The staff orb's color while a round charges up. */
function orbColor(a: Action) {
  const shot = shotOf(a)
  if (shot) return palette(shot)[1]!
  if (a === 'pass') return COLORS.pickIcon.pass
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
  /** In the Avatar State: eyes aglow. */
  glow?: boolean
}

function spriteRows(side: Side) {
  return side === 'guest' ? SPRITES.guest.map(r => [...r].reverse().join('')) : SPRITES.host
}

function pixelColor(side: Side, ch: string, pose: Pose) {
  const pal = COLORS[side] as Record<string, number>
  if (ch === 'O') return pose.orb
  if (ch === 'E' && pose.glow) return COLORS.avatar.eye
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
  if (shot === 'avatar') avatarBeam(c, from, head, t, seed)
  else if (shot === 'fire') fireball(c, head, dir, t, seed, big ? 3.2 : 2.6)
  else if (shot === 'water') torrent(c, from, head, t, seed)
  else if (shot === 'nature') vine(c, from.x, head.x, t, seed)
  else {
    for (let i = 1; i < 8; i++) put(c, head.x - dir * i, head.y + Math.sin(i + t / 70), pal[i % 2 ? 2 : 3]!)
    blob(c, head.x, head.y, 2.2, d => pal[d < 0.4 ? 0 : 1]!)
  }
}

/** A charging staff, by what it is about to cast. */
function windUp(c: Canvas, shot: Shot, tip: Pt, body: Pt, k: number, t: number, seed: number) {
  if (shot === 'avatar') return
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

/** The Avatar State let go: four braided streams, fire, water, earth and air, round a white-hot core, widening as they go. */
function avatarBeam(c: Canvas, from: Pt, head: Pt, t: number, seed: number) {
  const { pal, earth, glow } = COLORS.avatar
  const len = Math.abs(head.x - from.x)
  const dir = Math.sign(head.x - from.x) || 1
  for (let s = 0; s <= len; s++) {
    const k = len ? s / len : 1
    const x = from.x + dir * s
    const y = lerp(from.y, head.y, k)
    const width = 0.8 + k * 2.4
    put(c, x, y, pal[0]!)
    if (k > 0.3) put(c, x, y + (s % 2 ? 1 : -1), glow)
    for (let j = 0; j < 4; j++) put(c, x, y + Math.sin(s * 0.45 - t / 45 + j * 1.57) * width, pal[1 + j]!)
    if (rnd(seed, s, Math.floor(t / 90)) > 0.82) put(c, x, y + (rnd(seed, s, 7) - 0.5) * width * 2.6, earth[1 + (s % 2)]!)
  }
  blob(c, head.x, head.y, 3.8 + Math.sin(t / 40) * 0.5, d => (d < 0.4 ? pal[0]! : d < 0.65 ? glow : pal[1 + (Math.floor(d * 8 + t / 60) % 4)]!))
}

/** Behind the avatar: the sky goes deep blue, a white flash as it enters, light pouring out. */
function avatarRays(c: Canvas, at: Pt, k: number, pt: number) {
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + pt / 900
    const len = (i % 2 ? 7 : 12) * k
    for (let r = 3; r < len; r++) put(c, at.x + Math.cos(ang) * r, at.y + Math.sin(ang) * r * 0.8, r > len - 2 ? COLORS.avatar.aura : COLORS.avatar.glow)
  }
}

/**
 * The sphere of the four elements round the avatar: a ring of water, a ring of fire
 * across it, rocks torn from the ground, wind spiralling; `k` how far it has formed.
 * The half behind the wizard draws first, the half in front after.
 */
function avatarSphere(c: Canvas, at: Pt, k: number, pt: number, seed: number, front: boolean) {
  if (k <= 0) return
  const { pal, earth } = COLORS.avatar
  const rx = 8 * k
  for (let a = 0; a < 44; a++) {
    const ang = (a / 44) * Math.PI * 2 + pt / 260
    // Water round the waist, fire up and over: a sphere seen from the side.
    if ((Math.sin(ang) >= 0) === front) put(c, at.x + Math.cos(ang) * rx, at.y + Math.sin(ang) * 3 * k, pal[2]!)
    const ang2 = -ang * 1.3
    if ((Math.cos(ang2) >= 0) === front) put(c, at.x + Math.cos(ang2) * 3.5 * k, at.y + Math.sin(ang2) * 8 * k, rnd(seed, a, Math.floor(pt / 80)) > 0.5 ? pal[1]! : COLORS.spell.fire[1]!)
  }
  for (let i = 0; i < 5; i++) {
    const ang = (i / 5) * Math.PI * 2 - pt / 380
    if ((Math.sin(ang) >= 0) !== front) continue
    blob(c, at.x + Math.cos(ang) * (rx + 1.5), at.y + Math.sin(ang) * 5 * k, 0.9, d => earth[d < 0.5 ? 0 : 1]!)
  }
  if (!front) return
  for (let i = 0; i < 18; i++) {
    const p = (pt / 600 + i / 18) % 1
    const ang = p * Math.PI * 4 + i
    put(c, at.x + Math.cos(ang) * (2 + p * rx * 1.2), at.y + Math.sin(ang) * (1 + p * 6 * k), pal[4]!)
  }
}

/** Rocks breaking out of the ground round the avatar and floating up. */
function risingRocks(c: Canvas, cx: number, pt: number, seed: number) {
  const { earth } = COLORS.avatar
  for (let i = 0; i < 6; i++) {
    const k = phase(pt, 300 + i * 90, 1200 + i * 90)
    if (k <= 0) continue
    const x = cx + (i - 2.5) * 3.4 + (rnd(seed, i, 191) - 0.5) * 2
    const y = lerp(GROUND_Y - 1, SPRITE_TOP + 1 + (i % 3) * 5, k) + Math.sin(pt / 200 + i) * 0.7
    blob(c, x, y, 0.7 + (i % 2) * 0.5, d => earth[d < 0.5 ? 0 : 1]!)
    if (k < 0.3) put(c, x, GROUND_Y, earth[2]!)
  }
  for (let i = 0; i < 10; i++) {
    const p = (pt / 500 + rnd(seed, i, 192)) % 1
    put(c, cx + (rnd(seed, i, 193) - 0.5) * 18, GROUND_Y - p * 4, COLORS.chaos.dust[i % 2]!)
  }
}

/** A glowing outline round a sprite drawn at x0, top. */
function auraOutline(c: Canvas, side: Side, x0: number, top: number, color: number) {
  const rows = spriteRows(side)
  const solid = (x: number, y: number) => (rows[y]?.[x] ?? '.') !== '.'
  for (let y = -1; y <= rows.length; y++) {
    for (let x = -1; x <= SPRITE_W; x++) {
      if (solid(x, y)) continue
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) put(c, x0 + x, top + y, color)
    }
  }
}

/** The arrow tattoo down the hat to the brow, and on the hand, ablaze. */
function arrows(c: Canvas, side: Side, x0: number, top: number) {
  const col = COLORS.avatar.arrow
  const [cx, from, hand] = side === 'host' ? [4, 1, 9] : [5, 2, 1]
  for (let y = from; y <= 5; y++) put(c, x0 + cx, top + y, col)
  put(c, x0 + cx - 1, top + 4, col)
  put(c, x0 + cx + 1, top + 4, col)
  put(c, x0 + hand, top + 10, col)
}

function impact(c: Canvas, shot: Shot, at: Pt, k: number, t: number, seed: number) {
  if (shot === 'drain') return burst(c, at, k, [COLORS.drain], seed)
  if (shot === 'avatar') {
    burst(c, at, k, [COLORS.spell.fire, COLORS.spell.water, COLORS.avatar.earth, [COLORS.avatar.pal[4]!, 0xffffff]], seed)
    // Rocks flung out, falling back down.
    for (let i = 0; i < 8; i++) {
      const ang = rnd(seed, i, 195) * Math.PI * 2
      const v = 6 + rnd(seed, i, 196) * 7
      blob(c, at.x + Math.cos(ang) * v * k, at.y + Math.sin(ang) * v * k * 0.7 + 12 * k * k, 0.8, d => COLORS.avatar.earth[d < 0.5 ? 0 : 1]!)
    }
    return
  }
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

  const last = duel.last
  // An Avatar State enters and rises first (`pt`, ms in); the round's own timeline `t` starts after it.
  const avatarRound = view.t !== undefined && !!last && Object.values(last.picks).includes('avatar')
  const prelude = avatarRound ? AVATAR_PRELUDE : 0
  const pt = view.t ?? 0
  const pre = avatarRound && pt < prelude
  const t = view.t === undefined ? undefined : Math.max(0, view.t - prelude)
  const seed = (last?.round ?? duel.round) * 7919
  const playing = t !== undefined && last !== undefined
  const loser = sideOf(last?.loser)
  const action = (side: Side) => last!.picks[id[side]!]!
  const shot = (side: Side) => shotOf(action(side))
  const shooters = playing && id.host && id.guest ? (['host', 'guest'] as const).filter(side => shot(side)) : []
  const clash = shooters.length === 2
  /** How much `side` healed this round; 0 when not healing, or hit. */
  const healed = (side: Side) => (playing && id[side] ? (last.healed[id[side]!] ?? 0) : 0)
  // Chaos that struck this round: until it lands, life and mana are as it found them.
  const struck = duel.chaos && duel.chaos.round === duel.round && duel.winner === undefined ? duel.chaos : undefined
  const ct = struck ? view.chaosT : undefined
  const early = !!struck && (playing || (ct !== undefined && ct < CHAOS_SWITCH))
  const was = (side: Side) => (early ? struck!.before[id[side]!] : undefined)
  const shownMana = (side: Side) => was(side)?.mana ?? duel.players[id[side]!]!.mana
  /** Life as the round shows it at `t`: a hit lands at PUSH_END, a heal at CLASH_END. */
  const shownLife = (side: Side) => {
    const life = was(side)?.life ?? duel.players[id[side]!]!.life
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
  const roundEnd = roundMs(duel) - prelude
  const inAvatar = (side: Side) => playing && !!id[side] && last.picks[id[side]!] === 'avatar'
  /** How far the avatar floats: up as it enters, down when a drain stops it or the round is done. */
  const lift = (side: Side) => {
    if (!inAvatar(side)) return 0
    if (pre) return -Math.round(5 * phase(pt, 200, 1100))
    const down = side === loser ? phase(t!, PUSH_END, PUSH_END + 200) : phase(t!, roundEnd - 600, roundEnd - 100)
    return -Math.round(5 * (1 - down))
  }
  /** Eyes and arrows ablaze: from the flash on, until it is stopped or comes down. */
  const ablaze = (side: Side) => inAvatar(side) && (pre ? pt >= AVATAR_FLASH : side === loser ? t! < PUSH_END : t! < roundEnd - 300)

  const flash = playing && clash && t >= TRAVEL_END && t < TRAVEL_END + 100 ? 0.45 : 0
  backdrop(c, view.now, flash)
  if (pre) {
    tintSky(c, COLORS.avatar.sky, 0.5 * phase(pt, 0, 300))
    if (pt >= AVATAR_FLASH && pt < AVATAR_FLASH + 200) tintSky(c, 0xffffff, 0.55 * (1 - phase(pt, AVATAR_FLASH, AVATAR_FLASH + 200)))
  } else if (ablaze('host') || ablaze('guest')) tintSky(c, COLORS.avatar.sky, 0.3)
  // A chaos event that struck this round waits for the round to play out.
  const showChaos = !!duel.chaos && !(struck && playing)
  if (showChaos) chaosBack(c, duel, ct, view.now, seed)
  if (!playing && !deadSide) fireflies(c, view.now)
  for (const side of ['host', 'guest'] as const) {
    if (id[side]) crystals(c, body(side).x, shownMana(side), view.now, side === 'host' ? 1 : 2)
  }

  const quaking = struck?.event === 'quake' && ct !== undefined && ct > 300 && ct < CHAOS_EFFECT
  const entering = pre && pt > 300 && pt < 1100
  const shaking = quaking || entering || (playing && ((clash && t >= TRAVEL_END && t < CLASH_END) || (loser && t >= PUSH_END && t < PUSH_END + 260)))
  const shakeT = (pre ? pt : playing ? t : ct) ?? 0
  const shake = () => {
    if (shaking) {
      c.ox = Math.floor(shakeT / 50) % 2 ? 1 : -1
      c.oy = Math.floor(shakeT / 75) % 2 ? 1 : 0
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
      // The Avatar State: rays and rising rocks as it enters, a sphere of the elements, a glowing outline.
      const up = lift(side)
      const glow = ablaze(side)
      const top = SPRITE_TOP + hop + up
      const centre = { x: body(side).x, y: body(side).y + up - 1 }
      const formed = !inAvatar(side) ? 0 : pre ? phase(pt, 250, 900) : 1 - phase(t!, 0, CHARGE_END)
      if (glow) {
        if (pre) {
          avatarRays(c, centre, phase(pt, AVATAR_FLASH, 700), pt)
          risingRocks(c, body(side).x, pt, seed)
        }
        avatarSphere(c, centre, formed, pt, seed, false)
        auraOutline(c, side, xs[side], top, COLORS.avatar.aura)
      }
      wizard(c, side, xs[side], {
        orb: victorious ? COLORS.spark[0]! : orb,
        blink,
        dy: hop + up,
        ...(glow ? { glow } : {}),
        ...(victorious ? { victory: true } : {}),
        ...(tint ? { tint } : {}),
      })
      if (glow) {
        arrows(c, side, xs[side], top)
        avatarSphere(c, centre, formed, pt, seed, true)
      }
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

  if (playing && !pre && id.host && id.guest) {
    const midX = width / 2
    const midY = SPRITE_TOP + 6
    const start = (side: Side): Pt =>
      shot(side) === 'nature'
        ? { x: body(side).x + dirOf(side) * 6, y: GROUND_Y - 1 }
        : shot(side) === 'avatar'
          ? { x: body(side).x + dirOf(side) * 5, y: body(side).y + lift(side) - 1 }
          : tips[side]
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
      // The Avatar State breaks through a shield.
      const blocked = action(side) === 'shield' && side !== loser
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
  if (showChaos && id.host && id.guest) {
    const sides = ['host', 'guest'] as const
    const gems = (side: Side) => [0, 1, 2].map(i => ({ x: Math.round(body(side).x - 6 + i * 4) + 1, y: GROUND_Y + 3 }))
    chaosFront(c, duel, ct, {
      w: width,
      mid: width / 2,
      gems: { host: gems('host'), guest: gems('guest') },
      tips,
      bodies: { host: body('host'), guest: body('guest') },
      dirs: { host: 1, guest: -1 },
      hearts: xs,
      sides,
    }, seed)
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

// ─── chaos ───────────────────────────────────────────────────────────────────

/** A chaos event plays this long: the world strikes, then from CHAOS_EFFECT on, what it does to the players. */
export const CHAOS_MS = 4200
const CHAOS_EFFECT = 2600
/** When life and mana change over to the struck values. */
const CHAOS_SWITCH = 3300

type Geo = {
  w: number
  mid: number
  /** The centre of each mana gem in the ground, by side. */
  gems: Record<Side, Pt[]>
  tips: Record<Side, Pt>
  bodies: Record<Side, Pt>
  dirs: Record<Side, number>
  /** Where each side's hearts start. */
  hearts: Record<Side, number>
  sides: readonly Side[]
}

/** In, hold, out: how strongly the world event shows at `t`. */
function fade(t: number) {
  return Math.min(1, t / 400) * (1 - phase(t, CHAOS_MS - 500, CHAOS_MS))
}

/** Mixes the sky, everything above the ground, toward `color`. */
function tintSky(c: Canvas, color: number, k: number) {
  if (k <= 0) return
  for (let i = 0; i < GROUND_Y * c.w; i++) c.px[i] = mix(c.px[i]!, color, k)
}

function clouds(c: Canvas, t: number, pal: readonly number[], k: number) {
  const n = Math.ceil(c.w / 5)
  for (let i = 0; i < n; i++) {
    const x = ((i * 5 + t * 0.004 * (1 + (i % 3))) % (c.w + 8)) - 4
    const y = 1.5 + rnd(i, 101) * 3 - (1 - k) * 8
    blob(c, x, y, 2.2 + rnd(i, 102) * 1.4, d => pal[d < 0.6 ? 1 : 0]!)
  }
}

/** Which bolt of the storm is lit at `t`; -1 between bolts. */
function boltAt(t: number) {
  return t % 320 < 110 ? Math.floor(t / 320) : -1
}

function bolt(c: Canvas, x: number, y0: number, y1: number, seed: number) {
  for (let y = y0; y <= y1; y++) {
    const xx = x + Math.round((rnd(seed, y, 122) - 0.5) * 4 * (1 - (y - y0) / Math.max(1, y1 - y0)))
    put(c, xx, y, COLORS.chaos.bolt[0]!)
    put(c, xx + 1, y, COLORS.chaos.bolt[1]!)
  }
}

/** A volcano grown out of the horizon; erupting, it throws lava, else it smokes. */
function volcano(c: Canvas, cx: number, rise: number, t: number, seed: number, erupting: boolean) {
  const { lava, rock } = COLORS.chaos
  const h = Math.round(11 * rise)
  const top = GROUND_Y - 1 - h
  for (let r = 0; r <= h; r++) {
    const half = 1.5 + r * 0.85
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x++) {
      const streak = r < h * 0.7 && Math.abs(x - cx - Math.sin(r * 0.7) * r * 0.3) < 0.6
      put(c, x, top + r, r < 2 ? lava[r]! : streak ? lava[2]! : rnd(x, r, 131) > 0.8 ? rock[1]! : rock[0]!)
    }
  }
  if (erupting) {
    for (let i = 0; i < 28; i++) {
      const age = ((t + i * 40) % 900) / 900
      const vx = (rnd(seed, i, 132) - 0.5) * 16
      const vy = -(10 + rnd(seed, i, 133) * 10)
      put(c, cx + vx * age, top + vy * age + 24 * age * age, lava[i % 3]!)
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const p = (t / 1800 + i / 4) % 1
      blob(c, cx + Math.sin(p * 3 + i) * 2, top - 1 - p * 8, 0.7 + p * 1.2, () => COLORS.smoke[i % 2]!)
    }
  }
}

/** The moon, `cover` of the way behind a dark disc; fully covered, a burning ring. */
function eclipseMoon(c: Canvas, mx: number, cover: number) {
  blob(c, mx - (1 - cover) * 6, 4, 2.7, () => COLORS.chaos.eclipse)
  if (cover < 0.95) return
  for (let a = 0; a < 24; a++) {
    const ang = (a / 24) * Math.PI * 2
    put(c, mx + Math.cos(ang) * 3.6, 4 + Math.sin(ang) * 3.3, a % 3 ? COLORS.chaos.corona : 0xffd0a0)
  }
}

function portal(c: Canvas, cx: number, cy: number, t: number, k: number) {
  if (k <= 0) return
  const pal = COLORS.chaos.portal
  blob(c, cx, cy, 1.4 * k, () => pal[3]!)
  for (let i = 0; i < 48; i++) {
    const r = (i / 48) * 7 * k
    const ang = i * 0.55 - t / 160
    put(c, cx + Math.cos(ang) * r, cy + Math.sin(ang) * r * 0.75, pal[i % 3]!)
  }
}

/** Cracks running out from the middle of the ground, `k` of the way. */
function cracks(c: Canvas, mid: number, k: number, seed: number) {
  for (const dir of [-1, 1]) {
    let y = GROUND_Y
    for (let s = 0; s < k * mid * 0.9; s++) {
      const r = rnd(seed, s, dir, 141)
      if (r > 0.7) y = Math.min(GROUND_Y + 3, y + 1)
      else if (r < 0.3) y = Math.max(GROUND_Y - 1, y - 1)
      put(c, mid + dir * s, y, COLORS.chaos.crack)
      if (s % 7 === 3) put(c, mid + dir * s, y + 1, COLORS.chaos.crack)
    }
  }
}

/** Behind the wizards: the sky the event brings, and what stays while it holds. */
function chaosBack(c: Canvas, duel: Duel, ct: number | undefined, now: number, seed: number) {
  const ch = duel.chaos!
  const lasting = holds(duel, ch.event)
  const f = ct === undefined ? 0 : fade(ct)
  const mx = Math.floor(c.w / 2) - 1
  switch (ch.event) {
    case 'blizzard':
      tintSky(c, COLORS.chaos.frost, 0.3 * f)
      break
    case 'lightning':
      tintSky(c, 0x05050c, 0.5 * f)
      if (ct !== undefined && ct < CHAOS_EFFECT && boltAt(ct) >= 0) tintSky(c, 0xffffff, 0.25)
      if (ct !== undefined) clouds(c, ct, COLORS.chaos.cloud, f)
      break
    case 'rain':
      tintSky(c, 0x40506a, 0.35 * f)
      if (ct !== undefined) clouds(c, ct, COLORS.chaos.rainCloud, f)
      break
    case 'volcano': {
      tintSky(c, 0x5a1a0a, 0.35 * f + (lasting ? 0.12 : 0))
      const rise = ct !== undefined ? phase(ct, 0, 900) : lasting ? 1 : 0
      if (rise > 0) volcano(c, mx + 1, rise, ct ?? now, seed, ct !== undefined && ct >= 900 && ct < CHAOS_EFFECT)
      break
    }
    case 'eclipse': {
      const cover = ct !== undefined ? phase(ct, 0, 1800) : lasting ? 1 : 0
      tintSky(c, COLORS.chaos.bloodSky, 0.45 * Math.max(f * cover, lasting ? 0.5 : 0))
      if (cover > 0) eclipseMoon(c, mx, cover)
      break
    }
    case 'rift':
      if (ct !== undefined) portal(c, mx + 1, 9, ct, phase(ct, 0, 800) * (1 - phase(ct, CHAOS_MS - 800, CHAOS_MS - 200)))
      break
    case 'quake':
    case 'tornado':
      tintSky(c, 0x3a3a30, 0.25 * f)
      break
  }
}

/** In front of the wizards: the event itself, then what it does to the players. */
function chaosFront(c: Canvas, duel: Duel, ct: number | undefined, g: Geo, seed: number) {
  const ch = duel.chaos!
  if (ch.event === 'quake' && (ct !== undefined || holds(duel, 'quake'))) cracks(c, g.mid, ct === undefined ? 1 : phase(ct, 300, 1800), seed)
  if (ct === undefined) return
  const f = fade(ct)
  const { chaos } = COLORS
  const [host, guest] = g.sides as [Side, Side]
  const other = (side: Side) => (side === host ? guest : host)
  switch (ch.event) {
    case 'blizzard': {
      for (let i = 0; i < 70; i++) {
        const sp = 0.6 + rnd(seed, i, 111)
        const x = (rnd(seed, i, 112) * g.w + ct * 0.03 * sp) % g.w
        const y = (rnd(seed, i, 113) * (GROUND_Y + 4) + ct * 0.012 * sp) % (GROUND_Y + 4)
        if (rnd(seed, i, 114) < f) put(c, x, y - 2, chaos.snow[i % 2]!)
      }
      // Frost creeps over the grass.
      const frost = phase(ct, 300, CHAOS_EFFECT)
      for (let x = 0; x < g.w; x++) {
        if (rnd(x, 115) < frost) put(c, x, GROUND_Y, chaos.frost)
        if (rnd(x, 116) < frost * 0.6) put(c, x, GROUND_Y - 1, chaos.snow[0]!)
      }
      // The gems ice over, then shatter.
      if (ct < CHAOS_EFFECT) break
      for (const side of g.sides) {
        g.gems[side].forEach((gem, j) => {
          if (ct < CHAOS_SWITCH) {
            const k = phase(ct, CHAOS_EFFECT, CHAOS_SWITCH - 200)
            for (let y = -2; y <= 2; y++) for (let x = -1; x <= 1; x++) if (rnd(seed, j, x, y, 117) < k) put(c, gem.x + x, gem.y + y, chaos.ice[(x + y + 3) % 3]!)
          } else {
            const k = phase(ct, CHAOS_SWITCH, CHAOS_MS)
            for (let s = 0; s < 6; s++) {
              const ang = rnd(seed, j, s, 118) * Math.PI * 2
              put(c, gem.x + Math.cos(ang) * k * 6, gem.y - Math.abs(Math.sin(ang)) * k * 5 + k * k * 5, chaos.ice[s % 3]!)
            }
          }
        })
      }
      break
    }
    case 'lightning': {
      const n = boltAt(ct)
      if (n >= 0 && ct < CHAOS_EFFECT) bolt(c, 4 + rnd(seed, n, 121) * (g.w - 8), 3, GROUND_Y - 1, seed + n)
      // A bolt into each gem in turn, and it lights up.
      if (ct < CHAOS_EFFECT) break
      g.sides.flatMap(side => g.gems[side]).forEach((gem, j) => {
        const at = CHAOS_EFFECT + j * 110
        if (ct >= at && ct < at + 90) bolt(c, gem.x, 2, gem.y - 3, seed + 50 + j)
        if (ct >= at && ct < CHAOS_MS - 400) for (const [dx, dy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]] as const) put(c, gem.x + dx, gem.y + dy, chaos.bolt[1]!)
      })
      break
    }
    case 'volcano': {
      // Lava rains down, then embers find each staff.
      if (ct > 1200 && ct < CHAOS_EFFECT + 300) {
        for (let i = 0; i < 30; i++) {
          const x = rnd(seed, i, 151) * g.w
          const y = (rnd(seed, i, 152) * GROUND_Y + (ct - 1200) * 0.02 * (0.6 + rnd(seed, i, 153))) % GROUND_Y
          put(c, x, y, i % 3 ? chaos.ember : chaos.lava[0]!)
        }
      }
      if (ct < CHAOS_EFFECT) break
      const top = { x: g.mid, y: GROUND_Y - 12 }
      for (const side of g.sides) {
        const tip = g.tips[side]
        for (let i = 0; i < 6; i++) {
          const k = phase(ct, CHAOS_EFFECT + i * 60, CHAOS_EFFECT + 600 + i * 60)
          if (k > 0 && k < 1) put(c, lerp(top.x, tip.x, k), lerp(top.y, tip.y, k) - Math.sin(k * Math.PI) * 5, chaos.lava[i % 3]!)
        }
        if (ct > CHAOS_EFFECT + 600) blob(c, tip.x, tip.y, 1.3 + Math.sin(ct / 90) * 0.3, d => chaos.lava[d < 0.5 ? 0 : 1]!)
      }
      break
    }
    case 'eclipse': {
      // The ring of elements turns the other way.
      if (ct < CHAOS_EFFECT - 200) break
      const k = phase(ct, CHAOS_EFFECT - 200, CHAOS_EFFECT + 200) * (1 - phase(ct, CHAOS_MS - 300, CHAOS_MS))
      for (const [i, el] of (['fire', 'water', 'nature'] as const).entries()) {
        const ang = i * 2.094 - (ct - CHAOS_EFFECT) / 250
        icon(c, el, g.mid + Math.cos(ang) * 7 * k - 2, 9 + Math.sin(ang) * 4 * k - 3)
      }
      break
    }
    case 'rain': {
      for (let i = 0; i < 60; i++) {
        if (rnd(seed, i, 161) > f) continue
        const x = (((rnd(seed, i, 162) * g.w - ct * 0.012) % g.w) + g.w) % g.w
        const y = (rnd(seed, i, 163) * GROUND_Y + ct * 0.07 * (0.8 + rnd(seed, i, 164))) % GROUND_Y
        put(c, x, y, chaos.rain[0]!)
        put(c, x, y - 1, chaos.rain[1]!)
      }
      // Flowers come up.
      for (let i = 0; i < Math.floor(g.w / 5); i++) {
        const x = 2 + i * 5 + Math.floor(rnd(seed, i, 165) * 3)
        const from = 900 + rnd(seed, i, 166) * 800
        const grow = phase(ct, from, from + 900)
        const h = Math.round(grow * 2)
        for (let s = 0; s < h; s++) put(c, x, GROUND_Y - 1 - s, COLORS.grass[1]!)
        if (grow >= 1) {
          put(c, x, GROUND_Y - 1 - h, chaos.flower[i % 3]!)
          put(c, x - 1, GROUND_Y - 1 - h, chaos.flower[(i + 1) % 3]!)
          put(c, x + 1, GROUND_Y - 1 - h, chaos.flower[(i + 1) % 3]!)
        }
      }
      // Healing motes rise from them into the hearts.
      if (ct < CHAOS_EFFECT) break
      for (const side of g.sides) {
        for (let i = 0; i < 10; i++) {
          const k = phase(ct, CHAOS_EFFECT + i * 50, CHAOS_SWITCH + i * 30)
          if (k <= 0 || k >= 1) continue
          const x = lerp(g.hearts[side] + rnd(seed, i, 167) * 10, g.hearts[side] + 1 + (i % 3) * 4, k)
          put(c, x, lerp(GROUND_Y - 2, 1, k), i % 2 ? COLORS.healSpark : chaos.rain[0]!)
        }
      }
      break
    }
    case 'quake': {
      if (ct < CHAOS_EFFECT) {
        for (let i = 0; i < 20; i++) {
          const p = (ct / 700 + rnd(seed, i, 171)) % 1
          put(c, rnd(seed, i, 172) * g.w, GROUND_Y - p * 6, chaos.dust[i % 2]!)
        }
        break
      }
      // A shield springs up before each wizard, and cracks.
      for (const side of g.sides) {
        const wall = g.bodies[side].x + g.dirs[side] * 8
        if (ct < CHAOS_SWITCH) {
          shieldWall(c, wall, g.dirs[side], phase(ct, CHAOS_EFFECT, CHAOS_EFFECT + 300), ct)
          if (ct > CHAOS_EFFECT + 350) {
            for (let y = SPRITE_TOP; y < GROUND_Y; y++) put(c, wall + g.dirs[side] * (1 + (rnd(seed, y, 173) > 0.5 ? 1 : 0)), y, chaos.crack)
          }
        } else {
          const k = phase(ct, CHAOS_SWITCH, CHAOS_MS)
          for (let i = 0; i < 12; i++) {
            const y = SPRITE_TOP + rnd(seed, i, 174) * 14 + k * k * 16
            if (y < GROUND_Y) put(c, wall + g.dirs[side] * 2 + (rnd(seed, i, 175) - 0.5) * 5 * (1 + k), y, i % 2 ? COLORS.shield : COLORS.shieldEdge)
          }
        }
      }
      break
    }
    case 'rift': {
      // Time streams out of the rift into both wizards: every cooldown runs out.
      if (ct < CHAOS_EFFECT) break
      for (const side of g.sides) {
        const b = g.bodies[side]
        for (let i = 0; i < 9; i++) {
          const k = phase(ct, CHAOS_EFFECT + i * 40, CHAOS_SWITCH + i * 40)
          if (k > 0 && k < 1) put(c, lerp(g.mid, b.x, k) + Math.sin(k * 6 + i) * 2, lerp(9, b.y, k), chaos.portal[i % 3]!)
        }
        if (ct >= CHAOS_SWITCH) {
          const r = 3 + phase(ct, CHAOS_SWITCH, CHAOS_MS) * 6
          for (let a = 0; a < 14; a++) put(c, b.x + Math.cos(a * 0.45) * r, b.y + Math.sin(a * 0.45) * r * 0.8, chaos.portal[a % 2]!)
        }
      }
      break
    }
    case 'tornado': {
      if (ct < CHAOS_EFFECT + 200) {
        const cx = lerp(-6, g.w + 6, phase(ct, 200, CHAOS_EFFECT + 200))
        for (let y = 3; y < GROUND_Y; y++) {
          const width = 0.8 + ((GROUND_Y - y) / GROUND_Y) * 6
          const sway = Math.sin(y * 0.3 + ct / 200) * 1.5
          for (let j = 0; j < 3; j++) put(c, cx + sway + Math.cos(ct / 50 + y * 0.5 + j * 2.1) * width, y, chaos.wind[(j + y) % 3]!)
        }
        for (let i = 0; i < 10; i++) {
          const ang = ct / 90 + i
          put(c, cx + Math.cos(ang) * (4 + (i % 3)), GROUND_Y - 2 - ((i * 3) % 16), i % 2 ? COLORS.dirt[0]! : COLORS.grass[1]!)
        }
        for (let i = 0; i < 15; i++) {
          const x = (rnd(seed, i, 181) * g.w + ct * 0.06) % g.w
          const y = rnd(seed, i, 182) * GROUND_Y
          for (let k = 0; k < 3; k++) put(c, x + k, y, chaos.wind[0]!)
        }
      }
      // The mana whirls up into the middle and comes down shared out.
      if (ct < CHAOS_EFFECT) break
      const centre = { x: g.mid, y: 14 }
      for (const side of g.sides) {
        g.gems[side].forEach((gem, j) => {
          const to = g.gems[other(side)][j]!
          const k = phase(ct, CHAOS_EFFECT + j * 60, CHAOS_MS - 300)
          if (k <= 0 || k >= 1) return
          const [a, b, q]: [Pt, Pt, number] = k < 0.5 ? [gem, centre, k * 2] : [centre, to, (k - 0.5) * 2]
          const swirl = Math.sin(k * Math.PI) * 3
          put(c, lerp(a.x, b.x, q) + Math.cos(k * 14 + j) * swirl, lerp(a.y, b.y, q) + Math.sin(k * 14 + j) * swirl * 0.6, COLORS.mana)
        })
      }
      break
    }
  }
}

// ─── action cards ────────────────────────────────────────────────────────────

/** One card per action, CARD_COLS wide (the last column a gap), CARD_ROWS tall. */
export const CARD_COLS = 10
export const CARD_ROWS = 5
export const CARD_PX_H = CARD_ROWS * 2
const CARD_W = CARD_COLS - 1

/** A card's face at the canvas offset: frame, drawing, cost as mana pips (red ones short of it). */
function face(c: Canvas, a: Action, now: number, edge: number, cost: number, short: boolean) {
  for (let y = 0; y < CARD_PX_H; y++) {
    for (let x = 0; x < CARD_W; x++) {
      const corner = (x === 0 || x === CARD_W - 1) && (y === 0 || y === CARD_PX_H - 1)
      if (!corner) put(c, x, y, x === 0 || y === 0 || x === CARD_W - 1 || y === CARD_PX_H - 1 ? edge : COLORS.card)
    }
  }
  art(c, a, now)
  for (let k = 0; k < cost; k++) for (let y = 7; y <= 8; y++) put(c, 2 + k * 2, y, short ? COLORS.manaShort : COLORS.mana)
}

const edgeOf = (a: Action) => (isEmpowered(a) || a === 'avatar' ? COLORS.cardGold : COLORS.cardEdge)

/** Greys a card's pixels, `x0` to `x0 + CARD_W`, keeping the red of a missing mana. */
function greyOut(px: Uint32Array, w: number, x0: number) {
  for (let y = 0; y < CARD_PX_H; y++) {
    for (let x = x0; x < x0 + CARD_W; x++) {
      const at = y * w + x
      const col = px[at]!
      if (col && col !== COLORS.manaShort) px[at] = grey(col)
    }
  }
}

/**
 * The pane's action cards: a little animated drawing each, cost as mana pips.
 * What `p` may not pick is grey, with the rounds left in red when on cooldown.
 */
export function drawCards(actions: Action[], p: Player | undefined, now: number, ctx: Ctx = {}): Uint32Array {
  const w = actions.length * CARD_COLS
  const px = new Uint32Array(w * CARD_PX_H)
  actions.forEach((a, i) => {
    const c: Canvas = { w, px, ox: i * CARD_COLS, oy: 0 }
    const why = p ? whyNot(p, a, ctx) : 'not seated'
    face(c, a, now + i * 137, edgeOf(a), costOf(a, ctx.duel), !!why?.startsWith('needs'))
    if (why) {
      greyOut(px, w, i * CARD_COLS)
      const left = cooldownOf(p, a)
      if (left > 0) glyphs(c, GLYPHS[String(left)]!, 3, 2, COLORS.cooldown)
    }
  })
  return px
}

/**
 * The choosing grid's row: a card centred in each `cell` columns, the chosen ones
 * edged and ticked; once the hand is full, the rest go grey.
 */
export function drawDraft(actions: Action[], chosen: readonly Action[], now: number, cell: number): Uint32Array {
  const w = actions.length * cell
  const px = new Uint32Array(w * CARD_PX_H)
  actions.forEach((a, i) => {
    const x0 = i * cell + Math.max(0, Math.floor((cell - CARD_COLS) / 2))
    const c: Canvas = { w, px, ox: x0, oy: 0 }
    const on = chosen.includes(a)
    face(c, a, now + i * 137, on ? COLORS.chosen : edgeOf(a), COST[a], false)
    // A tick in the corner.
    if (on) for (const [x, y] of [[5, 2], [6, 3], [7, 2], [8, 1]] as const) put(c, x - 1, y - 1, COLORS.chosen)
    else if (chosen.length >= LOADOUT_SIZE) greyOut(px, w, x0)
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
  if (a === 'shield') return p.shieldCooldown
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
  } else if (a === 'pass') {
    // An hourglass, its sand running down.
    const rows = ['XXXXX', '.X.X.', '..X..', '.X.X.', 'XXXXX']
    const fall = Math.floor(now / 300) % 3
    rows.forEach((row, y) => [...row].forEach((ch, x) => ch === 'X' && put(c, x + 2, y + 1, COLORS.pickIcon.pass)))
    put(c, cx, 2 + fall, COLORS.pickIcon.charge)
  } else if (a === 'avatar') {
    // A glowing core with the four elements circling it.
    const pal = COLORS.avatar.pal
    blob(c, cx, 3.5, 1.2 + Math.sin(now / 160) * 0.4, d => (d < 0.5 ? pal[0]! : COLORS.avatar.glow))
    for (let i = 0; i < 4; i++) {
      const ang = now / 220 + (i / 4) * Math.PI * 2
      put(c, cx + Math.cos(ang) * 3, 3.5 + Math.sin(ang) * 2.6, pal[1 + i]!)
    }
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
