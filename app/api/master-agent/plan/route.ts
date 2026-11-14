import { NextResponse, type NextRequest } from "next/server";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  probeLocalOllamaHealth,
  runOllamaMasterAgentInference,
} from "@/lib/master-agent/ollama";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization") ?? "";
  const match = /^Bearer\s+([A-Za-z0-9._~+/-]+=*)$/.exec(header.trim());
  if (!match || match[1].length < 16 || match[1].length > 4096) {
    return null;
  }
  return match[1];
}

function checkSameOriginRequest(request: NextRequest): boolean {
  const secFetchSite = request.headers.get("sec-fetch-site");
  if (secFetchSite && secFetchSite !== "same-origin" && secFetchSite !== "none") {
    return false;
  }
  const origin = request.headers.get("origin");
  const host = request.headers.get("host");
  if (origin && host) {
    try {
      const parsedOrigin = new URL(origin);
      if (parsedOrigin.host !== host) return false;
    } catch {
      return false;
    }
  }
  return true;
}

function createAuthenticatedConvexClient(token: string): ConvexHttpClient | null {
  const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL;
  if (!convexUrl) return null;
  const client = new ConvexHttpClient(convexUrl);
  client.setAuth(token);
  return client;
}

export async function GET(request: NextRequest) {
  if (!checkSameOriginRequest(request)) {
    return NextResponse.json({ ok: false, code: "FORBIDDEN_ORIGIN", message: "Cross-origin requests are denied." }, { status: 403 });
  }
  const token = extractBearerToken(request);
  if (!token) {
    return NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "Sign in to check local planner status." }, { status: 401 });
  }
  const client = createAuthenticatedConvexClient(token);
  if (!client) {
    return NextResponse.json({ ok: false, code: "CONVEX_NOT_CONFIGURED", message: "NEXT_PUBLIC_CONVEX_URL is not configured." }, { status: 503 });
  }
  try {
    const isAuthenticated = await client.query(api.auth.isAuthenticated, {});
    if (!isAuthenticated) {
      return NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "Session is invalid or expired." }, { status: 401 });
    }
  } catch {
    return NextResponse.json({ ok: false, code: "UNAUTHENTICATED", message: "Could not verify Convex session." }, { status: 401 });
  }

  const health = await probeLocalOllamaHealth();
  return NextResponse.json({
    ok: health.reachable && health.modelAvailable,
    health,
  });
}

