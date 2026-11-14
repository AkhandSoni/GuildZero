import { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { inferGroq, InferenceError } from "@/lib/master-agent/groq";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const response = (body: object, status = 200, retryAfter?: number) => Response.json(body, {
  status, headers: { "Cache-Control": "no-store", ...(retryAfter ? { "Retry-After": String(retryAfter) } : {}) },
});

/** Bearer-only, same-origin POST. No cookies/admin credential/owner ID proxy. */
export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return response({ code: "ORIGIN_REJECTED" }, 403);
  const auth = request.headers.get("authorization");
  if (!auth?.startsWith("Bearer ") || auth.length > 8192) return response({ code: "UNAUTHENTICATED" }, 401);
  if (!request.headers.get("content-type")?.startsWith("application/json")) return response({ code: "INVALID_REQUEST" }, 400);
  let input: { runId: Id<"masterRuns">; revision: number };
  try {
    // Bound input while streaming; Content-Length is not trusted.
    const reader = request.body?.getReader();
    if (!reader) return response({ code: "INVALID_REQUEST" }, 400);
    const parts: Uint8Array[] = []; let size = 0;
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      size += next.value.length;
      if (size > 1024) { await reader.cancel(); return response({ code: "REQUEST_TOO_LARGE" }, 413); }
      parts.push(next.value);
    }
    const decoded = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!decoded || Object.keys(decoded).sort().join(",") !== "revision,runId" ||
        typeof decoded.runId !== "string" || !/^[a-z0-9]{16,64}$/.test(decoded.runId) ||
        !Number.isSafeInteger(decoded.revision) || decoded.revision < 1 || decoded.revision > 4) return response({ code: "INVALID_REQUEST" }, 400);
    input = decoded;
  } catch { return response({ code: "INVALID_REQUEST" }, 400); }
  if (!process.env.NEXT_PUBLIC_CONVEX_URL) return response({ code: "BACKEND_CONFIGURATION_REQUIRED" }, 503);
  const client = new ConvexHttpClient(process.env.NEXT_PUBLIC_CONVEX_URL, { logger: false,
    fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000), redirect: "error" }) });
  client.setAuth(auth.slice(7));
  let claim: { token: string } | undefined;
  let startPending = false;
  const start = performance.now();
  try {
    // Verify actual ownership before revealing state or consuming provider quota.
    const context = await client.query(api.masterAgent.context, { runId: input.runId });
    startPending = context.startPending === true;
    if (!process.env.GROQ_API_KEY?.trim() || !process.env.GROQ_MODEL?.trim()) {
      if (startPending) await client.mutation(api.masterStart.abortPlanning, input);
      return response({ code: "GROQ_CONFIGURATION_REQUIRED" }, 503);
    }
    const begun = await client.mutation(api.masterAgent.beginPlanning, input);
    claim = begun;
    const result = await inferGroq(begun.context, { key: process.env.GROQ_API_KEY, model: process.env.GROQ_MODEL }, request.signal);
    const finished = await client.mutation(api.masterAgent.finishPlanning, { ...input, token: begun.token,
      planJson: JSON.stringify(result.output), inference: { ...result.envelope, planningMs: Math.round(performance.now() - start) } });
    return response(finished, finished.ok ? 200 : 422);
  } catch (error) {
    const code = error instanceof InferenceError ? error.code : error instanceof ConvexError && typeof error.data === "string" && /^[A-Z_]{3,80}$/.test(error.data)
      ? error.data : "PLANNING_OR_SESSION_UNAVAILABLE";
    if (claim) {
      try { await client.mutation(api.masterAgent.finishPlanning, { ...input, token: claim.token, error: code }); }
      catch { /* A stale/expired session cannot mutate the run. Existing lease expires. */ }
    }
    if (startPending && code !== "PLANNING_NOT_AVAILABLE") {
      try { await client.mutation(api.masterStart.abortPlanning, input); } catch { /* Existing expiry/revocation remains authoritative. */ }
    }
    const retry = error instanceof InferenceError ? error.retryAfterSeconds : undefined;
    const status = code.includes("RATE_LIMIT") ? 429 : code === "UNAUTHENTICATED" ? 401 : code === "MASTER_RUN_NOT_FOUND" ? 404 : 422;
    return response({ code, ...(retry ? { retryAfterSeconds: retry } : {}) }, status, retry);
  }
}
