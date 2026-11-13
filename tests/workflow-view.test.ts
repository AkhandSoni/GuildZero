import { expect, it } from "vitest";
import { recentMetrics, workflowSteps } from "../lib/workflow-view";
import { walletAmounts } from "../lib/settlement/wallet";
import { paymentFailureMessage, preparationReason } from "../lib/settlement/failures";
it("does not turn accepted work into confirmed payment or child success into parent success", () => {
  const failed = workflowSteps("disputed", ["CONTRACT_AWARDED", "EXECUTION_REQUIRES_REVIEW"]);
  expect(failed[1].tone).toBe("attention");
  expect(failed[2].tone).toBe("attention");
  expect(failed[3].tone).toBe("pending");
  expect(workflowSteps("approved", [])[3]).toMatchObject({ detail: "Not prepared", tone: "pending" });
  expect(workflowSteps("approved", [], "UNAVAILABLE")[3].detail).toBe("Open receipt for status");
  expect(workflowSteps("approved", [], "UNKNOWN_RECONCILE")[3].tone).toBe("attention");
  expect(workflowSteps("approved", [], "CONFIRMED")[3].tone).toBe("done");
});
it("counts main jobs separately and sums only actual confirmed transfers with BigInt", () => {
  const metrics = recentMetrics([
    {_id:"1",missionId:"m",serviceType:"csv_summary",state:"disputed"},
    {_id:"2",missionId:"m",parentId:"1",serviceType:"csv_normalize",state:"approved"},
    {_id:"3",missionId:"n",serviceType:"csv_summary",state:"rejected"},
  ], [{status:"CONFIRMED",amountYocto:"100000000000000000000001"},{status:"CONFIRMED",amountYocto:"200000000000000000000001"},{status:"READY",amountYocto:"900000000000000000000000"}]);
  expect(metrics).toMatchObject({review:1,approved:0,confirmedYocto:"300000000000000000000002"});
});
it("keeps wallet accounting exact, subtracts storage and gas, rejects malformed evidence", () => {
  expect(walletAmounts({amount:"1000000000000000000000000",locked:"500",storage_usage:100},"10000000000000000000")).toEqual({ liquidYocto:"1000000000000000000000000",lockedYocto:"500",totalYocto:"1000000000000000000000500",storageYocto:"1000000000000000000000",availableYocto:"989000000000000000000000" });
  expect(walletAmounts({amount:"1",locked:"0",storage_usage:1},"1").availableYocto).toBe("0");
  expect(() => walletAmounts({amount:"-1",locked:"0",storage_usage:1},"1")).toThrow();
  expect(() => walletAmounts({amount:"1",locked:"0",storage_usage:Infinity},"1")).toThrow();
});
it("persists only allowlisted payment diagnostics and explains older generic failures honestly", () => {
  expect(preparationReason("secret-private-key")).toBe("PROVEN_PRE_BROADCAST_FAILURE");
  expect(preparationReason("OPERATOR_ACCOUNT_LOOKUP_FAILED")).toContain(":OPERATOR_ACCOUNT_LOOKUP_FAILED");
  expect(paymentFailureMessage("PROVEN_PRE_BROADCAST_FAILURE")).toMatch(/not recorded/);
});
