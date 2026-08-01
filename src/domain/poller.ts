import { Env, publicBaseUrl } from "../env.js";
import { getBangkokParts, isWithinWindow, minuteMark, pollSlotKey } from "../lib/time.js";
import { isOfficialDrawDate } from "./draw-schedule.js";
import { evaluateConsensus, evaluateLiveResult } from "./consensus.js";
import { fetchProvider, ProviderName } from "./providers.js";
import {
  bumpDrawRevision,
  completePollRun,
  createPollRun,
  enqueueWebhook,
  ensureDraw,
  getDraw,
  getLatestProviderSnapshot,
  getPollingConfig,
  insertProviderAttempt,
  replaceProviderAttemptRows,
  updateDrawState,
  upsertResultRows,
} from "./repository.js";

export interface PollOptions {
  drawDate: string;
  hhmm: string;
  hhmmss?: string;
  source: "scheduled" | "opportunistic" | "manual" | "dry_run";
  dryRun?: boolean;
}

export async function runPoll(env: Env, options: PollOptions) {
  if ((options.source === "scheduled" || options.source === "opportunistic") && !isOfficialDrawDate(options.drawDate)) {
    return { skipped: true, reason: "Not an official draw date", draw_date: options.drawDate };
  }

  const config = await getPollingConfig(env);
  const providers = uniqueProviders(["sanook", ...(config.enabled_providers as ProviderName[])]);
  const providerOrder = uniqueProviders(["sanook", ...(config.provider_order as ProviderName[])]);
  const draw = await ensureDraw(env, options.drawDate);
  const mark = minuteMark(options.drawDate, options.hhmmss || options.hhmm);

  if (!options.dryRun) {
    const pollRun = await createPollRun(env, draw.id, options.drawDate, mark, options.source);
    if (!pollRun.inserted && (options.source === "scheduled" || options.source === "opportunistic")) {
      return { skipped: true, reason: "Poll run already exists", draw_date: options.drawDate, minute_mark: mark };
    }
    return runLockedPoll(env, pollRun.id, draw, options.drawDate, mark, providers, providerOrder, config.consensus_threshold);
  }

  const attempts = await Promise.all(providers.map((provider) => fetchProvider(provider, options.drawDate)));
  const decision = evaluateConsensus(attempts, providerOrder, config.consensus_threshold);
  const liveDecision = evaluateLiveResult(attempts, config.consensus_threshold, options.drawDate);
  return {
    dry_run: true,
    draw_date: options.drawDate,
    minute_mark: mark,
    decision,
    live_decision: {
      status: liveDecision.status,
      row_count: liveDecision.rows.length,
      confirmed_rows: liveDecision.rows.filter((row) => row.status === "confirmed").length,
      conflict_rows: liveDecision.rows.filter((row) => row.status === "conflict").length,
    },
  };
}

export async function refreshIfNeeded(env: Env, drawDate: string): Promise<void> {
  const config = await getPollingConfig(env);
  const now = getBangkokParts();
  if (!isOfficialDrawDate(drawDate)) return;
  if (now.date !== drawDate || !isWithinWindow(now.hhmm, config.start_time, config.end_time)) return;

  const draw = await getDraw(env, drawDate);
  const lastPollAt = draw?.last_poll_at ? new Date(draw.last_poll_at).getTime() : 0;
  if (Date.now() - lastPollAt < config.frequency_seconds * 1000) return;

  const key = pollSlotKey(now.date, now.secondsSinceMidnight, config.frequency_seconds);
  const slotSeconds = Number(key.split("-").at(-1) || "0") * Math.max(15, config.frequency_seconds);
  const hh = Math.floor(slotSeconds / 3600);
  const mm = Math.floor((slotSeconds % 3600) / 60);
  const ss = slotSeconds % 60;
  const hhmm = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const hhmmss = `${hhmm}:${String(ss).padStart(2, "0")}`;
  await runPoll(env, { drawDate, hhmm, hhmmss, source: "opportunistic" });
}

