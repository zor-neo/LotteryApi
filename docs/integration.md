# LotteryApiCloudflare API Integration Guide

LotteryApiCloudflare is a draw-day Thai lottery result API. Sanook is the primary live source. Kapook and MyHora are support sources used to confirm or flag conflicts.

## Authentication

All result endpoints require an API key in the `x-api-key` header.

```bash
curl -H "x-api-key: YOUR_API_KEY" https://lottery-api-cloudflare.zorthiha-neo.workers.dev/v1/results/latest
```

## Recommended Consumer Flow

Use short polling as the canonical integration pattern. On draw day, poll every 5-15 seconds during the Bangkok draw window, then slow down after `status` becomes `confirmed`, `conflict`, or `failed`.

Official draw days are the 1st and 16th of each month, except January 1 and May 1 move to January 2 and May 2.

1. Call `GET /v1/results/latest` or `GET /v1/results/{drawDate}`.
2. Store the latest `draw_date` and `revision`.
3. Re-render or notify users only when `revision` increases.
4. Render each category independently using `received_count` and `expected_count`.
5. Treat `categories[].numbers[]` as append/update data; do not wait for the first prize or full 173-row completion.

For Telegram-like bots, send a message only when `revision` changes. Keep a per-chat or per-user cache of the last delivered `{ draw_date, revision }` so retries and repeated polls do not duplicate messages.

## Result Statuses

- `pending`: draw exists but no poll has produced rows yet.
- `polling`: worker is actively checking providers.
- `live`: Sanook rows are being published in real time and may still be incomplete.
- `confirmed`: Sanook result is complete and at least one support provider matches the required consensus.
- `conflict`: a support provider disagrees with Sanook for reported rows or complete result signature.
- `failed`: polling window ended without usable live rows.
- `provisional`: legacy status from earlier API versions; treat it like `live` if encountered.

## Result Response Shape

```json
{
  "api_version": "v1",
  "draw_date": "2026-07-16",
  "timezone": "Asia/Bangkok",
  "status": "live",
  "revision": 4,
  "last_poll_at": "2026-07-16T08:10:15.000Z",
  "primary_provider": "sanook",
  "confidence": {
    "first_provider": "sanook",
    "confirming_providers": ["sanook", "kapook"],
    "consensus_count": 2,
    "required_consensus": 2
  },
  "categories": [
    {
      "id": "prizeFirst",
      "label": "First Prize",
      "prize_amount": 6000000,
      "expected_count": 1,
      "received_count": 1,
      "numbers": [
        {
          "number": "123456",
          "source_provider": "sanook",
          "all_seen_providers": ["sanook", "kapook"],
          "first_seen_at": "2026-07-16T08:10:15.000Z",
          "status": "confirmed"
        }
      ]
    }
  ],
  "providers": [
    {
      "provider": "sanook",
      "status": "partial",
      "row_count": 12,
      "is_complete": false,
      "source_date": "2026-07-16",
      "last_checked_at": "2026-07-16T08:10:15.000Z",
      "message": "Incomplete rows: missing prizeSecond"
    }
  ],
  "updated_at": "2026-07-16T08:10:15.000Z"
}
```

## Rendering Rules

Display category progress as `received_count / expected_count`. Show empty categories as waiting, not as errors. For each number, prefer these labels:

- `live`: shown from Sanook and not yet confirmed by support providers.
- `confirmed`: seen by Sanook and enough support providers.
- `conflict`: keep visible, but show a warning and check the audit endpoint.

Use `providers[]` to show source health and `row_count` changes. Do not infer completion from row count alone; use `status` and per-category counts.

## Optional Webhooks

Webhooks are optional accelerators. Consumers must still be able to recover by polling the result endpoint.

`result.updated` is emitted when a row or draw state revision changes.

```json
{
  "event_type": "result.updated",
  "delivered_at": "2026-07-16T08:10:18.000Z",
  "data": {
    "draw_date": "2026-07-16",
    "revision": 4,
    "status": "live",
    "result_url": "https://lottery-api-cloudflare.zorthiha-neo.workers.dev/v1/results/2026-07-16"
  }
}
```

Webhook payloads are signed with `X-StandaloneLottery-Signature` using HMAC SHA-256 and the shared webhook secret.

## Endpoints

- `GET /v1/health`: public service and worker health.
- `GET /v1/results/latest`: latest draw result envelope.
- `GET /v1/results/{drawDate}`: result envelope for `YYYY-MM-DD`.
- `GET /v1/results/{drawDate}/audit`: provider attempts and parsed row snapshots for debugging.
