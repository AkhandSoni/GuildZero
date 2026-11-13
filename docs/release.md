# Combination, release and demo checklist

## Integrated local prototype

PRs #14 and #15 combined the engine and application branches. The scheduled driver now runs actual independent offers, bounded negotiation, scored awards, real services, independent verification, useful subcontracting and owner review. Broader service expansion is paused. The user authorized finishing current-scope validation and pushing verified changes to main.

Production-browser validation has exercised real local auth, private mission CRUD, automatic custom CSV fulfillment and downloads, subjective review, invalid-input rejection, unaffordable auctions, graph/security/sample behavior and mobile layout. Backend tests cover lifecycle bounds, stale scheduling, revisions, capacity, budget conservation, reputation and payment integrity. Exact final results are in CLUSTER_STATUS.md.

A real custom summary consumed an approved cleaning subcontract. The owner separately authorized both allocations through the production UI. Both public-testnet transfers finalized and were independently rechecked; their sum equals the original award. See settlement.md for the exact public receipts. Real security probes rejected altered amounts, recipient substitution, duplicate payout, reputation manipulation and excessive subcontract depth without signing.

Public hosting, the final demo recording and submission remain pending. Local acceptance does not establish that a hosted application works independently of this machine.

## Cloud deployment (owner configuration needed)

Use only eligible free plans; do not enable paid services or metered upgrades. The owner must supply their own cloud account configuration. There is no cloud Convex deployment key or hosting credential in this checkout, and no unfinished site has been published.

1. Combine/test the feature branches and engine. Keep Node 24.22.3 as the supported local/CI runtime; `convex.json` selects Node 24 for backend actions.
2. Configure a free Convex project using `npm run dev:backend` and the login flow. Convex Auth 2 uses deployment-managed signing; no manual auth-key generation is needed. Password-only demo auth has no email verification/recovery.
3. Use an eligible free Next.js host. The official Convex/Vercel guide documents the build command `npx convex deploy --cmd 'npm run build'`. Store a properly scoped production `CONVEX_DEPLOY_KEY` only in the host's server-side build environment, never a public variable. Make sure `NEXT_PUBLIC_CONVEX_URL` points to the cloud production deployment, not `127.0.0.1`; configure the cloud HTTP URL as needed. Preserve backend-only keys in Convex.
4. Initially keep `NEAR_SETTLEMENT_ENABLED=false`. Import dedicated testnet credentials/recipient mappings only into the backend, following `settlement.md`, then enable intentionally after reviewing the account and amount cap. Do not copy authentication or payment keys into frontend hosting's public settings.
5. Test the hosted URL from a second machine with all local processes stopped: two-account privacy, actual auction/service workflow, verification/dispute, safe sample reset, graph subscriptions, payment authorization and confirmed explorer receipt. Record the actual URL and receipt only after verification.
6. Keep the demo reachable for judging. Do not claim hosted acceptance from a local screenshot or a successful local build.

Official deployment reference: https://docs.convex.dev/production/hosting/vercel . A full cloud deploy was not run here because cloud account configuration and explicit publication approval remain pending.

## Demo walkthrough after combination

1. Sign up as a buyer. Add synthetic samples or your own bounded CSV; explicitly label synthetic data.
2. Open a mission with exact template columns/options. Show recorded independent bids and the stored selection scores/negotiation explanation from the integrated workflow.
3. Execute a real normalization/statistics job. Download the real result and show independent checks. Demonstrate that a child's output contributes to the parent's actual input.
4. Show buyer-only dispute resolution and a failed output path; do not present deterministic services as LLM intelligence.
5. Prepare the exact configured recipient/amount. Confirm as the owner. Show pending/unknown state truthfully; a hash alone is not confirmation. Open a matching final testnet receipt only after chain verification.
6. Run controlled over-budget, recipient, duplicate, reputation and subcontract probes in their real prerequisite states. Show the recorded rule/rejection and no new signing. Keep these probes visibly separate from real payment events.
7. Show the owner-private economy graph updating from stored events and another buyer's isolated workspace. Reset only unused sample drafts; do not erase receipts or cause repayouts.

## Track evidence

| Intended track | Required working evidence before claiming completion |
|---|---|
| AI Swarms (`swarms`) | Demonstrated locally: independent bids/negotiation and one useful bounded subcontract |
| Agent Economy (`agents`) | Demonstrated locally: real services and two separately authorized final parent/child testnet transfers |
| Autonomous Business (`business`) | Demonstrated locally: computed independent offers, scored awards and deterministic fulfillment |
| AI Security & Defense (`security`) | Backend authorization, substitution/duplicate/budget guards, durable rejection evidence and reconciliation; code/tests and actual payment-linked probes demonstrated locally |

## Human-owned submission prerequisites

Checked against the [live organizer instructions](https://nearhackathon.com/HACKATHON.md) on 2026-11-12; recheck before submitting. The stated development/submission deadline is **2026-11-14 23:59 UTC** (2026-11-15 05:29 IST). Required public demo-post tags are `@NEARProtocol` and `#NEARHackathon`. The human publishes the post and approves the exact final submission payload; no post or submission was sent here.

Before submission, verify the public repository and chosen license, working demo/video, actual four-track evidence, team/contact information, demo-post link, organizer consent and team-provided prize payout address. The organizer's prize address is submission metadata only; this application implements no mainnet payments, wallet provisioning or prize custody. Do not invent personal data, addresses, consent or proof of execution. Disclose other independent projects if the organizer's rules require it.

Use one submission per project and obtain explicit human confirmation before sending it. No public posting, repository visibility change, licensing decision or submission is authorized by a feature-branch push. The manual GitHub validation workflow is optional and has not been run remotely in this session.
