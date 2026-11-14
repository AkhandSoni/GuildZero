import { execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as nodeModule from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

// Register a minimal extensionless .ts resolver for Node's native strip-types loader
if (typeof nodeModule.registerHooks === "function") {
  nodeModule.registerHooks({
    resolve(specifier, context, nextResolve) {
      if ((specifier.startsWith("./") || specifier.startsWith("../")) && !path.extname(specifier)) {
        const parentPath = context.parentURL ? path.dirname(fileURLToPath(context.parentURL)) : process.cwd();
        const candidateTs = path.resolve(parentPath, specifier + ".ts");
        const candidateIndexTs = path.resolve(parentPath, specifier, "index.ts");
        if (fs.existsSync(candidateTs)) {
          return nextResolve(pathToFileURL(candidateTs).href, context);
        }
        if (fs.existsSync(candidateIndexTs)) {
          return nextResolve(pathToFileURL(candidateIndexTs).href, context);
        }
      }
      return nextResolve(specifier, context);
    },
  });
}

const {
  BENCHMARK_CASES,
  BENCHMARK_MANIFEST_SHA256,
  FROZEN_SYSTEM_INSTRUCTION_SHA256,
  PROMPT_TEMPLATE_SHA256,
  SCHEMA_SHA256,
  buildCaseDatasets,
  compileMasterAgentPlan,
  inspectDatasetMetadata,
  probeLocalOllamaHealth,
  resetOllamaRateLimitersForTest,
  runOllamaMasterAgentInference,
  scoreBenchmarkTrial,
} = await import("../lib/master-agent/index.ts");

const { runService, verifyDeliverable } = await import("../lib/economy/index.ts");
const { serviceRequest } = await import("../lib/economy/business-input.ts");

function safeExec(cmd) {
  try {
    return execSync(cmd, { encoding: "utf8", timeout: 5000, stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function collectHardwareTelemetry() {
  const gpuCsv = safeExec(
    "nvidia-smi --query-gpu=name,driver_version,memory.total,memory.used,memory.free --format=csv,noheader,nounits",
  );
  let gpu = null;
  if (gpuCsv) {
    const [name, driverVersion, totalMiB, usedMiB, freeMiB] = gpuCsv.split(",").map((s) => s.trim());
    gpu = {
      name,
      driverVersion,
      totalVramMiB: Number(totalMiB),
      usedVramMiB: Number(usedMiB),
      freeVramMiB: Number(freeMiB),
    };
  }
  const ollamaCliVersion = safeExec("ollama --version");
  const ollamaPs = safeExec("ollama ps");
  const totalRamBytes = os.totalmem();
  const freeRamBytes = os.freemem();
  return {
    platform: `${os.type()} ${os.release()} (${os.arch()})`,
    cpuModel: os.cpus()[0]?.model ?? "unknown",
    cpuCores: os.cpus().length,
    totalRamMiB: Math.round(totalRamBytes / (1024 * 1024)),
    usedRamMiB: Math.round((totalRamBytes - freeRamBytes) / (1024 * 1024)),
    ollamaCliVersion: ollamaCliVersion ?? "unavailable",
    ollamaPs: ollamaPs ?? "unavailable",
    gpu: gpu ?? "unavailable",
  };
}

function percentile(sortedNumbers, p) {
  if (!sortedNumbers.length) return null;
  const idx = Math.min(
    sortedNumbers.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedNumbers.length) - 1),
  );
  return sortedNumbers[idx];
}

function executeAndVerifyCompiledPlan(compiledPlan) {
  for (const step of compiledPlan.compiledSteps) {
    let inputCsv = step.missionInput.inputCsv;
    if (step.missionInput.cleanBeforeProcessing && step.missionInput.serviceType === "csv_summary") {
      const cleanReq = serviceRequest("csv_normalize", inputCsv, {
        columns: step.serviceOptions.columns,
        caseMode: "preserve",
      });
      const cleanOut = runService(cleanReq);
      if (!cleanOut.ok || cleanOut.value.serviceType !== "csv_normalize") {
        return { ok: false, reason: "CLEANING_CHILD_EXEC_FAILED" };
      }
      const cleanVer = verifyDeliverable({
        request: cleanReq,
        deliverable: cleanOut.value,
      });
      if (!cleanVer.ok || cleanVer.value.verdict !== "pass") {
        return { ok: false, reason: "CLEANING_CHILD_VERIFY_FAILED" };
      }
      inputCsv = cleanOut.value.csv;
    }

    const req = serviceRequest(
      step.missionInput.serviceType,
      inputCsv,
      step.missionInput.serviceType === "csv_normalize"
        ? { columns: step.serviceOptions.columns, caseMode: step.serviceOptions.caseMode ?? "preserve" }
        : step.serviceOptions,
    );
    const out = runService(req);
    if (!out.ok) {
      return { ok: false, reason: `EXEC_FAILED:${out.code}` };
    }
    const ver = verifyDeliverable({
      request: req,
      deliverable: out.value,
    });
    if (!ver.ok || ver.value.verdict !== "pass") {
      return { ok: false, reason: "VERIFY_FAILED" };
    }
  }
  return { ok: true };
}

const trialsArg = process.argv.find((a) => a.startsWith("--trials="));
const TRIALS_PER_CASE = trialsArg ? Math.max(1, Number(trialsArg.split("=")[1])) : 3;

console.log(`Starting GuildZero Local Ollama Qwen3.5 4B Benchmark (${TRIALS_PER_CASE} trials/case)...`);

const health = await probeLocalOllamaHealth({ timeoutMs: 5000 });
if (!health.reachable || !health.modelAvailable) {
  console.error(
    JSON.stringify(
      {
        status: "blocked",
        reason: health.errorCode ?? "OLLAMA_UNAVAILABLE",
        message: health.message,
      },
      null,
      2,
    ),
  );
  process.exit(2);
}

// Ensure Trial 1 measures a genuine cold model load into GPU VRAM
safeExec(`ollama stop ${health.configuredModel}`);

const preHardware = collectHardwareTelemetry();
const trialRecords = [];
let peakVramMiB = typeof preHardware.gpu === "object" && preHardware.gpu ? preHardware.gpu.usedVramMiB : null;
let peakRamMiB = preHardware.usedRamMiB;

for (let caseIdx = 0; caseIdx < BENCHMARK_CASES.length; caseIdx++) {
  const c = BENCHMARK_CASES[caseIdx];
  const datasets = buildCaseDatasets(c);
  const metadataDatasets = datasets.map((d) => inspectDatasetMetadata(d.ref, d.name, d.csv));
  const envelope = {
    userPrompt: c.prompt,
    maxBudgetYocto: c.maxBudgetYocto,
    requiresHumanReview: false,
    datasets: metadataDatasets,
  };

  for (let trial = 1; trial <= TRIALS_PER_CASE; trial++) {
    resetOllamaRateLimitersForTest();
    const isColdFirstCall = caseIdx === 0 && trial === 1;
    const seed = 42 + trial - 1;
    const planStart = Date.now();
    const res = await runOllamaMasterAgentInference(envelope, {
      skipRateLimit: true,
      timeoutMs: 90_000,
      seed,
      temperature: 0,
      numCtx: 4096,
      numPredict: 1024,
    });
    const totalPlanningMs = Date.now() - planStart;

    const hwSnap = collectHardwareTelemetry();
    if (typeof hwSnap.gpu === "object" && hwSnap.gpu && (peakVramMiB === null || hwSnap.gpu.usedVramMiB > peakVramMiB)) {
      peakVramMiB = hwSnap.gpu.usedVramMiB;
    }
    if (hwSnap.usedRamMiB > peakRamMiB) {
      peakRamMiB = hwSnap.usedRamMiB;
    }

    if (!res.ok) {
      trialRecords.push({
        caseId: c.caseId,
        caseNumber: c.caseNumber,
        category: c.category,
        trial,
        runType: isColdFirstCall ? "cold_or_initial" : "warm",
        seed,
        inferenceOk: false,
        errorCode: res.code,
        errorMessage: res.message,
        telemetry: res.telemetry,
        totalPlanningMs,
        score: {
          rawSchemaValid: false,
          decisionCorrect: false,
          serviceSelectionCorrect: c.expectedSteps.length > 0 ? false : "N/A",
          columnAndOptionMappingCorrect: c.expectedSteps.length > 0 ? false : "N/A",
          clarificationOrRefusalAccurate: c.expectedSteps.length === 0 ? false : "N/A",
          deterministicValidationPassed: false,
          endToEndExecutionSuccess: c.expectedSteps.length > 0 ? false : "N/A",
          financialPolicySafe: true,
        },
      });
      console.log(`  [${c.caseId} #${trial}] ERROR: ${res.code} (${res.telemetry.durationMs}ms)`);
      continue;
    }

    const scored = scoreBenchmarkTrial(c, res.rawContent);
    let endToEndSuccess = "N/A";
    let executionLatencyMs = null;

    if (c.expectedSteps.length > 0) {
      if (scored.plan && scored.plan.decision === "execute" && scored.deterministicValidationPassed) {
        const execStart = Date.now();
        const compiled = compileMasterAgentPlan(scored.plan, {
          datasets,
          maxBudgetYocto: c.maxBudgetYocto,
          deadlineAt: Date.now() + 86400000,
          requiresHumanReview: false,
        });
        if (compiled.ok) {
          const execVer = executeAndVerifyCompiledPlan(compiled.value);
          endToEndSuccess = execVer.ok && scored.serviceSelectionCorrect === true && scored.columnAndOptionMappingCorrect === true;
        } else {
          endToEndSuccess = false;
        }
        executionLatencyMs = Date.now() - execStart;
      } else if (c.acceptedDecisions.includes(scored.plan?.decision) && scored.plan?.decision !== "execute") {
        endToEndSuccess = "N/A";
      } else {
        endToEndSuccess = false;
      }
    }

    trialRecords.push({
      caseId: c.caseId,
      caseNumber: c.caseNumber,
      category: c.category,
      trial,
      runType: isColdFirstCall ? "cold_or_initial" : "warm",
      seed,
      inferenceOk: true,
      telemetry: res.telemetry,
      totalPlanningMs,
      executionLatencyMs,
      score: {
        rawSchemaValid: scored.rawSchemaValid,
        decisionCorrect: scored.decisionCorrect,
        serviceSelectionCorrect: scored.serviceSelectionCorrect,
        columnAndOptionMappingCorrect: scored.columnAndOptionMappingCorrect,
        clarificationOrRefusalAccurate: scored.clarificationOrRefusalAccurate,
        deterministicValidationPassed: scored.deterministicValidationPassed,
        endToEndExecutionSuccess: endToEndSuccess,
        financialPolicySafe: scored.financialPolicySafe,
      },
      planSummary: scored.plan
        ? {
            decision: scored.plan.decision,
            reasonCodes: scored.plan.reasonCodes,
            questionCount: scored.plan.questions.length,
            steps: scored.plan.steps.map((s) => ({
              stepId: s.stepId,
              serviceType: s.serviceType,
              datasetRef: s.datasetRef,
              comparisonDatasetRef: s.comparisonDatasetRef,
              options: s.options,
              cleanBeforeProcessing: s.cleanBeforeProcessing,
              maxBudgetYocto: s.maxBudgetYocto,
            })),
          }
        : null,
    });

    console.log(
      `  [${c.caseId} #${trial}] decision=${scored.plan?.decision} schema=${scored.rawSchemaValid} decisionOk=${scored.decisionCorrect} valid=${scored.deterministicValidationPassed} safe=${scored.financialPolicySafe} (${res.telemetry.durationMs}ms)`,
    );
  }
}

const postHardware = collectHardwareTelemetry();

function countDimension(records, key) {
  const applicable = records.filter((r) => r.score[key] !== "N/A");
  const passed = applicable.filter((r) => r.score[key] === true);
  return {
    passed: passed.length,
    total: applicable.length,
    rateBps: applicable.length > 0 ? Math.round((passed.length / applicable.length) * 10000) : null,
  };
}

const durations = trialRecords
  .filter((r) => r.inferenceOk)
  .map((r) => r.telemetry.durationMs)
  .sort((a, b) => a - b);
const warmDurations = trialRecords
  .filter((r) => r.inferenceOk && r.runType === "warm")
  .map((r) => r.telemetry.durationMs)
  .sort((a, b) => a - b);
const coldRecord = trialRecords.find((r) => r.runType === "cold_or_initial");

const summaryReport = {
  benchmarkVersion: "guildzero-master-plan-v1-benchmark",
  generatedAt: new Date().toISOString(),
  recordedBaseCommit: "be04088784f1aed8cb04ff4f2f16720ae66e94f7",
  digests: {
    schemaSha256: SCHEMA_SHA256,
    frozenSystemInstructionSha256: FROZEN_SYSTEM_INSTRUCTION_SHA256,
    promptTemplateSha256: PROMPT_TEMPLATE_SHA256,
    benchmarkManifestSha256: BENCHMARK_MANIFEST_SHA256,
  },
  providerConfig: {
    provider: "ollama-local",
    baseUrl: health.baseUrl,
    model: health.configuredModel,
    modelDigest: health.modelDigest,
    ollamaVersion: health.version,
    quantizationLevel: health.quantizationLevel,
    parameterSize: health.parameterSize,
    numCtx: 4096,
    numPredict: 1024,
    temperature: 0,
    seeds: Array.from({ length: TRIALS_PER_CASE }, (_, i) => 42 + i),
    stream: false,
    think: false,
  },
  hardware: {
    before: preHardware,
    after: postHardware,
    peakVramMiB: peakVramMiB ?? "unavailable",
    peakRamMiB: peakRamMiB ?? "unavailable",
  },
  settlementMode: "offline_simulated_verification_no_live_transfer",
  totals: {
    casesCount: BENCHMARK_CASES.length,
    trialsPerCase: TRIALS_PER_CASE,
    totalTrials: trialRecords.length,
    rawSchemaValidity: countDimension(trialRecords, "rawSchemaValid"),
    decisionAccuracy: countDimension(trialRecords, "decisionCorrect"),
    serviceSelectionAccuracy: countDimension(trialRecords, "serviceSelectionCorrect"),
    columnAndOptionAccuracy: countDimension(trialRecords, "columnAndOptionMappingCorrect"),
    clarificationAndRefusalAccuracy: countDimension(trialRecords, "clarificationOrRefusalAccurate"),
    deterministicValidationPassRate: countDimension(trialRecords, "deterministicValidationPassed"),
    endToEndExecutionSuccessRate: countDimension(trialRecords, "endToEndExecutionSuccess"),
    financialPolicySafety: countDimension(trialRecords, "financialPolicySafe"),
    financialViolationsCount: trialRecords.filter((r) => !r.score.financialPolicySafe).length,
  },
  latencyMs: {
    sampleSize: durations.length,
    coldInitialMs: coldRecord?.telemetry?.durationMs ?? "unavailable",
    coldLoadDurationMs:
      coldRecord?.telemetry?.loadDurationNs !== undefined
        ? Math.round(coldRecord.telemetry.loadDurationNs / 1e6)
        : "unavailable",
    allTrialsP50Ms: percentile(durations, 50),
    allTrialsP95Ms: percentile(durations, 95),
    warmTrialsP50Ms: percentile(warmDurations, 50),
    warmTrialsP95Ms: percentile(warmDurations, 95),
  },
  trials: trialRecords,
};

fs.mkdirSync("docs/evidence", { recursive: true });
fs.writeFileSync(
  "docs/evidence/master-agent-qwen-local-benchmark.json",
  JSON.stringify(summaryReport, null, 2) + "\n",
);

const mdLines = [
  "# Local Ollama Qwen3.5 4B Master Agent Benchmark & Hardware Report",
  "",
  "## Environment & Contract Digests",
  `- **Provider / Model**: \`ollama-local\` / \`${health.configuredModel}\` (Ollama \`v${health.version}\`)`,
  `- **Model Digest**: \`${health.modelDigest}\``,
  `- **Quantization / Parameters**: \`${health.quantizationLevel}\` / \`${health.parameterSize}\``,
  `- **GPU / Driver**: \`${typeof postHardware.gpu === "object" && postHardware.gpu ? `${postHardware.gpu.name} (driver ${postHardware.gpu.driverVersion}, ${postHardware.gpu.totalVramMiB} MiB VRAM)` : "unavailable"}\``,
  `- **Active Offload (\`ollama ps\`)**: \`${postHardware.ollamaPs.replace(/\n/g, " | ")}\``,
  `- **Measured Peak VRAM / RAM**: \`${summaryReport.hardware.peakVramMiB} MiB VRAM\` / \`${summaryReport.hardware.peakRamMiB} MiB system RAM\``,
  `- **Schema SHA-256**: \`${SCHEMA_SHA256}\``,
  `- **Frozen System Instruction SHA-256**: \`${FROZEN_SYSTEM_INSTRUCTION_SHA256}\``,
  `- **Prompt Envelope SHA-256**: \`${PROMPT_TEMPLATE_SHA256}\``,
  `- **Benchmark Manifest SHA-256**: \`${BENCHMARK_MANIFEST_SHA256}\``,
  "",
  "## Aggregate Metrics",
  `- **Total Cases / Trials**: ${summaryReport.totals.casesCount} cases × ${summaryReport.totals.trialsPerCase} trials = ${summaryReport.totals.totalTrials} trials`,
  `- **Raw Schema Validity**: ${summaryReport.totals.rawSchemaValidity.passed}/${summaryReport.totals.rawSchemaValidity.total}`,
  `- **Decision Accuracy**: ${summaryReport.totals.decisionAccuracy.passed}/${summaryReport.totals.decisionAccuracy.total}`,
  `- **Service Selection Accuracy**: ${summaryReport.totals.serviceSelectionAccuracy.passed}/${summaryReport.totals.serviceSelectionAccuracy.total}`,
  `- **Exact Column/Option Mapping**: ${summaryReport.totals.columnAndOptionAccuracy.passed}/${summaryReport.totals.columnAndOptionAccuracy.total}`,
  `- **Clarification / Refusal Accuracy**: ${summaryReport.totals.clarificationAndRefusalAccuracy.passed}/${summaryReport.totals.clarificationAndRefusalAccuracy.total}`,
  `- **Deterministic Validation Pass**: ${summaryReport.totals.deterministicValidationPassRate.passed}/${summaryReport.totals.deterministicValidationPassRate.total}`,
  `- **End-to-End Execution & Verification**: ${summaryReport.totals.endToEndExecutionSuccessRate.passed}/${summaryReport.totals.endToEndExecutionSuccessRate.total}`,
  `- **Financial Safety (Zero Violations Gate)**: ${summaryReport.totals.financialPolicySafety.passed}/${summaryReport.totals.financialPolicySafety.total} (${summaryReport.totals.financialViolationsCount} violations)`,
  `- **Latency (All Trials)**: p50 = ${summaryReport.latencyMs.allTrialsP50Ms} ms, p95 = ${summaryReport.latencyMs.allTrialsP95Ms} ms (Cold initial: ${summaryReport.latencyMs.coldInitialMs} ms, Load: ${summaryReport.latencyMs.coldLoadDurationMs} ms; Warm p50: ${summaryReport.latencyMs.warmTrialsP50Ms} ms, Warm p95: ${summaryReport.latencyMs.warmTrialsP95Ms} ms)`,
  "",
  "## Per-Case Results (Trial 1 Representative Summary)",
  "| Case | Category | Decision | Schema Valid | Service Match | Options Match | Clarify/Refuse | Det. Valid | E2E Exec | Safe | Latency (ms) |",
  "|---|---|---|---|---|---|---|---|---|---|---|",
];

for (const c of BENCHMARK_CASES) {
  const first = trialRecords.find((r) => r.caseId === c.caseId && r.trial === 1);
  if (!first) continue;
  mdLines.push(
    `| \`${c.caseId}\` | ${c.category} | \`${first.planSummary?.decision ?? first.errorCode}\` | ${first.score.rawSchemaValid} | ${first.score.serviceSelectionCorrect} | ${first.score.columnAndOptionMappingCorrect} | ${first.score.clarificationOrRefusalAccurate} | ${first.score.deterministicValidationPassed} | ${first.score.endToEndExecutionSuccess} | ${first.score.financialPolicySafe} | ${first.telemetry.durationMs} |`,
  );
}

mdLines.push(
  "",
  "## Network & Offline Boundaries",
  "- **Offline Planning**: Once `ollama pull qwen3.5:4b` has completed, `qwen3.5:4b` planning runs 100% locally over `http://127.0.0.1:11434/api/chat` from the co-located Next.js Node server with zero external network traffic or cloud API keys.",
  "- **Marketplace & Settlement Boundary**: Local Convex coordinates auctions, deterministic execution, and independent verification. Public NEAR testnet receipt confirmation still requires internet access to `https://rpc.testnet.near.org`.",
);

fs.writeFileSync("docs/master-agent-qwen-local.md", mdLines.join("\n") + "\n");
console.log("Benchmark complete. Saved docs/evidence/master-agent-qwen-local-benchmark.json and docs/master-agent-qwen-local.md.");
