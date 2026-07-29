import { describe, expect, it } from "vitest";
import { isOfficialDrawDate } from "./draw-schedule.js";

describe("isOfficialDrawDate", () => {
  it("allows the 1st and 16th for ordinary months", () => {
    expect(isOfficialDrawDate("2026-02-01")).toBe(true);
    expect(isOfficialDrawDate("2026-02-16")).toBe(true);
    expect(isOfficialDrawDate("2026-02-02")).toBe(false);
  });

  it("moves January and May first draws to the 2nd", () => {
    expect(isOfficialDrawDate("2026-01-01")).toBe(false);
    expect(isOfficialDrawDate("2026-01-02")).toBe(true);
    expect(isOfficialDrawDate("2026-05-01")).toBe(false);
    expect(isOfficialDrawDate("2026-05-02")).toBe(true);
  });

  it("keeps the 16th for January and May", () => {
    expect(isOfficialDrawDate("2026-01-16")).toBe(true);
    expect(isOfficialDrawDate("2026-05-16")).toBe(true);
  });
});
