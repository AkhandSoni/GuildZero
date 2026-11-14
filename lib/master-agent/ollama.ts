import {
  MASTER_AGENT_PLAN_JSON_SCHEMA,
  MAX_PLAN_OUTPUT_BYTES,
  SCHEMA_SHA256,
} from "./schema";
import {
  buildMasterAgentMessages,
  PROMPT_TEMPLATE_SHA256,
  type PlanningPromptEnvelope,
} from "./prompt";

export const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
export const DEFAULT_OLLAMA_MODEL = "qwen3.5:4b";
export const DEFAULT_OLLAMA_TIMEOUT_MS = 90_000;
export const DEFAULT_OLLAMA_NUM_CTX = 4096;
export const DEFAULT_OLLAMA_NUM_PREDICT = 1024;
export const MAX_OLLAMA_ENVELOPE_BYTES = 64 * 1024;

export type OllamaErrorCode =
  | "OLLAMA_INVALID_CONFIG"
  | "OLLAMA_OFFLINE"
  | "OLLAMA_MODEL_MISSING"
  | "OLLAMA_INCOMPATIBLE_API"
  | "OLLAMA_TIMEOUT"
  | "OLLAMA_CANCELLED"
  | "OLLAMA_OUTPUT_TOO_LARGE"
  | "OLLAMA_OUTPUT_TRUNCATED"
  | "OLLAMA_RESOURCE_ERROR"
  | "OLLAMA_BUSY"
  | "OLLAMA_RATE_LIMITED";

export type InferenceTelemetryEnvelope = {
  provider: "ollama-local";
  model: string;
  modelDigest?: string;
  ollamaVersion?: string;
  schemaSha256: string;
  promptSha256: string;
  durationMs: number;
  totalDurationNs?: number;
  loadDurationNs?: number;
  promptEvalCount?: number;
  promptEvalDurationNs?: number;
  evalCount?: number;
  evalDurationNs?: number;
  numCtx: number;
  numPredict: number;
  temperature: number;
  seed: number;
  status: "ok" | "error";
  errorCode?: OllamaErrorCode;
  sanitizedError?: string;
};

export type OllamaAdapterResult =
  | {
      ok: true;
      rawContent: string;
      telemetry: InferenceTelemetryEnvelope;
    }
  | {
      ok: false;
      code: OllamaErrorCode;
      message: string;
      telemetry: InferenceTelemetryEnvelope;
    };

export type ValidatedOllamaConfig = {
  baseUrl: string;
  model: string;
  numCtx: number;
  numPredict: number;
  timeoutMs: number;
};

const ALLOWED_LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * Validates and normalizes server-only Ollama configuration.
 * Rejects non-local origins, credentials, paths, query strings, and non-HTTP schemes to prevent SSRF.
 */
export function resolveOllamaConfig(
  env: Record<string, string | undefined> = process.env,
): { ok: true; value: ValidatedOllamaConfig } | { ok: false; code: "OLLAMA_INVALID_CONFIG"; message: string } {
  const rawUrl = (env.OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL).trim();
  const rawModel = (env.OLLAMA_MODEL ?? DEFAULT_OLLAMA_MODEL).trim();

  if (!rawModel || rawModel.length > 64 || !/^[a-zA-Z0-9._:-]+$/.test(rawModel)) {
    return {
      ok: false,
      code: "OLLAMA_INVALID_CONFIG",
      message: "OLLAMA_MODEL must be a valid local model tag (default qwen3.5:4b).",
    };
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return {
      ok: false,
      code: "OLLAMA_INVALID_CONFIG",
      message: "OLLAMA_BASE_URL is not a valid URL.",
    };
  }

  if (parsed.protocol !== "http:") {
    return {
      ok: false,
      code: "OLLAMA_INVALID_CONFIG",
      message: "OLLAMA_BASE_URL must use http:// on an allowlisted localhost address.",
    };
  }
  if (parsed.username || parsed.password) {
    return {
      ok: false,
      code: "OLLAMA_INVALID_CONFIG",
      message: "OLLAMA_BASE_URL must not contain credentials.",
    };
  }
  if (!ALLOWED_LOCAL_HOSTS.has(parsed.hostname.toLowerCase())) {
    return {
      ok: false,
      code: "OLLAMA_INVALID_CONFIG",
      message: "OLLAMA_BASE_URL must target 127.0.0.1, localhost, or [::1]. Cloud or remote hosts are forbidden.",
    };
  }
  if ((parsed.pathname && parsed.pathname !== "/") || parsed.search || parsed.hash) {
    return {
      ok: false,
      code: "OLLAMA_INVALID_CONFIG",
      message: "OLLAMA_BASE_URL must be a bare origin without path, query, or fragment.",
    };
  }

  const port = parsed.port ? Number(parsed.port) : 11434;
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535) {
    return {
      ok: false,
      code: "OLLAMA_INVALID_CONFIG",
      message: "OLLAMA_BASE_URL port must be between 1 and 65535.",
    };
  }

  return {
    ok: true,
    value: {
      baseUrl: `${parsed.protocol}//${parsed.hostname}:${port}`,
      model: rawModel,
      numCtx: DEFAULT_OLLAMA_NUM_CTX,
      numPredict: DEFAULT_OLLAMA_NUM_PREDICT,
      timeoutMs: DEFAULT_OLLAMA_TIMEOUT_MS,
    },
  };
}

