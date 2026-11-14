import { expect, it } from "vitest";
import { canonicalJson, datasetMetadata, fingerprint, planJsonSchema, validatePlan, validateContext } from "../../lib/master-agent/plan";
import { BENCHMARK_CASES } from "../../lib/master-agent/benchmark-cases";
import { masterFixture } from "../helpers/master-fixtures";

for (const test of BENCHMARK_CASES) it(`validates the frozen ${test.id} gold contract without invoking a model`, () => {
  const { context, plan } = masterFixture(test.id);
  const checked = validatePlan(plan, context);
  expect(checked.plan.decision).toBe(test.decision);
  expect(checked.missions.length).toBe(test.steps.length);
  expect(checked.missions.reduce((sum, m) => sum + BigInt(m.maxBudgetYocto), 0n)).toBe(test.decision === "execute" ? BigInt(context.capYocto) : 0n);
});
it("has strict schemas with every property required and no provider-specific keys", () => {
  const visit = (s: unknown) => { if (s && typeof s === "object") {
    const object = s as Record<string, unknown>;
    if (object.type === "object") { expect(object.additionalProperties).toBe(false); expect(object.required).toEqual(Object.keys(object.properties as object)); }
    Object.values(object).forEach(value => Array.isArray(value) ? value.forEach(visit) : visit(value));
  } };
  visit(planJsonSchema); expect(JSON.stringify(planJsonSchema)).not.toContain("recipient");
});
it("does not disclose source rows, values or filename to the model metadata", () => {
  const data = [{ ref: "primary", name: "private-customer.csv", csv: "customer,units\nSECRET_CUSTOMER_123,5\n" }];
  const text = JSON.stringify(datasetMetadata(data));
  expect(text).toContain("customer"); expect(text).not.toContain("SECRET_CUSTOMER_123"); expect(text).not.toContain("private-customer");
});
it("rejects unknown policy/recipient fields and invented columns", () => {
  const { context, plan } = masterFixture();
  expect(() => validatePlan({ ...plan, authorize: true }, context)).toThrow("schema");
  expect(() => validatePlan({ ...plan, steps: [{ ...plan.steps[0], recipient: "attacker.testnet" }] }, context)).toThrow("schema");
  plan.steps[0].options.columns = ["profit"];
  expect(() => validatePlan(plan, context)).toThrow("columns");
});
it("rejects incompatible active options, fabricated dataset references and duplicate steps", () => {
  const { context, plan } = masterFixture();
  plan.steps[0].options.groupBy = "product"; expect(() => validatePlan(plan, context)).toThrow("options");
  plan.steps[0].options.groupBy = null; plan.steps[0].datasetRef = "somebody-elses-data";
  expect(() => validatePlan(plan, context)).toThrow("dataset");
  plan.steps[0].datasetRef = "primary"; plan.steps.push(structuredClone(plan.steps[0])); expect(() => validatePlan(plan, context)).toThrow("unique");
});
it("fails on over-cap/mismatched/floating-point money and extra comparison input", () => {
  const { context, plan } = masterFixture();
  context.capYocto = "1"; expect(() => validatePlan(plan, context)).toThrow("budget");
  context.capYocto = plan.proposedTotalBudgetYocto!; plan.proposedTotalBudgetYocto = "2"; expect(() => validatePlan(plan, context)).toThrow("budget");
  plan.steps[0].maxBudgetYocto = "0.5"; expect(() => validatePlan(plan, context)).toThrow("schema");
  const fixture = masterFixture(); fixture.plan.steps[0].comparisonDatasetRef = "comparison"; expect(() => validatePlan(fixture.plan, fixture.context)).toThrow("reconciliation");
});
it("does not allow formatted/currency numbers through cleaning or guess reconciliation keys", () => {
  const { context, plan } = masterFixture("clean-summary");
  context.datasets[0].csv = "units\n$12.50\n"; expect(() => validatePlan(plan, context)).toThrow("plain finite numbers");
  const r = masterFixture("reconciliation"); r.context.datasets[1].csv = "id,status,amount\n1,paid,1\n1,paid,2\n";
  expect(() => validatePlan(r.plan, r.context)).toThrow("unique");
});
it("enforces clarification/no-work, bounded input, and human review independently", () => {
  const { context, plan } = masterFixture("ambiguous"); plan.steps = masterFixture().plan.steps; expect(() => validatePlan(plan, context)).toThrow("clarification");
  context.prompt = "x".repeat(4001); expect(() => validateContext(context)).toThrow("4,000");
  const f = masterFixture(); f.context.requiresHumanReview = true; expect(validatePlan(f.plan, f.context).missions[0].requiresHumanReview).toBe(true);
});
it("fingerprints canonical content, including dataset bytes and null fields", async () => {
  expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  expect(await fingerprint({ a: 1, b: 2 })).toBe(await fingerprint({ b: 2, a: 1 }));
  expect(await fingerprint("a\n")).not.toBe(await fingerprint("a"));
});
