export const TESTNET_RPC = "https://rpc.testnet.near.org";
export async function rpc(method: string, params: Record<string, unknown>) {
  const response = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "guildzero", method, params }),
    signal: AbortSignal.timeout(15000),
  });
  const text = await response.text();
  if (!response.ok || text.length > 262144) throw new Error("RPC_UNAVAILABLE");
  const body = JSON.parse(text);
  if (body.error || body.result === undefined)
    throw new Error("RPC_RESULT_UNAVAILABLE");
  return body.result;
}
export async function assertTestnet() {
  const status = await rpc("status", {});
  if (status.chain_id !== "testnet") throw new Error("WRONG_NETWORK");
}
