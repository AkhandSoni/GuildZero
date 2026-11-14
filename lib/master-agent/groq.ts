import { request } from "node:https";
import { MASTER_SYSTEM_PROMPT, CAPABILITIES, PLANNING_RULES } from "./prompt";
import { datasetMetadata, planJsonSchema, type PlanningContext } from "./plan";

export class InferenceError extends Error {
  constructor(readonly code: string, readonly retryAfterSeconds?: number) { super(code); this.name = "InferenceError"; }
}
export type InferenceEnvelope = {
  provider: "groq"; model: string; inferenceMs: number; requests: number;
  inputTokens: number | null; outputTokens: number | null;
};
export type GroqReply = { status: number; retryAfter?: string; body: string };
export type GroqTransport = (body: string, key: string, signal?: AbortSignal) => Promise<GroqReply>;

/** Fixed HTTPS origin, one attempt, bounded body and total deadline. No SDK retry/fallback. */
export const groqTransport: GroqTransport = (body, key, signal) => new Promise((resolve, reject) => {
  let settled = false;
  const finish = (error?: InferenceError, result?: GroqReply) => {
    if (settled) return;
    settled = true; clearTimeout(timer);
    if (error) { req.destroy(); reject(error); } else resolve(result!);
  };
  const req = request("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST", family: 4, agent: false, signal,
    headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  }, response => {
    const chunks: Buffer[] = []; let bytes = 0;
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 65536) { response.destroy(); finish(new InferenceError("PROVIDER_RESPONSE_TOO_LARGE")); }
      else chunks.push(chunk);
    });
    response.on("error", () => finish(new InferenceError("PROVIDER_UNAVAILABLE")));
    response.on("aborted", () => finish(new InferenceError("PROVIDER_UNAVAILABLE")));
    response.on("end", () => finish(undefined, { status: response.statusCode ?? 0,
      retryAfter: typeof response.headers["retry-after"] === "string" ? response.headers["retry-after"] : undefined,
      body: Buffer.concat(chunks).toString("utf8") }));
  });
  const timer = setTimeout(() => finish(new InferenceError("PROVIDER_TIMEOUT")), 30000);
  req.on("error", () => finish(new InferenceError(signal?.aborted ? "PLANNING_CANCELLED" : "PROVIDER_UNAVAILABLE")));
  req.end(body);
});

export async function inferGroq(context: PlanningContext, config: { key?: string; model?: string }, signal?: AbortSignal, transport = groqTransport) {
  if (signal?.aborted) throw new InferenceError("PLANNING_CANCELLED");
  if (!config.key?.trim() || !config.model?.trim()) throw new InferenceError("GROQ_CONFIGURATION_REQUIRED");
  if (!/^[a-zA-Z0-9._/-]{1,150}$/.test(config.model)) throw new InferenceError("GROQ_MODEL_INVALID");
  const userContext = { request: context.prompt, clarificationReplies: context.clarifications,
    capYocto: context.capYocto, requiresHumanReview: context.requiresHumanReview,
    datasets: datasetMetadata(context.datasets), capabilities: CAPABILITIES, planningRules: PLANNING_RULES,
    constraints: { maximumSteps: 3, maximumAwardYocto: "1000000000000000000000000", noRawRows: true } };
  const body = JSON.stringify({ model: config.model, messages: [
    { role: "system", content: MASTER_SYSTEM_PROMPT + "\nSchema:\n" + JSON.stringify(planJsonSchema) },
    { role: "user", content: JSON.stringify(userContext) },
  ], response_format: { type: "json_schema", json_schema: { name: "guildzero_master_plan_v1", strict: true, schema: planJsonSchema } },
  stream: false, temperature: 0, max_completion_tokens: 2048, n: 1 });
  if (Buffer.byteLength(body) > 24576) throw new InferenceError("PLANNING_CONTEXT_TOO_LARGE");
  const start = performance.now();
  let reply: GroqReply;
  try { reply = await transport(body, config.key, signal); }
  catch (e) { throw e instanceof InferenceError ? e : new InferenceError("PROVIDER_UNAVAILABLE"); }
  if (reply.status === 429) throw new InferenceError("GROQ_RATE_LIMIT", /^\d{1,5}$/.test(reply.retryAfter ?? "") ? Math.min(Number(reply.retryAfter), 3600) : undefined);
  if (reply.status === 401 || reply.status === 403) throw new InferenceError("GROQ_ACCESS_DENIED");
  if (reply.status === 400 || reply.status === 404) throw new InferenceError("GROQ_MODEL_OR_SCHEMA_UNSUPPORTED");
  if (reply.status !== 200) throw new InferenceError("PROVIDER_UNAVAILABLE");
  if (Buffer.byteLength(reply.body) > 65536) throw new InferenceError("PROVIDER_RESPONSE_TOO_LARGE");
  let response;
  try { response = JSON.parse(reply.body); } catch { throw new InferenceError("INVALID_PROVIDER_RESPONSE"); }
  const choice = response?.choices?.[0];
  if (choice?.message?.refusal) throw new InferenceError("PROVIDER_REFUSAL");
  if (choice?.finish_reason !== "stop" || typeof choice?.message?.content !== "string") throw new InferenceError("PROVIDER_OUTPUT_INCOMPLETE");
  if (Buffer.byteLength(choice.message.content) > 32768) throw new InferenceError("PLAN_TOO_LARGE");
  let output: unknown;
  try { output = JSON.parse(choice.message.content); } catch { throw new InferenceError("INVALID_PLAN_JSON"); }
  const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
  const envelope: InferenceEnvelope = { provider: "groq", model: typeof response.model === "string" && response.model.length <= 150 ? response.model : config.model,
    inferenceMs: Math.round(performance.now() - start), requests: 1,
    inputTokens: count(response.usage?.prompt_tokens), outputTokens: count(response.usage?.completion_tokens) };
  return { output, envelope };
}
