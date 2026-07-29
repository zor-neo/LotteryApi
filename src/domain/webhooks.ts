import { Env } from "../env.js";
import { query } from "../db/sql.js";
import { signHmacHex } from "../lib/crypto.js";

export async function deliverDueWebhooks(env: Env, limit = 10) {
  if (!env.WEBHOOK_SECRET) return 0;

  const deliveries = await query<{
    id: string;
    event_type: string;
    payload: unknown;
    retry_count: number;
    url: string;
  }>(
    env,
    `SELECT d.id, d.event_type, d.payload, d.retry_count, s.url
     FROM webhook_deliveries d
     JOIN webhook_subscriptions s ON s.id = d.subscription_id
     WHERE d.status IN ('pending','retrying')
       AND d.next_attempt_at <= now()
       AND s.active = true
     ORDER BY d.created_at ASC
     LIMIT $1`,
    [limit],
  );

  for (const delivery of deliveries) {
    await deliverOne(env, delivery);
  }

  return deliveries.length;
}

async function deliverOne(
  env: Env,
  delivery: {
    id: string;
    event_type: string;
    payload: unknown;
    retry_count: number;
    url: string;
  },
) {
  const payload = JSON.stringify({
    event_type: delivery.event_type,
    delivered_at: new Date().toISOString(),
    data: delivery.payload,
  });
  const signature = await signHmacHex(env.WEBHOOK_SECRET || "", payload);

  try {
    const response = await fetch(delivery.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-StandaloneLottery-Signature": signature,
      },
      body: payload,
    });
    const responseBody = await response.text();
    if (response.ok) {
      await query(
        env,
        `UPDATE webhook_deliveries
         SET status = 'delivered', response_code = $2, response_body = $3, delivered_at = now()
         WHERE id = $1`,
        [delivery.id, response.status, responseBody.slice(0, 2000)],
      );
    } else {
      await scheduleRetry(env, delivery.id, delivery.retry_count, response.status, responseBody);
    }
  } catch (error) {
    await scheduleRetry(env, delivery.id, delivery.retry_count, null, error instanceof Error ? error.message : "Unknown delivery error");
  }
}

async function scheduleRetry(env: Env, deliveryId: string, retryCount: number, responseCode: number | null, responseBody: string) {
  const nextRetry = retryCount + 1;
  const status = nextRetry >= 5 ? "failed" : "retrying";
  const delayMinutes = Math.min(60, 2 ** nextRetry);
  await query(
    env,
    `UPDATE webhook_deliveries
     SET status = $2, response_code = $3, response_body = $4, retry_count = $5,
         next_attempt_at = now() + ($6 || ' minutes')::interval
     WHERE id = $1`,
    [deliveryId, status, responseCode, responseBody.slice(0, 2000), nextRetry, delayMinutes],
  );
}
