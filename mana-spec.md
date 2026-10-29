# Mana duel — specification

Status: implemented, playtesting.

Design goal: **no dominant strategy**. Every action is beaten by some other action, so winning is about reading the opponent.

## Basics

- 2 players, **3 life** each, **start with 1 mana**, **mana cap 3**.
- Each round both players pick **one action, simultaneously and hidden** (as today). The round resolves when both have picked.
- Elements keep today's cycle: **water > fire > nature > water**.

## Starting

- The duel starts as soon as both players are seated. Every player has every action, every game.

## Actions

| Action | Cost | Effect | Restriction |
|---|---|---|---|
| Pass | 0 | Nothing; takes any hit. So nobody is ever stuck with no legal action | — |
| Charge | 0 | +1 mana | Illegal at 3 mana |
| Shield | 0 | Blocks all damage and mana theft this round | 2-round cooldown |
| Fire / Water / Nature | 0 | 1 damage to the opponent if it lands. In the Avatar State: costs 1, deals 2; at 0 mana cast plain (free, 1) | — |
| Drain | 1 | No element. If it lands: 1 damage, and 1 mana moves from the opponent to you (the drainer is capped at 3) | 2-round cooldown |
| Heal | 1 | +2 life (max 3). Fizzles if you are hit this round | Illegal at 3 life. 7-round cooldown |
| Avatar State | 2 | No attack: takes any hit that round, like Pass. For the next 3 rounds, every element the avatar casts deals 1 more, and Charge gives +2 (capped at 3) | Needs 3 mana. Not while it holds; then a 3-round cooldown |

Costs are paid when the round resolves, whatever the outcome (blocked, tied or fizzled).

## Interaction matrix

"Spell" means any element or Drain cast. Each pair is listed once, and order doesn't matter.

| A | B | Result |
|---|---|---|
| Charge | Charge | Both +1 mana |
| Charge | Shield | A +1 mana. The shield is wasted |
| Charge | Element | A takes 1 (2 from an avatar) and still gains +1 mana |
| Charge | Drain | A gains +1 mana, then takes 1 damage and loses 1 mana to B (net: A −1 life, mana unchanged) |
| Charge | Heal | A +1 mana, B +2 life (max 3) |
| Shield | Shield | Nothing. Both shields go on cooldown |
| Shield | any spell | Blocked. B still pays the cost, and Drain still starts its cooldown |
| Shield | Heal | B +2 life (max 3) |
| Element | Element | Winning element deals 1 (2 from an avatar). Same element: tie, no damage |
| Element | Drain | The element always wins: B takes 1 (2 from an avatar). No theft |
| Element | Heal | B takes 1 (2 from an avatar). The heal fizzles |
| any | Avatar State entered | As against Pass: B takes whatever hits |
| Drain | Drain | Tie, no damage. Both go on cooldown |
| Drain | Heal | B takes 1 and loses 1 mana to A. The heal fizzles |
| Heal | Heal | Both +2 life (max 3) |

Property: **at most one player takes damage per round**, so a round can never end with both players dead (no draws).

## Resolution order

1. Pay costs.
2. Apply charges.
3. Apply damage. A heal that was hit fizzles. Otherwise apply the heal.
4. Apply Drain theft (only if Drain landed, and only if the target has mana left).
5. Update the Shield and Drain cooldowns.
6. Anyone at 0 life loses, and the game ends.

The mana cap can't be exceeded: charging at 3 is illegal, and a drainer has at most 2 mana after paying, so theft can't push them over 3.

## Timers

- **Shield cooldown**: if you shield in round *n*, you can't shield in rounds *n+1* and *n+2*. It's available again in *n+3* (round 1 → round 4).
- **Drain cooldown**: if you cast Drain in round *n*, you can't cast it in rounds *n+1* and *n+2*. It's available again in *n+3*. The cooldown starts whether the Drain landed, was blocked or tied.
- **Heal cooldown**: used in round *n* (landed or fizzled), back in *n+8*.
- **Avatar State**: entered in round *n*, it holds in rounds *n+1* to *n+3*, cools down in *n+4* to *n+6*, and can be entered again in *n+7*. A Time Rift ends the cooldown, never the Avatar State itself.

## Chaos events

Fair for both players, never a hit, never deciding a game on their own.

- **When**: decided by the host's dice as a round resolves, for the start of the next round. Never before round 3. From then on a 1 in 4 chance each round; if none has struck by round 6, one strikes then. Never two rounds running, never while a lasting one holds. So a game can have one or many.
- **Which**: one of eight, at random, the same one possibly again.

| Event | Effect | Lasts |
|---|---|---|
| Blizzard | Both drop to 0 mana | — |
| Lightning Storm | Both go to 3 mana | — |
| Volcano Eruption | Fire, Water and Nature hit for 1 more (stacks with the Avatar State) | 2 rounds |
| Eclipse | Elements beat each other the other way: fire > water > nature > fire | 2 rounds |
| Healing Rain | Both +1 life (max 3) | — |
| Earthquake | No Shield this round | 1 round |
| Time Rift | Every cooldown back to 0 (an Avatar State holds on) | — |
| Tornado | Both get the average of their mana, rounded up | — |

- Each event plays its world animation after the round that brought it (snow, storm, eruption, eclipse, rain, quake, rift, tornado), then its effect on the players (gems freezing and shattering, bolts lighting them, embers in the staffs, the element ring turning back, hearts refilling, shields cracking, time streaming in, mana whirling across). Life and mana change on that cue.
- The pane announces it with its name and effect, and how many rounds a lasting one has left; the log keeps it.

## Legality and visibility

- The host rejects illegal intents: not enough mana, charging at 3 mana, shielding on cooldown or in an earthquake, Drain on cooldown, healing at 3 life, the Avatar State below 3 mana, while it holds or on cooldown, and any action before both are seated. The UI greys these actions out.
- **Public**: life, mana, every cooldown, the Avatar State's rounds left, and whether each player has picked. **Hidden until resolve**: the pick itself.
- After resolving, both picks are revealed, as today.
- Rematch resets both players to 3 life and 1 mana, with no cooldowns, no Avatar State and no chaos.

## Open balance questions (for playtesting)

1. **Avatar State timing.** It costs a turn of no attack at full mana. Do the 3 boosted rounds pay that back, or does the opponent just shield through them?
2. **Charging risk.** Getting hit for 2 by an avatar's element while charging may be too punishing at 3 life. Do players stop charging?
3. **Drain strength.** It's a 1-mana hit plus a mana swing against charging. Is the 2-round cooldown enough to keep it from being picked every time it's available?
4. **Heal stalling.** Shield, charge, charge, heal... does the game drag on? Count rounds per game.
5. **Forced picks.** At 3 mana with Shield on cooldown, a player can only cast or heal. Does that make them too easy to read?
6. **Opening.** Round 1: both players have 1 mana and no locks. Is there an obviously best first move?

Track per game: the number of rounds, the winner, and how often each action was picked. If one action is picked in more than 40% of turns, or never, rebalance it.
