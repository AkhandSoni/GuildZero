# Issue #33 — recovery of proven pre-broadcast failures

Status: security design and executable specification for review; no production recovery endpoint, rearm, transfer, migration or delivery change is implemented. The issue remains open. The owner authorized further work; this stage respects the issue's separate security-review requirement.

1. Inspect actual action, mutation, signer-lock, approval and failure paths; identify missing durable proof and unsafe legacy inference.
2. Define versioned immutable attempts, proof-producing transitions, callback fencing, exact owner confirmation, allowance accounting and conservative cutover.
3. Exercise the proposed transition model against stale callbacks, concurrent recovery, altered approval/configuration, all ambiguous transaction stages and legacy records. This is a protocol specification, not deployed enforcement or process-crash proof.
4. Obtain independent review and resolve findings. Deliver a separate PR with the protocol, implementation checklist and exact checks. Leave runtime recovery unavailable until the implementation and process-level security gates pass.

See [payment-recovery.md](payment-recovery.md) for the concrete schema, state machine, trust boundaries and acceptance matrix.

Actual validation: all 219 tests in 26 files passed, including five new abstract protocol tests; separate backend integration run passed 99 included tests. Lint, typecheck and diff checks passed. No production code changed, so no build, browser, SDK-signing, process-crash or chain check is claimed for this design PR. Separate design review findings were resolved in the protocol; production implementation review remains a gate.
