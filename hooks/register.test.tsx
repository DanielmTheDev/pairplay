import { expect, mock, test } from 'claude-code/testing'

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
  expect(spawned[0]?.at(-1)).toBe(`https://ntfy.sh/${topic}/json`)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ type: 'Text', text: /hi there/ }))).toBeDefined()
  expect((await ui.find({ type: 'Text', text: /with: bob/ }))).toBeDefined()

  await ui.input({ key: 'say', text: 'hello bob' })
  const said = posts.map(p => JSON.parse(p.body)).find(env => env.type === 'say')
  expect(said).toEqual({ v: 1, from: 'my-session', name: 'alice', type: 'say', payload: 'hello bob' })
  expect(posts[0]?.url).toBe(`https://ntfy.sh/${topic}`)
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

const ntfy = (id: string, env: object) =>
  JSON.stringify({ event: 'message', id, message: JSON.stringify({ v: 1, ...env }) }) + '\n'

function harness(on: Parameters<Parameters<typeof test>[1]>[1], lines: string[]) {
  const posts: { type: string; payload?: unknown }[] = []
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
    posts.push(JSON.parse(e.init?.body ?? '{}'))
    return { value: { status: 200, ok: true, headers: {}, text: '{}' } }
  })
  on('process.spawn', async function* () {
    yield { stream: 'stdout' as const, text: '{"event":"open"}\n' + lines.join('') }
    await new Promise(() => {})
    return { code: 0, signal: null }
  })
  return Object.assign(posts, { blits, clock })
}

const state = (posts: { type: string; payload?: unknown }[]) =>
  posts.filter(p => p.type === 'state').at(-1)?.payload as Record<string, any> | undefined

test('host: seats guest, hides first pick, resolves on second', async ($, on) => {
  const posts = harness(on, [
    ntfy('m1', { from: 'peer', name: 'caren', type: 'hello' }),
    ntfy('m2', { from: 'peer', name: 'caren', type: 'intent', payload: { kind: 'cast', element: 'fire' } }),
  ])
  const { blits, clock } = posts
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'host' })
  await new Promise(r => setTimeout(r, 50))

  const hidden = state(posts)!
  expect(hidden.players.peer).toEqual({ name: 'caren', life: 3, picked: true })
  expect(JSON.stringify(posts)).not.toContain('"fire"')

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Raster', key: 'stage' })).toBeDefined()
  const res = await $.command.run({ command: 'coop', args: 'cast water' })
  expect(res.text).toMatch(/round resolves/)
  expect(blits.at(-1)).toMatchObject({ requestId: 'pairplay', key: 'stage' })
  // The result stays hidden while the round plays.
  expect(await ui.find({ type: 'Text', text: /→/ })).toBeUndefined()
  const after = state(posts)!
  expect(after.players.peer.life).toBe(2)
  expect(after.last).toEqual({ round: 1, picks: { peer: 'fire', 'my-session': 'water' }, loser: 'peer' })

  await clock.advance(2400)
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
      host: { name: 'dani', life: 3, picked: true },
      'my-session': { name: 'alice', life: 2, picked: false },
    },
  }
  const posts = harness(on, [
    ntfy('m1', { from: 'host', name: 'dani', type: 'state', payload: duel }),
    ntfy('m2', { from: 'host', name: 'dani', type: 'state', payload: { ...duel, seq: 1 } }),
    ntfy('m3', { from: 'host', name: 'dani', type: 'intent', payload: { kind: 'cast', element: 'fire' } }),
  ])
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await $.command.run({ command: 'coop', args: 'join ABCD-EFGH' })
  await new Promise(r => setTimeout(r, 50))

  expect((await $.command.run({ command: 'coop', args: 'cast lava' })).text).toMatch(/fire, water or nature/)
  await $.command.run({ command: 'coop', args: 'cast nature' })
  expect(posts.find(p => p.type === 'intent')?.payload).toEqual({ kind: 'cast', element: 'nature' })
  expect(posts.some(p => p.type === 'state')).toBe(false)

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /round 2/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /dani.*picked/ })).toBeDefined()
  await ui.press({ key: 'fire' })
  expect(posts.filter(p => p.type === 'intent').at(-1)?.payload).toEqual({ kind: 'cast', element: 'fire' })
  await ui.unmount()
})
