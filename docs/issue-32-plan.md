# Issue #32 implementation plan

1. Add a bounded, server-only operator allowance policy keyed by immutable authenticated user IDs, with a shared lifetime testnet spending ceiling. Missing or malformed policy denies settlement; signup grants no allowance.
2. Compute conservative obligations from persisted contracts and payment intents in one transactional read. Count a parent award and its child split once; retain unpaid completed work, pending/unknown outcomes and confirmed consumption. Rejected work may release only its unpaid allocation.
3. Check limits atomically at owner authorization and immediately before signer claim. When policy is configured, also enforce new award reservations. Keep unpaid local processing available without a configured payment policy.
4. Expose only the authenticated owner's allowance/obligation figures, clearly separated from wallet balance and planning budgets. Never expose another owner's allowance or obligations.
5. Test missing/invalid policy, owner isolation, concurrent admissions, parent/child splits, failed work/payment, confirmed and uncertain consumption, and newly created accounts. Run existing checks, document exact results and open an independent PR without deploying or sending payments.

Policy choices are a conservative demo default for review, not customer-validated requirements. Allowance changes are operator-managed server configuration, not public mutations; limits are cumulative and never reset on login or new missions. Existing historical obligations count without rewriting their records.
