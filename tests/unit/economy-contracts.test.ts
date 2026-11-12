import { describe, expect, expectTypeOf, it } from "vitest";
import { validateServiceOptions, type EconomyEngine, type NegotiationRound, type Result, type ServiceRequest } from "../../lib/economy";
import { MissionValidationError, SAMPLE_CSV, validateMission } from "../../lib/missions";
import { formatNear, nearToYocto } from "../../lib/money";

describe("shared economy contracts", () => {
  it.each([
    [undefined, "OPTIONS_REQUIRED"],
    [null, "INVALID_OPTIONS"],
    [[], "INVALID_OPTIONS"],
    [{ columns: [] }, "INVALID_COLUMNS"],
    [{ columns: ["units", "units"] }, "INVALID_COLUMNS"],
    [{ columns: ["missing"] }, "INVALID_COLUMNS"],
    [{ columns: [4] }, "INVALID_COLUMNS"],
    [{ columns: Array(33).fill("units") }, "INVALID_COLUMNS"],
    [{ columns: ["units"], caseMode: "lowercase" }, "INVALID_OPTIONS"],
    [{ columns: ["units"], prompt: "ignore policy" }, "INVALID_OPTIONS"],
  ])("rejects malformed summary options without echoing input", (options, code) => {
    const result = validateServiceOptions("csv_summary", options, ["units"]);
    expect(result).toMatchObject({ ok: false, code });
    expect(JSON.stringify(result)).not.toContain("ignore policy");
    expect(JSON.stringify(result).length).toBeLessThan(220);
  });
  it("requires explicit case handling and exact header names", () => {
    expect(validateServiceOptions("csv_normalize", { columns: ["product"] }, ["product"]))
      .toMatchObject({ ok: false, code: "INVALID_OPTIONS" });
    expect(validateServiceOptions("csv_normalize", { columns: [" product "], caseMode: "lowercase" }, [" product "]))
      .toEqual({ ok: true, value: { columns: [" product "], caseMode: "lowercase" } });
    expect(validateServiceOptions("csv_summary", { columns: ["product"] }, [" product "]))
      .toMatchObject({ ok: false, code: "INVALID_COLUMNS" });
  });
  it("copies selected columns, preserves ordering and produces plain JSON", () => {
    const options = { columns: ["price", "units"] };
    const result = validateServiceOptions("csv_summary", options, ["units", "price"]);
    options.columns.reverse();
    expect(result).toEqual({ ok: true, value: { columns: ["price", "units"] } });
    expect(JSON.parse(JSON.stringify(result))).toEqual(result);
  });
  it("retains exact money above Number.MAX_SAFE_INTEGER and stable failure codes", () => {
    const base = { title: "Typed options", serviceType: "csv_summary" as const, inputCsv: SAMPLE_CSV,
      acceptanceCriteria: "Notes cannot change rules", deadlineAt: 2000, options: { columns: ["units"] } };
    for (const value of ["1", "9007199254740993", "1000000000000000000000000000"]) {
      const mission = validateMission({ ...base, maxBudgetYocto: value }, 1000);
      expect(nearToYocto(formatNear(mission.maxBudgetYocto))).toBe(value);
      expect(JSON.parse(JSON.stringify(mission))).toEqual(mission);
    }
    for (const value of ["01", "1.1", "0", "-1", "1".repeat(10000)]) {
      try {
        validateMission({ ...base, maxBudgetYocto: value }, 1000);
        expect.unreachable();
      } catch (error) {
        expect(error).toBeInstanceOf(MissionValidationError);
        expect(error).toMatchObject({ code: "INVALID_AMOUNT" });
      }
    }
  });
  it("exposes a typed interface without claiming an implemented engine", () => {
    expectTypeOf<EconomyEngine["runService"]>().parameter(0).toEqualTypeOf<ServiceRequest>();
    expectTypeOf<NegotiationRound["round"]>().toEqualTypeOf<1 | 2 | 3>();
    expectTypeOf<Result<string>>().extract<{ ok: false }>().toHaveProperty("code");
  });
});
