// Host-authoritative mana duel, pure: the host alone applies intents and broadcasts
// numbered snapshots; guests send intents and keep the newest snapshot.
// Picks live in HostState.picks, never in the broadcast Duel, until a round resolves.

import type { Action, Chaos, ChaosEvent, Duel, Element, Player } from '../types'

export const ELEMENTS: Element[] = ['fire', 'water', 'nature']
export const ACTIONS: Action[] = ['pass', 'charge', 'shield', 'drain', 'heal', ...ELEMENTS, 'avatar']
export const START_LIFE = 3
export const START_MANA = 1
export const MAX_MANA = 3
export const SHIELD_COOLDOWN = 2
export const DRAIN_COOLDOWN = 2
export const HEAL_COOLDOWN = 1
export const HEAL_AMOUNT = 2
/** The Avatar State: entered at full mana, for its cost; holds this many rounds, then cools down as long. */
export const AVATAR_NEEDS = 3
export const AVATAR_ROUNDS = 3
export const AVATAR_COOLDOWN = 3
/** An action picked more often than this, in a game, wants rebalancing. */
export const OVERUSED = 0.4

const BEATS: Record<Element, Element> = { water: 'fire', fire: 'nature', nature: 'water' }

export const COST: Record<Action, number> = {
  pass: 0,
  charge: 0,
  shield: 0,
  drain: 1,
  heal: 1,
  fire: 1,
  water: 1,
  nature: 1,
  avatar: 2,
}

// ─── chaos ───────────────────────────────────────────────────────────────────

export const CHAOS_EVENTS: ChaosEvent[] = ['blizzard', 'lightning', 'volcano', 'eclipse', 'rain', 'quake', 'rift', 'tornado']
/** No chaos before this round; one for sure by CHAOS_BY; in between, and after, CHAOS_CHANCE a round. */
export const CHAOS_FROM = 3
export const CHAOS_BY = 6
export const CHAOS_CHANCE = 0.25

export const CHAOS_INFO: Record<ChaosEvent, { name: string; effect: string; rounds: number }> = {
  blizzard: { name: 'Blizzard', effect: 'the mana crystals freeze over: both drop to 0 mana', rounds: 1 },
  lightning: { name: 'Lightning Storm', effect: 'bolts strike the crystals: both at 3 mana', rounds: 1 },
  volcano: { name: 'Volcano Eruption', effect: 'fire, water and nature cost 0 for 2 rounds', rounds: 2 },
  eclipse: { name: 'Eclipse', effect: 'the elements turn: fire > water > nature > fire, for 2 rounds', rounds: 2 },
  rain: { name: 'Healing Rain', effect: 'both +1 life', rounds: 1 },
  quake: { name: 'Earthquake', effect: 'shields crack: no shield this round', rounds: 1 },
  rift: { name: 'Time Rift', effect: 'every cooldown is reset', rounds: 1 },
  tornado: { name: 'Tornado', effect: 'the mana whirls together: both get the average', rounds: 1 },
}

export const INITIAL_DUEL: Duel = { seq: 0, round: 1, players: {} }

export type HostState = { duel: Duel; picks: Record<string, Action> }

export type Intent = { kind: 'act'; action: Action } | { kind: 'rematch' }

/** What a rule may depend on besides the player: the duel (chaos). */
export type Ctx = { duel?: Duel }

/** Whether `a` beats `b`; under an eclipse, the other way round. */
export function beats(a: Element, b: Element, reversed = false) {
  return reversed ? BEATS[b] === a : BEATS[a] === b
}

export function isElement(raw: unknown): raw is Element {
  return typeof raw === 'string' && (ELEMENTS as string[]).includes(raw)
}

export function isAction(raw: unknown): raw is Action {
  return typeof raw === 'string' && (ACTIONS as string[]).includes(raw)
}

export function isChaosEvent(raw: unknown): raw is ChaosEvent {
  return typeof raw === 'string' && (CHAOS_EVENTS as string[]).includes(raw)
}

/** Whether chaos `event` holds in the duel's current round. */
export function holds(duel: Pick<Duel, 'chaos' | 'round'>, event: ChaosEvent) {
  const c = duel.chaos
  return !!c && c.event === event && duel.round >= c.round && duel.round <= c.until
}

