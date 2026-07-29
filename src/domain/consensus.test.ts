import { describe, expect, it } from "vitest";
import { evaluateConsensus, evaluateLiveResult } from "./consensus.js";
import { CanonicalResultRow, canonicalSignature, rowsFor } from "./prizes.js";
import { ProviderParseResult } from "./providers.js";

function sampleRows(first = "123456"): CanonicalResultRow[] {
  return [
    ...rowsFor("prizeFirst", [first]),
    ...rowsFor("prizeFirstNear", ["123455", "123457"]),
    ...rowsFor("prizeSecond", ["200001", "200002", "200003", "200004", "200005"]),
    ...rowsFor("prizeThird", Array.from({ length: 10 }, (_, i) => String(300001 + i))),
    ...rowsFor("prizeForth", Array.from({ length: 50 }, (_, i) => String(400001 + i))),
    ...rowsFor("prizeFifth", Array.from({ length: 100 }, (_, i) => String(500001 + i))),
    ...rowsFor("runningNumberFrontThree", ["111", "222"]),
    ...rowsFor("runningNumberBackThree", ["333", "444"]),
    ...rowsFor("runningNumberBackTwo", ["55"]),
  ];
}

function attempt(provider: "kapook" | "myhora" | "sanook", rows: CanonicalResultRow[], complete = true): ProviderParseResult {
  return {
    provider,
    sourceUrl: "https://example.test",
    httpStatus: 200,
    sourceDate: "2026-07-01",
    rows,
    isComplete: complete,
    message: complete ? "Complete" : "Incomplete",
    durationMs: 10,
    rawHash: "hash",
    resultSignature: rows.length ? canonicalSignature(rows) : null,
  };
}

describe("evaluateConsensus", () => {
  it("publishes provisional when the first provider is complete", () => {
    const rows = sampleRows();
    const decision = evaluateConsensus([attempt("kapook", rows), attempt("myhora", [], false)], ["kapook", "myhora", "sanook"], 2);
    expect(decision.status).toBe("provisional");
    expect(decision.firstProvider).toBe("kapook");
    expect(decision.consensusCount).toBe(1);
  });

  it("confirms when two complete providers match", () => {
    const rows = sampleRows();
    const decision = evaluateConsensus([attempt("kapook", rows), attempt("myhora", rows)], ["kapook", "myhora", "sanook"], 2);
    expect(decision.status).toBe("confirmed");
    expect(decision.confirmingProviders).toEqual(["kapook", "myhora"]);
  });

  it("flags conflict when complete providers differ", () => {
    const decision = evaluateConsensus(
      [attempt("kapook", sampleRows("123456")), attempt("myhora", sampleRows("999999"))],
      ["kapook", "myhora", "sanook"],
      2,
    );
    expect(decision.status).toBe("conflict");
    expect(decision.conflictMessage).toContain("myhora");
  });
});

describe("evaluateLiveResult", () => {
  it("publishes partial Sanook rows as live", () => {
    const rows = rowsFor("prizeFirst", ["123456"]);
    const decision = evaluateLiveResult([attempt("sanook", rows, false)], 2, "2026-07-01");

    expect(decision.status).toBe("live");
    expect(decision.firstProvider).toBe("sanook");
    expect(decision.rows).toHaveLength(1);
    expect(decision.rows[0].status).toBe("live");
    expect(decision.rows[0].seenProviders).toEqual(["sanook"]);
  });

  it("upgrades Sanook rows when a support provider matches", () => {
    const rows = rowsFor("prizeFirst", ["123456"]);
    const decision = evaluateLiveResult([attempt("sanook", rows, false), attempt("kapook", rows, false)], 2, "2026-07-01");

    expect(decision.status).toBe("live");
    expect(decision.rows[0].status).toBe("confirmed");
    expect(decision.rows[0].seenProviders).toEqual(["sanook", "kapook"]);
  });

  it("flags support-provider mismatches without dropping Sanook rows", () => {
    const sanookRows = rowsFor("prizeFirst", ["123456"]);
    const kapookRows = rowsFor("prizeFirst", ["999999"]);
    const decision = evaluateLiveResult(
      [attempt("sanook", sanookRows, false), attempt("kapook", kapookRows, false)],
      2,
      "2026-07-01",
    );

    expect(decision.status).toBe("conflict");
    expect(decision.rows[0].row.winning_number).toBe("123456");
    expect(decision.rows[0].status).toBe("conflict");
    expect(decision.rows[0].conflictProviders).toEqual(["kapook"]);
  });
});
