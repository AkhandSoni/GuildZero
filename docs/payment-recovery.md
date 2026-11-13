# Payment recovery protocol v2 — proposal for issue #33

## Decision and current limit

Do not reset `FAILED` to `READY`, delete an intent/lock, or infer safety from `lastReason`, absent `txHash`, balance changes, a timeout or a transaction-not-found response. Current payments still cannot be retried. No schema or runtime authorization changes are included here.

At baseline `3f27703`, `nearSettlement.settle` marks `broadcasting` only after `paymentWorker.prepared`. A metadata mutation can commit even when its caller does not receive the response. Failures are labelled by action-local stage and an internal Boolean. `prepared` and `outcome` carry only an intent ID, not a claim/attempt generation. They cannot distinguish an old worker from a replacement. A human must not convert those labels into a new payment permission. These are repository observations; they do not establish that any existing transfer duplicated.

[Convex actions](https://docs.convex.dev/functions/actions) run outside a database transaction; separate mutation calls are separate transactions and external side effects cannot be automatically retried safely. [Scheduler cancellation](https://docs.convex.dev/api/interfaces/server.Scheduler) does not undo an already running action's external work. Consequently cancellation or elapsed lease time is not nonbroadcast proof. [NEAR transaction RPC](https://docs.near.org/api/rpc/transactions) distinguishes sending signed transactions from inspecting their execution. Our conservative rule is that an inconclusive inspection never authorizes a replacement. This rule is a protocol choice, not a guarantee that RPC absence establishes nonexecution.

## Proposed storage and identity

Keep one stable obligation/intent per job. Add a versioned `paymentAttempts` table and `currentAttemptId` on new v2 intents only. An attempt stores intent/contract/owner IDs, generation, immutable exact approval binding (network, sender, recipient, amount, policy, latest deliverable/verification and any dispute approval), owner confirmation time, claim token, phase, failure code, created/closed timestamps and optional transaction hash/nonce/block. Financial amounts remain checked integer yoctoNEAR strings. Record transition/audit history append-only; never replace the old attempt's reason or transaction identity with a new attempt's data. No signed bytes, private keys, raw SDK errors or private dataset content enter these records.

All action entry points and callbacks must carry the attempt ID and unguessable server-generated claim token; callbacks atomically compare both with the intent's current generation and sender lock. Never trust a browser-provided owner, safety flag, failure phase or binding. The claim token is internal-only and is not a payment credential exposed in owner query results.

The stable intent remains the financial obligation. Attempts are execution history, not additional debt or fresh budget. Superseded attempts retain their evidence; old uncertain attempts cannot be superseded at all. Confirmed consumption and pending/uncertain amounts remain counted. Integration must use #32's actual allowance implementation (PR #38), never a duplicate permissive policy or a per-attempt allowance reset.

## Proposed transitions

| From | Atomic transition and actor | Result |
| --- | --- | --- |
| `READY` | Owner confirms exact current attempt/binding; claim compares generation and obtains exclusive sender lock | `PREPARING` |
| `PREPARING` | Trusted worker records allowlisted read/preparation failure using matching current token, while no signing permit exists | `CLOSED_PRE_SIGN_FAILURE`; immutable closure proof; release only that token's sender lock |
| `PREPARING` | Trusted worker acquires one signing permit, committed before calling the signer | `SIGNING_STARTED`; never eligible for replacement under this bounded protocol |
| `SIGNING_STARTED` | Worker persists exact signed transaction identity | `SIGNED_IDENTITY`; still not recoverable |
| `SIGNED_IDENTITY` | Worker atomically obtains a single broadcast permit using attempt/token/lock | `BROADCAST_ADMITTED`; already uncertain even if the process dies before the RPC call |
| `BROADCAST_ADMITTED` | Same worker performs at most one `send_tx`; all exceptions conservatively retain reservation and lock | Pending/uncertain until exact final receipt |
| Pending/uncertain | Read-only reconciliation for original identity | Exact confirmed/failed chain outcome or remains uncertain; no replacement in this scope |
| `CLOSED_PRE_SIGN_FAILURE` | Authenticated owner requests replacement against that exact current attempt and generation after all checks below | Atomically consume closure for replacement, append new `READY` attempt, change current pointer; do not sign or schedule sending |

A worker may only call the signer after its signing-permit mutation succeeds. Audit every pinned SDK preparation/helper path before implementation approval: a monolithic helper capable of signing belongs after that permit, even if its API is named preparation. No signer or signing-capable helper may be invoked in the recoverable PREPARING phase. The same phase compare-and-set makes closing and acquiring signing permission mutually exclusive. After closure, a paused old worker cannot obtain signing permission; after signing permission, closure cannot succeed. Duplicate action delivery cannot obtain a second signing/broadcast permit. Losing a permit response is conservatively stuck, not retryable. A callback must never release a lock owned by another attempt, overwrite an immutable closure or act on a stale generation. No unchecked error-handler Boolean can manufacture the closure.

Only failures *before invoking the signer* are recoverable in v2. An SDK signing error, signed-but-unpersisted transaction, failed metadata persistence, final on-chain rejection or broadcast timeout is deliberately not eligible. Supporting these requires separately reviewed evidence and protocol changes. This sacrifices availability to keep the proof small and defensible.

## Replacement and authorization

The proposed owner mutation accepts only the known intent, expected failed attempt ID/generation and exact displayed binding fingerprint. It authenticates and derives ownership, requires the unconsumed v2 closure proof, checks no signing/broadcast permit or transaction identity ever existed for that attempt, and checks no relevant unresolved attempt or signer lock remains. Do not introduce a public caller-supplied proof field.

Reconstruct the full quote using existing exact approval checks. Require the stored owner/contract/latest output/verification/dispute decision, amount, recipient, sender, network and policy version to match. A change rejects recovery; it does not silently create a differently payable obligation. Check settlement configuration, per-transfer cap, storage/liquidity policy at the relevant existing action boundary, live signer-key readiness and the operator/owner allowance atomically where applicable. A stale balance reading is never a funding guarantee. Recheck exact bindings, configuration and allowances again at new authorization and signer claim.

Replacement creation returns a new prepared attempt for review; it does not schedule signing. The owner must separately confirm that exact new attempt and recipient/amount. Persist an owner-scoped recovery request record in the same transaction as replacement creation, keyed by owner plus request ID and containing the canonical payload fingerprint, old attempt identity and created replacement ID. Authenticate first and check that request record before rejecting a now-stale expected generation: an exact replay returns the already created replacement even though the current pointer moved. A changed payload under the same request ID rejects without returning its replacement. An unknown request must then pass all current-generation and proof checks. Bound and retain these idempotency records with the obligation history; never recycle a request ID to authorize another payment. Concurrent requests for the same failed generation can create at most one replacement. Retain old rows and reasons. Bound history (proposed maximum five total attempts per obligation) and throttle owner requests. Reaching bounds denies, never truncates safety history.

The UI distinguishes approved work, failed attempt, recovery eligibility, replacement prepared, owner authorization and confirmed transfer. It shows an actionable block for old/unproven failures and an original-hash reconciliation link for uncertain outcomes. Any settlement-gated result release (#31) remains locked until the exact latest deliverable and required parent/child payments have matching final receipts. Preparing a replacement, an owner click or a closure proof cannot release output. Dataset removal (#35) remains blocked while the obligation or an attempt is unresolved.

## Cutover and legacy history

No legacy record is automatically enrolled, relabelled, rearmed, backfilled with proof or moved to a new obligation. Existing pre-broadcast labels are diagnostics only. Keep old reconciliation identities, locks and histories. Deploy v2 disabled. Before enabling, drain old scheduled actions where possible and inspect every active old sender lock; cancellation alone is insufficient. Do not enable signing under the same sender while legacy work remains uncertain. New callback validators must reject missing attempt/token identities, and new code must never let an old unfenced callback mutate a v2 record. A cutover crash/restart rehearsal and explicit reviewer signoff are required. Operator investigation of legacy stuck records does not grant an override/retry button.

## Implementation sequence and evidence required

1. Merge/review dependencies #31/#32/#35 or explicitly stack the implementation PRs; freeze attempt/binding contracts. Add versioned schema and read projections without changing existing rows.
2. Add atomic token/attempt-fenced claim, pre-sign closure, signing permit, identity persistence, broadcast permit and result/reconciliation callbacks. All validation must be in mutations; network calls stay in actions. No automatic retry wrapper around signing or broadcasting.
3. Add owner prepare-replacement and separate authorization with idempotency, generation/ownership checks, allowance/reservation integration, bounded attempt histories and sanitized audit events. Implement existing UI states with eligibility reasons.
4. Run unit/backend integration and real browser tests. Run abrupt process termination/restart and concurrent worker tests on an isolated local test stack without sending value. Only a separately authorized testnet exercise may submit a payment. Obtain an independent review of concrete production code, then an owner-approved enablement decision. Update runbook before enabling.

| Acceptance case | Required result/evidence |
| --- | --- |
| Legacy FAILED label, no hash, lease expiry, cancelled schedule | No closure proof; replacement denied, evidence retained |
| Current token fails before signing permission | Exactly one immutable closure; no signer invocation; owner may prepare one replacement only |
| Signing permission granted or SDK signing throws | Replacement denied; no assumption that no signature exists |
| Metadata commit response lost, process dies after identity or broadcast permission | Original identity/lock retained; no resend, even if RPC reports not found |
| Old `prepared`, `outcome`, failure or reconciliation callback after replacement | Cannot alter replacement, close it, unlock its sender or change delivery |
| Changed output/verification/dispute/contract/recipient/amount/network/sender/policy | Both replacement and authorization deny before signing |
| Owner removed from allowance policy, exceeded limits, changed key/signer busy | Deny; no new permits or allowance release |
| Two owners, concurrent requests, duplicate scheduler delivery | Owner isolation; one replacement/current attempt and at most one permit per attempt |
| Failed parent/child, partial settlement, uncertain child | No double allocation, reservation stays counted; no full result release |
| Bound exceeded or unexpected history | Fail closed with operator-review guidance; no history deletion |
| Exact confirmed current parent/child receipts | Existing result-release policy alone controls output; no duplicate release event |

`tests/models/payment-recovery-model.ts` and its tests execute a minimal proposed phase/closure/fencing model. Its deterministic token labels are test markers, not a production token-generation recommendation. The model assumes atomic transitions and trusted preconditions; it does not model the database, recovery-request idempotency records, cryptographic randomness or external signer. The model combines authorized claim into one test transition; production must implement separate owner authorization and atomic signer claim, with repeated revalidation. The tests are not a proof that current production mutations enforce it, not a scheduler/SDK integration test, and not #9/#10 process-crash evidence. Those gates and independent production implementation review remain outstanding. The proposal cannot close #33 or make any existing failed payment recoverable.

## Design review disposition

Separate design review checked the pre-sign closure boundary, stale generation/token callbacks, lost permit/metadata responses, legacy cutover, replacement authorization and idempotent replay ordering. Clarifications now require request-record lookup before stale-generation rejection and an audit of every signing-capable SDK helper before the permit boundary. This review covers the proposal and abstract model only; it is not approval of production retry code or evidence for enabling recovery.
