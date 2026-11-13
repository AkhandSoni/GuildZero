# Custodial NEAR testnet settlement

This implementation is an application-authorized native-token transfer from one dedicated server-side testnet account. It is not escrow or a trustless marketplace. The runtime never accepts a generic destination/amount transfer API. Each payment must come from a completed, approved job, its stored contract and latest verification (or recorded buyer dispute approval). Child payments also require the parent job to be approved.

## Configuration

Use Node 24.22.3 (`nvm install && nvm use`, see `.nvmrc`). Convex local Node actions require a supported Node 22/24 runtime; the earlier Node 26-only setup cannot deploy these actions. `convex.json` selects Node 24 for cloud actions. Keep Next.js and Convex as the only application runtimes.

Create a dedicated named account ending in `.testnet` and obtain faucet tokens using the current official NEAR testnet account tooling. Use only funds you can discard. Keep its key in the Convex backend environment, never in a `NEXT_PUBLIC_` variable, browser, prompt, or Git. Do not share this signing identity with external signing tools while settlement is running.

Backend environment variables:

| Name | Value |
|---|---|
| `NEAR_NETWORK` | `testnet` |
| `NEAR_OPERATOR_ACCOUNT_ID` | Dedicated named testnet sender |
| `NEAR_PRIVATE_KEY` | Its server-only signing key |
| `NEAR_AGENT_RECIPIENTS_JSON` | JSON object from existing seller IDs to project-owned named `.testnet` accounts; max 10 entries |
| `NEAR_SETTLEMENT_ENABLED` | `true` only after reviewing configuration and funding |

An ignored `.env.near.local` worksheet may be used for manual entry. It is not automatically synchronized. Import only the five backend variables above via the Convex dashboard or `convex env set --from-file` after filling every value; never overwrite existing secrets with blank placeholders. Do not import optional receipt-verification fields into the backend. Do not rotate the existing Convex Auth keys.

The application runtime does not create or fund accounts. During local validation, a dedicated project operator was created through the official free testnet helper and five project-owned recipients were funded from it. The existing checkout has working server-only configuration; a fresh clone must configure its own accounts. Keys are in ignored mode-0600 local files and the local backend, never Git. Named testnet accounts only are accepted. Individual payouts are capped at **1 testnet NEAR**, additionally bounded by the contract holdback and reservation. The live RPC chain must identify itself as `testnet`. The adapter checks recipient existence and sender balance against transfer value, chain-reported storage pricing and a gas reserve before signing.

## State and authorization

`payments.prepare` is owner-only and derives the exact sender, recipient and amount from server configuration/contract state. It reuses the same per-job intent on retries. The UI must show this intent and require explicit confirmation of its exact recipient/amount through `payments.authorize`. Policy/recipient/amount substitutions are rejected and durably audited. The browser never supplies signing credentials or its own approval verdict.

New intents also bind `policyVersion` (`guildzero-testnet-v1`), exact `deliverableId`, `verificationId`, and, for human approvals, `disputeId`. Owner authorization and the atomic signer claim recheck all bindings, including contract identity. A replacement approval/output cannot silently reuse an old confirmation even if recipient and amount remain the same. Human approval requires a recorded decision by the mission owner. Claim denials persist an audit reason, clear the stale authorization, and return before signing/network calls or acquiring a signer lock.

Historical intents without these bindings stay readable and are never silently backfilled. They fail new authorization/claim with `PAYMENT_APPROVAL_BINDING_REQUIRED`. Do not delete/recreate them or guess their provenance; operator review is required. Already-submitted/uncertain transfers continue reconciliation by their existing hash without requiring new approval metadata, because reconciliation must never trigger a replacement payment.

Authorization schedules an internal action. An atomic claim serializes this dedicated sender with a persisted signer lock, then marks `SUBMITTING`. The official `near-api-js` creates/signs a single native-transfer transaction. Its hash and nonce are persisted **before** the one `send_tx` call. No high-level retrying send API is used. Signed bytes and keys are never stored in public-facing data or printed.

`FINAL` chain evidence must match transaction hash, sender, recipient, amount, nonce, single-transfer action, overall success, receipt outcomes and an actual block reference. Only then is an intent `CONFIRMED`. A final matching transfer failure is `FAILED`; gas charges may still occur. A proven failure before broadcasting is also `FAILED`. A transport timeout, optimistic/pending result or mismatched/incomplete evidence remains `UNKNOWN_RECONCILE`. Neither unknown nor failed intents automatically return to `READY` or get replaced by a new intent.

Owner-triggered reconciliation queries the existing hash using `tx`; it does not sign or broadcast. Checks are throttled to one per 15 seconds per intent. There is no unbounded scheduled polling. An uncertain intent holds the sender lock, conservatively blocking further signing. Never delete the lock/intent or resend after `tx` reports not found: absence is not proof of nonexecution. A worker crash before recording a hash, permanently failed intent, or stale configuration requires operator investigation; automatic recovery/retry is intentionally not implemented.

Parent holdback plus actual child price equals the original award. Child payments are part of that same obligation, not added again to the buyer's total. Successful work/reputation is separate from chain settlement; an approved job does not imply a confirmed transfer.

## Validation and controlled security probes

Unit/backend tests cover policy binding, private access, idempotency, duplicate claims, unknown outcomes and conservative lock retention. Offline mocked-RPC adapter tests check that the hash is stored before broadcast, success handling, and timeout with no second broadcast. These mocks are not testnet execution evidence.

