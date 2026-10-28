import { expect, mock, test } from 'claude-code/testing'

import { COLORS } from './scene'

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

const PANE = {
  plugin: 'pairplay',
  component: 'Pane',
  requestId: 'pairplay',
  props: {
    title: 'Co-op',
    isFocused: false,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 20 },
    view: {},
  },
} as const

const peerSay = JSON.stringify({
  event: 'message',
  id: 'm1',
  message: JSON.stringify({ v: 1, from: 'peer-session', name: 'bob', type: 'say', payload: 'hi there' }),
})

test('host: subscribes, receives peer chat, answers hello, chats back', async ($, on) => {
  const posts: { url: string; body: string }[] = []
  const spawned: string[][] = []
  mock.clock(on)

  on('command.register', () => ({ value: { command: 'coop' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('session.id', () => ({ value: 'my-session' }))
  on('env.get', () => ({ value: 'alice' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('http.fetch', (_, e) => {
    posts.push({ url: e.url, body: e.init?.body ?? '' })
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    yield { stream: 'stdout' as const, text: '{"event":"open"}\n' + peerSay.slice(0, 20) }
    yield { stream: 'stdout' as const, text: peerSay.slice(20) + '\n' }
    // Keep the "connection" open like curl does.
    await new Promise(() => {})
    return { code: 0, signal: null }
  })

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const res = await $.command.run({ command: 'coop', args: 'host' })
  expect(res.text).toMatch(/^Hosting room [A-Z2-9]{4}-[A-Z2-9]{4}/)

  const code = /room (\S+)/.exec(res.text ?? '')?.[1] ?? ''
  const topic = `pairplay-${code.replace('-', '').toLowerCase()}`
  await new Promise(r => setTimeout(r, 50))
  expect(spawned[0]?.at(-1)).toBe(`https://pairplay-relay.dadamuck.workers.dev/${topic}/json`)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /hi there/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /with: bob/ }))).toBeDefined()

  await ui.input({ key: 'say', text: 'hello bob' })
  const said = posts.map(p => JSON.parse(p.body)).find(env => env.type === 'say')
  expect(said).toEqual({ v: 1, from: 'my-session', name: 'alice', type: 'say', payload: 'hello bob' })
  expect(posts[0]?.url).toBe(`https://pairplay-relay.dadamuck.workers.dev/${topic}`)
  await ui.unmount()
})

test('join rejects a malformed code', async ($, on) => {
  on('command.register', () => ({ value: { command: 'coop' } }))
  on('session.id', () => ({ value: 'my-session' }))
  on('env.get', () => ({ value: 'alice' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  const res = await $.command.run({ command: 'coop', args: 'join nope' })
  expect(res.text).toMatch(/Bad room code/)
})

/** A seated player as the host broadcasts it. */
const P = (name: string, over: object = {}) => ({
  name,
  life: 3,
  mana: 1,
  picked: false,
  shieldCooldown: 0,
  drainCooldown: 0,
  healCooldown: 0,
  avatarRounds: 0,
  avatarCooldown: 0,
  ...over,
})

const ntfy = (id: string, env: object) =>
  JSON.stringify({ event: 'message', id, message: JSON.stringify({ v: 1, ...env }) }) + '\n'

type Opts = { failFirst?: number; failStatus?: number; gate?: Promise<void>; more?: Promise<string[]> }

function harness(on: Parameters<Parameters<typeof test>[1]>[1], lines: string[], opts: Opts = {}) {
  const posts: { type: string; payload?: unknown }[] = []
  const attempts: string[] = []
  const urls: string[] = []
  const spawned: string[][] = []
  let failures = opts.failFirst ?? 0
  const blits: unknown[] = []
  on('ui.blit', (_, e) => {
    blits.push(e)
    return { value: {} }
  })
  const clock = mock.clock(on)
  on('command.register', () => ({ value: { command: 'coop' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('session.id', () => ({ value: 'my-session' }))
  on('env.get', () => ({ value: 'alice' }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('http.fetch', (_, e) => {
    const body = e.init?.body ?? '{}'
    attempts.push(body)
    urls.push(e.url)
    if (failures > 0) {
      failures--
      return { value: { status: opts.failStatus ?? 503, ok: false, headers: {}, text: '' } }
    }
    posts.push(JSON.parse(body))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  on('process.spawn', async function* (_, e) {
    spawned.push([...e.argv])
    yield { stream: 'stdout' as const, text: '{"event":"open"}\n' }
    if (opts.gate) await opts.gate
    if (lines.length) yield { stream: 'stdout' as const, text: lines.join('') }
    // Messages that come later, once the test says so.
    if (opts.more) yield { stream: 'stdout' as const, text: (await opts.more).join('') }
    await new Promise(() => {})
    return { code: 0, signal: null }
  })
  return Object.assign(posts, { blits, clock, attempts, urls, spawned })
}

const state = (posts: { type: string; payload?: unknown }[]) =>
  posts.filter(p => p.type === 'state').at(-1)?.payload as Record<string, any> | undefined

test('host: seats guest, hides first pick, resolves on second', async ($, on) => {
  let open = () => {}
  const gate = new Promise<void>(r => (open = r))
  const posts = harness(
    on,
    [
      ntfy('m1', { from: 'peer', name: 'caren', type: 'hello' }),
      ntfy('m3', { from: 'peer', name: 'caren', type: 'intent', payload: { kind: 'act', action: 'fire' } }),
    ],
    { gate },
  )
  const { blits, clock } = posts
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'host' })
  await settle()
  open()
  await settle()

  const hidden = state(posts)!
  expect(hidden.players.peer).toEqual(P('caren', { picked: true }))
  expect(JSON.stringify(posts)).not.toContain('"fire"')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeDefined()
  const res = await $.command.run({ command: 'coop', args: 'cast water' })
  expect(res.text).toMatch(/round resolves/)
  expect(blits).toContainEqual(expect.objectContaining({ requestId: 'pairplay', key: 'stage' }))
  // The result stays hidden while the round plays.
  expect(await ui.find({ type: 'Text', text: /→/ })).toBeUndefined()
  const after = state(posts)!
  expect(after.players.peer.life).toBe(2)
  expect(after.last).toEqual({ round: 1, picks: { peer: 'fire', 'my-session': 'water' }, loser: 'peer', dmg: 1, stole: false, healed: {}, buffed: [] })

  await clock.advance(3000)
  await ui.unmount()
  const after2 = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await after2.find({ type: 'Text', text: /round 1: .*caren fire.* → caren -1/ })).toBeDefined()
  expect(await after2.find({ type: 'Text', text: /alice water/ })).toBeDefined()
  await after2.unmount()
})

test('guest: cast sends intent only; host snapshot is what shows', async ($, on) => {
  const duel = {
    seq: 5,
    round: 2,
    players: {
      host: P('dani', { picked: true }),
      'my-session': P('alice', { life: 2 }),
    },
  }
  const posts = harness(on, [
    ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel }),
    ntfy('m2', { from: 'host', name: 'dani', type: 'state', payload: { ...duel, seq: 1 } }),
    ntfy('m3', { from: 'host', name: 'dani', type: 'intent', payload: { kind: 'act', action: 'fire' } }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await new Promise(r => setTimeout(r, 50))

  expect((await $.command.run({ command: 'coop', args: 'cast lava' })).text).toMatch(/charge, shield/)
  // Not enough mana: refused before it goes out.
  expect((await $.command.run({ command: 'coop', args: 'cast avatar' })).text).toMatch(/needs 3 mana/)
  // Gone from the game.
  expect((await $.command.run({ command: 'coop', args: 'cast supercharge' })).text).toMatch(/Cast what/)
  await $.command.run({ command: 'coop', args: 'cast nature' })
  expect(posts.find(p => p.type === 'intent')?.payload).toEqual({ kind: 'act', action: 'nature' })
  expect(posts.some(p => p.type === 'state')).toBe(false)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /round 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dani.*✦/ })).toBeDefined()
  await ui.press({ key: 'fire' })
  expect(posts.filter(p => p.type === 'intent').at(-1)?.payload).toEqual({ kind: 'act', action: 'fire' })
  // A bare action verb works as well.
  await $.command.run({ command: 'coop', args: 'charge' })
  expect(posts.filter(p => p.type === 'intent').at(-1)?.payload).toEqual({ kind: 'act', action: 'charge' })
  await ui.unmount()
})

test('guest: own pick shows as its icon on the stage', async ($, on) => {
  const duel = {
    seq: 5,
    round: 2,
    players: {
      host: P('dani'),
      'my-session': P('alice', { picked: true }),
    },
  }
  harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await new Promise(r => setTimeout(r, 50))
  await $.command.run({ command: 'coop', args: 'cast nature' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const stage = await ui.find({ type: 'Raster', key: 'stage' })
  const bytes = Uint8Array.from(atob(String(stage?.props.cells)), c => c.charCodeAt(0))
  const words = [...new Uint32Array(bytes.buffer)]
  expect(words.includes(COLORS.icon.nature)).toBe(true)
  expect(words.includes(COLORS.icon.fire)).toBe(false)
  await ui.unmount()
})

test('guest: pane shows mana and timers, greys out what is not allowed', async ($, on) => {
  const duel = {
    seq: 5,
    round: 4,
    players: {
      host: P('dani', { mana: 3 }),
      'my-session': P('alice', { life: 2, mana: 1, shieldCooldown: 2, drainCooldown: 2, avatarCooldown: 3, healCooldown: 1 }),
    },
  }
  const posts = harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /alice.*◆◇◇.*shield in 2.*drain in 2.*heal in 1.*avatar in 3/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dani.*◆◆◆/ })).toBeDefined()
  // Action cards above the buttons, animated by the stage loop: the attacks, then the rest.
  expect(await ui.find({ type: 'Client', key: 'cards-0' })).toMatchObject({ props: { width: 40, height: 5 } })
  expect(await ui.find({ type: 'Client', key: 'cards-1' })).toMatchObject({ props: { width: 40, height: 5 } })
  expect(await ui.find({ type: 'Client', key: 'cards-2' })).toBeUndefined()
  expect(await ui.find({ type: 'Button', key: 'fire' })).toMatchObject({ props: { label: 'fire', hotkey: '1', plain: true } })
  // Only what is allowed is pressable; the rest is drawn, not a Button.
  const button = (key: string) => ui.find({ type: 'Button', key })
  expect(await button('charge')).toBeDefined()
  expect(await button('fire')).toBeDefined()
  for (const key of ['shield', 'drain', 'heal', 'avatar']) expect(await button(key)).toBeUndefined()
  expect((await $.command.run({ command: 'coop', args: 'shield' })).text).toMatch(/shield in 2/)
  expect((await $.command.run({ command: 'coop', args: 'avatar' })).text).toMatch(/needs 3 mana/)
  expect(posts.some(p => p.type === 'intent')).toBe(false)
  await ui.unmount()
})

test('guest: the Avatar State is offered at full mana; while it holds, the pane says so', async ($, on) => {
  const duel = { seq: 5, round: 1, players: { host: P('dani', { avatarRounds: 2 }), 'my-session': P('alice', { mana: 3 }) } }
  const posts = harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /dani.*avatar 2 rounds/ })).toBeDefined()
  await ui.press({ key: 'avatar' })
  expect(posts.filter(p => p.type === 'intent').at(-1)?.payload).toEqual({ kind: 'act', action: 'avatar' })
  await ui.unmount()
})

test('guest: a click on a card casts it; a click on a greyed one does nothing', async ($, on) => {
  const duel = { seq: 5, round: 1, players: { host: P('dani'), 'my-session': P('alice') } }
  const posts = harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Row 1: charge, shield, heal, avatar; ten columns a card. Heal at full life: grey.
  await ui.pointer({ in: 'cards-1', type: 'down', x: 25, y: 2, button: 'left' })
  await settle()
  expect(posts.some(p => p.type === 'intent')).toBe(false)
  await ui.pointer({ in: 'cards-1', type: 'down', x: 15, y: 2, button: 'left' })
  await settle()
  expect(posts.filter(p => p.type === 'intent').at(-1)?.payload).toEqual({ kind: 'act', action: 'shield' })
  await ui.unmount()
})

test('guest: the card under the pointer lights up, and goes dark when it leaves', async ($, on) => {
  const duel = { seq: 5, round: 1, players: { host: P('dani'), 'my-session': P('alice') } }
  harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  const lit = async () => JSON.stringify(await ui.drawn({ in: 'cards-1' })).includes(hex(COLORS.cardHover))
  expect(await lit()).toBe(false)
  await ui.pointer({ in: 'cards-1', type: 'move', x: 5, y: 2 })
  expect(await lit()).toBe(true)
  await ui.pointer({ in: 'cards-1', type: 'leave', x: 5, y: 2 })
  expect(await lit()).toBe(false)
  await ui.unmount()
})

test('host: the Avatar State below full mana is not offered and not picked', async ($, on) => {
  const posts = harness(on, [ntfy('m1', { from: 'peer', name: 'caren', type: 'hello' })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'host' })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Button', key: 'avatar' })).toBeUndefined()
  expect((await $.command.run({ command: 'coop', args: 'cast avatar' })).text).toMatch(/needs 3 mana/)
  expect(state(posts)!.players['my-session'].picked).toBe(false)
  await ui.unmount()
})

test('guest: game over logs the game summary', async ($, on) => {
  const duel = { seq: 5, round: 3, players: { host: P('dani'), 'my-session': P('alice', { life: 1 }) } }
  const over = {
    ...duel,
    seq: 6,
    round: 4,
    players: { host: P('dani', { mana: 0 }), 'my-session': P('alice', { life: 0 }) },
    last: { round: 3, picks: { host: 'fire', 'my-session': 'charge' }, loser: 'my-session', dmg: 1, stole: false, healed: {}, buffed: [] },
    winner: 'host',
    tally: { fire: 3, charge: 3 },
  }
  const { clock: clock } = harness(on, [
    ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel }),
    ntfy('m2', { from: 'host', name: 'dani', type: 'state', payload: over }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Not before the death has played: no spoilers.
  expect(await ui.find({ type: 'Text', text: /won in/ })).toBeUndefined()
  await clock.advance(6000)
  expect(await ui.find({ type: 'Text', text: /dani won in 3 rounds · fire 3 \(50%\) ⚠, charge 3 \(50%\) ⚠/ })).toBeDefined()
  await ui.unmount()
})

test('guest: game over shows an animated rematch card; a click on it asks for the rematch', async ($, on) => {
  const over = {
    seq: 6,
    round: 4,
    players: { host: P('dani', { mana: 0 }), 'my-session': P('alice', { life: 0 }) },
    last: { round: 3, picks: { host: 'fire', 'my-session': 'charge' }, loser: 'my-session', dmg: 1, stole: false, healed: {}, buffed: [] },
    winner: 'host',
  }
  const posts = harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: over })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Client', key: 'rematch' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'rematch' })).toMatchObject({ props: { hotkey: 'r' } })
  const frame = async () => JSON.stringify(await ui.drawn({ in: 'rematch' }))
  const a = await frame()
  await ui.advance(400)
  expect(await frame()).not.toBe(a)
  await ui.pointer({ in: 'rematch', type: 'down', x: 4, y: 2, button: 'left' })
  await settle()
  expect(posts.filter(p => p.type === 'intent').at(-1)?.payload).toEqual({ kind: 'rematch' })
  await ui.unmount()
})

test('guest: each resolved round goes to the log and raises a notification, once it has played', async ($, on) => {
  const notes: string[] = []
  // The system's own notifier first: notify-send here.
  on('process.run', (_, e) => {
    if (e.argv[0] === 'notify-send') notes.push(String(e.argv.at(-1)))
    return { value: { exitCode: 0, stdout: '', stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  const duel = { seq: 5, round: 1, players: { host: P('dani'), 'my-session': P('alice') } }
  const r1 = {
    ...duel,
    seq: 6,
    round: 2,
    players: { host: P('dani', { mana: 2 }), 'my-session': P('alice', { mana: 0, life: 3 }) },
    last: { round: 1, picks: { host: 'charge', 'my-session': 'fire' }, loser: 'host', dmg: 1, stole: false, healed: {}, buffed: [] },
  }
  const r2 = {
    ...r1,
    seq: 7,
    round: 3,
    last: { round: 2, picks: { host: 'pass', 'my-session': 'shield' }, loser: null, dmg: 0, stole: false, healed: {}, buffed: [] },
  }
  let more = (_: string[]) => {}
  const later = new Promise<string[]>(r => (more = r))
  const { clock } = harness(
    on,
    [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel }), ntfy('m2', { from: 'host', name: 'dani', type: 'state', payload: r1 })],
    { more: later },
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  // No spoilers: nothing until the round has played.
  expect(notes).toEqual([])
  await clock.advance(6000)
  expect(notes).toEqual(['round 1: dani charge vs alice fire → dani -1'])
  more([ntfy('m3', { from: 'host', name: 'dani', type: 'state', payload: r2 })])
  await settle()
  await clock.advance(6000)
  expect(notes.at(-1)).toBe('round 2: dani pass vs alice shield → no damage')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // Both rounds stay in the log, the history of the game.
  expect(await ui.find({ type: 'Text', text: /round 1: dani charge vs alice fire → dani -1/ })).toBeDefined()
  await ui.unmount()
})

test('notify: with no system notifier, falls back to the terminal\'s, then a toast', async ($, on) => {
  const tried: string[] = []
  const notes: string[] = []
  const toasts: string[] = []
  on('process.run', (_, e) => {
    tried.push(String(e.argv[0]))
    throw new Error('ENOENT')
  })
  let sent = true
  on('ui.notify', (_, e) => {
    notes.push(e.text)
    return { value: sent ? { isSent: true as const, channel: 'kitty' as const } : { isSent: false as const, reason: 'no-channel' as const } }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  const duel = { seq: 5, round: 1, players: { host: P('dani'), 'my-session': P('alice') } }
  const r1 = {
    ...duel,
    seq: 6,
    round: 2,
    last: { round: 1, picks: { host: 'pass', 'my-session': 'pass' }, loser: null, dmg: 0, stole: false, healed: {}, buffed: [] },
  }
  let more = (_: string[]) => {}
  const later = new Promise<string[]>(r => (more = r))
  const { clock } = harness(
    on,
    [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel }), ntfy('m2', { from: 'host', name: 'dani', type: 'state', payload: r1 })],
    { more: later },
  )
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  await clock.advance(6000)
  expect(tried).toEqual(['notify-send', 'osascript'])
  expect(notes).toEqual(['round 1: dani pass vs alice pass → no damage'])
  expect(toasts.filter(t => t.startsWith('round'))).toEqual([])
  sent = false
  more([ntfy('m3', { from: 'host', name: 'dani', type: 'state', payload: { ...r1, seq: 7, round: 3, last: { ...r1.last, round: 2 } } })])
  await settle()
  await clock.advance(6000)
  expect(toasts.filter(t => t.startsWith('round'))).toEqual(['round 2: dani pass vs alice pass → no damage'])
})

test('log: only the last two lines, right under the cards', async ($, on) => {
  const duel = { seq: 5, round: 1, players: { host: P('dani'), 'my-session': P('alice') } }
  const say = (id: string, text: string) => ntfy(id, { from: 'host', name: 'dani', type: 'say', payload: text })
  harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel }), say('m2', 'one'), say('m3', 'two'), say('m4', 'three')])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /: one$/ })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /: two$/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /: three$/ })).toBeDefined()
  const tree = JSON.stringify(await ui.drawn())
  const pass = tree.indexOf('"pass"')
  expect(pass).toBeGreaterThan(-1)
  expect(tree.indexOf('three')).toBeGreaterThan(pass)
  expect(tree.indexOf('three')).toBeLessThan(tree.indexOf('"say"'))
  await ui.unmount()
})

