import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, ChaosEvent, Conn, Duel, LogLine, Peer, Player } from '../types'
import {
  ACTIONS,
  BASICS,
  CHAOS_INFO,
  COST,
  DESCRIPTION,
  INITIAL_DUEL,
  LOADOUT_SIZE,
  MAX_MANA,
  OPTIONAL,
  acceptSnapshot,
  applyIntent,
  holds,
  isAction,
  isLoadout,
  legal,
  seat,
  summary,
  whyNot,
  type Intent,
} from './game'
import {
  CARD_COLS,
  CARD_ROWS,
  CHAOS_MS,
  FRAME_MS,
  STAGE_PX_H,
  STAGE_ROWS,
  drawStage,
  encodeCells,
  roundMs,
  stageColumns,
  type StageView,
} from './scene'
import {
  PING_MS,
  PROTOCOL,
  curlArgs,
  livePeers,
  makeRoomCode,
  normalizeRelay,
  normalizeRoomCode,
  parseLine,
  publishUrl,
  retryDelay,
  splitLines,
  subscribeUrl,
  type Envelope,
} from './protocol'
import type { CardsProps } from './cards'

const PANE = 'pairplay'
type Card = { action: Action; label: string; hotkey: string }
// The pane's buttons, under their cards, each with its hotkey: moves, then spells.
// Pass has no card: a plain button under them, for when nothing else is left.
const BUTTONS: Card[] = [
  { action: 'charge', label: 'charge', hotkey: 'c' },
  { action: 'supercharge', label: 'super', hotkey: 'u' },
  { action: 'shield', label: 'shield', hotkey: 's' },
  { action: 'drain', label: 'drain', hotkey: 'd' },
  { action: 'heal', label: 'heal', hotkey: 'h' },
  { action: 'avatar', label: 'avatar', hotkey: 'a' },
  { action: 'fire', label: 'fire', hotkey: '1' },
  { action: 'water', label: 'water', hotkey: '2' },
  { action: 'nature', label: 'nature', hotkey: '3' },
  { action: 'fire+', label: 'fire+', hotkey: '4' },
  { action: 'water+', label: 'water+', hotkey: '5' },
  { action: 'nature+', label: 'nature+', hotkey: '6' },
]
const CARDS_PER_ROW = 6

/** The button rows for a pane `columns` wide: the basics and the chosen spells (all, when not known), wrapped to fit. */
function cardRows(columns: number, loadout: readonly Action[] | null) {
  const shown = BUTTONS.filter(b => !loadout || BASICS.includes(b.action) || loadout.includes(b.action))
  const per = Math.max(1, Math.min(CARDS_PER_ROW, Math.floor(columns / CARD_COLS)))
  return Array.from({ length: Math.ceil(shown.length / per) }, (_, i) => shown.slice(i * per, (i + 1) * per))
}

/** Pane rows the duel needs besides the cards: header, round, stage, players, result, pass, input, a little log. */
const DUEL_ROWS = 2 + 1 + 1 + STAGE_ROWS + 2 + 1 + 1 + 1 + 3

/** The choosing grid: the nine optional spells, three by three. */
const DRAFT_ROWS = [OPTIONAL.slice(0, 3), OPTIONAL.slice(3, 6), OPTIONAL.slice(6, 9)]
/** Pane rows the choosing grid needs: a title, then per row its cards, button and description. */
const DRAFT_PANE_ROWS = 2 + 1 + DRAFT_ROWS.length * (CARD_ROWS + 3) + 2

function draftCell(columns: number) {
  return Math.max(CARD_COLS, Math.min(24, Math.floor(columns / 3)))
}

const CHAOS_ICON: Record<ChaosEvent, string> = {
  blizzard: '❄',
  lightning: '⚡',
  volcano: '🌋',
  eclipse: '🌑',
  rain: '🌧',
  quake: '🌍',
  rift: '🌀',
  tornado: '🌪',
}

/** The banner for the chaos holding this round, or null: its name and effect, how long it lasts. */
function chaosBanner(d: Duel) {
  const ch = d.chaos
  if (!ch || d.winner !== undefined || !holds(d, ch.event)) return null
  const info = CHAOS_INFO[ch.event]
  const left = ch.until - d.round + 1
  const time = ch.until === ch.round ? '' : left > 1 ? ` · ${left} rounds left` : ' · last round'
  return `${CHAOS_ICON[ch.event]} ${info.name}${d.round === ch.round ? '!' : ''} ${info.effect}${time}`
}

