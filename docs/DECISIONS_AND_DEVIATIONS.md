# Decisions and deviations log

All locked choices are in `decisions.md`. Record any necessary change with date, reason, affected files, risk, and human approval. Without approval, keep original scope.

## 2026-11-12 — continued implementation and teammate boundary

- The user authorized continued implementation and regular commits/pushes to feature branches while away. This supersedes stopping for another approval after each completed cluster; implementation remains sequential and test results remain mandatory. No public submission is authorized.
- The teammate owns the previously delivered economy kernel, CSV services, and independent verifier. No remote teammate branch exists at the start of this work. The lead is building the surrounding Convex lifecycle on `feat/cluster-2-orchestration` without duplicating or overwriting that package.
- Internal workflow functions accept trusted worker outputs and independently enforce state, ownership, amount, capacity, negotiation and subcontract bounds. No public function accepts agent-authored verification, reputation deltas, or arbitrary awards. Tests using internal worker fixtures are explicitly persistence tests, not evidence of real CSV execution.
- Until the teammate package is available and connected, opening an auction persists a real job but explicitly waits for the engine. No scheduled fake bids, fabricated outputs, or false completion claims are introduced. Cluster 2 cannot be accepted on persistence tests alone.

## 2026-11-12 — explicitly authorized Cluster 3/4 branches

- The user explicitly requested implementing and pushing Clusters 3 and 4 while the teammate package remains separate, to combine later. These are stacked feature branches based on orchestration; this supersedes holding all later implementation behind the missing engine. It does not waive functional acceptance or authorize claims of completed integration.
- Cluster 3 uses official `near-api-js` 7.5.3 and Node 24 for Convex Node actions. Node 26 alone could not deploy local Node actions; a checksum-verified official Node 24 binary was used for validation without replacing system Node.
- Payouts are owner-confirmed, capped at 1 testnet NEAR each, serialized per dedicated signer, and conservatively locked on uncertain outcomes. Exact signed transaction identity is persisted before one broadcast. No automatic resend or failed-intent recycling is implemented. Credentials and a genuinely approved engine deliverable are still required for live payment acceptance.

## 2026-11-10 — Cluster 1 implementation

- The current master prompt supersedes the ancestor Counterparty Guard instructions. No Fastify, Rust contracts, or person-based work allocation applies to GuildZero. Existing planning documents are preserved.
- The master prompt explicitly requests initial agent definitions in Cluster 1, while `clusters/01-foundation.md` says no agents yet. Implemented only static typed profiles (six roles, distinct seller strategies), not discovery, bidding, execution, reputation, or future-cluster schema. This follows the explicit current request without expanding economic behavior.
- Mission routes are `/missions/new` and `/missions/[id]`, matching the master prompt rather than the older `/jobs` examples. A mission is the private draft brief in Cluster 1. Work-unit job/contract entities are deferred to Cluster 2; no unused future tables are created.
- Convex Auth password provider with the documented client React provider avoids experimental server integration. Backend functions enforce identity and ownership independently. Auth has no email verification/recovery in the zero-service demo; the sign-in screen and README disclose this limitation.
- The official anonymous local Convex backend permits actual auth testing without cloud credentials. No production deployment, paid infrastructure, or payment secrets were introduced. Cloud setup remains optional and user-owned.
- All budgets are canonical positive integer yoctoNEAR strings, with BigInt conversion and a documented 1,000 testnet NEAR planning cap. CSV is bounded to 64 KiB, 500 rows, 32 columns; deadlines to 30 days. These are validation limits, not implemented execution or fund reservations.
- Pinned Next.js 16.4.6 / React 19.3.1 / Convex 1.49.0 / Convex Auth 0.0.98 on the installed Node 26 toolchain. Patched `@auth/core` to compatible 0.41.3 after npm audit flagged the guide's 0.41.1. A scoped `minimatch` 11.0.1 override resolves the ESLint parser's development advisory; lint/typecheck validate compatibility.
- Schema and generated Convex types cover only current auth and mission needs. No agent execution, auctions, payments, security lab, economy graph, or release scaffolding is included.
