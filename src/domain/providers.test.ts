import { describe, expect, it } from "vitest";
import { parseProviderHtml, providerUrl } from "./providers.js";
import { PRIZE_CATEGORY_ORDER, PRIZE_CATEGORY_EXPECTED_WINNERS } from "./prizes.js";

const drawDate = "2026-07-01";

function numbers(count: number, digits: number, offset: number) {
  return Array.from({ length: count }, (_, index) => String(index + offset).padStart(digits, "0"));
}

function section(title: string, values: string[]) {
  return `<section><h2>${title}</h2><p>${values.join(" ")}</p></section>`;
}

function completeGenericHtml() {
  return `
    <html><body>
      <h1>ตรวจหวย วันที่ 1 กรกฎาคม 2569</h1>
      ${section("รางวัลที่ 1", numbers(1, 6, 100001))}
      ${section("เลขหน้า 3 ตัว", numbers(2, 3, 101))}
      ${section("เลขท้าย 3 ตัว", numbers(2, 3, 201))}
      ${section("เลขท้าย 2 ตัว", numbers(1, 2, 31))}
      ${section("รางวัลข้างเคียง", numbers(2, 6, 100002))}
      ${section("รางวัลที่ 2", numbers(5, 6, 200001))}
      ${section("รางวัลที่ 3", numbers(10, 6, 300001))}
      ${section("รางวัลที่ 4", numbers(50, 6, 400001))}
      ${section("รางวัลที่ 5", numbers(100, 6, 500001))}
      <footer>ตรวจหวย</footer>
    </body></html>
  `;
}

describe("providerUrl", () => {
  it("generates known provider URLs", () => {
    expect(providerUrl("kapook", drawDate)).toContain("lottery.kapook.com/check/010769");
    expect(providerUrl("myhora", drawDate)).toContain("result-01-07-2569.aspx");
    expect(providerUrl("sanook", drawDate)).toContain("01072569");
  });
});

describe("parseProviderHtml", () => {
  it("parses a complete generic provider page", () => {
    const parsed = parseProviderHtml("kapook", drawDate, completeGenericHtml(), "https://example.test", 200);
    expect(parsed.sourceDate).toBe(drawDate);
    expect(parsed.isComplete).toBe(true);
    expect(parsed.rows).toHaveLength(173);

    for (const category of PRIZE_CATEGORY_ORDER) {
      expect(parsed.rows.filter((row) => row.prize_category === category)).toHaveLength(
        PRIZE_CATEGORY_EXPECTED_WINNERS[category],
      );
    }
  });

  it("marks date mismatch as incomplete", () => {
    const parsed = parseProviderHtml("kapook", "2026-07-16", completeGenericHtml(), "https://example.test", 200);
    expect(parsed.isComplete).toBe(false);
    expect(parsed.message).toContain("Source date mismatch");
  });
});
