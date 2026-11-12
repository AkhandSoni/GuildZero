# Decisions and deviations log

All locked choices are in `decisions.md`. Record any necessary change with date, reason, affected files, risk, and human approval. Without approval, keep original scope.

## 2026-11-13 — PR #15 CSV boundary follow-up

- The user requested resolving both inline review comments. Extracted a browser-safe bounded CSV input validator shared by mission create/update, launch, subcontract input validation, execution and verification; ownership and public error wrappers remain unchanged.
- Reject mixed LF/CRLF/CR record separators outside quoted fields rather than guessing and potentially removing data. Different embedded endings and escaped quotes inside quoted fields remain valid. Remove a terminal parser artifact only when the source ends in its confirmed record separator and the parsed final record is exactly one empty field.
- Retained drafts with inconsistent separators or previously accepted invalid row/header bounds remain readable but fail launch revalidation. No stored data is silently rewritten and no migration alters existing financial or execution history.

## 2026-11-13 — Audit corrections

- User authorized correcting both auditor findings and opening a PR containing the combined application. This authorizes the review branch push and PR, not merging it, public hosting or submitting to the hackathon.
- CSV parsing preserves explicit empty records and removes only the parser's one terminal-separator artifact. Malformed-width blank records reject rather than disappear; empty records count toward the 500-row cap. Empty one-column normalization output is quoted to distinguish data from a terminal separator. Verification uses the preserved source records and rejects row-deleted outputs.
- Column verification checks retain their exact comparisons but describe only the column count/order, keeping explanations within the existing Convex persistence cap. The cap is not relaxed. Boundary tests forward actual executor/verifier output through the trusted workflow with 11 and 32 maximum-length headers.

## 2026-11-13 — Combine merged economy kernel with application branches

- The user explicitly authorized including merged PR #14 and testing it with the completed application branches on local main. Preserve both histories through a merge; no push or public deployment is included.
- Use the implemented PR's bidding/ranking/negotiation/result types and function exports, retaining application lifecycle state types and mutable JSON option arrays required by generated Convex write signatures. These are in-memory types, not changes to stored financial records or ownership checks. Future worker callers must use the implemented engine result shapes documented in `economy-kernel.md`, rather than the earlier proposed shapes in `worker-integration.md`.
- Keep mission/public option validation codes and UI messages stable. CSV execution explicitly requests the kernel-compatible generic option error mode; both entry points share `lib/economy/contracts.ts` validation. Existing application and PR tests pass together. The engine remains a pure package until separately connected to the scheduled workflow; merging code alone does not prove automatic marketplace execution or settlement.

## 2026-11-12 — payment approval binding (issue #8)

- The issue audit identified missing persisted approval identity/policy version on payment intents. `fix/payment-approval-binding` stacks on the shared-contract fix and binds the exact approved deliverable, verification, optional owner dispute decision and policy version in addition to contract/sender/recipient/amount.
- Authorization and signer claim reject changed or missing provenance before network/signing/lock acquisition. Claim rejection returns with a durable audit record and clears stale authorization; it no longer throws away denial evidence through transaction rollback.
- Historical intents remain readable; unbound ones cannot authorize/claim and are not auto-migrated or replaced. Existing unknown/submitted transactions retain hash-based reconciliation. No real payout or integrated gate completion is claimed.

## 2026-11-12 — issue review and shared contracts

- The user explicitly requested resolving repository issues and closing completed/unnecessary ones. Work is isolated on `fix/issue-1-economy-contracts`, based on the latest privacy fix; no feature branch is merged into main.
- Shared type contracts and option validation are now committed under `lib/economy` for issue #1. These support the teammate's assigned algorithms/CSV/verifier work rather than replacing it. The integration signatures follow the existing handoff, with no runtime stubs or claims of a functioning engine.
- Processing options are stored on drafts and become part of the immutable launch snapshot. Existing missing-option drafts remain editable but cannot run until options are saved; a legacy launch argument cannot bypass that requirement. Existing active jobs are not rewritten. Older edit callers omitting options invalidate stale selections. Frontend/backend updates must ship together.
- Issue closure requires the ticket's acceptance evidence. Backend fixtures and completed surrounding UI do not establish real service execution, payment success, hosted deployment or final submission; those issues remain open until demonstrated.

## 2026-11-12 — continued implementation and teammate boundary

- The user authorized continued implementation and regular commits/pushes to feature branches while away. This supersedes stopping for another approval after each completed cluster; implementation remains sequential and test results remain mandatory. No public submission is authorized.
- The teammate owns the previously delivered economy kernel, CSV services, and independent verifier. No remote teammate branch exists at the start of this work. The lead is building the surrounding Convex lifecycle on `feat/cluster-2-orchestration` without duplicating or overwriting that package.
- Internal workflow functions accept trusted worker outputs and independently enforce state, ownership, amount, capacity, negotiation and subcontract bounds. No public function accepts agent-authored verification, reputation deltas, or arbitrary awards. Tests using internal worker fixtures are explicitly persistence tests, not evidence of real CSV execution.
- Until the teammate package is available and connected, opening an auction persists a real job but explicitly waits for the engine. No scheduled fake bids, fabricated outputs, or false completion claims are introduced. Cluster 2 cannot be accepted on persistence tests alone.