const room = atom({ plugin: 'pairplay', key: 'room' } as const, null, { shape: 'room-1' })
const peers = atom({ plugin: 'pairplay', key: 'peers' } as const, {}, { shape: 'peers-1' })
const log = atom({ plugin: 'pairplay', key: 'log' } as const, [], { shape: 'log-1' })
const conn = atom({ plugin: 'pairplay', key: 'conn' } as const, 'off' as Conn)
// The relay chosen with `/coop relay` or a join link; null: the configured one.
const relayChoice = atom({ plugin: 'pairplay', key: 'relay' } as const, null, { shape: 'relay-1' })
const game = atom({ plugin: 'pairplay', key: 'game' } as const, INITIAL_DUEL, { shape: 'duel-3' })
// Host only: the round's hidden picks, never broadcast.
const picks = atom({ plugin: 'pairplay', key: 'picks' } as const, {})
// Guest only: what this player cast this round, for the icon over their head.
const mine = atom({ plugin: 'pairplay', key: 'mine' } as const, null)
// Host only: the spells each player chose this game, never broadcast until it is won.
const loadouts = atom({ plugin: 'pairplay', key: 'loadouts' } as const, {})
// Guest only: the spells this player chose, for the buttons.
const myLoadout = atom({ plugin: 'pairplay', key: 'myLoadout' } as const, null)
// The spells ticked on the choosing grid, not sent yet.
const draft = atom({ plugin: 'pairplay', key: 'draft' } as const, [])

const HELP = [
  '/coop host          create a room, share the code',
  '/coop join <code> [relay]  join the other player',
  '/coop relay [url]   show or switch the relay (both players)',
  '/coop say <text>    chat (or type in the pane)',
  '/coop pick a b c    choose this game\'s 3 spells (or tick them in the pane):',
  `                    ${OPTIONAL.join(' ')}`,
  '/coop <action>      pass | charge | shield | heal, and your 3: supercharge | drain (1 mana)',
  '                    fire | water | nature (1), fire+ ... (2), avatar (3, once)',
  '/coop rematch       new duel after one is won',
  '/coop leave         leave the room',
  '/coop               open the pane',
].join('\n')

type $ = EngineInterface

// Module state: starts over on every reload; the subscription restarts from `room`.
let configuredRelay = 'https://ntfy.sh'
// The relay in use, fixed when the link starts: a switch restarts the link.
let relay = configuredRelay
let me = ''
let myName = 'player'
let generation = 0
let stream: AsyncGenerator<unknown, unknown> | undefined
let pinger: { cancel(): void } | undefined
let backoffMs = 1000
// Host: every change to the duel runs one at a time, in arrival order.
let hostQueue: Promise<unknown> = Promise.resolve()
// Guest: a cast not answered yet, resent a few times; `states` counts snapshots seen.
let pending: { intent: unknown; states: number; tries: number } | undefined
let statesSeen = 0
// The stage loop: one timer while in a room, blitting a frame each tick (idle
// stars and blinks, or the round in `anim`). Transient, so module variables.
let anim: { t0: number } | undefined
// A chaos event's animation, from t0: after the round that brought it.
let chaosAnim: { t0: number } | undefined
let loop: { cancel(): void } | undefined
let stageCols = 0
// The card rows the pane drew, for the loop to repaint; empty when it drew none.
let shownCards: Card[][] = []
// The choosing grid the pane drew, for the loop to repaint; undefined when it drew none.
let shownDraft: { cell: number } | undefined

async function addLog($: $, who: string, text: string, kind: LogLine['kind'] = 'info') {
  await update($, log, list => [...list, { t: Date.now(), who, text, kind }].slice(-200))
}

async function refreshStatus($: $) {
  const r = await read($, room)
  if (!r) return $.ui.status(undefined)
  const c = await read($, conn)
  const n = livePeers(await read($, peers), Date.now()).length
  $.ui.status(`coop ${r.code} · ${c === 'live' ? `${n} peer${n === 1 ? '' : 's'}` : c}`)
}

/** Publishes, retrying with backoff; false once it gave up or the room changed. Never throws. */
async function send($: $, type: string, payload?: unknown) {
  try {
    return await publish($, type, payload)
  } catch {
    return false
  }
}

async function relayOf($: $) {
  return (await read($, relayChoice)) ?? configuredRelay
}

async function publish($: $, type: string, payload?: unknown) {
  const r = await read($, room)
  if (!r) return false
  const gen = generation
  const env: Envelope = { v: PROTOCOL, from: me, name: myName, type, payload }
  for (let attempt = 0; ; attempt++) {
    let status = 0
    let why = ''
    try {
      const res = await $.http.fetch(publishUrl(relay, r.code), { method: 'POST', body: JSON.stringify(env) })
      if (res.ok) return true
      status = res.status
      why = `HTTP ${res.status}${res.status === 429 ? ` (${relay} quota reached; both players: /coop relay <url>)` : ''}`
    } catch (err) {
      why = String(err)
    }
    const wait = retryDelay(attempt, status)
    if (wait === null) {
      await addLog($, 'relay', `send failed: ${why}`)
      return false
    }
    await $.clock.sleep(wait)
    if (gen !== generation) return false
  }
}

