import * as React from "react";
import Link from "next/link";
import { Button } from "./ui/button";
import { allowanceDenials } from "@/lib/allowance-reasons";

export function WorkflowError({ state, code, retryCount, busy, onRetry, engineManaged }: {
  state: string; engineManaged: boolean; code?: string; retryCount: number; busy: boolean; onRetry: () => void;
}) {
  if (!code) return null;
  const active = ["bidding", "working", "revision", "verifying"].includes(state);
  const policyReason = Object.hasOwn(allowanceDenials, code) ? allowanceDenials[code] : null;
  const retryable = engineManaged && active && retryCount < 3 && !policyReason;
  return <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4" role="status">
    {retryable ? <><p className="text-sm">The workflow paused safely. Review configuration, then retry the existing stage.</p><Button className="mt-3" variant="outline" disabled={busy} onClick={onRetry}>Retry workflow stage</Button></> : <>
      <p className="text-sm">{policyReason ? `${code}: ${policyReason}` : "This workflow cannot be retried in its current state."}</p>
      <p className="mt-2 text-sm">{policyReason ? "Ask the operator to review spending permissions. " : "Review the recorded outcome. "}Use “Use as new mission” above to revise this brief, or create a new brief. This stage cannot be retried.</p>
      <Link href="/missions/new" className="mt-3 inline-block underline">Create a new brief</Link>
    </>}
  </div>;
}
