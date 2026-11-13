# Demo data retention policy v1 — issue #35

This is an engineering policy for the current synthetic-data demo, authorized by the owner's request to implement #35. It has not been validated with representative users or against applicable jurisdictions. It is not a production retention policy or a compliance claim. Do not upload sensitive personal data.

| Record | Current retention and removal |
| --- | --- |
| Unsaved editor/import data | Browser memory until navigation/reload; no application localStorage/autosave of the CSV. |
| Unused saved draft | Retained until owner uses Delete draft; deleted from the active database. |
| Active or unresolved work | Retained while required for processing, review, revision or settlement reconciliation. Removal is refused. |
| Terminal mission dataset/output | Retained until explicit owner confirmation in Dataset retention. No automatic expiry or background purge. Parent and child are handled atomically. |
| Auth accounts/sessions | Separate from dataset removal; retained by Convex Auth and legacy migration tables. No account erasure/recovery flow is claimed. |
| Financial/security history | IDs, owner relationship, amounts, allocation, contract/work/payment states, verification verdict/check codes and timestamps, agent/reputation facts, transaction hash/nonce/block/account references retained. Free-text evidence and column labels are removed. Public NEAR records cannot be deleted. |

## Removal rules

The owner must confirm permanent removal. The backend authenticates the session, derives ownership, and rechecks the entire group inside one transaction. All jobs must be terminal (approved, rejected, cancelled or unawarded); active contracts and unresolved disputes block removal. Each completed obligation must have its exact latest deliverable/verification approval bound to a confirmed payment. Missing, failed, pending, submitted and uncertain payments and relevant signer locks block removal. Historical unbound financial records require operator review; removal never resets them to permit payment retry.

Safe traversal is bounded to the current one-parent/one-child, two-attempt model and recorded histories. Unexpected extra records or excessive history block instead of partially clearing content. These exceptional histories need a separately reviewed operator process; no unsafe override is provided.

Removal clears mission title/criteria/source/options, all parent/child input CSV/options/worker-error text, deliverable content/verification payload, verification detail text, dispute reasons, bid rationale, negotiation explanation, contract selection explanation and event/security reason text. Record identities and exact immutable payment rows remain intact. A timestamp and one content-removal event persist. Retried removal is idempotent. Removed work cannot be duplicated, started or quoted for another payment. Existing confirmed receipts remain viewable. Results and dataset downloads are unavailable after removal; verification cannot be rerun without the removed data.

## Exports, backups and traces

Dataset removal affects the active application database, not independently copied missions, user downloads, browser tabs or external copies. Owners must delete exports separately and close other tabs; new subscribers receive the redacted data. Private Convex operations remain authenticated and owner scoped. Do not put private CSVs in URLs, logs or test artifacts. Playwright traces, videos and screenshots remain disabled in the committed test configuration, and tests use explicit synthetic fixtures.

This repository does not create or manage database backups. An operator who creates exports/backups must inventory and restrict them, define a validated expiry period before real customer data, and remove expired copies through the backup provider. Never restore old content into service after an owner removal: reconcile removal timestamps/tombstones from a current authoritative export before serving a restoration. If a backup predates removal and cannot be reconciled, do not restore it into the live app. Backup deletion, account erasure, verified expiry scheduling and legal/real-user requirements validation remain operational/product gates; this control does not claim to erase inaccessible backup media or public blockchain history.
