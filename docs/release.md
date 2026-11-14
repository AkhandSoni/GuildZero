# Combination, release and demo checklist

## Integrated local prototype

PRs #14 and #15 combined the engine and application branches. The scheduled driver now runs actual independent offers, bounded negotiation, scored awards, real services, independent verification, useful subcontracting and owner review. The approved business-data expansion is integrated: normalization, summary statistics, quality audits, keyed reconciliation and grouped numeric reports. The user authorized finishing current-scope validation and pushing verified changes to main.

Production-browser validation has exercised real local auth, private mission CRUD, automatic custom CSV fulfillment and downloads, subjective review, invalid-input rejection, unaffordable auctions, graph/security/sample behavior and mobile layout. Backend tests cover lifecycle bounds, stale scheduling, revisions, capacity, budget conservation, reputation and payment integrity. Exact final results are in CLUSTER_STATUS.md.

A real custom summary consumed an approved cleaning subcontract. The owner separately authorized both allocations through the production UI. Both public-testnet transfers finalized and were independently rechecked; their sum equals the original award. See settlement.md for the exact public receipts. Real security probes rejected altered amounts, recipient substitution, duplicate payout, reputation manipulation and excessive subcontract depth without signing.

A 73.24-second local production-browser demo is recorded with separately rechecked parent/child public-testnet receipts; see [demo evidence](evidence/demo-2026-11-14.json). The owner must review and publish the video/post. Public hosting and submission remain pending. Local acceptance does not establish that a hosted application works independently of this machine.

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
3. Execute a real summary with **Clean before analysis**. Show the parent/child verification checks and bounded metadata preview. Full computed tables, raw output and downloads must still be locked. Show the recorded dependency on the approved cleaning deliverable; approval alone is not payment.
4. Show buyer-only dispute resolution and a failed output path; do not present deterministic services as LLM intelligence.
5. Prepare each exact configured recipient/amount and authorize parent and child separately as the owner. Show pending/unknown state truthfully; a hash alone is not confirmation. Show that paying only one allocation leaves the full result locked. After both matching FINAL receipts, display the computed summary and download its CSV/JSON. Parent payable plus child price must equal the awarded total. Never reset an old failed/uncertain intent to rehearse the demo.
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

Checked against the [live organizer instructions](https://nearhackathon.com/HACKATHON.md) on 2026-11-14; recheck before submitting. The stated development/submission deadline is **2026-11-14 23:59 UTC** (2026-11-15 05:29 IST). Required public demo-post tags are `@NEARProtocol` and `#NEARHackathon`. The human publishes the post and approves the exact final submission payload; no post or submission was sent here.

Before submission, verify the public repository and chosen license, working demo/video, actual four-track evidence, team/contact information, demo-post link, organizer consent and team-provided prize payout address. The organizer's prize address is submission metadata only; this application implements no mainnet payments, wallet provisioning or prize custody. Do not invent personal data, addresses, consent or proof of execution. Disclose other independent projects if the organizer's rules require it.

Use one submission per project and obtain explicit human confirmation before sending it. No public posting, repository visibility change, licensing decision or submission is authorized by a feature-branch push. The manual GitHub validation workflow is optional and has not been run remotely in this session.

## Local-only submission path

The organizer explicitly accepts a public repository, reproducible local README and an X post with a video when there is no hosted demo (Q-012). Screenshots alone are insufficient for that path. Hosting is optional for eligibility; it remains a separate unverified product release requirement. The account owner must choose the license and publish the post. Do not create a prize wallet or submit guessed contact details.

Record only synthetic or explicitly approved data. Authenticate before starting any video capture; disable traces and avoid credential forms, storage state files, environment panels and backend configuration. Review the full recording for accidental disclosure before publishing. A screen recording documents the actual visible run; historical receipts must be labeled historical rather than portrayed as a newly sent transaction.

The final API accepts exactly requestId, projectName, leadName, email, size, tracks, nearAddress, projectUrl, demoUrl, idea and consent. Keep personal submission metadata outside Git. Use the same requestId for a permitted network-error retry, never submit twice, and require owner approval of the complete exact payload. See the live organizer contract for constraints and response handling. Team/contact details, size, license, public demo-post URL, team-provided mainnet prize address, other-project disclosure and consent remain owner inputs. No application mainnet integration is needed or authorized.

For second-developer reproduction, record the source commit, OS/Node runtime, own backend setup, synthetic mission ID, verification outcome, exact payment receipt(s) if configured, and any deviations. A repeat run by the implementation agent is not independent reproduction. For intended-user task validation, use [the session protocol](user-validation.md); do not turn automated browser tests into customer research claims.

## Demo-focused handoff — 2026-11-14

The owner explicitly restricted remaining work to the hackathon demo and deferred account recovery. Local setup, real runtime settlement evidence and the recorded flow are the current checkpoint. Formal second-person reproduction, cloud deployment, representative-user sessions and production recovery/stewardship remain post-demo follow-ups, not prerequisites invented for opening the local app. No completed customer research or hosted acceptance is claimed.

Suggested pitch: GuildZero turns bounded sales and operations CSV work into a transparent agent marketplace. Fixed-strategy agents compete, negotiate and sometimes hire one cleaning subcontractor. The selected agents perform real transformations; independent checks verify the output. The buyer reviews the work and authorizes exact custodial NEAR testnet payments. Matching final receipts unlock the result. Convex coordinates private jobs and auditable state; agents make their own deterministic economic decisions. Five CSV services are implemented, with no LLM, mainnet or paid infrastructure.

Draft post for the owner to review and publish: “Built at NEAR HACKATHON: GuildZero lets independent algorithm-driven agents bid, negotiate and subcontract real CSV work. Verified output unlocks after owner-authorized NEAR testnet payments. The demo shows a complete run and a blocked unauthorized reputation write. @NEARProtocol #NEARHackathon” Attach the reviewed recording and actual repository/demo links; do not publish an unreviewed draft or invent an accessible video URL.
