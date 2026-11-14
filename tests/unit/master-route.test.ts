// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
const f = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), setAuth: vi.fn(), infer: vi.fn() }));
vi.mock("convex/browser", () => ({ ConvexHttpClient: class { query = f.query; mutation = f.mutation; setAuth = f.setAuth; } }));
vi.mock("../../lib/master-agent/groq", async original => {
  const implementation = await original<typeof import("../../lib/master-agent/groq")>();
  return { ...implementation, inferGroq: f.infer };
});
import { POST } from "../../app/api/master-agent/plan/route";
import { masterFixture } from "../helpers/master-fixtures";
import { InferenceError } from "../../lib/master-agent/groq";
const id = "a".repeat(32);
function request(body: unknown = { runId: id, revision: 1 }, headers: Record<string, string> = {}) {
  return new Request("http://localhost:3001/api/master-agent/plan", { method: "POST", headers: { origin: "http://localhost:3001", "content-type": "application/json", authorization: "Bearer fixture-user-session", ...headers }, body: JSON.stringify(body) });
}
function configure() {
  vi.stubEnv("GROQ_API_KEY", "nonsecret-test-key"); vi.stubEnv("GROQ_MODEL", "fixture-model"); vi.stubEnv("NEXT_PUBLIC_CONVEX_URL", "https://fixture.convex.cloud");
  f.query.mockResolvedValue({}); f.mutation.mockImplementation(async ref => getFunctionName(ref) === "masterAgent:beginPlanning" ? { token: "private-claim", context: masterFixture().context } : { ok: true, code: null });
  f.infer.mockResolvedValue({ output: masterFixture().plan, envelope: { provider: "groq", model: "fixture-model", requests: 1, inferenceMs: 1, inputTokens: 10, outputTokens: 20 } });
}
afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
it("rejects cross-origin, missing credentials, unknown owner fields and oversized bodies before backend calls", async () => {
  configure(); expect((await POST(request({}, { origin: "https://attacker.example" }))).status).toBe(403);
  expect((await POST(request({}, { authorization: "" }))).status).toBe(401);
  expect((await POST(request({ runId: id, revision: 1, ownerId: "attacker" }))).status).toBe(400);
  expect((await POST(request({ runId: "x".repeat(2000), revision: 1 }))).status).toBe(413);
  expect(f.query).not.toHaveBeenCalled(); expect(f.infer).not.toHaveBeenCalled();
});
it("verifies ownership before provider access, and missing keys create no claim", async () => {
  configure(); f.query.mockRejectedValue(new ConvexError("MASTER_RUN_NOT_FOUND"));
  expect((await POST(request())).status).toBe(404); expect(f.infer).not.toHaveBeenCalled();
  f.query.mockResolvedValue({}); vi.stubEnv("GROQ_API_KEY", "");
  expect((await POST(request())).status).toBe(503); expect(f.mutation).not.toHaveBeenCalled();
});
it("passes only the verified session to Convex, stores the fenced proposal and returns no key or claim", async () => {
  configure(); const response = await POST(request());
  expect(response.status).toBe(200); expect(f.setAuth).toHaveBeenCalledWith("fixture-user-session");
  expect(f.mutation).toHaveBeenCalledTimes(2); const text = await response.text();
  expect(text).not.toContain("nonsecret-test-key"); expect(text).not.toContain("private-claim"); expect(response.headers.get("cache-control")).toBe("no-store");
});
it("reports inference rate limits, fences failure recording and emits no raw error", async () => {
  configure(); f.infer.mockRejectedValue(new InferenceError("GROQ_RATE_LIMIT", 15));
  const response = await POST(request()); expect(response.status).toBe(429); expect(response.headers.get("retry-after")).toBe("15");
  const last = f.mutation.mock.calls.at(-1)![1]; expect(last.error).toBe("GROQ_RATE_LIMIT"); expect(last.token).toBe("private-claim");
});
it("revokes pending Start authority when provider configuration is missing before a planning claim", async () => {
  configure(); f.query.mockResolvedValue({ startPending: true }); vi.stubEnv("GROQ_API_KEY", "");
  const result = await POST(request());
  expect(result.status).toBe(503); expect(f.infer).not.toHaveBeenCalled();
  expect(f.mutation).toHaveBeenCalledTimes(1);
  expect(getFunctionName(f.mutation.mock.calls[0][0])).toBe("masterStart:abortPlanning");
  expect(f.mutation.mock.calls[0][1]).toEqual({ runId: id, revision: 1 });
});
it("records an inference failure and revokes unused Start authority without exposing the claim", async () => {
  configure(); f.query.mockResolvedValue({ startPending: true });
  f.infer.mockRejectedValue(new InferenceError("GROQ_RATE_LIMIT", 15));
  const result = await POST(request());
  expect(result.status).toBe(429);
  expect(f.mutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual([
    "masterAgent:beginPlanning", "masterAgent:finishPlanning", "masterStart:abortPlanning",
  ]);
  expect(f.mutation.mock.calls[1][1]).toMatchObject({ token: "private-claim", error: "GROQ_RATE_LIMIT" });
  expect(await result.text()).not.toContain("private-claim");
});
it("revokes a Start stopped by quota before inference but does not revoke another active planning lease", async () => {
  configure(); f.query.mockResolvedValue({ startPending: true });
  f.mutation.mockImplementation(async ref => {
    if (getFunctionName(ref) === "masterAgent:beginPlanning") throw new ConvexError("PLANNING_RATE_LIMIT");
    return null;
  });
  expect((await POST(request())).status).toBe(429);
  expect(f.infer).not.toHaveBeenCalled();
  expect(f.mutation.mock.calls.map(([ref]) => getFunctionName(ref))).toEqual(["masterAgent:beginPlanning", "masterStart:abortPlanning"]);
  f.mutation.mockClear();
  f.mutation.mockRejectedValue(new ConvexError("PLANNING_NOT_AVAILABLE"));
  expect((await POST(request())).status).toBe(422);
  expect(f.mutation).toHaveBeenCalledTimes(1);
  expect(getFunctionName(f.mutation.mock.calls[0][0])).toBe("masterAgent:beginPlanning");
});
