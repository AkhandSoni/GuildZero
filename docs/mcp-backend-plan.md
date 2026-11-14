# MCP backend implementation plan — issue #50

Status: proposed implementation plan, 15 November 2026. No backend change is implied by this document. The owner requested `feat/MCP`; the issue's earlier branch name is superseded for this local work. Base: `be04088784f1aed8cb04ff4f2f16720ae66e94f7`. Source: [GuildZero #50](https://github.com/AkhandSoni/GuildZero/issues/50).

## Boundary and inspected seams

Keep Next.js/Convex/Convex Auth and the existing scheduled deterministic marketplace. A local stdio executable is an additional client. The backend integration gateway is an HTTP action inside Convex, not a second MCP transport. No new model provider, signer, worker engine, wallet, payment authorization, dispute action, recovery write, deployment or live payout belongs to this implementation.

Actual inspected entry points:

- `convex/http.ts` exports an empty router; there is no integration endpoint to reuse.
- `convex/ownership.ts:user/ownedJob` and `convex/missions.ts:requireUser/ownedMission` resolve real Convex Auth owners. Keep public session checks intact.
- `convex/missions.ts:create/list` already validate/store drafts and use indexed owner/search/service/state pagination.
- `convex/jobs.ts:start` owns preflight, root lookup, immutable brief snapshot, readiness/preview distinction, event and scheduler commit. `jobs.detail` includes sensitive source CSV/options, child job rows, raw verification/dispute rows and worker metadata; do not forward this object to MCP.
- `convex/payments.ts:prepare` owns one-intent-per-job creation, quote policy and optional v2 attempt creation. `authorize` alone confirms exact human intent and schedules settlement. It remains human-only.
- `convex/publicMarket.ts` provides explicit public bid/negotiation/contract/event projections. `convex/deliveryAccess.ts` validates final payment evidence, current deliverables and parent/child conservation; reuse it unchanged.
- `convex/marketViews.ts:agent` bounds owner history to 100 jobs. Metadata is from `lib/agent-directory.ts`; advertise bounded owner-visible history, never global all-time reputation.
- `lib/missions.ts:validateMission`, `lib/economy/contracts.ts`, CSV/business/preflight validators and `lib/money.ts` are authoritative. Do not fork service or money rules.

## New storage

Add tables without migrating existing financial/auth rows:

| Table | Fields and indexes | Invariant |
| --- | --- | --- |
| `mcpIntegrations` | `ownerId`, immutable random `clientId`, label, secret digest, approved scope literals, optional mission IDs, created/expiry/revocation timestamps; indexes `by_digest`, `by_owner`, `by_owner_client` | Only digest is persisted. Owner and scopes come from the authenticated issuer. TTL defaults to 1 hour, never exceeds 24 hours. |
| `mcpRequests` | owner/integration/request ID, canonical payload fingerprint, created mission ID, created time; indexed integration/request | Mapping and mission creation commit atomically; exact replay returns existing mission; changed payload rejects. Retain mappings with integration history so response loss cannot create duplicate work. |
| `mcpAudit` | owner/integration/tool, resource ID when authorized, timestamp, allow/deny, fixed reason code; owner/integration/time indexes | No bearer secret/digest, CSV, notes, request body, pricing internals or stack traces. |
| rate state | existing rate-limiter component with integration/user buckets, or bounded indexed transactional counters | Count calls even when denied. Define practical per-minute and burst bounds in constants and test them. Unknown-token traffic uses a bounded shared gateway bucket, never creates one row per supplied secret. |

Use a fixed versioned scope union: `catalog:read`, `missions:read`, `missions:create`, `auctions:start`, `activity:read`, `verification:read`, `results:read`, `payments:read`, `payments:prepare`, `payments:request-approval`. No wildcard or caller-supplied extra scopes. Limit human-created credentials (proposed 20 active per owner), label length (80), explicit mission restrictions (50), and list pages (50). Restricted credentials cannot create arbitrary missions: either deny creation when mission-restricted, or specify a separately reviewed rule before implementation; do not silently add newly created IDs to their scope.

