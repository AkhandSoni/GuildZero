// Verification implementation for deterministic economy kernel
import type { VerificationRequest, VerificationResult, CheckResult, ServiceRequest, Result } from "./types";
import { runService } from "./services"; // will be created shortly

/** Helper to create check result */
function check(code: string, passed: boolean, detail: string): CheckResult {
  return { code, passed, detail };
}

export function verifyDeliverable(input: VerificationRequest): Result<VerificationResult> {
  const { request, deliverable } = input;
  const checks: CheckResult[] = [];

  // Validate request shape (basic) – we rely on TypeScript but runtime guard for safety
  if (!request || typeof request !== "object" || !("serviceType" in request)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Malformed request",
    };
  }

  // Run service independently to get expected output (pure compute)
  const expectedRes = runService(request as ServiceRequest);
  if (!expectedRes.ok) {
    checks.push(check("SERVICE_EXEC_ERROR", false, `Service error: ${expectedRes.code}`));
    return {
      ok: true,
      value: {
        verdict: "fail",
        reasonCode: "SERVICE_EXEC_ERROR",
        checks,
      },
    };
  }

  const expected = expectedRes.value;

  // Verify deliverable is an object and matches expected structure
  if (typeof deliverable !== "object" || deliverable === null) {
    checks.push(check("INVALID_DELIVERABLE", false, "Deliverable is not an object"));
    return {
      ok: true,
      value: {
        verdict: "fail",
        reasonCode: "INVALID_DELIVERABLE",
        checks,
      },
    };
  }

  const deliverableRecord = deliverable as Record<string, unknown>;

  // Basic type check without trusting fields
  const typeMatch = expected.serviceType === deliverableRecord.serviceType;
  checks.push(check("SERVICE_TYPE_MATCH", typeMatch, `expected ${expected.serviceType}`));

  // Verify format
  const formatMatch = expected.format === deliverableRecord.format;
  checks.push(check("FORMAT_MATCH", formatMatch, `expected ${expected.format}`));

  // Row count
  const rowsMatch = expected.rowCount === deliverableRecord.rowCount;
  checks.push(check("ROW_COUNT_MATCH", rowsMatch, `expected ${expected.rowCount}`));

  // Columns / statistics comparison
  if (expected.serviceType === "csv_normalize") {
    const expCsv = expected.csv;
    const gotCsv = deliverableRecord.csv;
    const csvMatch = expCsv === gotCsv;
    checks.push(check("CONTENT_MATCH", csvMatch, "CSV content equality"));
    const colsMatch = JSON.stringify(expected.columns) === JSON.stringify(deliverableRecord.columns);
    checks.push(check("COLUMNS_MATCH", colsMatch, "Requested columns list"));
  } else if (expected.serviceType === "csv_summary") {
    const expCols = expected.columns;
    const gotCols = deliverableRecord.columns;
    const colsMatch = JSON.stringify(expCols) === JSON.stringify(gotCols);
    checks.push(check("COLUMNS_MATCH", colsMatch, "Summary columns equality"));
  }

  const allPass = checks.every((c) => c.passed);
  return {
    ok: true,
    value: {
      verdict: allPass ? "pass" : "fail",
      reasonCode: allPass ? "VERIFICATION_PASSED" : "CONTENT_MISMATCH",
      checks,
    },
  };
}
