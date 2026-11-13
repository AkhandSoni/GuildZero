# Issue #36 implementation plan

1. Keep the existing strict decimal/scientific numeric grammar. Do not infer locale, currency, percentages, or financial precision; provide a documented explicit correction path outside the app.
2. Share bounded selected-column validation with the editor and backend launch path. Invalid selected cells must prevent commitment before any auction, award, or payment preparation; incomplete drafts may remain editable. Preserve original CSV and valid unselected/selected columns.
3. Explain selected column names and CSV record numbers before commitment without echoing private cell values into logs. Document comma delimiters, quoted fields, decimal points, blanks, signed numbers and the distinction between a column sum and revenue.
4. Add regressions for currency/thousands/decimal-comma/percent formats, mixed formats, quoting, blank and negative values, formula-like cells, selected versus unselected columns, legacy draft launch, and normalization behavior. Preserve existing CSV bounds and formula safety.
5. Run focused tests, lint, typecheck, full offline tests, build and client-boundary scan. Add real browser coverage where an isolated local backend can be run without changing the user's environment. Record unavailable representative-user validation honestly.
6. Push an independent feature branch and open a reviewable PR against main. No deployment, data migration, new calculation service, live payment, locale conversion or claim of user-validated requirements is included.

## Implemented evidence

- Shared strict preflight: `lib/summary-preflight.ts`; editor/saved-brief explanations and launch disable; independent backend validation in `convex/jobs.ts` before writes. Existing started jobs still use independent executor/verifier checks.
- Regression coverage: four unit cases, three backend cases and one real local-Auth2 production-browser scenario. The historical unexecutable-worker test now explicitly seeds an already-started legacy job, retaining its no-invented-output/approval-denial coverage.
- Actual checks: 221 tests pass; lint, typecheck, production build and client-boundary scan (27 assets) pass. Focused real-browser scenario passes; full browser suite not rerun for this branch.
- Representative CSV-owning user validation remains outstanding. Strict input supports no locale, currency, percentage conversion or new derived calculations. Related to #36; do not close the remaining user-validation requirement automatically.
