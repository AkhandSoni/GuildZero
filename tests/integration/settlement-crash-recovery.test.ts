// @vitest-environment node
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { afterEach, expect, it, vi } from "vitest";
import {
  KeyPair,
  baseEncode,
  decodeSignedTransaction,
} from "near-api-js";
import { testBackend, asUser } from "../helpers/backend";
import { api, internal } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import schema from "../../convex/schema";
import { INITIAL_AGENTS } from "../../lib/agents";
import {
  makeBid,
  rankBids,
  respondToCounteroffer,
  runService,
  verifyDeliverable,
} from "../../lib/economy";
import type { Offer, Result, ServiceOutput, ServiceRequest } from "../../lib/economy";

const modules = import.meta.glob("../../convex/**/*.ts");
const workerScript = fileURLToPath(
  new URL("../helpers/settlement-worker-subprocess.mjs", import.meta.url),
);
const BLOCK_HASH = "1".repeat(32);
const FINAL_BLOCK_HASH = "2".repeat(44);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

type CrashStage =
  | "none"
  | "pre_hash_access_key"
  | "post_hash_before_broadcast"
  | "during_send_tx_after_chain_accepts";

type SimulatedChain = {
  keyPair: ReturnType<typeof KeyPair.fromRandom>;
  accessKeyNonce: bigint;
  broadcasts: Array<{
    txHash: string;
    signerId: string;
    receiverId: string;
    nonce: string;
    deposit: string;
  }>;
  receipts: Map<string, Record<string, unknown>>;
};

function createChain(initialNonce = 277412163000005n): SimulatedChain {
  return {
    keyPair: KeyPair.fromRandom("ed25519"),
    accessKeyNonce: initialNonce,
    broadcasts: [],
    receipts: new Map(),
  };
}

