import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
const modules = import.meta.glob("../../convex/**/*.ts");
// Offline adapter fixtures. No real signer, signature, account, or RPC submission.
const transport = vi.hoisted(() => ({ rpc: vi.fn(), assertTestnet: vi.fn() }));
vi.mock("../../lib/settlement/rpc", () => ({
  ...transport,
  TESTNET_RPC: "https://rpc.testnet.near.org",
}));
vi.mock("near-api-js", () => ({
  Account: class {
    async createTransaction() {
      return { nonce: 7n };
    }
  },
  JsonRpcProvider: class {},
  KeyPairSigner: {
    fromSecretKey: () => ({
      getPublicKey: async () => ({}),
      signTransaction: async () => ({
        txHash: new Uint8Array(32),
        signedTransaction: { encode: () => new Uint8Array([1]) },
      }),
    }),
  },
  actions: { transfer: (amount: bigint) => ({ amount }) },
  baseEncode: () => "1".repeat(32),
}));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.resetAllMocks();
});
async function setup(approval: "automatic" | "human" = "automatic") {
  vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID", "operator.testnet");
  vi.stubEnv(
    "NEAR_AGENT_RECIPIENTS_JSON",
    JSON.stringify({ "stats-core": "worker.testnet" }),
  );
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "false");
  const t = testBackend(schema, modules);
  // Explicit database fixtures exercise policy/state only; no actual work/payment is claimed.
  const ids = await t.run(async (ctx) => {
    const owner = await ctx.db.insert("users", { email: "owner@example.com" }),
      other = await ctx.db.insert("users", { email: "other@example.com" });
    const missionId = await ctx.db.insert("missions", {
      ownerId: owner,
      title: "Payment policy fixture",
      serviceType: "csv_summary",
      inputCsv: "x\n1",
      maxBudgetYocto: "1000000000000000000000000",
      acceptanceCriteria: "fixture",
      deadlineAt: Date.now() + 100000,
      state: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const jobId = await ctx.db.insert("jobs", {
      ownerId: owner,
      missionId,
      depth: 0,
      serviceType: "csv_summary",
      inputCsv: "x\n1",
      options: { columns: ["x"] },
      budgetYocto: "1000000000000000000000000",
      reservedYocto: "500000000000000000000000",
      state: "approved",
      revisionCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const bidId = await ctx.db.insert("bids", {
      jobId,
      agentId: "stats-core",
      priceYocto: "500000000000000000000000",
      minimumYocto: "200000000000000000000000",
      etaMs: 100,
      rationale: "fixture",
      createdAt: Date.now(),
    });
    await ctx.db.insert("contracts", {
      jobId,
      agentId: "stats-core",
      bidId,
      amountYocto: "500000000000000000000000",
      holdbackYocto: "500000000000000000000000",
      state: "completed",
      selectionReason: "fixture",
      createdAt: Date.now(),
    });
    const deliverableId = await ctx.db.insert("deliverables", {
      jobId,
      attempt: 0,
      format: "json",
      content: '{"fixture":true}',
      createdAt: Date.now(),
    });
    await ctx.db.insert("verifications", {
      jobId,
      deliverableId,
      verdict: approval === "automatic" ? "pass" : "needs_human",
      checks: [
        {
          code: "TEST_ONLY",
          passed: true,
          detail: "Policy fixture, not real CSV verification",
        },
      ],
      createdAt: Date.now(),
    });
    if (approval === "human") await ctx.db.insert("disputes", {
      jobId, reason: "Explicit human approval fixture", decision: "approve",
      decidedBy: owner, decidedAt: Date.now(),
    });
    return { owner, other, jobId };
  });
  const owner = await asUser(t, ids.owner),
    other = await asUser(t, ids.other);
  const result = await owner.mutation(api.payments.prepare, {
    jobId: ids.jobId,
  });
  if (!result.ok) throw new Error(result.code);
  const intentId = result.intentId;
  const intent = (await owner.query(api.payments.forJob, {
    jobId: ids.jobId,
  }))!;
  return { t, ...ids, owner, other, intentId, intent };
}
it("reuses one exact intent for idempotent prepare calls", async () => {
  const s = await setup();
  const again = await s.owner.mutation(api.payments.prepare, {
    jobId: s.jobId,
  });
  expect(again).toEqual({ ok: true, intentId: s.intentId });
  expect(
    await s.t.run((ctx) => ctx.db.query("paymentIntents").collect()),
  ).toHaveLength(1);
  expect(s.intent.policyVersion).toBe("guildzero-testnet-v1");
  expect(s.intent.deliverableId).toBeTruthy();
  expect(s.intent.verificationId).toBeTruthy();
});
it("keeps payment records private and refuses substituted recipients/amounts before claim", async () => {
  const s = await setup();
  await expect(
    s.other.query(api.payments.forJob, { jobId: s.jobId }),
  ).rejects.toThrow();
  await expect(
    s.t.query(api.payments.forJob, { jobId: s.jobId }),
  ).rejects.toThrow();
  for (const change of [
    { recipient: "attacker.testnet" },
    { amountYocto: "900000000000000000000000" },
  ])
    expect(
      (
        await s.owner.mutation(api.payments.authorize, {
          intentId: s.intentId,
          recipient: s.intent.recipient,
          amountYocto: s.intent.amountYocto,
          ...change,
        })
      ).ok,
    ).toBe(false);
  expect(
    (await s.owner.query(api.payments.forJob, { jobId: s.jobId }))?.status,
  ).toBe("READY");
  expect(
    await s.t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(0);
  expect(
    (await s.owner.query(api.security.history, {})).filter(
      (e) => e.decision === "reject",
    ),
  ).toHaveLength(2);
});
it("requires credentials and owner approval, then atomically claims only once", async () => {
  const s = await setup();
  const args = {
    intentId: s.intentId,
    recipient: s.intent.recipient,
    amountYocto: s.intent.amountYocto,
  };
  expect(await s.owner.mutation(api.payments.authorize, args)).toMatchObject({
    ok: false,
    code: "SETTLEMENT_CONFIGURATION_REQUIRED",
  });
  expect(
    await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId }),
  ).toBe(null);
  await s.t.run((ctx) =>
    ctx.db.patch(s.intentId, { authorizedAt: Date.now() }),
  );
  const results = await Promise.all([
    s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId }),
    s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId }),
  ]);
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(1);
});
it("retains uncertain transactions/nonce lock and never reclaims a new transfer", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.intentId, { authorizedAt: Date.now() }),
  );
  await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId });
  await s.t.mutation(internal.paymentWorker.prepared, {
    intentId: s.intentId,
    txHash: "1".repeat(32),
    nonce: "7",
  });
  await s.t.mutation(internal.paymentWorker.outcome, { intentId: s.intentId });
  expect(
    (await s.owner.query(api.payments.forJob, { jobId: s.jobId }))?.status,
  ).toBe("UNKNOWN_RECONCILE");
  expect(
    await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId }),
  ).toBe(null);
  expect(
    (
      await s.owner.mutation(api.payments.authorize, {
        intentId: s.intentId,
        recipient: s.intent.recipient,
        amountYocto: s.intent.amountYocto,
      })
    ).ok,
  ).toBe(false);
  expect(
    await s.t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(1);
  expect(
    await s.owner.mutation(api.security.run, {
      jobId: s.jobId,
      scenario: "duplicate",
    }),
  ).toMatchObject({
    available: true,
    decision: "reject",
    signingAttempted: false,
  });
});
it("releases signer lock only after proven pre-broadcast nonexecution", async () => {
  const s = await setup();
  await s.t.run((ctx) =>
    ctx.db.patch(s.intentId, { authorizedAt: Date.now() }),
  );
  await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId });
  await s.t.mutation(internal.paymentWorker.outcome, {
    intentId: s.intentId,
    preBroadcastFailure: true,
  });
  expect(
    (await s.owner.query(api.payments.forJob, { jobId: s.jobId }))?.status,
  ).toBe("FAILED");
  expect(
    await s.t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(0);
});
it("records controlled attacks without arbitrary reputation/subcontract writes or signing", async () => {
  const s = await setup();
  for (const scenario of [
    "overspend",
    "recipient",
    "reputation",
    "subcontract",
  ] as const)
    expect(
      await s.owner.mutation(api.security.run, { jobId: s.jobId, scenario }),
    ).toMatchObject({
      available: true,
      decision: "reject",
      signingAttempted: false,
    });
  expect(
    await s.t.run((ctx) => ctx.db.query("reputationEvents").collect()),
  ).toHaveLength(0);
  expect(
    await s.t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(0);
  expect(
    (await s.owner.query(api.security.history, {})).filter((e) =>
      e.scenario.startsWith("CONTROLLED_PROBE"),
    ),
  ).toHaveLength(4);
});
it("rechecks final work approval immediately before claim", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    await ctx.db.patch(s.intentId, { authorizedAt: Date.now() });
    await ctx.db.patch(s.jobId, { state: "disputed" });
  });
  expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId })).toBe(null);
  expect(
    await s.t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(0);
  expect((await s.owner.query(api.security.history, {}))).toEqual(
    expect.arrayContaining([expect.objectContaining({ scenario: "CLAIM_PAYMENT", decision: "reject", reason: "WORK_NOT_APPROVED" })]),
  );
});
it("refuses changed approved output before owner authorization and before signing", async () => {
  const s = await setup();
  vi.stubEnv("NEAR_NETWORK", "testnet");
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true");
  vi.stubEnv("NEAR_PRIVATE_KEY", "not-a-key-offline-test-only");
  await s.t.run(async (ctx) => {
    const deliverableId = await ctx.db.insert("deliverables", {
      jobId: s.jobId, attempt: 1, format: "json", content: '{"fixture":"replacement"}',
      createdAt: Date.now() + 1,
    });
    await ctx.db.insert("verifications", {
      jobId: s.jobId, deliverableId, verdict: "pass", checks: [{ code: "FIXTURE", passed: true, detail: "Changed approval fixture" }], createdAt: Date.now() + 1,
    });
  });
  expect(await s.owner.mutation(api.payments.authorize, {
    intentId: s.intentId, recipient: s.intent.recipient, amountYocto: s.intent.amountYocto,
  })).toEqual({ ok: false, code: "PAYMENT_APPROVAL_CHANGED" });
  // Explicitly simulate an already-queued authorization seeing changed evidence.
  await s.t.run((ctx) => ctx.db.patch(s.intentId, { authorizedAt: Date.now() }));
  expect(await s.t.action(internal.nearSettlement.settle, { intentId: s.intentId }))
    .toEqual({ ok: false, code: "NOT_CLAIMABLE" });
  expect(transport.assertTestnet).not.toHaveBeenCalled();
  expect(transport.rpc).not.toHaveBeenCalled();
  expect(await s.t.run((ctx) => ctx.db.query("signerLocks").collect())).toEqual([]);
  expect((await s.owner.query(api.payments.forJob, { jobId: s.jobId }))?.authorizedAt).toBeUndefined();
  const audit = await s.owner.query(api.security.history, {});
  expect(audit.filter((e) => e.reason === "PAYMENT_APPROVAL_CHANGED")).toHaveLength(2);
});
it("rejects replacement verification identity even when contract, price and output match", async () => {
  const s = await setup();
  await s.t.run(async (ctx) => {
    const old = (await ctx.db.get(s.intent.verificationId!))!;
    await ctx.db.delete(old._id);
    await ctx.db.insert("verifications", {
      jobId: old.jobId, deliverableId: old.deliverableId, verdict: old.verdict,
      checks: old.checks, createdAt: Date.now(),
    });
    await ctx.db.patch(s.intentId, { authorizedAt: Date.now() });
  });
  expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId })).toBe(null);
  expect((await s.owner.query(api.payments.forJob, { jobId: s.jobId }))?.lastReason)
    .toBe("PAYMENT_APPROVAL_CHANGED");
  expect(await s.t.run((ctx) => ctx.db.query("signerLocks").collect())).toEqual([]);
});
it("keeps historical unbound intents readable but blocks authorization/claim without inventing provenance", async () => {
  const s = await setup();
  await s.t.run((ctx) => ctx.db.patch(s.intentId, {
    policyVersion: undefined, deliverableId: undefined, verificationId: undefined,
  }));
  expect(await s.owner.mutation(api.payments.authorize, {
    intentId: s.intentId, recipient: s.intent.recipient, amountYocto: s.intent.amountYocto,
  })).toEqual({ ok: false, code: "PAYMENT_APPROVAL_BINDING_REQUIRED" });
  await s.t.run((ctx) => ctx.db.patch(s.intentId, { authorizedAt: Date.now() }));
  expect(await s.t.mutation(internal.paymentWorker.claim, { intentId: s.intentId })).toBe(null);
  const retained = await s.owner.query(api.payments.forJob, { jobId: s.jobId });
  expect(retained?.status).toBe("READY");
  expect(retained?.deliverableId).toBeUndefined();
  expect(await s.owner.mutation(api.payments.prepare, { jobId: s.jobId }))
    .toEqual({ ok: true, intentId: s.intentId });
  expect(await s.t.run((ctx) => ctx.db.query("paymentIntents").collect())).toHaveLength(1);
  expect(await s.t.run((ctx) => ctx.db.query("signerLocks").collect())).toEqual([]);
});
it("binds human-approved work to its exact owner decision and refuses substituted dispute evidence", async () => {
  const legitimate = await setup("human");
  expect(legitimate.intent.disputeId).toBeTruthy();
  await legitimate.t.run((ctx) => ctx.db.patch(legitimate.intentId, { authorizedAt: Date.now() }));
  expect(await legitimate.t.mutation(internal.paymentWorker.claim, { intentId: legitimate.intentId }))
    .toMatchObject({ disputeId: legitimate.intent.disputeId, amountYocto: legitimate.intent.amountYocto });
  const changed = await setup("human");
  await changed.t.run(async (ctx) => {
    await ctx.db.delete(changed.intent.disputeId!);
    await ctx.db.insert("disputes", {
      jobId: changed.jobId, reason: "Replacement fixture", decision: "approve",
      decidedBy: changed.intent.ownerId, decidedAt: Date.now(),
    });
    await ctx.db.patch(changed.intentId, { authorizedAt: Date.now() });
  });
  expect(await changed.t.mutation(internal.paymentWorker.claim, { intentId: changed.intentId })).toBe(null);
  expect((await changed.owner.query(api.payments.forJob, { jobId: changed.jobId }))?.lastReason).toBe("PAYMENT_APPROVAL_CHANGED");
});
it("mock RPC adapter persists transaction identity before its single broadcast and confirms matching final receipts", async () => {
  const s = await setup();
  vi.stubEnv("NEAR_NETWORK", "testnet");
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true");
  vi.stubEnv("NEAR_PRIVATE_KEY", "not-a-key-offline-test-only");
  await s.t.run((ctx) =>
    ctx.db.patch(s.intentId, { authorizedAt: Date.now() }),
  );
  transport.assertTestnet.mockResolvedValue(undefined);
  transport.rpc.mockImplementation(async (method: string) => {
    if (method === "EXPERIMENTAL_protocol_config")
      return {
        runtime_config: { storage_amount_per_byte: "10000000000000000000" },
      };
    if (method === "query")
      return { amount: "10000000000000000000000000", storage_usage: 100 };
    if (method === "send_tx") {
      const stored = await s.owner.query(api.payments.forJob, {
        jobId: s.jobId,
      });
      expect(stored?.status).toBe("CONFIRMING");
      expect(stored?.txHash).toBe("1".repeat(32));
      return {
        final_execution_status: "FINAL",
        transaction: {
          hash: stored!.txHash,
          signer_id: s.intent.sender,
          receiver_id: s.intent.recipient,
          nonce: 7,
          actions: [{ Transfer: { deposit: s.intent.amountYocto } }],
        },
        transaction_outcome: { block_hash: "2".repeat(44) },
        status: { SuccessValue: "" },
        receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }],
      };
    }
    throw new Error("Unexpected test RPC call");
  });
  await s.t.action(internal.nearSettlement.settle, { intentId: s.intentId });
  expect(
    (await s.owner.query(api.payments.forJob, { jobId: s.jobId }))?.status,
  ).toBe("CONFIRMED");
  expect(
    transport.rpc.mock.calls.filter((c) => c[0] === "send_tx"),
  ).toHaveLength(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(0);
});
it("mock RPC timeout leaves an uncertain intent and prevents a second broadcast", async () => {
  const s = await setup();
  vi.stubEnv("NEAR_NETWORK", "testnet");
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true");
  vi.stubEnv("NEAR_PRIVATE_KEY", "not-a-key-offline-test-only");
  await s.t.run((ctx) =>
    ctx.db.patch(s.intentId, { authorizedAt: Date.now() }),
  );
  transport.assertTestnet.mockResolvedValue(undefined);
  transport.rpc.mockImplementation(async (method: string) => {
    if (method === "EXPERIMENTAL_protocol_config")
      return {
        runtime_config: { storage_amount_per_byte: "10000000000000000000" },
      };
    if (method === "query")
      return { amount: "10000000000000000000000000", storage_usage: 100 };
    throw new Error("Simulated timeout after attempted broadcast");
  });
  await s.t.action(internal.nearSettlement.settle, { intentId: s.intentId });
  await s.t.action(internal.nearSettlement.settle, { intentId: s.intentId });
  expect(
    (await s.owner.query(api.payments.forJob, { jobId: s.jobId }))?.status,
  ).toBe("UNKNOWN_RECONCILE");
  expect(
    transport.rpc.mock.calls.filter((c) => c[0] === "send_tx"),
  ).toHaveLength(1);
  expect(
    await s.t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(1);
});
