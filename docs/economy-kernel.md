# Deterministic Economy Kernel & CSV Services (`lib/economy`)

This package implements GuildZero's pure, deterministic economy algorithms, bounded CSV data transformations (`csv_normalize` and `csv_summary`), and independent deliverable verification. It uses no network I/O, database calls, environment variables, ambient clocks (`Date.now()`), or randomness (`Math.random()`).

## Public Exports (`lib/economy/index.ts`)

- `estimateCost(input: CostInput): Result<CostEstimate>`
- `makeBid(input: BidInput): Result<BidDecision>`
- `rankBids(input: RankingInput): Result<readonly RankedBid[]>`
- `respondToCounteroffer(input: CounterofferInput): Result<NegotiationDecision>`
- `runService(input: ServiceRequest): Result<ServiceOutput>`
- `verifyDeliverable(input: VerificationRequest): Result<VerificationResult>`
- `validateServiceOptions(serviceType, options, headers, strictColumnCode?): Result<ServiceOptions>`
- `REASON_CODES` and all domain TypeScript contracts from `lib/economy/types.ts`

## Error & Reason Codes (`REASON_CODES`)

- Input / schema validation: `INVALID_INPUT`, `INVALID_OPTIONS`, `INVALID_COLUMNS`, `OPTIONS_REQUIRED`, `INVALID_AMOUNT`, `INPUT_TOO_LARGE`, `INVALID_CSV`, `INVALID_NUMBER`, `UNSAFE_CSV_CELL`, `OUTPUT_TOO_LARGE`
- Bidding / negotiation / ranking: `CAPABILITY_MISMATCH`, `CAPACITY_FULL`, `BUDGET_TOO_LOW`, `DEADLINE_INFEASIBLE`, `ROUND_LIMIT`, `BELOW_SELLER_MINIMUM`, `OFFER_MADE`, `OFFER_ACCEPTED`, `COUNTEROFFER_MADE`, `OFFER_REJECTED`
- Verification: `VERIFICATION_PASSED`, `ROW_COUNT_MISMATCH`, `CONTENT_MISMATCH`, `STATISTICS_MISMATCH`, `UNSUPPORTED_CRITERIA`, `SERVICE_EXEC_ERROR`, `INVALID_DELIVERABLE`

## Economic Formulas & Rounding

All monetary fields ending in `Yocto` are canonical decimal integer strings (`0` or positive integer up to 28 digits) evaluated with `BigInt`. Ceiling division is defined as `ceilDiv(a, b) = (a + b - 1n) / b`.

### 1. Cost Estimation (`estimateCost`)
Given `Workload` (`rowCount` 1–500, `columnCount` 1–32, `complexityBps` 0–10000, `riskBps` 0–10000) and cost model (`baseCostYocto`, `perRowCostYocto`, `perCellCostYocto`):
- `unitVariable = perRow * rowCount + perCell * (rowCount * columnCount)`
- `subtotal = base + unitVariable`
- `modifierSurcharge = ceilDiv(subtotal * (complexityBps + riskBps), 10000n)`
- `variableCostYocto = unitVariable + modifierSurcharge`
- `estimatedCostYocto = base + variableCostYocto`

### 2. Seller Bidding (`makeBid`)
- **Eligibility checks**:
  1. `agent.capabilities` must include `workload.serviceType` (otherwise decline with `CAPABILITY_MISMATCH`).
  2. `agent.strategy` must be `"aggressive" | "balanced" | "conservative"` (null or unknown strategy fails with `INVALID_INPUT`).
  3. `activeAssignments < agent.capacity` (otherwise decline with `CAPACITY_FULL`).
  4. `nowMs < deadlineAtMs` and `estimatedDurationMs <= deadlineAtMs - nowMs` (otherwise decline with `DEADLINE_INFEASIBLE`).
- **Margins & Floors**:
  - Target margins (`STRATEGY_MARGIN_BPS`): `aggressive = 500` (5%), `balanced = 1000` (10%), `conservative = 2000` (20%).
  - Minimum acceptable margins (`STRATEGY_MIN_MARGIN_BPS`): `aggressive = 200` (2%), `balanced = 500` (5%), `conservative = 1000` (10%).
  - Utilization adjustment: `utilizationBps = floor((activeAssignments * 500) / capacity)`.
  - `minProfitablePrice = ceilDiv(cost * (10000 + minMarginBps), 10000)`.
  - `minimumAcceptableYocto = max(1, reservePriceYocto, cost, minProfitablePrice)`.
  - `targetPrice = ceilDiv(cost * (10000 + targetMarginBps + utilizationBps), 10000)`.
  - `priceYocto = max(targetPrice, minimumAcceptableYocto)`.
  - If `priceYocto > budgetYocto`, returns a `BUDGET_TOO_LOW` decline.
  - `etaMs` and `estimatedDurationMs` record the elapsed duration (`estimatedDurationMs`) for consistent normalization in `rankBids`.

### 3. Bid Ranking (`rankBids`)
- Validates parallel arrays (`offers`, `reputationBps`, `capabilityMatchBps`) or `bids` snapshots, ensuring all reputation/capability scores are integers in `0..10000`.
- Filters out any candidate that is over budget (`price > budget`), below seller/cost floor (`price < minimumAcceptable` or `minimumAcceptable < estimatedCost`), exceeds available time (`durationMs > availableDurationMs`), or has zero capability match (`capabilityMatchBps === 0`).
- **Component scores (0–10000)**:
  - `priceScore = floor(10000 * (budget - price) / budget)`
  - `etaScore = floor(10000 * (availableDurationMs - durationMs) / availableDurationMs)`
  - `reputationScore = reputationBps`
  - `capabilityScore = capabilityMatchBps`
