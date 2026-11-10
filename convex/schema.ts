import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
export const missionFields = {
  title: v.string(),
  serviceType: v.union(v.literal("csv_normalize"), v.literal("csv_summary")),
  inputCsv: v.string(),
  maxBudgetYocto: v.string(),
  acceptanceCriteria: v.string(),
  deadlineAt: v.number(),
};
export default defineSchema({
  ...authTables,
  missions: defineTable({
    ...missionFields,
    ownerId: v.id("users"),
    state: v.literal("draft"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_owner_state", ["ownerId", "state"]),
});
