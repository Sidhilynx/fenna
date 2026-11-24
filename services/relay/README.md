# Relay

The server that carries messages between Crew on a computer and the Fenna
phone app. There is one hub per computer. It passes sealed messages it can't
read, reports which phone is online, and sends the notifications that wake a
phone. It runs as a Cloudflare Worker at `wss://relay.sidhilynx.com`, and the
same hub runs on Node for development or for hosting your own.

The design is in [docs/plans/crew-mobile.md](../../docs/plans/crew-mobile.md)
(section B).

| File | What it is |
|---|---|
| `hub.js` | The hub's logic: the challenge and sign-in, allow lists, forwarding, presence, limits. Knows nothing about the platform |
| `worker.js` | The Cloudflare Worker and the `Hub` Durable Object: WebSockets and storage for `hub.js` |
| `server.mjs` | The same hub on Node (`ws`), with hubs kept in memory |
| `fcm.js` | Notifications through Firebase Cloud Messaging (HTTP v1) |
| `deploy.mjs` | Bundles `worker.js` and deploys it through Cloudflare's API, with the secret and the domain |
| `test/` | Tests for the Node server, the hub and FCM |

## What it stores

Only the hub id and, per hub, the list of paired phone ids and whether pairing
is open. It never stores message contents, and it logs none. A message is a
sealed blob that the computer and the phone share, and the relay only moves it.

## Running it locally

```sh
node services/relay/server.mjs 8787
```

Then start Crew with `FENNA_RELAY_URL=ws://127.0.0.1:8787`. Without a
service account the server answers push requests with "push is not set up",
so phones are not woken, but messages still pass.

## Deploying

Needs the same Cloudflare token as [services/usage](../usage/README.md), in
`~/.cloudflare/token.env` (`CF_KEY=…`), and the zone id in
`~/.cloudflare/zone.id`. Notifications also need
`~/.cloudflare/fcm-service-account.json`: a Firebase service account with the
Firebase Cloud Messaging API enabled. Without that file the deploy still
works, and notifications stay off until the file is added. Then:

```sh
node services/relay/deploy.mjs
```

It is safe to run again. The file is kept as the secret `FCM_SERVICE_ACCOUNT`
and never printed.