## 2026-11-12 — explicitly authorized Cluster 3/4 branches

- The user explicitly requested implementing and pushing Clusters 3 and 4 while the teammate package remains separate, to combine later. These are stacked feature branches based on orchestration; this supersedes holding all later implementation behind the missing engine. It does not waive functional acceptance or authorize claims of completed integration.
- Cluster 3 uses official `near-api-js` 7.5.3 and Node 24 for Convex Node actions. Node 26 alone could not deploy local Node actions; a checksum-verified official Node 24 binary was used for validation without replacing system Node.
- Payouts are owner-confirmed, capped at 1 testnet NEAR each, serialized per dedicated signer, and conservatively locked on uncertain outcomes. Exact signed transaction identity is persisted before one broadcast. No automatic resend or failed-intent recycling is implemented. Credentials and a genuinely approved engine deliverable are still required for live payment acceptance.
- Cluster 4 uses pinned XYFlow as a UI library; no additional application server or Vite app is introduced. Graph relationships, agent history and security evidence are owner-scoped persisted records, with explicit bounds/truncation. Sample reset preserves active work and every payment record. CI is manual-only so branch pushes do not automatically launch hosted jobs or deployments. Public release is not claimed before combination and owner-provided cloud configuration.

## Audit follow-up — negotiation roles and pricing privacy

- User asked what independent work could proceed after the audit; the already authorized fix work is isolated on `fix/negotiation-roles-pricing-privacy`, based on the experience branch. No engine replacement, branch merge into main, payment, or deployment is performed.
- Buyer projections now omit private bid/profile pricing and raw pricing diagnostics, including older free-text event/award explanations. Worker diagnostics remain available internally. Browser-safe metadata is separated while preserving the existing engine fixture profile export/type. Published fixture defaults are not secret; optional private seller floors are server-only configuration. Structured public selection-score explanations remain an engine integration requirement.
- Negotiations require explicit buyer/seller roles with backend-derived identities, exact reference-price acceptance, existing round bounds, and different buyer-cap/seller-floor checks. A subcontract buyer is the parent seller. Old actor-less rows remain readable as legacy but fail closed for continued negotiation/new awards; no identity is invented or historical financial state rewritten.
- New privacy fixtures exposed a pre-existing valid one-column CSV rejection from delimiter auto-detection. Comma parsing is now explicit and consistent across mission/column parsing, matching the established CSV contract.

## 2026-11-10 — Cluster 1 implementation

- The current master prompt supersedes the ancestor Counterparty Guard instructions. No Fastify, Rust contracts, or person-based work allocation applies to GuildZero. Existing planning documents are preserved.
- The master prompt explicitly requests initial agent definitions in Cluster 1, while `clusters/01-foundation.md` says no agents yet. Implemented only static typed profiles (six roles, distinct seller strategies), not discovery, bidding, execution, reputation, or future-cluster schema. This follows the explicit current request without expanding economic behavior.
- Mission routes are `/missions/new` and `/missions/[id]`, matching the master prompt rather than the older `/jobs` examples. A mission is the private draft brief in Cluster 1. Work-unit job/contract entities are deferred to Cluster 2; no unused future tables are created.
- Convex Auth password provider with the documented client React provider avoids experimental server integration. Backend functions enforce identity and ownership independently. Auth has no email verification/recovery in the zero-service demo; the sign-in screen and README disclose this limitation.
- The official anonymous local Convex backend permits actual auth testing without cloud credentials. No production deployment, paid infrastructure, or payment secrets were introduced. Cloud setup remains optional and user-owned.
- All budgets are canonical positive integer yoctoNEAR strings, with BigInt conversion and a documented 1,000 testnet NEAR planning cap. CSV is bounded to 64 KiB, 500 rows, 32 columns; deadlines to 30 days. These are validation limits, not implemented execution or fund reservations.
- Pinned Next.js 16.4.6 / React 19.3.1 / Convex 1.49.0 / Convex Auth 0.0.98 on the installed Node 26 toolchain. Patched `@auth/core` to compatible 0.41.3 after npm audit flagged the guide's 0.41.1. A scoped `minimatch` 11.0.1 override resolves the ESLint parser's development advisory; lint/typecheck validate compatibility.
- Schema and generated Convex types cover only current auth and mission needs. No agent execution, auctions, payments, security lab, economy graph, or release scaffolding is included.
