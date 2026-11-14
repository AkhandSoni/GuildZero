import { SERVICE_TYPES, type ServiceType } from "../services";
import type { Result } from "../economy/types";

export const MASTER_AGENT_SCHEMA_VERSION = "guildzero-master-plan-v1" as const;
export const MAX_PLAN_OUTPUT_BYTES = 32 * 1024;

export const MASTER_AGENT_DECISIONS = ["execute", "clarify", "unsupported"] as const;
export type MasterAgentDecision = (typeof MASTER_AGENT_DECISIONS)[number];

export const MASTER_AGENT_REASON_CODES = [
  "AMBIGUOUS_REQUEST",
  "UNSUPPORTED_OPERATION",
  "MISSING_DATASET",
  "INVALID_COLUMN",
  "INVALID_NUMERIC_INPUT",
  "BUDGET_INFEASIBLE",
  "POLICY_CONFLICT",
] as const;
export type MasterAgentReasonCode = (typeof MASTER_AGENT_REASON_CODES)[number];

export const MASTER_AGENT_STEP_IDS = ["s1", "s2", "s3"] as const;
export type MasterAgentStepId = (typeof MASTER_AGENT_STEP_IDS)[number];

export type MasterAgentStepOptionsV1 = {
  columns: string[];
  caseMode: "preserve" | "lowercase" | null;
  numericColumns: string[] | null;
  keyColumn: string | null;
  groupBy: string | null;
};

export type MasterAgentStepV1 = {
  stepId: MasterAgentStepId;
  title: string;
  serviceType: ServiceType;
  datasetRef: string;
  comparisonDatasetRef: string | null;
  options: MasterAgentStepOptionsV1;
  maxBudgetYocto: string;
  cleanBeforeProcessing: boolean;
  requiresHumanReview: boolean;
  acceptanceCriteria: string;
};

export type MasterAgentPlanV1 = {
  schemaVersion: typeof MASTER_AGENT_SCHEMA_VERSION;
  decision: MasterAgentDecision;
  summary: string;
  questions: string[];
  reasonCodes: MasterAgentReasonCode[];
  proposedTotalBudgetYocto: string | null;
  steps: MasterAgentStepV1[];
};

const ROOT_KEYS = [
  "schemaVersion",
  "decision",
  "summary",
  "questions",
  "reasonCodes",
  "proposedTotalBudgetYocto",
  "steps",
] as const;

const STEP_KEYS = [
  "stepId",
  "title",
  "serviceType",
  "datasetRef",
  "comparisonDatasetRef",
  "options",
  "maxBudgetYocto",
  "cleanBeforeProcessing",
  "requiresHumanReview",
  "acceptanceCriteria",
] as const;

const OPTION_KEYS = [
  "columns",
  "caseMode",
  "numericColumns",
  "keyColumn",
  "groupBy",
] as const;

/**
 * Strict JSON Schema generated from the same contract constants as the runtime validator.
 * Every object level sets `additionalProperties: false` and requires all fields.
 */
