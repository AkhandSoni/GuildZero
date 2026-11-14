// @vitest-environment node
import { describe, expect, it } from "vitest";
import { MCP_SCOPES, MCP_TOOL_NAMES, toolArgumentsSchemas, toolResultSchema, toolScope } from "../../lib/mcp/contracts";

const validMission = { requestId: "example-1", title: "Synthetic summary", serviceType: "csv_summary", inputCsv: "value\n1", options: { columns: ["value"] }, maxBudgetYocto: "1000000000000000000000000", deadlineAt: 1900000000000, acceptanceCriteria: "Compute selected numeric summary", cleanBeforeProcessing: false, requiresHumanReview: false };
describe("MCP strict shared contracts", () => {
  it("freezes exactly 13 tools and nonfinancial scopes", () => {
    expect(MCP_TOOL_NAMES).toHaveLength(13);
    expect(new Set(MCP_TOOL_NAMES).size).toBe(13);
    expect(Object.keys(toolScope)).toEqual([...MCP_TOOL_NAMES]);
    expect(Object.values(toolScope).every(scope => MCP_SCOPES.includes(scope))).toBe(true);
    expect(MCP_SCOPES.some(scope => /authorize|send|admin/.test(scope))).toBe(false);
  });
  it.each(MCP_TOOL_NAMES)("rejects unsolicited principal and approval fields in %s", name => {
    const args = name === "guildzero_create_mission" ? validMission : name.includes("mission") && name !== "guildzero_list_missions" || name === "guildzero_start_auction" ? { missionId: "mission1" } : name === "guildzero_list_agents" || name === "guildzero_list_services" || name === "guildzero_list_missions" ? {} : { jobId: "job1" };
    for (const field of ["ownerId", "userId", "recipient", "amountYocto", "approved", "allowUnfundedPreview", "url", "path", "functionName"]) expect(toolArgumentsSchemas[name].safeParse({ ...args, [field]: "forbidden" }).success).toBe(false);
  });
  it("bounds money, both UTF-8 inputs and service-specific options", () => {
    const schema = toolArgumentsSchemas.guildzero_create_mission;
    expect(schema.safeParse(validMission).success).toBe(true);
    for (const amount of ["1.5", "01", "-1", "1e24", "0", (1001n * 10n ** 24n).toString()]) expect(schema.safeParse({ ...validMission, maxBudgetYocto: amount }).success).toBe(false);
    expect(schema.safeParse({ ...validMission, inputCsv: "é".repeat(32769) }).success).toBe(false);
    expect(schema.safeParse({ ...validMission, options: { columns: ["value"], caseMode: "lowercase" } }).success).toBe(false);
    expect(schema.safeParse({ ...validMission, serviceType: "csv_reconcile", options: { columns: ["value"], keyColumn: "key", comparisonCsv: "é".repeat(32769) } }).success).toBe(false);
    expect(schema.safeParse({ ...validMission, serviceType: "csv_report", cleanBeforeProcessing: true, options: { columns: ["value"], groupBy: "key" } }).success).toBe(false);
  });
  it("retains selected options without exposing a second private source", () => {
    const result = { version: 1, ok: true, code: "OK", checkedAt: 1, workflowState: "created", data: { mission: { id: "m1", title: "Synthetic", serviceType: "csv_reconcile", maxBudgetYocto: "1", deadlineAt: 1900000000000, acceptanceCriteria: "Compare exact keys", cleanBeforeProcessing: false, requiresHumanReview: false, state: "draft", createdAt: 1, updatedAt: 1, options: { columns: ["value"], keyColumn: "id" } }, jobs: [] } };
    const schema = toolResultSchema("guildzero_get_mission");
    expect(schema.safeParse(result).success).toBe(true);
    expect(schema.safeParse({ ...result, data: { ...result.data, mission: { ...result.data.mission, options: { ...result.data.mission.options, comparisonCsv: "private" } } } }).success).toBe(false);
    expect(schema.safeParse({ ...result, workflowState: "auto-approved" }).success).toBe(false);
  });
  it("makes leaked values structurally impossible in a locked result", () => {
    const result = { version: 1, ok: true, code: "OK", checkedAt: 1, data: { jobId: "job1", locked: true, reason: "CONFIRMED_MISSION_SETTLEMENT_REQUIRED", preview: null, requiredPayments: 2, confirmedPayments: 1, deliverable: null } };
    const schema = toolResultSchema("guildzero_get_result");
    expect(schema.safeParse(result).success).toBe(true);
    expect(schema.safeParse({ ...result, data: { ...result.data, deliverable: { id: "d1", format: "csv", content: "private" } } }).success).toBe(false);
    expect(schema.safeParse({ ...result, data: { ...result.data, content: "private" } }).success).toBe(false);
    expect(toolResultSchema("guildzero_get_payment_status").safeParse({ ...result, data: { jobId: "job1", intent: { claimToken: "private" } } }).success).toBe(false);
  });
});
