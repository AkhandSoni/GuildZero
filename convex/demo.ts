import { mutation } from "./_generated/server";
import { user } from "./ownership";
import { SAMPLE_CSV, SERVICE_TYPES } from "../lib/missions";
export const seed = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await user(ctx);
    const existing = await ctx.db
      .query("missions")
      .withIndex("by_owner_demo", (q) =>
        q.eq("ownerId", ownerId).eq("demo", true),
      )
      .take(2);
    const ids = [];
    for (const serviceType of SERVICE_TYPES) {
      const previous = existing.find((m) => m.serviceType === serviceType);
      if (previous) {
        ids.push(previous._id);
        continue;
      }
      const now = Date.now();
      ids.push(
        await ctx.db.insert("missions", {
          ownerId,
          demo: true,
          title:
            serviceType === "csv_summary"
              ? "Sample: sales statistics"
              : "Sample: CSV normalization",
          serviceType,
          inputCsv: SAMPLE_CSV,
          options: serviceType === "csv_summary"
            ? { columns: ["units", "price"] }
            : { columns: ["product", "region"], caseMode: "preserve" },
          maxBudgetYocto: "1000000000000000000000000",
          acceptanceCriteria:
            "Synthetic sample dataset. Process only the explicitly selected template columns.",
          deadlineAt: now + 86400000,
          state: "draft",
          createdAt: now,
          updatedAt: now,
        }),
      );
    }
    return { missionIds: ids };
  },
});
export const resetUnused = mutation({
  args: {},
  handler: async (ctx) => {
    const ownerId = await user(ctx);
    const samples = await ctx.db
      .query("missions")
      .withIndex("by_owner_demo", (q) =>
        q.eq("ownerId", ownerId).eq("demo", true),
      )
      .take(10);
    let removed = 0;
    for (const m of samples) {
      if (m.state !== "draft") continue;
      const job = await ctx.db
        .query("jobs")
        .withIndex("by_mission", (q) => q.eq("missionId", m._id))
        .first();
      if (job) continue;
      await ctx.db.delete(m._id);
      removed++;
    }
    return { removed };
  },
});