let activeInferenceLock = false;
const userLastRequestAt = new Map<string, number>();
const MIN_REQUEST_INTERVAL_MS = 1500;

export function resetOllamaRateLimitersForTest(): void {
  activeInferenceLock = false;
  userLastRequestAt.clear();
}

async function readBoundedText(
  response: Response,
  maxBytes: number,
): Promise<{ ok: true; text: string } | { ok: false; code: "OLLAMA_OUTPUT_TOO_LARGE"; message: string }> {
  if (!response.body) {
    const text = await response.text();
    const len = new TextEncoder().encode(text).length;
    if (len > maxBytes) {
      return {
        ok: false,
        code: "OLLAMA_OUTPUT_TOO_LARGE",
        message: `Response from local Ollama exceeded ${maxBytes} bytes.`,
      };
    }
    return { ok: true, text };
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          return {
            ok: false,
            code: "OLLAMA_OUTPUT_TOO_LARGE",
            message: `Response from local Ollama exceeded ${maxBytes} bytes.`,
          };
        }
        chunks.push(value);
      }
    }
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder("utf-8", { fatal: false }).decode(merged) };
}

export type OllamaHealthStatus = {
  reachable: boolean;
  baseUrl: string;
  configuredModel: string;
  version: string | null;
  modelAvailable: boolean;
  modelDigest: string | null;
  quantizationLevel: string | null;
  parameterSize: string | null;
  errorCode?: OllamaErrorCode;
  message: string;
};

