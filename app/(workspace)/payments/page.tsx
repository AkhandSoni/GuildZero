"use client";
import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { OperatorWalletPanel } from "@/components/operator-wallet-panel";
import { formatNear } from "@/lib/money";
import { paymentFailureMessage } from "@/lib/settlement/failures";
export default function Payments() {
  const data=useQuery(api.marketViews.overview,{});
  const [status,setStatus]=useState("all");
  const rows=data?.payments.filter(payment=>status==="all"||payment.status===status);
  return <><div className="dashboard-heading"><div><p className="eyebrow">Testnet settlement</p><h1>Payments</h1><p className="muted mt-2 text-sm">Your payment intents and receipts. Only confirmed transactions count as paid.</p></div></div>
  <OperatorWalletPanel/>
  <section className="panel"><div className="section-heading"><h2>Payment history</h2><label className="field text-xs">Payment status<select aria-label="Payment status" className="control" value={status} onChange={event=>setStatus(event.target.value)}>{["all","READY","SUBMITTING","CONFIRMING","UNKNOWN_RECONCILE","CONFIRMED","FAILED"].map(value=><option key={value} value={value}>{value==="all"?"All statuses":value.replaceAll("_"," ")}</option>)}</select></label></div>
  <p className="muted text-xs mb-4">Latest 50 owner-private payment intents. Mission workspaces retain their complete receipt. {data?.truncated.payments&&"Older intents are outside this view."}</p>
  {!data?<p role="status">Loading payment history…</p>:!rows?.length?<p className="muted">{data.payments.length?"No payments match this status.":"No payments prepared. Open an approved mission to review an exact payment."}</p>:<div className="payment-history">{rows.map(payment=>{
    return <article key={payment._id}><div className="flex flex-wrap justify-between gap-2"><h3>{payment.missionTitle??"Recorded job"}</h3><span className="count-pill">{payment.status}</span></div><strong>{formatNear(payment.amountYocto)} testnet NEAR</strong><p className="break-all text-xs muted">To {payment.recipient}</p><p className="text-xs muted mt-1">Prepared {new Date(payment.createdAt).toLocaleString()}</p>{payment.status==="FAILED"&&<p className="text-sm mt-2">{paymentFailureMessage(payment.lastReason)??"This payment did not complete. Review its receipt for the recorded evidence."}</p>}{payment.status==="UNKNOWN_RECONCILE"&&<p className="text-sm mt-2">The outcome needs checking. Open the receipt to reconcile the existing transaction.</p>}<div className="flex flex-wrap gap-4 mt-3 text-sm">{payment.missionId&&<Link href={`/missions/${payment.missionId}`}>Open mission receipt ↗</Link>}{payment.txHash&&<a href={`https://testnet.nearblocks.io/txns/${payment.txHash}`} target="_blank" rel="noreferrer">{payment.status==="CONFIRMED"?"Confirmed transaction":"Recorded transaction hash"} ↗</a>}</div></article>;
  })}</div>}
  </section></>;
}
