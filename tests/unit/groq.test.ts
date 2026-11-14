// @vitest-environment node
import { expect, it } from "vitest";
import { inferGroq, InferenceError, type GroqReply } from "../../lib/master-agent/groq";
import { masterFixture } from "../helpers/master-fixtures";
const config = { key: "nonsecret-offline-fixture", model: "fixture-model" };
const good = () => ({ status: 200, body: JSON.stringify({ model: "fixture-model", choices: [{ finish_reason: "stop", message: { content: JSON.stringify(masterFixture().plan) } }], usage: { prompt_tokens: 100, completion_tokens: 50 } }) });
it("sends a single constrained request without rows, keys in context or callable tools", async () => {
  const { context } = masterFixture(); context.datasets[0].csv = "units,revenue\n3,37.50\n5,20.00\n";
  let calls = 0;
  const result = await inferGroq(context, config, undefined, async (body, key) => {
    calls++; expect(key).toBe(config.key); const sent = JSON.parse(body);
    expect(sent.model).toBe(config.model); expect(sent.stream).toBe(false); expect(sent.response_format.json_schema.strict).toBe(true);
    expect(sent).not.toHaveProperty("tools"); expect(body).not.toContain("37.50"); expect(body).not.toContain(config.key);
    return good();
  });
  expect(calls).toBe(1); expect(result.envelope).toMatchObject({ provider: "groq", requests: 1, inputTokens: 100, outputTokens: 50 });
});
it("requires configuration and respects cancellation before a request", async () => {
  const { context } = masterFixture(); let calls = 0; const transport = async () => { calls++; return good(); };
  await expect(inferGroq(context, {}, undefined, transport)).rejects.toThrow("CONFIGURATION_REQUIRED");
  await expect(inferGroq(context, { ...config, model: "\nmalformed" }, undefined, transport)).rejects.toThrow("MODEL_INVALID");
  await expect(inferGroq(context, config, AbortSignal.abort(), transport)).rejects.toThrow("PLANNING_CANCELLED"); expect(calls).toBe(0);
});
for (const [status, code] of [[401, "GROQ_ACCESS_DENIED"], [403, "GROQ_ACCESS_DENIED"], [400, "GROQ_MODEL_OR_SCHEMA_UNSUPPORTED"], [404, "GROQ_MODEL_OR_SCHEMA_UNSUPPORTED"], [500, "PROVIDER_UNAVAILABLE"], [302, "PROVIDER_UNAVAILABLE"]] as const) {
  it(`sanitizes HTTP ${status} without paid fallback or hidden retry`, async () => {
    let calls = 0;
    await expect(inferGroq(masterFixture().context, config, undefined, async () => { calls++; return { status, body: "provider text including sensitive diagnostics" }; })).rejects.toThrow(code);
    expect(calls).toBe(1);
  });
}
it("reports bounded retry-after on 429 without retrying", async () => {
  let error;
  try { await inferGroq(masterFixture().context, config, undefined, async () => ({ status: 429, retryAfter: "9", body: "" })); } catch (e) { error = e; }
  expect(error).toBeInstanceOf(InferenceError); expect(error).toMatchObject({ code: "GROQ_RATE_LIMIT", retryAfterSeconds: 9 });
});
for (const [reply, code] of [
  [{ status: 200, body: "not json" }, "INVALID_PROVIDER_RESPONSE"],
  [{ status: 200, body: "x".repeat(65537) }, "PROVIDER_RESPONSE_TOO_LARGE"],
  [{ status: 200, body: JSON.stringify({ choices: [{ finish_reason: "length", message: { content: "{}" } }] }) }, "PROVIDER_OUTPUT_INCOMPLETE"],
  [{ status: 200, body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { refusal: "refused", content: "{}" } }] }) }, "PROVIDER_REFUSAL"],
  [{ status: 200, body: JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: "```json\n{}\n```" } }] }) }, "INVALID_PLAN_JSON"],
] as [GroqReply, string][]) it(`rejects ${code}`, async () => {
  await expect(inferGroq(masterFixture().context, config, undefined, async () => reply)).rejects.toThrow(code);
});
it("does not invent usage metrics and sanitizes transport errors", async () => {
  const reply = good(); const data = JSON.parse(reply.body); data.usage = {}; reply.body = JSON.stringify(data);
  expect((await inferGroq(masterFixture().context, config, undefined, async () => reply)).envelope.inputTokens).toBeNull();
  await expect(inferGroq(masterFixture().context, config, undefined, async () => { throw Error("private SDK payload"); })).rejects.toThrow("PROVIDER_UNAVAILABLE");
  await expect(inferGroq(masterFixture().context, config, undefined, async () => { throw new InferenceError("PROVIDER_TIMEOUT"); })).rejects.toThrow("PROVIDER_TIMEOUT");
});
