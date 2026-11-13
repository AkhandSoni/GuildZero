"use client";
import { useEffect, useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { RefreshCw, Wallet, ArrowUpRight } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { formatNear } from "@/lib/money";
import { Button } from "@/components/ui/button";
export function OperatorWalletPanel() {
  const data = useQuery(api.operatorWallet.get, {});
  const refresh = useMutation(api.operatorWallet.refresh);
  const [message,setMessage] = useState("");
  useEffect(() => { if (data?.account && !data.snapshot) void refresh({}).catch(() => setMessage("Balance refresh is unavailable. Try again.")); }, [data,refresh]);
  const snapshot = data?.snapshot;
  const request = async () => {
    setMessage("");
    try { const response = await refresh({}); if (!response.ok) setMessage(response.code ?? "Refresh unavailable."); }
    catch { setMessage("Balance refresh is unavailable. Try again."); }
  };
  return <section className="panel operator-wallet" aria-label="Operator testnet wallet">
    <div className="section-heading"><div><p className="eyebrow">Shared operator wallet · NEAR testnet</p><h2><Wallet size={19} className="inline mr-2"/>Settlement account</h2></div><Button variant="outline" disabled={!data?.account} onClick={request}><RefreshCw size={14}/>Refresh balance</Button></div>
    {!data ? <p role="status">Loading operator configuration…</p> : !data.account ? <p className="muted text-sm">No testnet operator account is configured. Mission budgets still work as planning limits. Configure the backend account to view its balance.</p> : <>
      <a className="wallet-account" href={`https://testnet.nearblocks.io/address/${data.account}`} target="_blank" rel="noreferrer">{data.account}<ArrowUpRight size={14}/></a>
      <div className="wallet-balances"><div><span>Available for demo transfers</span><strong>{snapshot?.availableYocto !== undefined ? formatNear(snapshot.availableYocto) : "—"}<small> testnet NEAR</small></strong></div><div><span>On-chain total</span><p>{snapshot?.totalYocto !== undefined ? formatNear(snapshot.totalYocto) : "—"} NEAR</p></div></div>
      <p className="muted text-xs">Available excludes storage collateral and a 0.01 NEAR gas reserve; it does not subtract pending contracts. This shared custodial account funds demo payments. Your mission budget is a spending limit, not a deposit or a personal wallet balance.</p>
      {snapshot?.checkedAt && <details className="wallet-evidence"><summary>Last successful reading: {new Date(snapshot.checkedAt).toLocaleString()}</summary><p>Finalized block {snapshot.blockHeight}</p><p className="break-all">{snapshot.blockHash}</p><p>Storage collateral: {formatNear(snapshot.storageYocto!)} NEAR · Locked: {formatNear(snapshot.lockedYocto!)} NEAR</p></details>}
      {snapshot?.pending && <p className="muted text-xs mt-2" role="status">Reading testnet balance… If this takes longer than a minute, refresh again.</p>}
      {snapshot?.error && <p className="text-amber-900 text-sm mt-2" role="status">{snapshot.error}</p>}
    </>}
    {message && <p role="status" className="text-sm mt-2">{message}</p>}
  </section>;
}
