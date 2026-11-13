# Business-data workflow expansion

The owner authorized resuming this plan after the tester audit on 2026-11-13. Implement three deterministic CSV services using the existing private mission, auction, verification and guarded payment paths. No new application runtime or paid service.

1. **Quality audit:** selected-column missing values, duplicate nonblank values, surrounding whitespace, and explicitly selected numeric checks. Findings are a successfully computed audit, not failed service verification. Preserve source; at most 100 record-number examples, no automatic repair.
2. **Keyed reconciliation:** compare two bounded CSVs using one nonempty unique exact key and explicit shared comparison columns. Report unchanged/changed/left-only/right-only counts, with at most 25 examples and three bounded changed values per example. Reject ambiguous keys; no fuzzy matching or currency inference.
3. **Grouped report:** explicit grouping column plus numeric measures, counts and descriptive statistics per group. At most 50 groups with 100-character labels and 128 group/measure combinations, subject to an encoded-size preflight. No inferred revenue, accounting precision or natural-language interpretation.

Each CSV retains the 64 KiB / 500-row / 32-column limit; output stays below 128 KiB. Comparison input is owner-private and erased by the existing retention workflow. Validate requests before commitment, independently verify computed outputs, and release full reports only after every required payment confirms. Existing normalization/statistics briefs remain compatible; cleaning subcontract remains available only for the established summary template.

Add useful controls, previews, search labels, exports, service-capable competing agents, structured results and real-auth browser coverage. Test malformed inputs, tampered outputs, ownership, bounds, retention and payment gating. Publish no artificial receipts. Deployment and submission remain separate approval gates.

Research informing these requirements (desk research, not user interviews):
- Great Expectations: missingness and uniqueness checks, https://docs.greatexpectations.io/docs/reference/learn/data_quality_use_cases/uniqueness/ and https://docs.greatexpectations.io/docs/reference/learn/data_quality_use_cases/missingness/
- Microsoft Power Query: explicit merge keys and full outer comparison, https://learn.microsoft.com/en-us/power-query/merge-queries-overview
