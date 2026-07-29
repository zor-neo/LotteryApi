CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'draw_status') THEN
    CREATE TYPE draw_status AS ENUM ('pending', 'polling', 'live', 'provisional', 'confirmed', 'conflict', 'failed');
  END IF;
END
$$;

ALTER TYPE draw_status ADD VALUE IF NOT EXISTS 'live' AFTER 'polling';

CREATE TABLE IF NOT EXISTS polling_config (
  id boolean PRIMARY KEY DEFAULT true,
  timezone text NOT NULL DEFAULT 'Asia/Bangkok',
  start_time text NOT NULL DEFAULT '14:30',
  end_time text NOT NULL DEFAULT '16:00',
  frequency_seconds integer NOT NULL DEFAULT 60 CHECK (frequency_seconds >= 15),
  enabled_providers text[] NOT NULL DEFAULT ARRAY['sanook','kapook','myhora'],
  provider_order text[] NOT NULL DEFAULT ARRAY['sanook','kapook','myhora'],
  consensus_threshold integer NOT NULL DEFAULT 2 CHECK (consensus_threshold >= 2),
  retention_days integer NOT NULL DEFAULT 365 CHECK (retention_days >= 30),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT singleton_polling_config CHECK (id = true)
);

INSERT INTO polling_config (id)
VALUES (true)
ON CONFLICT (id) DO NOTHING;

UPDATE polling_config
SET enabled_providers = ARRAY['sanook','kapook','myhora'],
    provider_order = ARRAY['sanook','kapook','myhora'],
    updated_at = now()
WHERE id = true
  AND enabled_providers = ARRAY['kapook','myhora','sanook']
  AND provider_order = ARRAY['kapook','myhora','sanook'];

CREATE TABLE IF NOT EXISTS draws (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_date date NOT NULL UNIQUE,
  status draw_status NOT NULL DEFAULT 'pending',
  first_provider text,
  confirmed_providers text[] NOT NULL DEFAULT '{}',
  conflict_message text,
  latest_signature text,
  revision integer NOT NULL DEFAULT 0,
  last_poll_at timestamptz,
  provisional_at timestamptz,
  confirmed_at timestamptz,
  failed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS result_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id uuid NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  prize_category text NOT NULL,
  label text NOT NULL,
  prize_amount integer NOT NULL,
  winning_number text NOT NULL,
  source_provider text NOT NULL,
  all_seen_providers text[] NOT NULL DEFAULT '{}',
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  status draw_status NOT NULL DEFAULT 'live',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draw_id, prize_category, winning_number)
);

CREATE TABLE IF NOT EXISTS poll_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  draw_id uuid NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  draw_date date NOT NULL,
  minute_mark timestamptz NOT NULL,
  source text NOT NULL DEFAULT 'scheduled',
  status text NOT NULL DEFAULT 'running',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  UNIQUE (draw_date, minute_mark)
);

CREATE TABLE IF NOT EXISTS provider_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_run_id uuid NOT NULL REFERENCES poll_runs(id) ON DELETE CASCADE,
  draw_id uuid NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  provider text NOT NULL,
  source_url text NOT NULL,
  http_status integer,
  source_date date,
  row_count integer NOT NULL DEFAULT 0,
  is_complete boolean NOT NULL DEFAULT false,
  result_signature text,
  message text,
  duration_ms integer NOT NULL DEFAULT 0,
  raw_hash text,
  checked_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (poll_run_id, provider)
);

CREATE TABLE IF NOT EXISTS provider_attempt_rows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_attempt_id uuid NOT NULL REFERENCES provider_attempts(id) ON DELETE CASCADE,
  draw_id uuid NOT NULL REFERENCES draws(id) ON DELETE CASCADE,
  provider text NOT NULL,
  prize_category text NOT NULL,
  label text NOT NULL,
  prize_amount integer NOT NULL,
  winning_number text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider_attempt_id, prize_category, winning_number)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  key_hash text NOT NULL UNIQUE,
  rate_limit_per_minute integer NOT NULL DEFAULT 120,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'admin',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  label text NOT NULL,
  url text NOT NULL,
  events text[] NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subscription_id uuid REFERENCES webhook_subscriptions(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  response_code integer,
  response_body text,
  retry_count integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE TABLE IF NOT EXISTS worker_heartbeats (
  worker_name text PRIMARY KEY,
  status text NOT NULL DEFAULT 'starting',
  message text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_draws_date_status ON draws (draw_date DESC, status);
CREATE INDEX IF NOT EXISTS idx_poll_runs_draw_date ON poll_runs (draw_date DESC, minute_mark DESC);
CREATE INDEX IF NOT EXISTS idx_provider_attempts_draw_provider ON provider_attempts (draw_id, provider, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_provider_attempt_rows_draw_provider ON provider_attempt_rows (draw_id, provider, prize_category);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_pending ON webhook_deliveries (status, next_attempt_at);

ALTER TABLE draws ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0;
ALTER TABLE draws ADD COLUMN IF NOT EXISTS last_poll_at timestamptz;
