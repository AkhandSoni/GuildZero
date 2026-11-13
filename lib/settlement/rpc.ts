export const TESTNET_RPC = "https://rpc.testnet.near.org";
export async function rpc(method: string, params: Record<string, unknown>) {
  const response = await fetch(TESTNET_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "guildzero", method, params }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error("RPC_UNAVAILABLE");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("RPC_RESULT_UNAVAILABLE");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 262144) {
        await reader.cancel();
        throw new Error("RPC_UNAVAILABLE");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (body.error || body.result === undefined)
    throw new Error("RPC_RESULT_UNAVAILABLE");
  return body.result;
}
export async function assertTestnet() {
  const status = await rpc("status", {});
  if (status.chain_id !== "testnet") throw new Error("WRONG_NETWORK");
}
