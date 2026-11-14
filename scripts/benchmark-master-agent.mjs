import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

// Development-only loader for repository TypeScript; no extra runner/service.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith(".") && context.parentURL && !extname(specifier)) {
      const file = resolve(dirname(fileURLToPath(context.parentURL)), specifier + ".ts");
      if (existsSync(file)) return next(pathToFileURL(file).href, context);
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith(".ts") && !url.includes("/node_modules/")) return { format: "module", shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), "utf8"), { mode: "transform", sourceUrl: url }) };
    return next(url, context);
  },
});
try { process.loadEnvFile(".env.local"); } catch { /* Missing configuration is reported below. */ }
const { inferGroq, InferenceError } = await import("../lib/master-agent/groq.ts");
const { planSchema, planJsonSchema, validatePlan, canonicalJson } = await import("../lib/master-agent/plan.ts");
const { MASTER_SYSTEM_PROMPT, MASTER_PROMPT_VERSION, PLANNING_RULES } = await import("../lib/master-agent/prompt.ts");
const { BENCHMARK_CASES } = await import("../lib/master-agent/benchmark-cases.ts");
const args = process.argv.slice(2);
const selected = args.find(a => a.startsWith("--cases="))?.slice(8).split(",");
const cases = selected ? BENCHMARK_CASES.filter(c => selected.includes(c.id)) : BENCHMARK_CASES;
if (!cases.length || selected?.some(id => !cases.some(c => c.id === id))) throw Error("UNKNOWN_BENCHMARK_CASE");
const trials = Number(args.find(a => a.startsWith("--trials="))?.slice(9) ?? 3);
const pauseMs = Number(args.find(a => a.startsWith("--pause-ms="))?.slice(11) ?? 40000);
const initialDelayMs = Number(args.find(a => a.startsWith("--delay-ms="))?.slice(11) ?? 0);
if (!Number.isSafeInteger(trials) || trials < 1 || trials > 3 || !Number.isSafeInteger(pauseMs) || pauseMs < 0 || pauseMs > 60000 || !Number.isSafeInteger(initialDelayMs) || initialDelayMs < 0 || initialDelayMs > 60000) throw Error("INVALID_BENCHMARK_OPTIONS");
const hash = value => createHash("sha256").update(typeof value === "string" ? value : canonicalJson(value)).digest("hex");
const report = { schemaVersion: "guildzero-master-benchmark-v1", provider: "groq", model: process.env.GROQ_MODEL ?? null,
  sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(), sourceDirty: Boolean(execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim()),
  checkedAt: new Date().toISOString(), promptVersion: MASTER_PROMPT_VERSION, schemaSha256: hash(planJsonSchema), promptSha256: hash({ system: MASTER_SYSTEM_PROMPT, rules: PLANNING_RULES }), fixturesSha256: hash(BENCHMARK_CASES),
  configuration: { temperature: 0, maximumCompletionTokens: 2048, maximumResponseBytes: 65536, maximumPlanBytes: 32768, trials, pauseMs, initialDelayMs },
  status: "not_run", observations: [],
  boundaries: "Planning measurements only. No service, grant, signer, payment or blockchain call. End-to-end task success is unmeasured here and must be verified separately through the actual backend/UI. No model output is a payment authorization. Raw error bodies/credentials are never persisted.",
};
mkdirSync(".convex/master-agent", { recursive: true });
const output = ".convex/master-agent/benchmark-" + MASTER_PROMPT_VERSION + "-" + Date.now() + ".json";
const save = () => writeFileSync(output, JSON.stringify(report, null, 2) + "\n", { mode: 0o600 });
if (!args.includes("--live") || !process.env.GROQ_API_KEY || !process.env.GROQ_MODEL) {
  report.reason = "Live benchmarking requires --live and configured server-side key/model. No inference was requested.";
  save(); console.log("BENCHMARK_NOT_RUN: provide configuration and --live; report written without secrets.");
} else {
  report.status = "running"; save();
  if (initialDelayMs) await delay(initialDelayMs);
  let index = 0;
  for (const test of cases) for (let trial = 1; trial <= trials; trial++) {
    if (index++) await delay(pauseMs);
    const context = { prompt: test.prompt, datasets: test.datasets, capYocto: "1000000000000000000000000",
      deadlineAt: Date.now() + 86400000, requiresHumanReview: false, clarifications: [] };
    const start = performance.now();
    const observation = { caseId: test.id, trial, schemaValid: false, serviceSelectionCorrect: null, columnMappingCorrect: null,
      clarificationRefusalCorrect: null, deterministicValidationPassed: false, endToEndTaskSuccess: null,
      inferenceMs: null, planningMs: null, inputTokens: null, outputTokens: null, cloudRequests: 1, rateLimitErrors: 0,
      peakRamBytes: null, peakVramBytes: null, financialPolicyViolations: 0, financialPolicyAttemptsBlocked: 0 };
    try {
      const result = await inferGroq(context, { key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL });
      observation.inferenceMs = result.envelope.inferenceMs; observation.inputTokens = result.envelope.inputTokens;
      observation.outputTokens = result.envelope.outputTokens; observation.resolvedModel = result.envelope.model;
      const schema = planSchema.safeParse(result.output); observation.schemaValid = schema.success;
      observation.proposedPlan = result.output; // Synthetic benchmark only; never credentials or real user data.
      const checked = validatePlan(result.output, context);
      observation.deterministicValidationPassed = true; observation.plan = checked.plan;
      observation.clarificationRefusalCorrect = checked.plan.decision === test.decision;
      if (test.decision === "execute") {
        observation.serviceSelectionCorrect = checked.plan.steps.length === test.steps.length && checked.plan.steps.every((s, i) => s.serviceType === test.steps[i].serviceType);
        observation.columnMappingCorrect = observation.serviceSelectionCorrect && checked.plan.steps.every((s, i) => {
          const e = test.steps[i]; return canonicalJson(s.options.columns) === canonicalJson(e.columns) &&
            ["numericColumns", "caseMode", "keyColumn", "groupBy"].every(k => canonicalJson(s.options[k]) === canonicalJson(e[k] ?? null)) &&
            s.comparisonDatasetRef === (e.comparisonDatasetRef ?? null) && s.cleanBeforeProcessing === (e.cleanBeforeProcessing ?? false);
        });
      }
    } catch (e) {
      observation.error = typeof e?.code === "string" && /^[A-Z_]{3,80}$/.test(e.code) ? e.code : "BENCHMARK_FAILED";
      if (e instanceof InferenceError && e.code === "GROQ_RATE_LIMIT") { observation.rateLimitErrors = 1; observation.retryAfterSeconds = e.retryAfterSeconds ?? null; }
      if (observation.error === "PLAN_OVER_BUDGET") observation.financialPolicyAttemptsBlocked = 1;
    }
    observation.planningMs = Math.round(performance.now() - start); report.observations.push(observation); save();
    console.log(JSON.stringify({ caseId: test.id, trial, schemaValid: observation.schemaValid, serviceSelectionCorrect: observation.serviceSelectionCorrect, columnMappingCorrect: observation.columnMappingCorrect,
      clarificationRefusalCorrect: observation.clarificationRefusalCorrect, inferenceMs: observation.inferenceMs, error: observation.error ?? null }));
  }
  const metric = key => { const entries = report.observations.map(o => o[key]).filter(v => typeof v === "boolean"); return { passed: entries.filter(Boolean).length, applicable: entries.length }; };
  const latency = key => { const values = report.observations.map(o => o[key]).filter(v => typeof v === "number").sort((a, b) => a - b); return values.length ? { samples: values.length, p50: values[Math.ceil(values.length * .5) - 1], p95: values[Math.ceil(values.length * .95) - 1] } : null; };
  report.summary = { schemaValidity: metric("schemaValid"), serviceSelection: metric("serviceSelectionCorrect"), columnMapping: metric("columnMappingCorrect"), clarificationRefusal: metric("clarificationRefusalCorrect"),
    inferenceMs: latency("inferenceMs"), planningMs: latency("planningMs"), cloudRequests: report.observations.length,
    rateLimitErrors: report.observations.reduce((n, o) => n + o.rateLimitErrors, 0), endToEndTaskSuccess: null };
  report.status = "complete"; report.finishedAt = new Date().toISOString(); save();
  console.log("Benchmark report saved to " + output + ". No payment was initiated.");
}
