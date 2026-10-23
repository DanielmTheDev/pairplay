// Host-authoritative mana duel, pure: the host alone applies intents and broadcasts
// numbered snapshots; guests send intents and keep the newest snapshot.
// Picks live in HostState.picks, never in the broadcast Duel, until a round resolves.

import type { Action, Duel, Element, Player } from '../types'

export const ELEMENTS: Element[] = ['fire', 'water', 'nature']
export const ACTIONS: Action[] = ['charge', 'supercharge', 'shield', 'drain', 'heal', ...ELEMENTS, ...ELEMENTS.map(e => `${e}+` as const)]
export const START_LIFE = 3
export const START_MANA = 1
export const MAX_MANA = 3
export const DRAIN_COOLDOWN = 2
export const SUPER_COOLDOWN = 5
export const HEAL_COOLDOWN = 1
export const HEAL_AMOUNT = 2
/** An action picked more often than this, in a game, wants rebalancing. */
export const OVERUSED = 0.4

const BEATS: Record<Element, Element> = { water: 'fire', fire: 'nature', nature: 'water' }

export const COST: Record<Action, number> = {
  charge: 0,
  supercharge: 0,
  shield: 0,
  drain: 1,
  heal: 1,
  fire: 1,
  water: 1,
  nature: 1,
  'fire+': 2,
  'water+': 2,
  'nature+': 2,
}

export const INITIAL_DUEL: Duel = { seq: 0, round: 1, players: {} }

export type HostState = { duel: Duel; picks: Record<string, Action> }

export type Intent = { kind: 'act'; action: Action } | { kind: 'rematch' }

export function beats(a: Element, b: Element) {
  return BEATS[a] === b
}

export function isElement(raw: unknown): raw is Element {
  return typeof raw === 'string' && (ELEMENTS as string[]).includes(raw)
}

export function isAction(raw: unknown): raw is Action {
  return typeof raw === 'string' && (ACTIONS as string[]).includes(raw)
}

/** The element of a basic or empowered spell; undefined for anything else. */
export function elementOf(a: Action): Element | undefined {
  const el = a.replace(/\+$/, '')
  return isElement(el) ? el : undefined
}

export function isEmpowered(a: Action) {
  return a.endsWith('+')
}

/** Why `p` may not pick `a` this round; null when they may. */
export function whyNot(p: Player, a: Action): string | null {
  if (p.mana < COST[a]) return `needs ${COST[a]} mana`
  if ((a === 'charge' || a === 'supercharge') && p.mana >= MAX_MANA) return 'mana full'
  if (a === 'supercharge' && p.superCooldown > 0) return `super in ${p.superCooldown}`
  if (a === 'shield' && p.shieldLocked) return 'shield locked'
  if (a === 'drain' && p.drainCooldown > 0) return `drain in ${p.drainCooldown}`
  if (a === 'heal' && p.life >= START_LIFE) return 'life full'
  if (a === 'heal' && p.healCooldown > 0) return `heal in ${p.healCooldown}`
  return null
}

/** Whether `p` may pick `a` this round. */
export function legal(p: Player, a: Action) {
  return whyNot(p, a) === null
}

export function isDuel(raw: unknown): raw is Duel {
  if (!raw || typeof raw !== 'object') return false
  const d = raw as Partial<Duel>
  return (
    typeof d.seq === 'number' &&
    typeof d.round === 'number' &&
    !!d.players &&
    typeof d.players === 'object' &&
    Object.values(d.players).every(
      p =>
        !!p &&
        typeof p.name === 'string' &&
        typeof p.life === 'number' &&
        typeof p.mana === 'number' &&
        typeof p.picked === 'boolean' &&
        typeof p.shieldLocked === 'boolean' &&
        typeof p.drainCooldown === 'number' &&
        typeof p.superCooldown === 'number' &&
        typeof p.healCooldown === 'number',
    )
  )
}

function fresh(name: string): Player {
  return { name, life: START_LIFE, mana: START_MANA, picked: false, shieldLocked: false, drainCooldown: 0, superCooldown: 0, healCooldown: 0 }
}

/** Host side: seats a player; null when already seated or both seats are taken. */
export function seat(duel: Duel, id: string, name: string): Duel | null {
  if (duel.players[id] || Object.keys(duel.players).length >= 2) return null
  return { ...duel, seq: duel.seq + 1, players: { ...duel.players, [id]: fresh(name) } }
}

