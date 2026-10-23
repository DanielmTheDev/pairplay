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

## Play

| Player 1 | Player 2 |
| --- | --- |
| `/coop host` → room code shown and copied | |
| send the code to player 2 | `/coop join ABCD-EFGH` |
| chat: type in the pane, or `/coop say hi` | same |

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
