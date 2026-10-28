import { expect, test } from 'claude-code/testing'

import { notifiers } from './notify'

test('notifiers: Linux, then macOS; text as arguments, never through a shell', async () => {
  const [linux, mac, ...rest] = notifiers('pairplay', 'round 1: "a" & b', false)
  expect(rest).toEqual([])
  expect(linux).toEqual({ argv: ['notify-send', '-a', 'pairplay', 'pairplay', 'round 1: "a" & b'] })
  expect(mac?.argv[0]).toBe('osascript')
  expect(mac?.argv.slice(-2)).toEqual(['pairplay', 'round 1: "a" & b'])
  expect(mac?.argv.slice(0, -2).join(' ')).not.toContain('round 1')
})

test('notifiers: Windows, a toast through PowerShell, the text in the environment', async () => {
  const [win, ...rest] = notifiers('pairplay', "it's $(evil)", true)
  expect(rest).toEqual([])
  expect(win?.argv[0]).toBe('powershell')
  expect(win?.argv.join(' ')).not.toContain('evil')
  expect(win?.env).toEqual({ PAIRPLAY_TITLE: 'pairplay', PAIRPLAY_TEXT: "it's $(evil)" })
})