/** What `a` costs this round: a volcano makes the basic elements free. */
export function costOf(a: Action, duel?: Duel) {
  return duel && isElement(a) && holds(duel, 'volcano') ? 0 : COST[a]
}

/** Mana `p` must have to pick `a`: its cost, or for the Avatar State, full mana. */
export function needOf(a: Action, duel?: Duel) {
  return a === 'avatar' ? AVATAR_NEEDS : costOf(a, duel)
}

/** Why `p` may not pick `a` this round; null when they may. */
export function whyNot(p: Player, a: Action, { duel }: Ctx = {}): string | null {
  const need = needOf(a, duel)
  if (p.mana < need) return `needs ${need} mana`
  if (a === 'charge' && p.mana >= MAX_MANA) return 'mana full'
  if (a === 'shield' && p.shieldCooldown > 0) return `shield in ${p.shieldCooldown}`
  if (a === 'shield' && duel && holds(duel, 'quake')) return 'earthquake'
  if (a === 'drain' && p.drainCooldown > 0) return `drain in ${p.drainCooldown}`
  if (a === 'heal' && p.life >= START_LIFE) return 'life full'
  if (a === 'heal' && p.healCooldown > 0) return `heal in ${p.healCooldown}`
  if (a === 'avatar' && p.avatarRounds > 0) return 'avatar active'
  if (a === 'avatar' && p.avatarCooldown > 0) return `avatar in ${p.avatarCooldown}`
  return null
}

/** Whether `p` may pick `a` this round. */
export function legal(p: Player, a: Action, ctx: Ctx = {}) {
  return whyNot(p, a, ctx) === null
}

function isChaos(raw: unknown): raw is Chaos {
  if (!raw || typeof raw !== 'object') return false
  const c = raw as Partial<Chaos>
  return isChaosEvent(c.event) && typeof c.round === 'number' && typeof c.until === 'number' && !!c.before && typeof c.before === 'object'
}

export function isDuel(raw: unknown): raw is Duel {
  if (!raw || typeof raw !== 'object') return false
  const d = raw as Partial<Duel>
  return (
    typeof d.seq === 'number' &&
    typeof d.round === 'number' &&
    (d.chaos === undefined || isChaos(d.chaos)) &&
    !!d.players &&
    typeof d.players === 'object' &&
    Object.values(d.players).every(
      p =>
        !!p &&
        typeof p.name === 'string' &&
        typeof p.life === 'number' &&
        typeof p.mana === 'number' &&
        typeof p.picked === 'boolean' &&
        typeof p.shieldCooldown === 'number' &&
        typeof p.drainCooldown === 'number' &&
        typeof p.healCooldown === 'number' &&
        typeof p.avatarRounds === 'number' &&
        typeof p.avatarCooldown === 'number',
    )
  )
}

function fresh(name: string): Player {
  return {
    name,
    life: START_LIFE,
    mana: START_MANA,
    picked: false,
    shieldCooldown: 0,
    drainCooldown: 0,
    healCooldown: 0,
    avatarRounds: 0,
    avatarCooldown: 0,
  }
}

/** Host side: seats a player; null when already seated or both seats are taken. */
export function seat(duel: Duel, id: string, name: string): Duel | null {
  if (duel.players[id] || Object.keys(duel.players).length >= 2) return null
  return { ...duel, seq: duel.seq + 1, players: { ...duel.players, [id]: fresh(name) } }
}

/** Host side: the next state, or null when the intent is not allowed. `rand` rolls the chaos dice. */
export function applyIntent(state: HostState, player: string, intent: unknown, rand: () => number = Math.random): HostState | null {
  if (!intent || typeof intent !== 'object') return null
  const { duel } = state
  const i = intent as { kind?: unknown; action?: unknown }

  if (i.kind === 'rematch') {
    if (duel.winner === undefined) return null
    const players = Object.fromEntries(Object.entries(duel.players).map(([id, p]) => [id, fresh(p.name)]))
    return { duel: { seq: duel.seq + 1, round: 1, players }, picks: {} }
  }

  const me = duel.players[player]
  if (i.kind !== 'act' || !isAction(i.action)) return null
  const ids = Object.keys(duel.players)
  // The duel starts once both are seated.
  if (!me || duel.winner !== undefined || ids.length < 2) return null
  if (!legal(me, i.action, { duel })) return null
  // A recast changes the hidden pick (the other has not picked, or the round
  // would have resolved); the same pick again, a resent intent, changes nothing.
  if (me.picked && state.picks[player] === i.action) return null

  const picks = { ...state.picks, [player]: i.action }
  if (!ids.every(id => picks[id])) {
    return {
      duel: { ...duel, seq: duel.seq + 1, players: { ...duel.players, [player]: { ...me, picked: true } } },
      picks,
    }
  }
  return { duel: resolve(duel, picks, rand), picks: {} }
}

