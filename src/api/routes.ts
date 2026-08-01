import { Env } from "../env.js";
import { query } from "../db/sql.js";
import { getBangkokParts } from "../lib/time.js";
import { ApiResultEnvelope, buildResultEnvelope, getDraw, getLatestDraw, getPollingConfig, getSchemaReadiness } from "../domain/repository.js";
import { refreshIfNeeded, runPoll } from "../domain/poller.js";
import { requireApiKey } from "./auth.js";
import { error, json } from "./responses.js";

const drawDatePattern = /^\d{4}-\d{2}-\d{2}$/;

export async function handleRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (request.method === "OPTIONS") return json({ ok: true });

  const url = new URL(request.url);
  const path = url.pathname.replace(/\/$/, "") || "/";

  if (request.method === "GET" && path === "/") {
    return json({
      api_version: "v1",
      build: "2026-08-01-live-diagnostics",
      service: "LotteryApiCloudflare",
      runtime: "cloudflare-workers",
      health_url: `${url.origin}/v1/health`,
      latest_result_url: `${url.origin}/v1/results/latest`,
      developer_console_url: `${url.origin}/console`,
      documentation: {
        integration: "docs/integration.md",
        openapi: "docs/openapi.yaml",
      },
    });
  }

  if (request.method === "GET" && path === "/console") {
    return serveAsset(request, env, "/index.html");
  }

  if (request.method === "GET" && path.startsWith("/console/")) {
    return serveAsset(request, env, path.replace(/^\/console/, "") || "/index.html");
  }

  if (request.method === "GET" && path === "/v1/health") return health(env);

  if (path.startsWith("/v1/")) {
    const authError = await requireApiKey(request, env);
    if (authError) return withCors(authError);
  }

  if (request.method === "GET" && path === "/v1/results/latest") {
    const now = getBangkokParts();
    const refreshError = await tryRefresh(env, now.date);
    return json(withRefreshError(await buildResultEnvelope(env, await getLatestDraw(env)), refreshError));
  }

  const resultMatch = path.match(/^\/v1\/results\/(\d{4}-\d{2}-\d{2})$/);
  if (request.method === "GET" && resultMatch) {
    const drawDate = resultMatch[1];
    const refreshError = await tryRefresh(env, drawDate);
    return json(withRefreshError(await buildResultEnvelope(env, await getDraw(env, drawDate)), refreshError));
  }

  const auditMatch = path.match(/^\/v1\/results\/(\d{4}-\d{2}-\d{2})\/audit$/);
  if (request.method === "GET" && auditMatch) return audit(env, auditMatch[1]);

  if (request.method === "POST" && (path === "/v1/admin/poll/run" || path === "/v1/admin/poll/dry-run")) {
    const body = await request.json().catch(() => ({})) as { draw_date?: string; hhmm?: string; hhmmss?: string };
    const now = getBangkokParts();
    const drawDate = body.draw_date || now.date;
    if (!drawDatePattern.test(drawDate)) return error(400, "draw_date must be YYYY-MM-DD");
    return json(await runPoll(env, {
      drawDate,
      hhmm: body.hhmm || now.hhmm,
      hhmmss: body.hhmmss || now.hhmmss,
      source: path.endsWith("dry-run") ? "dry_run" : "manual",
      dryRun: path.endsWith("dry-run"),
    }));
  }

  return error(404, "Not found");
}

async function health(env: Env): Promise<Response> {
  const [db] = await query<{ ok: number }>(env, "SELECT 1 AS ok").catch(() => [{ ok: 0 }]);
  const config = await getPollingConfig(env);
  const schema = db?.ok === 1 ? await getSchemaReadiness(env) : null;
  return json({
    ok: db?.ok === 1,
    api_version: "v1",
    build: "2026-08-01-live-diagnostics",
    service: "LotteryApiCloudflare",
    runtime: "cloudflare-workers",
    database: db?.ok === 1 ? "ok" : "error",
    schema,
    worker_policy: {
      timezone: config.timezone,
      start_time: config.start_time,
      end_time: config.end_time,
      frequency_seconds: config.frequency_seconds,
      draw_dates: "1st and 16th monthly; Jan 1 and May 1 move to the 2nd",
      cron: "1 minute backup on official draw dates; opportunistic API refresh for shorter intervals",
    },
  });
}

async function tryRefresh(env: Env, drawDate: string): Promise<string | null> {
  try {
    await refreshIfNeeded(env, drawDate);
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : "Automatic refresh failed";
  }
}

function withRefreshError(envelope: ApiResultEnvelope, refreshError: string | null): ApiResultEnvelope {
  envelope.refresh_error = refreshError;
  return envelope;
}

async function audit(env: Env, drawDate: string): Promise<Response> {
  const rows = await query(
    env,
    `SELECT pr.minute_mark, pa.provider, pa.source_url, pa.http_status, pa.source_date::text AS source_date,
            pa.row_count, pa.is_complete, pa.result_signature, pa.message, pa.duration_ms,
            pa.raw_hash, pa.checked_at,
            COALESCE(
              jsonb_agg(
                jsonb_build_object(
                  'prize_category', par.prize_category,
                  'label', par.label,
                  'prize_amount', par.prize_amount,
                  'number', par.winning_number
                )
                ORDER BY par.prize_category, par.winning_number
              ) FILTER (WHERE par.id IS NOT NULL),
              '[]'::jsonb
            ) AS parsed_rows
     FROM poll_runs pr
     LEFT JOIN provider_attempts pa ON pa.poll_run_id = pr.id
     LEFT JOIN provider_attempt_rows par ON par.provider_attempt_id = pa.id
     WHERE pr.draw_date = $1
     GROUP BY pr.minute_mark, pa.provider, pa.source_url, pa.http_status, pa.source_date,
              pa.row_count, pa.is_complete, pa.result_signature, pa.message, pa.duration_ms,
              pa.raw_hash, pa.checked_at
     ORDER BY pr.minute_mark DESC, pa.provider ASC`,
    [drawDate],
  );
  return json({ api_version: "v1", draw_date: drawDate, audit: rows });
}

function withCors(response: Response): Response {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Headers", "Content-Type, x-api-key");
  return response;
}

function serveAsset(request: Request, env: Env, assetPath: string): Promise<Response> | Response {
  if (!env.ASSETS) return error(404, "Console assets are not configured");
  const url = new URL(request.url);
  url.pathname = assetPath;
  return env.ASSETS.fetch(new Request(url.toString(), { method: "GET", headers: request.headers }));
}
