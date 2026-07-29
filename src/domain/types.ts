import { ProviderName } from "./providers.js";

export type DrawStatus = "pending" | "polling" | "live" | "provisional" | "confirmed" | "conflict" | "failed";

export interface PollingConfig {
  timezone: string;
  start_time: string;
  end_time: string;
  frequency_seconds: number;
  enabled_providers: ProviderName[];
  provider_order: ProviderName[];
  consensus_threshold: number;
  retention_days: number;
  updated_at?: string;
}

export interface ApiResultNumber {
  number: string;
  source_provider: ProviderName;
  all_seen_providers: ProviderName[];
  first_seen_at: string;
  status: DrawStatus;
}

export interface ApiResultCategory {
  id: string;
  label: string;
  prize_amount: number;
  expected_count: number;
  received_count: number;
  numbers: ApiResultNumber[];
}
