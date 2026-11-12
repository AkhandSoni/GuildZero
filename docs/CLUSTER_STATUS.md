# Cluster execution status

Current work: **User explicitly authorized independent Cluster 3/4 feature branches on 2026-11-12 for later combination. The missing teammate engine still prevents full integrated acceptance.**

Latest follow-up branch: **`fix/negotiation-roles-pricing-privacy`**, based on the experience branch. The screenshot audit gaps are addressed in code; engine/live settlement/hosting acceptance remains pending.

## GitHub issue follow-up — 2026-11-12

Branch `fix/issue-1-economy-contracts` stacks on the pricing privacy fix. Issue #1 now has shared JSON engine contracts, validated saved processing options across mission CRUD/form/schema, explicit legacy-draft migration behavior, immutable launch options, and documented transition/idempotency boundaries. Only types and option validation occupy the shared engine directory; teammate algorithm/service/verifier implementations remain pending in #2/#3. A regression caught parent summary options being inherited during child normalization validation; children now use their own options. Old callers omitting options on edit clear stale selections, and launch cannot inject missing/changed options.

Actual results: `npm test` **96 passed across 10 files**; `npm run test:integration` **52 passed** (included in the 96); lint/typecheck/build passed; the updated schema/functions deployed on the existing local backend; **4 production-browser tests passed** (summary options, normalization case mode, exact one-yocto budget, editing/reload, auth/privacy, graph/security samples). Client-boundary check passed on 25 assets; audit reported zero vulnerabilities; `git diff --check` passed. An initial browser selector collided with Next's route announcer; the selector was narrowed and the complete suite passed. No engine work, payment, cloud release or main merge is claimed by these results.

The 13 open roadmap issues were reviewed against their full acceptance criteria, not titles. #1 is ready to close on its feature branch; the others remain necessary: #2/#3 engine, #4 scheduled integration, #5 meaningful subcontract execution, #6 earned reputation affecting later ranking, #7 full economy gate, #8 policy evidence/integration, #9 real finalized payment, #10 payment/security recovery gate, #11 complete live workflow/accessibility checks, #12 reproducible integrated release/recovery, #13 actual demo/submission and owner authorization. Earlier user approval permits feature work, but does not satisfy these functional gates. Main remains the foundation until the requested later combination.

| Cluster | Status | Evidence |
|---|---|---|
| 1 Foundation + auth | COMPLETE | Local Convex deployment, 33 Vitest tests, live two-account browser test, lint/types/build, production smoke checks |
| 2 Marketplace | IN PROGRESS | Convex lifecycle and integration tests; teammate engine not yet available |
| 3 Security + NEAR | IMPLEMENTED / LIVE ACCEPTANCE PENDING | `feat/cluster-3-security-near`; policy/adapter tests pass; funded credentials and real verified work still needed |
| 4 Demo + release | IMPLEMENTED / INTEGRATED RELEASE PENDING | `feat/cluster-4-experience-release`; live graph/UI tests pass; engine, live payment and cloud hosting still needed |

After each cluster, update commands/tests/demo and STOP. Do not treat this file as authorization to proceed.

## Audit follow-up: pricing privacy and negotiation actors

Implemented buyer-facing allowlists for bid/negotiation/contract/event responses, including sanitizing old raw pricing diagnostics; browser-safe agent metadata without reserves; optional backend-only private floor configuration; an internal worker pricing context; mandatory roles and backend-derived identities for new negotiation messages; exact referenced-offer acceptance; separate buyer-cap and seller-floor enforcement; and a visible actor-aware transcript. Subcontract buyer identity is the parent awarded agent. Legacy actor-less rows are not silently rewritten and cannot authorize a new award. Published fixture profile defaults remain public source, not secrets. Worker and frontend interfaces must be updated together as described in `worker-integration.md`.

A new fixture exposed an existing valid one-column CSV rejection due to delimiter guessing; comma parsing is now explicit and consistent across validation and column selection. The teammate's economy implementation paths remain unchanged.

Actual checks: lint/typecheck passed; **79 tests across 8 files passed**; production build passed; all **3 production-browser scenarios passed**, including absence of reserve prices from the actual agent page; `npm run check:client` passed on 25 generated assets with no private pricing fields or server-secret identifiers; dependency audit reported zero vulnerabilities. A live public HTTP query to the internal worker pricing context was rejected. The tests verify that raw private minima and diagnostic markers survive internally but do not appear in buyer detail/economy/profile responses. No payment, public deployment or merge into main is performed by this follow-up.

## Cluster 3 branch — 2026-11-12

The user's explicit request to proceed with 3 and 4 supersedes waiting for the engine before implementing these branches. Branches are stacked on `feat/cluster-2-orchestration`, to combine later without replacing the teammate's package.

