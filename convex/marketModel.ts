import { v } from "convex/values";
import { JOB_STATES } from "../lib/economy/types";
export const jobState = v.union(
  ...JOB_STATES.map(v.literal),
);
export const optionsValidator = v.object({
  columns: v.array(v.string()),
  caseMode: v.optional(v.union(v.literal("preserve"), v.literal("lowercase"))),
  numericColumns: v.optional(v.array(v.string())),
  keyColumn: v.optional(v.string()),
  comparisonCsv: v.optional(v.string()),
  groupBy: v.optional(v.string()),
});
export const checkValidator = v.object({
  code: v.string(),
  passed: v.boolean(),
  detail: v.string(),
});
export const scoreValidator = v.object({ price: v.number(), time: v.number(), reputation: v.number(), capability: v.number(), total: v.number() });
