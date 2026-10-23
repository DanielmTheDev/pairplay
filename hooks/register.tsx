import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Conn, LogLine, Peer } from '../types'
import {
  PING_MS,
  PROTOCOL,
  livePeers,
  makeRoomCode,
  normalizeRoomCode,
  parseLine,
  publishUrl,
  splitLines,
  subscribeUrl,
  type Envelope,
} from './protocol'

const PANE = 'pairplay'

const room = atom({ plugin: 'pairplay', key: 'room' } as const, null, { shape: 'room-1' })
const peers = atom({ plugin: 'pairplay', key: 'peers' } as const, {}, { shape: 'peers-1' })
const log = atom({ plugin: 'pairplay', key: 'log' } as const, [], { shape: 'log-1' })
const conn = atom({ plugin: 'pairplay', key: 'conn' } as const, 'off' as Conn)

const HELP = [
  '/coop host          create a room, share the code',
  '/coop join <code>   join the other player',
  '/coop say <text>    chat (or type in the pane)',
  '/coop leave         leave the room',
  '/coop               open the pane',
].join('\n')

type $ = EngineInterface

// Module state: starts over on every reload; the subscription restarts from `room`.
let relay = 'https://ntfy.sh'
let me = ''
let myName = 'player'
let generation = 0
let stream: AsyncGenerator<unknown, unknown> | undefined
let pinger: { cancel(): void } | undefined
let backoffMs = 1000

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

async function send($: $, type: string, payload?: unknown) {
  const r = await read($, room)
  if (!r) return false
  const env: Envelope = { v: PROTOCOL, from: me, name: myName, type, payload }
  try {
    const res = await $.http.fetch(publishUrl(relay, r.code), {
      method: 'POST',
      body: JSON.stringify(env),
    })
    if (!res.ok) {
      const why = res.status === 429 ? ' (relay rate limit, try a self-hosted relayUrl)' : ''
      await addLog($, 'relay', `send failed: HTTP ${res.status}${why}`)
    }
    return res.ok
  } catch (err) {
    await addLog($, 'relay', `send failed: ${String(err)}`)
    return false
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
      return
    case 'here':
    case 'ping':
      if (await seen($, env)) {
        await addLog($, env.name, 'is here')
        $.ui.toast(`coop: ${env.name} is here`)
      }
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
  }
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
    argv: ['curl', '-sN', '--fail', '--connect-timeout', '10', subscribeUrl(relay, r.code, r.lastId)],
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
  $.clock.after(wait, () => void subscribe($, gen))
}

function stop() {
  generation++
  pinger?.cancel()
  pinger = undefined
  void stream?.return(undefined)
  stream = undefined
}

async function start($: $) {
  stop()
  const gen = generation
  backoffMs = 1000
  void subscribe($, gen)
  // Announce once the stream had a moment to open, so the answer isn't missed.
  $.clock.after(1500, () => void send($, 'hello'))
  pinger = $.clock.every(PING_MS, () => {
    void send($, 'ping')
    void refreshStatus($)
  })
}

/** Switches to room `code`; answers a message when nothing changed. */
async function enter($: $, code: string, verb: string) {
  const current = await read($, room)
  if (current?.code === code) return `Already in room ${code}.`
  if (current) await send($, 'bye')
  await update($, room, () => ({ code }))
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
  relay = String(options.relayUrl || 'https://ntfy.sh')

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
        await enter($, code, 'hosting')
        await $.ui.copy({ text: code })
        return { text: `Hosting room ${code} (copied). Other player: /coop join ${code}` }
      }
      case 'join': {
        const code = normalizeRoomCode(arg)
        if (!code) return { text: `Bad room code "${arg}". Expected XXXX-XXXX.` }
        return { text: (await enter($, code, 'joined')) ?? `Joining room ${code}…` }
      }
      case 'say':
        return { text: arg ? await say($, arg) : 'Nothing to say.' }
      case 'leave':
        return { text: await leave($) }
      default:
        return { text: HELP }
    }
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text } = els
    // Mobile draws no field: chat there via /coop say.
    const Input = 'Input' in els ? els.Input : undefined
    const r = await read($, room)
    const c = await read($, conn)
    const live = livePeers(await read($, peers), Date.now())
    const lines = await read($, log)
    const rows = Math.max(3, (e.viewport?.rows ?? 24) - 8)

    return (
      <Box flexDirection="column">
        <Text bold>
          {r ? `Room ${r.code}` : 'No room'} <Text dimColor>· {c} · you are {myName}</Text>
        </Text>
        <Text dimColor>
          {live.length === 0 ? 'waiting for the other player…' : `with: ${live.map(([, p]) => p.name).join(', ')}`}
        </Text>
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
