# Local runtime settlement interruption check — 2026-11-14

This closes the specific local durability/scheduler evidence gap in #9/#10. It does not enable payment retries or recovery. The [sanitized result](runtime-settlement-2026-11-14.json) identifies production source, runtime, actual public receipts, nonces and assertions. Earlier convex-test subprocess results remain separate evidence.

A fresh anonymous Convex backend ran on ports 3230/3231 with Node 24.22.3. A separate dedicated testnet account was created using the official free helper and a recipient subaccount using near-api-js. No billing account, mainnet funds, existing application wallet or private user dataset was used. Credentials remain ignored and server-only. The normal public auth and mission APIs created a disposable buyer and a synthetic three-record summary with a useful cleaning subcontract. Actual scheduled stages computed competing bids, awards, both deliverables and independent verification; no approved output or receipt was inserted as a fixture.

The disposable copy of nearSettlement.ts added finite localhost observation markers at entry, before/after its official SDK signing call, before its single send_tx call and after that call returned FINAL. A 120-second pause after send_tx and before the outcome mutation created a controlled crash window. An internal-only temporary fixture scheduled duplicate worker deliveries and read actual persisted rows/scheduler states. These observation/pause hooks and the fixture are removed before completion; they are not application endpoints or a simulated RPC. See the opt-in [runner](../../tests/manual/runtime-settlement.mjs).

Observed sequence:

1. Actual public authorization mutations reject recipient and amount substitution. Real reputation/depth/amount/recipient probes record denials. No signing/broadcast marker occurs.
2. The owner authorizes the exact parent obligation. One signing attempt/completion and one broadcast occur. Before app confirmation, the real database contains CONFIRMING, exact hash/nonce and a signer lock; results stay locked.
3. SIGKILL terminates the test-owned backend/Node executor process tree. Restart uses the same persistent backend data. Hash, nonce and the same lock identity survive. The interrupted scheduled action is recorded as failed; automatic action retry is not claimed.
4. Two explicit duplicate deliveries run through the actual Convex scheduler and finish without another signature or broadcast. Reauthorization is denied. A separately approved child obligation cannot sign while the parent's lock survives; it remains READY and requires later owner reauthorization.
5. The authenticated owner requests reconciliation. The existing hash is checked against actual public FINAL evidence, without signing/broadcast. Parent confirmation releases the lock, but child payment is still outstanding and full results remain locked.
6. Restore and deploy the original production worker, waiting for deployment readiness. The owner separately authorizes the child. Its distinct final hash/next nonce is confirmed; parent plus child equals the original award. Full output becomes readable with one release event, and there is no remaining signer lock.
7. Independently query both exact hashes through public RPC and apply inspectReceipt to hash/sender/recipient/amount/nonce/finality/outcomes. Compare the real access-key nonce before and after with the stored transaction nonces. No old intent is reset or resent.

The marker counts apply to the instrumented parent interval; the child runs under restored production source. The existing offline subprocess suite separately instruments actual SDK method calls and exercises additional pre-hash/post-hash uncertainty boundaries. No pre-hash crash recovery, arbitrary retry safety, cloud-runtime acceptance or production security certification is established here. A signed/unknown intent still holds its lock until matching evidence resolves it.

An initial harness attempt exposed a deployment-readiness race in the experiment; it did not duplicate a payment. Its already-signed child was reconciled by its original hash, never re-sent. The corrected complete run waits for each actual deployment to finish. Do not use a test-runner timeout as proof that a transfer failed.

## Reproduction (explicit destructive test only)

Use a separate Git worktree/branch with physical dependencies and a fresh anonymous backend on ports 3230/3231. Never run this against the working buyer backend, a cloud deployment, or a shared signing identity. Initialize that local backend once, then stop it. Create one dedicated free testnet account whose name begins guildzero-restart-, fund its recipient, and keep only the five settlement variables documented in settlement.md in mode-0600 .convex/runtime-gate/backend.env. Do not commit that file or reuse another process's key. Account creation/funding is a separate intentional step; the runner does not obtain funds automatically.

With Node 24 selected, run:

```sh
node tests/manual/runtime-settlement.mjs --confirm-disposable-backend-and-testnet-transfer
```

Without the flag the runner exits without launching services or transferring funds. It refuses main/master, non-anonymous backend configuration, an existing service, and accounts outside its dedicated test namespace. It temporarily instruments only the isolated checkout, starts/kills its own process tree, restores source/generated API, and retains raw local evidence under ignored .convex/runtime-gate/. Evidence contains synthetic record identifiers, not credentials. If interrupted externally, inspect the local diff and restore only this experiment's source changes; preserve backend state/keys and reconcile existing hashes. Never rerun blindly with an outstanding uncertain obligation.

The runner is opt-in manual test infrastructure, excluded from npm test. Review its complete source before using it. It requires Linux process inspection for terminating only its test-owned descendants. Public references: [official free helper flow](https://github.com/near/docs/blob/main/snippets/faucet.jsx), [transaction RPC](https://docs.near.org/api/rpc/transactions).