test('relay: /coop relay switches it; the host hint carries it to the other player', async ($, on) => {
  const posts = harness(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  expect((await $.command.run({ command: 'coop', args: 'relay' })).text).toMatch(/relay: https:\/\/pairplay-relay\.dadamuck\.workers\.dev/)
  expect((await $.command.run({ command: 'coop', args: 'relay ftp://nope' })).text).toMatch(/http/)
  expect((await $.command.run({ command: 'coop', args: 'relay https://relay.example.dev/' })).text).toMatch(/relay set: https:\/\/relay\.example\.dev/)
  const res = await $.command.run({ command: 'coop', args: 'host' })
  expect(res.text).toMatch(/\/coop join [A-Z2-9]{4}-[A-Z2-9]{4} https:\/\/relay\.example\.dev/)
  await settle()
  expect(posts.spawned.at(-1)?.at(-1)).toMatch(/^https:\/\/relay\.example\.dev\/pairplay-[a-z2-9]{8}\/json$/)
  await posts.clock.advance(2000)
  expect(posts.urls.at(-1)).toMatch(/^https:\/\/relay\.example\.dev\/pairplay-/)
})

test('relay: join with a relay url uses that relay', async ($, on) => {
  const posts = harness(on, [])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join abcd-efgh https://r2.example.dev' })
  await settle()
  expect(posts.spawned.at(-1)?.at(-1)).toBe('https://r2.example.dev/pairplay-abcdefgh/json')
  expect((await $.command.run({ command: 'coop', args: 'relay' })).text).toMatch(/r2\.example\.dev/)
})

test('relay: a rate limit is not retried, and says how to switch', async ($, on) => {
  const posts = harness(on, [ntfy('m1', { from: 'peer', name: 'caren', type: 'hello' })], { failFirst: 99, failStatus: 429 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'host' })
  await settle()
  await posts.clock.advance(30_000)
  await settle()
  // Only fresh messages go out; none of them is retried.
  expect(new Set(posts.attempts).size).toBe(posts.attempts.length)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /quota.*\/coop relay/ })).toBeDefined()
  await ui.unmount()
})

