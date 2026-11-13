import { v } from "convex/values";
import { query, mutation, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { user } from "./ownership";
import { testnetAccount } from "../lib/settlement/policy";
function sender() {
  const account = process.env.NEAR_OPERATOR_ACCOUNT_ID ?? "";
  return process.env.NEAR_NETWORK === "testnet" && testnetAccount(account) ? account : null;
}
export const get = query({
  args: {}, handler: async (ctx) => {
    await user(ctx);
    const account = sender();
    const snapshot = account ? await ctx.db.query("operatorWalletSnapshots").withIndex("by_account", q => q.eq("account", account)).unique() : null;
    return { account, snapshot };
  },
});
export const refresh = mutation({
  args: {}, handler: async (ctx) => {
    await user(ctx);
    const account = sender();
    if (!account) return { ok: false, code: "Operator account is not configured for testnet." };
    const prior = await ctx.db.query("operatorWalletSnapshots").withIndex("by_account", q => q.eq("account", account)).unique();
    const requestedAt = Date.now();
    if (prior && requestedAt - prior.requestedAt < 30000) return { ok: false, code: "Balance refresh is limited to once every 30 seconds. The last reading remains visible." };
    const id = prior?._id ?? await ctx.db.insert("operatorWalletSnapshots", { account, requestedAt, pending: true });
    if (prior) await ctx.db.patch(id, { requestedAt, pending: true, error: undefined });
    await ctx.scheduler.runAfter(0, internal.operatorWalletActions.read, { id, account, requestedAt });
    return { ok: true };
  },
});
export const finish = internalMutation({
  args: { id: v.id("operatorWalletSnapshots"), account: v.string(), requestedAt: v.number(), result: v.optional(v.object({ liquidYocto: v.string(), lockedYocto: v.string(), totalYocto: v.string(), storageYocto: v.string(), availableYocto: v.string(), blockHeight: v.number(), blockHash: v.string() })) },
  handler: async (ctx, { id, account, requestedAt, result }) => {
    const current = await ctx.db.get(id);
    if (!current || current.account !== account || current.requestedAt !== requestedAt || sender() !== account) return;
    await ctx.db.patch(id, result ? { ...result, checkedAt: Date.now(), pending: false, error: undefined } : { pending: false, error: "Could not read NEAR testnet. Any previous balance below is the last successful reading." });
  },
});
