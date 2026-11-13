import { describe, expect, it } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import schema from "../../convex/schema";
import type { Id } from "../../convex/_generated/dataModel";
import { api, internal } from "../../convex/_generated/api";
const modules = import.meta.glob("../../convex/**/*.ts");
const secret = "PRIVATE_DATASET_MARKER";
const confirmation = { confirm: "REMOVE_DATASET_AND_OUTPUTS" as const };
// Explicit database policy fixtures: these are not real work or chain receipts.
async function setup(child = false) {
  const t = testBackend(schema, modules);
  const ids = await t.run(async ctx => {
    const ownerId = await ctx.db.insert("users", { email: "retention@example.com" });
    const otherId = await ctx.db.insert("users", { email: "other@example.com" });
    const missionId = await ctx.db.insert("missions", { ownerId, title: secret, acceptanceCriteria: secret, inputCsv: secret, options: { columns: [secret] }, serviceType: "csv_summary", state: "active", maxBudgetYocto: "100", deadlineAt: Date.now() + 100000, createdAt: 1, updatedAt: 1 });
    const jobs = [];
    for (let i = 0; i < (child ? 2 : 1); i++) {
      const jobId: Id<"jobs"> = await ctx.db.insert("jobs", { ownerId, missionId, depth: i as 0 | 1, ...(i ? { parentId: jobs[0].jobId } : {}), serviceType: "csv_summary", state: "approved", inputCsv: secret, options: { columns: [secret] }, workerError: secret, budgetYocto: "100", reservedYocto: "50", revisionCount: 0, createdAt: 1, updatedAt: 1 });
      const bidId = await ctx.db.insert("bids", { jobId, agentId: "stats-core", priceYocto: "50", minimumYocto: "20", etaMs: 1, rationale: secret, createdAt: 1 });
      const contractId = await ctx.db.insert("contracts", { jobId, bidId, agentId: "stats-core", amountYocto: "50", holdbackYocto: "50", state: "completed", selectionReason: secret, createdAt: 1 });
      const deliverableId = await ctx.db.insert("deliverables", { jobId, attempt: 0, format: "json", content: secret, verificationPayload: secret, createdAt: 1 });
      const verificationId = await ctx.db.insert("verifications", { jobId, deliverableId, verdict: "pass", checks: [{ code: "VALID", passed: true, detail: secret }], createdAt: 1 });
      await ctx.db.insert("disputes", { jobId, reason: secret, decision: "approve", decidedBy: ownerId, decidedAt: 1 });
      await ctx.db.insert("negotiations", { jobId, bidId, round: 1, action: "accept", priceYocto: "50", explanation: secret });
      await ctx.db.insert("economyEvents", { jobId, missionId, ownerId, type: "WORK_APPROVED", detail: secret, createdAt: 1 });
      await ctx.db.insert("securityEvents", { jobId, ownerId, scenario: "CHAIN_RESULT", decision: "allow", reason: secret, createdAt: 1 });
      const intentId = await ctx.db.insert("paymentIntents", { jobId, contractId, deliverableId, verificationId, policyVersion: "guildzero-testnet-v1", ownerId, sender: "operator.testnet", recipient: "worker.testnet", amountYocto: "50", network: "testnet", status: "CONFIRMED", txHash: "fixture-hash", nonce: "1", blockHash: "fixture-block", createdAt: 1 });
      jobs.push({ jobId, intentId, contractId, deliverableId, verificationId });
    }
    return { ownerId, otherId, missionId, jobs };
  });
  return { t, ...ids, owner: await asUser(t, ids.ownerId), other: await asUser(t, ids.otherId) };
}
describe("owner dataset retention", () => {
  it("denies anonymous and cross-owner reads/removal", async () => {
    const s = await setup();
    for (const actor of [s.t, s.other]) {
      await expect(actor.query(api.retention.status, { missionId: s.missionId })).rejects.toThrow();
      await expect(actor.mutation(api.retention.removeContent, { missionId: s.missionId, ...confirmation })).rejects.toThrow();
    }
    expect((await s.owner.query(api.missions.get, { id: s.missionId })).inputCsv).toBe(secret);
  });
  it("atomically redacts every private text copy in parent and child, retaining exact financial rows and identities", async () => {
    const s = await setup(true);
    const original = await s.t.run(ctx => ctx.db.query("paymentIntents").collect());
    expect((await s.owner.query(api.retention.status, { missionId: s.missionId })).eligible).toBe(true);
    await s.owner.mutation(api.retention.removeContent, { missionId: s.missionId, ...confirmation });
    const dump = await s.t.run(async ctx => ({
      missions: await ctx.db.query("missions").collect(), jobs: await ctx.db.query("jobs").collect(),
      bids: await ctx.db.query("bids").collect(), contracts: await ctx.db.query("contracts").collect(),
      deliverables: await ctx.db.query("deliverables").collect(), verifications: await ctx.db.query("verifications").collect(),
      disputes: await ctx.db.query("disputes").collect(), negotiations: await ctx.db.query("negotiations").collect(),
      events: await ctx.db.query("economyEvents").collect(), security: await ctx.db.query("securityEvents").collect(),
      payments: await ctx.db.query("paymentIntents").collect(),
    }));
    expect(JSON.stringify(dump)).not.toContain(secret);
    expect(dump.payments).toEqual(original);
    expect(dump.jobs).toHaveLength(2);
    expect(dump.deliverables.map(d => d._id)).toEqual(s.jobs.map(j => j.deliverableId));
    expect(dump.verifications.every(v => v.verdict === "pass")).toBe(true);
    await s.owner.mutation(api.retention.removeContent, { missionId: s.missionId, ...confirmation });
    expect(await s.t.run(ctx => ctx.db.query("economyEvents").collect())).toHaveLength(3);
    await expect(s.owner.mutation(api.missions.duplicate, { id: s.missionId })).rejects.toThrow("DATASET_REMOVED");
    await expect(s.owner.mutation(api.jobs.start, { missionId: s.missionId })).rejects.toThrow("DATASET_REMOVED");
    // Reauthorization cannot reconstruct a quote even if a stale scheduler tries.
    await s.t.run(ctx => ctx.db.patch(s.jobs[0].intentId, { status: "READY", authorizedAt: 1 }));
    expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: s.jobs[0].intentId })).toBeNull();
  });
  it.each(["READY", "SUBMITTING", "CONFIRMING", "UNKNOWN_RECONCILE", "FAILED"] as const)("blocks %s without changing data", async status => {
    const s = await setup();
    await s.t.run(ctx => ctx.db.patch(s.jobs[0].intentId, { status }));
    await expect(s.owner.mutation(api.retention.removeContent, { missionId: s.missionId, ...confirmation })).rejects.toThrow();
    expect((await s.owner.query(api.missions.get, { id: s.missionId })).inputCsv).toBe(secret);
  });
  it.each(["bidding", "working", "verifying", "revision", "disputed"] as const)("blocks %s including child work", async state => {
    const s = await setup(true);
    await s.t.run(ctx => ctx.db.patch(s.jobs[1].jobId, { state }));
    await expect(s.owner.mutation(api.retention.removeContent, { missionId: s.missionId, ...confirmation })).rejects.toThrow();
    expect((await s.owner.query(api.missions.get, { id: s.missionId })).inputCsv).toBe(secret);
  });
  it("blocks missing/unbound/changed amount receipts and locks", async () => {
    for (const change of [{ policyVersion: undefined }, { amountYocto: "49" }, { blockHash: undefined }, { deliverableId: undefined }, { disputeId: "unexpected" }]) {
      const s = await setup();
      // Validator-safe alternatives only; a dispute ID is generated for mismatch.
      await s.t.run(async ctx => {
        const patch = change.disputeId ? { disputeId: (await ctx.db.query("disputes").first())!._id } : change;
        await ctx.db.patch(s.jobs[0].intentId, patch as Parameters<typeof ctx.db.patch<"paymentIntents">>[1]);
      });
      expect((await s.owner.query(api.retention.status, { missionId: s.missionId })).eligible).toBe(false);
    }
    const s = await setup();
    await s.t.run(ctx => ctx.db.insert("signerLocks", { sender: "operator.testnet", intentId: s.jobs[0].intentId }));
    await expect(s.owner.mutation(api.retention.removeContent, { missionId: s.missionId, ...confirmation })).rejects.toThrow();
  });
  it("requires recorded exact owner approval for human-reviewed work", async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      await ctx.db.patch(s.jobs[0].verificationId, { verdict: "needs_human" });
    });
    expect((await s.owner.query(api.retention.status, { missionId: s.missionId })).eligible).toBe(false);
    await s.t.run(async ctx => {
      const dispute = (await ctx.db.query("disputes").first())!;
      await ctx.db.patch(s.jobs[0].intentId, { disputeId: dispute._id });
    });
    expect((await s.owner.query(api.retention.status, { missionId: s.missionId })).eligible).toBe(true);
    await s.owner.mutation(api.retention.removeContent, { missionId: s.missionId, ...confirmation });
  });
  it("refuses missing obligations and active contracts even when a job is terminal", async () => {
    const s = await setup();
    await s.t.run(ctx => ctx.db.patch(s.jobs[0].contractId, { state: "active" }));
    expect((await s.owner.query(api.retention.status, { missionId: s.missionId })).eligible).toBe(false);
    await s.t.run(async ctx => { await ctx.db.delete(s.jobs[0].contractId); await ctx.db.delete(s.jobs[0].intentId); });
    expect((await s.owner.query(api.retention.status, { missionId: s.missionId })).eligible).toBe(false);
  });
  it("permits unawarded/cancelled groups without obligations, blocks drafts and oversized histories", async () => {
    const s = await setup();
    await s.t.run(async ctx => {
      await ctx.db.delete(s.jobs[0].intentId); await ctx.db.delete(s.jobs[0].contractId);
      await ctx.db.patch(s.jobs[0].jobId, { state: "cancelled" });
    });
    await s.owner.mutation(api.retention.removeContent, { missionId: s.missionId, ...confirmation });
    const oversized = await setup();
    await oversized.t.run(async ctx => { for (let i = 0; i < 201; i++) await ctx.db.insert("economyEvents", { ownerId: oversized.ownerId, jobId: oversized.jobs[0].jobId, missionId: oversized.missionId, type: "FIXTURE", detail: secret, createdAt: 1 }); });
    expect((await oversized.owner.query(api.retention.status, { missionId: oversized.missionId })).eligible).toBe(false);
    await expect(oversized.owner.mutation(api.retention.removeContent, { missionId: oversized.missionId, ...confirmation })).rejects.toThrow();
  });
});