Implemented: owner-only exact payment preparation/confirmation; one immutable per-job intent; backend recipient configuration; approved-work/contract/reservation checks; child payment dependency on approved parent; atomic dedicated-signer lock; official NEAR JavaScript signing; hash/nonce persistence before a single broadcast; exact final receipt matching; conservative unknown-outcome accounting; owner-triggered reconciliation without resend; persisted security denials and controlled probes. Maximum payout is 1 testnet NEAR, additionally bounded by the actual contract holdback.

Validation: local Node actions deployed successfully using Node 24.22.3. `npm run lint`, `npm run typecheck`, `npm test` (64 tests), `npm run build`, and `npm audit` (zero vulnerabilities) passed. Offline adapter tests verified pre-broadcast identity persistence, successful final receipt handling, timeout lock retention and no second broadcast. A live read-only RPC status request verified `chain_id=testnet`; no payment was sent. Source/worksheet secrets remain outside Git.

`npm run test:near` is **NOT RUN against a real receipt**: required receipt fields and funded operator credentials are absent. The command reports this explicitly and does not submit funds. No real transaction, signature, balance or confirmation is fabricated. Full acceptance requires integrating the engine, supplying dedicated server-side testnet credentials and confirming one authorized real payout. Runbook: `docs/settlement.md`.

## Cluster 4 branch — 2026-11-12

`feat/cluster-4-experience-release` stacks on `feat/cluster-3-security-near`; both include the orchestration branch as ancestry. No branch is merged into main. The teammate's engine paths remain untouched.

Implemented owner-scoped live economy subscriptions and an XYFlow graph built only from persisted jobs/bids/contracts/subcontracts; bounded graph/history queries with visible truncation; private agent contract/reputation views; exact owner payment review and actual transaction explorer links when hashes exist; security lab with durable controlled-probe results and honest unavailable prerequisites; idempotent synthetic sample seeding; reset restricted to unused owned sample drafts, preserving active work and payment history. Added a manual validation workflow without deployment credentials.

Actual validation: lint/typecheck passed; 71 unit/backend tests across 7 files passed; production build includes all requested application routes. All 3 browser scenarios passed against `npm start` plus a real local Convex backend: foundation privacy/CRUD, auction persistence/cancel, and mobile graph/profile/security/sample-reset workflow. The mobile test verified the real persisted graph node, unavailable payment prerequisites, a recorded reputation-probe rejection, and preservation of active samples during reset. A browser asset scan found no server-secret identifiers or private-key literals in 25 client asset files.

Clean-clone validation also passed on official Node 24.22.3: a fresh clone of the experience branch ran `npm ci`, lint, typecheck, all 71 tests and a production build without copied environment files, auth keys, backend state or credentials. Dependency installation reported zero known vulnerabilities. Non-failing upstream deprecation notices remain in Convex Auth/ESLint dependencies. The manual GitHub workflow and cloud deployment were not run.

Not accepted yet: full engine-to-service-to-verifier-to-payment integration, a real confirmed testnet payout, public cloud deployment independent of the developer laptop, final demo recording and human-approved submission. No fake receipts or graph activity replace these requirements. Cloud Convex/hosting credentials are not configured; the user requested feature branches for later combination, so no unfinished site is published.

## 2026-11-12 — Cluster 2 orchestration progress

The user explicitly authorized sequential continuation and regular feature-branch commits/pushes while away. The old per-cluster approval stop does not require another permission request in this session. Product acceptance criteria remain unchanged.

Implemented on `feat/cluster-2-orchestration`:

- Owner-only idempotent auction opening with explicit service options, immutable mission briefs, private job/history queries and cancellation before award.
- Internal-only bid/negotiation/award transitions with capability, reserve floor, capacity, deadline, budget, duplicate award, and three-round checks. Selection reasons persist; scored bid generation remains the teammate's engine responsibility.
- One normalization child per summary contract; depth limited to one, child allocation contained in the original award, parent holdback reconciled to the actual child award. Concurrent awards/capacity are guarded by atomic mutations.
- Stored deliverables/verifications, one revision, buyer-only human dispute decisions, deterministic one-time reputation events and durable owner-scoped activity history.
- Parent worker context reads approved child CSV as its execution input; parent submission must bind the child deliverable ID. Failed child work opens a parent dispute and cannot be bypassed by buyer approval.
- Mission UI opens/cancels auctions, shows real persisted activity, contracts, verification checks and deliverable contents, and offers owner dispute controls. It explicitly labels the engine as pending. No synthetic activity is emitted to make the UI appear operational.

Actual checks for this increment:

