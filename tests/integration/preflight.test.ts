import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkflowError } from "../../components/workflow-error";
import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
const modules=import.meta.glob("../../convex/**/*.ts");
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
async function setup(clean=false){
 vi.useFakeTimers();vi.stubEnv("NEAR_SETTLEMENT_ENABLED","false");vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON","{}");
 const t=testBackend(schema,modules);const [userId,otherId]=await t.run(ctx=>Promise.all([ctx.db.insert("users",{email:"preflight@example.com"}),ctx.db.insert("users",{email:"other@example.com"})]));const owner=await asUser(t,userId),other=await asUser(t,otherId);
 const missionId=await owner.mutation(api.missions.create,{title:"Preflight mission",serviceType:"csv_summary",inputCsv:"units\n3\n5",options:{columns:["units"]},maxBudgetYocto:"1000000000000000000000000000",acceptanceCriteria:"Template checks",requiresHumanReview:false,cleanBeforeProcessing:clean,deadlineAt:Date.now()+86400000});
 function configure(){vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON", JSON.stringify({[userId]:"10000000000000000000000000",[otherId]:"10000000000000000000000000"}));vi.stubEnv("NEAR_DEMO_OPERATOR_LIMIT_YOCTO","20000000000000000000000000");vi.stubEnv("NEAR_NETWORK","testnet");vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID","operator.testnet");vi.stubEnv("NEAR_PRIVATE_KEY","offline-fixture-only");vi.stubEnv("NEAR_SETTLEMENT_ENABLED","true");vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON",JSON.stringify({"stats-core":"stats.testnet","analysis-careful":"analysis.testnet","report-craft":"report.testnet","clean-sprint":"clean.testnet","clean-steady":"clean-two.testnet"}));}
 return {t,owner,other,userId,otherId,missionId,configure,drain:()=>t.finishAllScheduledFunctions(vi.runAllTimers)};
}
it("requires owner acknowledgment before an unfunded metadata-only run and persists that choice",async()=>{
 const s=await setup();const preflight=await s.owner.query(api.jobs.preflight,{missionId:s.missionId});expect(preflight.blocked).toBe(true);expect(preflight.paymentCapYocto).toBe("1000000000000000000000000");
 await expect(s.owner.mutation(api.jobs.start,{missionId:s.missionId})).rejects.toThrow("SETTLEMENT_NOT_READY_ACKNOWLEDGE_PREVIEW");
 expect((await s.owner.query(api.missions.get,{id:s.missionId})).state).toBe("draft");
 const id=await s.owner.mutation(api.jobs.start,{missionId:s.missionId,allowUnfundedPreview:true});await s.drain();const detail=await s.owner.query(api.jobs.detail,{id});
 expect(detail.job.unfundedPreviewAcknowledged).toBe(true);expect(detail.job.state).toBe("approved");expect(detail.deliverables[0].content).toBeNull();expect(detail.events.some(event=>event.type==="UNFUNDED_PREVIEW_ACKNOWLEDGED")).toBe(true);
});
it("denies anonymous and cross-owner preflight reads",async()=>{const s=await setup();await expect(s.t.query(api.jobs.preflight,{missionId:s.missionId})).rejects.toThrow("UNAUTHENTICATED");await expect(s.other.query(api.jobs.preflight,{missionId:s.missionId})).rejects.toThrow("MISSION_NOT_FOUND");});
it("allows a small payable offer under a larger unfunded planning cap without promising funding",async()=>{
 const s=await setup();s.configure();const preflight=await s.owner.query(api.jobs.preflight,{missionId:s.missionId});expect(preflight).toMatchObject({blocked:false,balance:null});expect(JSON.stringify(preflight)).not.toContain("offline-fixture-only");
 const id=await s.owner.mutation(api.jobs.start,{missionId:s.missionId});await s.drain();const detail=await s.owner.query(api.jobs.detail,{id});expect(detail.job.state).toBe("approved");expect(BigInt(detail.contracts[0].amountYocto)).toBeLessThanOrEqual(10n**24n);expect(await s.owner.query(api.payments.forJob,{jobId:id})).toBeNull();
});
it("requires an eligible cleaning recipient when the mission includes a subcontract",async()=>{const s=await setup(true);s.configure();vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON",'{"stats-core":"stats.testnet"}');expect((await s.owner.query(api.jobs.preflight,{missionId:s.missionId})).reasons).toContain("The required cleaning service has no valid testnet recipient.");await expect(s.owner.mutation(api.jobs.start,{missionId:s.missionId})).rejects.toThrow("SETTLEMENT_NOT_READY_ACKNOWLEDGE_PREVIEW");});
it("does not award committed work if signing configuration disappears after preflight",async()=>{const s=await setup();s.configure();const id=await s.owner.mutation(api.jobs.start,{missionId:s.missionId});vi.stubEnv("NEAR_SETTLEMENT_ENABLED","false");await s.drain();const detail=await s.owner.query(api.jobs.detail,{id});expect(detail.job.state).toBe("unawarded");expect(detail.contracts).toEqual([]);expect(detail.deliverables).toEqual([]);});
it("filters over-cap candidates and denies an internal over-cap award before any work executes",async()=>{
 const s=await setup();s.configure();const id=await s.owner.mutation(api.jobs.start,{missionId:s.missionId});
 const bidId=await s.t.mutation(internal.workflow.recordBid,{jobId:id,agentId:"stats-core",priceYocto:"2000000000000000000000000",minimumYocto:"200000000000000000000000",etaMs:1000,rationale:"Offline cap enforcement fixture"});
 await expect(s.t.mutation(internal.workflow.award,{bidId,selectionReason:"Attempt over-cap award"})).rejects.toThrow("AWARD_EXCEEDS_SETTLEMENT_CAP");
 vi.stubEnv("AGENT_PRIVATE_FLOORS_JSON",JSON.stringify({"stats-core":"2000000000000000000000000","analysis-careful":"2000000000000000000000000","report-craft":"2000000000000000000000000"}));
 await s.drain();const detail=await s.owner.query(api.jobs.detail,{id});expect(detail.job.state).toBe("unawarded");expect(detail.contracts).toEqual([]);
});
it("returns cached balance as timestamped evidence, never reserves or signs during preflight",async()=>{
 const s=await setup();s.configure();await s.t.run(ctx=>ctx.db.insert("operatorWalletSnapshots",{account:"operator.testnet",requestedAt:Date.now()-120000,checkedAt:Date.now()-120000,pending:false,availableYocto:"0"}));const preflight=await s.owner.query(api.jobs.preflight,{missionId:s.missionId});expect(preflight.balance).toMatchObject({availableYocto:"0",stale:true});expect(await s.t.run(ctx=>ctx.db.query("paymentIntents").collect())).toEqual([]);expect(await s.t.run(ctx=>ctx.db.query("signerLocks").collect())).toEqual([]);
});
it("preflight is a read-only snapshot for concurrent users and does not promise reserved funds",async()=>{
 const s=await setup();s.configure();
 const otherMission=await s.other.mutation(api.missions.create,{title:"Second owner's brief",serviceType:"csv_summary",inputCsv:"units\n1",options:{columns:["units"]},maxBudgetYocto:"1000000000000000000000000",acceptanceCriteria:"Template checks",requiresHumanReview:false,deadlineAt:Date.now()+86400000});
 await s.t.run(ctx=>ctx.db.insert("operatorWalletSnapshots",{account:"operator.testnet",requestedAt:Date.now(),checkedAt:Date.now(),pending:false,availableYocto:"500000000000000000000000"}));
 const [first,second]=await Promise.all([s.owner.query(api.jobs.preflight,{missionId:s.missionId}),s.other.query(api.jobs.preflight,{missionId:otherMission})]);
 expect(first.balance).toEqual(second.balance);expect(first.blocked).toBe(false);
 expect(await s.t.run(ctx=>ctx.db.query("contracts").collect())).toEqual([]);
 expect(await s.t.run(ctx=>ctx.db.query("paymentIntents").collect())).toEqual([]);
});
it("a payable subcontracted award keeps parent plus child allocations within its original cap",async()=>{
 const s=await setup(true);s.configure();const id=await s.owner.mutation(api.jobs.start,{missionId:s.missionId});await s.drain();
 const parent=await s.owner.query(api.jobs.detail,{id});const child=await s.owner.query(api.jobs.detail,{id:parent.children[0]._id});
 expect(parent.job.state).toBe("approved");expect(child.job.state).toBe("approved");
 expect(BigInt(parent.contracts[0].holdbackYocto)+BigInt(child.contracts[0].holdbackYocto)).toBe(BigInt(parent.contracts[0].amountYocto));
 expect(BigInt(parent.contracts[0].amountYocto)).toBeLessThanOrEqual(10n**24n);
});
it.each([
 ["missing policy", "DEMO_ALLOWANCE_CONFIGURATION_REQUIRED"],
 ["unlisted owner", "DEMO_OWNER_NOT_ALLOWLISTED"],
 ["exhausted owner", "DEMO_OWNER_ALLOWANCE_EXCEEDED"],
 ["exhausted operator", "DEMO_OPERATOR_ALLOWANCE_EXCEEDED"],
] as const)("checks %s before locking a brief and runs only acknowledged metadata preview",async (mode,code)=>{
 const s=await setup();s.configure();
 if(mode==="missing policy")vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON","");
 if(mode==="unlisted owner")vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON","{}");
 if(mode==="exhausted owner")vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON",JSON.stringify({[s.userId]:"0"}));
 if(mode==="exhausted operator")vi.stubEnv("NEAR_DEMO_OPERATOR_LIMIT_YOCTO","0");
 const preflight=await s.owner.query(api.jobs.preflight,{missionId:s.missionId});
 expect(preflight.blocked).toBe(true);expect(preflight.allowanceReasons).toContain(code);
 await expect(s.owner.mutation(api.jobs.start,{missionId:s.missionId})).rejects.toThrow("SETTLEMENT_NOT_READY_ACKNOWLEDGE_PREVIEW");
 expect((await s.owner.query(api.missions.get,{id:s.missionId})).state).toBe("draft");
 expect(await s.t.run(ctx=>ctx.db.query("jobs").collect())).toEqual([]);
 const id=await s.owner.mutation(api.jobs.start,{missionId:s.missionId,allowUnfundedPreview:true});await s.drain();
 const detail=await s.owner.query(api.jobs.detail,{id});expect(detail.job.state).toBe("approved");expect(detail.job.workerError).toBeUndefined();expect(detail.delivery.released).toBe(false);expect(detail.deliverables[0].content).toBeNull();
 const prepared=await s.owner.mutation(api.payments.prepare,{jobId:id});if(!prepared.ok)throw new Error(prepared.code);
 const intent=(await s.owner.query(api.payments.forJob,{jobId:id}))!;
 expect(await s.owner.mutation(api.payments.authorize,{intentId:intent._id,recipient:intent.recipient,amountYocto:intent.amountYocto})).toEqual({ok:false,code});
 expect(await s.t.run(ctx=>ctx.db.query("signerLocks").collect())).toEqual([]);
});
it.each([
 ["removed configuration", "DEMO_ALLOWANCE_CONFIGURATION_REQUIRED"],
 ["removed owner", "DEMO_OWNER_NOT_ALLOWLISTED"],
 ["owner reduced", "DEMO_OWNER_ALLOWANCE_EXCEEDED"],
 ["operator reduced", "DEMO_OPERATOR_ALLOWANCE_EXCEEDED"],
] as const)("records a specific nonretryable award denial after %s",async(mode,code)=>{
 const s=await setup();s.configure();expect((await s.owner.query(api.jobs.preflight,{missionId:s.missionId})).blocked).toBe(false);
 const id=await s.owner.mutation(api.jobs.start,{missionId:s.missionId});
 if(mode==="removed configuration")vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON","");
 if(mode==="removed owner")vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON","{}");
 if(mode==="owner reduced")vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON",JSON.stringify({[s.userId]:"0"}));
 if(mode==="operator reduced")vi.stubEnv("NEAR_DEMO_OPERATOR_LIMIT_YOCTO","0");
 await s.drain();const detail=await s.owner.query(api.jobs.detail,{id});
 expect(detail.job.state).toBe("unawarded");expect(detail.job.workerError).toBe(code);expect(detail.contracts).toEqual([]);expect(detail.deliverables).toEqual([]);
 expect(detail.events.some(e=>e.type==="AUCTION_ALLOWANCE_BLOCKED"&&e.detail.includes(code))).toBe(true);
 const markup=renderToStaticMarkup(createElement(WorkflowError,{engineManaged:detail.job.engineManaged===true,state:detail.job.state,code:detail.job.workerError,retryCount:detail.job.retryCount??0,busy:false,onRetry:()=>{throw new Error("Terminal state cannot retry");}}));
 expect(markup).toContain(code);expect(markup).toContain('href="/missions/new"');expect(markup).not.toContain("Retry workflow stage");expect(markup).not.toContain("workflow paused safely");

 await expect(s.owner.mutation(api.jobs.resume,{id})).rejects.toThrow("WORKFLOW_NOT_RETRYABLE");
 expect(await s.t.run(ctx=>ctx.db.query("paymentIntents").collect())).toEqual([]);expect(await s.t.run(ctx=>ctx.db.query("signerLocks").collect())).toEqual([]);
});
it("counts no unfunded preview reservation and atomically admits only affordable exact payments later",async()=>{
 const s=await setup();s.configure();vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON","{}");
 const id=await s.owner.mutation(api.jobs.start,{missionId:s.missionId,allowUnfundedPreview:true});await s.drain();
 s.configure();const allowance=await s.owner.query(api.payments.allowance,{});expect(allowance).toMatchObject({obligatedYocto:"0"});
 const prepared=await s.owner.mutation(api.payments.prepare,{jobId:id});if(!prepared.ok)throw new Error(prepared.code);
 const intent=(await s.owner.query(api.payments.forJob,{jobId:id}))!;
 vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON",JSON.stringify({[s.userId]:"1"}));
 expect(await s.owner.mutation(api.payments.authorize,{intentId:intent._id,recipient:intent.recipient,amountYocto:intent.amountYocto})).toEqual({ok:false,code:"DEMO_OWNER_ALLOWANCE_EXCEEDED"});
 s.configure();expect(await s.owner.mutation(api.payments.authorize,{intentId:intent._id,recipient:intent.recipient,amountYocto:intent.amountYocto})).toEqual({ok:true});
 expect(await s.owner.query(api.payments.allowance,{})).toMatchObject({obligatedYocto:intent.amountYocto});
 // Do not drain the newly scheduled signer action: this is admission testing only.
});
