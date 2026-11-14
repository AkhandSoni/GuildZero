import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { masterFixture } from "../helpers/master-fixtures";
import schema from "../../convex/schema";
import { api, internal } from "../../convex/_generated/api";
import { credentialDigest } from "../../convex/mcpPolicy";
import { MCP_SCOPES } from "../../lib/mcp/contracts";
import { PUBLIC_AGENTS } from "../../lib/agent-directory";
const modules = import.meta.glob("../../convex/**/*.ts");
// Combined-tree fixtures: synthetic proposals, invalid key, no provider or chain.
const noSend = vi.hoisted(() => ({ rpc: vi.fn(() => { throw Error("NO_CHAIN_CALLS"); }), signer:vi.fn(()=>{throw Error("NO_SIGNER_ACCESS");}) }));
vi.mock("../../lib/settlement/rpc", () => ({ rpc: noSend.rpc, assertTestnet: noSend.rpc, TESTNET_RPC: "https://rpc.testnet.near.org" }));
vi.mock("near-api-js",()=>({KeyPairSigner:{fromSecretKey:noSend.signer},Account:class{constructor(){noSend.signer();}},JsonRpcProvider:class{},actions:{transfer:()=>({})},baseEncode:()=>""}));
afterEach(() => { expect(noSend.rpc).not.toHaveBeenCalled(); expect(noSend.signer).not.toHaveBeenCalled(); vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function setup() {
  vi.useFakeTimers();
  vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "false"); vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "false");
  vi.stubEnv("NEAR_PAYMENT_RETRY_ENABLED", "false"); vi.stubEnv("NEAR_DEMO_ALLOWANCES_REQUIRED", "false");
  vi.stubEnv("GUILDZERO_MCP_UI_ORIGIN", "http://localhost:3000");
  const t = testBackend(schema, modules);
  const [ownerId, otherId] = await t.run(ctx => Promise.all([ctx.db.insert("users", {email:"combined-owner@example.test"}), ctx.db.insert("users", {email:"combined-other@example.test"})]));
  const owner = await asUser(t, ownerId), other = await asUser(t, otherId);
  const credential = await owner.action(api.mcpCredentials.create, {label:"combined fixture", scopes:[...MCP_SCOPES]});
  const foreign = await other.action(api.mcpCredentials.create, {label:"other fixture", scopes:[...MCP_SCOPES]});
  const {context, plan} = masterFixture();
  const runId = await owner.mutation(api.masterAgent.create, {requestId:"combined-request", prompt:context.prompt, datasets:context.datasets, capYocto:context.capYocto, deadlineAt:context.deadlineAt, requiresHumanReview:false});
  const claim = await owner.mutation(api.masterAgent.beginPlanning, {runId, revision:1});
  await owner.mutation(api.masterAgent.finishPlanning, {runId, revision:1, token:claim.token, planJson:JSON.stringify(plan)});
  const view = () => owner.query(api.masterAgent.get, {runId});
  await owner.mutation(api.masterAgent.accept, {runId, planHash:(await view()).run.planHash!, allowUnfundedPreview:true});
  const {missionId, jobId} = (await view()).steps[0];
  const call = async (tool:string, args:unknown={}, token=credential.token) => t.mutation(internal.mcpGateway.dispatch, {digest:await credentialDigest(token), request:{tool, arguments:args}});
  const execute = () => t.finishAllScheduledFunctions(vi.runAllTimers);
  const enable = () => {
    vi.stubEnv("NEAR_SETTLEMENT_ENABLED", "true"); vi.stubEnv("NEAR_NETWORK", "testnet");
    vi.stubEnv("MASTER_AGENT_AUTOPAY_ENABLED", "true"); vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID", "operator.testnet");
    vi.stubEnv("NEAR_PRIVATE_KEY", "unusable-offline-fixture");
    vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON", JSON.stringify(Object.fromEntries(PUBLIC_AGENTS.filter(a=>a.capabilities.length).map(a=>[a.id,a.id+".operator.testnet"]))));
  };
  const grant = async () => {
    const review = (await owner.query(api.masterAgent.spendingReview, {runId}))!;
    return owner.mutation(api.masterAgent.authorizeSpending, {runId, planHash:review.planHash, policyHash:review.policyHash, capYocto:review.capYocto, expiresAt:review.expiresAt, purpose:"human_mission_spending"});
  };
  return {t, owner, other, foreign, credential, runId, missionId, jobId:jobId!, call, view, execute, enable, grant};
}
it("exposes real planner-created economy through MCP without leaking results or granting spending", async () => {
  const s=await setup(); await s.execute(); s.enable();
  const auction=await s.call("guildzero_get_auction", {jobId:s.jobId});
  expect(auction).toMatchObject({ok:true,data:{job:{state:"approved"}}});
  expect(JSON.stringify(auction)).not.toMatch(/minimumYocto|estimatedCostYocto|pricingContext|masterGrantId/);
  expect(await s.call("guildzero_get_verification", {jobId:s.jobId})).toMatchObject({ok:true,data:{verdict:"pass"}});
  expect(await s.call("guildzero_get_result", {jobId:s.jobId})).toMatchObject({ok:true,data:{locked:true,deliverable:null}});
  expect(await s.call("guildzero_start_auction", {missionId:s.missionId})).toMatchObject({ok:true,data:{jobId:s.jobId}});
  const prepared=await s.call("guildzero_prepare_payment", {jobId:s.jobId}); expect(prepared).toMatchObject({ok:true,data:{intent:{status:"READY"}}});
  const direct=await s.owner.mutation(api.payments.prepare, {jobId:s.jobId}); expect(direct.ok).toBe(true);
  expect(await s.t.run(ctx=>ctx.db.query("paymentIntents").collect())).toHaveLength(1);
  expect(await s.call("guildzero_request_payment_authorization", {jobId:s.jobId})).toMatchObject({ok:true,data:{approvalRequired:true,approvalUrl:`http://localhost:3000/missions/${s.missionId}`}});
  expect(await s.t.run(ctx=>ctx.db.query("masterGrants").collect())).toEqual([]);
  expect(await s.t.run(ctx=>ctx.db.query("signerLocks").collect())).toEqual([]);
});
it("separates integration principals from human grant/session authority", async () => {
  const s=await setup(); await s.execute();
  expect(await s.call("guildzero_get_mission", {missionId:s.missionId},s.foreign.token)).toMatchObject({ok:false,code:"NOT_FOUND"});
  expect(await s.call("guildzero_get_result", {jobId:s.jobId},s.foreign.token)).toMatchObject({ok:false,code:"NOT_FOUND"});
  for(const tool of ["masterAgent.authorizeSpending","payments.authorize","guildzero_authorize_payment"])
    expect(await s.call(tool,{runId:s.runId,ownerId:"spoof"})).toMatchObject({ok:false,code:"INVALID_INPUT"});
  await expect(s.t.query(api.masterAgent.get,{runId:s.runId})).rejects.toThrow("UNAUTHENTICATED");
  const restricted=await s.owner.action(api.mcpCredentials.create,{label:"read only",scopes:["missions:read"],missionIds:[s.missionId]});
  expect(await s.call("guildzero_prepare_payment",{jobId:s.jobId},restricted.token)).toMatchObject({ok:false,code:"SCOPE_DENIED"});
});
it("reuses an MCP-prepared intent under a separate human grant and retains the lowered cap",async()=>{
  const s=await setup(); await s.execute(); s.enable();
  await s.call("guildzero_prepare_payment",{jobId:s.jobId}); const grantId=await s.grant();
  await s.t.mutation(internal.masterAgentWorker.authorize,{grantId,jobId:s.jobId});
  const intent=(await s.owner.query(api.payments.forJob,{jobId:s.jobId}))!;
  expect(intent.masterGrantId).toBe(grantId); expect(await s.t.run(ctx=>ctx.db.query("paymentIntents").collect())).toHaveLength(1);
  expect(await s.call("guildzero_request_payment_authorization",{jobId:s.jobId})).toMatchObject({ok:false,code:"NOT_READY"});
  expect(await s.call("guildzero_get_result",{jobId:s.jobId})).toMatchObject({ok:true,data:{locked:true}});
  vi.stubEnv("NEAR_MAX_TRANSFER_YOCTO","1");
  expect(await s.call("guildzero_list_services")).toMatchObject({ok:true,data:{limits:{maxTransferYocto:"1"}}});
  expect(await s.t.mutation(internal.paymentWorker.claim,{intentId:intent._id})).toBeNull();
  expect(await s.t.run(ctx=>ctx.db.query("signerLocks").collect())).toEqual([]);
  expect(await s.t.run(ctx=>ctx.db.query("masterReservations").collect())).toHaveLength(1);
});
it("retains exact manual fallback after revoking a grant without duplicate preparation",async()=>{
  const s=await setup(); await s.execute(); s.enable(); const grantId=await s.grant();
  await s.t.mutation(internal.masterAgentWorker.authorize,{grantId,jobId:s.jobId});
  const intent=(await s.owner.query(api.payments.forJob,{jobId:s.jobId}))!;
  await s.owner.mutation(api.masterAgent.revokeSpending,{runId:s.runId});
  expect(await s.t.mutation(internal.paymentWorker.claim,{intentId:intent._id})).toBeNull();
  expect(await s.call("guildzero_prepare_payment",{jobId:s.jobId})).toMatchObject({ok:true});
  const result=await s.owner.mutation(api.payments.authorize,{intentId:intent._id,recipient:intent.recipient,amountYocto:intent.amountYocto});
  expect(result).toMatchObject({ok:true});
  expect((await s.owner.query(api.payments.forJob,{jobId:s.jobId}))!.masterGrantId).toBeUndefined();
  expect(await s.t.run(ctx=>ctx.db.query("paymentIntents").collect())).toHaveLength(1);
});
it("removes cancelled planner bundle copies together and MCP cannot retrieve the cleared content",async()=>{
  const s=await setup();
  await expect(s.owner.mutation(api.retention.removeContent,{missionId:s.missionId,confirm:"REMOVE_DATASET_AND_OUTPUTS"})).rejects.toThrow("planner");
  await s.owner.mutation(api.masterAgent.cancel,{runId:s.runId});
  await s.owner.mutation(api.masterAgent.removeContent,{runId:s.runId,confirm:"REMOVE_PLANNER_AND_MISSION_CONTENT"});
  expect((await s.owner.query(api.masterAgent.context,{runId:s.runId})).context.datasets).toEqual([]);
  expect(await s.call("guildzero_get_mission",{missionId:s.missionId})).toMatchObject({ok:true,data:{mission:{title:"Content removed by owner"}}});
  expect(await s.call("guildzero_get_result",{jobId:s.jobId})).toMatchObject({ok:true,data:{locked:true,deliverable:null}});
  expect(JSON.stringify(await s.call("guildzero_get_mission",{missionId:s.missionId}))).not.toContain("inputCsv");
});
