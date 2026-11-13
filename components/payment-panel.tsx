"use client";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { isPreBroadcastFailure, paymentFailureMessage } from "@/lib/settlement/failures";
import { formatNear } from "@/lib/money";
export function PaymentPanel({
  jobId,
  approved,
}: {
  jobId: Id<"jobs">;
  approved: boolean;
}) {
  const intent = useQuery(api.payments.forJob, { jobId }),
    config = useQuery(api.payments.status, {}),
    allowance = useQuery(api.payments.allowance, {});
  const prepare = useMutation(api.payments.prepare),
    authorize = useMutation(api.payments.authorize),
    reconcile = useMutation(api.payments.reconcile);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  const act = async (fn: () => Promise<{ ok: boolean; code?: string }>) => {
    setBusy(true);
    setMessage("");
    try {
      const r = await fn();
      if (!r.ok) setMessage(r.code ?? "Payment request rejected.");
    } catch (e) {
      setMessage(
        e instanceof ConvexError
          ? String(e.data)
          : "Request unavailable. Check the stored payment state before retrying.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="panel payment-receipt">
      <p className="eyebrow">Custodial settlement · NEAR testnet only</p>
      <h2>Payment receipt</h2>
      <p className="muted mt-3 text-sm">
        {config?.enabled
          ? "Settlement is enabled. Review the exact recipient and amount before authorizing."
          : "Settlement is disabled until dedicated testnet credentials are configured. No real funds are used."}
      </p>
      <div className="muted mt-3 text-sm">
        <p>Operator-managed demo allowance: permission to use shared testnet funds, not a wallet or deposit.</p>
        {allowance?.configured ? <p>Your lifetime limit: {formatNear(allowance.limitYocto)} NEAR; allocated or consumed: {formatNear(allowance.obligatedYocto)} NEAR; unallocated: {formatNear(allowance.remainingYocto)} NEAR. Existing contracts include any subcontract once. This does not guarantee operator liquidity.</p> : <p>No usable personal allowance is available. Ask the operator to configure your account before authorizing settlement.</p>}
      </div>
      {intent === undefined ? (
        <p role="status">Loading payment state…</p>
      ) : !intent ? (
        <>
          <p className="muted mt-3 text-sm">
            {approved
              ? "Work is approved; payment still requires your exact authorization."
              : "Verified or buyer-approved work is required before payment."}
          </p>
          <Button
            className="mt-4"
            disabled={busy || !approved}
            onClick={() => act(() => prepare({ jobId }))}
          >
            Prepare exact payment
          </Button>
        </>
      ) : (
        <div className="mt-4 grid gap-3 text-sm">
          <p>
            Status: <strong>{intent.status}</strong>
            {intent.status === "CONFIRMED"
              ? " · Matching final chain receipt verified"
              : " · Not a confirmed payment"}
          </p>
          <p className="break-all">Recipient: {intent.recipient}</p>
          <p>Amount: {formatNear(intent.amountYocto)} testnet NEAR</p>
          {paymentFailureMessage(intent.lastReason) && <p className="muted">{paymentFailureMessage(intent.lastReason)}</p>}
          {intent.lastReason && <details className="text-xs muted"><summary>Technical payment details</summary><code className="break-all">{intent.lastReason}</code></details>}
          {intent.txHash && (
            <a
              className="break-all text-emerald-800 underline"
              target="_blank"
              rel="noreferrer"
              href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(intent.txHash)}`}
            >
              Transaction hash: {intent.txHash}
            </a>
          )}
          {intent.blockHash && (
            <p className="muted break-all">
              Evidence block: {intent.blockHash}
            </p>
          )}
          {intent.status === "READY" && !intent.authorizedAt && (
            <form
              className="grid gap-3"
              onSubmit={(e) => {
                e.preventDefault();
                void act(() =>
                  authorize({
                    intentId: intent._id,
                    recipient: intent.recipient,
                    amountYocto: intent.amountYocto,
                  }),
                );
              }}
            >
              <label className="flex items-start gap-2">
                <input type="checkbox" required />I approve this exact recipient
                and testnet amount.
              </label>
              <Button className="w-fit" disabled={busy || !config?.enabled || !allowance?.configured}>
                Authorize testnet payment
              </Button>
            </form>
          )}
          {intent.status === "READY" && intent.authorizedAt && (
            <p className="muted">
              Owner authorization recorded; worker has not claimed this payment
              yet.
            </p>
          )}
          {intent.status === "SUBMITTING" && !intent.txHash && (
            <p className="muted">
              Worker claimed this payment before recording a transaction hash.
              Signer lock is retained; automatic retry is disabled pending
              operator review.
            </p>
          )}
          {intent.txHash &&
            ["CONFIRMING", "UNKNOWN_RECONCILE"].includes(intent.status) && (
              <>
                <p className="muted">
                  Reconciliation checks the existing transaction. It never
                  resends the transfer.
                </p>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => act(() => reconcile({ intentId: intent._id }))}
                >
                  Check existing transaction
                </Button>
              </>
            )}
          {intent.status === "FAILED" && (
            <p className="muted">
              {isPreBroadcastFailure(intent.lastReason) ? "Nothing was broadcast for this attempt, so it used no transaction gas. No automatic retry will occur." : "No automatic retry is allowed. Gas may have been charged if a transaction was submitted."}
            </p>
          )}
        </div>
      )}
      {message && (
        <p role="alert" className="mt-4 text-amber-800">
          {message}
        </p>
      )}
    </section>
  );
}
