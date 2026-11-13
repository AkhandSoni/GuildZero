# Account recovery design — issue #24

Status: design for review, 2026-11-13. Runtime recovery and email verification remain **unavailable**. This change does not register a provider, send email, enroll existing addresses, reset a password or change an owner ID. It resolves the design work in #24; provider approval and executable security evidence remain gates before implementation is enabled.

## Existing boundary and evidence

At main `3f27703`, `convex/auth.ts` uses the pinned `@convex-dev/auth` 2.0.0 core/password components behind a GuildZero credential adapter. `users.email` is an unverified login name. Successful legacy-password migration preserves `users._id`; `authVersion: 2` is a credential-format marker, not proof of mailbox ownership. `emailVerificationTime` and preserved v1 account metadata must not be bulk-imported as trusted recovery enrollment. New passwords follow the shared 10–100-character policy and Auth 2's NFC/common-password/whitespace checks; legacy NFKC equivalence is explicitly recorded.

Primary documentation checked on 2026-11-13:

- [Official Auth 2 email/password guide](https://docs.convex.dev/auth/convex-auth/methods/email-password) describes verified-address recovery using the email/password components and Resend. Its onboarding sender delivers only to the Resend account's own address, so it is not a general-user delivery solution.
- [Existing-user guidance](https://docs.convex.dev/auth/convex-auth/migrating/existing-user-data) keeps application user records under application control. Preserve the original IDs; do not create a replacement account to regain ownership.
- [Migration guidance](https://docs.convex.dev/auth/convex-auth/migrating/from-convex-auth-v1) says upstream migration tooling is pending. GuildZero's existing adapter therefore needs its own explicitly tested enrollment bridge.
- [Resend pricing](https://resend.com/pricing) lists a Free tier with a 100-email daily limit at inspection time. Recheck quotas/terms before setup; a pre-owned verified domain and an approved account are prerequisites, not free assets supplied by this plan.

The **installed pinned source**, rather than an older v1 example, is authoritative for API behavior. Reproduce with `npm ci --ignore-scripts`, then inspect these files under `node_modules/@convex-dev/auth/src/`:

| Source | Relevant observed behavior |
| --- | --- |
| `methods/email-password/server.ts` | Built-in reset uses a 10-minute custom challenge, validates the new password, consumes proof, sets the password, revokes existing sessions and then signs in. Its public start method deliberately returns `EMAIL_NOT_FOUND`; hiding that in React alone would not prevent enumeration. |
| `components/email/challenge/common.ts`, `lib/crypto.ts` | Separate 256-bit random email code and browser secret; component stores SHA-256 hashes and expiry. |
| `components/email/challenge/custom.ts` | `start` accepts purpose, expected user and bounded TTL; `complete` consumes proof and returns the current verified-address owner. With a null expected user it does not itself establish a stable account binding. |
| `components/email/challenge/addEmail.ts` | Enrollment start is explicitly privileged; supplying an unverified client-selected user ID would attach a mailbox to another user's account. |
| `component/public.ts`, `server/userId.ts` | `listSessions`/`revokeSessions` are privileged component calls; revocation removes sessions and refresh tokens. `getAuthUserId` checks the live session, so an unexpired access token alone cannot continue authorizing after revocation. |
| `lib/types.ts`, `server/setup.ts` | `revokeAllSessions` is an internal method-context helper with no ownership check; it must follow proof. Custom `bindMethod` is also internal. Do not pretend either is a stable public application method. |

No new runtime code is supplied here and no internal upstream API is newly exposed.

## Decision and alternatives

Recommend **opt-in verified-email recovery**, using the pinned official email challenge and password/core component primitives behind a small reviewed GuildZero server adapter. Keep existing sign-in semantics during enrollment. Do not switch every existing account to the stock verified-email signup recipe, silently link accounts by normalized email, or export its enumerating recovery-start endpoint unchanged.

A zero-recurring-provider-cost configuration is feasible only while an operator-approved Resend Free account, an already-controlled sender domain and sufficient free quota are available. Provider outages/quota exhaustion must leave existing login working and recovery unavailable; never auto-upgrade, purchase a domain, change DNS or send on behalf of the user without the setup authorization recorded below. No guaranteed zero-cost public delivery is established today.

An offline recovery-code option avoids email dependency but creates a second custom credential lifecycle. A future alternative would enroll random 256-bit single-use codes only after password reauthentication, display each once, store only hashes, allow authenticated rotation and revoke all codes/sessions after use. Losing both password and codes still means no recovery. This option is **not selected or implemented**: it requires separate usability, secure-storage and review work, and must not become a backdoor for accounts that never enrolled it. OAuth or a support-agent identity override would change the current account model and is outside this issue.

## Enrollment and identity preservation

1. An authenticated owner chooses recovery enrollment and re-enters the **current password**. Derive the user ID from the live session. A stolen session, typed email or browser-supplied user ID is insufficient. Verify through the existing rate-limited adapter, including the existing legacy/NFKC path; if legacy migration cannot complete, enrollment fails without writing a binding.
2. Create a server-only reauthentication grant bound to that user, current session, purpose `recovery-enrollment`, credential/enrollment revision and a maximum five-minute lifetime. Consume it once to begin enrollment. Completing an unrelated login must not redeem it.
3. Only then invoke the email component's privileged add-address start with the derived user ID, a fixed configured HTTPS callback origin, and a 10-minute app grant. The component's enrollment TTL may be longer; enforce the shorter app deadline at completion. No public endpoint accepts the target user ID. Complete must verify the same live session/user, both secrets, unconsumed grant and unchanged revision before recording eligibility.
4. Preserve the verified address's exact stored spelling for delivery; do not invent Gmail-style dot/plus aliases. A collision is a private enrollment error, never an account merge. The component's verified-address relation and an app enrollment record bind the existing `users._id`; changing a login email is a separate scope.
5. Every password-changing path, including the current adapter’s legacy credential upgrade, future authenticated password changes and recovery, plus recovery-address change/removal or explicit enrollment rotation, increments the credential/enrollment revision and invalidates pending grants and recovery flows. Require fresh current-password proof before adding/replacing a recovery address. Notify the prior verified address of a change after commit; notification alone never authorizes the change.

Existing locked-out accounts that never enrolled have **no safe recovery proof**. Retain the limitation; do not send a reset to `users.email`, reconstruct access from mission titles/transaction receipts, let an operator reassign private resources, or reset on an unverified support request.

## Proposed recovery protocol

These are proposed application interfaces, not functions currently exported by GuildZero.

| Interface | Authorization and result |
| --- | --- |
| `startRecovery({email})` mutation | Public but bounded/throttled. Return the same generic status, opaque flow ID and same-shaped random browser secret for eligible, unknown, unenrolled and suppressed requests. No `sentTo`, account ID, enrollment status or `EMAIL_NOT_FOUND` response. |
| `checkRecovery({flowId,emailCode,browserSecret})` query | No account lookup information without both unguessable proof parts. Optional convenience only; success is not permission to reset later. |
| `completeRecovery({flowId,emailCode,browserSecret,newPassword})` mutation | Prove exact flow/account/purpose/revision, atomically consume proof, replace credential, revoke sessions and audit. Return no session tokens; require ordinary sign-in with the new password. |

Use purpose `guildzero/account-recovery/v1` and a maximum 10-minute expiry. The server flow record binds the component challenge ID, expected existing user ID, verified-address identity, creation/expiry and credential/enrollment revision. Completion must compare the component's current `emailOwnerId` with this expected user and reject removed/reassigned addresses or changed revisions. The client never chooses the target account at completion. Accept no callback URL, domain, purpose, TTL, credential policy or target user ID from a client.

Implementation uses ordinary app mutations calling the pinned component APIs through `ctx.runMutation`/`ctx.runQuery`: verified-address lookup, custom challenge start/complete, the existing privileged password setter with minimum 10, then core `listSessions({userId})` and `revokeSessions({sessionIds})`. The listed session IDs are server-derived. This matches the internal helper's component sequence without invoking unstable `bindMethod` or exporting raw privileged APIs. Component calls are server-to-server references, not client-accessible app functions. Resend network delivery is scheduled by the email component; do not put arbitrary network requests inside app mutations.

For unknown/unenrolled addresses, return indistinguishable synthetic flow material with the same size/shape; it can never authorize completion. Keep enrollment/lookup outcomes and provider errors server-side. Add a bounded response-timing policy and differential tests rather than claiming identical latency by inspection. Do not send dummy messages to arbitrary unknown addresses. This only defines recovery-specific enumeration resistance: current signup/sign-in can already reveal registration through `EMAIL_ALREADY_REGISTERED` and differing errors. Before a production-wide anti-enumeration claim, normalize and test those existing endpoints too; this docs-only PR does not change them. Independently rate-limit all public starts so missing accounts cannot bypass limits, and use bounded cleanup for abandoned flow metadata.

Validate the new password before consuming proof. In one Convex transaction, recheck enrollment/revision/expiry; consume the one-shot component challenge and app flow; set the new Auth 2 password; mark `authVersion: 2` and clear `authPasswordNfkc`; increment credential revision; invalidate all other pending recovery/enrollment grants; revoke every prior Auth 2 session/refresh family; and append a secret-free event. Any failed credential write, stale binding or revocation failure must throw so consumption and password changes roll back. A later failure to deliver a notification must not roll back a completed reset: queue a bounded notification in the transaction and report delivery separately. A password changed in a competing sign-in/reset transaction must invalidate the losing flow. Do not delete legacy tables or re-enable old v1 token validation. Preserve all owner IDs, private records, allowances, receipts and uncertain-payment locks.

`listSessions` is capped indirectly by the pinned core's 100-session-per-user admission bound. Its implementation skips sessions missing issued refresh-token metadata. Require corruption/legacy-session tests and fail closed on detected inconsistency; do not claim that an ad hoc raw-table cleanup across component boundaries is supported. A future dependency upgrade must revalidate this assumption. Existing `getAuthUserId` live-session checks remain mandatory on every marketplace endpoint, including immediately after reset; JWT signature/expiry validation alone is insufficient.

## Limits, secrets and user experience

Proposed app limits, to be tuned only with measured evidence: start at most 5 per normalized destination/hour and 20 per trusted request IP/hour, plus a global queue ceiling below the approved email quota; completion at most 5 failed proofs per flow and 20/IP/hour. Transport is a direct public Convex client mutation, not a scheduled task or an arbitrary Next.js proxy. The pinned Convex 1.50.0 `src/server/registration.ts` exposes mutation `ctx.meta`; `src/server/impl/meta_impl.ts` implements `getRequestMetadata`. The pinned Auth 2 email `components/email/helpers.ts:getClientIp` itself uses `ctx.meta.getRequestMetadata().ip` and rejects null metadata. Use that server-provided request metadata for app IP quotas, never forwarded client arguments as an IP override. Prove preservation through nested component calls with a real anonymous browser mutation on the target deployment before enablement; unit-test mocks do not establish platform metadata. Cron/scheduled starts are unsupported. No undocumented proxy/IP-header trust boundary is assumed. App global, destination and flow quotas are mandatory independent counters; evaluate them even when IP metadata is unavailable, rather than letting the IP check replace or bypass them. If trustworthy metadata or provider configuration is unavailable, fail closed with the same generic start response. Rate-limit hits must not roll back limiter counters. Avoid permanent victim-account locks from unauthenticated abuse; throttling a flow never disables ordinary sign-in.

Bound email to 254 characters and proof/flow fields to their exact token grammar before expensive operations; password input is bounded before normalization/hash. Match the existing 10–100 NFC policy and common-password/whitespace checks, with confirmation as a browser-only typing check. Apply server validation independently. Invalid new passwords may be retried within the original TTL without consuming a valid link.

Keep the browser secret only in a purpose-specific, TTL-limited sessionStorage entry for the starting tab (never in URLs, analytics, a bundle constant or a service worker). This is authentication flow state, not an autosave location for CSVs. Clear it on completion/expiry/cancel; loss requires a new flow. The email URL has only the email code and a fixed origin. Serve the reset route without third-party analytics/resources; use no-referrer policy and remove code parameters from the address bar before subsequent navigation. Redact request/URL/body secrets in proxy, application and provider logs. Screenshots, traces and videos remain disabled during credential/proof tests; use synthetic mailboxes and do not print tokens or passwords.

Show: “If this address is eligible, instructions will be sent. Open the link in the browser where you started.” Invalid/expired/consumed/wrong-browser proofs get one generic restart message. Never automatically log in after reset or reveal another user's email. A completion notice instructs ordinary sign-in and says other sessions were signed out. Sending a notification does not prove the message arrived. Audit only event kind, opaque internal user/flow IDs where established, timestamp and finite reason codes; no raw email, browser secret, code, password or dataset. Provider data includes only the necessary verified destination and security message, never mission or payment contents.

## Threat and acceptance matrix

All rows below are **required future executable checks**, not passing test claims in this PR.

| Threat / scenario | Required evidence |
| --- | --- |
| Unknown vs unverified vs enrolled address | Direct public API responses/status/shape do not disclose existence; timing sampling and throttle behavior bounded; no email sent for ineligible input. |
| Stolen session enrolling an attacker mailbox | No enrollment without current-password proof; wrong/replayed/expired/session-substituted grant writes nothing. |
| Browser-supplied target user/address override | Enrollment ID derived from live session; reset owner comes only from bound proof; all cross-owner cases denied. |
| Mailbox transfer/removal or password change during flow | Old proof cannot reset a newly assigned account or overwrite a newer credential. |
| Code only, secret only, wrong tab, altered purpose/origin | Rejected without password or session changes; recovery proof cannot enroll email or authorize a payment. |
| Replay, simultaneous completion, multiple pending links | Exactly one commit; used/stale flows fail; no duplicate session or audit success. |
| Expiry boundary and client-clock manipulation | Server time is authoritative; exactly expired links fail; cleanup timing cannot extend validity. |
| Invalid/too common/whitespace/Unicode password | Backend policy applies; no proof consumption on pre-validation failure; new NFC password signs in; old NFKC fallback cannot revive it. |
| Failed setter/revocation/transaction rollback | Old password/session state preserved; no partial reset or burned proof; notification not falsely reported as delivery. |
| Existing sessions and rotating refresh families | All previous sessions lose query/mutation access immediately, including unexpired JWTs; every old refresh token fails; concurrent login/refresh cannot escape revocation. |
| Legacy adapter and accounts without enrollment | No user-ID/resource rewrite; old passwords cannot remigrate over reset; never-enrolled locked accounts remain unrecoverable. |
| Session metadata corruption or excessive history | Fail closed/operator investigation; never silently leave a known old session active while declaring reset complete. |
| Provider outage, quota, missing metadata/config | Existing login remains usable; no fallback to unverified email or paid delivery; no secrets in errors. |
| Abuse and enumeration through any exported endpoint | Direct endpoint inventory test confirms raw recipe/lookup/privileged APIs are not app exports; attempts consume correct independent limits. |
| Ownership/financial invariants after recovery | Same user owns missions/allowances; no receipt, intent, nonce or signer-lock reset; recovery does not authorize settlement. |
| Real local browser and real approved mailbox | Same-tab success, wrong-tab failure, refresh/expiry, keyboard/mobile feedback, no secret-bearing artifacts; provider delivery evidence separately recorded. |

Use `convex-test` with fake clocks and transaction races for backend evidence; real local Auth 2 browser tests for live sessions and ownership; an approved mailbox only for delivery validation. Mock transport tests must not be called delivered mail or production readiness.

## Implementation sequence and gates

1. Review this design, the custom adapter surface and the test matrix. Record account-owner enrollment semantics and independent security review; keep runtime disclosure unchanged.
2. Obtain operator selection/approval for the sender account, existing domain/DNS changes, fixed site origin and free-tier ceiling. No payment method, automatic paid upgrade or production credentials are implied. If no suitable zero-cost sender exists, retain the limitation and revisit the offline-code alternative separately.
3. Implement the small adapter, grants/revisions and masked endpoints behind a disabled server feature flag; pin/review the required Resend component version, update root lockfile deliberately, and deploy only to an isolated test backend without copying existing secrets. Do not export the stock enumerating start method or internal privilege bypasses.
4. Implement and pass every relevant matrix case plus existing lint/typecheck/unit/integration/build/client checks. Run provider delivery and session-revocation/legacy tests before any real-owner enrollment. Set feature flag false on incomplete evidence.
5. Roll out optional enrollment while users still know their password. Tell already-locked users that no proof was enrolled; do not silently bootstrap recovery from their stored login email. Independently verify correct original user IDs before enabling recovery for a cohort.
6. Enable recovery only after review and approved delivery evidence. Rollback disables enrollment/start/complete together, invalidates pending proofs and preserves successfully reset passwords/session revocations and financial history. A code rollback must not restore a pre-reset password or old auth runtime.

Review approval, provider/domain configuration, runtime implementation and real delivery evidence are not supplied by this documentation PR. #24 remains open until its applicable approval/acceptance gates are recorded.

## Design review and actual validation

The parent and the independent #33 contributor reviewed this design. Follow-ups resolved in the text: remove stale reports terminology; identify the pinned mutation metadata API and direct-client transport instead of assuming anonymous IP availability; require target-deployment metadata evidence; explicitly include all password-changing paths in revision invalidation. This is review of a proposal, not independent review or acceptance of runtime recovery code.

Actual validation for this PR: pinned dependency installation succeeded with zero reported vulnerabilities; the listed local source/API references were inspected; current primary pages were opened; repository-relative Markdown link checks and `git diff --check` passed. Runtime tests, provider delivery and authentication recovery are not run or claimed because no executable reset flow changes.
