export interface Env {
  ASSETS?: {
    fetch(request: Request): Promise<Response>;
  };
  DATABASE_URL: string;
  DEFAULT_API_KEY: string;
  WEBHOOK_SECRET?: string;
  PUBLIC_BASE_URL?: string;
  PRIMARY_PROVIDER?: string;
  POLL_START_TIME?: string;
  POLL_END_TIME?: string;
  POLL_FREQUENCY_SECONDS?: string;
  CONSENSUS_THRESHOLD?: string;
}

export function publicBaseUrl(env: Env): string {
  return (env.PUBLIC_BASE_URL || "http://localhost:8787").replace(/\/$/, "");
}

export function runtimeNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}
