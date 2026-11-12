# GuildZero

GuildZero is an autonomous economic marketplace for real, deterministic data-processing services. Agents will make independent bidding and negotiation decisions; Convex provides centralized coordination. Agents are algorithms, not LLMs. Planned settlement is a **custodial NEAR testnet demonstration**, not trustless escrow.

**Current implementation: stacked feature branches for later combination.** Authentication, private mission CRUD, orchestration, guarded testnet payment code, a live economy graph, private agent history, security lab and safe sample controls are implemented. The layers are on `feat/cluster-2-orchestration`, `feat/cluster-3-security-near`, and `feat/cluster-4-experience-release`; each later branch contains its predecessors. Main is not automatically merged or deployed.

**The teammate's economy engine is not connected yet.** Opening an auction records a job and waits; it does not invent bids, CSV outputs or verified work. Internal worker fixtures test lifecycle/policy behavior and are not proof of real data processing. Payment code is tested with offline RPC fixtures, but a real authorized testnet payout is not yet demonstrated. Public cloud hosting and final submission remain pending. No branch should be represented as the fully integrated marketplace until these gates pass.

## Local setup (no account or paid service required)

Requirements: **Node.js 24.22.3** (see `.nvmrc`), npm, and network access for initial downloads. Run `nvm install && nvm use` if you use nvm. Convex's local Node actions require a supported Node 22/24 runtime; Node 26 alone cannot deploy those actions. Dependencies are pinned in `package.json` and `package-lock.json`. Next.js and Convex remain the only application runtimes; XYFlow is a UI library, and Vitest/Playwright are development test tools.

```sh
npm ci
npm run dev:backend
```

On the first run, choose **Start without an account (run Convex locally)** and confirm. Convex downloads its official local backend, generates `.env.local`, and deploys the schema/functions. Keep that terminal running. In another terminal:

```sh
npm run auth:keys
npm run dev
```

Open http://localhost:3000. Sign up using an email and a 12–128 character password. Local signup works without email delivery. **Email verification and password recovery are not enabled**; use disposable demo accounts and keep your password.

`auth:keys` generates RS256 keys in memory and sends them directly to the configured Convex backend over stdin. It never prints keys, saves them in source files, or overwrites existing keys. Run it once per new backend. Re-running against an already configured backend fails safely. Restart `npm run dev` after changing frontend environment variables.

For a free Convex cloud development deployment, choose the login option in `npm run dev:backend` instead. You must supply your own Convex login and select a free project. Then run `npm run auth:keys` against that selected deployment. No deployment token is needed by the browser. Cloud deployment is not required for Cluster 1.

## Environment and secrets

`.env.example` documents the public URL placeholders. Convex writes actual local values to ignored `.env.local`; do not copy the empty example over that file. `NEXT_PUBLIC_CONVEX_URL` is required for the UI. `NEXT_PUBLIC_CONVEX_SITE_URL` is generated for HTTP auth routes; the backend supplies its own `CONVEX_SITE_URL` for JWT verification. Backend-only `JWT_PRIVATE_KEY` and `JWKS` are configured by the key helper, not put in a `NEXT_PUBLIC_` variable. Password-only auth does not require `SITE_URL`.

This working checkout also includes an ignored `.env.convex.local` worksheet with blank server-only fields, ready for manual configuration if needed. It is **not automatically loaded or synced**. For a different backend, fill every field and import with `npx convex env set --from-file .env.convex.local`, or use `npm run auth:keys` instead. Current local auth keys are already configured; leave them intact. Never import blank values into a working backend. The worksheet and `.env.local` are private local files and are intentionally absent from Git.

Without `NEXT_PUBLIC_CONVEX_URL`, the frontend shows setup instructions instead of pretending storage/auth work. Both local processes are needed for local use. `.convex/`, `.env*` (except the example), build files, and test artifacts are ignored. NEAR signing code is confined to the backend Node action; credentials must be manually configured there. The ignored `.env.near.local` worksheet is optional and is not automatically synchronized. See [settlement setup](docs/settlement.md).

## Foundation walkthrough

1. Open `/sign-in`, choose **Sign up**, and create account A.
2. On `/dashboard`, select **New mission**. Enter a title, choose `csv_normalize` or `csv_summary`, and select **Use synthetic sample CSV** or paste CSV.
3. Set a positive budget (up to 1,000 testnet NEAR), a deadline within 30 days, and acceptance notes. Select **Create private mission**.
4. The saved `/missions/[id]` page shows the exact input and budget. Reload to confirm persistence; edit and save changes. Drafts move no funds.
5. In a private browser window, create account B. Its dashboard does not list A's mission. Paste A's mission URL: access is denied without revealing the mission contents. Backend tests also exercise unauthorized edit/delete attempts.
6. Sign back in as A and delete the draft using the confirmation step.

On the orchestration branch, a draft also has **Open auction**. Select exact processing columns (and case mode for normalization), then open it. The job and `AUCTION_OPENED` event persist, and editing/deleting that mission is blocked. Refresh to see the same state. Until the teammate engine is integrated, it explicitly waits without generating activity. **Cancel unawarded auction** records cancellation and retains the immutable brief for audit. This does not transfer funds. Dispute decisions and actual submitted deliverables appear only when a trusted worker has persisted them.