/** Marks the sender alive; true when it was not known yet. */
async function seen($: $, env: Envelope) {
  let isNew = false
  await update($, peers, all => {
    isNew = !all[env.from]
    return { ...all, [env.from]: { name: env.name, lastSeen: Date.now() } satisfies Peer }
  })
  return isNew
}

// Message types. A game adds its own cases here; the transport never changes.
async function handle($: $, env: Envelope) {
  switch (env.type) {
    case 'hello':
      if (await seen($, env)) {
        await addLog($, env.name, 'joined')
        $.ui.toast(`coop: ${env.name} joined`)
      }
      await send($, 'here')
      if (await isHost($)) await hostSeat($, env.from, env.name)
      return
    case 'here':
    case 'ping': {
      if (await seen($, env)) {
        await addLog($, env.name, 'is here')
        $.ui.toast(`coop: ${env.name} is here`)
      }
      // Pings carry the sender's duel seq: whoever is behind catches up.
      const theirs = (env.payload as { seq?: unknown } | undefined)?.seq
      if (typeof theirs !== 'number') return
      const ours = (await read($, game)).seq
      if (await isHost($)) {
        if (theirs < ours) void send($, 'state', await read($, game))
      } else if (theirs > ours) void send($, 'sync')
      return
    }
    case 'sync':
      if (await isHost($)) void send($, 'state', await read($, game))
      return
    case 'bye':
      await update($, peers, all => {
        const { [env.from]: _gone, ...rest } = all
        return rest
      })
      await addLog($, env.name, 'left')
      $.ui.toast(`coop: ${env.name} left`)
      return
    case 'say': {
      await seen($, env)
      const text = String(env.payload ?? '').slice(0, 500)
      await addLog($, env.name, text, 'chat')
      $.ui.toast(`${env.name}: ${text}`)
      return
    }
    case 'intent':
      await seen($, env)
      // Answered even when refused: the guest learns the truth either way.
      if (await isHost($) && !(await hostApply($, env.from, env.name, env.payload))) {
        void send($, 'state', await read($, game))
      }
      return
    case 'state':
      await seen($, env)
      if (!(await isHost($))) {
        statesSeen++
        const before = await read($, game)
        await update($, game, current => acceptSnapshot(current, env.payload))
        await onDuelChange($, before, await read($, game))
      }
      return
  }
}

async function isHost($: $) {
  return (await read($, room))?.role === 'host'
}

/** Runs host changes one after another: two at once would each miss the other's write. */
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = hostQueue.then(fn, fn)
  hostQueue = run.catch(() => {})
  return run
}

/** Seats a player (both, after a reload lost nothing but a seat) and broadcasts. */
function hostSeat($: $, id: string, name: string) {
  return serial(async () => {
    await update($, game, d => seat(d, me, myName) ?? d)
    await update($, game, d => seat(d, id, name) ?? d)
    void send($, 'state', await read($, game))
  })
}

/** The one place the duel changes: on the host, then broadcast as a snapshot. */
function hostApply($: $, id: string, name: string, intent: unknown) {
  return serial(() => hostApplyNow($, id, name, intent))
}

async function hostApplyNow($: $, id: string, name: string, intent: unknown) {
  await update($, game, d => seat(d, me, myName) ?? d)
  await update($, game, d => seat(d, id, name) ?? d)
  const before = await read($, game)
  const next = applyIntent({ duel: before, picks: await read($, picks), loadouts: await read($, loadouts) }, id, intent)
  if (!next) return null
  await update($, picks, () => next.picks)
  await update($, loadouts, () => next.loadouts)
  await update($, game, () => next.duel)
  // Not awaited: retries must not hold up the next change; seq orders them.
  void send($, 'state', next.duel)
  await onDuelChange($, before, next.duel)
  return next.duel
}

/** A round just resolved: play it. A first snapshot (joining late) is not replayed. */
async function onDuelChange($: $, before: Duel, after: Duel) {
  if (before.seq === 0 || !after.last || after.last.round === before.last?.round) return
  // The summary waits for the death to play out: no spoilers.
  if (after.winner !== undefined && before.winner === undefined) {
    $.clock.after(roundMs(after), () => void quietly(() => addLog($, 'game', summary(after))))
  }
  // Once the round has played: into the log, the game's history, and a notification.
  $.clock.after(roundMs(after), () => void quietly(() => announce($, after)))
  const now = await $.clock.now()
  // Chaos that struck with this round plays once the round has.
  const ch = after.chaos
  if (ch && ch.round === after.round && ch.round !== before.chaos?.round) {
    chaosAnim = { t0: now + roundMs(after) }
    $.clock.after(roundMs(after), () =>
      void quietly(async () => {
        const info = CHAOS_INFO[ch.event]
        await addLog($, 'chaos', `${info.name}: ${info.effect}`)
        $.ui.toast(`${CHAOS_ICON[ch.event]} ${info.name}!`)
      }),
    )
  }
  anim = { t0: now }
  startLoop($)
  await tick($)
}