export async function probeLocalOllamaHealth(
  options?: {
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  },
): Promise<OllamaHealthStatus> {
  const cfg = resolveOllamaConfig(options?.env);
  if (!cfg.ok) {
    return {
      reachable: false,
      baseUrl: DEFAULT_OLLAMA_BASE_URL,
      configuredModel: DEFAULT_OLLAMA_MODEL,
      version: null,
      modelAvailable: false,
      modelDigest: null,
      quantizationLevel: null,
      parameterSize: null,
      errorCode: cfg.code,
      message: cfg.message,
    };
  }

  const { baseUrl, model } = cfg.value;
  const fetchFn = options?.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options?.timeoutMs ?? 5000);

  try {
    const versionRes = await fetchFn(`${baseUrl}/api/version`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (!versionRes.ok) {
      return {
        reachable: false,
        baseUrl,
        configuredModel: model,
        version: null,
        modelAvailable: false,
        modelDigest: null,
        quantizationLevel: null,
        parameterSize: null,
        errorCode: "OLLAMA_INCOMPATIBLE_API",
        message: `Local Ollama /api/version returned HTTP ${versionRes.status}. Ensure a current Ollama release is running on localhost.`,
      };
    }
    const versionText = await readBoundedText(versionRes, 8192);
    if (!versionText.ok) {
      return {
        reachable: false,
        baseUrl,
        configuredModel: model,
        version: null,
        modelAvailable: false,
        modelDigest: null,
        quantizationLevel: null,
        parameterSize: null,
        errorCode: versionText.code,
        message: versionText.message,
      };
    }
    const versionJson = JSON.parse(versionText.text) as { version?: unknown };
    const version = typeof versionJson.version === "string" ? versionJson.version : null;

    const tagsRes = await fetchFn(`${baseUrl}/api/tags`, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
    });
    if (!tagsRes.ok) {
      return {
        reachable: true,
        baseUrl,
        configuredModel: model,
        version,
        modelAvailable: false,
        modelDigest: null,
        quantizationLevel: null,
        parameterSize: null,
        errorCode: "OLLAMA_INCOMPATIBLE_API",
        message: `Local Ollama /api/tags returned HTTP ${tagsRes.status}.`,
      };
    }
    const tagsText = await readBoundedText(tagsRes, 65536);
    if (!tagsText.ok) {
      return {
        reachable: true,
        baseUrl,
        configuredModel: model,
        version,
        modelAvailable: false,
        modelDigest: null,
        quantizationLevel: null,
        parameterSize: null,
        errorCode: tagsText.code,
        message: tagsText.message,
      };
    }
    const tagsJson = JSON.parse(tagsText.text) as {
      models?: Array<{
        name?: string;
        model?: string;
        digest?: string;
        details?: { quantization_level?: string; parameter_size?: string };
      }>;
    };
    const matched = (tagsJson.models ?? []).find(
      (m) => m.name === model || m.model === model,
    );
    if (!matched) {
      return {
        reachable: true,
        baseUrl,
        configuredModel: model,
        version,
        modelAvailable: false,
        modelDigest: null,
        quantizationLevel: null,
        parameterSize: null,
        errorCode: "OLLAMA_MODEL_MISSING",
        message: `Model "${model}" is not pulled in local Ollama. Run: ollama pull ${model}`,
      };
    }

    return {
      reachable: true,
      baseUrl,
      configuredModel: model,
      version,
      modelAvailable: true,
      modelDigest: typeof matched.digest === "string" ? matched.digest : null,
      quantizationLevel: matched.details?.quantization_level ?? null,
      parameterSize: matched.details?.parameter_size ?? null,
      message: `Local Ollama v${version ?? "unknown"} ready with ${model}.`,
    };
  } catch (error) {
    const isAbort = error instanceof Error && error.name === "AbortError";
    return {
      reachable: false,
      baseUrl,
      configuredModel: model,
      version: null,
      modelAvailable: false,
      modelDigest: null,
      quantizationLevel: null,
      parameterSize: null,
      errorCode: isAbort ? "OLLAMA_TIMEOUT" : "OLLAMA_OFFLINE",
      message: isAbort
        ? `Timed out connecting to local Ollama at ${baseUrl}.`
        : `Local Ollama is not reachable at ${baseUrl}. Start it with "ollama serve" and ensure "ollama pull ${model}" has completed on the same machine running Next.js.`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runOllamaMasterAgentInference(
  envelope: PlanningPromptEnvelope,
  options?: {
    ownerRateLimitKey?: string;
    signal?: AbortSignal;
    env?: Record<string, string | undefined>;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
    numCtx?: number;
    numPredict?: number;
    temperature?: number;
    seed?: number;
    skipRateLimit?: boolean;
  },
): Promise<OllamaAdapterResult> {
  const startedAt = Date.now();
  const cfgResult = resolveOllamaConfig(options?.env);
  const numCtx = options?.numCtx ?? DEFAULT_OLLAMA_NUM_CTX;
  const numPredict = options?.numPredict ?? DEFAULT_OLLAMA_NUM_PREDICT;
  const temperature = options?.temperature ?? 0;
  const seed = options?.seed ?? 42;

  const baseTelemetry = (
    model: string,
    status: "ok" | "error",
    extra?: Partial<InferenceTelemetryEnvelope>,
  ): InferenceTelemetryEnvelope => ({
    provider: "ollama-local",
    model,
    schemaSha256: SCHEMA_SHA256,
    promptSha256: PROMPT_TEMPLATE_SHA256,
    durationMs: Math.max(0, Date.now() - startedAt),
    numCtx,
    numPredict,
    temperature,
    seed,
    status,
    ...extra,
  });

  if (!cfgResult.ok) {
    return {
      ok: false,
      code: cfgResult.code,
      message: cfgResult.message,
      telemetry: baseTelemetry(DEFAULT_OLLAMA_MODEL, "error", {
        errorCode: cfgResult.code,
        sanitizedError: cfgResult.message,
      }),
    };
  }

  const { baseUrl, model } = cfgResult.value;
  const timeoutMs = options?.timeoutMs ?? cfgResult.value.timeoutMs;

  if (!options?.skipRateLimit && options?.ownerRateLimitKey) {
    const prev = userLastRequestAt.get(options.ownerRateLimitKey) ?? 0;
    if (startedAt - prev < MIN_REQUEST_INTERVAL_MS) {
      const msg = "Please wait a moment before starting another local planning request.";
      return {
        ok: false,
        code: "OLLAMA_RATE_LIMITED",
        message: msg,
        telemetry: baseTelemetry(model, "error", {
          errorCode: "OLLAMA_RATE_LIMITED",
          sanitizedError: msg,
        }),
      };
    }
    userLastRequestAt.set(options.ownerRateLimitKey, startedAt);
  }

  if (activeInferenceLock) {
    const msg =
      "Another local Ollama inference is currently running on this GPU. Wait for it to finish before requesting a new plan.";
    return {
      ok: false,
      code: "OLLAMA_BUSY",
      message: msg,
      telemetry: baseTelemetry(model, "error", {
        errorCode: "OLLAMA_BUSY",
        sanitizedError: msg,
      }),
    };
  }

  activeInferenceLock = true;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  const onExternalAbort = () => controller.abort();
  options?.signal?.addEventListener("abort", onExternalAbort, { once: true });

  try {
    if (options?.signal?.aborted) {
      const msg = "Inference request was cancelled.";
      return {
        ok: false,
        code: "OLLAMA_CANCELLED",
        message: msg,
        telemetry: baseTelemetry(model, "error", {
          errorCode: "OLLAMA_CANCELLED",
          sanitizedError: msg,
        }),
      };
    }

    const fetchFn = options?.fetchImpl ?? fetch;
    const messages = buildMasterAgentMessages(envelope);

    // Optional lightweight health/digest check before chat call
    let modelDigest: string | undefined;
    let ollamaVersion: string | undefined;
    try {
      const health = await probeLocalOllamaHealth({
        env: options?.env,
        fetchImpl: fetchFn,
        timeoutMs: Math.min(3000, timeoutMs),
      });
      if (health.version) ollamaVersion = health.version;
      if (health.modelDigest) modelDigest = health.modelDigest;
    } catch {
      // Proceed to /api/chat which will return the authoritative error if offline
    }

    const requestBody = JSON.stringify({
      model,
      messages: [
        { role: "system", content: messages.system },
        { role: "user", content: messages.user },
      ],
      format: MASTER_AGENT_PLAN_JSON_SCHEMA,
      stream: false,
      think: false,
      options: {
        temperature,
        num_ctx: numCtx,
        num_predict: numPredict,
        seed,
      },
    });

    const response = await fetchFn(`${baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: requestBody,
      redirect: "error",
      signal: controller.signal,
    });

    const bounded = await readBoundedText(response, MAX_OLLAMA_ENVELOPE_BYTES);
    if (!bounded.ok) {
      return {
        ok: false,
        code: bounded.code,
        message: bounded.message,
        telemetry: baseTelemetry(model, "error", {
          modelDigest,
          ollamaVersion,
          errorCode: bounded.code,
          sanitizedError: bounded.message,
        }),
      };
    }

    if (!response.ok) {
      let errText = "";
      try {
        const parsedErr = JSON.parse(bounded.text) as { error?: unknown };
        if (typeof parsedErr.error === "string") errText = parsedErr.error;
      } catch {
        errText = bounded.text.slice(0, 200);
      }
      const lower = errText.toLowerCase();
      if (response.status === 404 || lower.includes("not found")) {
        const msg = `Local Ollama model "${model}" is not installed. Run "ollama pull ${model}" on this machine and try again.`;
        return {
          ok: false,
          code: "OLLAMA_MODEL_MISSING",
          message: msg,
          telemetry: baseTelemetry(model, "error", {
            modelDigest,
            ollamaVersion,
            errorCode: "OLLAMA_MODEL_MISSING",
            sanitizedError: msg,
          }),
        };
      }
      if (
        lower.includes("memory") ||
        lower.includes("oom") ||
        lower.includes("cuda") ||
        lower.includes("vram") ||
        response.status === 500
      ) {
        const msg = `Local Ollama could not load or evaluate "${model}" within available GPU/RAM resources (HTTP ${response.status}). Check "ollama ps" and VRAM usage.`;
        return {
          ok: false,
          code: "OLLAMA_RESOURCE_ERROR",
          message: msg,
          telemetry: baseTelemetry(model, "error", {
            modelDigest,
            ollamaVersion,
            errorCode: "OLLAMA_RESOURCE_ERROR",
            sanitizedError: msg,
          }),
        };
      }
      const msg = `Local Ollama returned HTTP ${response.status}. Verify Ollama compatibility and model readiness.`;
      return {
        ok: false,
        code: "OLLAMA_INCOMPATIBLE_API",
        message: msg,
        telemetry: baseTelemetry(model, "error", {
          modelDigest,
          ollamaVersion,
          errorCode: "OLLAMA_INCOMPATIBLE_API",
          sanitizedError: msg,
        }),
      };
    }

    let payload: Record<string, unknown>;
    try {
      const parsed = JSON.parse(bounded.text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("Non-object response");
      }
      payload = parsed as Record<string, unknown>;
    } catch {
      const msg = "Local Ollama returned malformed JSON from /api/chat.";
      return {
        ok: false,
        code: "OLLAMA_INCOMPATIBLE_API",
        message: msg,
        telemetry: baseTelemetry(model, "error", {
          modelDigest,
          ollamaVersion,
          errorCode: "OLLAMA_INCOMPATIBLE_API",
          sanitizedError: msg,
        }),
      };
    }

    const numOrUndef = (v: unknown): number | undefined =>
      typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;

    const timingFields = {
      modelDigest,
      ollamaVersion,
      totalDurationNs: numOrUndef(payload.total_duration),
      loadDurationNs: numOrUndef(payload.load_duration),
      promptEvalCount: numOrUndef(payload.prompt_eval_count),
      promptEvalDurationNs: numOrUndef(payload.prompt_eval_duration),
      evalCount: numOrUndef(payload.eval_count),
      evalDurationNs: numOrUndef(payload.eval_duration),
    };

    if (payload.done !== true || payload.done_reason === "length") {
      const msg =
        "Local Ollama generation was truncated before completing the JSON object. Narrow the request or reduce step complexity.";
      return {
        ok: false,
        code: "OLLAMA_OUTPUT_TRUNCATED",
        message: msg,
        telemetry: baseTelemetry(model, "error", {
          ...timingFields,
          errorCode: "OLLAMA_OUTPUT_TRUNCATED",
          sanitizedError: msg,
        }),
      };
    }

    // Extract strictly from message.content; never execute or scrape message.thinking.
    const messageObj =
      payload.message && typeof payload.message === "object" && !Array.isArray(payload.message)
        ? (payload.message as Record<string, unknown>)
        : null;
    const rawContent = messageObj && typeof messageObj.content === "string" ? messageObj.content.trim() : "";

    if (!rawContent) {
      const msg = "Local Ollama returned an empty message.content payload.";
      return {
        ok: false,
        code: "OLLAMA_OUTPUT_TRUNCATED",
        message: msg,
        telemetry: baseTelemetry(model, "error", {
          ...timingFields,
          errorCode: "OLLAMA_OUTPUT_TRUNCATED",
          sanitizedError: msg,
        }),
      };
    }

    const contentBytes = new TextEncoder().encode(rawContent).length;
    if (contentBytes > MAX_PLAN_OUTPUT_BYTES) {
      const msg = "Decoded plan content exceeded the 32 KiB limit.";
      return {
        ok: false,
        code: "OLLAMA_OUTPUT_TOO_LARGE",
        message: msg,
        telemetry: baseTelemetry(model, "error", {
          ...timingFields,
          errorCode: "OLLAMA_OUTPUT_TOO_LARGE",
          sanitizedError: msg,
        }),
      };
    }

    return {
      ok: true,
      rawContent,
      telemetry: baseTelemetry(model, "ok", timingFields),
    };
  } catch (error) {
    const isAbort =
      (error instanceof Error && error.name === "AbortError") ||
      controller.signal.aborted;
    const code: OllamaErrorCode = timedOut
      ? "OLLAMA_TIMEOUT"
      : isAbort
        ? "OLLAMA_CANCELLED"
        : "OLLAMA_OFFLINE";
    const msg =
      code === "OLLAMA_TIMEOUT"
        ? `Local Ollama inference timed out after ${Math.round(timeoutMs / 1000)}s.`
        : code === "OLLAMA_CANCELLED"
          ? "Local Ollama inference was cancelled."
          : `Could not reach local Ollama at ${baseUrl}. Ensure "ollama serve" is running locally alongside Next.js and "${model}" is pulled.`;
    return {
      ok: false,
      code,
      message: msg,
      telemetry: baseTelemetry(model, "error", {
        errorCode: code,
        sanitizedError: msg,
      }),
    };
  } finally {
    clearTimeout(timer);
    options?.signal?.removeEventListener("abort", onExternalAbort);
    activeInferenceLock = false;
  }
}
