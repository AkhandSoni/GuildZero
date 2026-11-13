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

## Recovery design follow-up (#33)

[The v2 attempt/fencing proposal](payment-recovery.md) defines the separate implementation and security gates for owner-controlled pre-sign recovery. It is not an enabled recovery feature. Existing `FAILED` records remain blocked; diagnostic reasons or missing transaction hashes are not proof that permits retry. No recovery endpoint, automatic retry or data migration is introduced by the proposal.

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

## Delivery access and launch readiness

Owner-approved follow-up #31 makes full deliverables a backend-enforced entitlement. `jobs.detail` projects metadata and `content: null` until all required settlement evidence matches the latest approved output. Only the latest attempt is releasable. One-level subcontracted missions require both exact parent and child confirmations and conserve the original award. Queries do not infer payment from a hash or human approval, do not invoke RPC/signing, and do not change historical records. Current key or recipient configuration rotation does not invalidate a previously matching bound receipt. A newly complete payment group records one release event per job through the final confirmation transition; repeated finalization cannot duplicate that transition.

Before paying, the owner can inspect output schema/row counts/size and verification checks, not complete numerical values or processed CSV rows. Prior exposed/downloaded data cannot be revoked. This is application access control in a custodial testnet demo, not cryptographic DRM or escrow. The input dataset still belongs to its owner; the public synthetic service example remains an unrestricted local calculation.

Follow-up #34 adds an owner-scoped preflight and explicit acknowledgment for processing when payment configuration is unavailable. Automated **total awards** are conservatively limited to 1 NEAR, including later cleaning allocations, while each exact transfer remains independently capped at 1 NEAR. This is stricter than using a larger parent award whose unknown future split might exceed a payout limit. Larger mission planning budgets remain valid but are not funded balances or permission to exceed the cap. Before an automated award, recipient/configuration checks run again unless metadata-only processing was explicitly acknowledged; legacy non-engine-managed contracts are not silently repriced. Actual network/balance checks remain in the signing action, and no balance is reserved by a preflight.

Previously failed attempts remain failed and results stay locked; #33 tracks explicit recovery for proven pre-broadcast failures. Unknown outcomes retain the existing reconciliation-only policy. This change authorizes no fresh live transfer or top-up.