## Human credential management

Add `convex/mcpCredentials.ts` and a small authenticated integrations page/component. Follow current Next.js bundled docs before editing UI.

1. An authenticated human selects a name, explicit scopes, expiry and optional owned missions. Display external-client data disclosure and forbidden financial operations before creation.
2. A trusted action generates 32 cryptographically random bytes. Hash a versioned credential using SHA-256. A dedicated internal mutation authenticates/validates the current human session, derives owner, verifies all restrictions and stores only digest/metadata. Verify actual Convex action/auth propagation and Web Crypto runtime support before selecting APIs; do not accept an owner ID as a public substitute.
3. Return the secret exactly once to the same authenticated UI action result. Keep it only in component memory, clear when navigating/unmounting, and never place it in URL/localStorage/logs. The owner saves a mode-0600 file outside Git. Lists return metadata only.
4. Owner-only list, revoke and revoke-all mutations authenticate normally. Revocation changes rows or a generation checked on every operation. Revoke-all must cover every active credential despite list pagination.
5. Freeze lifecycle semantics explicitly before coding: these are independent short-lived integration grants; ordinary UI logout/session expiry does not automatically revoke them. The UI must say so and provide revoke-all. Explicit integration disable/revoke-all and deleted owner rows deny subsequent operations. If a future human-session revocation workflow promises integration revocation, wire it atomically rather than relying on a browser logout callback. There is no existing owner-disabled field in the user schema; any new account disable mechanism must be checked in the transactional principal resolver.

Do not invoke privileged auth component sign-in methods, return general access/refresh tokens to MCP, use email as ownership proof, or allow MCP credential issuance/password entry. A bearer credential is accessible to the OS host that launches the child; this is not local-machine isolation.

## Gateway and atomic authorization

Add only `POST /integrations/mcp-tools` to `convex/http.ts`, backed by `convex/mcpGateway.ts`. Reject browser preflights/CORS access unless explicitly justified; this is a server-to-server route. The body is a versioned fixed tool-name union plus strict tool arguments. No generic Convex function names/URLs/owners/scopes are accepted.

Suggested execution boundary:

1. HTTP action validates method, content type, exact bearer format, bounded bytes and JSON object. Hash token without logging header/body. Use identical sanitized errors for missing/unknown/expired/revoked credentials.
2. Call an internal transaction dispatcher with digest and validated fixed tool request. Each invocation reloads credential and existing enabled owner, checks expiry/revocation/scopes and resource restrictions, consumes integration/user rate capacity, invokes an allowlisted domain helper, and records safe audit in the same mutation transaction. Using mutations for read tools permits transactional authorization/rate/audit; domain rows remain read-only for those tools.
3. Return application success/error data rather than throwing expected policy denials after audit writes: throwing would roll back rate/audit rows. Unexpected errors abort and map to a generic backend-unavailable response at the HTTP boundary.
4. No separate precheck grants reusable authority. Revocation racing with a request is serialized against the actual operation. Revocation does not undo already committed auctions or independently approved payments.
5. Bound the envelope independently of CSV (proposed 512 KiB input, 512 KiB output). Two 64 KiB CSVs can expand through JSON escapes; reject by actual UTF-8 byte size. Timeouts/cancellation cannot imply cancellation of a committed transaction.

Internal input validators should be Convex validators plus shared strict runtime schemas where semantic checks are needed. Normalize IDs through the backend and return the same not-found result for foreign and nonexistent resources. Fixed UI origin comes from trusted backend configuration validated as HTTPS remotely or loopback HTTP locally; links are constructed from authorized mission IDs. Never use client Origin/Host or a tool URL for approval links.

## Minimal shared-helper refactor

Keep existing public wrapper signatures and authorization unchanged; extract domain logic only:

- `convex/missionHelpers.ts`: owned mission read/list and draft creation for explicit trusted owner. Public wrappers call existing session resolver first. Integration wrapper calls transactional principal resolver first.
- `convex/jobHelpers.ts`: root start after owner/mission verification. Preserve existing validation, root idempotency, readiness, scheduler and events exactly. Public start may pass its existing human preview flag; integration start always passes `false`. Existing root lookup precedes readiness so an already human-started preview job remains observable. Map readiness denial to `HUMAN_PREVIEW_ACKNOWLEDGMENT_REQUIRED` with mission link.
- `convex/paymentPreparation.ts`: exact existing prepare body with a previously owned job. Public prepare uses `ownedJob`; integration uses its own verified principal/job. Never extract or call `payments.authorize` from integration code.
- `convex/mcpProjections.ts`: narrow mission/job/activity/verification/result/payment response builders. Share existing public projection functions and delivery policy, not raw database rows. Add unit fixtures checking every withheld field.

Helpers are ordinary module functions, not public or arbitrary internal dispatch functions. Explicit owner parameters are trusted only after wrappers authenticate them. Do not fake `ctx.auth` or use public API functions through an impersonated session.

## Tool-to-scope contract

| Tool | Required scope | Backend behavior |
| --- | --- | --- |
| `guildzero_list_services` | catalog:read | Five real services/options/limits/output formats; current monetary authority caps. |
| `guildzero_list_agents` | catalog:read | Seven static profiles, capacity caveat; scoped bounded owner history only where enabled by contract. |
| `guildzero_create_mission` | missions:create | Strict required options/booleans; validate both reconciliation CSVs and business constraints; atomic request mapping. |
| `guildzero_get_mission` | missions:read | Owned brief metadata and bounded references; source CSV/comparison input omitted by default. |
| `guildzero_list_missions` | missions:read | Owner/filter-bound pagination 1–50; opaque cursor cannot cross principal/restrictions. |
| `guildzero_start_auction` | auctions:start | Shared start helper, no preview acknowledgement override; immediate root job ID/state. |
| `guildzero_get_auction` | missions:read | Public bids/rounds/contracts/scores/children IDs and native job state. |
| `guildzero_get_activity` | activity:read | Ordered public events, 1–100, explicit truncation. |
| `guildzero_get_verification` | verification:read | Verdict/check codes/pass flags and review state; omit computed values, raw detail and disputes that disclose locked outputs. |
| `guildzero_get_result` | results:read | `deliveryAccess` gates latest full content; otherwise allowed preview/reason/required and confirmed counts only. |
| `guildzero_get_payment_status` | payments:read | Exact intent/current-attempt projection, configured recipient/amount/network, validated confirmation metadata; no claim tokens/worker snapshots. |
| `guildzero_prepare_payment` | payments:prepare | Shared quote/one-intent helper; no recipient/amount arguments; return safe existing state on repeat. |
| `guildzero_request_payment_authorization` | payments:request-approval | Read existing intent and return current binding plus fixed-origin mission link; no authorize/signer/scheduler writes. |

Read tools must respect mission restrictions too, including agent-history aggregates and list pagination. Under restricted grants, catalog metadata can remain static while histories are limited to permitted jobs. Do not scan all owner data and then paginate a filtered subset incorrectly; choose bounded indexed queries per allowed mission, and bind cursors to the credential/filter or return explicit bounded restricted pages without opaque arbitrary reuse.

## Response and data safeguards

Use the adapter's frozen versioned output schemas: preserve native mission/job/payment states alongside normalized lifecycle status and checked timestamp. Private responses are not cacheable. Payment confirmed status requires existing finality evidence; a stored transaction hash alone is not confirmation. Uncertain states return original identity and human-reconciliation guidance without new attempt/retry authority.

Audit input free text remains untrusted data. Project strings and schema descriptions are static. Verification detail can contain exact computed values and event detail can contain owner text: explicitly project fields rather than applying superficial redaction. Locked results must not leak through verification, payment, activity, mission/child projections, resources or errors. Size limits and sanitized codes apply at the backend as well as the local adapter.

