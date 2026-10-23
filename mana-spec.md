# Mana duel — specification

Status: implemented, playtesting.

Design goal: **no dominant strategy**. Every action is beaten by some other action, so winning is about reading the opponent.

## Basics

- 2 players, **3 life** each, **start with 1 mana**, **mana cap 3**.
- Each round both players pick **one action, simultaneously and hidden** (as today). The round resolves when both have picked.
- Elements keep today's cycle: **water > fire > nature > water**.

## Actions

| Action | Cost | Effect | Restriction |
|---|---|---|---|
| Charge | 0 | +1 mana | Illegal at 3 mana |
| Super charge | 0 | +2 mana (capped at 3) | Illegal at 3 mana. 5-round cooldown |
| Shield | 0 | Blocks all damage and mana theft this round | Illegal if you shielded last round |
| Fire / Water / Nature (basic) | 1 | 1 damage to the opponent if it lands | — |
| Empowered Fire / Water / Nature | 2 | 2 damage if it lands. Wins a same-element clash against a basic spell, for 1 damage | — |
| Drain | 1 | No element. If it lands: 1 damage, and 1 mana moves from the opponent to you (2 from a super charger; the drainer is capped at 3) | 2-round cooldown |
| Heal | 1 | +2 life (max 3). Fizzles if you are hit this round | Illegal at 3 life. 1-round cooldown |

Costs are paid when the round resolves, whatever the outcome (blocked, tied or fizzled).

## Interaction matrix

"Spell" means any basic, empowered or Drain cast. Each pair is listed once, and order doesn't matter.

| A | B | Result |
|---|---|---|
| Charge | Charge | Both +1 mana |
| Charge | Shield | A +1 mana. The shield is wasted |
| Charge | Basic | A takes 1 and still gains +1 mana |
| Charge | Empowered | A takes 2 and still gains +1 mana |
| Charge | Drain | A gains +1 mana, then takes 1 damage and loses 1 mana to B (net: A −1 life, mana unchanged) |
| Charge | Heal | A +1 mana, B +2 life (max 3) |
| Super charge | Drain | A gains +2 (cap 3), then takes 1 and loses 2 mana to B |
| Shield | Shield | Nothing. Both are shield-locked next round |
| Shield | any spell | Blocked. B still pays the cost, and Drain still starts its cooldown |
| Shield | Heal | B +2 life (max 3) |
| Basic | Basic | Winning element deals 1. Same element: tie, no damage |
| Basic | Empowered | Different elements: the winner deals its own damage (basic 1, empowered 2). Same element: the empowered spell wins and deals 1 |
| Empowered | Empowered | Winning element deals 2. Same element: tie, no damage |
| Basic / Empowered | Drain | The element always wins: B takes 1 or 2. No theft |
| Basic / Empowered | Heal | B takes 1 or 2. The heal fizzles |
| Drain | Drain | Tie, no damage. Both go on cooldown |
| Drain | Heal | B takes 1 and loses 1 mana to A. The heal fizzles |
| Heal | Heal | Both +2 life (max 3) |

Property: **at most one player takes damage per round**, so a round can never end with both players dead (no draws).

## Resolution order

1. Pay costs.
2. Apply charges.
3. Apply damage. A heal that was hit fizzles. Otherwise apply the heal.
4. Apply Drain theft (only if Drain landed, and only if the target has mana left).
5. Update the shield lock and the Drain cooldown.
6. Anyone at 0 life loses, and the game ends.

The mana cap can't be exceeded: charging at 3 is illegal, and a drainer has at most 2 mana after paying, so theft can't push them over 3.

## Timers

- **Shield lock**: if you shield in round *n*, you can't shield in round *n+1*.
- **Drain cooldown**: if you cast Drain in round *n*, you can't cast it in rounds *n+1* and *n+2*. It's available again in *n+3*. The cooldown starts whether the Drain landed, was blocked or tied.
- **Super charge cooldown**: used in round *n*, back in *n+6*.
- **Heal cooldown**: used in round *n* (landed or fizzled), back in *n+2*.

## Legality and visibility

- The host rejects illegal intents: not enough mana, charging at 3 mana, shielding while locked, Drain on cooldown, healing at 3 life. The UI greys these actions out.
- **Public**: life, mana, shield lock, Drain cooldown, and whether each player has picked. **Hidden until resolve**: the pick itself.
- After resolving, both picks are revealed, as today.
- Rematch resets both players to 3 life and 1 mana, with no locks and no cooldowns.

## Open balance questions (for playtesting)

1. **Empowered vs basic.** With 2+ mana, empowered spells are never worse than basic ones in a clash. Is basic still worth casting just because it's cheaper?
2. **Charging risk.** Getting hit for 2 by an empowered spell while charging may be too punishing at 3 life. Do players stop charging?
3. **Drain strength.** It's a 1-mana hit plus a mana swing against charging. Is the 2-round cooldown enough to keep it from being picked every time it's available?
4. **Heal stalling.** Shield, charge, charge, heal... does the game drag on? Count rounds per game.
5. **Forced picks.** At 3 mana with shield locked, a player can only cast or heal. Does that make them too easy to read?
6. **Opening.** Round 1: both players have 1 mana and no locks. Is there an obviously best first move?

Track per game: the number of rounds, the winner, and how often each action was picked. If one action is picked in more than 40% of turns, or never, rebalance it.