/** Host side: the next state, or null when the intent is not allowed. */
export function applyIntent(state: HostState, player: string, intent: unknown): HostState | null {
  if (!intent || typeof intent !== 'object') return null
  const { duel } = state
  const i = intent as { kind?: unknown; action?: unknown }

  if (i.kind === 'rematch') {
    if (duel.winner === undefined) return null
    const players = Object.fromEntries(Object.entries(duel.players).map(([id, p]) => [id, fresh(p.name)]))
    return { duel: { seq: duel.seq + 1, round: 1, players }, picks: {} }
  }

  if (i.kind !== 'act' || !isAction(i.action)) return null
  const me = duel.players[player]
  if (!me || duel.winner !== undefined || !legal(me, i.action)) return null
  // A recast changes the hidden pick (the other has not picked, or the round
  // would have resolved); the same pick again, a resent intent, changes nothing.
  if (me.picked && state.picks[player] === i.action) return null

  const picks = { ...state.picks, [player]: i.action }
  const ids = Object.keys(duel.players)
  if (ids.length < 2 || !ids.every(id => picks[id])) {
    return {
      duel: { ...duel, seq: duel.seq + 1, players: { ...duel.players, [player]: { ...me, picked: true } } },
      picks,
    }
  }
  return { duel: resolve(duel, picks), picks: {} }
}

/** Damage `target` takes from `attacker` this round. */
function damage(target: Action, attacker: Action) {
  const atk = elementOf(attacker)
  if (!atk && attacker !== 'drain') return 0
  if (target === 'shield') return 0
  const power = isEmpowered(attacker) ? 2 : 1
  const def = elementOf(target)
  if (!def) {
    // Charge, heal, or a drain: an element beats a drain, two drains tie.
    return target === 'drain' && !atk ? 0 : power
  }
  if (!atk) return 0
  if (beats(atk, def)) return power
  if (atk === def && isEmpowered(attacker) && !isEmpowered(target)) return 1
  return 0
}

function resolve(duel: Duel, picks: Record<string, Action>): Duel {
  const [a, b] = Object.keys(duel.players) as [string, string]
  const other = (id: string) => (id === a ? b : a)
  const ps: Record<string, Player> = {}
  // 1. costs, 2. charges.
  for (const id of [a, b]) {
    const p = duel.players[id]!
    const pick = picks[id]!
    const gain = pick === 'charge' ? 1 : pick === 'supercharge' ? 2 : 0
    ps[id] = { ...p, picked: false, mana: Math.min(MAX_MANA, p.mana - COST[pick] + gain) }
  }
  // 3. damage (at most one side), then heals that were not hit.
  const dmg = { [a]: damage(picks[a]!, picks[b]!), [b]: damage(picks[b]!, picks[a]!) }
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
  // 4. theft: a landed drain takes a mana (two from a super charger), if there is any.
  let stole = false
  if (loser && picks[other(loser)] === 'drain' && ps[loser]!.mana > 0) {
    const taken = Math.min(ps[loser]!.mana, picks[loser] === 'supercharge' ? 2 : 1)
    const thief = ps[other(loser)]!
    ps[loser]!.mana -= taken
    thief.mana = Math.min(MAX_MANA, thief.mana + taken)
    stole = true
  }
  // 5. timers.
  for (const id of [a, b]) {
    const p = ps[id]!
    p.shieldLocked = picks[id] === 'shield'
    p.drainCooldown = picks[id] === 'drain' ? DRAIN_COOLDOWN : Math.max(0, p.drainCooldown - 1)
    p.superCooldown = picks[id] === 'supercharge' ? SUPER_COOLDOWN : Math.max(0, p.superCooldown - 1)
    p.healCooldown = picks[id] === 'heal' ? HEAL_COOLDOWN : Math.max(0, p.healCooldown - 1)
  }
  // 6. death.
  const dead = loser !== null && ps[loser]!.life <= 0
  const tally = { ...duel.tally }
  for (const id of [a, b]) tally[picks[id]!] = (tally[picks[id]!] ?? 0) + 1
  return {
    seq: duel.seq + 1,
    round: duel.round + 1,
    players: ps,
    tally,
    last: { round: duel.round, picks: { [a]: picks[a]!, [b]: picks[b]! }, loser, dmg: loser ? dmg[loser]! : 0, stole, healed },
    ...(dead ? { winner: other(loser) } : {}),
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
  const never = ACTIONS.filter(a => !duel.tally?.[a])
  const winner = duel.winner ? duel.players[duel.winner]?.name : undefined
  return [
    `${winner ?? 'nobody'} won in ${duel.last?.round ?? 0} rounds`,
    ...(picks.length ? [picks.join(', ')] : []),
    ...(never.length ? [`never: ${never.join(', ')}`] : []),
  ].join(' · ')
}

/** Guest side: a replayed or reordered snapshot never rolls the state back. */
export function acceptSnapshot(current: Duel, incoming: unknown): Duel {
  return isDuel(incoming) && incoming.seq > current.seq ? incoming : current
}
