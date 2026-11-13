import { request } from "node:https";
export const TESTNET_RPC = "https://rpc.testnet.near.org";
// Node-only transport. One bounded HTTPS request, including for send_tx: no
// retry/fallback can accidentally broadcast an uncertain payment twice.
export async function rpc(method: string, params: Record<string, unknown>) {
  const payload = JSON.stringify({ jsonrpc: "2.0", id: "guildzero", method, params });
  const raw = await new Promise<string>((resolve, reject) => {
    let settled = false;
    const req = request(TESTNET_RPC, {
      method: "POST", family: 4, agent: false,
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) },
    }, response => {
      if (response.statusCode !== 200) { response.destroy(); fail(); return; }
      const chunks: Buffer[] = [];
      let length = 0;
      response.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 262144) { response.destroy(); fail(); }
        else chunks.push(chunk);
      });
      response.on("error", () => fail());
      response.on("aborted", () => fail());
      response.on("end", () => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        resolve(Buffer.concat(chunks).toString("utf8"));
      });
    });
    function fail() {
      if (settled) return;
      settled = true; clearTimeout(timer); req.destroy();
      reject(new Error("RPC_UNAVAILABLE"));
    }
    const timer = setTimeout(fail, 15000);
    req.on("error", () => fail());
    req.end(payload);
  });
  let body;
  try { body = JSON.parse(raw); } catch { throw new Error("RPC_RESULT_UNAVAILABLE"); }
  if (!body || typeof body !== "object" || body.error || body.result === undefined) throw new Error("RPC_RESULT_UNAVAILABLE");
  return body.result;
}
export async function assertTestnet() {
  const status = await rpc("status", {});
  if (status.chain_id !== "testnet") throw new Error("WRONG_NETWORK");
}
