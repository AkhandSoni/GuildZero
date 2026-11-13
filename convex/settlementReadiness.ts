import { ConvexError } from "convex/values";
import { allowanceSnapshot, allowanceDenials } from "./allowanceHelpers";
import type { QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { configuration, PAYMENT_CAP, testnetAccount } from "../lib/settlement/policy";
import { PUBLIC_AGENTS } from "../lib/agent-directory";
export function awardPaymentBlock(job: Pick<Doc<"jobs">,"engineManaged"|"serviceType"|"cleanBeforeProcessing"|"unfundedPreviewAcknowledged">, agentId: string, price: string) {
  if (!job.engineManaged) return null; // Existing legacy orchestration is not silently repriced.
  if (!/^[1-9]\d{0,27}$/.test(price) || BigInt(price) > PAYMENT_CAP) return "AWARD_EXCEEDS_SETTLEMENT_CAP";
  if (job.unfundedPreviewAcknowledged) return null;
  try {
    const config=configuration();
    const recipient=config.recipients[agentId];
    if (!config.enabled || typeof recipient!=="string" || !testnetAccount(recipient) || recipient===config.sender) return "SETTLEMENT_NOT_READY";
    if (job.cleanBeforeProcessing && !PUBLIC_AGENTS.some(agent=>agent.capabilities.some(capability => capability === "csv_normalize") && typeof config.recipients[agent.id]==="string" && testnetAccount(config.recipients[agent.id] as string) && config.recipients[agent.id]!==config.sender)) return "CLEANING_RECIPIENT_NOT_READY";
    return null;
  } catch { return "SETTLEMENT_NOT_READY"; }
}
export async function settlementReadiness(ctx: QueryCtx, mission: Doc<"missions">) {
  const reasons:string[]=[];
  let sender:string|null=null;
  try {
    const config=configuration();
    sender=testnetAccount(config.sender)?config.sender:null;
    if (!config.enabled) reasons.push("Testnet settlement is disabled or its operator signing configuration is incomplete.");
    const configured=(service:"csv_normalize"|"csv_summary")=>PUBLIC_AGENTS.some(agent=>agent.capabilities.some(capability => capability === service) && typeof config.recipients[agent.id]==="string" && testnetAccount(config.recipients[agent.id] as string) && config.recipients[agent.id]!==config.sender);
    if (!configured(mission.serviceType)) reasons.push("No eligible seller has a valid testnet recipient for this service.");
    if (mission.cleanBeforeProcessing && !configured("csv_normalize")) reasons.push("The required cleaning service has no valid testnet recipient.");
  } catch { reasons.push("Testnet recipient configuration is invalid."); }
  let allowance: { limitYocto: string; obligatedYocto: string; remainingYocto: string } | null = null;
  const allowanceReasons: string[] = [];
  try {
    const s = await allowanceSnapshot(ctx, mission.ownerId);
    const remaining = s.personalLimit > s.ownerUsed ? s.personalLimit - s.ownerUsed : 0n;
    allowance = { limitYocto: s.personalLimit.toString(), obligatedYocto: s.ownerUsed.toString(), remainingYocto: remaining.toString() };
    if (remaining === 0n) allowanceReasons.push("DEMO_OWNER_ALLOWANCE_EXCEEDED");
    if (s.globalUsed >= s.globalLimit) allowanceReasons.push("DEMO_OPERATOR_ALLOWANCE_EXCEEDED");
  } catch (error) {
    const code = error instanceof ConvexError && typeof error.data === "string" && allowanceDenials[error.data] ? error.data : "DEMO_ALLOWANCE_CONFIGURATION_REQUIRED";
    allowanceReasons.push(code);
  }
  reasons.push(...allowanceReasons.map(code => allowanceDenials[code]));
  const balance=sender?await ctx.db.query("operatorWalletSnapshots").withIndex("by_account",q=>q.eq("account",sender!)).unique():null;
  return { blocked:reasons.length>0,reasons,allowanceReasons,allowance,paymentCapYocto:PAYMENT_CAP.toString(),
    balance:balance?.checkedAt && balance.availableYocto!==undefined?{availableYocto:balance.availableYocto,checkedAt:balance.checkedAt,stale:Date.now()-balance.checkedAt>60000||!!balance.error}:null };
}
