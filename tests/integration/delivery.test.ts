import { afterEach, expect, it, vi } from "vitest";
import { testBackend, asUser } from "../helpers/backend";
import { api, internal } from "../../convex/_generated/api";
import schema from "../../convex/schema";
import { PUBLIC_AGENTS } from "../../lib/agent-directory";
const modules=import.meta.glob("../../convex/**/*.ts");
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
// All receipt evidence in this file is an isolated offline adapter fixture.
// The production browser backend never receives these records or signatures.
async function setup(clean=false,human=false,service:"csv_summary"|"csv_normalize"="csv_summary"){
 vi.useFakeTimers();vi.stubEnv("NEAR_SETTLEMENT_ENABLED","false");
 const t=testBackend(schema,modules);
 const [ownerId,otherId]=await t.run(ctx=>Promise.all([ctx.db.insert("users",{email:"delivery@example.com"}),ctx.db.insert("users",{email:"outsider@example.com"})]));
 vi.stubEnv("NEAR_DEMO_ALLOWANCES_JSON",JSON.stringify({[ownerId]:"10000000000000000000000000"}));vi.stubEnv("NEAR_DEMO_OPERATOR_LIMIT_YOCTO","10000000000000000000000000");
 const owner=await asUser(t,ownerId),other=await asUser(t,otherId);
 const missionId=await owner.mutation(api.missions.create,{title:"Actual computed delivery",serviceType:service,inputCsv:"product,units\n Bag ,3\nBook,5",options:service==="csv_summary"?{columns:["units"]}:{columns:["product"],caseMode:"preserve"},maxBudgetYocto:"1000000000000000000000000",acceptanceCriteria:"Check metadata and verification",requiresHumanReview:human,cleanBeforeProcessing:clean,deadlineAt:Date.now()+86400000});
 const jobId=await owner.mutation(api.jobs.start,{missionId,allowUnfundedPreview:true});await t.finishAllScheduledFunctions(vi.runAllTimers);
 vi.stubEnv("NEAR_NETWORK","testnet");vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID","operator.testnet");vi.stubEnv("NEAR_PRIVATE_KEY","offline-fixture-only");vi.stubEnv("NEAR_SETTLEMENT_ENABLED","true");vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON",JSON.stringify(Object.fromEntries(PUBLIC_AGENTS.filter(agent=>agent.capabilities.length).map(agent=>[agent.id,`${agent.id}.testnet`]))));
 let sequence=0;
 async function prepared(id=jobId){const result=await owner.mutation(api.payments.prepare,{jobId:id});if(!result.ok)throw Error(result.code);return result.intentId;}
 async function confirm(id=jobId){
  const intentId=await prepared(id);await t.run(ctx=>ctx.db.patch(intentId,{authorizedAt:Date.now()}));
  await t.mutation(internal.paymentWorker.claim,{intentId});
  const nonce=String(++sequence),txHash=String(sequence).repeat(32);
  await t.mutation(internal.paymentWorker.prepared,{intentId,nonce,txHash});
  const intent=(await owner.query(api.payments.forJob,{jobId:id}))!;
  await t.mutation(internal.paymentWorker.outcome,{intentId,receiptJson:JSON.stringify({final_execution_status:"FINAL",transaction:{hash:txHash,signer_id:intent.sender,receiver_id:intent.recipient,nonce:Number(nonce),actions:[{Transfer:{deposit:intent.amountYocto}}]},transaction_outcome:{block_hash:"3".repeat(32)},status:{SuccessValue:""},receipts_outcome:[{outcome:{status:{SuccessValue:""}}}]})});
  return intentId;
 }
 return {t,owner,other,ownerId,otherId,missionId,jobId,prepared,confirm,detail:(id=jobId)=>owner.query(api.jobs.detail,{id})};
}
it("withholds full summary and internal payloads before settlement, preserves actual computation internally and denies other owners",async()=>{
 const s=await setup();const detail=await s.detail();
 expect(detail.job.state).toBe("approved");expect(detail.delivery).toMatchObject({released:false,requiredPayments:1,confirmedPayments:0});
 expect(detail.deliverables[0]).toMatchObject({content:null,preview:{rowCount:2,columnCount:1,columns:["units"]}});
 expect(detail.deliverables[0]).not.toHaveProperty("verificationPayload");
 expect(JSON.stringify(detail)).not.toContain('"sum":8');
 const stored=(await s.t.run(ctx=>ctx.db.get(detail.deliverables[0]._id)))!;expect(JSON.parse(stored.content).columns[0].sum).toBe(8);
 await expect(s.t.query(api.jobs.detail,{id:s.jobId})).rejects.toThrow("UNAUTHENTICATED");
 await expect(s.other.query(api.jobs.detail,{id:s.jobId})).rejects.toThrow("JOB_NOT_FOUND");
});
it.each(["READY","SUBMITTING","CONFIRMING","UNKNOWN_RECONCILE","FAILED"] as const)("never releases full data for %s even if old confirmation fields remain",async(status)=>{
 const s=await setup();const intentId=await s.confirm();await s.t.run(ctx=>ctx.db.patch(intentId,{status}));
 expect((await s.detail()).deliverables[0].content).toBeNull();
});
it("releases a real computed result only after trusted receipt verification and records release once",async()=>{
 const s=await setup();const intentId=await s.confirm();const detail=await s.detail();
 expect(detail.delivery.released).toBe(true);expect(JSON.parse(detail.deliverables[0].content!).columns[0].sum).toBe(8);
 expect(detail.events.filter(event=>event.type==="DELIVERABLE_RELEASED")).toHaveLength(1);
 await s.t.mutation(internal.paymentWorker.outcome,{intentId});
 expect((await s.detail()).events.filter(event=>event.type==="DELIVERABLE_RELEASED")).toHaveLength(1);
 // Rotating current configuration cannot erase valid historical payment evidence.
 vi.stubEnv("NEAR_OPERATOR_ACCOUNT_ID","new-operator.testnet");vi.stubEnv("NEAR_AGENT_RECIPIENTS_JSON","{}");
 expect((await s.detail()).delivery.released).toBe(true);
});
it.each(["owner","amount","deliverable","verification","evidence"])("fails closed for mismatched confirmed %s binding",async(kind)=>{
 const s=await setup();const intentId=await s.confirm();
 await s.t.run(async ctx=>{
  if(kind==="owner")await ctx.db.patch(intentId,{ownerId:s.otherId});
  if(kind==="amount")await ctx.db.patch(intentId,{amountYocto:"1"});
  if(kind==="deliverable")await ctx.db.patch(intentId,{deliverableId:undefined});
  if(kind==="verification")await ctx.db.patch(intentId,{verificationId:undefined});
  if(kind==="evidence")await ctx.db.patch(intentId,{blockHash:undefined});
 });expect((await s.detail()).delivery.released).toBe(false);expect((await s.detail()).deliverables[0].content).toBeNull();
});
it("requires both parent and child receipts and keeps internal subcontract execution working",async()=>{
 const s=await setup(true);const first=await s.detail();const childId=first.children[0]._id;
 expect(first.job.state).toBe("approved");expect((await s.detail(childId)).job.state).toBe("approved");
 await s.confirm();expect((await s.detail()).delivery).toMatchObject({released:false,confirmedPayments:1,requiredPayments:2});expect((await s.detail(childId)).deliverables[0].content).toBeNull();
 await s.confirm(childId);expect((await s.detail()).delivery.released).toBe(true);expect((await s.detail(childId)).deliverables[0].content).toContain("Bag,3");
 expect(JSON.parse((await s.detail()).deliverables[0].content!).columns[0].sum).toBe(8);
 expect((await s.detail(childId)).events.filter(event=>event.type==="DELIVERABLE_RELEASED")).toHaveLength(1);
});
it("a receipt for an old revision cannot unlock either a new revision or the old failed output",async()=>{
 const s=await setup();await s.confirm();const old=(await s.detail()).deliverables[0];
 await s.t.run(ctx=>ctx.db.insert("deliverables",{jobId:s.jobId,attempt:1,format:"json",content:'{"not":"approved yet"}',createdAt:Date.now()+1}));
 const revised=await s.detail();expect(revised.delivery.released).toBe(false);expect(revised.deliverables.every(d=>d.content===null)).toBe(true);expect(revised.deliverables.find(d=>d._id===old._id)?.content).toBeNull();
});
it("human work approval alone does not unlock content; its exact dispute binding must settle",async()=>{
 const s=await setup(false,true);expect((await s.detail()).job.state).toBe("disputed");
 await s.owner.mutation(api.jobs.resolveDispute,{id:s.jobId,decision:"approve",reason:"Reviewed metadata and independent checks; approve."});
 expect((await s.detail()).deliverables[0].content).toBeNull();await s.confirm();expect((await s.detail()).delivery.released).toBe(true);
});
it("normalization previews contain no processed CSV rows and unlock the exact stored file after confirmation",async()=>{
 const s=await setup(false,false,"csv_normalize");expect((await s.detail()).deliverables[0]).toMatchObject({content:null,preview:{rowCount:2,columnCount:2}});await s.confirm();expect((await s.detail()).deliverables[0].content).toBe("product,units\nBag,3\nBook,5");
});
it("cannot count one transaction identity or operator nonce twice across parent and child allocations",async()=>{
 const s=await setup(true);const childId=(await s.detail()).children[0]._id;
 const parentIntentId=await s.confirm();const childIntentId=await s.confirm(childId);
 const parent=(await s.owner.query(api.payments.forJob,{jobId:s.jobId}))!;
 const child=(await s.owner.query(api.payments.forJob,{jobId:childId}))!;
 expect((await s.detail()).delivery.released).toBe(true);
 for(const duplicate of [{txHash:parent.txHash},{nonce:parent.nonce}]){
  await s.t.run(ctx=>ctx.db.patch(childIntentId,{txHash:child.txHash,nonce:child.nonce,...duplicate}));
  const detail=await s.detail();expect(detail.delivery).toMatchObject({released:false,reason:"PAYMENT_EVIDENCE_NOT_DISTINCT"});
  expect(detail.deliverables[0].content).toBeNull();expect((await s.detail(childId)).deliverables[0].content).toBeNull();
 }
 expect(parentIntentId).not.toBe(childIntentId);
});
