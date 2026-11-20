# Usage counts receiver

The server side of the Fenna apps' anonymous usage counts and feedback
([PRIVACY.md](../../PRIVACY.md#usage-counts)). It runs as a Cloudflare Worker at
`https://usage.sidhilynx.com` with one D1 (SQLite) database.

| File | What it is |
|---|---|
| `worker.js` | The Worker: checks each ping and feedback message against the fields PRIVACY.md lists, stores them, and serves the owner's dashboard |
| `schema.sql` | The two tables, `pings` (one row per install, app and day) and `feedback` |
| `deploy.mjs` | Creates or updates the database, schema, Worker, dashboard key and domain through Cloudflare's API |

## What it stores

Exactly the fields in PRIVACY.md, plus the time the server received them.
It never reads the request's IP address or other headers, and unknown count
names are dropped. Anything that doesn't match the format gets a `400` with a
reason and is not stored.

## Endpoints

- `POST /v1/ping`: one install's counts for one finished day. Sending the same
  day again replaces it.
- `POST /v1/feedback`: a rating (`up`, `down` or `null`) and up to 1000
  characters of text; at most 10 per install a day.
- `GET /dash?key=…`: the owner's dashboard. The key sets a cookie, then `/dash`
  works on its own. Without it the page answers "Not found".

## Deploying

Needs a Cloudflare API token with Workers Scripts, D1 and DNS edit rights,
in `~/.cloudflare/token.env` (`CF_KEY=…`), and the zone id of the domain in
`~/.cloudflare/zone.id`. Then:

```sh
node services/usage/deploy.mjs
```

It is safe to run again. The first run makes the dashboard key and writes the
dashboard link to `~/.cloudflare/dashboard-link.txt`; keep that file private.