async function runWorkerSubprocess(options: {
  t: ReturnType<typeof testBackend>;
  chain: SimulatedChain;
  intentId: Id<"paymentIntents">;
  action?: "settle" | "reconcile";
  crashStage?: CrashStage;
  env: Record<string, string>;
}): Promise<{
  code: number | null;
  signal: NodeJS.Signals | null;
  doneResult?: unknown;
}> {
  const {
    t,
    chain,
    intentId,
    action = "settle",
    crashStage = "none",
    env,
  } = options;
  return new Promise((resolvePromise, rejectPromise) => {
    let doneResult: unknown;
    const child = fork(workerScript, [], {
      execArgv: [],
      env: {
        ...process.env,
        ...env,
        WORKER_ACTION: action,
        WORKER_INTENT_ID: intentId,
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"],
    });

    child.on("error", rejectPromise);
    child.on("exit", (code, signal) => {
      resolvePromise({ code, signal, doneResult });
    });

    child.on("message", async (raw: unknown) => {
      if (!raw || typeof raw !== "object") return;
      const msg = raw as {
        id: number;
        type: string;
        kind?: "mutation" | "query";
        name?: string;
        args?: Record<string, unknown>;
        method?: string;
        params?: Record<string, unknown>;
        result?: unknown;
      };
      try {
        if (msg.type === "done") {
          doneResult = msg.result;
          child.send({ id: msg.id, ok: true, value: null });
          return;
        }
        if (msg.type === "convex") {
          let value: unknown;
          if (msg.name === "paymentWorker:claim") {
            value = await t.mutation(
              internal.paymentWorker.claim,
              msg.args as { intentId: Id<"paymentIntents"> },
            );
          } else if (msg.name === "paymentWorker:prepared") {
            value = await t.mutation(
              internal.paymentWorker.prepared,
              msg.args as {
                intentId: Id<"paymentIntents">;
                txHash: string;
                nonce: string;
              },
            );
            if (crashStage === "post_hash_before_broadcast") {
              child.kill("SIGKILL");
              return;
            }
          } else if (msg.name === "paymentWorker:outcome") {
            value = await t.mutation(
              internal.paymentWorker.outcome,
              msg.args as {
                intentId: Id<"paymentIntents">;
                receiptJson?: string;
                preBroadcastFailure?: boolean;
                preBroadcastReason?: string;
              },
            );
          } else if (msg.name === "paymentWorker:snapshot") {
            value = await t.query(
              internal.paymentWorker.snapshot,
              msg.args as { intentId: Id<"paymentIntents"> },
            );
          } else {
            throw new Error(`Unexpected Convex call: ${String(msg.name)}`);
          }
          if (child.connected) child.send({ id: msg.id, ok: true, value });
          return;
        }
        if (msg.type === "rpc_assert_testnet") {
          if (child.connected) child.send({ id: msg.id, ok: true, value: null });
          return;
        }
        if (msg.type === "rpc_call") {
          const method = msg.method;
          const params = msg.params ?? {};
          let value: unknown;
          if (method === "EXPERIMENTAL_protocol_config") {
            value = {
              runtime_config: { storage_amount_per_byte: "10000000000000000000" },
            };
          } else if (
            method === "query" &&
            params.request_type === "view_account"
          ) {
            value = {
              amount: "10000000000000000000000000",
              storage_usage: 100,
            };
          } else if (
            method === "query" &&
            params.request_type === "view_access_key"
          ) {
            if (crashStage === "pre_hash_access_key") {
              child.kill("SIGKILL");
              return;
            }
            value = {
              nonce: Number(chain.accessKeyNonce),
              permission: "FullAccess",
            };
          } else if (method === "block") {
            value = { header: { hash: BLOCK_HASH } };
          } else if (method === "send_tx") {
            const rawBytes = Buffer.from(
              String(params.signed_tx_base64),
              "base64",
            );
            const decoded = decodeSignedTransaction(rawBytes);
            const rawTxBytes = decoded.transaction.encode();
            const digest = createHash("sha256").update(rawTxBytes).digest();
            expect(
              chain.keyPair.verify(digest, decoded.signature.data),
            ).toBe(true);
            const txHash = baseEncode(digest);
            const txNonce = decoded.transaction.nonce;
            expect(txNonce).toBe(chain.accessKeyNonce + 1n);
            chain.accessKeyNonce = txNonce;
            const deposit = String(
              decoded.transaction.actions[0]?.transfer?.deposit ?? "",
            );
            chain.broadcasts.push({
              txHash,
              signerId: decoded.transaction.signerId,
              receiverId: decoded.transaction.receiverId,
              nonce: txNonce.toString(),
              deposit,
            });
            const receipt = {
              final_execution_status: "FINAL",
              transaction: {
                hash: txHash,
                signer_id: decoded.transaction.signerId,
                receiver_id: decoded.transaction.receiverId,
                nonce: txNonce.toString(),
                actions: [{ Transfer: { deposit } }],
              },
              transaction_outcome: { block_hash: FINAL_BLOCK_HASH },
              status: { SuccessValue: "" },
              receipts_outcome: [{ outcome: { status: { SuccessValue: "" } } }],
            };
            chain.receipts.set(txHash, receipt);
            if (crashStage === "during_send_tx_after_chain_accepts") {
              child.kill("SIGKILL");
              return;
            }
            value = receipt;
          } else if (method === "tx") {
            const found = chain.receipts.get(String(params.tx_hash));
            if (!found) throw new Error("RPC_RESULT_UNAVAILABLE");
            value = found;
          } else {
            throw new Error(`Unexpected RPC method: ${String(method)}`);
          }
          if (child.connected) child.send({ id: msg.id, ok: true, value });
        }
      } catch (error) {
        if (child.connected) {
          child.send({
            id: msg.id,
            ok: false,
            error: error instanceof Error ? error.message : "IPC_FAILURE",
          });
        }
      }
    });
  });
}

function configureTestnetEnv(chain: SimulatedChain) {
  const recipients = Object.fromEntries(
    INITIAL_AGENTS.filter((a) => a.capabilities.length).map((a) => [
      a.id,
      `${a.id}.guildzero.testnet`,
    ]),
  );
  const env = {
    NEAR_NETWORK: "testnet",
    NEAR_OPERATOR_ACCOUNT_ID: "operator.guildzero.testnet",
    NEAR_AGENT_RECIPIENTS_JSON: JSON.stringify(recipients),
    NEAR_SETTLEMENT_ENABLED: "true",
    ["NEAR_PRIVATE" + "_KEY"]: chain.keyPair.toString(),
  };
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  return env;
}

async function createApprovedJobFixture(
  t: ReturnType<typeof testBackend>,
  ownerId: Id<"users">,
  title: string,
  amountYocto: string,
) {
  return t.run(async (ctx) => {
    const missionId = await ctx.db.insert("missions", {
      ownerId,
      title,
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
      ownerId,
      missionId,
      depth: 0,
      serviceType: "csv_summary",
      inputCsv: "x\n1",
      options: { columns: ["x"] },
      budgetYocto: "1000000000000000000000000",
      reservedYocto: amountYocto,
      state: "approved",
      revisionCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    const bidId = await ctx.db.insert("bids", {
      jobId,
      agentId: "stats-core",
      priceYocto: amountYocto,
      minimumYocto: "100000000000000000000000",
      etaMs: 100,
      rationale: "fixture",
      createdAt: Date.now(),
    });
    await ctx.db.insert("contracts", {
      jobId,
      agentId: "stats-core",
      bidId,
      amountYocto,
      holdbackYocto: amountYocto,
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
      verdict: "pass",
      checks: [{ code: "FIXTURE", passed: true, detail: "Verified fixture" }],
      createdAt: Date.now(),
    });
    return jobId;
  });
}

it("retains signer lock and blocks duplicate/concurrent claims when worker process crashes with SIGKILL before txHash persistence", async () => {
  const chain = createChain();
  const env = configureTestnetEnv(chain);
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "crash-pre-hash@example.com" }),
  );
  const owner = await asUser(t, ownerId);
  const job1 = await createApprovedJobFixture(
    t,
    ownerId,
    "Pre-hash crash job 1",
    "400000000000000000000000",
  );
  const job2 = await createApprovedJobFixture(
    t,
    ownerId,
    "Concurrent job 2",
    "300000000000000000000000",
  );

  const prep1 = await owner.mutation(api.payments.prepare, { jobId: job1 });
  const prep2 = await owner.mutation(api.payments.prepare, { jobId: job2 });
  if (!prep1.ok || !prep2.ok) throw new Error("Expected prepared intents");

  await t.run(async (ctx) => {
    await ctx.db.patch(prep1.intentId, { authorizedAt: Date.now() });
    await ctx.db.patch(prep2.intentId, { authorizedAt: Date.now() });
  });

  const crashed = await runWorkerSubprocess({
    t,
    chain,
    intentId: prep1.intentId,
    crashStage: "pre_hash_access_key",
    env,
  });
  expect(crashed.signal).toBe("SIGKILL");
  expect(chain.broadcasts).toHaveLength(0);

  const intent1 = (await owner.query(api.payments.forJob, { jobId: job1 }))!;
  expect(intent1.status).toBe("SUBMITTING");
  expect(intent1.txHash).toBeUndefined();
  expect(intent1.nonce).toBeUndefined();
  expect(
    await t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toMatchObject([
    { sender: "operator.guildzero.testnet", intentId: prep1.intentId },
  ]);

  // Duplicate worker delivery and owner re-authorization fail closed without signing.
  const retryWorker = await runWorkerSubprocess({
    t,
    chain,
    intentId: prep1.intentId,
    env,
  });
  expect(retryWorker.signal).toBeNull();
  expect(retryWorker.doneResult).toEqual({ ok: false, code: "NOT_CLAIMABLE" });
  expect(
    await owner.mutation(api.payments.authorize, {
      intentId: prep1.intentId,
      recipient: intent1.recipient,
      amountYocto: intent1.amountYocto,
    }),
  ).toEqual({ ok: false, code: "DUPLICATE_OR_UNCERTAIN_PAYMENT" });
  await expect(
    owner.mutation(api.payments.reconcile, { intentId: prep1.intentId }),
  ).rejects.toThrow("NOT_RECONCILABLE");
  expect(
    await owner.mutation(api.security.run, {
      jobId: job1,
      scenario: "duplicate",
    }),
  ).toMatchObject({
    available: true,
    decision: "reject",
    reason: "DUPLICATE_OR_UNCERTAIN_PAYMENT",
    signingAttempted: false,
  });

  // Second authorized job cannot bypass the held signer lock.
  const secondWorker = await runWorkerSubprocess({
    t,
    chain,
    intentId: prep2.intentId,
    env,
  });
  expect(secondWorker.doneResult).toEqual({ ok: false, code: "NOT_CLAIMABLE" });
  const intent2 = (await owner.query(api.payments.forJob, { jobId: job2 }))!;
  expect(intent2.status).toBe("READY");
  expect(intent2.authorizedAt).toBeUndefined();
  expect(intent2.lastReason).toBe("SIGNER_BUSY_REAUTHORIZE_LATER");
  expect(chain.broadcasts).toHaveLength(0);
});

it("persists signed txHash and nonce before broadcast, survives post-hash SIGKILL without resending, and reconciles conservatively", async () => {
  const chain = createChain(277412163000010n);
  const env = configureTestnetEnv(chain);
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "crash-post-hash@example.com" }),
  );
  const owner = await asUser(t, ownerId);
  const jobUnbroadcast = await createApprovedJobFixture(
    t,
    ownerId,
    "Post-hash crash before broadcast",
    "250000000000000000000000",
  );
  const prepA = await owner.mutation(api.payments.prepare, {
    jobId: jobUnbroadcast,
  });
  if (!prepA.ok) throw new Error("Expected prepared intent");
  await t.run((ctx) =>
    ctx.db.patch(prepA.intentId, { authorizedAt: Date.now() }),
  );

  // Subcase A: SIGKILL immediately after `prepared` stores txHash + nonce, before send_tx reaches chain.
  const crashedBeforeSend = await runWorkerSubprocess({
    t,
    chain,
    intentId: prepA.intentId,
    crashStage: "post_hash_before_broadcast",
    env,
  });
  expect(crashedBeforeSend.signal).toBe("SIGKILL");
  expect(chain.broadcasts).toHaveLength(0);

  const afterCrashA = (await owner.query(api.payments.forJob, {
    jobId: jobUnbroadcast,
  }))!;
  expect(afterCrashA.status).toBe("CONFIRMING");
  expect(afterCrashA.txHash).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
  expect(afterCrashA.nonce).toBe("277412163000011");

  // Re-running settle after restart must not sign or broadcast a second transaction.
  const duplicateAfterRestart = await runWorkerSubprocess({
    t,
    chain,
    intentId: prepA.intentId,
    env,
  });
  expect(duplicateAfterRestart.doneResult).toEqual({
    ok: false,
    code: "NOT_CLAIMABLE",
  });
  expect(chain.broadcasts).toHaveLength(0);

  // Reconciling when chain has not seen the tx transitions to UNKNOWN_RECONCILE and retains the lock.
  const reconciledMissing = await runWorkerSubprocess({
    t,
    chain,
    intentId: prepA.intentId,
    action: "reconcile",
    env,
  });
  expect(reconciledMissing.doneResult).toEqual({ ok: false });
  const uncertainA = (await owner.query(api.payments.forJob, {
    jobId: jobUnbroadcast,
  }))!;
  expect(uncertainA.status).toBe("UNKNOWN_RECONCILE");
  expect(uncertainA.txHash).toBe(afterCrashA.txHash);
  expect(
    await t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toHaveLength(1);
});

