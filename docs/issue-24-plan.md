# Issue #24 implementation plan

1. Inspect current Auth 2 adapter, owner/session checks, legacy migration, pinned upstream source and current primary documentation.
2. Define verified enrollment and reset protocols that preserve existing owner IDs, reject unverified login-email recovery and bind expiring single-use proofs to the account/revision/purpose.
3. Compare a zero-recurring-provider-cost email setup with pre-enrolled offline codes; identify concrete provider/domain approval and dependency/API limits without configuring external services.
4. Specify enumeration resistance, throttling, password policy, atomic session/refresh revocation, failure handling, migration and security/browser acceptance cases.
5. Link the reviewed design from setup/status/decisions, preserve runtime no-recovery disclosure, run documentation/reference/diff checks, and open a separate PR. No runtime reset, email sending, user-ID migration or secret/provider setup is part of this issue-design change.

Design: [account-recovery-design.md](account-recovery-design.md). Runtime implementation and real provider evidence remain explicit follow-ups. The parent requested two additional issues; #33 is the independent payment-recovery work, not account recovery.