test('pane: cards wrap to a narrow pane, and give way when it is short', async ($, on) => {
  const duel = { seq: 5, round: 1, players: { host: P('dani'), 'my-session': P('alice') } }
  harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  const narrow = await $.ui.mount({ ...PANE, props: { ...PANE.props, bodyColumns: 32 }, viewport: { rows: 60, columns: 32 }, surface: 'terminal' })
  // 3 cards a row: the 8 actions take three rows.
  for (const [key, columns] of [['cards-0', 30], ['cards-1', 30], ['cards-2', 20]] as const) {
    expect(await narrow.find({ type: 'Client', key })).toMatchObject({ props: { width: columns } })
  }
  await narrow.unmount()
  const short = await $.ui.mount({ ...PANE, viewport: { rows: 30, columns: 60 }, surface: 'terminal' })
  expect(await short.find({ type: 'Raster', key: 'stage' })).toBeDefined()
  expect(await short.find({ type: 'Client', key: 'cards-0' })).toBeUndefined()
  // The buttons stay.
  expect(await short.find({ type: 'Button', key: 'fire' })).toBeDefined()
  await short.unmount()
})

const states = (posts: { type: string; payload?: unknown }[]) => posts.filter(p => p.type === 'state')
const settle = () => new Promise(r => setTimeout(r, 50))

