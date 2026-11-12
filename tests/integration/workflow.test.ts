import { convexTest } from "convex-test";
import { expect, it } from "vitest";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { SAMPLE_CSV } from "../../lib/missions";
import { runService, verifyDeliverable, type ServiceRequest } from "../../lib/economy";
const modules = import.meta.glob("../../convex/**/*.ts");
const positiveChecks = [
  {
    code: "EXPLICIT_TEST_VERIFIER",
    passed: true,
    detail: "Lifecycle fixture, not executed CSV verification",
  },
];
async function setup() {
  const t = convexTest(schema, modules);
  const [a, b] = await t.run(async (ctx) =>
    Promise.all([
      ctx.db.insert("users", { email: "a@example.com" }),
      ctx.db.insert("users", { email: "b@example.com" }),
    ]),
  );
  const alice = t.withIdentity({ subject: `${a}|a` }),
    bob = t.withIdentity({ subject: `${b}|b` });
  const input = {
    title: "Summary",
    inputCsv: SAMPLE_CSV,
    serviceType: "csv_summary" as const,
    options: { columns: ["units", "price"] },
    maxBudgetYocto: "10000000000000000000000000",
    acceptanceCriteria: "Summary",
    deadlineAt: Date.now() + 86400000,
  };
  const missionId = await alice.mutation(api.missions.create, input);
  const options = { columns: ["units", "price"] };
  const jobId = await alice.mutation(api.jobs.start, { missionId, options });
  const bid = async (
    agentId = "stats-core",
    id = jobId,
    priceYocto = "1000000000000000000000000",
  ) =>
    t.mutation(internal.workflow.recordBid, {
      jobId: id,
      agentId,
      priceYocto,
      minimumYocto: "500000000000000000000000",
      etaMs: 1000,
      rationale: "Explicit trusted test worker input; not an executed auction.",
    });
  return { t, alice, bob, missionId, jobId, input, options, bid };
}
it("starts idempotently and freezes mission edits/deletion", async () => {
  const s = await setup();
  expect(
    await s.alice.mutation(api.jobs.start, {
      missionId: s.missionId,
      options: s.options,
    }),
  ).toBe(s.jobId);
  await expect(
    s.alice.mutation(api.jobs.start, {
      missionId: s.missionId,
      options: { columns: ["units"] },
    }),
  ).rejects.toThrow("START_OPTIONS_CHANGED");
  await expect(
    s.alice.mutation(api.missions.update, { id: s.missionId, ...s.input }),
  ).rejects.toThrow("MISSION_ALREADY_STARTED");
  await expect(
    s.alice.mutation(api.missions.remove, { id: s.missionId }),
  ).rejects.toThrow("MISSION_ALREADY_STARTED");
});
it("denies anonymous and cross-user job controls, history and mission lookup", async () => {
  const s = await setup();
  for (const caller of [s.t, s.bob]) {
    await expect(
      caller.query(api.jobs.detail, { id: s.jobId }),
    ).rejects.toThrow();
    await expect(
      caller.query(api.jobs.forMission, { missionId: s.missionId }),
    ).rejects.toThrow();
    await expect(
      caller.mutation(api.jobs.start, {
        missionId: s.missionId,
        options: s.options,
      }),
    ).rejects.toThrow();
    await expect(
      caller.mutation(api.jobs.cancel, { id: s.jobId }),
    ).rejects.toThrow();
    await expect(
      caller.mutation(api.jobs.resolveDispute, {
        id: s.jobId,
        decision: "approve",
        reason: "forged",
      }),
    ).rejects.toThrow();
  }
});
it("rejects nonexistent columns and does not lock an invalid draft", async () => {
  const s = await setup();
  const id = await s.alice.mutation(api.missions.create, s.input);
  await expect(
    s.alice.mutation(api.jobs.start, {
      missionId: id,
      options: { columns: ["unknown"] },
    }),
  ).rejects.toThrow("INVALID_COLUMNS");
  expect((await s.alice.query(api.missions.get, { id })).state).toBe("draft");
});
it("validates capability, money, deadlines and idempotent bid retries", async () => {
  const s = await setup();
  await expect(s.bid("adversary")).rejects.toThrow("CAPABILITY_MISMATCH");
  await expect(
    s.bid("stats-core", s.jobId, "10000000000000000000000001"),
  ).rejects.toThrow("BID_OUT_OF_BOUNDS");
  await expect(s.bid("stats-core", s.jobId, "-1")).rejects.toThrow(
    "INVALID_AMOUNT",
  );
  const id = await s.bid();
  expect(await s.bid()).toBe(id);
  await expect(
    s.bid("stats-core", s.jobId, "2000000000000000000000000"),
  ).rejects.toThrow("BID_RETRY_CHANGED");
});
it("enforces negotiation ordering, accepted offers and the three-round cap", async () => {
  const s = await setup();
  const bidId = await s.bid();
  const round = {
    bidId,
    actorRole: "buyer" as const,
    round: 2,
    action: "counter" as const,
    priceYocto: "900000000000000000000000",
    explanation: "counter",
  };
  await expect(
    s.t.mutation(internal.workflow.negotiate, { ...round, round: 4 }),
  ).rejects.toThrow("ROUND_LIMIT");
  await expect(
    s.t.mutation(internal.workflow.negotiate, { ...round, round: 3 }),
  ).rejects.toThrow("OUT_OF_ORDER");
  await s.t.mutation(internal.workflow.negotiate, round);
  await expect(
    s.t.mutation(internal.workflow.award, {
      bidId,
      selectionReason: "not agreed",
    }),
  ).rejects.toThrow("OFFER_NOT_ACCEPTED");
  await s.t.mutation(internal.workflow.negotiate, {
    ...round,
    round: 3,
    actorRole: "seller",
    action: "accept",
  });
  await s.t.mutation(internal.workflow.award, {
    bidId,
    selectionReason: "Test ranking supplied by trusted worker",
  });
  expect(
    (await s.alice.query(api.jobs.detail, { id: s.jobId })).job.reservedYocto,
  ).toBe(round.priceYocto);
});
it("allows one award under concurrent requests and keeps reservations bounded", async () => {
  const s = await setup();
  const bidId = await s.bid();
  const results = await Promise.allSettled(
    [1, 2].map(() =>
      s.t.mutation(internal.workflow.award, { bidId, selectionReason: "test" }),
    ),
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const d = await s.alice.query(api.jobs.detail, { id: s.jobId });
  expect(d.contracts).toHaveLength(1);
  expect(BigInt(d.job.reservedYocto)).toBeLessThanOrEqual(
    BigInt(d.job.budgetYocto),
  );
  await expect(
    s.alice.mutation(api.jobs.cancel, { id: s.jobId }),
  ).rejects.toThrow("CANNOT_CANCEL");
});
it("enforces capacity across private jobs atomically", async () => {
  const s = await setup();
  const first = await s.bid("analysis-careful");
  await s.t.mutation(internal.workflow.award, {
    bidId: first,
    selectionReason: "test",
  });
  const m = await s.alice.mutation(api.missions.create, s.input);
  const j = await s.alice.mutation(api.jobs.start, {
    missionId: m,
    options: s.options,
  });
  const second = await s.bid("analysis-careful", j);
  await expect(
    s.t.mutation(internal.workflow.award, {
      bidId: second,
      selectionReason: "test",
    }),
  ).rejects.toThrow("CAPACITY_FULL");
});
it("bounds child allocation/depth and refuses parent output before child proof", async () => {
  const s = await setup();
  const bidId = await s.bid();
  await s.t.mutation(internal.workflow.award, {
    bidId,
    selectionReason: "test",
  });
  const args = {
    parentId: s.jobId,
    budgetYocto: "300000000000000000000000",
    options: { columns: ["product"] },
  };
  await expect(
    s.t.mutation(internal.workflow.subcontract, {
      ...args,
      budgetYocto: "2000000000000000000000000",
    }),
  ).rejects.toThrow("SUBCONTRACT_OVER_BUDGET");
  const child = await s.t.mutation(internal.workflow.subcontract, args);
  await expect(
    s.t.mutation(internal.workflow.subcontract, args),
  ).rejects.toThrow("CHILD_LIMIT");
  await expect(
    s.t.mutation(internal.workflow.subcontract, { ...args, parentId: child }),
  ).rejects.toThrow("INVALID_SUBCONTRACT_PARENT");
  const d = await s.alice.query(api.jobs.detail, { id: s.jobId });
  expect(BigInt(d.contracts[0].holdbackYocto) + BigInt(args.budgetYocto)).toBe(
    BigInt(d.contracts[0].amountYocto),
  );
  expect(d.job.reservedYocto).toBe(d.contracts[0].amountYocto);
  await expect(
    s.t.mutation(internal.workflow.submit, {
      jobId: s.jobId,
      format: "json",
      content: "{}",
    }),
  ).rejects.toThrow("CHILD_WORK_INCOMPLETE");
});
it("persists verification failure, allows one revision, and requires buyer dispute decision", async () => {
  const s = await setup();
  const bidId = await s.bid();
  await s.t.mutation(internal.workflow.award, {
    bidId,
    selectionReason: "test",
  });
  // Trusted verifier fixtures test persistence only, not actual CSV correctness.
  const submit = () =>
    s.t.mutation(internal.workflow.submit, {
      jobId: s.jobId,
      format: "json" as const,
      content: '{"fixture":"bad work"}',
    });
  const fail = async () => {
    const deliverableId = await submit();
    await s.t.mutation(internal.workflow.recordVerification, {
      deliverableId,
      verdict: "fail",
      checks: [
        {
          code: "TEST_FAILURE",
          passed: false,
          detail: "Explicit test verifier result",
        },
      ],
    });
    return deliverableId;
  };
  await fail();
  expect(
    (await s.alice.query(api.jobs.detail, { id: s.jobId })).job.state,
  ).toBe("revision");
  const id = await fail();
  expect(
    (await s.alice.query(api.jobs.detail, { id: s.jobId })).job.state,
  ).toBe("disputed");
  await expect(
    s.t.mutation(internal.workflow.recordVerification, {
      deliverableId: id,
      verdict: "pass",
      checks: [{ code: "X", passed: true, detail: "x" }],
    }),
  ).rejects.toThrow("NOT_VERIFYING");
  await expect(
    s.bob.mutation(api.jobs.resolveDispute, {
      id: s.jobId,
      decision: "approve",
      reason: "forged",
    }),
  ).rejects.toThrow("JOB_NOT_FOUND");
  await s.alice.mutation(api.jobs.resolveDispute, {
    id: s.jobId,
    decision: "reject",
    reason: "Incorrect summary",
  });
  expect(
    (await s.alice.query(api.jobs.detail, { id: s.jobId })).job.state,
  ).toBe("rejected");
  expect(
    await s.t.run((ctx) => ctx.db.query("reputationEvents").collect()),
  ).toHaveLength(1);
  await expect(
    s.alice.mutation(api.jobs.resolveDispute, {
      id: s.jobId,
      decision: "approve",
      reason: "retry",
    }),
  ).rejects.toThrow("NO_OPEN_DISPUTE");
});
it("requires consistent verification checks and records final reputation exactly once", async () => {
  const s = await setup();
  const bidId = await s.bid();
  await s.t.mutation(internal.workflow.award, {
    bidId,
    selectionReason: "test",
  });
  const deliverableId = await s.t.mutation(internal.workflow.submit, {
    jobId: s.jobId,
    format: "json",
    content: "{}",
  });
  await expect(
    s.t.mutation(internal.workflow.recordVerification, {
      deliverableId,
      verdict: "pass",
      checks: [{ code: "X", passed: false, detail: "inconsistent" }],
    }),
  ).rejects.toThrow("INVALID_CHECKS");
  await s.t.mutation(internal.workflow.recordVerification, {
    deliverableId,
    verdict: "pass",
    checks: [
      {
        code: "EXPLICIT_TEST_VERIFIER",
        passed: true,
        detail: "This is a lifecycle test, not service execution evidence",
      },
    ],
  });
  const d = await s.alice.query(api.jobs.detail, { id: s.jobId });
  expect(d.job.state).toBe("approved");
  expect(d.events.some((e) => e.type === "WORK_APPROVED")).toBe(true);
  expect(
    (await s.t.run((ctx) => ctx.db.query("reputationEvents").collect()))[0]
      .delta,
  ).toBe(10);
});
it("binds parent submission to approved child output and restores unused allocation", async () => {
  const s = await setup();
  const bidId = await s.bid();
  await s.t.mutation(internal.workflow.award, {
    bidId,
    selectionReason: "test",
  });
  const child = await s.t.mutation(internal.workflow.subcontract, {
    parentId: s.jobId,
    budgetYocto: "300000000000000000000000",
    options: { columns: ["product"] },
  });
  const childBid = await s.t.mutation(internal.workflow.recordBid, {
    jobId: child,
    agentId: "clean-sprint",
    priceYocto: "200000000000000000000000",
    minimumYocto: "100000000000000000000000",
    etaMs: 100,
    rationale: "test",
  });
  await s.t.mutation(internal.workflow.award, {
    bidId: childBid,
    selectionReason: "test",
  });
  const childOutput = "product,units\nBag,3";
  const dependencyDeliverableId = await s.t.mutation(internal.workflow.submit, {
    jobId: child,
    format: "csv",
    content: childOutput,
  });
  await s.t.mutation(internal.workflow.recordVerification, {
    deliverableId: dependencyDeliverableId,
    verdict: "pass",
    checks: positiveChecks,
  });
  const context = await s.t.query(internal.workflow.executionContext, {
    jobId: s.jobId,
  });
  expect(context.inputCsv).toBe(childOutput);
  expect(context.dependencyDeliverableId).toBe(dependencyDeliverableId);
  await expect(
    s.t.mutation(internal.workflow.submit, {
      jobId: s.jobId,
      format: "json",
      content: "{}",
    }),
  ).rejects.toThrow("DEPENDENCY_OUTPUT_NOT_BOUND");
  const d = await s.alice.query(api.jobs.detail, { id: s.jobId });
  expect(d.contracts[0].holdbackYocto).toBe("800000000000000000000000");
  const deliverableId = await s.t.mutation(internal.workflow.submit, {
    jobId: s.jobId,
    format: "json",
    content: "{}",
    dependencyDeliverableId,
  });
  await s.t.mutation(internal.workflow.recordVerification, {
    deliverableId,
    verdict: "pass",
    checks: positiveChecks,
  });
  expect(
    (await s.alice.query(api.jobs.detail, { id: s.jobId })).job.state,
  ).toBe("approved");
});
it("routes rejected child work to a parent dispute without allowing an approval bypass", async () => {
  const s = await setup();
  const bidId = await s.bid();
  await s.t.mutation(internal.workflow.award, {
    bidId,
    selectionReason: "test",
  });
  const child = await s.t.mutation(internal.workflow.subcontract, {
    parentId: s.jobId,
    budgetYocto: "300000000000000000000000",
    options: { columns: ["product"] },
  });
  const childBid = await s.t.mutation(internal.workflow.recordBid, {
    jobId: child,
    agentId: "clean-sprint",
    priceYocto: "200000000000000000000000",
    minimumYocto: "100000000000000000000000",
    etaMs: 100,
    rationale: "test",
  });
  await s.t.mutation(internal.workflow.award, {
    bidId: childBid,
    selectionReason: "test",
  });
  const deliverableId = await s.t.mutation(internal.workflow.submit, {
    jobId: child,
    format: "csv",
    content: "test fixture",
  });
  await s.t.mutation(internal.workflow.recordVerification, {
    deliverableId,
    verdict: "needs_human",
    checks: [{ code: "REVIEW", passed: false, detail: "test" }],
  });
  await s.alice.mutation(api.jobs.resolveDispute, {
    id: child,
    decision: "reject",
    reason: "Incorrect child output",
  });
  expect(
    (await s.alice.query(api.jobs.detail, { id: s.jobId })).job.state,
  ).toBe("disputed");
  await expect(
    s.alice.mutation(api.jobs.resolveDispute, {
      id: s.jobId,
      decision: "approve",
      reason: "bypass",
    }),
  ).rejects.toThrow("CHILD_WORK_INCOMPLETE");
  await s.alice.mutation(api.jobs.resolveDispute, {
    id: s.jobId,
    decision: "reject",
    reason: "Child failed",
  });
  expect(
    (await s.alice.query(api.jobs.detail, { id: s.jobId })).job.state,
  ).toBe("rejected");
});


it.each([11, 32])("persists real normalization checks for %i maximum-length headers", async (columnCount) => {
  const s = await setup();
  const columns = Array.from({ length: columnCount }, (_, i) => `${String(i).padStart(2, "0")}${"h".repeat(98)}`);
  const request: ServiceRequest = {
    serviceType: "csv_normalize",
    inputCsv: `${columns.join(",")}\n${columns.map(() => " X ").join(",")}`,
    options: { columns, caseMode: "lowercase" },
  };
  const missionId = await s.alice.mutation(api.missions.create, {
    ...s.input, ...request,
  });
  const jobId = await s.alice.mutation(api.jobs.start, { missionId });
  const bidId = await s.bid("clean-sprint", jobId);
  // Trusted worker fixture for selection; service and verification below are real.
  await s.t.mutation(internal.workflow.award, { bidId, selectionReason: "Boundary regression fixture" });
  const execution = runService(request);
  if (!execution.ok || execution.value.format !== "csv") throw new Error("Expected CSV output");
  const deliverableId = await s.t.mutation(internal.workflow.submit, {
    jobId, format: "csv", content: execution.value.csv,
  });
  const verification = verifyDeliverable({ request, deliverable: execution.value });
  if (!verification.ok) throw new Error(verification.message);
  expect(verification.value.verdict).toBe("pass");
  expect(verification.value.checks.every((check) => check.detail.length <= 1000)).toBe(true);
  await s.t.mutation(internal.workflow.recordVerification, {
    deliverableId, verdict: verification.value.verdict, checks: [...verification.value.checks],
  });
  const detail = await s.alice.query(api.jobs.detail, { id: jobId });
  expect(detail.job.state).toBe("approved");
  expect(detail.verifications).toHaveLength(1);
});
