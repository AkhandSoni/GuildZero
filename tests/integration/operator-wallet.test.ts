import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
const modules = import.meta.glob("../../convex/**/*.ts");
const transport=vi.hoisted(()=>({rpc:vi.fn(),assertTestnet:vi.fn()}));
vi.mock("../../lib/settlement/rpc",()=>({...transport,TESTNET_RPC:"https://rpc.testnet.near.org"}));
afterEach(()=>{vi.unstubAllEnvs();vi.resetAllMocks();vi.useRealTimers();});
it("denies anonymous wallet reads and refreshes",async()=>{
 const t=testBackend(schema,modules);
 await expect(t.query(api.operatorWallet.get,{})).rejects.toThrow("UNAUTHENTICATED");
 await expect(t.mutation(api.operatorWallet.refresh,{})).rejects.toThrow("UNAUTHENTICATED");
});
it("refreshes the configured public account without signing, throttles concurrent requests and retains evidence on failure",async()=>{
 vi.useFakeTimers();
 vi.stubEnv("NEAR_NETWORK","testnet");vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID","operator.testnet");
 vi.stubEnv("NEAR_PRIVATE_KEY","never-expose-this-key");
 const t=testBackend(schema,modules);const id=await t.run(ctx=>ctx.db.insert("users",{email:"wallet@example.com"}));const owner=await asUser(t,id);
 transport.assertTestnet.mockResolvedValue(undefined);
 transport.rpc.mockImplementation(async(method:string)=>method==="query"?{amount:"1000000000000000000000000",locked:"0",storage_usage:100,block_height:123,block_hash:"1".repeat(32)}:{runtime_config:{storage_amount_per_byte:"10000000000000000000"}});
 const replies=await Promise.all([owner.mutation(api.operatorWallet.refresh,{}),owner.mutation(api.operatorWallet.refresh,{})]);
 expect(replies.filter(r=>r.ok)).toHaveLength(1);
 await t.finishAllScheduledFunctions(vi.runAllTimers);
 const first=await owner.query(api.operatorWallet.get,{});
 expect(first.snapshot).toMatchObject({pending:false,availableYocto:"989000000000000000000000",blockHeight:123});
 expect(JSON.stringify(first)).not.toContain("never-expose");
 expect(transport.rpc.mock.calls).toHaveLength(2);
 vi.advanceTimersByTime(31000);transport.assertTestnet.mockRejectedValue(new Error("sensitive-error"));
 await owner.mutation(api.operatorWallet.refresh,{});await t.finishAllScheduledFunctions(vi.runAllTimers);
 const failed=await owner.query(api.operatorWallet.get,{});
 expect(failed.snapshot?.checkedAt).toBe(first.snapshot?.checkedAt);
 expect(failed.snapshot?.availableYocto).toBe(first.snapshot?.availableYocto);
 expect(failed.snapshot?.error).toContain("Could not read");
 expect(JSON.stringify(failed)).not.toContain("sensitive-error");
 expect(await t.run(ctx=>ctx.db.query("paymentIntents").collect())).toHaveLength(0);
 // A late callback cannot overwrite a newer successful/failed refresh.
 await t.mutation(internal.operatorWallet.finish,{id:first.snapshot!._id,account:"operator.testnet",requestedAt:first.snapshot!.requestedAt,result:{liquidYocto:"2",lockedYocto:"0",totalYocto:"2",storageYocto:"0",availableYocto:"0",blockHeight:1,blockHash:"1".repeat(32)}});
 expect((await owner.query(api.operatorWallet.get,{})).snapshot?.availableYocto).toBe(first.snapshot?.availableYocto);
});