| Check | Result |
|---|---|
| Local Convex schema/function deployment | PASS; existing local auth preserved |
| `npm run lint` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 45 tests across 3 files |
| `npm run test:integration` | PASS: 29 tests, included in the 45 above |
| `npm run build` | PASS |
| `npm audit` | PASS: zero known vulnerabilities reported |
| Production browser suite | PASS: final rerun 2/2 scenarios (foundation auth/privacy/CRUD and persisted auction open/reload/cancel), against `npm start` and the real local Convex backend |
| Public HTTP calls to `workflow:recordBid`, `workflow:award`, `workflow:recordVerification` | PASS: all rejected because these are internal functions |
| Teammate path isolation | PASS: no changes to `lib/economy`, `tests/unit/economy`, or `fixtures/economy` |

Reproduction: run `npm run dev:backend`, build/start Next.js as described in README, register a local account, create a sample mission, select processing columns and open the auction. Refresh to confirm persistence and locked brief; cancel the unawarded auction and inspect its recorded event. This demonstration does not claim that bidding or CSV execution is running.

**Cluster 2 remains incomplete.** The engine package is not on the configured remote, so no scheduled real auction-to-deliverable flow, independent data verification, or meaningful executed subcontract can be demonstrated yet. Internal fixtures are lifecycle tests only. See `worker-integration.md` for the exact connection points. Cluster 3/4 implementation is not silently substituted for this unmet gate; no payments or production hosting are claimed.

Additional required inputs later: dedicated NEAR testnet account/key (server-side only) for the real payment acceptance test, and a free cloud Convex/hosting deployment configuration for release. Existing `.env` files and secrets are preserved and remain ignored.

## Cluster completed: 1 / 4

Date: 2026-11-10. Authorized by the GuildZero master implementation prompt. No Cluster 2 work has started.

### Implemented

- Pinned Next.js App Router, React, TypeScript, Tailwind, shadcn/ui-compatible primitives, Convex, and Convex Auth. Next.js and Convex are the only application runtimes; test tools are development dependencies.
- Password signup/sign-in/sign-out, client session persistence, authenticated application layout, loading/error/empty states, and basic responsive navigation.
- Private mission create/list/detail/update/delete through indexed, owner-authorized Convex functions. Owner identity is derived from authentication rather than supplied by a caller. Mission lists are paginated.
- CSV templates `csv_normalize` and `csv_summary` as bounded draft briefs, synthetic sample input, deadlines, acceptance notes, and exact integer yoctoNEAR budgets. No service execution is claimed.
- Seven static agent profiles covering six roles and three seller strategies. No discovery, bidding, negotiation, or agent execution.
- Working official anonymous local Convex backend and auth key setup, without a cloud account or paid services.
- Ignored `.env.local` with generated working local URLs; ignored `.env.convex.local` with blank server-only configuration fields for later manual entry. Safe `.env.example` and ignore rules cover environment files, local backend state, dependencies, build output, and test artifacts.
- Setup/security notes and a two-user privacy walkthrough in README.

### Tests (pass/fail/not run)

| Command/check | Actual final result |
|---|---|
| `npm run dev:backend` | PASS: local backend started; auth/mission schema and indexes deployed; generated Convex types produced |
| `npm run auth:keys` | PASS: RS256 auth keys configured directly on local backend; values not printed or written to source |
| `npm run lint` | PASS: zero lint warnings/errors |
| `npm run typecheck` | PASS |
| `npm test` | PASS: 33 tests across 2 files |
| `npm run test:integration` | PASS: 17 backend tests (included in the 33 above, not additional tests) |
| `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium npm run test:e2e` | PASS: 1 live browser scenario, real password auth and two isolated accounts, no auth bypass or mocked backend |
| `npm run build` | PASS: all implemented routes compiled and generated |
| `npm start` | PASS: production Next.js server started successfully |
| Production HTTP smoke | PASS: `/`, `/sign-in`, `/dashboard` returned HTTP 200; private route serves a public shell only |
| Production browser smoke | PASS: anonymous `/dashboard` redirected to `/sign-in`; landing and sign-in fit a 390px mobile viewport |
| `npm audit` / `npm audit --omit=dev` | PASS: zero reported vulnerabilities |
| `git diff --check` | PASS |
| Git ignore checks | PASS: `.env.local`, `.env.convex.local`, `.convex`, `.next`, `node_modules`, `test-results` ignored |
| Source/test private-key literal scan | PASS: 33 files scanned, zero matching private-key literals |

The browser scenario verified signup for A and B, mission creation, reload persistence, editing, B's empty owner-scoped list, denial of B's access to A's known mission URL, A's sign-out/sign-in, and draft deletion. Integration tests additionally reject anonymous reads/writes, unauthorized edit/delete, malformed input, invalid budgets, and invalid deadlines.