async function announce($: $, d: Duel) {
  const text = roundText(d) + (d.winner !== undefined ? ` · ${nameOf(d, d.winner)} wins!` : '')
  await addLog($, '⚔', text)
  // No notification channel: a toast at least.
  const sent = await $.ui.notify(text, { title: 'pairplay' }).catch(() => ({ isSent: false }))
  if (!sent.isSent) $.ui.toast(text)
}

function startLoop($: $) {
  loop ??= $.clock.every(FRAME_MS, () => void quietly(() => tick($)))
}

function stopLoop() {
  loop?.cancel()
  loop = undefined
  anim = undefined
  chaosAnim = undefined
}

async function stageView($: $, d: Duel): Promise<StageView> {
  const now = await $.clock.now()
  const t = anim ? now - anim.t0 : undefined
  let myPick: Action | undefined
  if (d.players[me]?.picked) {
    if (await isHost($)) myPick = (await read($, picks))[me]
    else {
      const m = await read($, mine)
      if (m?.round === d.round) myPick = m.action
    }
  }
  const ct = chaosAnim ? now - chaosAnim.t0 : undefined
  const chaosT = ct !== undefined && ct >= 0 && ct < CHAOS_MS ? ct : undefined
  return { me, now, ...(t !== undefined ? { t } : {}), ...(myPick ? { myPick } : {}), ...(chaosT !== undefined ? { chaosT } : {}) }
}

/** The spells this player chose this game; null when not known (joined late, reloaded). */
async function myLoadoutOf($: $) {
  if (await isHost($)) return (await read($, loadouts))[me] ?? null
  return read($, myLoadout)
}

/** Ticks or unticks a spell on the choosing grid; a full hand takes no more. */
async function toggle($: $, a: Action) {
  await update($, draft, list => (list.includes(a) ? list.filter(x => x !== a) : list.length < LOADOUT_SIZE ? [...list, a] : list))
  $.ui.invalidate('ui.render')
}

async function tick($: $) {
  if (!stageCols) return
  const d = await read($, game)
  const view = await stageView($, d)
  if (anim && view.t !== undefined && view.t >= roundMs(d)) {
    // The round has played: settle on the drawing that shows its result.
    anim = undefined
    $.ui.invalidate('ui.render')
    return
  }
  if (chaosAnim && !anim && view.now - chaosAnim.t0 >= CHAOS_MS) {
    chaosAnim = undefined
    $.ui.invalidate('ui.render')
    return
  }
  // The choosing grid has no stage; its cards, like the action cards, animate themselves.
  if (shownDraft) return
  // Denied while the pane is closed: nothing to paint, the loop just idles.
  await $.ui.blit({ requestId: PANE, key: 'stage', cells: encodeCells(drawStage(d, stageCols, view), stageCols, STAGE_PX_H) })
}

async function act($: $, intent: Intent) {
  if (!(await read($, room))) return 'Not in a room.'
  const duel = await read($, game)
  const p = duel.players[me]
  if (intent.kind === 'act') {
    const why = p ? whyNot(p, intent.action, { duel, loadout: await myLoadoutOf($) }) : 'not seated'
    if (why) return `${describe(intent)}: ${why}`
    if (!p!.ready) return `${describe(intent)}: choose your spells first (the grid in the pane, or /coop pick a b c)`
    const waiting = Object.entries(duel.players).find(([id, q]) => id !== me && !q.ready)
    if (waiting) return `${describe(intent)}: ${waiting[1].name} is still choosing spells`
  }
  if (intent.kind === 'loadout') {
    if (!p) return 'not seated'
    if (p.ready) return 'Spells already chosen for this game.'
    if (!isLoadout(intent.spells)) return `Pick ${LOADOUT_SIZE} different spells.`
  }
  if (!(await isHost($))) {
    if (intent.kind === 'act') {
      const action = intent.action
      const round = duel.round
      await update($, mine, () => ({ round, action }))
    }
    if (intent.kind === 'loadout') {
      const spells = intent.spells
      await update($, myLoadout, () => spells)
      await update($, draft, () => [])
    }
    pending = { intent, states: statesSeen, tries: 0 }
    $.clock.after(RESEND_MS, () => void quietly(() => resend($)))
    void send($, 'intent', intent)
    return `${describe(intent)} sent to host`
  }
  const d = await hostApply($, me, myName, intent)
  if (!d) return `${describe(intent)}: not allowed now`
  if (intent.kind === 'loadout') await update($, draft, () => [])
  return d.last && d.last.round === d.round - 1 && intent.kind === 'act' ? `${describe(intent)}, round resolves…` : describe(intent)
}

