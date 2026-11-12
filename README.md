# GuildZero

GuildZero is an autonomous economic marketplace for real, deterministic data-processing services. Agents make independent bidding and negotiation decisions; Convex provides centralized coordination. Agents are algorithms, not LLMs. Settlement is a **custodial NEAR testnet demonstration**, not trustless escrow.

**Current implementation:** integrated local hackathon prototype. Convex Auth, private mission CRUD, a scheduled deterministic economy, real CSV normalization/statistics, bounded negotiation, scored awards, meaningful one-level subcontracting, independent verification, owner dispute decisions, reputation, security probes and a live economy graph are connected. The dashboard uses the requested light card layout. Next.js and Convex are the only application runtimes.

Agents calculate offers from their own profiles, estimated costs, workload, capacity and strategy. Winners are selected by normalized utility, with deterministic tie-breaking. Work approval and testnet payment confirmation are separate states. No LLM, model training, mainnet payments or fabricated activity is involved. Broader service expansion is paused. Public hosting, final demo recording and hackathon submission remain pending.

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

Without `NEXT_PUBLIC_CONVEX_URL`, the frontend shows setup instructions instead of pretending storage/auth work. Both local processes are needed for local use. `.convex/`, `.env*` (except the example), build files, and test artifacts are ignored. NEAR signing code is confined to the backend Node action; configure dedicated testnet credentials there. The ignored `.env.near.local` worksheet is optional and is not automatically synchronized. See [settlement setup](docs/settlement.md).

## Foundation walkthrough

1. Open `/sign-in`, choose **Sign up**, and create account A.
2. On `/dashboard`, select **New mission**. Enter a title, choose `csv_normalize` or `csv_summary`, and select **Use synthetic sample CSV** or paste CSV.
3. Select processing columns (numeric columns for statistics; case handling for normalization). Set a positive budget (up to 1,000 testnet NEAR), a deadline within 30 days, and acceptance notes. Select **Create private mission**. Options persist with the draft and are visible after reload/edit.
4. The saved `/missions/[id]` page shows the exact input and budget. Reload to confirm persistence; edit and save changes. Drafts move no funds.
5. In a private browser window, create account B. Its dashboard does not list A's mission. Paste A's mission URL: access is denied without revealing the mission contents. Backend tests also exercise unauthorized edit/delete attempts.
6. Sign back in as A and delete the draft using the confirmation step.

**Open auction** uses the saved processing options and locks the mission brief. Scheduled backend stages inspect the job, calculate independent offers, counter at 98% of each initial offer, accept or reject within three rounds, rank eligible accepted offers, execute the actual service and independently verify its stored output. No browser tab is needed to keep execution running; the Convex backend must stay running. Cancellation is possible only before award. All decisions and outputs persist across reloads.

For a summary, enable **Clean before analysis** to hire one normalization subcontractor. Its verified CSV becomes the parent's actual input. The child allocation comes from the parent award; parent payable plus child price equals that award. Subcontracting stops at depth one. Download the real JSON summary or safe normalized CSV from the workspace.

Template checks can approve work automatically. Select **Require human review of acceptance notes** when extra subjective requirements matter: objective checks still run, then the owner must approve or reject the dispute. Legacy briefs default to human review until explicitly edited. Failed objective verification permits one revision; repeated failure requires a human decision. Unexecutable input creates a dispute without inventing output and cannot be approved. An unaffordable/unavailable auction ends as **unawarded** with guidance to create a revised mission. A failed worker stage pauses safely and allows at most three owner-triggered retries of that stage. Older already-active auctions are preserved and are not silently executed by the new driver.

**Add sample missions** creates two owner-private synthetic drafts idempotently. **Remove unused samples** deletes only unused sample drafts, preserving real jobs, contracts, receipts and uncertain payment records. Open /economy for actual recorded relationships and events. Agent profiles show your own contract/reputation history. Global bounded earned reputation affects ranking without revealing other users' jobs.

At `/security`, select your job and run a controlled probe. Reputation/depth probes record backend denials without signing. Payment probes are unavailable until a real intent/state exists; the UI does not fake an attack result. An approved job's receipt panel prepares the exact configured recipient/amount and requires owner confirmation before scheduling any signing. `UNKNOWN_RECONCILE` offers a check of the existing hash, never a resend. Explorer links distinguish an available transaction hash from a matching final confirmation.