Development browser test issues (password label accessibility and a route-wait pattern that also matched `/missions/new`) were fixed before the final passing run. No unresolved failing checks. Node 26 emits a non-failing experimental localStorage warning in the test runtime.

### Manual demo

1. From this configured checkout, run `npm run dev:backend` in one terminal and `npm run dev` in another. Local backend state and auth keys persist in ignored local storage; do not rotate them to repeat the demo.
2. Open http://localhost:3000, sign up, create a mission with synthetic sample CSV, reload, edit, and save.
3. In a separate private browser window, register another user. Its list remains empty; opening the first user's mission URL shows access denied/unavailable with no mission contents.
4. Sign back in as the first user and delete the draft with confirmation.

See README for clean-machine setup and cloud alternatives. Validation preview processes were stopped after checks; restart the two local processes to use the application.

### Security checks

Every marketplace query/mutation authenticates and checks owner scope. Unauthorized and nonexistent mission IDs use the same not-found result. Inputs are bounded on the backend; display text is escaped by React. Budgets use integer strings and BigInt, with no floating-point money conversion. No external URL fetching, signer, arbitrary transfer endpoint, public agent registration, or browser-side secret is implemented. Auth key generation passes values through stdin, keeps them out of source/logs, and refuses to overwrite working keys. The auth library's credential endpoints remain public as required for authentication.

### Known issues / deviations

- Convex Auth is beta; email verification and password recovery are not enabled in this zero-service demo. The UI and README disclose this.
- Cloud account setup and production hosting were not performed; hosting/release belong to Cluster 4. Local auth was tested against a real backend, not merely an auth mock.
- Only current auth/mission schema is implemented. Job execution, contracts, payments, events, and graph visualization require later clusters.
- Initial static profiles follow the master prompt's Cluster 1 requirement despite the older cluster document deferring agents. `/missions` follows the current requested route names. Details are in `DECISIONS_AND_DEVIATIONS.md`.
- Auth.js and a development parser dependency were patched based on actual audit findings; final audit is clean. No product-scope or security requirement was relaxed.
- Browser tests create disposable local auth accounts; successful runs delete their mission but retain those auth records. No cleanup of unrelated data is performed.

### Changed files

- Application: `app/`, `components/`, `lib/`.
- Backend and generated types: `convex/`.
- Tests/setup: `tests/`, `scripts/auth-keys.mjs`, `vitest.config.ts`, `playwright.config.ts`.
- Root tooling: `package.json`, `package-lock.json`, `tsconfig.json`, `next-env.d.ts`, `next.config.ts`, `postcss.config.mjs`, `eslint.config.mjs`, `components.json`.
- Documentation/configuration: `README.md`, root `AGENTS.md`, `.gitignore`, `.env.example`, this status file, `DECISIONS_AND_DEVIATIONS.md`.
- Local only, ignored: `.env.local`, `.env.convex.local`, `.convex/`.

Approval needed: **“Approve Cluster 2”** (or request Cluster 1 fixes). Stop here.

### Pre-push revalidation — 2026-11-10

At the user's explicit request to test everything and push the completed foundation:

- `npm ci` succeeded from the committed lockfile inputs.
- `npm run lint`, `npm run typecheck`, `npm test` (33 tests), `npm run test:integration` (17 included tests), `npm audit` (zero vulnerabilities), and `npm run build` all passed again.
- Restarted the real local Convex backend without replacing auth keys. Ran the complete two-account Playwright scenario against **`npm start` using the production build**: 1 passed. This verified actual signup/sign-in, mission CRUD, session persistence, and cross-user privacy in the built application.
- Repeated production HTTP checks for `/`, `/sign-in`, and `/dashboard` (all 200), anonymous workspace redirect, and 390px mobile landing/sign-in layout checks: all passed.
- Existing package deprecation warnings and the Node 26 experimental test-runtime warning are non-failing. No test, lint, type, build, or audit failure remains.
- Git remote is `https://github.com/AkhandSoni/GuildZero.git`, branch `main`. The remote had no changes ahead of this checkout at verification time; authenticated push dry-run succeeded.
- Environment files and local backend state remain ignored. No future cluster work was authorized by this push request.
- An additional walkthrough through the actual production UI confirmed a custom CSV is saved correctly, malformed CSV produces a visible error without saving, a one-yoctoNEAR budget preserves every decimal place after reload, editing updates the stored budget, canceling deletion preserves the mission, and confirming deletion removes it. Captured screenshots of the running mission workspace outside the repository.
- Per the user's request, repository documentation is limited to setup (`README.md`), coding instructions (`AGENTS.md`), locked decisions, cluster status, and material deviations. Detailed handoff/architecture/workflow/planning notes remain local and are not included in the push.
