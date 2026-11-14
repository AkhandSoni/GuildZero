import { ConvexError, v } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { user } from "./ownership";
import { credentialDigest, mcpScope, MCP_DEFAULT_TTL, MCP_MAX_TTL, MCP_MAX_ACTIVE } from "./mcpPolicy";
import type { Id } from "./_generated/dataModel";
const createArgs = { label: v.string(), scopes: v.array(mcpScope), ttlSeconds: v.optional(v.number()), missionIds: v.optional(v.array(v.id("missions"))) };
export const storeCredential = internalMutation({
  args: { ...createArgs, digest: v.string(), clientId: v.string() },
  handler: async (ctx, args) => {
    const ownerId = await user(ctx);
    const owner = await ctx.db.get(ownerId);
    if (owner?.mcpDisabledAt !== undefined) throw new ConvexError("MCP_DISABLED");
    const label = args.label.trim(), ttl = args.ttlSeconds ?? MCP_DEFAULT_TTL;
    if (!label || label.length > 80 || !Number.isInteger(ttl) || ttl < 60 || ttl > MCP_MAX_TTL ||
      !args.scopes.length || args.scopes.length > 10 || new Set(args.scopes).size !== args.scopes.length ||
      !/^[0-9a-f]{64}$/.test(args.digest) || !/^[0-9a-f]{32}$/.test(args.clientId)) throw new ConvexError("INVALID_INPUT");
    if (args.missionIds && (!args.missionIds.length || args.missionIds.length > 50 || new Set(args.missionIds).size !== args.missionIds.length || args.scopes.includes("missions:create"))) throw new ConvexError("INVALID_MISSION_RESTRICTIONS");
    for (const id of args.missionIds ?? []) {
      const mission = await ctx.db.get(id);
      if (!mission || mission.ownerId !== ownerId) throw new ConvexError("MISSION_NOT_FOUND");
    }
    const active = await ctx.db.query("mcpIntegrations").withIndex("by_owner_active", q => q.eq("ownerId", ownerId).eq("active", true)).take(MCP_MAX_ACTIVE + 1);
    if (active.filter(row => row.expiresAt > Date.now()).length >= MCP_MAX_ACTIVE) throw new ConvexError("INTEGRATION_LIMIT");
    // Expired rows cease consuming active-list capacity; they remain retained audit history.
    for (const row of active) if (row.expiresAt <= Date.now()) await ctx.db.patch(row._id, {active: false});
    const now = Date.now(), expiresAt = now + ttl * 1000;
    const integrationId = await ctx.db.insert("mcpIntegrations", {ownerId, clientId: args.clientId, label, digest: args.digest, scopes: args.scopes, ...(args.missionIds ? {missionIds: args.missionIds} : {}), createdAt: now, expiresAt, active: true});
    return {integrationId, clientId: args.clientId, expiresAt};
  },
});
export const create = action({
  args: createArgs,
  handler: async (ctx, args): Promise<{integrationId: Id<"mcpIntegrations">; clientId: string; expiresAt: number; token: string}> => {
    const random = (bytes: number) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), value => value.toString(16).padStart(2, "0")).join("");
    const token = `gzmcp_${random(32)}`;
    const stored = await ctx.runMutation(internal.mcpCredentials.storeCredential, {...args, digest: await credentialDigest(token), clientId: random(16)});
    return {...stored, token};
  },
});
export const list = query({args: {}, handler: async ctx => {
  const ownerId = await user(ctx);
  const rows = await ctx.db.query("mcpIntegrations").withIndex("by_owner", q => q.eq("ownerId", ownerId)).order("desc").take(101);
  return {integrations: rows.slice(0,100).map(row => ({integrationId: row._id, clientId: row.clientId, label: row.label, scopes: row.scopes, missionIds: row.missionIds ?? null, createdAt: row.createdAt, expiresAt: row.expiresAt, revokedAt: row.revokedAt ?? null, active: row.active && row.expiresAt > Date.now()})), truncated: rows.length > 100};
}});
export const revoke = mutation({args: {integrationId: v.id("mcpIntegrations")}, handler: async (ctx, {integrationId}) => {
  const ownerId = await user(ctx), row = await ctx.db.get(integrationId);
  if (!row || row.ownerId !== ownerId) throw new ConvexError("INTEGRATION_NOT_FOUND");
  if (row.active) await ctx.db.patch(row._id, {active: false, revokedAt: Date.now()});
  return {ok: true};
}});
export const revokeAll = mutation({args: {}, handler: async ctx => {
  const ownerId = await user(ctx);
  const rows = await ctx.db.query("mcpIntegrations").withIndex("by_owner_active", q => q.eq("ownerId", ownerId).eq("active", true)).take(MCP_MAX_ACTIVE + 1);
  if (rows.length > MCP_MAX_ACTIVE) throw new ConvexError("INTEGRATION_STATE_REQUIRES_REVIEW");
  for (const row of rows) await ctx.db.patch(row._id, {active: false, revokedAt: Date.now()});
  return {ok: true, revoked: rows.length};
}});