## Validation packages

1. **Credential policy**: real-human-session issuance, 256-bit generation/digest-only storage, TTL/scope/mission bounds, metadata-only list, owner-only revoke/revoke-all, identical invalid errors, deleted/disabled owner, rate limits, revocation between concurrent operations. Existing human authorize/dispute/token-management calls reject integration bearer credentials.
2. **Authorization/isolation**: two users and distinct grants, guessed IDs, every tool scope, restricted missions, cursor principal/filter binding, owner metadata leakage, reconnect/concurrent clients; body fields cannot override principal or scopes.
3. **Domain preservation**: run current mission/job/payment suites after helper extraction; durable create replay and fingerprint conflict; concurrent root starts/prepares; no unsolicited options/preview acknowledgements; business-input and numeric/money limits remain real validators.
4. **Financial no-send**: spy actual scheduler/signer/RPC boundaries; prepare/request-approval writes no `authorizedAt`, lock, reputation, contract or verification changes and schedules zero signer actions, including duplicate/racing/malicious calls. Existing uncertain/failed/v2 intent state remains untouched.
5. **Privacy/release**: real CSV outputs stay absent before all exact parent/child payments; raw bids/floors/worker state, source CSV and computed verification values absent from unrelated tools. Policy tests may seed final evidence, clearly labeled offline fixtures; do not claim chain confirmation from fixtures.
6. **Gateway/SDK**: fixed tool allowlist, malformed JSON/header, request/response byte limits, no redirect/origin selection, logs redacted; actual SDK child reaches actual local backend and exercises persisted creation/start/read/preparation/approval request without sends. Protocol tests and mocked gateway tests are separate from this acceptance test.
7. **Regression**: project Node 24, `npm test`, integration, lint, typecheck, build, client-boundary and relevant production-browser tests. Record actual output/counts and unavailable gates, never inherit old green counts as new evidence.

## Local prerequisites and honest E2E gate

The isolated checkout initially has no configured environment or local backend. `npm ci` installs the existing pinned lockfile; `npm run dev` selects the pinned Node 24 via `scripts/node-runtime.mjs`, bootstraps local Convex and writes ignored `.env.local`. Choose local/no-account setup. It never requires NEAR keys or a paid model. Do not copy another checkout's `.convex`, admin keys, env files, user database or operator secrets.

For an actual no-send economy run, settlement readiness still matters: MCP cannot set `allowUnfundedPreview`. Either configure safe backend readiness without a usable signer (and prove zero signer calls), or have an independently authenticated human explicitly start metadata-only work in the existing UI; MCP can then observe/reuse the root. Payment preparation may return an honest configuration/ineligible denial when no operator/recipient configuration exists. The E2E must document what ran and what remains blocked; do not fake eligibility or full paid delivery.

Do not enable `NEAR_PAYMENT_RETRY_ENABLED`, deploy remote functions, authorize a transfer or install funded operator credentials. A paid delivery demo requires a separately approved new budget; historical issue budget is not reusable authorization.

## Parallel ownership proposal

- Backend owner: integration tables/credential lifecycle/gateway, trusted domain helper refactor, projections and backend security tests; this document.
- Adapter owner: frozen 13 tool schemas/scope/result contract, official SDK stdio executable, secure file/env configuration, bounded backend client, protocol tests and client setup docs.
- Lead integration: package/runtime lock changes, human integration-management UI, top-level decisions/status/runbook, real local backend + official-client E2E and regression evidence. Freeze schema names/errors and backend envelope before parallel implementation.

No agent should concurrently edit the same schema, generated API, root manifest/lockfile or UI files. Codegen follows schema/functions changes, then lead reconciles the official generated result. Optional prompts/resources and Streamable HTTP stay deferred until the 13 required tools and security gates pass. PR remains unmerged without separate owner approval.