Input limits: 64 KiB of UTF-8 CSV, 1–500 data rows, at most 32 columns, unique nonempty headers, consistent row widths, 100-character titles, and 1,000-character acceptance notes. No external URL fetching or file execution. Notes are stored as text, not executed or treated as policy. The executor and independent verifier enforce the same bounded CSV contract.

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

Current validation results and remaining release gates are recorded in [cluster status](docs/CLUSTER_STATUS.md). Backend tests include the actual scheduled driver, real services, subcontract consumption, independent verification, revision, owner review, cancellation, unavailable budgets, retries and payment guards. Browser scenarios exercise the production app with real local Convex Auth and persisted subscriptions. A manual-only GitHub validation workflow does not deploy or submit anything.

`npm run test:near` independently verifies an existing real receipt using public transaction fields and never submits a transfer. It reports not-run when those fields are absent; it is not part of the default offline suite. Two separately owner-authorized parent/child transfers have been confirmed and independently checked on public testnet; see [receipt evidence](docs/settlement.md). The saved public receipt fields in this checkout allow the read-only check to be repeated.

For a production-build smoke check, run `npm run build`, then `npm start` while the configured Convex backend is running. Do not run the production build and development server concurrently in the same checkout.

## Architecture and boundaries

- `app/`, `components/`: Next.js App Router UI, Tailwind, shadcn/ui-style Button/Input primitives, Convex client subscriptions, and authenticated navigation.
- `convex/`: Convex Auth managed tables and HTTP routes; mission schema and owner-scoped query/create/update/delete functions. Owner IDs come exclusively from the verified session. Lists use indexed pagination; denied and nonexistent mission IDs return the same error.
- `convex/economyWorker.ts`: bounded versioned scheduled stages; atomic writes/scheduling, stale-callback guards, sanitized pause events and limited owner retries. No signing or network calls.
- `convex/jobs.ts`, `workflow.ts`, `workflowHelpers.ts`: owner-facing job controls and internal worker transitions. No public endpoint accepts bidder scores, verification verdicts or reputation deltas. Parent holdback plus child price equals the original award; child reservations are a breakdown of that award, not a second charge to the buyer. Rejected/pending obligations remain recorded conservatively for later settlement integration.
- `lib/`: bounded mission validation, BigInt money conversion, static initial agents, and shared economy types/options validation. The integrated economy kernel contains the real decision algorithms, CSV executor and independent verifier.
- `tests/`: unit, backend integration, and a live two-account browser smoke test.

## Branch combination and release

PRs #14 and #15 combined the engine and application histories. The scheduled driver now connects them. Use [release instructions](docs/release.md) for the remaining hosting and human submission requirements. Do not merge the paused expansion worktree or claim a public deployment from local checks. Existing local environment files and backend state are ignored and must never be committed.

Auth uses the documented Convex Auth React provider in a client boundary. Private mission data is fetched only after authentication, and marketplace functions independently check backend identity and ownership. Protected routes may serve a public HTML shell, but never private mission data in that shell. Authentication endpoints necessarily allow credential exchange; every marketplace entry point requires an authenticated session and applicable resource ownership. Convex Auth is beta. The demo currently has neither email verification nor recovery, so it must not be represented as production account management.

The `minimatch` override patches a development-only ESLint dependency advisory while retaining pinned compatible tooling. Convex Auth uses the patched compatible `@auth/core` 0.41.3 rather than the older version shown in its setup example.

Official setup references: [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), [Convex Auth setup](https://labs.convex.dev/auth/setup), [manual auth/key configuration](https://labs.convex.dev/auth/setup/manual), [password provider](https://labs.convex.dev/auth/config/passwords), and [Convex testing](https://docs.convex.dev/testing/convex-test).

See [cluster status](docs/CLUSTER_STATUS.md), [decisions and deviations](docs/DECISIONS_AND_DEVIATIONS.md), and [locked product decisions](docs/decisions.md). On 2026-11-12 the user authorized continued sequential work and feature-branch pushes; acceptance gates still require actual working evidence.
