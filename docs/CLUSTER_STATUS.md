# Cluster execution status

Current work: **Integrated local hackathon prototype completed and validated. PR #15 is merged, the scheduled economy is connected, the full public/account/workspace interface has been redesigned and real parent/child testnet payments have confirmed. The verified integration is on main. Public hosting, final recording and submission remain pending. Broader service expansion remains paused.**

## Entire-application product design — 2026-11-13

The owner explicitly requested redesigning the entire app after observing that the public home still used the original placeholder. Issue #30 records the gap. Reviewed primary design references from Linear, Vercel Geist and Trigger.dev, then applied a coherent graphite/white/orange system to the public home, sign-in/signup, dashboard, missions list/create/detail, agents catalog/profile, economy graph, payments, security and fallback states. Replaced the accumulated gradient/pill styles; self-hosted official Geist regular/semibold fonts with their SIL OFL license. No new package or application runtime was introduced.

The public site explains the actual workflow, services and trust boundaries. An interactive synthetic sample computes normalization/statistics through the existing pure CSV adapter in the browser, with no job or transaction created. Service links preselect their intended template for signed-in users. Mission creation has four numbered sections, saved missions have functional section links and expandable input/raw output/negotiation evidence, the dashboard prioritizes current work over duplicate directories, and agent/security pages have purpose-specific layouts. Ownership, budget/settlement policies and stored financial records are unchanged.

Validation: lint, typecheck, production build, client-boundary scan (27 assets) and npm audit pass; **214 tests in 25 files**, including **99 integration tests**, pass. The full **13-scenario production browser suite passed in 2.2 minutes** on the isolated backend. This includes the new public example and service-entry checks plus all existing auth/private economy/result/security/recovery flows. A first run found an ambiguous service-selector label; an explicit accessible label corrected it before the passing run. Sampled rendered text contrast checks passed on public/account/dashboard/editor/agent/security/payment/economy pages; these checks are not a complete accessibility certification.

Desktop and mobile screenshots were inspected across the existing routes. A separate production browser smoke processed an actual synthetic mission, checked its work/settlement anchors and 404 recovery, with no page errors or mobile horizontal overflow. No key was read/copied, payment submitted, public hosting performed or existing user financial record rewritten. The changes are integrated into local main. A browser smoke on the user’s existing port 3000 verified the redesigned public page, both computed examples, signup/sign-out, dashboard, agent catalog and direct normalization editor entry with no page errors or mobile overflow. That running-copy smoke created no mission or payment. Remote push verification is reported separately. Existing unsaved-edit, account-recovery, representative-user and release/payment-crash validation issues remain open; broader services stay paused.

## Business-user requirements and usability pass — 2026-11-13

The user requested research-driven requirements engineering and implementation, selected business users processing sales/operations CSVs, requested GitHub issues for findings, and asked to close old implemented issues first. [USER_REQUIREMENTS.md](USER_REQUIREMENTS.md) separates owner-confirmed direction, desk-research evidence, inferred needs, acceptance criteria and follow-up validation. No user interviews, market metrics or new service categories are claimed.

