import { getAuthUserId } from "@convex-dev/auth/server";
import { ConvexError } from "convex/values";
import type { QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
export async function user(ctx: QueryCtx) {
  const id = await getAuthUserId(ctx);
  if (!id || !(await ctx.db.get(id))) throw new ConvexError("UNAUTHENTICATED");
  return id;
}
export async function ownedJob(ctx: QueryCtx, id: Id<"jobs">) {
  const ownerId = await user(ctx);
  const job = await ctx.db.get(id);
  if (!job || job.ownerId !== ownerId) throw new ConvexError("JOB_NOT_FOUND");
  return job;
}
