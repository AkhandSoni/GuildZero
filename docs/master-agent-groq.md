# Personal planner — Groq experiment (#48)

Branch: `feat/master-agent-groq`, independently based on `be04088784f1aed8cb04ff4f2f16720ae66e94f7`. Keep the PR unmerged until explicit owner approval, even when checks pass. The Qwen and MCP experiments have no code dependency on this branch.

## Setup

Use the existing project Node 24 launcher and local Convex setup. In this checkout's ignored `.env.local`, set the Next.js server variables:

```dotenv
GROQ_API_KEY=
GROQ_MODEL=openai/gpt-oss-20b
```

The example model was verified against current official Groq structured-output documentation and live account access during this implementation. The runtime always uses the configured model; it has no model/provider fallback. Recheck current model availability and your free-account quotas. The project does not add billing, a card, a trial or a paid fallback. Actual keys stay out of Git, browser assets, prompts, logs and evidence. Do not use `NEXT_PUBLIC_` for either variable.

Run `npm ci`, then `npm run dev`. Restart Next.js after changing its server environment. The implementation/testing checkout is `/home/Fantom-1001/.cache/guildzero-master-groq`; the user's main checkout is separate. Each checkout has its own ignored environment. Tests use an isolated anonymous backend on ports 3340/3341 and frontend 3010; no operator credentials were copied there.

## Walkthrough

1. Sign in and select **New mission** or **Personal planner** (`/missions/new`). The old `/master-agent` bookmark redirects here, preserving a valid service suggestion. **Advanced / Manual Mission Creation** opens the original editor at `/missions/new/manual`; existing draft editing and reuse stay available. Describe an explicit supported operation, upload/paste one CSV (two for reconciliation), set a maximum transfer budget and deadline. Example: “Give summary statistics for units and price. Do not clean the data.”
2. Select **Generate plan** to save the private request and start inference. Groq receives the request, clarification replies, exact headers and bounded aggregate counts. It never receives raw CSV rows, filenames, private seller prices or signing material. The original CSV is stored privately in Convex for actual service execution. Use synthetic inputs for the demo.
3. Review the proposed services, columns, case/group/key options, per-step maximums and cleaning behavior. Clarify ambiguous requests; at most three clarification replies and three explicit planning attempts per version are supported. Errors preserve the request rather than silently inventing a plan.
4. Explicitly accept the plan to create/start its private missions through existing `missions.create` and `jobs.start`. Acceptance grants no payment authority. If settlement is unavailable, the human must explicitly acknowledge metadata-only processing. Full results stay locked.
5. The existing independent sellers bid, negotiate, execute and verify. Up to three independent service steps are supported. Cleaning→summary uses the existing single child; independent steps always read original uploads. The model does not select winners, compute results, approve disputes or update reputation.
6. The workspace shows actual job panels, bids, checks, committed awards, pending/confirmed transfer totals, persistent events and exact receipts. Human disputes use the existing mission UI. A failed/uncertain payment is not turned into a retry.
7. Exact manual approval remains available in each mission. The new one-time bundle authorization is implemented behind a separate backend rollout flag, described below. Released results are rendered from actual stored deliverables only after existing exact parent/child settlement conditions pass.
8. Stop delegation to revoke future automatic authority and cancel unawarded jobs. Committed services and transactions retain their history. **Remove private planner content** clears planner copies and all bound mission content atomically only after existing terminal-work/settlement retention checks permit it. Mission retention points back to this bundle operation to avoid leaving a hidden planner CSV copy. Financial hashes/identities and public receipts remain; independent downloads/backups have separate boundaries.

## Plan and inference boundaries

`lib/master-agent/plan.ts` defines strict `MasterAgentPlanV1`, generated provider JSON Schema and deterministic compilation. Unknown fields are rejected at every object level. The compiler resolves only this request's uploaded references and applies existing CSV, exact-header, numeric, service-option, budget and output-size preflights. It rejects arbitrary addresses, tool code, URLs and financial flags. The human's mandatory-review setting overrides a model proposal to disable it.

`lib/master-agent/prompt.ts` preserves the shared system instruction and the common v1.3 envelope rules recorded in both #48 and #49. Benchmark expectations were not changed to fit responses. Early v1/v1.1/v1.2 measurements exposed small budget suggestions, inactive options, unnecessary cleaning and ambiguous/dependent operations; those observations are retained separately from the final prompt's measurements. Plans remain proposals requiring human review; measured cases are not a guarantee that every future request is interpreted correctly.

`POST /api/master-agent/plan` is a same-origin, bearer-authenticated Node handler. It passes the user's verified session to Convex, verifies ownership before provider access, then acquires a fenced planning claim. It accepts only run ID/revision, never owner identity, an endpoint or a generic backend function. Missing configuration makes no provider call. Claims expire after 45 seconds; stale responses cannot overwrite a new version. Provider traffic is throttled centrally in Convex (two requests/minute with a burst of two across the deployment and per owner).