export async function POST(request: NextRequest) {
  if (!checkSameOriginRequest(request)) {
    return NextResponse.json(
      { ok: false, code: "FORBIDDEN_ORIGIN", message: "Cross-origin requests are denied." },
      { status: 403 },
    );
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("application/json")) {
    return NextResponse.json(
      { ok: false, code: "INVALID_CONTENT_TYPE", message: "Content-Type must be application/json." },
      { status: 415 },
    );
  }
  const token = extractBearerToken(request);
  if (!token) {
    return NextResponse.json(
      { ok: false, code: "UNAUTHENTICATED", message: "Authentication token is required." },
      { status: 401 },
    );
  }
  const client = createAuthenticatedConvexClient(token);
  if (!client) {
    return NextResponse.json(
      { ok: false, code: "CONVEX_NOT_CONFIGURED", message: "NEXT_PUBLIC_CONVEX_URL is not configured." },
      { status: 503 },
    );
  }

  let bodyText: string;
  try {
    bodyText = await request.text();
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", message: "Could not read request body." },
      { status: 400 },
    );
  }
  if (!bodyText || bodyText.length > 16384) {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", message: "Request body must be 1–16,384 bytes." },
      { status: 400 },
    );
  }

  let parsedBody: Record<string, unknown>;
  try {
    const raw = JSON.parse(bodyText);
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error("Expected JSON object");
    }
    parsedBody = raw as Record<string, unknown>;
  } catch {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", message: "Request body must be a valid JSON object." },
      { status: 400 },
    );
  }

  // Reject any attempt to supply server-controlled parameters (baseUrl, model, ownerId)
  if ("baseUrl" in parsedBody || "model" in parsedBody || "ownerId" in parsedBody) {
    return NextResponse.json(
      {
        ok: false,
        code: "FORBIDDEN_PARAMETER",
        message: "Endpoint, model, and owner identity are controlled exclusively by the server.",
      },
      { status: 400 },
    );
  }

  const runId = typeof parsedBody.runId === "string" ? parsedBody.runId.trim() : "";
  const requestId =
    typeof parsedBody.requestId === "string" && parsedBody.requestId.trim()
      ? parsedBody.requestId.trim()
      : undefined;

  if (!runId || runId.length > 128) {
    return NextResponse.json(
      { ok: false, code: "INVALID_INPUT", message: "Valid runId is required." },
      { status: 400 },
    );
  }

  let planningContext: Awaited<ReturnType<typeof client.query<typeof api.masterAgent.getPlanningContext>>>;
  try {
    planningContext = await client.query(api.masterAgent.getPlanningContext, {
      runId: runId as Id<"masterAgentRuns">,
      ...(requestId ? { requestId } : {}),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load planning context.";
    const isUnauth = message.includes("UNAUTHENTICATED");
    const isNotFound = message.includes("RUN_NOT_FOUND");
    return NextResponse.json(
      {
        ok: false,
        code: isUnauth ? "UNAUTHENTICATED" : isNotFound ? "RUN_NOT_FOUND" : "PLANNING_CONTEXT_ERROR",
        message: isUnauth
          ? "Session is not authenticated."
          : isNotFound
            ? "Master Agent run not found or access denied."
            : "Planning request is no longer active.",
      },
      { status: isUnauth ? 401 : isNotFound ? 404 : 409 },
    );
  }

  const inferenceResult = await runOllamaMasterAgentInference(planningContext.envelope, {
    ownerRateLimitKey: String(planningContext.runId),
    signal: request.signal,
  });

  try {
    const recorded = await client.mutation(api.masterAgent.recordPlanResult, {
      runId: planningContext.runId,
      requestId: planningContext.requestId,
      ...(inferenceResult.ok ? { rawPlanJson: inferenceResult.rawContent } : {}),
      inferenceEnvelope: {
        provider: inferenceResult.telemetry.provider,
        model: inferenceResult.telemetry.model,
        ...(inferenceResult.telemetry.modelDigest ? { modelDigest: inferenceResult.telemetry.modelDigest } : {}),
        ...(inferenceResult.telemetry.ollamaVersion ? { ollamaVersion: inferenceResult.telemetry.ollamaVersion } : {}),
        schemaSha256: inferenceResult.telemetry.schemaSha256,
        promptSha256: inferenceResult.telemetry.promptSha256,
        durationMs: inferenceResult.telemetry.durationMs,
        ...(inferenceResult.telemetry.totalDurationNs !== undefined
          ? { totalDurationNs: inferenceResult.telemetry.totalDurationNs }
          : {}),
        ...(inferenceResult.telemetry.loadDurationNs !== undefined
          ? { loadDurationNs: inferenceResult.telemetry.loadDurationNs }
          : {}),
        ...(inferenceResult.telemetry.promptEvalCount !== undefined
          ? { promptEvalCount: inferenceResult.telemetry.promptEvalCount }
          : {}),
        ...(inferenceResult.telemetry.promptEvalDurationNs !== undefined
          ? { promptEvalDurationNs: inferenceResult.telemetry.promptEvalDurationNs }
          : {}),
        ...(inferenceResult.telemetry.evalCount !== undefined
          ? { evalCount: inferenceResult.telemetry.evalCount }
          : {}),
        ...(inferenceResult.telemetry.evalDurationNs !== undefined
          ? { evalDurationNs: inferenceResult.telemetry.evalDurationNs }
          : {}),
        numCtx: inferenceResult.telemetry.numCtx,
        numPredict: inferenceResult.telemetry.numPredict,
        temperature: inferenceResult.telemetry.temperature,
        seed: inferenceResult.telemetry.seed,
        status: inferenceResult.telemetry.status,
        ...(inferenceResult.telemetry.errorCode ? { errorCode: inferenceResult.telemetry.errorCode } : {}),
        ...(inferenceResult.telemetry.sanitizedError
          ? { sanitizedError: inferenceResult.telemetry.sanitizedError }
          : {}),
      },
    });

    return NextResponse.json({
      ok: inferenceResult.ok && recorded.state !== "failed",
      state: recorded.state,
      planHash: recorded.planHash,
      validationError: recorded.validationError,
      telemetry: inferenceResult.telemetry,
    });
  } catch {
    return NextResponse.json(
      {
        ok: false,
        code: "PERSISTENCE_FAILED",
        message: "Could not persist Master Agent planning result.",
      },
      { status: 500 },
    );
  }
}