/** Damage `target` takes from `attacker` this round; an element of an avatar's hits for 1 more. */
function damage(target: Action, attacker: Action, reversed: boolean, buffed: boolean) {
  const atk = isElement(attacker) ? attacker : undefined
  if (!atk && attacker !== 'drain') return 0
  if (target === 'shield') return 0
  const power = atk && buffed ? 2 : 1
  if (!isElement(target)) {
    // Pass, charge, heal, the Avatar State entered, or a drain: an element beats a drain, two drains tie.
    return target === 'drain' && !atk ? 0 : power
  }
  return atk && beats(atk, target, reversed) ? power : 0
}

function resolve(duel: Duel, picks: Record<string, Action>, rand: () => number): Duel {
  const [a, b] = Object.keys(duel.players) as [string, string]
  const other = (id: string) => (id === a ? b : a)
  const ps: Record<string, Player> = {}
  // Whoever entered the Avatar State before this round is in it now.
  const buffed = [a, b].filter(id => duel.players[id]!.avatarRounds > 0)
  const isBuffed = (id: string) => buffed.includes(id)
  // 1. costs, 2. charges.
  for (const id of [a, b]) {
    const p = duel.players[id]!
    const pick = picks[id]!
    const gain = pick === 'charge' ? (isBuffed(id) ? 2 : 1) : 0
    ps[id] = { ...p, picked: false, mana: Math.min(MAX_MANA, p.mana - costOf(pick, duel) + gain) }
  }
  // 3. damage (at most one side), then heals that were not hit.
  const reversed = holds(duel, 'eclipse')
  const dmg = { [a]: damage(picks[a]!, picks[b]!, reversed, isBuffed(b)), [b]: damage(picks[b]!, picks[a]!, reversed, isBuffed(a)) }
  const loser = dmg[a]! > 0 ? a : dmg[b]! > 0 ? b : null
  const healed: Record<string, number> = {}
  for (const id of [a, b]) {
    const p = ps[id]!
    p.life = Math.max(0, p.life - dmg[id]!)
    if (picks[id] === 'heal' && dmg[id] === 0) {
      healed[id] = Math.min(START_LIFE - p.life, HEAL_AMOUNT)
      p.life += healed[id]
    }
  }
  // 4. theft: a landed drain takes a mana, if there is any.
  let stole = false
  if (loser && picks[other(loser)] === 'drain' && ps[loser]!.mana > 0) {
    const thief = ps[other(loser)]!
    ps[loser]!.mana -= 1
    thief.mana = Math.min(MAX_MANA, thief.mana + 1)
    stole = true
  }
  // 5. timers.
  for (const id of [a, b]) {
    const p = ps[id]!
    p.shieldCooldown = picks[id] === 'shield' ? SHIELD_COOLDOWN : Math.max(0, p.shieldCooldown - 1)
    p.drainCooldown = picks[id] === 'drain' ? DRAIN_COOLDOWN : Math.max(0, p.drainCooldown - 1)
    p.healCooldown = picks[id] === 'heal' ? HEAL_COOLDOWN : Math.max(0, p.healCooldown - 1)
    // The Avatar State holds its rounds, then cools down.
    if (picks[id] === 'avatar') p.avatarRounds = AVATAR_ROUNDS
    else if (p.avatarRounds > 0) {
      p.avatarRounds--
      if (p.avatarRounds === 0) p.avatarCooldown = AVATAR_COOLDOWN
    } else p.avatarCooldown = Math.max(0, p.avatarCooldown - 1)
  }
  // 6. death.
  const dead = loser !== null && ps[loser]!.life <= 0
  const tally = { ...duel.tally }
  for (const id of [a, b]) tally[picks[id]!] = (tally[picks[id]!] ?? 0) + 1
  const next: Duel = {
    seq: duel.seq + 1,
    round: duel.round + 1,
    players: ps,
    tally,
    last: { round: duel.round, picks: { [a]: picks[a]!, [b]: picks[b]! }, loser, dmg: loser ? dmg[loser]! : 0, stole, healed, buffed },
    ...(duel.chaos ? { chaos: duel.chaos } : {}),
    ...(duel.chaosCount ? { chaosCount: duel.chaosCount } : {}),
    ...(dead ? { winner: other(loser) } : {}),
  }
  // 7. at the start of the next round, the world may strike.
  return dead ? next : maybeChaos(next, rand)
}

