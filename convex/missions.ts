import { getAuthUserId } from "@convex-dev/auth/server";
import { paginationOptsValidator } from "convex/server";
import { ConvexError, v } from "convex/values";
import { query, mutation, type QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { missionFields } from "./schema";
import { validateMission, MissionValidationError, type MissionInput } from "../lib/missions";
async function requireUser(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  if (!id || !(await ctx.db.get(id))) throw new ConvexError("UNAUTHENTICATED");
  return id;
}
async function ownedMission(ctx: QueryCtx, id: Id<"missions">) {
  const ownerId = await requireUser(ctx);
  const mission = await ctx.db.get(id);
  if (!mission || mission.ownerId !== ownerId)
    throw new ConvexError("MISSION_NOT_FOUND");
  return mission;
}
function validated(input: MissionInput) {
  try {
    return validateMission(input);
  } catch (error) {
    if (error instanceof MissionValidationError)
      throw new ConvexError({ code: error.code, message: error.message });
    throw new ConvexError(
      error instanceof Error ? error.message : "Invalid mission.",
    );
  }
}
export const list = query({
  args: { paginationOpts: paginationOptsValidator, search: v.optional(v.string()), state: v.optional(v.union(v.literal("draft"), v.literal("active"))), serviceType: v.optional(missionFields.serviceType) },
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 50)),
    };
    const search = args.search?.trim();
    if (search && (search.length > 100 || (search.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) > 16 || !/[\p{L}\p{N}]/u.test(search)))
      throw new ConvexError("Search titles using up to 16 words and 100 characters.");
    if (search) return ctx.db.query("missions").withSearchIndex("search_title", (q) => {
      let filter = q.search("title", search).eq("ownerId", ownerId);
      if (args.state) filter = filter.eq("state", args.state);
      if (args.serviceType) filter = filter.eq("serviceType", args.serviceType);
      return filter;
    }).paginate(paginationOpts);
    if (args.serviceType) return ctx.db.query("missions").withIndex("by_owner_service_state", (q) => {
      const filter = q.eq("ownerId", ownerId).eq("serviceType", args.serviceType!);
      return args.state ? filter.eq("state", args.state) : filter;
    }).order("desc").paginate(paginationOpts);
    return ctx.db.query("missions").withIndex("by_owner_state", (q) => {
      const filter = q.eq("ownerId", ownerId);
      return args.state ? filter.eq("state", args.state) : filter;
    }).order("desc").paginate(paginationOpts);
  },
});
export const get = query({
  args: { id: v.id("missions") },
  handler: (ctx, args) => ownedMission(ctx, args.id),
});
export const create = mutation({
  args: missionFields,
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);
    const input = validated(args);
    const now = Date.now();
    return ctx.db.insert("missions", {
      ...input,
      ownerId,
      state: "draft",
      createdAt: now,
      updatedAt: now,
    });
  },
});
export const update = mutation({
  args: { id: v.id("missions"), ...missionFields },
  handler: async (ctx, { id, ...args }) => {
    const mission = await ownedMission(ctx, id);
    if (mission.state !== "draft")
      throw new ConvexError("MISSION_ALREADY_STARTED");
    const input = validated(args);
    await ctx.db.patch(id, { ...input, options: input.options, updatedAt: Date.now() });
  },
});
export const remove = mutation({
  args: { id: v.id("missions") },
  handler: async (ctx, args) => {
    const mission = await ownedMission(ctx, args.id);
    if (mission.state !== "draft")
      throw new ConvexError("MISSION_ALREADY_STARTED");
    await ctx.db.delete(args.id);
  },
});

export const duplicate = mutation({
  args: { id: v.id("missions") },
  handler: async (ctx, { id }) => {
    const source = await ownedMission(ctx, id);
    const now = Date.now();
    const input = validated({
      title: ("Copy of " + source.title).slice(0, 100), serviceType: source.serviceType,
      inputCsv: source.inputCsv, options: source.options, maxBudgetYocto: source.maxBudgetYocto,
      acceptanceCriteria: source.acceptanceCriteria, cleanBeforeProcessing: source.cleanBeforeProcessing,
      requiresHumanReview: source.requiresHumanReview ?? true, deadlineAt: now + 86400000,
    });
    // A fresh brief only: never copy execution state or settlement authority.
    return ctx.db.insert("missions", { ...input, ownerId: source.ownerId, state: "draft", createdAt: now, updatedAt: now });
  },
});
