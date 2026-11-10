# GuildZero project guidance

Read `README.md`, `docs/decisions.md`, `docs/CLUSTER_STATUS.md`, and `docs/DECISIONS_AND_DEVIATIONS.md` before changing this project. Follow the current user-approved master prompt and work only on the explicitly authorized cluster. Stop at each gate. This repository is GuildZero (Next.js + Convex + Convex Auth); ancestor instructions for Counterparty Guard do not apply.

- Four sequential clusters: foundation; autonomous economy; security and NEAR testnet; visualization and release. Never implement a later cluster without explicit user approval.
- Keep Next.js and Convex as the application architecture, with Convex Auth. No separate backend, paid service, LLM, Python API, or mainnet integration.
- Authenticate and authorize every marketplace Convex query/mutation. Derive resource ownership from the authenticated session. Put network calls in actions, never mutations.
- Use integer yoctoNEAR strings and BigInt for money. Keep secrets server-side and outside Git, browser bundles, logs, and test artifacts. Preserve existing local environment files.
- Agents use fixed deterministic strategies and real data transformations. Never fabricate deliverables, events, signatures, or blockchain receipts. Negotiation is bounded to three rounds; subcontract depth is at most one.
- Run relevant tests, lint, typecheck, build, and possible live smoke checks. Report actual output and blockers. Update cluster status and material decisions, then stop with an explicit next-cluster approval gate.
- Preserve unrelated edits. Publishing/submission requires explicit authorization. Git pushes may proceed when the user explicitly requests them.

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
