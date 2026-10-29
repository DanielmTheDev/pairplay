# pairplay

Two-player co-op link between Claude Code sessions. Each player runs their own
Claude Code; the mod connects them through a room code and shows a live pane
with presence and chat. The game itself is built on top of this link (coming).

## Install

At the prompt of a Claude Code terminal session:

```
/plugin install pairplay --marketplace DanielmTheDev/pairplay
```

Answer `y` to add the marketplace, pick the user scope. From a shell instead:

```
claude plugin install pairplay --marketplace DanielmTheDev/pairplay
```

Update later: `/plugin update pairplay`, then `/reload-plugins`.

Needs `curl` on the PATH (it holds the live connection to the relay).

Relay: the pairplay Cloudflare Worker (`relay/`, deployed at
https://pairplay-relay.dadamuck.workers.dev) by default. `/coop relay <url>`
switches, e.g. to `https://ntfy.sh` (which caps messages per IP per day) or your
own deploy (`relay/README.md`); the host's `/coop host` then copies a
`/coop join CODE <url>` line for the other player.

## Play

| Player 1 | Player 2 |
| --- | --- |
| `/coop host` → room code shown and copied | |
| send the code to player 2 | `/coop join ABCD-EFGH` |
| chat: type in the pane, or `/coop say hi` | same |
| duel: `/coop charge`, `/coop fire` … (or the pane cards) | `/coop shield` |

Mana duel (full rules: `mana-spec.md`). 3 life, start with 1 mana, cap 3.

The duel starts once both are in the room. Both pick one action a round in
secret (changeable until the other has picked):

| Action | Cost | Effect | Key |
| --- | --- | --- | --- |
| pass (basic) | 0 | nothing, takes any hit: for when no other move is left | p |
| charge (basic) | 0 | +1 mana (not at 3) | c |
| shield (basic) | 0 | blocks all damage and theft; 2-round cooldown (round 1 → back in round 4) | s |
| heal (basic) | 1 | +2 life (max 3), fizzles if hit; 7-round cooldown | h |
| fire / water / nature | 1 | 1 damage; water > fire > nature > water | 1-3 |
| drain | 1 | 1 damage + steals 1 mana; loses to any element; 2-round cooldown | d |
| avatar | 2 | needs a full 3 mana. The Avatar State, for the next 3 rounds: every element costs 1 and hits for 1 more (at 0 mana it is cast plain, free), charge gives 2. Entering it takes any hit, like a pass. Then 3 rounds cooldown | a |

**Chaos.** From round 3 on, the world strikes now and then (a 1 in 4 chance a
round, at least once by round 6, never two rounds running): the same for both
players and never a hit. Each plays its own animation after the round, then
what it does, and a banner in the pane names it:

| Event | Effect |
| --- | --- |
| ❄ Blizzard | both drop to 0 mana |
| ⚡ Lightning Storm | both at 3 mana |
| 🌋 Volcano Eruption | fire, water and nature hit for 1 more, for 2 rounds |
| 🌑 Eclipse | the elements turn round, fire > water > nature > fire, for 2 rounds |
| 🌧 Healing Rain | both +1 life |
| 🌍 Earthquake | no shield that round |
| 🌀 Time Rift | every cooldown is reset (an Avatar State holds on) |
| 🌪 Tornado | the mana whirls together: both get the average, rounded up |

At most one player is hit per round. Each round, once it has played, goes to
the log (its last two lines right under the cards) and raises a system
notification: `notify-send` on Linux, `osascript` on macOS, a toast through
PowerShell on Windows; failing those, the terminal's notification, then a toast. At 0 life the other wins and the game's
stats (rounds, how often each action was picked, ⚠ over 40%) go to the log;
a rematch card (or `/coop rematch`) starts over. The host's session is the referee: it holds the
picks, rejects illegal ones, and decides every round. Each action has an
animated card in the pane with its mana cost; the one under the pointer lights
up, greyed cards are not allowed right now, and a red number on one counts the
rounds of cooldown left.

In a terminal the pane draws the duel under a night sky: two pixel-art wizards
(host left in blue, guest right in crimson), hearts for lives, mana crystals
in the ground, your own pick as an icon over your head (the other player sees a
rune). Each round plays out: fireballs, torrents, ground vines and violet drains
clash mid-stage (an avatar's blaze bigger), shields catch them, charges pull
in mana, heals sparkle, the winning spell hits home. An Avatar State enters with
a white flash and rocks breaking out of the ground; for its three rounds the
wizard floats, bobbing softly, eyes and arrow tattoo aglow inside a sphere of
water, fire, earth and air, and comes down when it ends. The last hit kills: the loser topples into a lot of blood, the winner
strikes a victory pose. Needs a truecolor terminal.

`/coop` opens the pane, `/coop leave` leaves the room. The status line shows
the room and how many peers are connected.

## How it works

Messages go through an [ntfy](https://ntfy.sh) relay: one `curl` stream per
player receives pushes, sends are plain HTTP POSTs. The topic is derived from
the room code (~40 bits), so whoever knows the code can read the room — don't
send secrets.

ntfy.sh limits free use per IP. If many players share one network and sends
fail with HTTP 429, run your own relay and point both players at it:

```
docker run -p 8080:80 binwiederhier/ntfy serve
cloudflared tunnel --url http://localhost:8080
```

Then `/config` → pairplay → Relay URL = the tunnel's `https://….trycloudflare.com`.

## Develop

Run from a checkout instead of the installed copy (disable that one first:
`claude plugin disable pairplay@pairplay`). Saving a file hot-reloads the mod.
To test both players on one machine, give each terminal its own name:

```
USER=alice claude --plugin-dir ~/git/pairplay
USER=bob claude --plugin-dir ~/git/pairplay
```

The name comes from the Player name option, else `$USER`.

Checks: `claude plugin validate .`, `claude plugin test .`, `tsc -p .`.

## License

MIT
