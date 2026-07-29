import { CanonicalResultRow, PRIZE_CATEGORY_EXPECTED_WINNERS, PrizeCategory, getCompleteness } from "./prizes.js";
import { ProviderName, ProviderParseResult } from "./providers.js";

export type ConsensusStatus = "pending" | "provisional" | "confirmed" | "conflict" | "failed";
export type LiveRowStatus = "live" | "confirmed" | "conflict";
export const PRIMARY_PROVIDER: ProviderName = "sanook";

export interface ConsensusDecision {
  status: ConsensusStatus;
  firstProvider: ProviderName | null;
  confirmingProviders: ProviderName[];
  consensusCount: number;
  requiredConsensus: number;
  signature: string | null;
  rows: CanonicalResultRow[];
  conflictMessage: string | null;
}

export interface LiveResultRowDecision {
  row: CanonicalResultRow;
  status: LiveRowStatus;
  seenProviders: ProviderName[];
  conflictProviders: ProviderName[];
}

export interface LiveResultDecision {
  status: "pending" | "live" | "confirmed" | "conflict";
  firstProvider: ProviderName | null;
  confirmingProviders: ProviderName[];
  consensusCount: number;
  requiredConsensus: number;
  signature: string | null;
  rows: LiveResultRowDecision[];
  conflictMessage: string | null;
}

export function evaluateConsensus(
  attempts: ProviderParseResult[],
  providerOrder: ProviderName[],
  requiredConsensus: number,
): ConsensusDecision {
  const complete = attempts.filter((attempt) => attempt.isComplete && attempt.resultSignature);
  if (complete.length === 0) {
    return {
      status: "pending",
      firstProvider: null,
      confirmingProviders: [],
      consensusCount: 0,
      requiredConsensus,
      signature: null,
      rows: [],
      conflictMessage: null,
    };
  }

  const ordered = [...complete].sort((a, b) => providerOrder.indexOf(a.provider) - providerOrder.indexOf(b.provider));
  const first = ordered[0];
  const matching = complete.filter((attempt) => attempt.resultSignature === first.resultSignature);
  const conflicts = complete.filter((attempt) => attempt.resultSignature !== first.resultSignature);

  if (conflicts.length > 0) {
    return {
      status: "conflict",
      firstProvider: first.provider,
      confirmingProviders: matching.map((attempt) => attempt.provider),
      consensusCount: matching.length,
      requiredConsensus,
      signature: first.resultSignature,
      rows: first.rows,
      conflictMessage: `Provider conflict: ${conflicts.map((attempt) => attempt.provider).join(", ")} differed from ${first.provider}`,
    };
  }

  return {
    status: matching.length >= requiredConsensus ? "confirmed" : "provisional",
    firstProvider: first.provider,
    confirmingProviders: matching.map((attempt) => attempt.provider),
    consensusCount: matching.length,
    requiredConsensus,
    signature: first.resultSignature,
    rows: first.rows,
    conflictMessage: null,
  };
}

export function evaluateLiveResult(attempts: ProviderParseResult[], requiredConsensus: number, drawDate?: string): LiveResultDecision {
  const primary = attempts.find((attempt) => attempt.provider === PRIMARY_PROVIDER);
  const primaryRows = primary &&
    primary.httpStatus &&
    primary.httpStatus >= 200 &&
    primary.httpStatus < 300 &&
    primary.sourceDate &&
    (!drawDate || primary.sourceDate === drawDate)
    ? primary.rows
    : [];

  if (!primary || primary.sourceDate === null || primaryRows.length === 0) {
    return {
      status: "pending",
      firstProvider: null,
      confirmingProviders: [],
      consensusCount: 0,
      requiredConsensus,
      signature: null,
      rows: [],
      conflictMessage: null,
    };
  }

  const supportAttempts = attempts.filter(
    (attempt) =>
      attempt.provider !== PRIMARY_PROVIDER &&
      attempt.httpStatus !== null &&
      attempt.httpStatus >= 200 &&
      attempt.httpStatus < 300 &&
      attempt.sourceDate === primary.sourceDate &&
      attempt.rows.length > 0,
  );
  const supportRowKeys = new Map<ProviderName, Set<string>>();
  const supportCategoryCounts = new Map<ProviderName, Map<PrizeCategory, number>>();

  for (const attempt of supportAttempts) {
    supportRowKeys.set(attempt.provider, new Set(attempt.rows.map(rowKey)));
    const counts = new Map<PrizeCategory, number>();
    for (const row of attempt.rows) {
      counts.set(row.prize_category, (counts.get(row.prize_category) || 0) + 1);
    }
    supportCategoryCounts.set(attempt.provider, counts);
  }

  const rowDecisions = primaryRows.map((row) => {
    const key = rowKey(row);
    const seenProviders = [PRIMARY_PROVIDER];
    const conflictProviders: ProviderName[] = [];

    for (const attempt of supportAttempts) {
      const keys = supportRowKeys.get(attempt.provider);
      if (keys?.has(key)) {
        seenProviders.push(attempt.provider);
        continue;
      }

      const categoryCount = supportCategoryCounts.get(attempt.provider)?.get(row.prize_category) || 0;
      if (categoryCount >= PRIZE_CATEGORY_EXPECTED_WINNERS[row.prize_category]) {
        conflictProviders.push(attempt.provider);
      }
    }

    const status: LiveRowStatus = conflictProviders.length > 0
      ? "conflict"
      : seenProviders.length >= requiredConsensus
        ? "confirmed"
        : "live";

    return {
      row,
      status,
      seenProviders,
      conflictProviders,
    };
  });

  const fullConsensus = evaluateConsensus(attempts, [PRIMARY_PROVIDER, "kapook", "myhora"], requiredConsensus);
  const fullSanookDecision = fullConsensus.firstProvider === PRIMARY_PROVIDER ? fullConsensus : null;
  const hasConflict = rowDecisions.some((decision) => decision.status === "conflict") || fullSanookDecision?.status === "conflict";
  const completeness = getCompleteness(primaryRows);
  const rowSeenProviders = [...new Set(rowDecisions.flatMap((decision) => decision.seenProviders))];
  const confirmingProviders = fullSanookDecision?.confirmingProviders.length ? fullSanookDecision.confirmingProviders : rowSeenProviders;
  const status = hasConflict
    ? "conflict"
    : completeness.isComplete && fullSanookDecision?.status === "confirmed"
      ? "confirmed"
      : "live";

  return {
    status,
    firstProvider: PRIMARY_PROVIDER,
    confirmingProviders,
    consensusCount: confirmingProviders.length,
    requiredConsensus,
    signature: primary.resultSignature,
    rows: rowDecisions,
    conflictMessage: hasConflict ? buildLiveConflictMessage(rowDecisions, fullSanookDecision?.conflictMessage ?? null) : null,
  };
}

function rowKey(row: CanonicalResultRow): string {
  return `${row.prize_category}:${row.winning_number}`;
}

function buildLiveConflictMessage(rows: LiveResultRowDecision[], fullConflict: string | null): string {
  if (fullConflict) return fullConflict;
  const providers = new Set(rows.flatMap((row) => row.conflictProviders));
  return `Provider conflict: ${[...providers].join(", ")} differed from ${PRIMARY_PROVIDER}`;
}
