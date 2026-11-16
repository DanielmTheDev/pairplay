// The rulebook, pure: pages of coloured lines, built from the game's own numbers so it
// never says what the game no longer does. The pane draws them (./register.tsx).

import type { Action, ChaosEvent, Element } from '../types'
import {
  AVATAR_COOLDOWN,
  AVATAR_HIT_COST,
  AVATAR_NEEDS,
  AVATAR_ROUNDS,
  CHAOS_BY,
  CHAOS_CHANCE,
  CHAOS_EVENTS,
  CHAOS_FROM,
  CHAOS_INFO,
  COST,
  DRAIN_COOLDOWN,
  HEAL_AMOUNT,
  HEAL_COOLDOWN,
  MAX_MANA,
  SHIELD_COOLDOWN,
  START_LIFE,
  START_MANA,
  prey,
} from './game'

export type Span = { text: string; color?: string; bold?: boolean; dim?: boolean }
export type RuleLine = Span[]
/** `art`: a drawing over the lines, the cards or the element wheel. */
export type RulePage = { title: string; art?: 'cards' | 'wheel'; lines: RuleLine[] }

/** Each event's icon and colour: the banner's frame, the rulebook's names. */
export const CHAOS_LOOK: Record<ChaosEvent, { icon: string; color: string }> = {
  blizzard: { icon: '❄', color: '#9fdcff' },
  lightning: { icon: '⚡', color: '#fff27a' },
  volcano: { icon: '🌋', color: '#ff7a1a' },
  eclipse: { icon: '🌑', color: '#ff6a3a' },
  rain: { icon: '🌧', color: '#8fc8ff' },
  quake: { icon: '🌍', color: '#c2a57a' },
  rift: { icon: '🌀', color: '#b06cff' },
  tornado: { icon: '🌪', color: '#d8dce8' },
}

const MANA = '#3de0f0'
const COOLDOWN = '#ff6b6b'
const LIFE = '#e8334a'
const GOLD = '#e8b830'
const INK = '#e9e6f6'
const COLOR: Record<Action, string> = {
  pass: '#b8b8c8',
  charge: '#ffe94a',
  shield: '#8ad8ff',
  drain: '#b85cff',
  heal: '#5cff8a',
  avatar: '#9ff0ff',
  fire: '#ff8c1f',
  water: '#5cc8ff',
  nature: '#7ad65a',
}

/** The cards the actions page draws, in the pane's order. */
export const RULE_CARDS: Action[] = ['fire', 'water', 'nature', 'drain', 'charge', 'shield', 'heal', 'avatar']

export const lineText = (l: RuleLine) => l.map(s => s.text).join('')

const gems = (n: number) => (n ? '◆'.repeat(n) : 'free')
const cooldown = (n: number): Span[] => [{ text: ` · ${n}-round cooldown`, color: COOLDOWN }]

function action(name: string, color: string, cost: number, what: string, cd?: number): RuleLine {
  return [{ text: name, color, bold: true }, { text: ' ' }, { text: gems(cost), color: MANA }, { text: ` ${what}`, dim: true }, ...(cd ? cooldown(cd) : [])]
}

function rule(label: string, what: string, color = INK): RuleLine {
  return [{ text: label, color, bold: true }, { text: ` ${what}`, dim: true }]
}

/** "water beats fire · fire beats nature · nature beats water", each in its colour. */
function wheel(reversed = false): RuleLine {
  const order: Element[] = reversed ? ['water', 'nature', 'fire'] : ['water', 'fire', 'nature']
  return order.flatMap((a, i) => [
    ...(i ? [{ text: ' · ', dim: true }] : []),
    { text: a, color: COLOR[a], bold: true },
    { text: ' beats ' },
    { text: prey(a, reversed), color: COLOR[prey(a, reversed)], bold: true },
  ])
}

