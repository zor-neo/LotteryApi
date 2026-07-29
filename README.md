# Lottery API Cloudflare

Cloudflare-native lottery result API. The API runs on Cloudflare Workers and keeps Neon Postgres as the database.

## Project Overview

This project provides a simple API service for Thai lottery results.

- It checks lottery result pages only on official draw dates.
- Sanook is the main live source.
- Kapook and MyHora are used to confirm results.
- Other apps call this API with an `x-api-key`.
- The developer console shows the same live result output that consumer apps receive.
- The frontend is only for developers, not for public lottery users.

## Architecture

```text
Cloudflare Worker
  - GET /v1/health
  - GET /v1/results/latest
  - GET /v1/results/:drawDate
  - GET /v1/results/:drawDate/audit
  - POST /v1/admin/poll/run
  - POST /v1/admin/poll/dry-run

Cloudflare Cron Trigger
  - backup poll once per minute during draw window on official draw dates
  - webhook delivery retry loop

Neon Postgres
  - existing result, audit, API key, webhook tables
```

Sanook is the primary live source. Kapook and MyHora are support sources for confirmation and conflict detection.

Official draw dates are the 1st and 16th of each month, except January 1 and May 1 move to January 2 and May 2.

## Why This Design

Cloudflare Workers do not run forever, so there is no `setInterval()` worker. Real-time behavior is handled by:

- Cron backup polling every minute only on official draw dates.
- Opportunistic refresh when consumers call result endpoints during draw time.
- `POLL_FREQUENCY_SECONDS=15` to prevent more than one refresh per 15-second slot.

This keeps the API serverless and free-tier friendly while still allowing near-real-time draw-day output when consumers are actively polling.

## Setup

Install dependencies:

```bash
npm install
```

Create Worker secrets:

```bash
npx wrangler secret put DATABASE_URL
npx wrangler secret put DEFAULT_API_KEY
npx wrangler secret put WEBHOOK_SECRET
```

For local development, create `.dev.vars`:

```text
DATABASE_URL=postgresql://...
DEFAULT_API_KEY=change-me
WEBHOOK_SECRET=change-me
PUBLIC_BASE_URL=http://localhost:8787
```

If using a fresh Neon database, apply:

```text
migrations/current-neon-schema.sql
```

## Run

```bash
npm run dev
```

Test:

```bash
curl http://localhost:8787/v1/health
curl -H "x-api-key: change-me" http://localhost:8787/v1/results/latest
```

Deploy:

```bash
npm run deploy
```

Deployed Worker URL:

```text
https://lottery-api-cloudflare.zorthiha-neo.workers.dev
```

The root path returns API metadata JSON. The developer console is served separately at:

```text
https://lottery-api-cloudflare.zorthiha-neo.workers.dev/console
```

## Consumer Guidance

Consumers should poll:

```text
GET /v1/results/latest
```

every 5-15 seconds during draw time and render only when `revision` increases.

Webhook event `result.updated` is optional. Consumers must still be able to recover by polling the canonical result endpoint.

## Developer Frontend

The developer console is served by the same Worker at:

```text
https://lottery-api-cloudflare.zorthiha-neo.workers.dev/console
```

It polls the live Worker API with `x-api-key`, watches `revision`, and renders prize rows exactly as API consumers should render them.

Open locally:

```text
frontend/index.html
```

The browser stores the pasted API key in local storage for developer convenience. Do not use this as an end-user public lottery page.
