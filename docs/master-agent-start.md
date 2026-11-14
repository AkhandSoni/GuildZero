# Start once: personal Master Agent

At `/missions/new`, enter the task, upload the bounded CSV input(s), set the maximum contract transfers and deadline, then select **Start**. Enter in the prompt also starts; Shift+Enter adds a line. The form is frozen during submission and waits for file reading to finish.

When automatic settlement is configured, **Pay verified work automatically within my budget** is selected. The Start screen discloses the configured operator/agent recipients, an aggregate transfer cap covering all steps and cleaning children, separate actual network gas, and authorization expiry within one hour/deadline. Selecting Start is the authenticated human financial decision. Groq text never supplies financial consent.

Start saves that exact prompt, datasets and human-review setting with a durable idempotency identity and immutable request/data/policy/cap/expiry scope. Groq proposes only supported services; strict schemas and deterministic validators compile the proposal. The backend atomically admits at most three existing service missions and an exact plan-bound grant derived from that original consent. It uses the existing auctions, three-round negotiation, one-level subcontracting, verifier, reputation, signer locks and settlement engine. No second plan acceptance or bundle authorization is needed for a valid Start.

The plan and real economic activity remain visible. Unambiguous verified work can settle automatically; only matching final receipts unlock full results. Ambiguity/unsupported requests, changed policy, expiry, failed work, human-review requirements and failed/uncertain payments stop or pause. No dispute is automatically approved and no uncertain transfer is resent. Clarification or failed planning invalidates unused Start authority; use a new Start request for changed instructions. Existing exact per-payment manual approval remains a distinct human fallback.

**Stop delegation** revokes pending Start authority and future grant admissions, and cancels unawarded work. It cannot recall a transaction already admitted for signing/broadcast. Duplicate Start/finish requests cannot extend authority or duplicate missions, grants or payouts. Pending consent is also revoked by cancellation, content removal and terminal planning failures. Old planning requests cannot be upgraded implicitly; the original manual editor is still available through **Advanced / Manual Mission Creation**.

## Operator configuration

`GROQ_API_KEY` and `GROQ_MODEL` remain server-only Next.js settings in ignored `.env.local`. No signer key is sent to inference or the browser. Existing NEAR credentials stay solely in Convex.

The backend-only `MASTER_AGENT_AUTOPAY_ENABLED` switch remains **false by default in source/examples**. After the reviewed rollout is enabled by the operator, new human Start requests may authorize automatic payments. Existing requests/grants/payments are never backfilled or reset. `NEAR_PAYMENT_RETRY_ENABLED=true` is incompatible with this automatic path and requires exact human recovery approval; Start fails closed. Quota configuration and all other settlement restrictions are preserved.

If automatic settlement is unavailable, the screen explicitly offers **Processing preview only — no automatic payment**. Start still plans and runs actual work, but creates no financial grant and does not unlock unpaid output. This is not a successful paid run. Restoring configuration cannot upgrade a preview consent into payment authority.

## Evidence and boundaries

New backend tests exercise scope, replay, policy/data changes, revocation during inference/claim/pre-sign admission, disputes, legacy-API isolation and parent/child conservation. SDK subprocess tests exercise successful one-Start signing/receipt/release, revocation before signer access and lost-permit handling against an explicitly offline chain using ephemeral keys. Browser tests use actual Convex Auth, consent, auctions and verification; the gold planner is explicitly a test fixture. A separate real Groq preview checks inference without signing. No new public-chain payout is claimed, and no additional NEAR is spent from the owner's testing cap.