export const RULE_PAGES: RulePage[] = [
  {
    title: 'Actions',
    art: 'cards',
    lines: [
      action('pass', COLOR.pass, COST.pass, 'nothing happens; you take any hit. Always allowed'),
      action('charge', COLOR.charge, COST.charge, `+1 mana (+2 in the Avatar State). Not at ${MAX_MANA} mana`),
      action('shield', COLOR.shield, COST.shield, 'blocks all damage and mana theft this round', SHIELD_COOLDOWN),
      [
        { text: 'fire', color: COLOR.fire, bold: true },
        { text: ' · ', dim: true },
        { text: 'water', color: COLOR.water, bold: true },
        { text: ' · ', dim: true },
        { text: 'nature', color: COLOR.nature, bold: true },
        { text: ' ' },
        { text: gems(COST.fire), color: MANA },
        { text: ' 1 damage if it lands. The dot on a card is what it beats', dim: true },
      ],
      action('drain', COLOR.drain, COST.drain, '1 damage and steals 1 mana; loses to any element', DRAIN_COOLDOWN),
      action('heal', COLOR.heal, COST.heal, `+${HEAL_AMOUNT} life, up to ${START_LIFE}; fizzles if you are hit`, HEAL_COOLDOWN),
      action('avatar', COLOR.avatar, COST.avatar, `needs ${AVATAR_NEEDS} mana; boosts you for ${AVATAR_ROUNDS} rounds (page 3)`, AVATAR_COOLDOWN),
    ],
  },
  {
    title: 'Clashes',
    art: 'wheel',
    lines: [
      wheel(),
      [{ text: `${CHAOS_LOOK.eclipse.icon} Eclipse`, color: CHAOS_LOOK.eclipse.color, bold: true }, { text: ' turns it round: ', dim: true }, ...wheel(true)],
      [],
      rule('element vs element', 'the winner deals 1 (2 from an avatar); same element, a tie'),
      rule('element vs drain', 'the element wins; no mana is stolen'),
      rule('element vs heal', 'it hits, and the heal fizzles'),
      rule('drain vs heal', 'the drain hits and steals; the heal fizzles'),
      rule('anything vs shield', 'blocked; a heal behind a shield still heals'),
      rule('anything vs charge or pass', 'it lands; a charge still gains its mana'),
      rule('heal vs heal', 'both heal'),
    ],
  },
  {
    title: 'Avatar',
    lines: [
      rule('enter', `at ${AVATAR_NEEDS} mana, costs ${gems(COST.avatar)}. You don't attack that round and take any hit, like a pass`, GOLD),
      rule('boost', `for ${AVATAR_ROUNDS} rounds every element costs ${gems(AVATAR_HIT_COST)} and hits for 1 more; short of that, it's cast plain`, GOLD),
      rule('charge', 'gives +2 mana', GOLD),
      rule('then', `${AVATAR_COOLDOWN} rounds of cooldown. A Time Rift ends the cooldown, never the Avatar State`, GOLD),
    ],
  },
  {
    title: 'Chaos',
    lines: [
      [
        {
          text: `From round ${CHAOS_FROM}, a 1 in ${Math.round(1 / CHAOS_CHANCE)} chance each round; at least one by round ${CHAOS_BY}, never two in a row. The same for both, never a hit.`,
          dim: true,
        },
      ],
      ...CHAOS_EVENTS.map(e => [
        { text: `${CHAOS_LOOK[e].icon} ${CHAOS_INFO[e].name}`, color: CHAOS_LOOK[e].color, bold: true },
        { text: ` ${CHAOS_INFO[e].effect}` },
      ]),
    ],
  },
  {
    title: 'Rounds',
    lines: [
      rule('1 pick', 'both pick in secret; you can change yours until the other has picked'),
      rule('2 reveal', 'both picks show at once, and mana is paid'),
      rule('3 clash', 'shields block, elements fight, drains steal, heals land or fizzle'),
      rule('4 chaos', 'now and then an event strikes, for the next round'),
      rule('5 cooldowns', 'count down by one'),
      [],
      [{ text: 'public ', bold: true }, { text: 'life', color: LIFE }, { text: ', ' }, { text: 'mana', color: MANA }, { text: ', ' }, { text: 'cooldowns', color: COOLDOWN }, { text: ', Avatar rounds, who has picked', dim: true }],
      rule('hidden', 'the pick itself, until both have picked'),
      rule('win', 'bring the other to 0 life'),
      rule('start · rematch', `${START_LIFE} life and ${START_MANA} mana each; no cooldowns, no chaos`),
    ],
  },
]

/** The actions by cost, for the help: "pass | charge | shield (0 mana) · …". */
const HELP_ORDER: Action[] = ['pass', 'charge', 'shield', 'fire', 'water', 'nature', 'drain', 'heal', 'avatar']
const byCost = [...new Set(HELP_ORDER.map(a => COST[a]))]
  .map(n => `${HELP_ORDER.filter(a => COST[a] === n).join(' | ')} (${n} mana${n === COST.avatar ? `, at ${AVATAR_NEEDS}` : ''})`)
  .join(' · ')

export const HELP = [
  '/coop host          create a room, share the code',
  '/coop join <code> [relay]  join the other player',
  '/coop relay [url]   show or switch the relay (both players)',
  '/coop say <text>    chat (or type in the pane)',
  `/coop <action>      ${byCost}`,
  '/coop rules         the rulebook (b in the pane)',
  '/coop rematch       new duel after one is won',
  '/coop leave         leave the room',
  '/coop               open the pane',
].join('\n')
