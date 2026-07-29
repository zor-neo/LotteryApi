import { describe, expect, it } from "vitest";
import { minuteMark, pollSlotKey } from "./time.js";

describe("minuteMark", () => {
  it("preserves second-level poll marks", () => {
    expect(minuteMark("2026-07-16", "15:10:15")).toBe("2026-07-16T15:10:15+07:00");
    expect(minuteMark("2026-07-16", "15:10")).toBe("2026-07-16T15:10:00+07:00");
  });
});

describe("pollSlotKey", () => {
  it("creates 15-second slots within the same minute", () => {
    const drawDate = "2026-07-16";
    expect(pollSlotKey(drawDate, 15 * 3600, 15)).toBe(pollSlotKey(drawDate, 15 * 3600 + 14, 15));
    expect(pollSlotKey(drawDate, 15 * 3600, 15)).not.toBe(pollSlotKey(drawDate, 15 * 3600 + 15, 15));
    expect(pollSlotKey(drawDate, 15 * 3600 + 15, 15)).not.toBe(pollSlotKey(drawDate, 15 * 3600 + 30, 15));
  });
});
