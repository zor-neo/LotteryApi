import { Env, runtimeNumber } from "../env.js";
import { one, query } from "../db/sql.js";
import { sha256Hex } from "../lib/crypto.js";
import { ProviderName, ProviderParseResult } from "./providers.js";
import { ApiResultCategory, ApiResultNumber, DrawStatus, PollingConfig } from "./types.js";
import {
  CanonicalResultRow,
  PRIZE_AMOUNTS,
  PRIZE_CATEGORY_EXPECTED_WINNERS,
  PRIZE_CATEGORY_ORDER,
  PRIZE_LABELS,
} from "./prizes.js";

export interface DrawRecord {
  id: string;
  draw_date: string | Date;
  status: DrawStatus;
  first_provider: ProviderName | null;
  confirmed_providers: ProviderName[];
  conflict_message: string | null;
  latest_signature: string | null;
  revision: number;
  last_poll_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ApiResultEnvelope {
  api_version: "v1";
  draw_date: string | null;
  timezone: string;
  status: DrawStatus | "not_found";
  revision: number;
  last_poll_at: string | null;
  refresh_error?: string | null;
  primary_provider: ProviderName;
  confidence: {
    first_provider: ProviderName | null;
    confirming_providers: ProviderName[];
    consensus_count: number;
    required_consensus: number;
  };
  categories: ApiResultCategory[];
  providers: Array<{
    provider: ProviderName;
    status: "complete" | "partial" | "error" | "not_run";
    row_count: number;
    is_complete: boolean;
    source_date: string | null;
    last_checked_at: string | null;
    message: string | null;
  }>;
  updated_at: string | null;
}

export interface SchemaReadiness {
  status: "ok" | "needs_migration" | "error";
  missing: string[];
  checks: {
    draws_revision: boolean;
    draws_last_poll_at: boolean;
    result_rows_status: boolean;
    provider_attempt_rows: boolean;
    draw_status_live: boolean;
  };
  message: string;
}

export async function getPollingConfig(env: Env): Promise<PollingConfig> {
  const row = await one<PollingConfig>(env, "SELECT * FROM polling_config WHERE id = true").catch(() => null);
  return {
    timezone: "Asia/Bangkok",
    start_time: env.POLL_START_TIME || row?.start_time || "14:30",
    end_time: env.POLL_END_TIME || row?.end_time || "18:00",
    frequency_seconds: runtimeNumber(env.POLL_FREQUENCY_SECONDS, row?.frequency_seconds || 15),
    enabled_providers: row?.enabled_providers?.length ? row.enabled_providers : ["sanook", "kapook", "myhora"],
    provider_order: row?.provider_order?.length ? row.provider_order : ["sanook", "kapook", "myhora"],
    consensus_threshold: runtimeNumber(env.CONSENSUS_THRESHOLD, row?.consensus_threshold || 2),
    retention_days: row?.retention_days || 365,
  };
}

export async function findApiKey(env: Env, apiKey: string) {
  const keyHash = await sha256Hex(apiKey);
  const row = await one<{ id: string; label: string; rate_limit_per_minute: number }>(
    env,
    "SELECT id, label, rate_limit_per_minute FROM api_keys WHERE key_hash = $1 AND active = true",
    [keyHash],
  );
  if (row) await query(env, "UPDATE api_keys SET last_used_at = now() WHERE id = $1", [row.id]);
  return row;
}

export async function getSchemaReadiness(env: Env): Promise<SchemaReadiness> {
  try {
    const columnRows = await query<{ table_name: string; column_name: string }>(
      env,
      `SELECT table_name, column_name
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND ((table_name = 'draws' AND column_name IN ('revision', 'last_poll_at'))
           OR (table_name = 'result_rows' AND column_name = 'status'))`,
    );
    const tableRows = await query<{ exists: boolean }>(env, "SELECT to_regclass('public.provider_attempt_rows') IS NOT NULL AS exists");
    const enumRows = await query<{ enumlabel: string }>(
      env,
      `SELECT e.enumlabel
       FROM pg_enum e
       JOIN pg_type t ON t.oid = e.enumtypid
       WHERE t.typname = 'draw_status'
         AND e.enumlabel = 'live'`,
    );

    const columnSet = new Set(columnRows.map((row) => `${row.table_name}.${row.column_name}`));
    const checks = {
      draws_revision: columnSet.has("draws.revision"),
      draws_last_poll_at: columnSet.has("draws.last_poll_at"),
      result_rows_status: columnSet.has("result_rows.status"),
      provider_attempt_rows: tableRows[0]?.exists === true,
      draw_status_live: enumRows.some((row) => row.enumlabel === "live"),
    };
    const missing = Object.entries(checks)
      .filter(([, present]) => !present)
      .map(([name]) => name);

    return {
      status: missing.length ? "needs_migration" : "ok",
      missing,
      checks,
      message: missing.length
        ? "Apply migrations/current-neon-schema.sql to Neon before draw-day polling."
        : "Database schema is ready for live draw-day polling.",
    };
  } catch (error) {
    return {
      status: "error",
      missing: ["schema_check_failed"],
      checks: {
        draws_revision: false,
        draws_last_poll_at: false,
        result_rows_status: false,
        provider_attempt_rows: false,
        draw_status_live: false,
      },
      message: error instanceof Error ? error.message : "Schema readiness check failed",
    };
  }
}

export async function ensureDraw(env: Env, drawDate: string): Promise<DrawRecord> {
  const row = await one<DrawRecord>(
    env,
    `INSERT INTO draws (draw_date, status)
     VALUES ($1, 'pending')
     ON CONFLICT (draw_date) DO UPDATE SET updated_at = draws.updated_at
     RETURNING *`,
    [drawDate],
  );
  if (!row) throw new Error("Failed to ensure draw");
  return row;
}

export async function getDraw(env: Env, drawDate: string): Promise<DrawRecord | null> {
  return one<DrawRecord>(env, "SELECT * FROM draws WHERE draw_date = $1", [drawDate]);
}

export async function getLatestDraw(env: Env): Promise<DrawRecord | null> {
  return one<DrawRecord>(env, "SELECT * FROM draws ORDER BY draw_date DESC LIMIT 1");
}

export async function createPollRun(
  env: Env,
  drawId: string,
  drawDate: string,
  mark: string,
  source: string,
): Promise<{ id: string; inserted: boolean }> {
  const row = await one<{ id: string; inserted: boolean }>(
    env,
    `WITH inserted AS (
       INSERT INTO poll_runs (draw_id, draw_date, minute_mark, source, status)
       VALUES ($1, $2, $3, $4, 'running')
       ON CONFLICT (draw_date, minute_mark) DO NOTHING
       RETURNING id, true AS inserted
     )
     SELECT id, inserted FROM inserted
     UNION ALL
     SELECT id, false AS inserted FROM poll_runs WHERE draw_date = $2 AND minute_mark = $3
     LIMIT 1`,
    [drawId, drawDate, mark, source],
  );
  if (!row) throw new Error("Failed to create poll run");
  return row;
}

export async function completePollRun(env: Env, pollRunId: string, status = "complete") {
  await query(env, "UPDATE poll_runs SET status = $2, completed_at = now() WHERE id = $1", [pollRunId, status]);
}

export async function insertProviderAttempt(
  env: Env,
  pollRunId: string,
  drawId: string,
  attempt: ProviderParseResult,
): Promise<string> {
  const row = await one<{ id: string }>(
    env,
    `INSERT INTO provider_attempts
      (poll_run_id, draw_id, provider, source_url, http_status, source_date, row_count, is_complete,
       result_signature, message, duration_ms, raw_hash)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (poll_run_id, provider) DO UPDATE SET
       http_status = excluded.http_status,
       source_date = excluded.source_date,
       row_count = excluded.row_count,
       is_complete = excluded.is_complete,
       result_signature = excluded.result_signature,
       message = excluded.message,
       duration_ms = excluded.duration_ms,
       raw_hash = excluded.raw_hash,
       checked_at = now()
     RETURNING id`,
    [
      pollRunId,
      drawId,
      attempt.provider,
      attempt.sourceUrl,
      attempt.httpStatus,
      attempt.sourceDate,
      attempt.rows.length,
      attempt.isComplete,
      attempt.resultSignature,
      attempt.message,
      attempt.durationMs,
      attempt.rawHash,
    ],
  );
  if (!row) throw new Error("Failed to insert provider attempt");
  return row.id;
}

export async function replaceProviderAttemptRows(env: Env, providerAttemptId: string, drawId: string, attempt: ProviderParseResult) {
  await query(env, "DELETE FROM provider_attempt_rows WHERE provider_attempt_id = $1", [providerAttemptId]);
  for (const row of attempt.rows) {
    await query(
      env,
      `INSERT INTO provider_attempt_rows
        (provider_attempt_id, draw_id, provider, prize_category, label, prize_amount, winning_number)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (provider_attempt_id, prize_category, winning_number) DO NOTHING`,
      [providerAttemptId, drawId, attempt.provider, row.prize_category, row.label, row.prize_amount, row.winning_number],
    );
  }
}

export async function upsertResultRow(
  env: Env,
  drawId: string,
  row: CanonicalResultRow,
  provider: ProviderName,
  providers: ProviderName[],
  status: DrawStatus,
): Promise<boolean> {
  const result = await query<{ id: string }>(
    env,
    `INSERT INTO result_rows
      (draw_id, prize_category, label, prize_amount, winning_number, source_provider, all_seen_providers, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (draw_id, prize_category, winning_number) DO UPDATE SET
       label = excluded.label,
       prize_amount = excluded.prize_amount,
       source_provider = excluded.source_provider,
       all_seen_providers = excluded.all_seen_providers,
       status = excluded.status,
       updated_at = now()
     WHERE result_rows.all_seen_providers IS DISTINCT FROM excluded.all_seen_providers
        OR result_rows.status IS DISTINCT FROM excluded.status
        OR result_rows.source_provider IS DISTINCT FROM excluded.source_provider
        OR result_rows.label IS DISTINCT FROM excluded.label
        OR result_rows.prize_amount IS DISTINCT FROM excluded.prize_amount
     RETURNING id`,
    [drawId, row.prize_category, row.label, row.prize_amount, row.winning_number, provider, providers, status],
  );
  return result.length > 0;
}

export async function bumpDrawRevision(env: Env, drawId: string): Promise<DrawRecord> {
  const row = await one<DrawRecord>(env, "UPDATE draws SET revision = revision + 1, updated_at = now() WHERE id = $1 RETURNING *", [drawId]);
  if (!row) throw new Error("Failed to bump draw revision");
  return row;
}

export async function updateDrawState(
  env: Env,
  drawId: string,
  status: DrawStatus,
  firstProvider: ProviderName | null,
  confirmingProviders: ProviderName[],
  signature: string | null,
  conflictMessage: string | null,
  touchPoll = false,
) {
  await query(
    env,
    `UPDATE draws
     SET status = $2::draw_status,
         first_provider = COALESCE($3, first_provider),
         confirmed_providers = $4,
         latest_signature = COALESCE($5, latest_signature),
         conflict_message = $6,
         last_poll_at = CASE WHEN $7 THEN now() ELSE last_poll_at END,
         provisional_at = CASE
           WHEN $2::draw_status IN ('live'::draw_status, 'provisional'::draw_status, 'confirmed'::draw_status, 'conflict'::draw_status)
             AND provisional_at IS NULL THEN now()
           ELSE provisional_at
         END,
         confirmed_at = CASE WHEN $2::draw_status = 'confirmed'::draw_status THEN now() ELSE confirmed_at END,
         failed_at = CASE WHEN $2::draw_status = 'failed'::draw_status THEN now() ELSE failed_at END,
         updated_at = now()
     WHERE id = $1`,
    [drawId, status, firstProvider, confirmingProviders, signature, conflictMessage, touchPoll],
  );
}

export async function enqueueWebhook(env: Env, eventType: string, payload: unknown) {
  const subscriptions = await query<{ id: string }>(
    env,
    "SELECT id FROM webhook_subscriptions WHERE active = true AND $1 = ANY(events)",
    [eventType],
  );
  for (const subscription of subscriptions) {
    await query(env, "INSERT INTO webhook_deliveries (subscription_id, event_type, payload) VALUES ($1, $2, $3)", [
      subscription.id,
      eventType,
      JSON.stringify(payload),
    ]);
  }
}

export async function buildResultEnvelope(env: Env, draw: DrawRecord | null): Promise<ApiResultEnvelope> {
  const config = await getPollingConfig(env);
  if (!draw) {
    return {
      api_version: "v1",
      draw_date: null,
      timezone: config.timezone,
      status: "not_found",
      revision: 0,
      last_poll_at: null,
      refresh_error: null,
      primary_provider: "sanook",
      confidence: {
        first_provider: null,
        confirming_providers: [],
        consensus_count: 0,
        required_consensus: config.consensus_threshold,
      },
      categories: buildEmptyCategories(),
      providers: [],
      updated_at: null,
    };
  }

  const rows = await query<{
    prize_category: string;
    label: string;
    prize_amount: number;
    winning_number: string;
    source_provider: ProviderName;
    all_seen_providers: ProviderName[];
    first_seen_at: string;
    status: DrawStatus;
  }>(
    env,
    "SELECT prize_category, label, prize_amount, winning_number, source_provider, all_seen_providers, first_seen_at, status FROM result_rows WHERE draw_id = $1",
    [draw.id],
  );

  const providerRows = await query<{
    provider: ProviderName;
    source_date: string | Date | null;
    row_count: number;
    is_complete: boolean;
    message: string | null;
    checked_at: string;
  }>(
    env,
    `SELECT DISTINCT ON (provider) provider, source_date, row_count, is_complete, message, checked_at
     FROM provider_attempts
     WHERE draw_id = $1
     ORDER BY provider, checked_at DESC`,
    [draw.id],
  );

  const categories = buildEmptyCategories();
  for (const row of rows) {
    const category = categories.find((candidate) => candidate.id === row.prize_category);
    if (!category) continue;
    const number: ApiResultNumber = {
      number: row.winning_number,
      source_provider: row.source_provider,
      all_seen_providers: row.all_seen_providers,
      first_seen_at: row.first_seen_at,
      status: row.status,
    };
    category.numbers.push(number);
    category.received_count = category.numbers.length;
  }

  return {
    api_version: "v1",
    draw_date: dateOnly(draw.draw_date),
    timezone: config.timezone,
    status: draw.status,
    revision: draw.revision ?? 0,
    last_poll_at: draw.last_poll_at ?? null,
    refresh_error: null,
    primary_provider: "sanook",
    confidence: {
      first_provider: draw.first_provider,
      confirming_providers: draw.confirmed_providers,
      consensus_count: draw.confirmed_providers.length,
      required_consensus: config.consensus_threshold,
    },
    categories,
    providers: config.enabled_providers.map((provider) => {
      const latest = providerRows.find((row) => row.provider === provider);
      return {
        provider,
        status: latest ? (latest.is_complete ? "complete" : latest.row_count > 0 ? "partial" : "error") : "not_run",
        row_count: latest?.row_count ?? 0,
        is_complete: latest?.is_complete ?? false,
        source_date: dateOnly(latest?.source_date ?? null),
        last_checked_at: latest?.checked_at ?? null,
        message: latest?.message ?? null,
      };
    }),
    updated_at: draw.updated_at,
  };
}

function buildEmptyCategories(): ApiResultCategory[] {
  return PRIZE_CATEGORY_ORDER.map((category) => ({
    id: category,
    label: PRIZE_LABELS[category],
    prize_amount: PRIZE_AMOUNTS[category],
    expected_count: PRIZE_CATEGORY_EXPECTED_WINNERS[category],
    received_count: 0,
    numbers: [],
  }));
}

function dateOnly(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}
