# GuildZero

GuildZero is an autonomous economic marketplace for real, deterministic data-processing services. Agents make independent bidding and negotiation decisions; Convex provides centralized coordination. Agents are algorithms, not LLMs. Settlement is a **custodial NEAR testnet demonstration**, not trustless escrow.

**Current implementation:** integrated local hackathon prototype. Convex Auth, private mission CRUD, a scheduled deterministic economy, real CSV normalization/statistics, bounded negotiation, scored awards, meaningful one-level subcontracting, independent verification, owner dispute decisions, reputation, security probes and a live economy graph are connected. The application has labeled navigation, outcome metrics, scoped workflow stories and a read-only operator wallet. Next.js and Convex are the only application runtimes.

Agents calculate offers from their own profiles, estimated costs, workload, capacity and strategy. Winners are selected by normalized utility, with deterministic tie-breaking. Work approval and testnet payment confirmation are separate states. No LLM, model training, mainnet payments or fabricated activity is involved. Broader service expansion is paused. Public hosting, final demo recording and hackathon submission remain pending.

## Local setup (no account or paid service required)

Requirements: npm and network access for initial downloads. The supported backend runtime is **Node.js 24.22.3** (see `.nvmrc`); Convex Node actions do not support Node 26. You can invoke the launcher from Node 26: it selects an installed project runtime through mise/nvm, or downloads the pinned official Node archive into ignored `.convex/runtime/` after checking its SHA-256 checksum. It does not change your system Node or shell configuration.

```sh
npm ci
npm run dev
```

The single command deploys the configured Convex backend, starts its watcher, and starts Next.js. Open http://localhost:3000 after the services report readiness. Ctrl+C stops the processes it started. On a fresh clone, choose **Start without an account (run Convex locally)** in the first Convex prompt; the CLI creates ignored `.env.local` and downloads its local backend. Your existing configuration and data are reused. If a local backend is already running, stop it before using the combined command; startup refuses to silently reuse potentially stale functions. Alternatively, keep `npm run dev:backend` watching this checkout and run `npm run dev:frontend` separately.

Sign up using email and a **10–100 character password**, with confirmation and visibility controls. Common passwords and surrounding whitespace are rejected. **Email verification and password recovery are not enabled**; use disposable demo accounts and retain your password. No email service is required.

## Authentication upgrade and existing accounts

Convex Auth **2.0.0** manages sessions and password hashes in official Convex components. Its deployment signs access tokens automatically; manual JWT keys are no longer required. `npm run auth:keys` now only explains this and changes no keys. Existing backend secrets and old auth tables are retained, never deleted by startup.

After the upgrade, sign in again. Existing accounts migrate only after successful password verification and retain their original user IDs, private missions and financial history. Existing eight-character passwords can migrate unchanged. If an old password violates Auth 2's common-password, whitespace or maximum-length policy, sign-in asks for a new password and confirmation while requiring the original password as proof. New accounts and explicitly chosen replacement passwords require at least ten characters. No bulk user-ID rewriting is performed.

The application preserves its original unverified-email demo semantics using a credential adapter around official Auth 2 core/password components. Privileged component session creation is reachable only after the private credential verifier succeeds; clients cannot supply user IDs or claims. Legacy Scrypt verification is bounded and rate-limited. This is a local hackathon account system, not production account management.