const RESEND_MS = 3000

/** For timer callbacks: one that fails (the session is ending) has nobody to tell. */
async function quietly(fn: () => Promise<unknown>) {
  try {
    await fn()
  } catch {}
}

/** No snapshot since the cast went out: say it again, a few times at most. */
async function resend($: $) {
  const p = pending
  if (!p || statesSeen > p.states) {
    pending = undefined
    return
  }
  if (p.tries >= 3) {
    pending = undefined
    await addLog($, 'relay', 'host did not answer; try again')
    return
  }
  p.tries++
  void send($, 'intent', p.intent)
  $.clock.after(RESEND_MS, () => void quietly(() => resend($)))
}

function describe(intent: Intent) {
  return intent.kind === 'act' ? intent.action : intent.kind === 'loadout' ? `spells: ${intent.spells.join(', ')}` : 'rematch'
}

function nameOf(d: Duel, id: string) {
  return id === me ? myName : (d.players[id]?.name ?? '?')
}

function roundText(d: Duel) {
  if (!d.last) return ''
  const { round, picks: p, loser, dmg, stole, healed } = d.last
  const vs = Object.entries(p).map(([id, a]) => `${nameOf(d, id)} ${a}`).join(' vs ')
  const what = [
    ...(loser ? [`${nameOf(d, loser)} -${dmg}${stole ? ', 1 mana stolen' : ''}`] : []),
    ...Object.entries(healed).map(([id, n]) => `${nameOf(d, id)} +${n}`),
  ]
  return `round ${round}: ${vs} → ${what.length ? what.join(', ') : 'no damage'}`
}

/** The timers that lock a move, each after a separator. */
function timers(p: Player) {
  const timers = [
    ...(p.shieldCooldown > 0 ? [`shield in ${p.shieldCooldown}`] : []),
    ...(p.drainCooldown > 0 ? [`drain in ${p.drainCooldown}`] : []),
    ...(p.superCooldown > 0 ? [`super in ${p.superCooldown}`] : []),
    ...(p.healCooldown > 0 ? [`heal in ${p.healCooldown}`] : []),
    ...(p.avatarUsed ? ['avatar used'] : []),
  ]
  return timers.map(x => ` · ${x}`).join('')
}

function mana(p: Player) {
  return '◆'.repeat(Math.max(0, p.mana)) + '◇'.repeat(Math.max(0, MAX_MANA - p.mana))
}

async function onEnvelope($: $, id: string, env: Envelope) {
  await update($, room, r => (r ? { ...r, lastId: id } : r))
  if (env.from === me) return
  await handle($, env)
  await refreshStatus($)
}

// One curl per room: ntfy streams NDJSON down one open connection (true push,
// one request instead of polling). A reconnect resumes from the last message id.
async function subscribe($: $, gen: number) {
  const r = await read($, room)
  if (!r || gen !== generation) return
  await update($, conn, () => 'connecting')
  await refreshStatus($)
  const child = $.process.spawn({
    argv: curlArgs(subscribeUrl(relay, r.code, r.lastId)),
  })
  stream = child
  let buffer = ''
  try {
    for await (const { stream: pipe, text } of child) {
      if (gen !== generation) break
      if (pipe !== 'stdout') continue
      const { lines, rest } = splitLines(buffer + text)
      buffer = rest
      for (const line of lines) {
        const msg = parseLine(line)
        if (msg.kind === 'open') {
          backoffMs = 1000
          await update($, conn, () => 'live')
          await refreshStatus($)
        } else if (msg.kind === 'message') {
          await onEnvelope($, msg.id, msg.env)
        }
      }
    }
  } catch (err) {
    if (gen === generation) await addLog($, 'relay', `stream error: ${String(err)}`)
  }
  if (gen !== generation) return
  await update($, conn, () => 'retrying')
  await refreshStatus($)
  const wait = backoffMs
  backoffMs = Math.min(backoffMs * 2, 30_000)
  $.clock.after(wait, () => void quietly(() => subscribe($, gen)))
}

function stop() {
  generation++
  stopLoop()
  pending = undefined
  pinger?.cancel()
  pinger = undefined
  void stream?.return(undefined)
  stream = undefined
}

async function start($: $) {
  stop()
  relay = await relayOf($)
  const gen = generation
  backoffMs = 1000
  void quietly(() => subscribe($, gen))
  // Announce once the stream had a moment to open, so the answer isn't missed.
  $.clock.after(1500, () => void send($, 'hello'))
  startLoop($)
  const ping = () => {
    void quietly(async () => void send($, 'ping', { seq: (await read($, game)).seq }))
    void quietly(() => refreshStatus($))
  }
  // One ping soon after connecting, so whoever is behind catches up; then rarely.
  $.clock.after(FIRST_PING_MS, () => gen === generation && ping())
  pinger = $.clock.every(PING_MS, ping)
}