export const MASTER_AGENT_PLAN_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [...ROOT_KEYS],
  properties: {
    schemaVersion: {
      type: "string",
      enum: [MASTER_AGENT_SCHEMA_VERSION],
    },
    decision: {
      type: "string",
      enum: [...MASTER_AGENT_DECISIONS],
    },
    summary: {
      type: "string",
      minLength: 1,
      maxLength: 1000,
    },
    questions: {
      type: "array",
      maxItems: 3,
      items: {
        type: "string",
        minLength: 1,
        maxLength: 300,
      },
    },
    reasonCodes: {
      type: "array",
      maxItems: 10,
      items: {
        type: "string",
        enum: [...MASTER_AGENT_REASON_CODES],
      },
    },
    proposedTotalBudgetYocto: {
      anyOf: [
        { type: "string", pattern: "^[1-9][0-9]{0,27}$" },
        { type: "null" },
      ],
    },
    steps: {
      type: "array",
      maxItems: 3,
      items: {
        type: "object",
        additionalProperties: false,
        required: [...STEP_KEYS],
        properties: {
          stepId: {
            type: "string",
            enum: [...MASTER_AGENT_STEP_IDS],
          },
          title: {
            type: "string",
            minLength: 1,
            maxLength: 100,
          },
          serviceType: {
            type: "string",
            enum: [...SERVICE_TYPES],
          },
          datasetRef: {
            type: "string",
            minLength: 1,
            maxLength: 64,
          },
          comparisonDatasetRef: {
            anyOf: [
              { type: "string", minLength: 1, maxLength: 64 },
              { type: "null" },
            ],
          },
          options: {
            type: "object",
            additionalProperties: false,
            required: [...OPTION_KEYS],
            properties: {
              columns: {
                type: "array",
                minItems: 1,
                maxItems: 32,
                items: { type: "string", minLength: 1, maxLength: 100 },
              },
              caseMode: {
                anyOf: [
                  { type: "string", enum: ["preserve", "lowercase"] },
                  { type: "null" },
                ],
              },
              numericColumns: {
                anyOf: [
                  {
                    type: "array",
                    maxItems: 32,
                    items: { type: "string", minLength: 1, maxLength: 100 },
                  },
                  { type: "null" },
                ],
              },
              keyColumn: {
                anyOf: [
                  { type: "string", minLength: 1, maxLength: 100 },
                  { type: "null" },
                ],
              },
              groupBy: {
                anyOf: [
                  { type: "string", minLength: 1, maxLength: 100 },
                  { type: "null" },
                ],
              },
            },
          },
          maxBudgetYocto: {
            type: "string",
            pattern: "^[1-9][0-9]{0,27}$",
          },
          cleanBeforeProcessing: {
            type: "boolean",
          },
          requiresHumanReview: {
            type: "boolean",
          },
          acceptanceCriteria: {
            type: "string",
            minLength: 1,
            maxLength: 1000,
          },
        },
      },
    },
  },
} as const;

const POSITIVE_YOCTO_RE = /^[1-9]\d{0,27}$/;

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function hasExactKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(record);
  if (keys.length !== expected.length) return false;
  return expected.every((k) => Object.prototype.hasOwnProperty.call(record, k));
}

function isNonEmptyBoundedString(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.trim().length >= 1 && value.length <= maxLength;
}

/**
 * Parse and validate raw JSON string or object into `MasterAgentPlanV1`.
 * Never normalizes invalid plans into executable ones silently.
 */
export function parseAndValidateMasterAgentPlan(rawText: string): Result<MasterAgentPlanV1> {
  if (typeof rawText !== "string") {
    return { ok: false, code: "INVALID_INPUT", message: "Planner output must be a JSON string." };
  }
  const byteLength = new TextEncoder().encode(rawText).length;
  if (byteLength === 0) {
    return { ok: false, code: "INVALID_INPUT", message: "Planner output was empty." };
  }
  if (byteLength > MAX_PLAN_OUTPUT_BYTES) {
    return { ok: false, code: "OUTPUT_TOO_LARGE", message: "Planner output exceeded the 32 KiB limit." };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, code: "INVALID_INPUT", message: "Planner output is not valid JSON." };
  }
  return validateMasterAgentPlanSchema(parsed);
}

