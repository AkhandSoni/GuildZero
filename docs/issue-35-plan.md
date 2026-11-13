# Issue #35 implementation plan

1. Define a conservative demo policy: data remains until explicit owner removal; no automatic expiry, production compliance or user/jurisdiction validation claims.
2. Add an authenticated, atomic mission-group eligibility check. Only terminal parent/child work may be redacted; completed obligations need matching confirmed bound payments. Any other payment state or signer lock blocks removal. Bound record traversal fails closed rather than partially deleting.
3. Redact all application-held dataset/output and free-text copies while retaining record IDs, accounting, states, verdicts, relationships and public transaction references. Prevent reuse or new payment quotes from redacted work.
4. Provide clear owner controls, confirmation and retained-evidence view; explain downloads, backups and public blockchain limits.
5. Test ownership, active/uncertain/failed payment locks, group consistency, exact settlement binding, idempotency and complete content removal. Run lint, types, tests and production build/client scan. Document unrun browser/deployment checks and remaining real-user/legal policy validation.

## Validation evidence

- Lint and typecheck pass; the full unit/backend suite passes (230 tests, 26 files), including 16 retention cases. Separate integration run: 115 included tests pass.
- Production build and client-boundary scan pass (27 assets). An isolated local Convex deployment generated the API bindings and deployed the functions without touching the user's backend.
- All 14 production-browser scenarios pass in 2.2 minutes, including real Auth2 signup, unawarded synthetic work, cancellation/confirmation of removal, persisted redaction and absence of reuse/download access. Existing Chromium1248 was selected through the documented executable override after the default revision1254 launch was unavailable. Traces/video/screenshots remain off.
- Tests of confirmed payment eligibility use explicitly labelled database fixtures, not actual transfers. No transaction was signed/submitted, credentials copied, public service deployed or existing user data changed.
- Representative-user/jurisdiction validation, operator backup inventory/expiry/removal, auth erasure and independent exported copies remain outside this bounded demo control. Issue #35 remains open for these acceptance/operational gates.
