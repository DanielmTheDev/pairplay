import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Action, Conn, Duel, LogLine, Peer, Player } from '../types'
import { ACTIONS, ELEMENTS, INITIAL_DUEL, MAX_MANA, acceptSnapshot, applyIntent, isAction, legal, seat, summary, whyNot } from './game'
import {
  CARD_COLS,
  CARD_PX_H,
  CARD_ROWS,
  FRAME_MS,
  STAGE_PX_H,
  STAGE_ROWS,
  drawCards,
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

const PANE = 'pairplay'
// The pane's buttons, under their cards: a row of moves, a row of spells, each with its hotkey.
const MOVES: { action: Action; label: string; hotkey: string }[] = [
  { action: 'charge', label: 'charge', hotkey: 'c' },
  { action: 'supercharge', label: 'super', hotkey: 'u' },
  { action: 'shield', label: 'shield', hotkey: 's' },
  { action: 'drain', label: 'drain', hotkey: 'd' },
  { action: 'heal', label: 'heal', hotkey: 'h' },
]
const SPELLS: { action: Action; label: string; hotkey: string }[] = [
  ...ELEMENTS.map((el, i) => ({ action: el, label: el, hotkey: String(i + 1) })),
  ...ELEMENTS.map((el, i) => ({ action: `${el}+` as const, label: `${el}+`, hotkey: String(i + 4) })),
]

/** The button rows for a pane `columns` wide: moves, then spells, each wrapped to fit. */
function cardRows(columns: number) {
  const per = Math.max(1, Math.floor(columns / CARD_COLS))
  const chunk = (row: typeof MOVES) => Array.from({ length: Math.ceil(row.length / per) }, (_, i) => row.slice(i * per, (i + 1) * per))
  return [...chunk(MOVES), ...chunk(SPELLS)]
}

/** Pane rows the duel needs besides the cards: header, round, stage, players, result, input, a little log. */
const DUEL_ROWS = 2 + 1 + 1 + STAGE_ROWS + 2 + 1 + 1 + 3

function cardCells(row: typeof MOVES, p: Player | undefined, now: number) {
  const cols = row.length * CARD_COLS
  return encodeCells(drawCards(row.map(b => b.action), p, now), cols, CARD_PX_H)
}

const room = atom({ plugin: 'pairplay', key: 'room' } as const, null, { shape: 'room-1' })
const peers = atom({ plugin: 'pairplay', key: 'peers' } as const, {}, { shape: 'peers-1' })
const log = atom({ plugin: 'pairplay', key: 'log' } as const, [], { shape: 'log-1' })
const conn = atom({ plugin: 'pairplay', key: 'conn' } as const, 'off' as Conn)
// The relay chosen with `/coop relay` or a join link; null: the configured one.
const relayChoice = atom({ plugin: 'pairplay', key: 'relay' } as const, null, { shape: 'relay-1' })
const game = atom({ plugin: 'pairplay', key: 'game' } as const, INITIAL_DUEL, { shape: 'duel-2' })
// Host only: the round's hidden picks, never broadcast.
const picks = atom({ plugin: 'pairplay', key: 'picks' } as const, {})
// Guest only: what this player cast this round, for the icon over their head.
const mine = atom({ plugin: 'pairplay', key: 'mine' } as const, null)

const HELP = [
  '/coop host          create a room, share the code',
  '/coop join <code> [relay]  join the other player',
  '/coop relay [url]   show or switch the relay (both players)',
  '/coop say <text>    chat (or type in the pane)',
  '/coop <action>      charge | supercharge | shield | drain (1 mana) | heal (1)',
  '                    fire | water | nature (1), fire+ ... (2)',
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
let loop: { cancel(): void } | undefined
let stageCols = 0
// The card rows the pane drew, for the loop to repaint; empty when it drew none.
let shownCards: (typeof MOVES)[] = []

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
  const next = applyIntent({ duel: before, picks: await read($, picks) }, id, intent)
  if (!next) return null
  await update($, picks, () => next.picks)
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
  anim = { t0: await $.clock.now() }
  startLoop($)
  await tick($)
}

function startLoop($: $) {
  loop ??= $.clock.every(FRAME_MS, () => void quietly(() => tick($)))
}

function stopLoop() {
  loop?.cancel()
  loop = undefined
  anim = undefined
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
  return { me, now, ...(t !== undefined ? { t } : {}), ...(myPick ? { myPick } : {}) }
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
  // Denied while the pane is closed: nothing to paint, the loop just idles.
  await $.ui.blit({ requestId: PANE, key: 'stage', cells: encodeCells(drawStage(d, stageCols, view), stageCols, STAGE_PX_H) })
  if (d.winner === undefined) {
    const p = d.players[me]
    await Promise.all(shownCards.map((row, i) => $.ui.blit({ requestId: PANE, key: `cards-${i}`, cells: cardCells(row, p, view.now) })))
  }
}

async function act($: $, intent: { kind: 'act'; action: Action } | { kind: 'rematch' }) {
  if (!(await read($, room))) return 'Not in a room.'
  if (intent.kind === 'act') {
    const p = (await read($, game)).players[me]
    const why = p ? whyNot(p, intent.action) : 'not seated'
    if (why) return `${describe(intent)}: ${why}`
  }
  if (!(await isHost($))) {
    if (intent.kind === 'act') {
      const action = intent.action
      const round = (await read($, game)).round
      await update($, mine, () => ({ round, action }))
    }
    pending = { intent, states: statesSeen, tries: 0 }
    $.clock.after(RESEND_MS, () => void quietly(() => resend($)))
    void send($, 'intent', intent)
    return `${describe(intent)} sent to host`
  }
  const d = await hostApply($, me, myName, intent)
  if (!d) return `${describe(intent)}: not allowed now`
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

function describe(intent: { kind: string; action?: string }) {
  return intent.kind === 'act' ? String(intent.action) : 'rematch'
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
    ...(p.shieldLocked ? ['shield locked'] : []),
    ...(p.drainCooldown > 0 ? [`drain in ${p.drainCooldown}`] : []),
    ...(p.superCooldown > 0 ? [`super in ${p.superCooldown}`] : []),
    ...(p.healCooldown > 0 ? [`heal in ${p.healCooldown}`] : []),
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
      default: {
        const action = verb.toLowerCase()
        if (isAction(action)) return { text: await act($, { kind: 'act', action }) }
        return { text: HELP }
      }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Raster = 'Raster' in els ? els.Raster : undefined
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
    const buttons = cardRows(e.props.bodyColumns)
    // Cards only where they fit: on a short pane the buttons alone, under the stage.
    const cardsFit = !e.viewport || e.viewport.rows >= DUEL_ROWS + buttons.length * (CARD_ROWS + 1)
    shownCards = Raster && cardsFit ? buttons : []
    const used = 8 + (Raster ? STAGE_ROWS + 1 : 0) + buttons.length * (shownCards.length ? CARD_ROWS + 1 : 1)
    const rows = Math.max(3, (e.viewport?.rows ?? 24) - used)

    return (
      <Box flexDirection="column">
        <Text bold>
          {r ? `Room ${r.code}` : 'No room'} <Text dimColor>· {c} · you are {myName}</Text>
        </Text>
        <Text dimColor>
          {live.length === 0 ? 'waiting for the other player…' : `with: ${live.map(([, p]) => p.name).join(', ')}`}
        </Text>
        {r && (
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
            {g.winner ? (
              <Button key="rematch" label="⚔ rematch" hotkey="r" onPress={() => void act($, { kind: 'rematch' })} />
            ) : (
              buttons.map((row, i) => (
                <Box flexDirection="column">
                  {Raster && shownCards.length > 0 && (
                    <Raster
                      key={`cards-${i}`}
                      columns={row.length * CARD_COLS}
                      rows={CARD_ROWS}
                      cells={cardCells(row, g.players[me], view.now)}
                    />
                  )}
                  <Box flexDirection="row">
                    {row.map(b => {
                      const p = g.players[me]
                      return (
                        <Box width={CARD_COLS} flexShrink={0}>
                          {p && legal(p, b.action) ? (
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
                      )
                    })}
                  </Box>
                </Box>
              ))
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
