import { Env } from "../env.js";
import { getBangkokParts, isWithinWindow } from "../lib/time.js";
import { getPollingConfig } from "../domain/repository.js";
import { runPoll } from "../domain/poller.js";
import { deliverDueWebhooks } from "../domain/webhooks.js";
import { isOfficialDrawDate } from "../domain/draw-schedule.js";

export async function handleScheduled(env: Env): Promise<void> {
  const config = await getPollingConfig(env);
  const now = getBangkokParts();
  if (isOfficialDrawDate(now.date) && isWithinWindow(now.hhmm, config.start_time, config.end_time)) {
    await runPoll(env, {
      drawDate: now.date,
      hhmm: now.hhmm,
      hhmmss: now.hhmmss,
      source: "scheduled",
    });
  }
  await deliverDueWebhooks(env);
}
