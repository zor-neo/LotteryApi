# Cloudflare + Neon Design Notes

This rewrite keeps Neon Postgres unchanged and replaces only the long-running Node runtime.

## Runtime Responsibilities

- `fetch`: serves API requests and opportunistically refreshes Sanook during the draw window.
- `scheduled`: runs once per minute as a safety poller on official draw dates and as a webhook delivery loop.
- Neon: stores canonical draw state, result rows, provider attempts, parsed attempt rows, API keys, and webhook queues.

## Polling Model

Cloudflare Cron Triggers are not a 15-second scheduler. For 15-second draw-day freshness, consumers poll the API and the Worker uses the current 15-second slot as a database lock. Concurrent requests in the same slot reuse the same `poll_runs` uniqueness guard.

Polling is skipped unless the Bangkok date is an official draw date: the 1st and 16th of each month, except January 1 and May 1 move to January 2 and May 2.

## Database Compatibility

The Worker expects the same Postgres schema used by the current Node version, including:

- `draw_status` enum with `live`
- `draws.revision`
- `draws.last_poll_at`
- `provider_attempt_rows`

Apply `migrations/current-neon-schema.sql` once if the target Neon database does not already have those objects.
