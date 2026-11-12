import { describe, expect, it } from "vitest";
import { formatNear, nearToYocto, validateBudget } from "../../lib/money";
import {
  SAMPLE_CSV,
  validateMission,
  type MissionInput,
} from "../../lib/missions";
import { INITIAL_AGENTS } from "../../lib/agents";
describe("integer NEAR accounting", () => {
  it("preserves all 24 decimal places", () => {
    const value = "2.123456789012345678901234";
    expect(nearToYocto(value)).toBe("2123456789012345678901234");
    expect(formatNear(nearToYocto(value))).toBe(value);
    expect(nearToYocto("0.000000000000000000000001")).toBe("1");
    expect(formatNear("1000000000000000000000000")).toBe("1");
    expect(nearToYocto("1000")).toBe("1000000000000000000000000000");
  });
  it.each([
    "0",
    "-1",
    "1e3",
    "NaN",
    "Infinity",
    "01",
    "1.0000000000000000000000001",
    "1001",
    " 1",
    "0x10",
  ])("rejects invalid amount %s", (value) => {
    expect(() => nearToYocto(value)).toThrow();
  });
  it("rejects huge base-unit input before BigInt conversion", () => {
    expect(() => validateBudget("1".repeat(10000))).toThrow();
  });
});
describe("bounded mission inputs", () => {
  const input = (): MissionInput => ({
    title: "Test",
    serviceType: "csv_normalize",
    inputCsv: SAMPLE_CSV,
    maxBudgetYocto: "1",
    acceptanceCriteria: "Preserve rows",
    deadlineAt: Date.now() + 86400000,
  });
  it("accepts quoted CSV fields and trims text metadata", () => {
    expect(
      validateMission({
        ...input(),
        title: " Test ",
        inputCsv: 'name,count\n"Bag, large",3',
      }).title,
    ).toBe("Test");
  });
  it("accepts a valid single-column CSV without delimiter-guessing errors", () => {
    expect(
      validateMission({ ...input(), inputCsv: "units\n3\n5" }).inputCsv,
    ).toBe("units\n3\n5");
  });
  it("rejects oversized rows and column counts", () => {
    expect(() =>
      validateMission({
        ...input(),
        inputCsv: "a\n" + Array(501).fill("1").join("\n"),
      }),
    ).toThrow();
    expect(() =>
      validateMission({
        ...input(),
        inputCsv:
          Array.from({ length: 33 }, (_, i) => `h${i}`).join(",") +
          "\n" +
          Array(33).fill("1").join(","),
      }),
    ).toThrow();
  });
  it("bounds UTF-8 bytes, invalid quotes, header collisions, and deadlines", () => {
    for (const csv of [
      "a\n" + "é".repeat(33000),
      'a,b\n"unclosed,1',
      " a,a\n1,2",
    ])
      expect(() => validateMission({ ...input(), inputCsv: csv })).toThrow();
    expect(() =>
      validateMission({ ...input(), deadlineAt: Date.now() + 31 * 86400000 }),
    ).toThrow();
    expect(() => validateMission({ ...input(), deadlineAt: NaN })).toThrow();
  });
});
it("defines distinct seller strategies and all six logical roles without execution", () => {
  expect(new Set(INITIAL_AGENTS.map((a) => a.id)).size).toBe(
    INITIAL_AGENTS.length,
  );
  expect(new Set(INITIAL_AGENTS.map((a) => a.role)).size).toBe(6);
  expect(new Set(INITIAL_AGENTS.map((a) => a.strategy))).toEqual(
    new Set(["aggressive", "balanced", "conservative", null]),
  );
});