/**
 * At the start of a round, now and then, chaos strikes: never in the first rounds,
 * never two rounds running or over a lasting one, at least once a game.
 */
export function maybeChaos(duel: Duel, rand: () => number): Duel {
  if (duel.round < CHAOS_FROM) return duel
  if (duel.chaos && duel.round <= duel.chaos.until + 1) return duel
  const forced = !duel.chaosCount && duel.round >= CHAOS_BY
  if (!forced && rand() >= CHAOS_CHANCE) return duel
  const event = CHAOS_EVENTS[Math.min(CHAOS_EVENTS.length - 1, Math.floor(rand() * CHAOS_EVENTS.length))]!
  return strike(duel, event)
}

/** Chaos `event` strikes at the start of the duel's round: the same for both players, never a hit. */
export function strike(duel: Duel, event: ChaosEvent): Duel {
  const entries = Object.entries(duel.players)
  const before = Object.fromEntries(entries.map(([id, p]) => [id, { life: p.life, mana: p.mana }]))
  const average = Math.ceil(entries.reduce((n, [, p]) => n + p.mana, 0) / Math.max(1, entries.length))
  const hit = (p: Player): Player => {
    switch (event) {
      case 'blizzard':
        return { ...p, mana: 0 }
      case 'lightning':
        return { ...p, mana: MAX_MANA }
      case 'rain':
        return { ...p, life: Math.min(START_LIFE, p.life + 1) }
      case 'rift':
        return { ...p, shieldCooldown: 0, drainCooldown: 0, healCooldown: 0, avatarCooldown: 0 }
      case 'tornado':
        return { ...p, mana: average }
      default:
        return p
    }
  }
  return {
    ...duel,
    players: Object.fromEntries(entries.map(([id, p]) => [id, hit(p)])),
    chaos: { event, round: duel.round, until: duel.round + CHAOS_INFO[event].rounds - 1, before },
    chaosCount: (duel.chaosCount ?? 0) + 1,
  }
}

/** One line for a finished game: who won, how long it took, what was picked how often. */
export function summary(duel: Duel) {
  const tally = Object.entries(duel.tally ?? {}).sort(([, x], [, y]) => y - x)
  const total = tally.reduce((n, [, k]) => n + k, 0)
  const picks = tally.map(([a, k]) => {
    const share = k / total
    return `${a} ${k} (${Math.round(share * 100)}%)${share > OVERUSED ? ' ⚠' : ''}`
  })
  const never = ACTIONS.filter(a => a !== 'pass' && !duel.tally?.[a])
  const winner = duel.winner ? duel.players[duel.winner]?.name : undefined
  const chaos = duel.chaosCount ? [`${duel.chaosCount} chaos event${duel.chaosCount === 1 ? '' : 's'}`] : []
  return [
    `${winner ?? 'nobody'} won in ${duel.last?.round ?? 0} rounds`,
    ...(picks.length ? [picks.join(', ')] : []),
    ...(never.length ? [`never: ${never.join(', ')}`] : []),
    ...chaos,
  ].join(' · ')
}

/** Guest side: a replayed or reordered snapshot never rolls the state back. */
export function acceptSnapshot(current: Duel, incoming: unknown): Duel {
  return isDuel(incoming) && incoming.seq > current.seq ? incoming : current
}
