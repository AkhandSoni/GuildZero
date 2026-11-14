# MCP implementation validation — 15 November 2026

Scope: [GuildZero issue #50](https://github.com/AkhandSoni/GuildZero/issues/50). Local branch `feat/MCP`, from the issue's exact common base `be04088784f1aed8cb04ff4f2f16720ae66e94f7`. The current user's branch choice supersedes the issue's older branch name. Main/sibling branches were not changed.

This is a command/result summary from observed runs, not a fabricated raw transcript. Supported runtime: Node 24.22.3. Initial npm installation used11.19.x; the frozen lockfile was subsequently reinstalled successfully using the project's pinned npm 12.2.2 via npx, without changing global Node/npm. SDK server/client are pinned 2.4.0, Zod 4.6.7. No skill was installed globally.

| Check | Actual result |
| --- | --- |
| Pinned npm 12.2.2 `npm ci` | Passed; lockfile unchanged; optional fsevents install script blocked by existing allowScripts policy |
| `npm test` | 418 tests,44 files passed on final source |
| `npm run test:integration` | 229 tests,24 files passed |
| New MCP contract/adapter/protocol tests | 32 tests,3 files, included in full suite |
| New MCP backend tests | 18 tests,1 file, included in full/integration suites |
| `npm run lint` | Passed |
| `npm run typecheck` | Passed |
| `npm run build:mcp` | Passed |
| `npm run build` | Passed; `/integrations` built with existing routes |
| `npm run check:client` | Passed;30 production assets scanned for private pricing/server-secret identifiers |
| `npm audit --json` and frozen reinstall audit | Zero reported vulnerabilities at check time |
| Full production browser suite | 20 tests passed in 3.1 minutes, including opt-in actual MCP scenario |
| Final `npm run test:mcp:live` after final UI/reinstall | Passed against production Next.js plus actual local Convex,11.5 seconds overall |
| Mobile connections review | 390 px screenshot visually inspected; no horizontal overflow |
| `git diff --check` | Passed |

The existing browser cache held Chromium 1248 while the newly installed Playwright requested 1254. The passing runs explicitly used `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` for the available compatible Chromium 1248. Playwright trace/video were disabled. Screenshots were taken only after connection credentials were hidden/revoked. Earlier failing local attempts exposed a cold-start wait, a low synthetic budget admitting only one bidder, and a stale backend/shared-schema bundle; corrected setup waits, a1 NEAR planning budget and redeployment preceded the passing runs. The frozen reinstall temporarily removed watched dependencies; an explicit final `convex dev --once` successfully redeployed the restored tree. No check failure was dismissed as passing.

## What ran against the actual local backend

A fresh anonymous Convex deployment was generated in the isolated worktree, with no copied prior configuration or keys. Next.js ran on 3150; local Convex client/site origins were 3210/3211. Two actual users signed up through the existing Auth2 browser flow. Each created a separate named scoped integration credential through the new human UI. Temporary mode 0600 token files were removed and credentials revoked.

The official `@modelcontextprotocol/client@2.4.0` spawned the compiled local stdio process, listed exactly 13 tools and invoked all 13 against actual local Convex. It created a synthetic private summary mission, replayed the same creation identity, rejected changed payload reuse, and received the human-preview acknowledgment requirement from funded start. The human UI separately acknowledged metadata-only processing. Genuine scheduled independent offers, three-round negotiation, a real cleaning subcontract, data execution and verification persisted. The client read actual activity/verdicts and locked deliverable metadata; the prepared exact payment remained READY with no hash. Approval-request only returned the trusted UI link, and the human payment button remained disabled.

A second actual signed-in user/issued credential was denied the first user's mission/job/activity/verification/result/payment records and saw an empty owner-scoped mission list. A fresh stdio child reconnected to stored state; revocation denied its subsequent request. The mobile connections screen fit 390 px.

[Sanitized persisted no-send observations](evidence/mcp-no-send-2026-11-15.json) record actual local state at the stated capture time: no signing credential, settlement disabled, zero authorized intents/transaction hashes/signer locks. Sender/recipient account strings were explicitly synthetic configuration labels; no on-chain account existence, balance or transfer is claimed. The1 NEAR mission planning budget is not permission to spend; no payout occurred.

## Automated security evidence and limits

Backend tests use Convex's isolated test runtime with real Auth2 test sessions. They exercise digest-only issuance/TTL/revocation/revoke-all, disabled/deleted owners, per-owner/integration/global admission rates, scope/mission/cursor isolation, strict inputs, durable same-ID/conflict handling, concurrent creation/preparation, retained uncertain identities and post-write rollback on output-validation failure. Actual economy helpers run. A malicious CSV-cell/acceptance-note regression completes the genuine numeric calculation while preserving zero signing and locked output. Signer/key/account/RPC sentinels assert zero calls in every MCP backend test; intent authorization/hash/lock state is independently checked.

Locked result projections reuse `deliveryAccess`, safe verification omits computed detail and safe events omit arbitrary free text/private pricing. Parent/child partial/duplicate-hash/distinct-final-evidence release tests use **explicitly labeled offline receipt fixtures**; they are not public-chain receipts or proof of funded delivery. Existing settlement/recovery suites continue to pass. MCP exposes no authorize/dispute/retry/reconcile-write/signer/admin/credential-issuance tools. Approval requests additionally require exact current unapproved READY bindings and fail closed for failed/uncertain/settled/substituted states.

Protocol tests use the matching official SDK: modern in-process negotiation and actual spawned stdio in both auto/modern and legacy modes, strict input/output discovery, sanitized failures, malformed frames, startup failure, EOF, cancellation/timeout and bounded transport responses. The in-process HTTP handler is a test harness only; no HTTP MCP endpoint is deployed.

These tests establish local interoperability and specific regression behavior. They do not certify every desktop assistant host, a hostile local OS, cloud operation, broad penetration resistance, every abrupt crash timing or successful paid delivery. No independently authenticated human approved a payout in this work. A fresh separately approved spending amount, genuine final receipts, actual selected-host verification and independent contributor/security review remain distinct rollout gates. Optional resources/prompts, HTTP MCP/OAuth and inference-provider adapters are deferred. Keep any PR unmerged until separate explicit owner approval.

Reproduce using [the setup guide](mcp-setup.md). Local services used for validation are stopped after handoff; the ignored configuration remains for the user's next run. No public hosting, wallet creation, paid API call or mainnet action was performed.
