// @vitest-environment node
import { afterEach, expect, it, vi } from "vitest";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { settlementProvider } from "../../lib/settlement/provider";
import { assertTestnet, rpc } from "../../lib/settlement/rpc";
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("bounds every real SDK transaction-preparation request without broadcasting", async () => {
  const signals: unknown[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: unknown, init: RequestInit) => {
    signals.push(init.signal);
    const { method } = JSON.parse(init.body as string);
    expect(["query", "block"]).toContain(method);
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: "offline",
      result: method === "query" ? { nonce: 6, permission: "FullAccess" } : { header: { hash: "1".repeat(32) } },
    }));
  }));
  // Ephemeral in-memory key, no account access or transaction submission.
  const signer = new KeyPairSigner(KeyPair.fromRandom("ed25519"));
  const account = new Account("offline-operator.testnet", settlementProvider(), signer);
  const transaction = await account.createTransaction({ receiverId: "offline-worker.testnet",
    publicKey: await signer.getPublicKey(), actions: [actions.transfer(1n)] });
  expect(transaction.nonce).toBe(7n);
  expect(signals).toHaveLength(2);
  expect(signals.every((signal) => signal instanceof AbortSignal)).toBe(true);
  const signed = await signer.signTransaction(transaction);
  expect(signed.txHash).toHaveLength(32);
  expect(signed.signedTransaction.encode().length).toBeGreaterThan(64);
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("aborts a stalled SDK read through the bounded RPC transport", async () => {
  const signal = AbortSignal.timeout(20);
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(signal);
  vi.stubGlobal("fetch", vi.fn((_url: unknown, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener("abort", () => reject(init.signal!.reason), { once: true });
  })));
  await expect(settlementProvider().sendJsonRpc("status", {})).rejects.toThrow();
  expect(timeout).toHaveBeenCalledWith(15000);
  expect(fetch).toHaveBeenCalledTimes(1);
});

it.each([
  { error: { message: "offline failure" } }, {},
])("rejects unavailable RPC results", async (body) => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body))));
  await expect(rpc("status", {})).rejects.toThrow("RPC_RESULT_UNAVAILABLE");
});

it("rejects wrong networks and oversized/error responses", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ result: { chain_id: "mainnet" } }))));
  await expect(assertTestnet()).rejects.toThrow("WRONG_NETWORK");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("x".repeat(262145))));
  await expect(rpc("status", {})).rejects.toThrow("RPC_UNAVAILABLE");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("unavailable", { status: 503 })));
  await expect(rpc("status", {})).rejects.toThrow("RPC_UNAVAILABLE");
});

it("stops reading an oversized RPC stream at the byte limit", async () => {
  let reads = 0;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (reads++ === 10) controller.close();
      else controller.enqueue(new Uint8Array(65536).fill(32));
    }, cancel,
  }, { highWaterMark: 0 });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body)));
  await expect(rpc("status", {})).rejects.toThrow("RPC_UNAVAILABLE");
  expect(reads).toBeLessThanOrEqual(5);
  expect(cancel).toHaveBeenCalledTimes(1);
});