it("recovers partial parent/child subcontract settlement across post-broadcast SIGKILL with monotonic access-key nonces and conserved budget", async () => {
  const chain = createChain(277412163000005n);
  const env = configureTestnetEnv(chain);
  const t = testBackend(schema, modules);
  const ownerId = await t.run((ctx) =>
    ctx.db.insert("users", { email: "partial-parent-child@example.com" }),
  );
  const owner = await asUser(t, ownerId);

  const missionId = await owner.mutation(api.missions.create, {
    title: "Parent/child crash recovery regression",
    serviceType: "csv_summary",
    inputCsv: "product,units,price\n Bag , 3 , 12.5 \nNotebook,5,4",
    options: { columns: ["units", "price"] },
    cleanBeforeProcessing: true,
    maxBudgetYocto: "1000000000000000000000000",
    acceptanceCriteria: "Exact summary after normalization subcontract.",
    deadlineAt: Date.now() + 86400000,
  });
  const parentJobId = await owner.mutation(api.jobs.start, { missionId });

  function unwrap<T>(r: Result<T>): T {
    if (!r.ok) throw new Error(r.message);
    return r.value;
  }

  async function runAuction(jobId: Id<"jobs">) {
    const context = await t.query(internal.workflow.pricingContext, { jobId });
    const nowMs = Date.now();
    const offers: Offer[] = [];
    const ids = new Map<string, Id<"bids">>();
    for (const agent of context.profiles.filter((a) =>
      a.capabilities.includes(context.job.serviceType),
    )) {
      const decision = unwrap(
        makeBid({
          agent,
          workload: {
            serviceType: context.job.serviceType,
            rowCount: 2,
            columnCount: 3,
            complexityBps: 0,
            riskBps: 0,
          },
          costModel: {
            baseCostYocto:
              context.job.depth === 0
                ? "250000000000000000000000"
                : "10000000000000000000000",
            perRowCostYocto: "1000000000000000000000",
            perCellCostYocto: "100000000000000000000",
          },
          activeAssignments: 0,
          budgetYocto: context.job.budgetYocto,
          nowMs,
          deadlineAtMs: nowMs + 86400000,
          estimatedDurationMs: 1000,
          bidId: `${jobId}:${agent.id}`,
        }),
      );
      if (decision.decision !== "offer") continue;
      const offer = decision.offer;
      const bidId = await t.mutation(internal.workflow.recordBid, {
        jobId,
        agentId: offer.agentId,
        priceYocto: offer.priceYocto,
        minimumYocto: offer.minimumAcceptableYocto,
        etaMs: offer.etaMs,
        rationale: offer.explanation,
      });
      ids.set(offer.bidId, bidId);
      offers.push(offer);
    }
    const ranked = unwrap(
      rankBids({
        budgetYocto: context.job.budgetYocto,
        availableDurationMs: 86400000,
        offers,
        reputationBps: offers.map(() => 5000),
        capabilityMatchBps: offers.map(() => 10000),
      }),
    );
    const offer = ranked[0].offer;
    const bidId = ids.get(offer.bidId)!;
    if (context.job.depth === 0) {
      const buyerOfferYocto = (
        (BigInt(offer.priceYocto) * 98n) /
        100n
      ).toString();
      await t.mutation(internal.workflow.negotiate, {
        bidId,
        round: 2,
        actorRole: "buyer",
        action: "counter",
        priceYocto: buyerOfferYocto,
        explanation: "Deterministic buyer counter.",
      });
      const decision = unwrap(
        respondToCounteroffer({
          currentOffer: offer,
          round: 3,
          buyerOfferYocto,
          budgetYocto: context.job.budgetYocto,
          sellerMinimumYocto: offer.minimumAcceptableYocto,
        }),
      );
      await t.mutation(internal.workflow.negotiate, {
        bidId,
        round: 3,
        actorRole: "seller",
        action: decision.action,
        priceYocto: decision.priceYocto,
        explanation: decision.explanation,
      });
    }
    await t.mutation(internal.workflow.award, {
      bidId,
      selectionReason: `Score ${ranked[0].totalScore}; ${ranked[0].tieBreakExplanation}`,
    });
  }

  async function completeService(jobId: Id<"jobs">, output: ServiceOutput, req: ServiceRequest) {
    const context = await t.query(internal.workflow.executionContext, { jobId });
    const deliverableId = await t.mutation(internal.workflow.submit, {
      jobId,
      format: output.format,
      content:
        output.serviceType === "csv_normalize"
          ? output.csv
          : JSON.stringify(output),
      ...(context.dependencyDeliverableId
        ? { dependencyDeliverableId: context.dependencyDeliverableId }
        : {}),
    });
    const verification = unwrap(
      verifyDeliverable({ request: req, deliverable: output }),
    );
    await t.mutation(internal.workflow.recordVerification, {
      deliverableId,
      verdict: verification.verdict,
      checks: [...verification.checks],
    });
  }

  await runAuction(parentJobId);
  const childJobId = await t.mutation(internal.workflow.subcontract, {
    parentId: parentJobId,
    budgetYocto: "120000000000000000000000",
    options: { columns: ["product", "units", "price"], caseMode: "preserve" },
  });
  await runAuction(childJobId);

  const childCtx = await t.query(internal.workflow.executionContext, {
    jobId: childJobId,
  });
  const childReq: ServiceRequest = {
    serviceType: "csv_normalize",
    inputCsv: childCtx.inputCsv,
    options: { columns: childCtx.job.options.columns, caseMode: "preserve" },
  };
  await completeService(childJobId, unwrap(runService(childReq)), childReq);

  const parentCtx = await t.query(internal.workflow.executionContext, {
    jobId: parentJobId,
  });
  const parentReq: ServiceRequest = {
    serviceType: "csv_summary",
    inputCsv: parentCtx.inputCsv,
    options: { columns: parentCtx.job.options.columns },
  };
  await completeService(parentJobId, unwrap(runService(parentReq)), parentReq);

  const parentPrep = await owner.mutation(api.payments.prepare, {
    jobId: parentJobId,
  });
  const childPrep = await owner.mutation(api.payments.prepare, {
    jobId: childJobId,
  });
  if (!parentPrep.ok || !childPrep.ok)
    throw new Error("Expected parent and child payment intents");

  const parentDetail = await owner.query(api.jobs.detail, { id: parentJobId });
  const childDetailInitial = await owner.query(api.jobs.detail, {
    id: childJobId,
  });
  expect(parentDetail.delivery).toMatchObject({
    released: false,
    confirmedPayments: 0,
    requiredPayments: 2,
  });
  expect(parentDetail.deliverables[0].content).toBeNull();
  expect(childDetailInitial.deliverables[0].content).toBeNull();
  const parentIntentInitial = (await owner.query(api.payments.forJob, {
    jobId: parentJobId,
  }))!;
  const childIntentInitial = (await owner.query(api.payments.forJob, {
    jobId: childJobId,
  }))!;
  expect(
    BigInt(parentIntentInitial.amountYocto) +
      BigInt(childIntentInitial.amountYocto),
  ).toBe(BigInt(parentDetail.job.reservedYocto));

  // Settle parent first in a worker subprocess (nonce 277412163000006).
  await t.run(async (ctx) => {
    await ctx.db.patch(parentPrep.intentId, { authorizedAt: Date.now() });
    await ctx.db.patch(childPrep.intentId, { authorizedAt: Date.now() });
  });
  const parentSettled = await runWorkerSubprocess({
    t,
    chain,
    intentId: parentPrep.intentId,
    env,
  });
  expect(parentSettled.signal).toBeNull();
  expect(parentSettled.doneResult).toMatchObject({ ok: true });

  const parentAfter = (await owner.query(api.payments.forJob, {
    jobId: parentJobId,
  }))!;
  expect(parentAfter.status).toBe("CONFIRMED");
  expect(parentAfter.nonce).toBe("277412163000006");
  expect(parentAfter.blockHash).toBe(FINAL_BLOCK_HASH);

  // Delivery gate remains locked after only the parent confirms.
  const parentAfterOnlyParent = await owner.query(api.jobs.detail, {
    id: parentJobId,
  });
  const childAfterOnlyParent = await owner.query(api.jobs.detail, {
    id: childJobId,
  });
  expect(parentAfterOnlyParent.delivery).toMatchObject({
    released: false,
    confirmedPayments: 1,
    requiredPayments: 2,
  });
  expect(parentAfterOnlyParent.deliverables[0].content).toBeNull();
  expect(childAfterOnlyParent.deliverables[0].content).toBeNull();
  expect(
    parentAfterOnlyParent.events.filter(
      (e) => e.type === "DELIVERABLE_RELEASED",
    ),
  ).toHaveLength(0);
  expect(
    childAfterOnlyParent.events.filter(
      (e) => e.type === "DELIVERABLE_RELEASED",
    ),
  ).toHaveLength(0);

  // Now child worker runs with incremented access-key nonce (277412163000007), broadcasts, and gets killed with SIGKILL before outcome.
  const childCrashed = await runWorkerSubprocess({
    t,
    chain,
    intentId: childPrep.intentId,
    crashStage: "during_send_tx_after_chain_accepts",
    env,
  });
  expect(childCrashed.signal).toBe("SIGKILL");
  expect(chain.broadcasts).toHaveLength(2);
  expect(chain.broadcasts.map((b) => b.nonce)).toEqual([
    "277412163000006",
    "277412163000007",
  ]);

  // Partial settlement state: parent is CONFIRMED, child is CONFIRMING and holds signerLocks; delivery stays locked.
  const childMid = (await owner.query(api.payments.forJob, {
    jobId: childJobId,
  }))!;
  expect(childMid.status).toBe("CONFIRMING");
  expect(childMid.nonce).toBe("277412163000007");
  expect(childMid.txHash).toBe(chain.broadcasts[1].txHash);
  expect(
    (await owner.query(api.jobs.detail, { id: parentJobId })).delivery,
  ).toMatchObject({
    released: false,
    confirmedPayments: 1,
    requiredPayments: 2,
  });
  expect(
    (await owner.query(api.jobs.detail, { id: parentJobId })).deliverables[0]
      .content,
  ).toBeNull();
  expect(
    (await owner.query(api.jobs.detail, { id: childJobId })).deliverables[0]
      .content,
  ).toBeNull();
  expect(
    await t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toMatchObject([
    { sender: "operator.guildzero.testnet", intentId: childPrep.intentId },
  ]);

  // Neither parent nor child can be re-authorized or re-claimed.
  for (const [jobId, intent] of [
    [parentJobId, parentAfter],
    [childJobId, childMid],
  ] as const) {
    expect(
      await owner.mutation(api.payments.authorize, {
        intentId: intent._id,
        recipient: intent.recipient,
        amountYocto: intent.amountYocto,
      }),
    ).toEqual({ ok: false, code: "DUPLICATE_OR_UNCERTAIN_PAYMENT" });
    expect(
      await owner.mutation(api.security.run, { jobId, scenario: "duplicate" }),
    ).toMatchObject({
      available: true,
      decision: "reject",
      reason: "DUPLICATE_OR_UNCERTAIN_PAYMENT",
      signingAttempted: false,
    });
  }

  // Reconcile the child's stored txHash on a restarted worker: verifies the receipt and releases signerLocks + deliverables.
  const childReconciled = await runWorkerSubprocess({
    t,
    chain,
    intentId: childPrep.intentId,
    action: "reconcile",
    env,
  });
  expect(childReconciled.signal).toBeNull();
  expect(childReconciled.doneResult).toEqual({ ok: true });

  const childFinal = (await owner.query(api.payments.forJob, {
    jobId: childJobId,
  }))!;
  expect(childFinal.status).toBe("CONFIRMED");
  expect(childFinal.nonce).toBe("277412163000007");
  expect(childFinal.blockHash).toBe(FINAL_BLOCK_HASH);
  expect(chain.broadcasts).toHaveLength(2);
  expect(
    await t.run((ctx) => ctx.db.query("signerLocks").collect()),
  ).toEqual([]);
  expect(
    BigInt(parentAfter.amountYocto) + BigInt(childFinal.amountYocto),
  ).toBe(BigInt(parentDetail.job.reservedYocto));

  const parentReleased = await owner.query(api.jobs.detail, {
    id: parentJobId,
  });
  const childReleased = await owner.query(api.jobs.detail, { id: childJobId });
  expect(parentReleased.delivery).toMatchObject({
    released: true,
    confirmedPayments: 2,
    requiredPayments: 2,
  });
  expect(
    JSON.parse(parentReleased.deliverables[0].content!).columns,
  ).toMatchObject([
    { name: "units", sum: 8 },
    { name: "price", sum: 16.5 },
  ]);
  expect(childReleased.deliverables[0].content).toBe(
    "product,units,price\nBag,3,12.5\nNotebook,5,4",
  );
  expect(
    parentReleased.events.filter((e) => e.type === "DELIVERABLE_RELEASED"),
  ).toHaveLength(1);
  expect(
    childReleased.events.filter((e) => e.type === "DELIVERABLE_RELEASED"),
  ).toHaveLength(1);

  // Repeated reconciliation / outcome delivery does not emit duplicate DELIVERABLE_RELEASED events.
  await runWorkerSubprocess({
    t,
    chain,
    intentId: childPrep.intentId,
    action: "reconcile",
    env,
  });
  await t.mutation(internal.paymentWorker.outcome, {
    intentId: childPrep.intentId,
    receiptJson: JSON.stringify(chain.receipts.get(childFinal.txHash!)!),
  });
  expect(
    (await owner.query(api.jobs.detail, { id: parentJobId })).events.filter(
      (e) => e.type === "DELIVERABLE_RELEASED",
    ),
  ).toHaveLength(1);
  expect(
    (await owner.query(api.jobs.detail, { id: childJobId })).events.filter(
      (e) => e.type === "DELIVERABLE_RELEASED",
    ),
  ).toHaveLength(1);
});