Implemented U1–U7 (#16–#22): bounded UTF-8 CSV file import alongside paste/sample input; editable preview and column-quality counts; explicit numeric-column selection; plain-language service/review/next-step guidance; private indexed title search and service/brief-state filters; safe brief reuse with a refreshed deadline and no copied execution/payment authority; actual result tables and safe summary CSV export; dashboard links for work awaiting a human decision. All mission brief fields remain in form state across data changes. Search and mission-title labels are distinct, and browser tests wait for the intended route.

Validation: lint/types/build/client-boundary checks pass; **205 tests across 23 files**, including **96 integration tests**, pass; npm audit reports zero known vulnerabilities. Four focused live development-browser scenarios passed (25.8 seconds), including import-to-result/export/reuse/search, human-review queue, invalid-file preservation, the original economy and two-user mission privacy. The full **11-scenario production-browser suite passed in 2.0 minutes**, covering the existing economy/privacy/security/recovery/auth flows plus both new business-user journeys. Tests use a separate fresh local backend and port 3001; existing environment values, user-started services and stored financial records are preserved. No new transfer, hosting or submission occurs in this pass.

Issue audit against existing main: closed #4, #5, #6, #7, #8 and #11 with source/test evidence, after re-running all 189 baseline tests and rechecking the existing child receipt read-only as CONFIRMED. #9/#10 remain open for missing process-level abrupt-interruption/restart proof; #12 for outstanding reproducibility/recovery/hosted release checks; #13 for final demo/submission. New #23 (unsaved navigation protection), #24 (safe account recovery before real business use) and #25 (representative-user validation) remain explicit follow-ups. Do not infer that these are complete from passing local tests.

This bounded usability pass stops at the current gate. Paused broader services, public deployment and submission remain separate.

## Compatible toolchain and single-command startup — 2026-11-13

The user approved latest compatible releases with Convex retained, Auth 2 migration and a ten-character minimum for new passwords. Upgraded Convex to 1.50.0, Convex Auth to 2.0.0, TypeScript to 6.0.3, Lucide to 1.72.0, PapaParse to 5.7.1, convex-test to 0.0.71 and the application rate limiter to 0.4.3. Node 24.22.3 is pinned for Convex actions. ESLint 9 and TypeScript 6 are explicit compatibility exceptions to incompatible newer majors.

Plain `npm run dev` now chooses/downloads the supported project runtime, deploys Convex, starts its watcher and starts Next.js. Separate frontend/backend commands remain available. Verified startup from system Node 26.13.0, including Ctrl+C cleanup, plus the official SHA-256-checked Node download fallback with version managers unavailable. Existing environment values, server-side keys and database history are preserved. A final exact-value signing-key scan found no match in tracked source. Auth 2 uses deployment-managed signing, so no manual auth-key generation is required.

Existing user IDs and ownership survive lazy credential conversion; old sessions must sign in again. A live pre-upgrade eight-character account retained access to its pre-upgrade private draft after migration, then the temporary draft was deleted. A restricted private database backup was created before deployment. Seven new backend regressions cover ownership, wrong credentials, Unicode normalization, explicit password upgrades, throttling, revocation and rollback. New signup/replacement policy is 10–100 characters; valid grandfathered eight-character credentials can convert unchanged. The form handles required legacy password upgrades with original-password proof and confirmation. Private views unsubscribe before logout revokes their session.

Current local validation: lint and types pass; **189 tests in 21 files**, including **90 integration tests**, pass; **nine real browser scenarios** pass against the actual local backend using the one-command development startup (2.0 minutes), including renewal after the initial access token expires. The same **nine production-browser scenarios passed in 1.8 minutes** against the final production build. Production build and client-secret boundary scan passed. A separate clean checkout with fresh npm ci, no copied environment files and no backend data passed lint, types, all 189 tests, build, client scan and npm audit (zero known vulnerabilities). The existing stored testnet receipt was independently rechecked read-only as CONFIRMED. No new payment was submitted by this upgrade.

The existing audit source repairs and regression tests are retained in a separate commit; generated audit reports stay local. No paused service expansion, public hosting, recording or submission is included. Stop at the current release gate until explicitly authorized.

## Full system audit and local repairs — 2026-11-13

The user authorized a system-wide audit, executable adversarial tests and reversible local repairs. Six defects were reproduced and repaired: inaccurate cancellation sums accepted by the verifier; nonzero numeric underflow; BOM/quoted-header separator mismatch; stranded working parents after a child dispute with no output; SDK preparation reads outside the RPC timeout policy; and RPC size checks buffering an entire oversized response before rejection.

Final checks: lint/types/build/client scan passed; **182 tests across 20 files** passed (27 added), including **83 integration tests**; **eight real production-browser scenarios** passed in 42.1 seconds. A separate source copy with fresh `npm ci` and no copied environment/backend files passed lint/types/all 182 tests/build/client scan. npm audit returned zero known vulnerabilities. Twenty maximum-row/column execution-plus-verification runs measured median 18.98 ms/p95 27.61 ms locally. The existing child receipt again verified read-only as `CONFIRMED`; no new transfer was submitted. Exact-value scanning of the locally available signing key found no source/public-asset match.

Each confirmed issue has passing regression coverage in the committed tests. The generated detailed audit reports are retained locally and intentionally omitted from Git. No schema/dependency migration or historical recomputation was performed. Existing keys, worksheets and financial records remain intact. Audit-started frontend/backend processes are stopped at handoff, matching their initial stopped state.

Audit gate: current prototype repairs complete; no production-readiness claim. Abrupt signer-process loss before hash persistence, demo identity/custody limitations, sustained load, other browsers and public hosting remain unverified. **Stop for explicit human approval before public hosting, recording/submission or service expansion.** No Git push or publication was performed for this audit.

## Signup usability follow-up — 2026-11-13 (historical; superseded by Auth 2 above)

Implemented the requested shared 8–128 character policy, signup-only password confirmation with focused mismatch errors, separately labelled keyboard-accessible Show/Hide controls, password-manager autocomplete, disabled password spellcheck/autocapitalization and a compact responsive form. Fields remain hidden by default and confirmation is never sent/stored as an account field. Added scoped white autofill styling and retained accurate no-recovery disclosure.

The first live eight-character signup failed because the user-started Node 26 Convex watcher had not replaced the older twelve-character backend. Restarted the existing local backend under Node 24 and deployed the new policy without changing keys or data; the targeted real eight-character signup/sign-out/login then passed. Added a startup check that passes on Node 24.22.3 and rejects host Node 26.13.0 with setup guidance. The frontend remains running and the updated backend is left running for manual testing.

Checks: lint, typecheck and all 155 tests in 17 files passed, including direct backend rejections of seven-character and over-128-character signup attempts without account creation. A separate checkout passed lint, types, all 155 tests, production build and client-boundary scan. Visually inspected empty signup screenshots; 390px mobile layout has no horizontal overflow. After the runtime correction, all seven live browser scenarios passed, including real eight-character signup/sign-out/login, seven-character rejection, confirmation mismatch/focus, keyboard Show/Hide, mobile layout and the existing complete economy/privacy workflows.

## Sign-in development error follow-up — 2026-11-13

The screenshot showed the stock Convex Auth `InvalidAccountId` rejection for an unregistered app account. The form caught the rejected promise, but Convex also forwarded it to `console.error`, opening the Next.js development overlay. Added a narrowly scoped client logger that sends only the three known credential-rejection codes from `auth:signIn` to a sanitized warning; all other errors retain normal error logging. Backend credential verification, attempt throttling, keys and account data remain unchanged.

Clarified that first-time users must sign up in this app and made failed-login guidance actionable without disclosing whether an account exists. Handle a non-completed sign-in response explicitly. Moved the Next.js development indicator to bottom-right because its default location intercepted the sidebar Sign out button.

Added seven logger regression cases that also verify unrelated/auth-configuration errors remain visible, plus a real browser scenario: unknown account → visible form rejection without console error/overlay → signup → sign out → wrong-password rejection → correct-password login. Final validation passed: lint, typecheck and all 153 tests in 16 files; all six live browser scenarios passed against the user-running development frontend/backend, including both credential failures with no auth console-error overlay and valid signup/sign-in. A separate checkout passed lint/types/all 153 tests/production build/client-boundary scan, avoiding a concurrent build against the running dev checkout. The user-started frontend/backend are preserved and local credentials are not rotated.

## Integrated prototype — 2026-11-13

Connected the real engine through bounded, versioned Convex scheduling: independent discovery/costed bids, buyer counters and seller decisions, utility-ranked awards, actual CSV processing, independent verification, one constrained revision, owner disputes and deterministic reputation. Optional meaningful normalization subcontracts feed their actual approved CSV into the parent and retain one-level/budget limits. No execution endpoint is public; payment signing stays separate and owner-confirmed. Worker failures roll back their stage and persist sanitized pause evidence; retries are owner-only and capped at three. Legacy active auctions remain intact.

Implemented the reference-inspired light responsive dashboard, icon navigation, green/orange metric cards, owner-data briefing/approval/activity, directory, consistent controls and readable mission/economy/security/receipt pages. Metrics describe actual loaded records. Downloads contain real outputs; unsafe CSV spreadsheet values are blocked. No decorative fabricated economy events or receipts.

Checkpoint checks: lint and typecheck passed; 144 tests in 15 files passed, including eight actual scheduled-driver scenarios and two combined engine/lifecycle/payment-allocation cases. Four production-browser scenarios passed, including automatic useful subcontracting and verified downloads. Additional human-review/error/mobile testing and live settlement validation are in progress; this checkpoint is not a claim of final acceptance. Dedicated testnet faucet/operator and five recipient accounts were configured outside Git. No real-money service or mainnet account is used.

### Live settlement and review-capacity follow-up

A custom mission completed actual cleaning subcontract → summary → independent verification, then the owner separately confirmed both payments in the production UI. Both public NEAR testnet transfers are final: parent `VXXUqkDSdzH8mQxUs59CazxsHWYXQBnMqCLwzuxvNsS` for 0.407070342 and child `2uz2eKHdVyEUYjxWpda4WAwY1qyHFyQs8Q8XDeqUdtMi` for 0.10316754. Independent RPC queries revalidated both exact receipts; their 0.510237882 sum equals the original award. `npm run test:near` passed against the real child receipt. Backend/UI evidence also rejects altered amounts, recipient substitution, duplicate payout, reputation manipulation and excessive subcontract depth, with no probe signing.

Tester follow-up found review backlog consuming execution slots. Contracts now enter `awaiting_review` without changing financial amounts or payment eligibility. Tests run six sequential review-pending missions without starving processing, and verify a bounded idempotent legacy repair. Applied that repair to two earlier local test contracts only. Earned reputation now has a two-mission regression demonstrating that actual first-job performance can change the second award while strategies remain fixed. Exhausted retries route to unawarded or human review instead of trapping committed work.

Latest checkpoint: 146 tests in 15 files passed; 77 integration tests (included) passed; five production-browser scenarios passed; lint, typecheck, production build, client-boundary scan and dependency audit passed. Final restart/clean-clone validation remains in progress below; public hosting, video and submission remain pending.
### Final validation and local handoff

- Working source at `1bb618e`: lint, typecheck, 146 tests across 15 files, 77 included backend integration tests, production build and client-boundary check passed. Dependency audit: zero known vulnerabilities. Five real production-browser scenarios passed, including keyboard launch/download, automatic useful subcontract, reload persistence, two-account result/graph isolation, mobile layout, human acceptance, invalid-input rejection and unawarded budget handling. No default browser test submits a payment.

- Clean checkout `/tmp/guildzero-final-clean-20261113`: fresh `npm ci`, lint, typecheck, all 146 tests, production build and client-boundary check passed without copied environment files, signing keys or backend state. Node 24.22.3 is now the declared supported runtime in both package manifests; Node 26 is not advertised as a working local Node-action runtime. Upstream dependency deprecation warnings are non-failing; audit reports no known vulnerabilities.

- Live restart test passed: stopped the actual local Convex process during a persisted auction, observed the reconnect banner, restarted the existing backend and observed approved independently verified output after reload with the same session. Both earlier confirmed payment records survived the restart without replacement intents.

- Captured and visually inspected current desktop/mobile dashboard screenshots outside Git. Mobile has no horizontal overflow; the visual browser run reported no uncaught page errors. Public HTML for a private mission contains no mission title. Exact-value scan across 120 tracked files and 27 public assets found none of the six locally configured signing keys; all environment worksheets, backend state and test artifacts remain ignored.

- Live receipt evidence is in settlement.md. Operator and five recipient keys are private mode-0600 local configuration, with existing Auth keys preserved. Total confirmed transfers: 0.510237882 testnet NEAR across exactly two job intents; their sum matches the original award, excluding network gas.

For manual use, select Node 24.22.3, run `npm run dev:backend` in one terminal and `npm run dev` in another, then open http://localhost:3000. Current local auth and testnet configuration already exist; do not rotate keys or overwrite working environment files. A new clone needs its own documented backend/auth/testnet setup because secrets and database state are intentionally not shipped. Validation preview processes are stopped at handoff.

Current-scope implementation stops here. No paused expansion branch is merged and no app is publicly deployed or submitted. Hosting/accounts, final public demo/video and explicit human submission approval remain release prerequisites.

## Audit corrections — 2026-11-13

PR #15 review follow-up: resolved the unconditional terminal-record removal and inconsistent mission/executor validation findings. One shared bounded parser now preserves explicit empties, rejects mixed record separators outside quotes, and enforces identical row/width/raw-header bounds through create/edit/launch/subcontract/execution/verification. Added both reported mixed-ending cases with no-shortened-output checks, quoted embedded-ending control, backend create/edit/legacy-launch/subcontract cases, and valid empty/500-row controls. Final validation: 134 tests in 13 files passed; 65 backend integration tests passed (included), all four real local-auth production-browser scenarios passed, plus lint, typecheck, production build, client boundary (25 assets) and diff checks. No credentials were rotated, no payment was sent and no public deployment occurred. Automatic economy workflow and funded settlement remain pending.

Fixed silent deletion of explicit all-empty CSV records, including one-column empty records and terminal LF/CRLF handling. Such records now count toward statistics and row limits; deleted-row deliverables fail independent verification. Replaced the unbounded selected-header explanation with a count/order summary; exact comparison and the 1,000-character persistence cap remain enforced. Added eight CSV regression cases and two real engine-to-Convex boundary tests at 11/32 maximum-length headers.

Validation: lint, typecheck, production build and client-boundary check (25 assets) passed. All 124 tests in 12 files passed; the separate 58-test backend integration run is included in that total. All four live browser scenarios passed against `npm start` and the existing local Convex backend using Node 24.22.3 and the documented Chromium executable override. These tests include actual service execution and verification persisted via internal workflow mutations; selection in those boundary tests is an explicit trusted fixture, not a scheduled autonomous auction. No funded transfer or public deployment is claimed. The user authorized a branch push and PR; no merge or hackathon submission is included.

## PR #14 combination and validation — 2026-11-13

The user authorized including PR #14 after its upstream merge. Fetched `origin/main` at `9c9af82`, which includes engine commits `3f5accd`, `caaba1c` and `e6d22f1`, and merged it into the previously combined local main at `4d25e25`. Resolved add/add conflicts in `lib/economy/index.ts` and `types.ts` by exposing the real engine functions while retaining persisted lifecycle types and Convex-compatible option arrays. Kept existing public `OPTIONS_REQUIRED`/`INVALID_COLUMNS` validation codes and exact UI messages; CSV execution explicitly retains the kernel's `INVALID_OPTIONS` error mode. Both paths now use one validator rather than duplicated validation rules. Initial combined checks exposed these mismatches; none was hidden by weakening existing tests.

Final actual checks: `npm run typecheck`, `npm run lint`, `npm test` (114 tests in 11 files), `npm run test:integration` (56 included tests), `npm run build`, `npm run check:client` (25 assets), `npm audit --omit=dev` (zero vulnerabilities), and all four production-browser scenarios passed. The existing local Convex backend deployed the combined functions using the checksum-verified Node 24.22.3 runtime; existing auth keys and data were preserved. Browser tests used the documented executable override for installed Chromium 1248 against `npm start`. No funded transaction or public deployment occurred.

PR #14 supplies pure functions, not the scheduled Convex worker. Opening an auction still waits for that worker; these browser tests verify the existing authenticated lifecycle/UI, not automatic bidding/service completion. Full economy workflow, earned-reputation ranking, funded NEAR settlement and release acceptance are not claimed. Stop at this tested integration handoff; no later implementation or public release is included.

## Local main combination — 2026-11-13

In a fresh checkout at `/Users/medhanshadhlakha/Downloads/GuildZero`, fast-forwarded `main` from `9ee2541` to `4d25e25`. Verified ancestry includes `feat/cluster-2-orchestration`, `feat/cluster-3-security-near`, `feat/cluster-4-experience-release`, `fix/negotiation-roles-pricing-privacy`, `fix/issue-1-economy-contracts` and `fix/payment-approval-binding`. They form one nine-commit sequence; no merge conflicts or application changes were necessary. PR #14 (`feat/economy-kernel`) and both of its commits (`3f5accd`, `caaba1c`) remain excluded. No push or PR mutation was performed.

Actual validation: fresh `npm ci` passed with zero reported vulnerabilities; lint, typecheck, production build and client-boundary check passed (25 assets). Vitest passed all 100 tests in 10 files; the separate integration run passed 56 included tests in six files. Tests used the installed Vitest entry point while the large dependency download finished. Initial lint/typecheck attempts during that incomplete install failed on missing Next.js files; both passed after installation completed.

Started a fresh anonymous local Convex backend and deployed the combined schema/functions. Node actions initially rejected host Node 26; installed the checksum-verified official Node 24.22.3 archive outside the repository and restarted Convex with that runtime. Generated fresh local auth keys without printing them. All four Playwright scenarios then passed against `npm start` and real local Convex Auth: auction persistence/cancellation; graph/security/sample reset; mission CRUD/session/two-user privacy; and saved options/exact budget. The default browser launch was unavailable because Playwright's matching binary was not installed; the passing run used the existing Chromium 1248 executable through the documented `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` option. No source workaround or auth bypass was introduced.

Environment and backend state remain ignored; no secrets were tracked. Non-failing output includes dependency deprecations, Node 26 test warnings and Next.js ignoring an unrelated ancestor lockfile. Engine execution/scheduled economy, real funded NEAR settlement and public hosting remain unvalidated and are not claimed by these passing checks. Stop at this integration handoff; the pending engine PR requires separate review before inclusion.

Latest follow-up branch: **`fix/negotiation-roles-pricing-privacy`**, based on the experience branch. The screenshot audit gaps are addressed in code; engine/live settlement/hosting acceptance remains pending.

## GitHub issue follow-up — 2026-11-12

Additional branch `fix/payment-approval-binding` binds immutable payment intents to exact deliverable/verification/owner-dispute identities and policy version, rechecked before authorization and signer claim. Changed/unbound approvals cannot reach signing/network calls; denial audits persist and stale authorization is cleared. Historical submitted/uncertain payments retain reconciliation without re-signing. Unit/backend coverage now totals **100 passing tests**, including legitimate human approval, replacement output/verification/dispute, and legacy unbound intent cases. Lint/typecheck/build/client-boundary checks passed; **56 backend integration tests** passed (included in the 100). No real transfer was performed.

All **4 production-browser scenarios passed** with the updated backend. A rerun initially failed at signup because the local backend process was no longer running and the temporary Node 24 runtime was absent. Restored the checksum-verified official Node 24.22.3 runtime, restarted the existing backend without replacing keys, deployed the updated functions/schema, and reran successfully. The local runtime interruption is not an application or PR regression. An unrelated local `.env.example` edit is preserved and excluded from these commits.

The teammate's engine is now available as **PR #14**, head `3f5accd`. An isolated clean install, lint/types/build and the PR's **37 existing tests passed**. Additional temporary review tests exposed **15 failing regression cases**: CSV quoting/parser safety, shared executor/verifier defects, formulas, capability eligibility, seller cost floor, acceptance price, timestamp-based ranking, overbudget ranking, runtime input handling, missing complexity/risk adjustments, header preservation and statistic tolerance. A line-level **Changes requested** review was posted. These are PR-review results, not failures in the 100-test application feature branch. No PR merge or engine acceptance is claimed; #2/#3 remain necessary.

Issue audit is recorded on all 13 tickets: **#1 closed with commit/test evidence; #2–#13 remain open with specific remaining acceptance work**. No remaining ticket is obsolete or a demonstrated duplicate. A final draft-edit fix prunes selected columns removed by replacement CSV, so hidden stale selections cannot trap the user in validation errors; its production-browser regression covers replacing the header and saving new options. Lint/types/build/client-boundary checks and all 4 production-browser scenarios passed again after this UI correction.

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

## Dataset stewardship follow-up (#35) — 2026-11-13

Added an explicit demo retention policy and owner-confirmed terminal mission content removal. Parent/child source, result and free-text copies are cleared together; ownership, active-work and exact finalized-settlement checks fail closed. Financial rows remain unchanged and removed records cannot be reused or quoted for new payment. Representative-user/jurisdiction validation, account erasure and operator backup deletion/expiry remain separate requirements; no legal compliance or automatic expiry is claimed. Validation results are recorded in the issue plan/PR.


## Functional application workspace and wallet — 2026-11-13

Owner-directed follow-up (#26–#29): rebuilt the authenticated shell with labeled responsive routes; added dedicated mission, agent-directory and payment-history pages, compact recent main-job metrics, real approval/payment queues, scoped workflow progress, separate child outcomes, and expandable original audit events. Owner-private receipt links resolve even when their jobs are outside the recent overview window. Payment-history filters, mission search/reuse, output downloads, graph controls and security probes remain wired to actual state. Mobile navigation exposes all six destinations.

Numeric execution failures now identify the column/CSV record without copying raw cell values into diagnostics. New disputes retain the bounded explanation; existing input/history is preserved. No-output disputes explain correction/reuse and disable approval; backend approval denial remains enforced and tested.

The shared operator panel refreshes finalized testnet account/storage/protocol evidence through an authenticated, throttled scheduled Node action. It shows account ID, balance, storage/gas-adjusted estimate, checked time and final block, and preserves the last successful reading on failure. Concurrent refresh and stale callbacks are tested. Live browser refresh read 8.9540978972875 total and 8.9422778972875 available NEAR for the configured public testnet operator; these are timestamped observations, not permanently fixed amounts or a personal deposit. No signing credential was copied to the isolated backend and no payment was sent.

Live validation reproduced Node 24 fetch timeouts while native HTTPS worked. The shared RPC transport now uses bounded native HTTPS: one request, 15-second total deadline, 256 KiB maximum response, no redirects or retries. Future preparation failures store only allowlisted stage codes; older generic failures remain honest about missing historical details. Existing failed/uncertain intents are not reset. No new transfer was used to validate the revised transport; read-only account checks and offline SDK/uncertainty tests are distinguished from actual payment evidence.

Validation: **214 tests in 25 files**, including **99 integration tests**, pass; lint, typecheck, production build, client-boundary scan (27 assets) and full npm audit pass (zero known vulnerabilities). The **12-scenario production browser suite passed in 2.0 minutes** against the isolated backend. A separate live browser smoke check refreshed the real account balance, processed a synthetic mission and inspected desktop/mobile screenshots with no page errors or horizontal mobile overflow. Earlier checks found duplicate empty states and an ambiguous payment-filter label; both were corrected before the passing run.

Preserved root environment files, user-started local services, existing financial records and unrelated local reports. The changes are integrated into local main. A final smoke check on the user’s existing port 3000/backend 3210 passed account creation, the new dashboard, live wallet evidence, payment filtering and sign-out with no page errors; it created no mission or payment. The existing child receipt was independently rechecked as FINAL_MATCHING_TRANSFER using the revised transport. The final mobile-navigation adjustment passed an additional focused production browser run (1.6 seconds). Push verification is reported separately. Public hosting/submission, process-crash settlement proof (#9/#10), release gates (#12/#13), unsaved-edit protection (#23), account recovery (#24) and actual representative-user sessions (#25) remain unclaimed. Broader service expansion stays paused.
