import { v } from "convex/values";
export const jobState = v.union(
  ...[
    "bidding",
    "working",
    "verifying",
    "revision",
    "disputed",
    "approved",
    "rejected",
    "cancelled",
  ].map(v.literal),
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
