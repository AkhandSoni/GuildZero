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
  args: { paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const ownerId = await requireUser(ctx);
    const paginationOpts = {
      ...args.paginationOpts,
      numItems: Math.max(1, Math.min(args.paginationOpts.numItems, 50)),
    };
    return ctx.db
      .query("missions")
      .withIndex("by_owner", (q) => q.eq("ownerId", ownerId))
      .order("desc")
      .paginate(paginationOpts);
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