- **Weighted total score**:
  - Weights: `price = 6000`, `eta/time = 2000`, `reputation = 1000`, `capability = 1000` bps.
  - `totalScore = floor((priceScore * 6000 + etaScore * 2000 + reputationScore * 1000 + capabilityScore * 1000) / 10000)`.
- **Deterministic tie-breaking**:
  1. Lower `priceYocto`
  2. Lower `etaMs` (`estimatedDurationMs`)
  3. `agentId` by code-point order
  4. `bidId` by code-point order

### 4. Bounded Negotiation (`respondToCounteroffer`)
- Only rounds `2` and `3` are valid counteroffer rounds (`round > 3` fails with `ROUND_LIMIT`; `< 2` or non-integer fails with `INVALID_INPUT`).
- Effective floor: `effectiveFloor = max(sellerMinimumYocto, currentOffer.minimumAcceptableYocto, currentOffer.estimatedCostYocto)`.
- If `buyerOfferYocto > budgetYocto`, rejects with `BUDGET_TOO_LOW`.
- If `effectiveFloor > budgetYocto`, rejects with `BELOW_SELLER_MINIMUM`.
- If `buyerOfferYocto >= effectiveFloor && buyerOfferYocto <= budgetYocto`, **accepts** at `priceYocto = buyerOfferYocto`.
- If `buyerOfferYocto < effectiveFloor`:
  - In **round 2**: concedes from `upperBound = min(currentOffer.priceYocto, budgetYocto)` toward `effectiveFloor` by strategy concession rate (`aggressive: 5000` bps, `balanced: 3500` bps, `conservative: 2000` bps), clamped to `[effectiveFloor, upperBound]`.
  - In **round 3**: **rejects** with `BELOW_SELLER_MINIMUM`.

## CSV Services & Independent Verification

- **Limits**: Input CSV `<= 64 KiB` UTF-8, `1–500` data rows, `1–32` columns, unique non-empty trimmed headers (`<= 100` chars), exact header matching for `options.columns`, and serialized output `<= 128 KiB` UTF-8.
- **Spreadsheet formula safety**: Every header and exported cell is checked for leading `=`, `+`, `-`, `@` (after leading whitespace/control characters). A leading `+` or `-` is permitted **only** when the entire trimmed token is a valid finite numeric literal (`abs <= 1e12`). Formulas such as `=1`, `=1+1`, `+1+1`, or `@SUM(A1)` are rejected with `UNSAFE_CSV_CELL` across both selected and unselected columns.
- **CSV serialization**: `csv_normalize` uses `Papa.unparse` with `\n` line endings and no trailing newline, properly quoting commas, quotes, and embedded newlines while preserving unselected columns and original headers.
- **Independent verification (`verifyDeliverable`)**:
  - Never calls `runService`.
  - For `csv_normalize`: parses the submitted CSV deliverable with `Papa.parse`, verifies exact header/row/column dimensions, formula safety, and cell-by-cell transformations against the source CSV.
  - For `csv_summary`: independently extracts numeric vectors per requested column, checks exact `name`, `count`, `missing`, and `rowCount`, and compares `min`, `max`, `sum`, `mean` within `abs(actual - expected) <= 1e-9 * max(1, abs(expected))`.
  - If subjective acceptance criteria (`acceptanceCriteria` / `unsupportedCriteria`) are supplied, returns `verdict: "needs_human"` with `reasonCode: "UNSUPPORTED_CRITERIA"`.

## Integration Example

```ts
import { INITIAL_AGENTS } from "../lib/agents";
import { makeBid, rankBids, respondToCounteroffer, runService, verifyDeliverable } from "../lib/economy";

const workload = { serviceType: "csv_summary" as const, rowCount: 4, columnCount: 4, complexityBps: 500, riskBps: 500 };
const costModel = { baseCostYocto: "10000", perRowCostYocto: "500", perCellCostYocto: "100" };

const bids = INITIAL_AGENTS
  .map((agent, i) => makeBid({
    agent,
    workload,
    costModel,
    activeAssignments: 0,
    budgetYocto: "1000000000000000000000000",
    nowMs: 1_700_000_000_000,
    deadlineAtMs: 1_700_000_060_000,
    estimatedDurationMs: 5_000 + i * 1_000,
    bidId: `bid-${agent.id}`,
  }))
  .filter((res) => res.ok && res.value.decision === "offer")
  .map((res) => (res.ok && res.value.decision === "offer" ? res.value.offer : null!));

const ranked = rankBids({
  budgetYocto: "1000000000000000000000000",
  availableDurationMs: 60_000,
  offers: bids,
  reputationBps: bids.map(() => 8_000),
  capabilityMatchBps: bids.map(() => 10_000),
});
```

## Limitations

- Pure domain package only: does not persist jobs, reserve funds, schedule retries, or authorize NEAR testnet transfers.
- Descriptive summary statistics use bounded IEEE-754 double precision (`abs <= 1e12`); all financial calculations use exact `BigInt` yoctoNEAR strings.