async function runLockedPoll(
  env: Env,
  pollRunId: string,
  draw: Awaited<ReturnType<typeof ensureDraw>>,
  drawDate: string,
  mark: string,
  providers: ProviderName[],
  providerOrder: ProviderName[],
  consensusThreshold: number,
) {
  try {
    const prePollStatus = draw.status === "pending" || draw.status === "polling" ? "polling" : draw.status;
    await updateDrawState(env, draw.id, prePollStatus, draw.first_provider, draw.confirmed_providers, draw.latest_signature, draw.conflict_message, true);

    const attempts = await Promise.all(providers.map((provider) => fetchProvider(provider, drawDate)));
    for (const attempt of attempts) {
      const attemptId = await insertProviderAttempt(env, pollRunId, draw.id, attempt);
      await replaceProviderAttemptRows(env, attemptId, draw.id, attempt);
    }

    let liveDecision = evaluateLiveResult(attempts, consensusThreshold, drawDate);
    if (liveDecision.rows.length === 0) {
      const latestSanook = await getLatestProviderSnapshot(env, draw.id, "sanook");
      if (latestSanook?.rows.length) {
        liveDecision = evaluateLiveResult(
          [latestSanook, ...attempts.filter((attempt) => attempt.provider !== "sanook")],
          consensusThreshold,
          drawDate,
        );
      }
    }
    const changedRows = await upsertResultRows(
      env,
      draw.id,
      liveDecision.rows.map((rowDecision) => ({
        row: rowDecision.row,
        provider: "sanook",
        providers: rowDecision.seenProviders,
        status: rowDecision.status,
      })),
    );

    const liveStateChanged = liveDecision.status !== "pending" && draw.status !== liveDecision.status;
    let updatedDraw = draw;
    if (changedRows > 0 || liveStateChanged) updatedDraw = await bumpDrawRevision(env, draw.id);

    if (liveDecision.status === "live" || liveDecision.status === "confirmed" || liveDecision.status === "conflict") {
      await updateDrawState(
        env,
        draw.id,
        liveDecision.status,
        liveDecision.firstProvider,
        liveDecision.confirmingProviders,
        liveDecision.signature,
        liveDecision.conflictMessage,
        true,
      );
      if (changedRows > 0 || liveStateChanged) {
        await enqueueWebhook(env, "result.updated", {
          draw_date: drawDate,
          revision: updatedDraw.revision,
          status: liveDecision.status,
          result_url: `${publicBaseUrl(env)}/v1/results/${drawDate}`,
        });
      }
      if ((changedRows > 0 || liveStateChanged) && (liveDecision.status === "confirmed" || liveDecision.status === "conflict")) {
        await enqueueWebhook(env, `result.${liveDecision.status}`, {
          draw_date: drawDate,
          revision: updatedDraw.revision,
          status: liveDecision.status,
          first_provider: liveDecision.firstProvider,
          confirming_providers: liveDecision.confirmingProviders,
          consensus_count: liveDecision.consensusCount,
          required_consensus: liveDecision.requiredConsensus,
          conflict_message: liveDecision.conflictMessage,
        });
      }
    }

    await completePollRun(env, pollRunId);
    return {
      draw_date: drawDate,
      minute_mark: mark,
      status: liveDecision.status,
      revision: updatedDraw.revision,
      changed_rows: changedRows,
      providers: attempts.map((attempt) => ({
        provider: attempt.provider,
        row_count: attempt.rows.length,
        complete: attempt.isComplete,
        source_date: attempt.sourceDate,
        message: attempt.message,
      })),
    };
  } catch (error) {
    await completePollRun(env, pollRunId, "failed");
    throw error;
  }
}

function uniqueProviders(providers: ProviderName[]): ProviderName[] {
  return [...new Set(providers)];
}