Account recovery remains unavailable. The [issue #24 recovery design](docs/account-recovery-design.md) defines opt-in verified enrollment, proof/session safeguards and the provider approval/test gates. Stored login emails are not recovery proofs; existing user IDs and private ownership remain unchanged.

## Environment and secrets

`.env.example` lists public URL placeholders; do not overwrite a working `.env.local`. Convex writes the actual local deployment and public URLs. Auth 2 needs no application-managed JWT private key or JWKS. Old `JWT_PRIVATE_KEY`/`JWKS` values may remain in the backend for rollback; they are unused by the new authentication path. Existing ignored worksheets are retained and are not automatically imported.

Without `NEXT_PUBLIC_CONVEX_URL`, the frontend shows setup instructions. Both local services must run; `npm run dev` handles them together. `.convex/`, `.env*` (except the example), build files and test artifacts are ignored. Dedicated NEAR testnet credentials stay backend-only; startup and account migration never submit payments. See [settlement setup](docs/settlement.md).

## Compatible toolchain

Dependencies are pinned with their lockfile. The application uses Next.js 16.4.6, React 19.3.1, Convex 1.50.0 and Convex Auth 2.0.0. Supporting updates include PapaParse 5.7.1, Lucide 1.72.0 and convex-test 0.0.71 and rate-limiter 0.4.3.

“Latest” means the newest compatible stable releases: Node 24 is required by Convex actions; TypeScript 6.0.3 is retained because the current TypeScript ESLint parser rejects TypeScript 7; ESLint 9.39.5 is retained because Next's React/import/accessibility plugins do not support ESLint 10. Test tooling is development-only; Next.js and Convex remain the application architecture.

## Foundation walkthrough

1. Open `/sign-in`, choose **Sign up**, and create account A.
2. On `/dashboard`, select **New mission**. Enter a title, choose `csv_normalize` or `csv_summary`, and upload a UTF-8 `.csv` file, select **Use synthetic sample CSV**, or paste CSV.
3. Review the real dataset preview and column-quality counts. Use **Select numeric columns** for summary-ready columns or select them individually. Select processing columns (numeric columns for statistics; case handling for normalization). Set a positive budget (up to 1,000 testnet NEAR), a deadline within 30 days, and acceptance notes. Select **Create private mission**. Options persist with the draft and are visible after reload/edit.
4. The saved `/missions/[id]` page shows the exact input and budget. Reload to confirm persistence; edit and save changes. Drafts move no funds.
5. In a private browser window, create account B. Its dashboard does not list A's mission. Paste A's mission URL: access is denied without revealing the mission contents. Backend tests also exercise unauthorized edit/delete attempts.
6. Sign back in as A and delete the draft using the confirmation step.

**Open auction** uses the saved processing options and locks the mission brief. Scheduled backend stages inspect the job, calculate independent offers, counter at 98% of each initial offer, accept or reject within three rounds, rank eligible accepted offers, execute the actual service and independently verify its stored output. No browser tab is needed to keep execution running; the Convex backend must stay running. Cancellation is possible only before award. All decisions and outputs persist across reloads.

For a summary, enable **Clean before analysis** to hire one normalization subcontractor. Its verified CSV becomes the parent's actual input. The child allocation comes from the parent award; parent payable plus child price equals that award. Subcontracting stops at depth one. Before payment, the workspace shows bounded output metadata and verification checks. After every required parent/subcontract payment confirms, download the real JSON summary, spreadsheet-compatible summary CSV, or safe normalized CSV; full result tables and raw output then become available.

Template checks can approve work automatically. Select **Require human review of acceptance notes** when extra subjective requirements matter: objective checks still run, then the owner must approve or reject the dispute. Legacy briefs default to human review until explicitly edited. Failed objective verification permits one revision; repeated failure requires a human decision. Unexecutable input creates a dispute without inventing output and cannot be approved. An unaffordable/unavailable auction ends as **unawarded** with guidance to create a revised mission. A failed worker stage pauses safely and allows at most three owner-triggered retries of that stage. Older already-active auctions are preserved and are not silently executed by the new driver.

**Add sample missions** creates two owner-private synthetic drafts idempotently. **Remove unused samples** deletes only unused sample drafts, preserving real jobs, contracts, receipts and uncertain payment records. Open /economy for actual recorded relationships and events. Agent profiles show your own contract/reputation history. Global bounded earned reputation affects ranking without revealing other users' jobs.

At `/security`, select your job and run a controlled probe. Reputation/depth probes record backend denials without signing. Payment probes are unavailable until a real intent/state exists; the UI does not fake an attack result. An approved job's receipt panel prepares the exact configured recipient/amount and requires owner confirmation before scheduling any signing. `UNKNOWN_RECONCILE` offers a check of the existing hash, never a resend. Explorer links distinguish an available transaction hash from a matching final confirmation.

Input limits: 64 KiB of UTF-8 CSV, 1–500 data rows, at most 32 columns, unique nonempty headers, consistent row widths, 100-character titles, and 1,000-character acceptance notes. No external URL fetching or file execution. Notes are stored as text, not executed or treated as policy. The executor and independent verifier enforce the same bounded CSV contract.

Summary values use finite JavaScript numbers within ±1e12; nonzero literals that underflow to zero are rejected. Compensated summation preserves small contributions when large opposing values cancel, and a separate reference sum verifies the result within the documented tolerance. This is numerical analysis, not arbitrary-precision decimal accounting; all NEAR amounts separately use integer strings and BigInt.

Summary launch uses a strict-input preflight, including for older drafts: selected columns must contain only blank cells or plain decimal/scientific numbers (for example `-1234.50` or `1.25e3`). The CSV delimiter is a comma; quote fields containing commas, but quoting does not turn `"1,234.50"`, `"1234,50"`, `$12.50`, or `25%` into supported numbers. Currency, thousands separators, decimal commas and percentages are never guessed or converted. Choose the desired format/units explicitly in your source export or deselect those columns, then save the edited draft. The editor and saved brief identify selected columns and CSV record numbers before an auction can start; invalid drafts remain saved and editable. Cleaning trims whitespace only. Original CSV remains unchanged. A price-column sum is literally that column's sum, not quantity-times-price revenue. These numerical summaries do not infer currency or accounting precision. Representative CSV-owning user validation remains pending.


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
# Start npm run dev first; no auth key setup is required.
npx playwright install chromium
npm run test:e2e
# Or use an existing compatible system Chromium:
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e
```

Playwright starts Next.js automatically if port 3000 is free. Set `PLAYWRIGHT_BASE_URL=http://localhost:3001` to test an isolated checkout on another port with its own configured backend. Run against a disposable development backend: tests create disposable auth accounts and may retain active/cancelled sample jobs for audit. Draft-only test work is deleted on success. Auth accounts are retained. Traces, video, and screenshots are disabled to avoid storing credential-bearing form state. Browser tests use real Convex Auth, persisted records and subscriptions; payment adapter tests are explicitly offline fixtures.

Current validation results and remaining release gates are recorded in [cluster status](docs/CLUSTER_STATUS.md). Backend tests include the actual scheduled driver, real services, subcontract consumption, independent verification, revision, owner review, cancellation, unavailable budgets, retries and payment guards. Browser scenarios exercise the production app with real local Convex Auth and persisted subscriptions. A manual-only GitHub validation workflow does not deploy or submit anything.

`npm run test:near` independently verifies an existing real receipt using public transaction fields and never submits a transfer. It reports not-run when those fields are absent; it is not part of the default offline suite. Two separately owner-authorized parent/child transfers have been confirmed and independently checked on public testnet; see [receipt evidence](docs/settlement.md). The saved public receipt fields in this checkout allow the read-only check to be repeated.

For a production-build smoke check, run `npm run build`, then `npm start` while the configured Convex backend is running. Do not run the production build and development server concurrently in the same checkout.

## Dataset retention

Saved content has no automatic expiry. Owners can remove eligible terminal mission inputs/outputs from **Dataset retention** on the mission page after all work and exact payment obligations are settled. Removal includes parent/child data and free-text evidence, prevents brief reuse, and retains financial identities/receipts. Active, failed or uncertain settlement blocks removal. Drafts retain their separate Delete draft control. Public NEAR records, independent downloads, copies, backups and auth records have separate boundaries. See [demo retention policy](docs/data-retention.md); use synthetic data, not sensitive customer datasets.


## Business-user workflow

The mission form imports one UTF-8 CSV within the existing 64 KiB/500-row/32-column limits, with specific encoding/format errors and an editable preview. Failed imports retain the prior data and selected columns. File contents are read locally and sent through the existing owner-private save API only when the mission is saved; the original local file is never changed.

Use **Search saved missions**, service filters and draft/started filters to retrieve your work beyond the currently loaded page. **Use as new mission** copies an owned brief into a new private draft with a refreshed deadline; it carries no jobs, contracts, payment authorizations or receipts. The dashboard surfaces work waiting for a human decision separately from prepared payment approvals.

Research, priorities, acceptance criteria and GitHub issues are recorded in [user requirements](docs/USER_REQUIREMENTS.md). The owner selected business users processing sales or operations CSVs; detailed needs are desk-research hypotheses, not claims of completed user interviews. The editor warns before discarding unsaved changes through same-tab links, Back, reload/close, Sign out or Cancel editing. It keeps edits in React memory only; nothing is autosaved. Browser shutdown or suppressed dialogs cannot guarantee recovery. Account recovery and representative-user validation remain tracked follow-ups.

## Preview, settlement and result release

Full computed output is withheld by owner-authenticated backend queries until every required payment has matching final testnet evidence bound to the latest approved deliverable, verification, contract and exact amount. Before settlement, preview contains row/column counts, up to five column names, format, size and verification checks. It contains no computed statistics, normalized rows, raw output or download payload. Work acceptance, an authorized intent, a transaction hash or a pending/failed/uncertain status cannot unlock delivery. A cleaning subcontract and its parent must each settle; internal execution and verification can still read their stored results. Older attempts stay locked. Previously downloaded/exposed data cannot be made secret retroactively.

Before launch, the mission workspace checks server configuration and recipient availability, shows the 1 testnet NEAR maximum **total automated award**, and labels the shared balance as a cached estimate that does not deduct pending obligations. This conservative total cap keeps each later parent/child allocation within the existing 1 NEAR per-transfer cap. A larger valid planning budget is not a deposit and does not increase the award cap. Network calls are not made by this preflight query; the signer still checks actual chain conditions before payment.

Without settlement configured, explicitly acknowledge metadata-only delivery before opening an auction. Real processing/verification still runs, but full output remains locked until configuration is corrected and actual payments confirm. Preflight is not a reservation or funding guarantee. Configuration is rechecked at automated award unless the owner chose metadata-only processing. Human acceptance decisions review metadata, objective verification and acceptance requirements; they do not imply inspection of the withheld full output. Failed/uncertain payment intents are not reset or replaced; recovery remains tracked in #33 and #9/#10. No additional payment occurs during startup or release checks.

## Application workspace

The public site, account pages and all workspace routes share a graphite/white/orange visual system with self-hosted Geist fonts (SIL OFL license in `app/fonts/LICENSE.txt`). The public service example computes real output from a labeled synthetic CSV in the browser; it creates no mission, auction or payment. Mission creation is divided into four sections; saved missions separate the brief, work/results and settlement, with the original input available on demand and full result evidence gated by settlement.

The dashboard summarizes recent main-job outcomes and links to actual human reviews and prepared payments. `/missions` provides private search and filters; `/agents` lists the built-in roles; `/payments` filters the latest 50 owner-private payment intents and links to their mission receipts. `/economy` combines the recorded graph with per-mission workflow stories; original event codes remain available in the technical audit trail. Main work, cleaning outcomes and payment confirmation are shown separately. Counts and history windows are explicitly bounded, not all-time totals.

The operator wallet shows the configured public testnet account and finalized RPC evidence. Refresh is authenticated, read-only and limited to once per 30 seconds across the shared operator. Available balance excludes storage collateral and a 0.01 NEAR reserve, but does not subtract pending contract obligations. It is shared custodial demo funds, not a personal balance or mission deposit. Network errors retain the last successful reading and timestamp. New payment preparation failures retain safe stage explanations; older generic failures cannot recover details never recorded. No automatic retry is introduced.

## Architecture and boundaries

- `app/`, `components/`: Next.js App Router UI, Tailwind, shadcn/ui-style Button/Input primitives, Convex client subscriptions, and authenticated navigation.
- `convex/`: Convex Auth component sessions, preserved legacy tables; mission schema and owner-scoped query/create/update/delete functions. Owner IDs come exclusively from the verified session. Lists use indexed pagination; denied and nonexistent mission IDs return the same error.
- `convex/economyWorker.ts`: bounded versioned scheduled stages; atomic writes/scheduling, stale-callback guards, sanitized pause events and limited owner retries. No signing or network calls.
- `convex/jobs.ts`, `workflow.ts`, `workflowHelpers.ts`: owner-facing job controls and internal worker transitions. No public endpoint accepts bidder scores, verification verdicts or reputation deltas. Parent holdback plus child price equals the original award; child reservations are a breakdown of that award, not a second charge to the buyer. Rejected/pending obligations remain recorded conservatively for later settlement integration.
- `lib/`: bounded mission validation, BigInt money conversion, static initial agents, and shared economy types/options validation. The integrated economy kernel contains the real decision algorithms, CSV executor and independent verifier.
- `tests/`: unit, backend integration, and a live two-account browser smoke test.

## Branch combination and release

PRs #14 and #15 combined the engine and application histories. The scheduled driver now connects them. Use [release instructions](docs/release.md) for the remaining hosting and human submission requirements. Do not merge the paused expansion worktree or claim a public deployment from local checks. Existing local environment files and backend state are ignored and must never be committed.

Auth uses the documented Convex Auth React provider in a client boundary. Private mission data is fetched only after authentication, and marketplace functions independently check backend identity and ownership. Protected routes may serve a public HTML shell, but never private mission data in that shell. Authentication endpoints necessarily allow credential exchange; every marketplace entry point requires an authenticated session and applicable resource ownership. Convex Auth is beta. The demo currently has neither email verification nor recovery, so it must not be represented as production account management.

The `minimatch` override patches a development-only ESLint dependency advisory while retaining compatible tooling. Auth 2 no longer requires the old direct `@auth/core` dependency.

Official references: [Auth 2 source and migration notes](https://github.com/convex/convex-auth), [Convex runtimes](https://docs.convex.dev/functions/runtimes), [Next.js installation](https://nextjs.org/docs/app/getting-started/installation), and [Convex testing](https://docs.convex.dev/testing/convex-test).

See [cluster status](docs/CLUSTER_STATUS.md), [decisions and deviations](docs/DECISIONS_AND_DEVIATIONS.md), and [locked product decisions](docs/decisions.md). On 2026-11-12 the user authorized continued sequential work and feature-branch pushes; acceptance gates still require actual working evidence.