const FIRST_PING_MS = 5000

/** Switches to room `code`; answers a message when nothing changed. */
async function enter($: $, code: string, role: 'host' | 'guest') {
  const current = await read($, room)
  if (current?.code === code) return `Already in room ${code}.`
  if (current) await send($, 'bye')
  const verb = role === 'host' ? 'hosting' : 'joined'
  await update($, room, () => ({ code, role }))
  await update($, game, () => (role === 'host' ? (seat(INITIAL_DUEL, me, myName) ?? INITIAL_DUEL) : INITIAL_DUEL))
  await update($, picks, () => ({}))
  await update($, loadouts, () => ({}))
  await update($, myLoadout, () => null)
  await update($, draft, () => [])
  await update($, peers, () => ({}))
  await addLog($, 'you', `${verb} room ${code}`)
  await start($)
  void $.ui.open({ id: PANE, title: 'Co-op' })
  return null
}

async function leave($: $) {
  const r = await read($, room)
  if (!r) return 'Not in a room.'
  await send($, 'bye')
  stop()
  await update($, room, () => null)
  await update($, peers, () => ({}))
  await update($, conn, () => 'off')
  await addLog($, 'you', `left room ${r.code}`)
  $.ui.status(undefined)
  return `Left room ${r.code}.`
}

async function say($: $, text: string) {
  if (!(await read($, room))) return 'Not in a room. /coop host or /coop join <code> first.'
  await addLog($, myName, text, 'chat')
  return (await send($, 'say', text)) ? `sent: ${text}` : 'Send failed, see pane.'
}