test('host: answers even a rejected intent with its state', async ($, on) => {
  const posts = harness(on, [
    ntfy('m1', { from: 'peer', name: 'caren', type: 'hello' }),
    ntfy('m2', { from: 'peer', name: 'caren', type: 'intent', payload: { kind: 'act', action: 'lava' } }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'host' })
  await settle()
  expect(states(posts).length).toBe(2)
})

test('host: a peer behind (ping with an old seq, or sync) gets the state again', async ($, on) => {
  const posts = harness(on, [
    ntfy('m1', { from: 'peer', name: 'caren', type: 'hello' }),
    ntfy('m2', { from: 'peer', name: 'caren', type: 'ping', payload: { seq: 0 } }),
    ntfy('m3', { from: 'peer', name: 'caren', type: 'ping', payload: { seq: 999 } }),
    ntfy('m4', { from: 'peer', name: 'caren', type: 'sync' }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'host' })
  await settle()
  // hello, the stale ping and the sync each get one; the current ping none.
  expect(states(posts).length).toBe(3)
})

test('guest: asks for a sync when the host is ahead; pings carry its seq', { timeoutMs: 30_000 }, async ($, on) => {
  const posts = harness(on, [
    ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: { seq: 4, round: 1, players: {} } }),
    ntfy('m2', { from: 'host', name: 'dani', type: 'ping', payload: { seq: 4 } }),
    ntfy('m3', { from: 'host', name: 'dani', type: 'ping', payload: { seq: 9 } }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  expect(posts.filter(p => p.type === 'sync').length).toBe(1)
  await posts.clock.advance(6000)
  await settle()
  expect(posts.filter(p => p.type === 'ping').at(-1)?.payload).toEqual({ seq: 4 })
})

test('send: retries until the relay takes it', async ($, on) => {
  const posts = harness(on, [ntfy('m1', { from: 'peer', name: 'caren', type: 'hello' })], { failFirst: 2 })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'host' })
  await settle()
  await posts.clock.advance(10_000)
  await settle()
  expect(states(posts).length).toBeGreaterThanOrEqual(1)
  expect(posts.attempts.length).toBeGreaterThanOrEqual(3)
})

test('guest: resends a cast nobody answered, stops once answered', async ($, on) => {
  const duel = { seq: 5, round: 1, players: { host: P('dani'), 'my-session': P('alice') } }
  const posts = harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel })])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  await $.command.run({ command: 'coop', args: 'cast fire' })
  const intents = () => posts.filter(p => p.type === 'intent').length
  expect(intents()).toBe(1)
  await posts.clock.advance(3500)
  expect(intents()).toBe(2)
  await posts.clock.advance(60_000)
  // Gives up after a few tries rather than flooding the relay.
  expect(intents()).toBeLessThanOrEqual(4)
})

