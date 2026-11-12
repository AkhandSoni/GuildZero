import { v } from "convex/values";
import { JOB_STATES } from "../lib/economy/types";
export const jobState = v.union(
  ...JOB_STATES.map(v.literal),
);
export const optionsValidator = v.object({
  columns: v.array(v.string()),
  caseMode: v.optional(v.union(v.literal("preserve"), v.literal("lowercase"))),
});
export const checkValidator = v.object({
  code: v.string(),
  passed: v.boolean(),
  detail: v.string(),
});
