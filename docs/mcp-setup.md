# Local GuildZero MCP setup

This is the implementation branch for [issue #50](https://github.com/AkhandSoni/GuildZero/issues/50). See [the implementation plan](mcp-implementation-plan.md), [backend design](mcp-backend-plan.md) and [protocol research](mcp-protocol-research.md). Verification results are recorded separately; the existence of these instructions does not establish that all acceptance gates have passed.

## Start without a wallet

Use this branch's own checkout; do not copy a previous deployment's credentials or NEAR keys. Run `npm ci`, then `npm run dev`. The launcher selects checksum-verified project Node 24.22.3 without changing your global Node/shell. On first Convex setup select **Start without an account (run Convex locally)**. It generates ignored `.env.local` and local deployment state. Sign up in the local UI using a disposable email/password. No email provider, model account, wallet or funded NEAR account is required.

Keep settlement disabled and `NEAR_PAYMENT_RETRY_ENABLED` off. A mission can be created as a draft. If funded auction readiness is unavailable, MCP returns `HUMAN_PREVIEW_ACKNOWLEDGMENT_REQUIRED`; the owner can separately open its trusted mission page and acknowledge metadata-only processing. The assistant cannot provide that acknowledgment. Real scheduled execution/verification can finish, but full output remains locked without matching final payments. Payment preparation can return a configuration/policy denial. This is an honest no-send workflow, not a paid-delivery demonstration.

Set `GUILDZERO_MCP_UI_ORIGIN` on this isolated Convex backend to the trusted Next.js origin (for example `http://localhost:3000`). This is server configuration for approval links, never a tool argument. Remote origins require HTTPS. Convex's site origin (HTTP actions) differs from its client deployment URL; read `NEXT_PUBLIC_CONVEX_SITE_URL` generated for this deployment, rather than guessing a port.

## Enroll a client

Sign into **Connections** (`/integrations`) using the human UI. Name the client, review each scope and select only needed operations. Optional mission IDs restrict the credential to those owned missions; this disallows new mission creation. Default expiry is one hour; maximum is24 hours. Each client/process should have a separate credential. The UI shows the secret once; ordinary listing returns metadata only.

Save the secret outside Git in a private absolute-path file with mode 0600 and a private parent directory. Never include it in a prompt, command argument, tool parameter, source file, screenshot, log or checked-in MCP configuration. `GUILDZERO_MCP_TOKEN_FILE` configures its path. Environment bearer configuration is an alternative only where the host requires it. Supply a minimal environment to the child; omit NEAR private keys, Convex admin/deploy credentials and human auth sessions.

Signing out or session expiration does **not** revoke independently issued integration credentials. Use Revoke/Revoke all before leaving a shared machine. Expired or revoked credentials fail on subsequent backend operations immediately; existing committed jobs or human-authorized payments are not undone. The OS owner/client host can read its child's bearer credential: this is not protection against a compromised local host.

## Build and configure stdio

Run `npm run build:mcp` under project Node 24. Launch the built executable directly from the external client, avoiding package-manager stdout notices. Replace every placeholder in this example outside tracked files:

```json
{
  "mcpServers": {
    "guildzero": {
      "command": "/absolute/path/to/node24/bin/node",
      "args": ["/absolute/path/to/GuildZero-MCP/dist/mcp/server.js"],
      "env": {
        "GUILDZERO_MCP_BACKEND_ORIGIN": "http://127.0.0.1:YOUR_CONVEX_SITE_PORT",
        "GUILDZERO_MCP_TOKEN_FILE": "/absolute/private/path/guildzero-token"
      }
    }
  }
}
```

Use your actual local backend site port. Only loopback HTTP or remote HTTPS is accepted. Redirects and model-selected endpoints are rejected. The adapter calls only `POST /integrations/mcp-tools`; it does not expose an HTTP MCP service. stdout is reserved for protocol messages. Sanitized diagnostics go to stderr. Successful tool results can contain private data the credential explicitly permits; your chosen external assistant may send those results to its own provider. GuildZero cannot control that client's privacy practices.

## Operations and payment authority

The 13 tools and scopes are listed in the implementation plan. Start returns persisted state promptly; read tools poll on demand. Keep creation `requestId` stable after response loss. Reuse original mission/job/intent identities; never create replacement payment attempts because a process disconnected. Backend timeouts/cancellation do not cancel committed work.

Payment preparation binds backend-derived recipient/amount and creates no approval. Request authorization returns an exact intent/attempt and a trusted UI link; it does not call the human authorization mutation. Open that link separately, authenticate as the owner, review the current exact transfer, and approve through the existing payment panel only when a separately authorized spending budget exists. A tool call, assistant text, MCP confirmation or visited link is not financial consent. Results remain gated by existing final receipt checks for every parent/child obligation.

Unknown outcomes preserve the original identity and reconciliation locks. This MCP interface cannot resend, retry, reconcile-write, resolve disputes, alter reputation, select a payee, sign arbitrary transactions or issue credentials. Human disputes and recovery remain in existing UI/backend policies.

Optional resources/prompts and Streamable HTTP MCP are deferred. There is no Groq/Qwen integration, application-hosted LLM, mainnet, paid API or public tunnel. SDK interoperability is distinct from model inference quality.

## Reproduce the no-send acceptance test

Use an **isolated disposable** local deployment, not an existing funded demo. The live test needs a running frontend/backend, the built stdio executable, and the following explicit synthetic configuration on that isolated backend. These identifiers are labels, not a claim that on-chain accounts exist. The test creates real private synthetic missions and retained jobs; it never calls human payment authorization.

```sh
# Run Convex CLI under project Node 24 against this worktree's local deployment.
npx convex env set NEAR_SETTLEMENT_ENABLED false
npx convex env set NEAR_OPERATOR_ACCOUNT_ID mcp-synthetic-sender.testnet
npx convex env set NEAR_AGENT_RECIPIENTS_JSON '{"clean-sprint":"mcp-synthetic-clean.testnet","clean-steady":"mcp-synthetic-steady.testnet","stats-core":"mcp-synthetic-stats.testnet","analysis-careful":"mcp-synthetic-analysis.testnet","report-craft":"mcp-synthetic-report.testnet"}'
npx convex env set GUILDZERO_MCP_UI_ORIGIN http://localhost:3150
```

Do not configure `NEAR_PRIVATE_KEY` or enable settlement/retry on this backend. The synthetic sender/recipient mapping permits existing quote/preparation checks without a signer. The funded-start tool still refuses, requiring separate human preview acknowledgment. The browser test performs that acknowledgment through the existing UI, then observes real scheduled processing and locked output. It enrolls two actual users/credentials, invokes all 13 tools, tests cross-user denial, reconnect and revocation, and deletes temporary private token files.

```sh
# With the local backend already watching this checkout:
npm run dev:frontend -- --port 3150
# In another terminal, under the same project Node 24:
PLAYWRIGHT_BASE_URL=http://localhost:3150 npm run test:mcp:live
```

Set `GUILDZERO_MCP_BACKEND_ORIGIN` if the generated site port differs from 3211. Install Playwright's expected Chromium with `npx playwright install chromium`, or set `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` to an existing compatible browser. The test records a mobile screenshot only after one-time credentials are hidden/revoked; trace/video are off. Default browser runs skip this opt-in test unless its isolated setup is requested.

For the remaining local gates:

```sh
npm run test:mcp
npm test
npm run test:integration
npm run lint
npm run typecheck
npm run build
npm run check:client
```

The validated SDK client is `@modelcontextprotocol/client@2.4.0`: modern negotiation in-process and compatible legacy stdio in a spawned process, plus spawned stdio against actual local Convex. No named desktop assistant host has been certified by those tests. Configure and verify your chosen host separately; no universal interoperability claim is made.