test('host: own cast and a guest intent at the same moment both count', async ($, on) => {
  let deliver = (_: string[]) => {}
  const more = new Promise<string[]>(r => (deliver = r))
  const posts = harness(
    on,
    [
      ntfy('m1', { from: 'peer', name: 'caren', type: 'hello' }),
    ],
    { more },
  )
  // Slow state reads, like a busy engine: lets the two writers interleave.
  on('state.get', async (_, e, next) => {
    await new Promise(r => setTimeout(r, 2))
    return next(e)
  })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'host' })
  await settle()
  const mine = $.command.run({ command: 'coop', args: 'cast water' })
  deliver([ntfy('m3', { from: 'peer', name: 'caren', type: 'intent', payload: { kind: 'act', action: 'fire' } })])
  await mine
  const resolved = () => (states(posts).at(-1)?.payload as Record<string, any> | undefined)?.last
  for (let i = 0; i < 80 && !resolved(); i++) await new Promise(r => setTimeout(r, 25))
  const last = states(posts).at(-1)?.payload as Record<string, any>
  expect(last.last?.picks).toEqual({ peer: 'fire', 'my-session': 'water' })
  // No two different snapshots under one seq.
  const bySeq = new Map<number, string>()
  for (const st of states(posts)) {
    const d = st.payload as { seq: number }
    const json = JSON.stringify(d)
    expect(bySeq.get(d.seq) ?? json).toBe(json)
    bySeq.set(d.seq, json)
  }
})

