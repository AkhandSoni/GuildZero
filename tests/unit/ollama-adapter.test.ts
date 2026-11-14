import { beforeEach, describe, expect, it } from "vitest";
import {
  BENCHMARK_FIXTURES,
  MASTER_AGENT_SCHEMA_VERSION,
  inspectDatasetMetadata,
  probeLocalOllamaHealth,
  resetOllamaRateLimitersForTest,
  resolveOllamaConfig,
  runOllamaMasterAgentInference,
  type PlanningPromptEnvelope,
} from "../../lib/master-agent";
import { nearToYocto } from "../../lib/money";

function sampleEnvelope(): PlanningPromptEnvelope {
  return {
    userPrompt: "Give summary statistics for units and revenue.",
    maxBudgetYocto: nearToYocto("1"),
    requiresHumanReview: false,
    datasets: [
      inspectDatasetMetadata("d1", BENCHMARK_FIXTURES.F1.name, BENCHMARK_FIXTURES.F1.csv),
    ],
  };
}

describe("Local Ollama Qwen3.5 4B adapter & SSRF/resource boundaries", () => {
  beforeEach(() => {
    resetOllamaRateLimitersForTest();
  });

  it("enforces strict localhost origin allowlist and rejects SSRF, credentials, paths, and remote hosts", () => {
    expect(resolveOllamaConfig({}).ok).toBe(true);
    expect(
      resolveOllamaConfig({
        OLLAMA_BASE_URL: "http://127.0.0.1:11434",
        OLLAMA_MODEL: "qwen3.5:4b",
      }).ok,
    ).toBe(true);
    expect(
      resolveOllamaConfig({
        OLLAMA_BASE_URL: "http://localhost:11434",
        OLLAMA_MODEL: "qwen3.5:4b",
      }).ok,
    ).toBe(true);

    // Rejects remote host
    expect(resolveOllamaConfig({ OLLAMA_BASE_URL: "http://10.0.0.5:11434" }).ok).toBe(false);
    expect(resolveOllamaConfig({ OLLAMA_BASE_URL: "https://api.ollama.com" }).ok).toBe(false);

    // Rejects credentials
    expect(resolveOllamaConfig({ OLLAMA_BASE_URL: "http://user:pass@127.0.0.1:11434" }).ok).toBe(
      false,
    );

    // Rejects path/query/hash
    expect(resolveOllamaConfig({ OLLAMA_BASE_URL: "http://127.0.0.1:11434/proxy" }).ok).toBe(false);
    expect(resolveOllamaConfig({ OLLAMA_BASE_URL: "http://127.0.0.1:11434?redirect=1" }).ok).toBe(
      false,
    );

    // Rejects invalid model tag
    expect(resolveOllamaConfig({ OLLAMA_MODEL: "../bad/model" }).ok).toBe(false);
  });

  it("handles offline Ollama, missing model, truncated output, and ignores message.thinking", async () => {
    // 1. Offline connection failure
    const offlineRes = await runOllamaMasterAgentInference(sampleEnvelope(), {
      fetchImpl: (async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:11434");
      }) as typeof fetch,
    });
    expect(offlineRes.ok).toBe(false);
    if (!offlineRes.ok) {
      expect(offlineRes.code).toBe("OLLAMA_OFFLINE");
    }

    // 2. Missing model (404)
    resetOllamaRateLimitersForTest();
    const missingModelRes = await runOllamaMasterAgentInference(sampleEnvelope(), {
      fetchImpl: (async (url) => {
        if (String(url).endsWith("/api/chat")) {
          return new Response(JSON.stringify({ error: 'model "qwen3.5:4b" not found' }), {
            status: 404,
          });
        }
        return new Response(JSON.stringify({ version: "0.40.16", models: [] }), { status: 200 });
      }) as typeof fetch,
    });
    expect(missingModelRes.ok).toBe(false);
    if (!missingModelRes.ok) {
      expect(missingModelRes.code).toBe("OLLAMA_MODEL_MISSING");
    }

    // 3. Truncated output (done_reason: "length")
    resetOllamaRateLimitersForTest();
    const truncatedRes = await runOllamaMasterAgentInference(sampleEnvelope(), {
      fetchImpl: (async (url) => {
        if (String(url).endsWith("/api/chat")) {
          return new Response(
            JSON.stringify({
              done: true,
              done_reason: "length",
              message: { role: "assistant", content: '{"schemaVersion":' },
            }),
            { status: 200 },
          );
        }
        return new Response(JSON.stringify({ version: "0.40.16", models: [] }), { status: 200 });
      }) as typeof fetch,
    });
    expect(truncatedRes.ok).toBe(false);
    if (!truncatedRes.ok) {
      expect(truncatedRes.code).toBe("OLLAMA_OUTPUT_TRUNCATED");
    }

    // 4. Valid completion with message.thinking present (must extract message.content only)
    resetOllamaRateLimitersForTest();
    const validPlanJson = JSON.stringify({
      schemaVersion: MASTER_AGENT_SCHEMA_VERSION,
      decision: "clarify",
      summary: "Clarify which column to summarize.",
      questions: ["Which numeric column should be summarized?"],
      reasonCodes: ["AMBIGUOUS_REQUEST"],
      proposedTotalBudgetYocto: null,
      steps: [],
    });

    const okRes = await runOllamaMasterAgentInference(sampleEnvelope(), {
      fetchImpl: (async (url, init) => {
        if (String(url).endsWith("/api/chat")) {
          const parsedReq = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          expect(parsedReq.stream).toBe(false);
          expect(parsedReq.think).toBe(false);
          expect(parsedReq.format).toBeDefined();
          return new Response(
            JSON.stringify({
              done: true,
              done_reason: "stop",
              total_duration: 500_000_000,
              load_duration: 50_000_000,
              prompt_eval_count: 420,
              eval_count: 95,
              message: {
                role: "assistant",
                thinking: "DO NOT EXECUTE THIS THOUGHT OR SCRAPE JSON FROM HERE",
                content: validPlanJson,
              },
            }),
            { status: 200 },
          );
        }
        if (String(url).endsWith("/api/version")) {
          return new Response(JSON.stringify({ version: "0.40.16" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            models: [{ name: "qwen3.5:4b", digest: "sha256:d8b0f5e9" }],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });

    expect(okRes.ok).toBe(true);
    if (okRes.ok) {
      expect(okRes.rawContent).toBe(validPlanJson);
      expect(okRes.telemetry.provider).toBe("ollama-local");
      expect(okRes.telemetry.model).toBe("qwen3.5:4b");
      expect(okRes.telemetry.promptEvalCount).toBe(420);
      expect(okRes.telemetry.evalCount).toBe(95);
    }
  });

  it("enforces single-concurrent-inference lock and per-owner rate limiting", async () => {
    let resolveSlow: (() => void) | null = null;
    const slowFetch = (async (url: RequestInfo | URL) => {
      if (String(url).endsWith("/api/chat")) {
        await new Promise<void>((r) => {
          resolveSlow = r;
        });
        return new Response(
          JSON.stringify({
            done: true,
            done_reason: "stop",
            message: { role: "assistant", content: "{}" },
          }),
          { status: 200 },
        );
      }
      return new Response(JSON.stringify({ version: "0.40.16", models: [] }), { status: 200 });
    }) as typeof fetch;

    const firstPromise = runOllamaMasterAgentInference(sampleEnvelope(), {
      ownerRateLimitKey: "user-1",
      fetchImpl: slowFetch,
    });

    // Give firstPromise a microtask tick to enter the lock
    await new Promise((r) => setTimeout(r, 10));

    const concurrentRes = await runOllamaMasterAgentInference(sampleEnvelope(), {
      ownerRateLimitKey: "user-2",
      fetchImpl: slowFetch,
    });
    expect(concurrentRes.ok).toBe(false);
    if (!concurrentRes.ok) {
      expect(concurrentRes.code).toBe("OLLAMA_BUSY");
    }

    if (resolveSlow) (resolveSlow as () => void)();
    await firstPromise;

    // Immediate second call from same owner hits rate limit
    const rateLimited = await runOllamaMasterAgentInference(sampleEnvelope(), {
      ownerRateLimitKey: "user-1",
      fetchImpl: slowFetch,
    });
    expect(rateLimited.ok).toBe(false);
    if (!rateLimited.ok) {
      expect(rateLimited.code).toBe("OLLAMA_RATE_LIMITED");
    }
  });

  it("probes local Ollama health and reports model availability", async () => {
    const health = await probeLocalOllamaHealth({
      fetchImpl: (async (url) => {
        if (String(url).endsWith("/api/version")) {
          return new Response(JSON.stringify({ version: "0.40.16" }), { status: 200 });
        }
        return new Response(
          JSON.stringify({
            models: [
              {
                name: "qwen3.5:4b",
                digest: "d8b0f5e9760cd1682034f292d7ef72ec46f432149be0df7574bf2d6e92e38c04",
                details: { quantization_level: "Q4_K_M", parameter_size: "4.2B" },
              },
            ],
          }),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    expect(health.reachable).toBe(true);
    expect(health.modelAvailable).toBe(true);
    expect(health.version).toBe("0.40.16");
    expect(health.quantizationLevel).toBe("Q4_K_M");
  });
});
