// @vitest-environment node
import { EventEmitter } from "node:events";
import { afterEach, expect, it, vi } from "vitest";
import { Account, KeyPair, KeyPairSigner, actions } from "near-api-js";
import { settlementProvider } from "../../lib/settlement/provider";
import { assertTestnet, rpc } from "../../lib/settlement/rpc";
const transport = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => transport);
afterEach(() => { vi.resetAllMocks(); vi.useRealTimers(); });
function respond(result: (method: string) => unknown, statusCode = 200, chunks?: Buffer[]) {
  const destroyed = vi.fn();
  transport.request.mockImplementation((url, options, callback) => {
    expect(url).toBe("https://rpc.testnet.near.org");
    expect(options.method).toBe("POST");
    const req = new EventEmitter() as EventEmitter & { end: (body: string) => void; destroy: () => void };
    req.destroy = vi.fn();
    req.end = body => {
      const parsed = JSON.parse(body);
      queueMicrotask(() => {
        const res = new EventEmitter() as EventEmitter & { statusCode: number; destroy: () => void; destroyed: boolean };
        res.statusCode = statusCode; res.destroyed = false;
        res.destroy = () => { res.destroyed = true; destroyed(); };
        callback(res);
        const values = chunks ?? [Buffer.from(JSON.stringify(result(parsed.method)))];
        for (const chunk of values) { if (res.destroyed) break; res.emit("data", chunk); }
        if (!res.destroyed) res.emit("end");
      });
    };
    return req;
  });
  return destroyed;
}
it("uses the bounded transport for real SDK preparation without broadcasting", async () => {
  respond(method => {
    expect(["query", "block"]).toContain(method);
    return { result: method === "query" ? { nonce: 6, permission: "FullAccess" } : { header: { hash: "1".repeat(32) } } };
  });
  const signer = new KeyPairSigner(KeyPair.fromRandom("ed25519"));
  const account = new Account("offline-operator.testnet", settlementProvider(), signer);
  const transaction = await account.createTransaction({ receiverId: "offline-worker.testnet", publicKey: await signer.getPublicKey(), actions: [actions.transfer(1n)] });
  expect(transaction.nonce).toBe(7n);
  const signed = await signer.signTransaction(transaction);
  expect(signed.txHash).toHaveLength(32);
  expect(signed.signedTransaction.encode().length).toBeGreaterThan(64);
  expect(transport.request).toHaveBeenCalledTimes(2);
});
it("destroys a stalled request at 15 seconds and never retries", async () => {
  vi.useFakeTimers(); const req = new EventEmitter();
  const destroy=vi.fn(),end=vi.fn();
  transport.request.mockReturnValue(Object.assign(req,{destroy,end}));
  const pending=rpc("status",{}); const result=expect(pending).rejects.toThrow("RPC_UNAVAILABLE");
  await vi.advanceTimersByTimeAsync(15000); await result;
  expect(destroy).toHaveBeenCalledTimes(1); expect(transport.request).toHaveBeenCalledTimes(1);
});
it.each([{ error: { message: "offline failure" } }, {}, null])("rejects unavailable RPC results", async body => {
  respond(()=>body); await expect(rpc("status",{})).rejects.toThrow("RPC_RESULT_UNAVAILABLE");
});
it("rejects wrong networks and HTTP errors without following redirects", async () => {
  respond(()=>({result:{chain_id:"mainnet"}})); await expect(assertTestnet()).rejects.toThrow("WRONG_NETWORK");
  for(const status of [302,503]) { respond(()=>({}),status); await expect(rpc("status",{})).rejects.toThrow("RPC_UNAVAILABLE"); }
});
it("stops reading a response once the byte limit is exceeded", async () => {
  const destroyed=respond(()=>({}),200,Array.from({length:10},()=>Buffer.alloc(65536)));
  await expect(rpc("status",{})).rejects.toThrow("RPC_UNAVAILABLE");expect(destroyed).toHaveBeenCalledTimes(1);
});
it("rejects malformed JSON without leaking its response",async()=>{
 respond(()=>({}),200,[Buffer.from("not json: private diagnostic")]);
 await expect(rpc("status",{})).rejects.toThrow("RPC_RESULT_UNAVAILABLE");
});
