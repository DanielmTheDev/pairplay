# pairplay relay

A tiny Cloudflare Worker that speaks the slice of ntfy pairplay uses, without
ntfy.sh's per-IP daily message quota. One Durable Object per room topic holds the
last 200 messages (12 h) and the open streams.

- `POST /<topic>`: publish the body
- `GET /<topic>/json?since=<id>`: NDJSON stream (open, missed messages, live ones, keepalive every 30 s)

## Deploy (once, free plan)

```sh
cd relay
npm install
npx wrangler login     # free Cloudflare account
npx wrangler deploy    # prints https://pairplay-relay.<you>.workers.dev
```

Then in both Claude sessions: `/coop relay https://pairplay-relay.<you>.workers.dev`
(or the host just shares the `/coop join CODE <url>` line it copies).

Free tier: 100k requests/day; a duel round is about 5. Anyone with the URL and a
room code can read that room, as with ntfy.sh.

## Develop

```sh
npm test               # pure core
npx wrangler dev       # local relay on http://127.0.0.1:8787
```
