# User workflow requirements — 2026-11-13

This is a desk-research and repository-audit requirements pass, requested by the owner. No interviews, survey, conversion measurements or usability study were conducted. The owner explicitly selected business users processing sales or operations CSVs. The initial persona is a business/operations user with a small CSV export who wants trustworthy processing without coding. An analyst repeating that workflow is the secondary persona. The persona choice is owner-confirmed; the detailed needs remain hypotheses to validate with actual users, not measured market demand.

## Evidence and inferred needs

- The owner's observed upload request establishes a direct need to bring an existing file into a mission. [GOV.UK file-upload guidance](https://design-system.service.gov.uk/components/file-upload/) supports a labelled native chooser, specific errors and reuse of previously supplied data. Import must retain paste/sample alternatives and explain when information is saved.
- [OpenRefine's import workflow](https://openrefine.org/docs/manual/starting) offers input preview and interpretation before processing, while preserving the original source. Inference for GuildZero: show the parsed rows/columns and problems before committing a brief; do not silently convert spreadsheets or guess data transformations.
- [GOV.UK check-answers guidance](https://design-system.service.gov.uk/patterns/check-answers/) supports reviewing a brief before the consequential step. The existing saved draft already provides this checkpoint; improve its plain-language description rather than add another mandatory wizard.
- [GOV.UK error-summary guidance](https://design-system.service.gov.uk/components/error-summary/) supports actionable errors linked to the affected input. [Nielsen Norman Group's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) support visible status, recovery and reducing repeated effort. Inference: preserve valid input on import failure, explain actual lifecycle states, help users find and reuse work.
- [OpenRefine export documentation](https://openrefine.org/docs/manual/exporting) demonstrates that computed data must be usable outside the application. Inference: a readable results table and spreadsheet-compatible summary export should complement the existing raw JSON download.

## Journeys and acceptance criteria

| ID / priority | User need and repository gap | Acceptance criteria for this pass |
|---|---|---|
| U1 / Must | Bring an existing CSV; currently paste/sample only | Choose one UTF-8 `.csv`, maximum 64 KiB; validate actual bytes and bounded CSV; show filename/status or a specific error; never replace a valid editor value on failed import; retain paste/sample; save through existing owner-private mission API. |
| U2 / Must | Know what was imported and which columns work | Show actual row/column/byte counts, first five rows and per-column missing/numeric/invalid counts; identify rows with invalid summary values; explicitly select suggested numeric columns; never silently alter source or selections. |
| U3 / Must | Understand service and budget before starting | Explain normalization versus summary, show saved selected columns and review mode before auction; distinguish budget cap, recorded contract allocation and confirmed testnet payment; show next step based on stored job state. |
| U4 / Should | Find previous work without paging through everything | Owner-scoped server-side title keyword/prefix search and service/draft/started filters; pagination still works; no other owner's matching title appears; clear no-match state and reset controls. |
| U5 / Should | Repeat a task or recover from a failed auction | Copy an owned mission into a new private draft; preserve CSV/options/budget/criteria, reset deadline, do not copy jobs/contracts/payment authorizations/receipts; deny copying someone else's ID. |
| U6 / Must | Understand and use the output | Render stored numerical summaries as a readable table and normalized data as a bounded preview; retain raw evidence/JSON; offer safe summary CSV; label attempts and keep verification separate from presentation. |
| U7 / Must | Notice work awaiting a human decision from the dashboard | Include persisted disputed/review jobs in the approval card; link directly to the mission, deduplicate parent/child mission entries, and distinguish work review from payment authorization. |

Must = blocks submitting correct input or understanding the result. Should = substantial repeat-use friction. Priorities are qualitative engineering judgments, not fabricated impact scores. Existing authentication, bidding, verification, cancellation, owner disputes, receipts and security probes remain the functional baseline rather than being rebuilt.

## Boundaries and validation

Keep Next.js, Convex and Convex Auth. Keep the current CSV services, size/row/column limits, deterministic agents, private ownership and explicit testnet payment confirmation. No arbitrary file execution, Excel/PDF parsing, uploads to third parties, public sharing, new paid service, browser persistence of unsaved private CSVs, automatic payment or hidden repricing. File content is read locally for preview and sent only when the user saves a mission.

Implement this bounded usability pass, then stop. Broader service categories, larger datasets, collaboration, email recovery/notifications and recurring execution need separate requirements and authorization; research does not itself justify adding them.

Validation must connect these IDs to unit, backend ownership/pagination/copy and real-browser import-to-result checks. Do not call hypotheses user-validated until representative users have attempted the workflow. A later usability session should ask users to import their own bounded export, identify an unsuitable column, run/review work, retrieve the result, find it again and reuse the brief, recording task completion and confusion without collecting their private datasets.

## GitHub traceability

- [U1: Import a sales or operations CSV without pasting its contents](https://github.com/AkhandSoni/GuildZero/issues/16) — current implementation pass.
- [U2: Preview datasets and identify unsuitable summary columns before starting](https://github.com/AkhandSoni/GuildZero/issues/17) — current implementation pass.
- [U3: Explain the saved brief and the next step at each real workflow state](https://github.com/AkhandSoni/GuildZero/issues/18) — current implementation pass.
- [U4: Find private missions by title, service and brief status](https://github.com/AkhandSoni/GuildZero/issues/19) — current implementation pass.
- [U5: Reuse a previous mission as a new private draft](https://github.com/AkhandSoni/GuildZero/issues/20) — current implementation pass.
- [U6: Read computed results and export summaries to a spreadsheet](https://github.com/AkhandSoni/GuildZero/issues/21) — current implementation pass.
- [U7: Surface work awaiting an owner decision on the dashboard](https://github.com/AkhandSoni/GuildZero/issues/22) — current implementation pass.
- [U8: Protect unsaved mission edits from accidental navigation](https://github.com/AkhandSoni/GuildZero/issues/23) — follow-up backlog.
- [U9: Define a safe account-recovery path before real business adoption](https://github.com/AkhandSoni/GuildZero/issues/24) — follow-up backlog.
- [U10: Validate business-user requirements with representative task sessions](https://github.com/AkhandSoni/GuildZero/issues/25) — follow-up backlog.

U8 records accidental loss of unsaved edits; no browser or in-app dirty-form warning is implemented yet. U9 records the existing no-recovery demo-account limitation; a safe recovery channel and configuration must be agreed before any implementation. U10 records the lack of representative-user validation; no interview results or adoption metrics are invented.

## Implementation evidence

- U1/U2: lib/dataset-preview.ts, components/mission-form.tsx and components/dataset-preview.tsx; UTF-8/BOM/size/format and numeric-quality unit tests; browser import-error preservation and import-to-result flow.
- U3/U7: saved-brief review, state-derived next steps and the dashboard owner-decision queue; browser workflow covers a real human-review result returning to that queue.
- U4/U5: owner-indexed search/filter queries and private draft duplication; backend tests exercise older titles, prefix search, combined filters, pagination, anonymous/cross-owner denial, expired deadlines and copying completed work without its execution/payment authority.
- U6: components/result-preview.tsx presents stored outputs; tests compare downloaded CSV against the actual numerical summary and reject unsafe export labels.

The browser regression also verifies that mission title, precise budget, dataset and selection survive import. Search/form field labels are distinct, and navigation tests wait for the intended route to avoid filling a previous page's field.

## Workspace and settlement usability follow-up

The owner supplied observed failures: choosing text columns for statistics, confusing accepted cleaning with failed parent work, a flat activity ledger, unclear navigation, and an invisible operator balance. This follow-up covers the current data-processing marketplace; the paused service-category expansion stays paused.

Additional desk research: [n8n's execution list](https://docs.n8n.io/workflows/executions/all-executions/) supports status filters, scoped history and inspecting failures; [Upwork's job proposals](https://support.upwork.com/hc/en-us/articles/211063268-Where-can-I-see-the-proposals-submitted-for-my-job) keeps offers and negotiation in a job context. Engineering inference: users need a persistent labeled application shell, separate mission and payment retrieval, stage-based progress, recovery instructions and evidence available on demand. These are design inputs, not claims that all competitor capabilities are present or that interviews occurred.

- #26: Name invalid numeric columns/CSV records, explain what cleaning does, retain original job input, and disable approval where no deliverable exists. Human rejection still requires an audit reason.
- #27: Show main-job progress and subcontract outcome separately; work acceptance is distinct from transaction confirmation. Keep original scoped event codes in an expandable audit view. Missing data in bounded views is not proof of no payment.
- #28: Provide labeled Dashboard, Missions, Economy, Payments, Agent directory and Security routes; useful main-job metrics, actual review/payment queues, working filters, outputs and links. No decorative buttons or invented live activity.
- #29: Show the shared testnet operator account, final block/time evidence, total and an exact available estimate excluding storage collateral and 0.01 NEAR gas reserve. Explain pending contracts are not deducted and mission budgets are not deposits. Authenticated, throttled refresh uses fixed testnet RPC only and never signs. Preserve successful stale readings on network errors; whitelist future pre-broadcast diagnostics, with no historical root-cause guesses or payment retries.

Account recovery, representative-user research and public release remain separate tracked gates. No data retention policy or recovery channel is invented to make the dashboard appear complete.

## Whole-application visual consistency (#30)

The owner observed that a workspace-only revision left the public home and account/form/detail pages looking like unrelated prototypes. The approved follow-up covers the entire existing app. [Linear's interface hierarchy](https://linear.app/now/behind-the-latest-design-refresh), [Geist foundations](https://vercel.com/geist/introduction) and [Trigger.dev's inspector](https://trigger.dev/changelog/run-page-inspector) informed subdued navigation, consistent typography, meaningful public examples and evidence available on demand. These references inform design; GuildZero does not claim their capabilities or reuse their screen artwork.

Acceptance includes the public home, authentication, all private routes and fallback states; actual sample calculations, usable service links, structured mission creation, clear result/evidence presentation, readable contrast, keyboard-accessible controls and responsive layouts. Original CSV, deliverable and negotiation evidence stays available behind explicit expanders. Metrics, transaction states and private ownership remain unchanged. Only observed source/test evidence can close #30.