// ─── chaos ───────────────────────────────────────────────────────────────────

test('chaos: announced in the pane, name and effect, and how long a lasting one holds', async ($, on) => {
  const chaos = { event: 'eclipse', round: 4, until: 5, before: { host: { life: 3, mana: 1 }, 'my-session': { life: 3, mana: 1 } } }
  const duel = { seq: 9, round: 4, players: { host: P('dani'), 'my-session': P('alice') }, chaos, chaosCount: 1 }
  let deliver = (_: string[]) => {}
  const more = new Promise<string[]>(r => (deliver = r))
  harness(on, [ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel })], { more })
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Eclipse!.*fire > water > nature > fire.*2 rounds left/ })).toBeDefined()
  await ui.unmount()
  deliver([ntfy('m2', { from: 'host', name: 'dani', type: 'state', payload: { ...duel, seq: 10, round: 5 } })])
  await settle()
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Eclipse.*last round/ })).toBeDefined()
  await ui.unmount()
})

test('chaos: plays after the round that brought it, then says so in the log', async ($, on) => {
  const before = { seq: 8, round: 3, players: { host: P('dani'), 'my-session': P('alice') } }
  const chaos = { event: 'lightning', round: 4, until: 4, before: { host: { life: 3, mana: 1 }, 'my-session': { life: 3, mana: 1 } } }
  const after = {
    seq: 9,
    round: 4,
    players: { host: P('dani', { mana: 3 }), 'my-session': P('alice', { mana: 3 }) },
    last: { round: 3, picks: { host: 'shield', 'my-session': 'shield' }, loser: null, dmg: 0, stole: false, healed: {}, buffed: [] },
    chaos,
    chaosCount: 1,
  }
  const { clock } = harness(on, [
    ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: before }),
    ntfy('m2', { from: 'host', name: 'dani', type: 'state', payload: after }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await settle()
  let ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  // The round plays first: no spoiler.
  expect(await ui.find({ type: 'Text', text: /Lightning Storm/ })).toBeUndefined()
  await ui.unmount()
  await clock.advance(3000)
  ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /Lightning Storm!.*both at 3 mana/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /chaos Lightning Storm/ })).toBeDefined()
  await ui.unmount()
})