export const register: Register = (on, options) => {
  configuredRelay = normalizeRelay(String(options.relayUrl || '')) ?? 'https://ntfy.sh'
  // A fresh activation owns nothing of an earlier one's timers or queue.
  stop()
  hostQueue = Promise.resolve()
  statesSeen = 0

  on('session.start', async ($, e, next) => {
    const started = await next(e)
    me = await $.session.id()
    myName = String(options.playerName || (await $.env.get('USER')) || 'player').slice(0, 24)
    await $.command.register({
      name: 'coop',
      description: 'Co-op link: host | join <code> | say <text> | leave',
    })
    // A reload or resumed session picks the room back up.
    if (await read($, room)) await start($)
    else await update($, conn, () => 'off')
    return started
  })

  on('session.end', async ($, e, next) => {
    stopLoop()
    if (await read($, room)) await send($, 'bye')
    stop()
    return next(e)
  })

  on('command.run', { command: 'coop' }, async ($, e) => {
    const [verb = '', ...rest] = e.args.trim().split(/\s+/)
    const arg = rest.join(' ')
    switch (verb.toLowerCase()) {
      case '':
        await $.ui.open({ id: PANE, title: 'Co-op', focus: true })
        return { text: (await read($, room)) ? 'Co-op pane opened.' : HELP }
      case 'host': {
        const code = makeRoomCode(crypto.getRandomValues(new Uint8Array(8)))
        await enter($, code, 'host')
        const relay = await relayOf($)
        const join = relay === configuredRelay ? `/coop join ${code}` : `/coop join ${code} ${relay}`
        await $.ui.copy({ text: join })
        return { text: `Hosting room ${code} · other player: ${join} (copied)` }
      }
      case 'join': {
        const [raw = '', url] = rest
        const code = normalizeRoomCode(raw)
        if (!code) return { text: `Bad room code "${raw}". Expected XXXX-XXXX.` }
        if (url !== undefined) {
          const relay = normalizeRelay(url)
          if (!relay) return { text: `Bad relay "${url}". Expected an http(s) URL.` }
          await update($, relayChoice, () => relay)
        }
        return { text: (await enter($, code, 'guest')) ?? `Joining room ${code}…` }
      }
      case 'relay': {
        if (!arg) return { text: `relay: ${await relayOf($)}` }
        const relay = arg === 'default' ? null : normalizeRelay(arg)
        if (relay === null && arg !== 'default') return { text: `Bad relay "${arg}". Expected an http(s) URL, or default.` }
        await update($, relayChoice, () => relay)
        // A room in progress moves over: both players have to switch.
        if (await read($, room)) await start($)
        return { text: `relay set: ${await relayOf($)}` }
      }
      case 'say':
        return { text: arg ? await say($, arg) : 'Nothing to say.' }
      case 'leave':
        return { text: await leave($) }
      case 'cast': {
        const action = arg.toLowerCase()
        if (!isAction(action)) return { text: `Cast what? ${ACTIONS.join(', ')}.` }
        return { text: await act($, { kind: 'act', action }) }
      }
      case 'rematch':
        return { text: await act($, { kind: 'rematch' }) }
      case 'pick': {
        if (!arg) return { text: `Choose 3 spells for this game: ${OPTIONAL.join(', ')} (e.g. /coop pick fire drain avatar).` }
        const spells = rest.map(x => x.toLowerCase())
        if (!isLoadout(spells)) return { text: `Pick 3 different spells of: ${OPTIONAL.join(', ')}.` }
        return { text: await act($, { kind: 'loadout', spells }) }
      }
      default: {
        const action = verb.toLowerCase()
        if (isAction(action)) return { text: await act($, { kind: 'act', action }) }
        return { text: HELP }
      }
    }
  })

  // A click on a card (./cards.tsx): cast it, or on the choosing grid, tick it.
  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const a = (e.data as { action?: unknown } | null)?.action
    if (!isAction(a)) return {}
    if (e.element.startsWith('draft-')) await toggle($, a)
    else if (e.element.startsWith('cards-')) await act($, { kind: 'act', action: a })
    return {}
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Raster = 'Raster' in els ? els.Raster : undefined
    // The clickable cards: a surface module of their own (./cards.tsx).
    const Client = 'Client' in els ? els.Client : undefined
    // Mobile draws no field: chat there via /coop say.
    const Input = 'Input' in els ? els.Input : undefined
    const r = await read($, room)
    const c = await read($, conn)
    const live = livePeers(await read($, peers), Date.now())
    const lines = await read($, log)
    const g = await read($, game)
    const playing = anim !== undefined
    const view = await stageView($, g)
    stageCols = Raster ? stageColumns(e.props.bodyColumns) : 0
    const color = (id: string) => (id === Object.keys(g.players)[0] ? '#7f9cff' : '#ff6f86')
    const you = g.players[me]
    const loadout = await myLoadoutOf($)
    const ctx = { duel: g, loadout }
    // Before the duel: the choosing grid, until this player has chosen; then a wait for the other.
    const choosing = !!r && !!you && !you.ready && g.winner === undefined
    const waitingFor = choosing || g.winner !== undefined ? undefined : Object.entries(g.players).find(([id, q]) => id !== me && !q.ready)?.[1]
    const chosen = await read($, draft)
    const cell = draftCell(e.props.bodyColumns)
    shownDraft = choosing && Client && (!e.viewport || e.viewport.rows >= DRAFT_PANE_ROWS) ? { cell } : undefined
    const buttons = choosing || waitingFor ? [] : cardRows(e.props.bodyColumns, loadout)
    // Cards only where they fit: on a short pane the buttons alone, under the stage.
    const cardsFit = !e.viewport || e.viewport.rows >= DUEL_ROWS + buttons.length * (CARD_ROWS + 1)
    shownCards = Client && cardsFit ? buttons : []
    const used = choosing
      ? DRAFT_PANE_ROWS + 4
      : 9 + (Raster ? STAGE_ROWS + 1 : 0) + buttons.length * (shownCards.length ? CARD_ROWS + 1 : 1)
    const rows = Math.max(3, (e.viewport?.rows ?? 24) - used)
    // Announced once the round that brought it has played.
    const banner = playing ? null : chaosBanner(g)
    const others = Object.entries(g.players).filter(([id]) => id !== me)
    const submit = async () => void (await act($, { kind: 'loadout', spells: await read($, draft) }))

    return (
      <Box flexDirection="column">
        <Text bold>
          {r ? `Room ${r.code}` : 'No room'} <Text dimColor>· {c} · you are {myName}</Text>
        </Text>
        <Text dimColor>
          {live.length === 0 ? 'waiting for the other player…' : `with: ${live.map(([, p]) => p.name).join(', ')}`}
        </Text>
        {r && choosing && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              Choose {LOADOUT_SIZE} spells{' '}
              <Text dimColor>
                · {chosen.length}/{LOADOUT_SIZE} · pass, charge, shield and heal are always yours
              </Text>
            </Text>
            {DRAFT_ROWS.map((row, i) => (
              <Box flexDirection="column">
                {Client && shownDraft && (
                  <Client
                    key={`draft-${i}`}
                    module="./cards.tsx"
                    width={row.length * cell}
                    height={CARD_ROWS}
                    props={{ kind: 'draft', actions: row, chosen, cell } satisfies CardsProps}
                  />
                )}
                <Box flexDirection="row">
                  {row.map((a, j) => (
                    <Box width={cell} flexShrink={0} flexDirection="column">
                      <Button
                        key={`pick-${a}`}
                        label={`${chosen.includes(a) ? '✓' : '·'} ${a} ${'◆'.repeat(COST[a])}`}
                        hotkey={String(i * DRAFT_ROWS.length + j + 1)}
                        plain
                        onPress={() => void toggle($, a)}
                      />
                      <Text dimColor>{DESCRIPTION[a]}</Text>
                    </Box>
                  ))}
                </Box>
              </Box>
            ))}
            {chosen.length === LOADOUT_SIZE ? (
              <Button key="start" label="▶ start" hotkey="s" onPress={() => void submit()} />
            ) : (
              <Text dimColor>start: tick {LOADOUT_SIZE - chosen.length} more</Text>
            )}
            {others.map(([, q]) => (
              <Text dimColor>{q.ready ? `${q.name} is ready` : `${q.name} is choosing…`}</Text>
            ))}
          </Box>
        )}
        {r && !choosing && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>
              {playing ? `round ${g.round - 1}…` : g.winner ? `${nameOf(g, g.winner)} wins!` : `round ${g.round}`}{' '}
              <Text dimColor>· {r.role ?? 'guest'}</Text>
            </Text>
            {Raster && (
              <Raster
                key="stage"
                columns={stageCols}
                rows={STAGE_ROWS}
                cells={encodeCells(drawStage(g, stageCols, view), stageCols, STAGE_PX_H)}
              />
            )}
            {banner && (
              <Text color="#ffb347" bold>
                {banner}
              </Text>
            )}
            {Object.entries(g.players).map(([id, p]) =>
              Raster ? (
                <Text>
                  <Text color={color(id)} bold>{id === me ? `${p.name} (you)` : p.name}</Text>{' '}
                  <Text dimColor>{playing || g.winner ? '' : p.picked ? '✦ ' : '… '}</Text>
                  <Text color="#3de0f0" bold>{mana(p)}</Text>
                  <Text color="#ff6b6b">{timers(p)}</Text>
                </Text>
              ) : (
                <Text>
                  {id === me ? 'you' : p.name}: {'♥'.repeat(Math.max(0, p.life))}
                  {'♡'.repeat(Math.max(0, 3 - p.life))} {mana(p)}{timers(p)}{' '}
                  <Text dimColor>{p.picked ? 'picked' : g.winner ? '' : 'thinking…'}</Text>
                </Text>
              ),
            )}
            {g.last && !playing && <Text dimColor>{roundText(g)}</Text>}
            {waitingFor && (
              <Text dimColor>
                waiting for {waitingFor.name} to choose their spells…
                {loadout ? ` yours: ${[...BASICS, ...loadout].join(', ')}` : ''}
              </Text>
            )}
            {g.winner ? (
              <Button key="rematch" label="⚔ rematch" hotkey="r" onPress={() => void act($, { kind: 'rematch' })} />
            ) : (
              buttons.map((row, i) => (
                <Box flexDirection="column">
                  {Client && shownCards.length > 0 && (
                    <Client
                      key={`cards-${i}`}
                      module="./cards.tsx"
                      width={row.length * CARD_COLS}
                      height={CARD_ROWS}
                      props={
                        {
                          kind: 'cards',
                          actions: row.map(b => b.action),
                          player: you ?? null,
                          duel: g,
                          loadout,
                          pressable: row.map(b => b.action).filter(a => you && legal(you, a, ctx)),
                        } satisfies CardsProps
                      }
                    />
                  )}
                  <Box flexDirection="row">
                    {row.map(b => (
                      <Box width={CARD_COLS} flexShrink={0}>
                        {you && legal(you, b.action, ctx) ? (
                          <Button
                            key={b.action}
                            label={b.label}
                            hotkey={b.hotkey}
                            plain
                            onPress={() => void act($, { kind: 'act', action: b.action })}
                          />
                        ) : (
                          // Not allowed: drawn, but nothing to press.
                          <Text dimColor>{`${b.hotkey}: ${b.label}`}</Text>
                        )}
                      </Box>
                    ))}
                  </Box>
                </Box>
              ))
            )}
            {!g.winner && buttons.length > 0 && (
              <Button key="pass" label="pass" hotkey="p" plain onPress={() => void act($, { kind: 'act', action: 'pass' })} />
            )}
          </Box>
        )}
        <Box flexDirection="column" marginTop={1}>
          {lines.length === 0 && <Text dimColor>{HELP}</Text>}
          {lines.slice(-rows).map(l =>
            l.kind === 'chat' ? (
              <Text>
                <Text bold>{l.who}</Text>: {l.text}
              </Text>
            ) : (
              <Text dimColor>
                {l.who} {l.text}
              </Text>
            ),
          )}
        </Box>
        {r && Input && (
          <Input
            key="say"
            label="say "
            placeholder="message to the other player"
            submitLabel="send"
            value=""
            onSubmit={(value: string) => {
              const text = value.trim()
              if (text) void say($, text)
            }}
          />
        )}
      </Box>
    )
  })
}
