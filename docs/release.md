# Combination, release and demo checklist

## Branches

The branches are intentionally stacked:

1. `feat/cluster-2-orchestration` — persisted marketplace lifecycle, reservations, private reads, subcontract/revision/dispute guards.
2. `feat/cluster-3-security-near` — based on orchestration; exact owner-authorized testnet payment intents, protected signer, receipt verification/reconciliation and security audits.
3. `feat/cluster-4-experience-release` — based on security/NEAR; graph, agent profiles, payment/security UX, safe samples, tests and release preparation.

Review changes against each branch's immediate predecessor. You can create a combination branch from `origin/feat/cluster-4-experience-release` and merge the teammate's actual engine branch there. No force-push, destructive reset or merge into main is required by this document. The engine package remains owned by the teammate; its integration contract is in `worker-integration.md` and the provided handoff archive.

## What is actually demonstrated

Real local auth; private mission CRUD; idempotent opening/canceling of an auction; immutable briefs; persisted events; graph nodes/edges only for recorded relationships; private agent contract history; backend controlled probes; and sample reset preserving active work/payment records were exercised. Tests cover financial guards, one revision, subcontract dependencies, owner disputes, locks, receipt binding, success/timeout adapter behavior and privacy. Offline verifier/RPC fixtures are not on-chain or data-processing evidence.

Still required: teammate engine integration, scheduled independent bids/negotiation, actual computed deliverable and independent checks, executed meaningful subcontract, a funded owner-authorized testnet transfer with final evidence, and hosted app validation. Do not describe these as completed until observed.

## Cloud deployment (owner configuration needed)

Use only eligible free plans; do not enable paid services or metered upgrades. The owner must supply their own cloud account configuration. There is no cloud Convex deployment key or hosting credential in this checkout, and no unfinished site has been published.

1. Combine/test the feature branches and engine. Keep Node 24.22.3 as the supported local/CI runtime; `convex.json` selects Node 24 for backend actions.
2. Configure a free Convex project using `npm run dev:backend` and the login flow. Configure Convex Auth keys once on that cloud backend using the supplied helper; keep them separate from local auth. Password-only demo auth has no email verification/recovery.
3. Use an eligible free Next.js host. The official Convex/Vercel guide documents the build command `npx convex deploy --cmd 'npm run build'`. Store a properly scoped production `CONVEX_DEPLOY_KEY` only in the host's server-side build environment, never a public variable. Make sure `NEXT_PUBLIC_CONVEX_URL` points to the cloud production deployment, not `127.0.0.1`; configure the cloud HTTP URL as needed. Preserve backend-only keys in Convex.
4. Initially keep `NEAR_SETTLEMENT_ENABLED=false`. Import dedicated testnet credentials/recipient mappings only into the backend, following `settlement.md`, then enable intentionally after reviewing the account and amount cap. Do not copy authentication or payment keys into frontend hosting's public settings.
5. Test the hosted URL from a second machine with all local processes stopped: two-account privacy, actual auction/service workflow, verification/dispute, safe sample reset, graph subscriptions, payment authorization and confirmed explorer receipt. Record the actual URL and receipt only after verification.
6. Keep the demo reachable for judging. Do not claim hosted acceptance from a local screenshot or a successful local build.

Official deployment reference: https://docs.convex.dev/production/hosting/vercel . A full cloud deploy was not run here because account configuration and the integrated engine are absent.

## Demo walkthrough after combination

1. Sign up as a buyer. Add synthetic samples or your own bounded CSV; explicitly label synthetic data.
2. Open a mission with exact template columns/options. Show recorded independent bids and the stored selection scores/negotiation explanation after the engine is integrated.
3. Execute a real normalization/statistics job. Download the real result and show independent checks. Demonstrate that a child's output contributes to the parent's actual input.
4. Show buyer-only dispute resolution and a failed output path; do not present deterministic services as LLM intelligence.
5. Prepare the exact configured recipient/amount. Confirm as the owner. Show pending/unknown state truthfully; a hash alone is not confirmation. Open a matching final testnet receipt only after chain verification.
6. Run controlled over-budget, recipient, duplicate, reputation and subcontract probes in their real prerequisite states. Show the recorded rule/rejection and no new signing. Keep these probes visibly separate from real payment events.
7. Show the owner-private economy graph updating from stored events and another buyer's isolated workspace. Reset only unused sample drafts; do not erase receipts or cause repayouts.

## Track evidence

| Intended track | Required working evidence before claiming completion |
|---|---|
| AI Swarms (`swarms`) | Independent bids/negotiation plus one meaningful, bounded subcontract; integration pending |
| Agent Economy (`agents`) | Real services bought/sold and one confirmed authorized NEAR testnet payment; live acceptance pending |
| Autonomous Business (`business`) | Explainable cost/bid/contract decisions and deterministic work fulfillment; engine integration pending |
| AI Security & Defense (`security`) | Backend authorization, substitution/duplicate/budget guards, durable rejection evidence and reconciliation; code/tests/probes implemented, full payment-linked demo pending |

## Human-owned submission prerequisites

Checked against the [live organizer instructions](https://nearhackathon.com/HACKATHON.md) on 2026-11-12; recheck before submitting. The stated development/submission deadline is **2026-11-14 23:59 UTC** (2026-11-15 05:29 IST). Required public demo-post tags are `@NEARProtocol` and `#NEARHackathon`. The human publishes the post and approves the exact final submission payload; no post or submission was sent here.

Before submission, verify the public repository and chosen license, working demo/video, actual four-track evidence, team/contact information, demo-post link, organizer consent and team-provided prize payout address. The organizer's prize address is submission metadata only; this application implements no mainnet payments, wallet provisioning or prize custody. Do not invent personal data, addresses, consent or proof of execution. Disclose other independent projects if the organizer's rules require it.

Use one submission per project and obtain explicit human confirmation before sending it. No public posting, repository visibility change, licensing decision or submission is authorized by a feature-branch push. The manual GitHub validation workflow is optional and has not been run remotely in this session.