On the experience branch, **Add sample missions** creates two owner-private synthetic drafts idempotently. **Remove unused samples** deletes only unused sample drafts; it preserves regular missions, active jobs, receipts and uncertain payment records. Open `/economy` to see the recorded job node and actual event stream; agent/award/subcontract edges appear only when those records exist. Use an agent profile link to inspect your own contract/reputation history; it is not a global rating.

At `/security`, select your job and run a controlled probe. Reputation/depth probes record backend denials without signing. Payment probes are unavailable until a real intent/state exists; the UI does not fake an attack result. An approved job's receipt panel prepares the exact configured recipient/amount and requires owner confirmation before scheduling any signing. `UNKNOWN_RECONCILE` offers a check of the existing hash, never a resend. Explorer links distinguish an available transaction hash from a matching final confirmation.

Input limits: 64 KiB of UTF-8 CSV, 1–500 data rows, at most 32 columns, unique nonempty headers, consistent row widths, 100-character titles, and 1,000-character acceptance notes. No external URL fetching or file execution. Notes are stored as text, not executed or treated as policy. Input validation is not yet the service execution/verification engine.

## Validation

```sh
npm run lint
npm run typecheck
npm test
npm run test:integration
npm run build
npm audit
```

Vitest uses `convex-test` for isolated backend tests; it does not substitute for a live auth check. Browser tests use real Convex Auth and the running backend:

```sh
# Start npm run dev:backend and configure auth keys first.
npx playwright install chromium
npm run test:e2e
# Or use an existing compatible system Chromium:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Playwright starts Next.js automatically if port 3000 is free. Run against a disposable development backend: tests create disposable auth accounts and may retain active/cancelled sample jobs for audit. Draft-only test work is deleted on success. Auth accounts are retained. Traces, video, and screenshots are disabled to avoid storing credential-bearing form state. Browser tests use real Convex Auth, persisted records and subscriptions; payment adapter tests are explicitly offline fixtures.

Latest checks: **71 unit/backend tests and 3 live browser scenarios passed**, plus lint, types and production build. `npm audit` reported zero known vulnerabilities. A manual-only GitHub validation workflow is supplied; it has not been run on GitHub in this session. It does not deploy, submit, post publicly, or contain secrets. Check your free-tier eligibility/quotas before running hosted services.

`npm run test:near` independently verifies an existing real receipt using public transaction fields and never submits a transfer. It reports not-run when those fields are absent; it is not part of the default offline suite. Real payment acceptance remains pending.

For a production-build smoke check, run `npm run build`, then `npm start` while the configured Convex backend is running. Do not run the production build and development server concurrently in the same checkout.

## Architecture and boundaries

- `app/`, `components/`: Next.js App Router UI, Tailwind, shadcn/ui-style Button/Input primitives, Convex client subscriptions, and authenticated navigation.
- `convex/`: Convex Auth managed tables and HTTP routes; mission schema and owner-scoped query/create/update/delete functions. Owner IDs come exclusively from the verified session. Lists use indexed pagination; denied and nonexistent mission IDs return the same error.
- `convex/jobs.ts`, `workflow.ts`, `workflowHelpers.ts`: owner-facing job controls and internal worker transitions. No public endpoint accepts bidder scores, verification verdicts or reputation deltas. Parent holdback plus child price equals the original award; child reservations are a breakdown of that award, not a second charge to the buyer. Rejected/pending obligations remain recorded conservatively for later settlement integration.
- `lib/`: bounded mission validation, BigInt money conversion, static initial agents. No agent execution yet; the assigned teammate package remains untouched.
- `tests/`: unit, backend integration, and a live two-account browser smoke test.

## Branch combination and release

Review/merge the orchestration, security/NEAR and experience/release branches in that order, or start an integration branch from `origin/feat/cluster-4-experience-release`, which already contains the other two. Integrate the teammate's economy kernel there and wire the bounded driver described in [worker integration](docs/worker-integration.md). No teammate-owned kernel files were replaced by these branches.

Then demonstrate a real CSV transformation, independent verification and meaningful subcontract; configure server-only testnet credentials; confirm one exact authorized payout; and run the full suite again. [Release instructions and submission checklist](docs/release.md) cover cloud setup, honest track evidence and remaining owner-supplied information. No repository visibility, license, public post or submission is changed automatically.

Auth uses the documented Convex Auth React provider in a client boundary. Private mission data is fetched only after authentication, and marketplace functions independently check backend identity and ownership. Protected routes may serve a public HTML shell, but never private mission data in that shell. Authentication endpoints necessarily allow credential exchange; every marketplace entry point requires an authenticated session and applicable resource ownership. Convex Auth is beta. The demo currently has neither email verification nor recovery, so it must not be represented as production account management.

The `minimatch` override patches a development-only ESLint dependency advisory while retaining pinned compatible tooling. Convex Auth uses the patched compatible `@auth/core` 0.41.3 rather than the older version shown in its setup example.

Official setup references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Convex Auth setup](https://labs.convex.dev/auth/setup), [manual auth/key configuration](https://labs.convex.dev/auth/setup/manual), [password provider](https://labs.convex.dev/auth/config/passwords), and [Convex testing](https://docs.convex.dev/testing/convex-test).

See [cluster status](docs/CLUSTER_STATUS.md), [decisions and deviations](docs/DECISIONS_AND_DEVIATIONS.md), and [locked product decisions](docs/decisions.md). On 2026-11-12 the user authorized continued sequential work and feature-branch pushes; acceptance gates still require actual working evidence.