export function validateMasterAgentPlanSchema(raw: unknown): Result<MasterAgentPlanV1> {
  if (!isPlainRecord(raw) || !hasExactKeys(raw, ROOT_KEYS)) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Plan root must be a strict MasterAgentPlanV1 object with exact required fields and no unknown keys.",
    };
  }
  if (raw.schemaVersion !== MASTER_AGENT_SCHEMA_VERSION) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: `Unsupported schemaVersion; expected ${MASTER_AGENT_SCHEMA_VERSION}.`,
    };
  }
  const decision = raw.decision;
  if (
    typeof decision !== "string" ||
    !(MASTER_AGENT_DECISIONS as readonly string[]).includes(decision)
  ) {
    return { ok: false, code: "INVALID_INPUT", message: "Invalid plan decision." };
  }
  if (!isNonEmptyBoundedString(raw.summary, 1000)) {
    return { ok: false, code: "INVALID_INPUT", message: "Plan summary must be 1–1,000 characters." };
  }
  if (
    !Array.isArray(raw.questions) ||
    raw.questions.length > 3 ||
    raw.questions.some((q) => !isNonEmptyBoundedString(q, 300))
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Plan questions must be at most 3 non-empty strings of 1–300 characters.",
    };
  }
  if (
    !Array.isArray(raw.reasonCodes) ||
    raw.reasonCodes.length > 10 ||
    raw.reasonCodes.some(
      (code) =>
        typeof code !== "string" ||
        !(MASTER_AGENT_REASON_CODES as readonly string[]).includes(code),
    )
  ) {
    return {
      ok: false,
      code: "INVALID_INPUT",
      message: "Plan reasonCodes must contain up to 10 valid reason codes.",
    };
  }
  if (!Array.isArray(raw.steps) || raw.steps.length > 3) {
    return { ok: false, code: "INVALID_INPUT", message: "Plan steps must be an array of at most 3 items." };
  }

  if (decision === "execute") {
    if (raw.questions.length !== 0) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Executable plans cannot have outstanding clarification questions.",
      };
    }
    if (raw.steps.length < 1 || raw.steps.length > 3) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Executable plans must contain 1–3 bounded steps.",
      };
    }
    if (
      typeof raw.proposedTotalBudgetYocto !== "string" ||
      !POSITIVE_YOCTO_RE.test(raw.proposedTotalBudgetYocto)
    ) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        message: "Executable plans require a canonical positive integer proposedTotalBudgetYocto.",
      };
    }
  } else {
    if (raw.steps.length !== 0) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Non-executable plans (clarify/unsupported) must have zero steps.",
      };
    }
    if (raw.proposedTotalBudgetYocto !== null) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Non-executable plans must set proposedTotalBudgetYocto to null.",
      };
    }
    if (decision === "clarify" && raw.questions.length === 0) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Clarification plans must include at least one question.",
      };
    }
  }

  const seenStepIds = new Set<string>();
  const validatedSteps: MasterAgentStepV1[] = [];

  for (const rawStep of raw.steps) {
    if (!isPlainRecord(rawStep) || !hasExactKeys(rawStep, STEP_KEYS)) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Each step must be a strict object with exact required fields and no unknown keys.",
      };
    }
    const stepId = rawStep.stepId;
    if (
      typeof stepId !== "string" ||
      !(MASTER_AGENT_STEP_IDS as readonly string[]).includes(stepId) ||
      seenStepIds.has(stepId)
    ) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Each step must have a unique stepId in s1..s3.",
      };
    }
    seenStepIds.add(stepId);

    if (!isNonEmptyBoundedString(rawStep.title, 100)) {
      return { ok: false, code: "INVALID_INPUT", message: "Step title must be 1–100 characters." };
    }
    const serviceType = rawStep.serviceType;
    if (
      typeof serviceType !== "string" ||
      !(SERVICE_TYPES as readonly string[]).includes(serviceType)
    ) {
      return { ok: false, code: "INVALID_OPTIONS", message: "Step serviceType is not supported." };
    }
    if (
      typeof rawStep.datasetRef !== "string" ||
      !rawStep.datasetRef.trim() ||
      rawStep.datasetRef.length > 64 ||
      /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawStep.datasetRef)
    ) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Step datasetRef must be a valid request-scoped identifier, never a URL.",
      };
    }
    if (
      rawStep.comparisonDatasetRef !== null &&
      (typeof rawStep.comparisonDatasetRef !== "string" ||
        !rawStep.comparisonDatasetRef.trim() ||
        rawStep.comparisonDatasetRef.length > 64 ||
        /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(rawStep.comparisonDatasetRef))
    ) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Step comparisonDatasetRef must be null or a valid request-scoped identifier.",
      };
    }
    if (
      typeof rawStep.maxBudgetYocto !== "string" ||
      !POSITIVE_YOCTO_RE.test(rawStep.maxBudgetYocto)
    ) {
      return {
        ok: false,
        code: "INVALID_AMOUNT",
        message: "Step maxBudgetYocto must be a canonical positive integer string.",
      };
    }
    if (typeof rawStep.cleanBeforeProcessing !== "boolean") {
      return { ok: false, code: "INVALID_OPTIONS", message: "Step cleanBeforeProcessing must be a boolean." };
    }
    if (typeof rawStep.requiresHumanReview !== "boolean") {
      return { ok: false, code: "INVALID_OPTIONS", message: "Step requiresHumanReview must be a boolean." };
    }
    if (!isNonEmptyBoundedString(rawStep.acceptanceCriteria, 1000)) {
      return {
        ok: false,
        code: "INVALID_INPUT",
        message: "Step acceptanceCriteria must be 1–1,000 characters.",
      };
    }

    const rawOptions = rawStep.options;
    if (!isPlainRecord(rawOptions) || !hasExactKeys(rawOptions, OPTION_KEYS)) {
      return {
        ok: false,
        code: "INVALID_OPTIONS",
        message: "Step options must be a strict object with exact required fields and no unknown keys.",
      };
    }
    if (
      !Array.isArray(rawOptions.columns) ||
      rawOptions.columns.length < 1 ||
      rawOptions.columns.length > 32 ||
      rawOptions.columns.some((c) => typeof c !== "string" || !c.trim() || c.length > 100) ||
      new Set(rawOptions.columns).size !== rawOptions.columns.length
    ) {
      return {
        ok: false,
        code: "INVALID_COLUMNS",
        message: "Step options.columns must contain 1–32 unique non-empty column names.",
      };
    }
    if (
      rawOptions.caseMode !== null &&
      rawOptions.caseMode !== "preserve" &&
      rawOptions.caseMode !== "lowercase"
    ) {
      return {
        ok: false,
        code: "INVALID_OPTIONS",
        message: "Step options.caseMode must be 'preserve', 'lowercase', or null.",
      };
    }
    if (
      rawOptions.numericColumns !== null &&
      (!Array.isArray(rawOptions.numericColumns) ||
        rawOptions.numericColumns.length > 32 ||
        rawOptions.numericColumns.some((c) => typeof c !== "string" || !c.trim() || c.length > 100) ||
        new Set(rawOptions.numericColumns).size !== rawOptions.numericColumns.length)
    ) {
      return {
        ok: false,
        code: "INVALID_OPTIONS",
        message: "Step options.numericColumns must be null or an array of unique column names.",
      };
    }
    if (
      rawOptions.keyColumn !== null &&
      (typeof rawOptions.keyColumn !== "string" ||
        !rawOptions.keyColumn.trim() ||
        rawOptions.keyColumn.length > 100)
    ) {
      return {
        ok: false,
        code: "INVALID_OPTIONS",
        message: "Step options.keyColumn must be null or a non-empty column name.",
      };
    }
    if (
      rawOptions.groupBy !== null &&
      (typeof rawOptions.groupBy !== "string" ||
        !rawOptions.groupBy.trim() ||
        rawOptions.groupBy.length > 100)
    ) {
      return {
        ok: false,
        code: "INVALID_OPTIONS",
        message: "Step options.groupBy must be null or a non-empty column name.",
      };
    }

    validatedSteps.push({
      stepId: stepId as MasterAgentStepId,
      title: rawStep.title.trim(),
      serviceType: serviceType as ServiceType,
      datasetRef: rawStep.datasetRef,
      comparisonDatasetRef: rawStep.comparisonDatasetRef as string | null,
      options: {
        columns: [...(rawOptions.columns as string[])],
        caseMode: rawOptions.caseMode as "preserve" | "lowercase" | null,
        numericColumns:
          rawOptions.numericColumns === null ? null : [...(rawOptions.numericColumns as string[])],
        keyColumn: rawOptions.keyColumn as string | null,
        groupBy: rawOptions.groupBy as string | null,
      },
      maxBudgetYocto: rawStep.maxBudgetYocto,
      cleanBeforeProcessing: rawStep.cleanBeforeProcessing,
      requiresHumanReview: rawStep.requiresHumanReview,
      acceptanceCriteria: rawStep.acceptanceCriteria.trim(),
    });
  }

  return {
    ok: true,
    value: {
      schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
      decision: decision as MasterAgentDecision,
      summary: raw.summary.trim(),
      questions: (raw.questions as string[]).map((q) => q.trim()),
      reasonCodes: [...(raw.reasonCodes as MasterAgentReasonCode[])],
      proposedTotalBudgetYocto: raw.proposedTotalBudgetYocto as string | null,
      steps: validatedSteps,
    },
  };
}

/**
 * Pure, deterministic FIPS 180-4 SHA-256 hex digest.
 * Synchronous and zero-dependency so it runs identically in Convex mutations, Node, and browser.
 */
const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

function rotr(x: number, n: number): number {
  return (x >>> n) | (x << (32 - n));
}

export function sha256Hex(input: string): string {
  const bytes = new TextEncoder().encode(input);
  const bitLen = bytes.length * 8;
  const totalLen = (((bytes.length + 9 + 63) >> 6) << 6);
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;

  const w = new Uint32Array(64);
  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }

    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;

    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map((n) => n.toString(16).padStart(8, "0"))
    .join("");
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(record[k])}`).join(",")}}`;
}

export const SCHEMA_SHA256 = sha256Hex(canonicalJson(MASTER_AGENT_PLAN_JSON_SCHEMA));
