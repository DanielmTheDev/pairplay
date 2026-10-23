import { expect, test } from 'claude-code/testing'

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
