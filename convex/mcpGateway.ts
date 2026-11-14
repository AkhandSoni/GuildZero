import { activePaymentCap } from "../lib/settlement/policy";
import { ConvexError, v } from "convex/values";
import { internalMutation, httpAction, type MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { MCP_TOOL_NAMES, toolArgumentsSchemas, toolDataSchemas, toolScope, MAX_GATEWAY_BYTES, MCP_ERROR_CODES, type McpToolName } from "../lib/mcp/contracts";
import { credentialDigest, validToken, errorResult, MCP_RATE_WINDOW, MCP_INTEGRATION_RATE, MCP_OWNER_RATE } from "./mcpPolicy";
import { createOwned, listOwned } from "./missions";
import { startOwned } from "./jobs";
import { prepareIntent, quote, bindingReason } from "./paymentHelpers";
import { currentAttempt, recoveryEnabled } from "./paymentRecoveryHelpers";
import { missionProjection, jobReference, jobProjection, paymentProjection, resultProjection, safeEventDetail } from "./mcpProjections";
import { publicBid, publicContract, publicEvent, publicNegotiation } from "./publicMarket";
import { PUBLIC_AGENTS } from "../lib/agent-directory";
import { SERVICE_TYPES, SERVICE_LABELS } from "../lib/services";
import { validateMission } from "../lib/missions";
import { parseBoundedCsv } from "../lib/economy/csv-input";
import { validateServiceOptions } from "../lib/economy/contracts";
import { isBusinessService, serviceRequest, validateBusinessInput } from "../lib/economy/business-input";
import type { BusinessRequest } from "../lib/economy/types";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a],[b]) => a.localeCompare(b)).map(([key,val]) => `${JSON.stringify(key)}:${canonical(val)}`).join(",")}}`;
  return JSON.stringify(value);
}
const safeMessage: Record<string, string> = {
  UNAUTHENTICATED: "A valid active integration credential is required.", SCOPE_DENIED: "This credential does not permit this operation.", NOT_FOUND: "The requested resource was not found.",
  INVALID_INPUT: "Arguments do not match the bounded tool contract.", NOT_READY: "This operation is not ready; inspect the mission in GuildZero.", RATE_LIMITED: "Request limit reached; try again later.",
  REQUEST_ID_CONFLICT: "This request ID was already used with different input.", BACKEND_UNAVAILABLE: "The backend could not complete this request; reuse the same domain identity.",
  HUMAN_PREVIEW_ACKNOWLEDGMENT_REQUIRED: "Settlement is unavailable. The owner must acknowledge metadata-only processing in the GuildZero UI.",
};
function failure(code: string) { return errorResult(code, safeMessage[code] ?? "This operation is unavailable."); }
async function consume(ctx: MutationCtx, key: string, maximum: number) {
  const row = await ctx.db.query("mcpRateLimits").withIndex("by_key", q => q.eq("key", key)).unique();
  const now = Date.now();
  if (!row) { await ctx.db.insert("mcpRateLimits", {key, windowStart: now, count: 1}); return true; }
  if (row.windowStart + MCP_RATE_WINDOW <= now) { await ctx.db.patch(row._id, {windowStart: now, count: 1}); return true; }
  if (row.count >= maximum) return false;
  await ctx.db.patch(row._id, {count: row.count + 1}); return true;
}
async function audit(ctx: MutationCtx, principal: Doc<"mcpIntegrations">, tool: string, decision: "allow" | "deny", reason: string, resourceId?: string) {
  await ctx.db.insert("mcpAudit", {ownerId: principal.ownerId, integrationId: principal._id, tool, decision, reason, createdAt: Date.now(), ...(resourceId ? {resourceId} : {})});
}
function uiLink(missionId: string) {
  const raw = process.env.GUILDZERO_MCP_UI_ORIGIN;
  if (!raw) throw new ConvexError("MCP_UI_ORIGIN_REQUIRED");
  const url = new URL(raw);
  if (url.username || url.password || url.search || url.hash || url.pathname !== "/" ||
    !(url.protocol === "https:" || (url.protocol === "http:" && ["localhost","127.0.0.1","[::1]"].includes(url.hostname)))) throw new ConvexError("MCP_UI_ORIGIN_REQUIRED");
  return new URL(`/missions/${encodeURIComponent(missionId)}`, url).href;
}
async function principalFor(ctx: MutationCtx, digest: string) {
  if (!/^[0-9a-f]{64}$/.test(digest)) return null;
  const principal = await ctx.db.query("mcpIntegrations").withIndex("by_digest", q => q.eq("digest", digest)).unique();
  if (!principal || !principal.active || principal.revokedAt !== undefined || principal.expiresAt <= Date.now()) return null;
  const owner = await ctx.db.get(principal.ownerId);
  return owner && owner.mcpDisabledAt === undefined ? principal : null;
}
async function ownedMission(ctx: MutationCtx, principal: Doc<"mcpIntegrations">, raw: string) {
  const id = ctx.db.normalizeId("missions", raw);
  const mission = id ? await ctx.db.get(id) : null;
  return mission && mission.ownerId === principal.ownerId && (!principal.missionIds || principal.missionIds.includes(mission._id)) ? mission : null;
}
async function ownedJob(ctx: MutationCtx, principal: Doc<"mcpIntegrations">, raw: string) {
  const id = ctx.db.normalizeId("jobs", raw), job = id ? await ctx.db.get(id) : null;
  if (!job || job.ownerId !== principal.ownerId || !await ownedMission(ctx, principal, job.missionId)) return null;
  return job;
}
function encodeCursor(value: unknown) { return btoa(unescape(encodeURIComponent(JSON.stringify(value)))); }
function decodeCursor(raw: string): unknown { try { return JSON.parse(decodeURIComponent(escape(atob(raw)))); } catch { throw new ConvexError("INVALID_CURSOR"); } }

// A single bounded admission bucket also covers malformed/missing credentials.
// It creates no attacker-selected keys and stops body/hash/domain work at capacity.
export const admit = internalMutation({args:{},handler:async ctx=>consume(ctx,"gateway",1200)});

export const dispatch = internalMutation({args: {digest: v.string(), request: v.any()}, handler: async (ctx, {digest, request}) => {
  const principal = await principalFor(ctx, digest);
  if (!principal) { await consume(ctx, "unauthenticated", 120); return failure("UNAUTHENTICATED"); }
  const permitted = await consume(ctx, `integration:${principal._id}`, MCP_INTEGRATION_RATE);
  const ownerPermitted = await consume(ctx, `owner:${principal.ownerId}`, MCP_OWNER_RATE);
  const envelope = request && typeof request === "object" && !Array.isArray(request) ? request as Record<string,unknown> : {};
  const tool = typeof envelope.tool === "string" && (MCP_TOOL_NAMES as readonly string[]).includes(envelope.tool) ? envelope.tool as McpToolName : null;
  const deny = async (code: string) => { await audit(ctx, principal, tool ?? "invalid", "deny", code); return failure(code); };
  if (!permitted || !ownerPermitted) return deny("RATE_LIMITED");
  if (!tool || Object.keys(envelope).length !== 2 || !("arguments" in envelope) || new TextEncoder().encode(JSON.stringify(request)).length > MAX_GATEWAY_BYTES) return deny("INVALID_INPUT");
  if (!principal.scopes.includes(toolScope[tool])) return deny("SCOPE_DENIED");
  const parsed = toolArgumentsSchemas[tool].safeParse(envelope.arguments);
  if (!parsed.success) return deny("INVALID_INPUT");
  const args = parsed.data;
  let mission: Doc<"missions"> | null = null, job: Doc<"jobs"> | null = null;
  if ("missionId" in args) { mission = await ownedMission(ctx, principal, args.missionId); if (!mission) return deny("NOT_FOUND"); }
  if ("jobId" in args) { job = await ownedJob(ctx, principal, args.jobId); if (!job) return deny("NOT_FOUND"); }
  let data: unknown;
  switch (tool) {
    case "guildzero_list_services": {
      const optionNames = {csv_normalize:["columns","caseMode"],csv_summary:["columns"],csv_validate:["columns","numericColumns"],csv_reconcile:["columns","keyColumn","comparisonCsv"],csv_report:["columns","groupBy"]};
      data = {services:SERVICE_TYPES.map(id => ({id,label:SERVICE_LABELS[id],requiredDatasets:id === "csv_reconcile" ? 2 : 1,options:optionNames[id],outputFormats:id === "csv_normalize" ? ["csv"] : ["json"]})),limits:{csvBytes:65536,rows:500,columns:32,deliverableBytes:131072,maxAutomatedAwardYocto:activePaymentCap().toString(),maxTransferYocto:activePaymentCap().toString()}};
      break;
    }
    case "guildzero_list_agents": {
      const rows = principal.missionIds ? (await Promise.all(principal.missionIds.map(id => ctx.db.query("jobs").withIndex("by_mission",q=>q.eq("missionId",id)).take(3)))).flat().filter(row=>row.ownerId===principal.ownerId).sort((a,b)=>b._creationTime-a._creationTime)
        : await ctx.db.query("jobs").withIndex("by_owner",q=>q.eq("ownerId",principal.ownerId)).order("desc").take(101);
      const history = (await Promise.all(rows.slice(0,100).map(row=>ctx.db.query("reputationEvents").withIndex("by_job",q=>q.eq("jobId",row._id)).take(1)))).flat();
      data = {agents: PUBLIC_AGENTS.map(profile=>({...profile,totalDelta:history.filter(row=>row.agentId===profile.id).reduce((sum,row)=>sum+row.delta,0),historyWindow:"latest-100-owner-jobs",truncated:rows.length>100})),capacityIsAvailability:false}; break;
    }
    case "guildzero_create_mission": {
      if (principal.missionIds) return deny("SCOPE_DENIED");
      const input = toolArgumentsSchemas.guildzero_create_mission.parse(args);
      const {requestId,...brief} = input;
      const fingerprint = await credentialDigest(canonical(brief));
      const existing = await ctx.db.query("mcpRequests").withIndex("by_integration_request",q=>q.eq("integrationId",principal._id).eq("requestId",requestId)).unique();
      if (existing) { if (existing.fingerprint !== fingerprint) return deny("REQUEST_ID_CONFLICT"); data={missionId:existing.missionId,state:"draft"}; break; }
      // Validate service-specific semantic constraints before creating a draft.
      try { validateMission(brief); } catch { return deny("INVALID_INPUT"); }
      const csv = parseBoundedCsv(brief.inputCsv);
      if (!csv.ok) return deny("INVALID_INPUT");
      const options = validateServiceOptions(brief.serviceType,brief.options,csv.value.rawHeader);
      if (!options.ok) return deny("INVALID_INPUT");
      if (isBusinessService(brief.serviceType)) {
        const valid = validateBusinessInput(serviceRequest(brief.serviceType,brief.inputCsv,options.value) as BusinessRequest);
        if (!valid.ok) return deny("INVALID_INPUT");
      }
      const missionId = await createOwned(ctx,brief,principal.ownerId);
      await ctx.db.insert("mcpRequests",{ownerId:principal.ownerId,integrationId:principal._id,requestId,fingerprint,missionId,createdAt:Date.now()});
      data={missionId,state:"draft"}; break;
    }
    case "guildzero_get_mission": {
      const rows=await ctx.db.query("jobs").withIndex("by_mission",q=>q.eq("missionId",mission!._id)).take(3);
      data={mission:missionProjection(mission!),jobs:rows.slice(0,2).filter(row=>row.ownerId===principal.ownerId).map(jobReference),truncated:rows.length>2}; break;
    }
    case "guildzero_list_missions": {
      const input=toolArgumentsSchemas.guildzero_list_missions.parse(args), limit=input.limit??20;
      const filter={search:input.search??null,state:input.state??null,serviceType:input.serviceType??null};
      let inner: string | null=null;
      if(input.cursor){const cursor=decodeCursor(input.cursor);if(!cursor||typeof cursor!=="object"||!("integrationId" in cursor)||cursor.integrationId!==principal._id||!("filter"in cursor)||canonical(cursor.filter)!==canonical(filter)||!("cursor"in cursor)||typeof cursor.cursor!=="string")return deny("INVALID_INPUT");inner=cursor.cursor;}
      if(principal.missionIds){
        const rows=(await Promise.all(principal.missionIds.map(id=>ctx.db.get(id)))).filter((row):row is Doc<"missions">=>Boolean(row&&row.ownerId===principal.ownerId)).filter(row=>(!input.state||row.state===input.state)&&(!input.serviceType||row.serviceType===input.serviceType)&&(!input.search||row.title.toLocaleLowerCase().includes(input.search.toLocaleLowerCase()))).sort((a,b)=>b._creationTime-a._creationTime);
        const offset=inner===null?0:Number(inner);if(!Number.isInteger(offset)||offset<0||offset>50)return deny("INVALID_INPUT");
        const page=rows.slice(offset,offset+limit),isDone=offset+limit>=rows.length;
        data={missions:page.map(missionProjection),isDone,cursor:isDone?null:encodeCursor({integrationId:principal._id,filter,cursor:String(offset+limit)})};
      }else{
        const page=await listOwned(ctx,{paginationOpts:{numItems:limit,cursor:inner},...(input.search?{search:input.search}:{}),...(input.state?{state:input.state}:{}),...(input.serviceType?{serviceType:input.serviceType}:{})},principal.ownerId);
        data={missions:page.page.map(missionProjection),isDone:page.isDone,cursor:page.isDone?null:encodeCursor({integrationId:principal._id,filter,cursor:page.continueCursor})};
      }break;
    }
    case "guildzero_start_auction": {
      let jobId: Id<"jobs">;
      try { jobId=await startOwned(ctx,{missionId:mission!._id,allowUnfundedPreview:false},principal.ownerId); }
      catch(error){if(error instanceof ConvexError&&error.data==="SETTLEMENT_NOT_READY_ACKNOWLEDGE_PREVIEW"){await audit(ctx,principal,tool,"deny","HUMAN_PREVIEW_ACKNOWLEDGMENT_REQUIRED",mission!._id);return {...failure("HUMAN_PREVIEW_ACKNOWLEDGMENT_REQUIRED"),approvalUrl:uiLink(mission!._id)};}throw error;}
      const started=await ctx.db.get(jobId);data={missionId:mission!._id,jobId,state:started!.state};break;
    }
    case "guildzero_get_auction": {
      const [bids,negotiations,contracts,children]=await Promise.all([
        ctx.db.query("bids").withIndex("by_job",q=>q.eq("jobId",job!._id)).take(11),ctx.db.query("negotiations").withIndex("by_job",q=>q.eq("jobId",job!._id)).take(31),ctx.db.query("contracts").withIndex("by_job",q=>q.eq("jobId",job!._id)).take(1),ctx.db.query("jobs").withIndex("by_parent",q=>q.eq("parentId",job!._id)).take(2)]);
      data={job:jobProjection(job!),bids:bids.slice(0,10).map(publicBid),negotiations:negotiations.slice(0,30).map(publicNegotiation),contracts:contracts.map(publicContract),children:children.slice(0,1).filter(row=>row.ownerId===principal.ownerId&&row.missionId===job!.missionId).map(row=>({id:row._id,state:row.state})),truncated:bids.length>10||negotiations.length>30||children.length>1};break;
    }
    case "guildzero_get_activity": {
      const input=toolArgumentsSchemas.guildzero_get_activity.parse(args),limit=input.limit??50;
      const rows=await ctx.db.query("economyEvents").withIndex("by_job",q=>q.eq("jobId",job!._id)).order("desc").take(limit+1);
      data={jobId:job!._id,events:rows.slice(0,limit).filter(row=>row.ownerId===principal.ownerId).reverse().map(row=>({...publicEvent(row),detail:safeEventDetail(row.type)})),truncated:rows.length>limit};break;
    }
    case "guildzero_get_verification": {
      const latest=await ctx.db.query("deliverables").withIndex("by_job",q=>q.eq("jobId",job!._id)).order("desc").first();
      const verification=latest?await ctx.db.query("verifications").withIndex("by_deliverable",q=>q.eq("deliverableId",latest._id)).unique():null;
      data={jobId:job!._id,state:job!.state,verdict:verification?.verdict??null,checks:(verification?.checks??[]).slice(0,100).map(check=>({code:check.code,passed:check.passed})),requiresHumanReview:job!.requiresHumanReview??true,revisionCount:job!.revisionCount};break;
    }
    case "guildzero_get_result": data=await resultProjection(ctx,job!);break;
    case "guildzero_get_payment_status": data={jobId:job!._id,intent:await paymentProjection(ctx,job!)};break;
    case "guildzero_prepare_payment": {
      const result=await prepareIntent(ctx,job!);if(!result.ok){await audit(ctx,principal,tool,"deny","NOT_READY",job!._id);return failure("NOT_READY");}
      data={jobId:job!._id,intent:await paymentProjection(ctx,job!)};break;
    }
    case "guildzero_request_payment_authorization": {
      const stored=await ctx.db.query("paymentIntents").withIndex("by_job",q=>q.eq("jobId",job!._id)).unique();
      if(!stored||stored.ownerId!==principal.ownerId||stored.status!=="READY"||stored.authorizedAt!==undefined)return deny("NOT_READY");
      if(stored.recoveryVersion===2){const attempt=await currentAttempt(ctx,stored);if(!recoveryEnabled()||!attempt||attempt.phase!=="READY"||attempt.authorizedAt!==undefined)return deny("NOT_READY");}
      try {if(bindingReason(stored,await quote(ctx,job!)))return deny("NOT_READY");}catch{return deny("NOT_READY");}
      const intent=await paymentProjection(ctx,job!);if(!intent)return deny("NOT_READY");
      data={jobId:job!._id,intent,approvalRequired:true,approvalUrl:uiLink(job!.missionId)};break;
    }
  }
  // A mismatched projection aborts the transaction, including any domain writes.
  const output=toolDataSchemas[tool].parse(data);
  await audit(ctx,principal,tool,"allow","OK",job?._id??mission?._id);
  let workflowState: string | undefined;
  if(tool === "guildzero_create_mission") workflowState="created";
  const state = job?.state ?? (tool === "guildzero_start_auction" && output && "state" in output ? output.state : undefined);
  if(state === "bidding" || state === "working") workflowState="running";
  if(state === "verifying" || state === "revision") workflowState="waiting_for_verification";
  if(state === "disputed") workflowState="waiting_for_human_review";
  if(state === "rejected" || state === "cancelled" || state === "unawarded") workflowState="failed";
  if(output && "intent" in output && output.intent) {
    const payment=output.intent;
    workflowState=payment.confirmed ? "confirmed" : payment.status === "UNKNOWN_RECONCILE" ? "requires_reconciliation" : payment.status === "FAILED" ? "failed" : payment.status === "READY" ? "waiting_for_payment_approval" : "settling";
  }
  if(tool === "guildzero_get_result" && output && "locked" in output && !output.locked)workflowState="confirmed";
  return {version:1 as const,ok:true as const,code:"OK" as const,checkedAt:Date.now(),data:output,...(workflowState?{workflowState}:{})};
}});

export const recordFailure = internalMutation({args:{digest:v.string(),tool:v.string(),code:v.string()},handler:async(ctx,{digest,tool,code})=>{
  const principal=await principalFor(ctx,digest);if(!principal)return;
  if((tool!=="invalid"&&!(MCP_TOOL_NAMES as readonly string[]).includes(tool))||!(MCP_ERROR_CODES as readonly string[]).includes(code))return;
  if(!await consume(ctx,`integration:${principal._id}`,MCP_INTEGRATION_RATE))return;
  if(!await consume(ctx,`owner:${principal.ownerId}`,MCP_OWNER_RATE))return;
  await audit(ctx,principal,tool,"deny",code);
}});
function mapFailure(error: unknown) {
  const raw=error instanceof ConvexError?error.data:null;
  const code=typeof raw==="string"?raw:raw&&typeof raw==="object"&&"code"in raw?String(raw.code):"";
  if(code==="INVALID_CURSOR"||code==="INVALID_OR_EXPIRED_MISSION"||code==="INVALID_INPUT"||code.startsWith("INVALID_")||["OPTIONS_REQUIRED","DATASET_REMOVED"].includes(code))return "INVALID_INPUT";
  if(code==="MISSION_NOT_FOUND"||code==="JOB_NOT_FOUND")return "NOT_FOUND";
  if(code==="MCP_UI_ORIGIN_REQUIRED")return "BACKEND_UNAVAILABLE";
  return error instanceof ConvexError ? "NOT_READY" : "BACKEND_UNAVAILABLE";
}
export const gateway = httpAction(async (ctx, request) => {
  const headers={"content-type":"application/json","cache-control":"no-store"};
  let digest="",tool="invalid";
  const respond=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
  try {
    if(!await ctx.runMutation(internal.mcpGateway.admit,{}))return respond(failure("RATE_LIMITED"),429);
    const authorization=request.headers.get("authorization")??"";
    const match=/^Bearer (gzmcp_[0-9a-f]{64})$/.exec(authorization);
    if(!match||!validToken(match[1]))return respond(failure("UNAUTHENTICATED"),401);
    digest=await credentialDigest(match[1]);
    if(request.headers.get("content-type")?.split(";")[0].trim().toLowerCase()!=="application/json")return respond(failure("INVALID_INPUT"),400);
    if(Number(request.headers.get("content-length"))>MAX_GATEWAY_BYTES)return respond(failure("INVALID_INPUT"),413);
    const reader=request.body?.getReader();let bytes=0;const chunks:Uint8Array[]=[];
    const deadline=Date.now()+15_000;
    if(!reader)return respond(failure("INVALID_INPUT"),400);
    while(true){if(Date.now()>deadline){await reader.cancel();return respond(failure("BACKEND_UNAVAILABLE"),503);}const next=await new Promise<ReadableStreamReadResult<Uint8Array>>((resolve,reject)=>{const timer=setTimeout(()=>{void reader.cancel();reject(new Error("BODY_TIMEOUT"));},Math.max(1,deadline-Date.now()));reader.read().then(value=>{clearTimeout(timer);resolve(value);},error=>{clearTimeout(timer);reject(error);});});if(next.done)break;bytes+=next.value.byteLength;if(bytes>MAX_GATEWAY_BYTES){await reader.cancel();return respond(failure("INVALID_INPUT"),413);}chunks.push(next.value);}
    const combined=new Uint8Array(bytes);let offset=0;for(const chunk of chunks){combined.set(chunk,offset);offset+=chunk.length;}
    let input:unknown;try{input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(combined));}catch{return respond(failure("INVALID_INPUT"),400);}
    tool=input&&typeof input==="object"&&"tool"in input&&typeof input.tool==="string"?input.tool:"invalid";
    const result=await ctx.runMutation(internal.mcpGateway.dispatch,{digest,request:input});
    if(new TextEncoder().encode(JSON.stringify(result)).length>MAX_GATEWAY_BYTES)return respond(failure("BACKEND_UNAVAILABLE"),503);
    return respond(result,result.ok?200:result.code==="UNAUTHENTICATED"?401:result.code==="RATE_LIMITED"?429:200);
  } catch(error) {
    const code=mapFailure(error);
    if(digest&&tool)try{await ctx.runMutation(internal.mcpGateway.recordFailure,{digest,tool,code});}catch{/* Never disclose infrastructure errors. */}
    return respond(failure(code),code==="BACKEND_UNAVAILABLE"?503:200);
  }
});