`lib/master-agent/groq.ts` sends one bounded HTTPS request to the fixed Groq API origin, with strict structured output, no tool calls/streaming, a 30-second deadline, 24 KiB request cap, 64 KiB response cap, 32 KiB plan cap and 2,048 completion-token limit. It never retries or switches providers silently. It reports 429/Retry-After, unsupported configuration, invalid/truncated output, timeout and refusal without logging provider payloads. Runtime validation still applies after strict provider output. Inference, planning and workflow latency are distinct.

## Human-scoped automatic spending — review gate

The new Convex-backend-only flag **`MASTER_AGENT_AUTOPAY_ENABLED` defaults off** and remains off in the live isolated demo. This security-sensitive authority is available for code review and offline tests; enable it only after review and explicit operator approval. Setting a Groq key does not enable it. No private signing key is needed by the Next.js planner.

The human reviews the accepted plan hash, all bound mission IDs, transfer maximum, operator/configured recipient map, expiry (at most one hour/deadline), and separate gas policy, then calls `masterAgent.authorizeSpending` from a distinct authenticated UI form. Model text, accepting a plan and an inferred budget are not consent. The grant is owner-bound, versioned by plan/dataset/policy hashes, revocable, and limited to exactly those missions and their eligible single cleaning children.

The cap applies to **contract transfers**, including child allocation. Actual network gas is separate and explicitly disclosed; this is not an all-inclusive fee cap. The existing signer retains the 0.01 NEAR liquidity reserve. Transfer totals do not claim to measure gas. Source funds remain the shared custodial testnet operator, not a user deposit.

Convex reconstructs the exact saved plan/data/mission/job bindings, parent-child allocation, recipient policy and total awards; it reserves each obligation once. Preparation and scheduling are atomic. Existing approved/latest-deliverable checks, optional operator quotas, sender locks, receipts and delivery rules are reused. The legacy worker checks the grant on claim and has an additional atomic admission immediately before any SDK signer accesses a key. Revocation stops new admissions; an already admitted/broadcast transaction cannot be recalled. Duplicate or previously attempted automatic authorizations are not rearmed. Denied/expired/changed grants fall back to explicit manual review, not an automatic resend.

Automatic grants deliberately do not authorize v2 recovery attempts. `NEAR_PAYMENT_RETRY_ENABLED` remains subject to its separate protocol/review gate; no legacy failure is migrated or reset. Unknown transactions reconcile their original hash through existing guarded UI/backend functions. Internal supervision wakes from real economy events; shared-signer contention has at most twelve delayed read/admission rechecks before a human status refresh is needed. It creates no second bidding or service scheduler.

## Validation and benchmarks

Run normal lint/type/build/client-boundary/unit/backend/browser checks. Default tests make no inference or blockchain requests. Planner integration tests compile all five services and a multi-step/cleaning request through the actual scheduled engine, verify results, and keep unpaid output locked. Grant tests cover ownership, binding changes, expiry/revocation, caps, quotas, concurrent/replayed authorization and deletion. Three subprocess tests use ephemeral actual Ed25519 SDK signing against an **offline simulated chain**, including revocation during preflight and SIGKILL after lost signing-permit acknowledgment. These are not public-chain receipts.

The default benchmark command sends no inference:

```sh
npm run benchmark:master-agent
```

To intentionally measure the configured free-tier provider, with synthetic fixtures only:

```sh
npm run benchmark:master-agent -- --live --trials=1 --pause-ms=40000
# Repeated trials of selected cases, after a quota-friendly initial delay:
npm run benchmark:master-agent -- --live --cases=summary --trials=3 --pause-ms=40000 --delay-ms=40000
```

Run one benchmark process at a time. Reports use unique ignored `.convex/master-agent/benchmark-*.json` paths; never upload that whole directory. Reports include raw schema validity, gold service/column/decision scoring, deterministic validation, model/settings, schema/prompt/fixture hashes, latency, reliable tokens, request/429 counts and unavailable markers. These scripts measure planning only: end-to-end paid delivery is explicitly `null`, and no signer/grant/payment API is called. The real authenticated browser walkthrough separately validates actual Groq planning → real marketplace → verified unpaid result gating, reload and mobile layout. Sanitized final evidence is committed separately; no Qwen result or inference winner is fabricated.

No additional public-testnet transfer was used. Prior test spending stays at **0.9484144405625 NEAR** of the owner's **1 NEAR** budget. Fresh automatic public-testnet settlement requires a separately approved test envelope and reviewed activation; a live Groq key authorizes neither. The feature PR stays unmerged for owner review.
