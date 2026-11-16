import { expect, test } from 'claude-code/testing'

import { AVATAR_COOLDOWN, AVATAR_ROUNDS, CHAOS_EVENTS, CHAOS_INFO, DRAIN_COOLDOWN, HEAL_COOLDOWN, SHIELD_COOLDOWN } from './game'
import { CHAOS_LOOK, HELP, RULE_PAGES, lineText } from './rules'

const page = (title: string) => {
  const p = RULE_PAGES.find(p => p.title === title)
  if (!p) throw new Error(`no page ${title}`)
  return p.lines.map(lineText)
}
const line = (title: string, re: RegExp) => page(title).find(l => re.test(l))

test('rules: five pages, in reading order', async () => {
  expect(RULE_PAGES.map(p => p.title)).toEqual(['Actions', 'Clashes', 'Avatar', 'Chaos', 'Rounds'])
  expect(RULE_PAGES.find(p => p.title === 'Actions')?.art).toBe('cards')
  expect(RULE_PAGES.find(p => p.title === 'Clashes')?.art).toBe('wheel')
})

test('rules: actions page shows every action, its cost from the game and its cooldown', async () => {
  expect(line('Actions', /^pass/)).toMatch(/free/)
  expect(line('Actions', /^charge/)).toMatch(/free/)
  // The elements cost 1: one mana gem, never "free".
  const elements = line('Actions', /^fire · water · nature/)
  expect(elements).toMatch(/◆ /)
  expect(elements).not.toMatch(/free|◆◆/)
  expect(line('Actions', /^shield/)).toMatch(new RegExp(`${SHIELD_COOLDOWN}-round cooldown`))
  expect(line('Actions', /^drain/)).toMatch(new RegExp(`${DRAIN_COOLDOWN}-round cooldown`))
  expect(line('Actions', /^heal/)).toMatch(new RegExp(`${HEAL_COOLDOWN}-round cooldown`))
  expect(line('Actions', /^avatar/)).toMatch(/◆◆ /)
  expect(line('Actions', /^avatar/)).toMatch(new RegExp(`${AVATAR_COOLDOWN}-round cooldown`))
})

test('rules: clashes page names the element wheel', async () => {
  expect(page('Clashes').join('\n')).toMatch(/water beats fire.*fire beats nature.*nature beats water/)
  expect(page('Clashes').join('\n')).toMatch(/Eclipse/)
})

test('rules: avatar page uses the game numbers', async () => {
  const text = page('Avatar').join('\n')
  expect(text).toMatch(new RegExp(`${AVATAR_ROUNDS} rounds`))
  expect(text).toMatch(/costs ◆◆/)
})

test('rules: chaos page lists every event with its effect, in its colour', async () => {
  const lines = RULE_PAGES.find(p => p.title === 'Chaos')!.lines
  for (const e of CHAOS_EVENTS) {
    const l = lines.find(l => lineText(l).includes(CHAOS_INFO[e].name))
    expect(l).toBeDefined()
    expect(lineText(l!)).toContain(CHAOS_INFO[e].effect)
    expect(l![0]).toMatchObject({ text: `${CHAOS_LOOK[e].icon} ${CHAOS_INFO[e].name}`, color: CHAOS_LOOK[e].color })
  }
})

test('help: costs come from the game, the rulebook is named', async () => {
  expect(HELP).not.toMatch(/free/)
  expect(HELP).toMatch(/fire \| water \| nature \| drain \| heal \(1 mana\)/)
  expect(HELP).toMatch(/\/coop rules/)
})