`security.run` evaluates controlled attempts against the same exact-transfer, subcontract-depth, and reputation-authority predicates used in backend enforcement. It records a denial and never invokes signing. Payment probes require an actual prepared intent; a duplicate probe requires an already non-ready intent. Without prerequisites the response says unavailable, rather than fabricating an attack result. The activity is labeled `CONTROLLED_PROBE_*`.

To independently inspect a real previously submitted receipt, set public fields in ignored `.env.near.local` (or your shell): `NEAR_RECEIPT_TX_HASH`, `NEAR_OPERATOR_ACCOUNT_ID`, `NEAR_RECEIPT_RECIPIENT`, `NEAR_RECEIPT_AMOUNT_YOCTO`, `NEAR_RECEIPT_NONCE`. Run `npm run test:near`. It never sends a transaction and exits nonzero if required fields/evidence are absent. Confirmation is not claimed without matching final chain evidence.

**Live acceptance demonstrated locally on 2026-11-13:** the production browser created a custom summary mission, enabled a useful cleaning subcontract, awaited actual execution and independent verification, then prepared and separately authorized both exact allocations through the real UI.

- Parent: **0.407070342 testnet NEAR**, [final transaction](https://testnet.nearblocks.io/txns/VXXUqkDSdzH8mQxUs59CazxsHWYXQBnMqCLwzuxvNsS).
- Child: **0.10316754 testnet NEAR**, [final transaction](https://testnet.nearblocks.io/txns/2uz2eKHdVyEUYjxWpda4WAwY1qyHFyQs8Q8XDeqUdtMi).
- Independently queried both exact hashes through official testnet RPC and rechecked hash/sender/recipient/amount/nonce/finality/receipt outcomes. Both returned `FINAL_MATCHING_TRANSFER`; their sum, **0.510237882**, equals the original award exactly, with no duplicate intents.
- Real backend probes rejected altered amounts, substituted recipients, unauthorized reputation writes, excessive child depth and a duplicate payout after confirmation. Probes performed no signing.
- `npm run test:near` passed against the saved public child receipt fields. This command only reads chain state. Default tests do not submit transactions or consume faucet tokens.

For this configured checkout, keep the existing environment/backend state. Do not rerun key generation, import blanks, delete intents or resend an existing payment to repeat a demonstration. A fresh clone needs its own backend keys and funded testnet mapping. Public hosted payment acceptance remains pending.

Primary references: [official NEAR JavaScript tooling](https://docs.near.org/tools/near-api), [transaction RPC/finality](https://docs.near.org/api/rpc/transactions). A read-only request to the configured official RPC verified `chain_id=testnet` during development; it was not a payment.

Account setup reference: [official NEAR faucet implementation](https://github.com/near/docs/blob/main/snippets/faucet.jsx), using the free testnet account helper. Recipient subaccounts were created with the official JavaScript SDK. No mainnet account or real-money purchase was involved.

## Operator-managed demo spending allowances (#32)

Settlement authorization and signer claim require two additional **server-only** settings: `NEAR_DEMO_ALLOWANCES_JSON` maps explicitly approved Convex `users` IDs to canonical nonnegative integer yoctoNEAR cumulative limits (at most 100 entries); `NEAR_DEMO_OPERATOR_LIMIT_YOCTO` is the cumulative shared operator ceiling. Both support up to 28 decimal digits. Missing, malformed or partial configuration blocks settlement. A zero limit grants no positive spending. Select verified existing user IDs using the operator's trusted backend tools; never accept a browser-supplied owner ID or auto-enroll email/new logins. Updating backend environment is the operator control surface, not a public app mutation. Do not paste actual config or user IDs into Git.

These are lifetime demo **permissions**, not funded credits, per-user wallets, deposits, or a guarantee of the operator's public balance. Limits do not reset on signout, a new mission, or a different sender configuration. New accounts have no entry and cannot settle. The existing per-transfer cap and exact owner authorization still apply; nothing signs automatically. The shared on-chain balance remains separate and may change after authorization.

The backend recomputes conservative obligations transactionally from persisted contracts and payment intents. An outstanding root contract counts its original award, including any one-level cleaning allocation once (not parent award plus child). A completed unpaid contract continues to count after a payment preparation failure; a `FAILED` intent does not erase a debt or grant retry rights. Rejected work releases only its unpaid contractual allocation. Submitted, uncertain and confirmed intent amounts remain counted even if historical contract state is inconsistent; confirmed consumption is cumulative. An unawarded cancelled auction has no obligation. No existing history is reset or migrated. When allowance policy is present, new awards also check permission and capacity atomically. With policy absent, local unpaid processing remains usable but payment authorization/claim fails closed. Historical commitments may already exceed a newly configured limit; raise the operator-approved limit or resolve the actual obligations, never delete history to free capacity.

Authorization and claim include all known obligations, not just this transfer. Conservative accounting can block payment when other existing commitments already exceed the ceiling; review before reducing limits. Reads are bounded to 1,000 jobs, contracts and intents each; exceeding a bound blocks new settlement/awards rather than silently ignoring history. This is a small-demo safeguard, not an unbounded production ledger. Only the current owner's limit and allocated/consumed total appear in the payment panel; other owners' allowances and the aggregate obligation figure are not returned. Production retention, allowance renewal and larger-volume ledger designs require separate work.
