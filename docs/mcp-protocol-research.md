# MCP protocol and adapter research for issue #50

Research date: 15 November 2026, Asia/Kolkata. Scope: [GuildZero #50](https://github.com/AkhandSoni/GuildZero/issues/50), based on `be04088784f1aed8cb04ff4f2f16720ae66e94f7`. This document records the research-stage protocol facts and contract proposal. Subsequent implementation and actual checks are recorded in [MCP validation](mcp-validation.md).

The user explicitly selected local branch `feat/MCP`. The issue records `feat/master-agent-mcp`; preserve the user's newer local branch choice and resolve any remote/PR destination deliberately before publishing. Main and the Groq/Qwen experiments remain outside this work.

## Architecture and scope

Keep the existing Next.js human interface, Convex Auth, Convex database/scheduler, deterministic economy, verification and settlement. Add one local client-launched Node executable and a narrowly scoped integration gateway in the existing Convex backend. MCP is a tool protocol, not another model provider or replacement backend. The source-of-truth acceptance contract is the issue's exact 13 tools and payment/privacy boundaries.

```text
External MCP host
  -> local stdio executable (one immutable scoped credential)
  -> POST <configured Convex site origin>/integrations/mcp-tools
  -> transactionally validated integration principal/scopes/ownership
  -> existing domain helpers and persisted scheduler

Human -> existing authenticated Next.js UI -> exact payment approval
                                          -> existing signer/finality pipeline
```

The gateway's HTTP route is backend communication, not a deployed HTTP MCP transport. Implement stdio only. No OAuth service, public tunnel, arbitrary dispatcher, wallet creation, paid model, mainnet, payout, or sibling-provider dependency is necessary. Optional resources/prompts wait until all tools work.

Local `AGENTS.md`, README, decisions, deviations, cluster status, worker integration, expansion, settlement and payment-recovery documents were inspected. They establish ownership/authentication, existing deterministic processing, hidden seller-policy projections, human approval, receipt-gated delivery and disabled recovery activation. Ancestor Counterparty Guard instructions describe a different repository and do not define GuildZero's interfaces.

## Release and runtime verification

The [official v2 SDK documentation](https://ts.sdk.modelcontextprotocol.io/v2/) identifies v2 as stable and implementing protocol revision 2026-07-28. Use split packages, not obsolete `@modelcontextprotocol/sdk/server/*.js` examples.

Actual registry checks during this research:

| Item | Observed result | Implementation consequence |
| --- | --- | --- |
| `npm view @modelcontextprotocol/server version engines peerDependencies --json` | `2.4.0`, Node `>=20` | Pin server `2.4.0` unless a deliberately rechecked stable update is chosen |
| Matching client query | `2.4.0`, Node `>=20` | Pin client `2.4.0` for protocol tests |
| `npm view @modelcontextprotocol/server@2.4.0 dependencies --json` | `zod: ^4.2.0`, core `2.4.0` | Use one compatible Zod v4 resolution |
| `npm view zod version --json` | `4.6.7` | Candidate exact runtime schema pin `4.6.7` |
| `.nvmrc` | `24.22.3` | Use the project's Node 24 runtime selection |
| Research shell `node --version` / `npm --version` | `v26.7.0` / `11.19.0` | Not evidence of supported-runtime application validation |
| `package.json` | ESM, npm `12.2.2`, TypeScript `6.0.3` | Preserve existing choices; do not replace the lockfile/package manager |

No package was installed or dependency changed by these checks. Node 24 compatibility comes from package metadata and repository requirements; compilation and actual runtime checks remain acceptance work. Follow the existing launcher's runtime selection rather than changing global Node or shell settings. Convex Node actions require project Node 24 despite a broader root engine range.

The [official first-server guide](https://ts.sdk.modelcontextprotocol.io/v2/get-started/first-server.html) shows `McpServer`/`registerTool` from `@modelcontextprotocol/server` and `serveStdio` from `@modelcontextprotocol/server/stdio`. Its prose describes ESM-only distribution; registry `exports` for 2.4.0 currently includes import and require entries. Retain this ESM repository and validate the actual pinned package, rather than extrapolating from prose. No migration is required because this base has no MCP package.

## Protocol behavior that affects implementation

The [stdio documentation](https://ts.sdk.modelcontextprotocol.io/v2/serving/stdio.html) establishes stdout as the protocol channel and stderr for diagnostics. `serveStdio(factory)` creates the connection's server and owns transport lifecycle. It returns a close handle; release application-owned handles on termination. Launch the built executable directly, avoiding package-manager startup notices. SIGINT/SIGTERM, stdin EOF and response draining require tests. Cancellation abandons an exchange; it cannot undo a committed Convex mutation.

The [legacy-client guide](https://ts.sdk.modelcontextprotocol.io/v2/serving/legacy-clients.html) documents compatible 2025-era stdio clients as supported by default. Let the pinned SDK own negotiation, current request metadata and legacy initialization. Record exactly which client/version was exercised; do not advertise untested universal compatibility or hand-code an obsolete handshake.

The [tools API](https://ts.sdk.modelcontextprotocol.io/v2/servers/tools.html) derives advertised JSON Schema and validates inputs from runtime schemas. Use strict objects to reject unknown properties. `outputSchema` plus `structuredContent` provides validated machine results; also serialize the same result in a text block for clients. Annotations are truthful hints, never authorization. Set `maxToolInputElements` explicitly because it defaults off; also enforce byte bounds independently of object-element bounds.

The [errors API](https://ts.sdk.modelcontextprotocol.io/v2/servers/errors.html) converts thrown tool-handler exceptions into model-visible `isError: true` content, including their messages. Catch and sanitize gateway, parser and network failures explicitly; do not let raw SDK/Convex exceptions leak. Output validation is skipped for error results, so validate error envelopes ourselves. A legitimate locked/review-needed domain result is a successful invocation, not an infrastructure error. Resources have a different protocol-error channel if implemented later.

The [authorization specification](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization) applies OAuth requirements to HTTP MCP and recommends local credential configuration for stdio. Issue #50's scoped token file is the selected project flow. Every backend operation must revalidate the active credential row and derive owner/scopes in its transaction. MCP client metadata and adapter-held credentials do not grant human session/payment authority.

The [official security guidance](https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/security_best_practices) motivates fixed audiences/origins, no arbitrary proxying, no token passthrough and protection against credential disclosure/SSRF. Reject redirects; allow remote HTTPS or explicit loopback development HTTP only. A local OS owner or compromised host can read its child credential; scoped tokens limit authority but cannot isolate secrets from that host.

## Proposed adapter/backend contract for freeze

The following is a proposal for both implementation streams to agree before source work, not an existing API.

**Gateway request:** strict `{tool: <exact 13-name union>, arguments: <tool-specific strict object>}`. The bearer value appears only in the Authorization header. No caller owner/scopes/backend URL/function name appears in arguments. The configured origin is immutable for one process. Every tool reaches the same gateway; the backend independently validates the discriminated tool input.

**Application success:** `{version: 1, ok: true, code: "OK", checkedAt: <backend epoch milliseconds>, data: <tool-specific allowlisted object>}`. Tool-specific data retains native mission/job/payment states. Where relevant, include a separate normalized `workflowState`, resource IDs and bounded page/truncation metadata. Do not collapse approved work and pending child payment into one misleading status.

**Application failure:** `{version: 1, ok: false, code: <stable finite code>, checkedAt: <backend epoch milliseconds>, message: <static bounded guidance>}`. Adapter-origin timeout/unavailable errors use local checked time explicitly and must not fabricate a backend timestamp. Authenticate first; nonexistent and other-owner IDs share `NOT_FOUND`. Missing/invalid/expired/revoked tokens share `UNAUTHENTICATED`. Other candidate codes: `SCOPE_DENIED`, `INVALID_INPUT`, `UNSUPPORTED_SERVICE`, `NOT_READY`, `RATE_LIMITED`, `BACKEND_UNAVAILABLE`, `REQUEST_ID_CONFLICT`, and `HUMAN_PREVIEW_ACKNOWLEDGMENT_REQUIRED`. Locked delivery remains success with `{locked:true, reason,...safe metadata}`. Human approval requests remain success with `approvalRequired:true` and an allowlisted fixed-origin UI link.

Use a per-tool output schema rather than `z.unknown()` for successful data. Return `{content:[{type:"text",text:JSON.stringify(result)}], structuredContent:result}`; set `isError:true` only for failure envelopes. Adapter checks HTTP status, content type, response byte bound, JSON, exact version and tool-result schema; it must not trust arbitrary upstream error bodies. Preserve human-readable native reason codes where already safe and bounded rather than exposing private rows.

**Proposed finite limits:** 1 MiB gateway request and response bytes; 30-second backend deadline; 10,000 argument elements. These comfortably allow JSON escaping of two 64 KiB CSV inputs and a 128 KiB released result while keeping each dataset's existing UTF-8/row/column limits authoritative. Measure actual encoded requests/results in tests, including escape-heavy data. Use bounded streaming reads, not an unchecked `response.json()` on arbitrary bytes. Forward SDK `ctx.mcpReq.signal` to fetch and combine it with the deadline. Never automatically retry writes.

**Tool registry:** share fixed names, scopes, schemas and static descriptions in a browser-safe contract module, with no SDK/secret imports reachable from Next.js client code. Keep protocol registration and gateway networking in the local executable; backend authority remains in dedicated Convex internal wrappers/shared trusted helpers. Convex validators still run independently; an adapter-only Zod check is insufficient. Use existing money, CSV, service options and public delivery/economy projections rather than implementing alternatives.

**Durability:** mission creation uses integration-scoped persisted request ID/fingerprint mapping in the creation transaction; same ID/different input fails. Start reuses the root job; prepare reuses intent/current attempt without resetting state. Lost responses instruct reread of the same identity. One process has one principal; no cross-principal cache. Cancellation, revocation and disconnection do not roll back committed auctions or human-authorized transfers.

## Verification plan

The [SDK testing guide](https://ts.sdk.modelcontextprotocol.io/v2/testing.html) distinguishes modern in-process coverage from spawned stdio coverage. Use actual `Client`/`StdioClientTransport` from the matching packages to spawn the built executable. List exactly 13 tools, verify strict schemas and call success/failure cases; assert stdout contains only protocol frames and startup/shutdown/restart fail clearly. For protocol 2026 coverage, `createMcpHandler` with an in-process fetch client is useful without deploying another transport. `InMemoryTransport.createLinkedPair()` alone covers 2025-era instances. Close client before handler.

Backend regressions must exercise real transactions for issuance/digest-only storage, TTL/revocation/revoke-all/logout policy, two owners, scope/mission restrictions, cursor isolation, audit redaction, rate bounds and concurrent durable idempotency. Token holders must fail against human authorize/dispute/credential administration functions.

A no-send E2E acceptance uses an actual SDK client, spawned stdio process and actual isolated local Convex: authenticate a human separately, issue a scoped credential, create a synthetic mission, start the genuine funded-mode path when ready, read actual persisted stages, and prepare/request exact human approval while proving zero signer/broadcast calls. With settlement unavailable, return the issue's human metadata-preview acknowledgment requirement; only the human UI can acknowledge that path. Existing engine tests retain independent responsibility for genuine bidding/execution/verifier correctness.

Check locked projections for concealed JSON/CSV and verification values, exact parent/child final receipt gating, uncertain identity retention, cancellation around a commit and response loss/restart. Never simulate a paid ending as live evidence. Actual payout requires a separately approved budget; wallet setup is deferred. Run existing project suites under selected Node 24 and report blockers honestly. Backend extension security review remains required; protocol discovery is insufficient.

## Skill discovery and quality check

The invoked find-skills workflow checked the [skills directory](https://skills.sh/) and found [Anthropic's mcp-builder](https://skills.sh/anthropics/skills/mcp-builder). The directory currently reports 142.1K installs and approximately 194.1K repository stars. A separate `gh api repos/anthropics/skills` check returned 194,538 stars. These are observed popularity/source signals, not a security certification.

The [actual skill](https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/SKILL.md) and [v2 TypeScript reference](https://raw.githubusercontent.com/anthropics/skills/main/skills/mcp-builder/reference/node_mcp_server_v2.md) were inspected. They now explicitly distinguish v2 from legacy v1 examples. Useful guidance includes schemas, consistent tool naming and evaluation. Generic advice to favor broad endpoint coverage does not override this issue's strict allowlist. Generic HTTP/example dependencies and optional Markdown formats are unnecessary here. Do not copy the legacy v1 reference; select the current v2 reference and verify pinned APIs.

Optional installation command, verified from the directory:

```sh
npx skills add https://github.com/anthropics/skills --skill mcp-builder
```

No skill was installed or global configuration changed. The official protocol/SDK sources remain authoritative for implementation.
