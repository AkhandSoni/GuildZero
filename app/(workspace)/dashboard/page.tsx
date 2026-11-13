"use client";
import Link from "next/link";
import { usePaginatedQuery,useQuery } from "convex/react";
import { ArrowUpRight, CheckCircle2, CircleAlert, Clock3, Wallet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatNear } from "@/lib/money";
import { recentMetrics } from "@/lib/workflow-view";
import { ActivityStory } from "@/components/activity-story";
import { MissionBrowser } from "@/components/mission-browser";
import { OperatorWalletPanel } from "@/components/operator-wallet-panel";
import { DemoControls } from "@/components/demo-controls";
export default function Dashboard(){
  const {results,status}=usePaginatedQuery(api.missions.list,{}, {initialNumItems:20});
  const data=useQuery(api.marketViews.overview,{});
  const metrics=data?recentMetrics(data.jobs,data.payments):null;
  const ready=data?.payments.filter(p=>p.status==="READY"&&!p.authorizedAt)??[];
  const reviews=[...new Map((data?.jobs.filter(j=>j.state==="disputed")??[]).map(j=>[j.missionId,j])).values()];
  const retry=data?.jobs.find(j=>!j.parentId&&["rejected","unawarded"].includes(j.state));
  return <>
    <div className="dashboard-heading"><div><p className="eyebrow">Mission control</p><h1>Dashboard</h1><p className="muted mt-2 text-sm">Track active work, review results and manage testnet settlement.</p></div><Button asChild><Link href="/missions/new">+ New mission</Link></Button></div>
    <section className="dashboard-metrics" aria-label="Recent workspace metrics">{[
      {label:"In progress",value:metrics?.active,detail:"Main jobs still underway",Icon:Clock3,tone:"blue"},
      {label:"Needs review",value:metrics?.review,detail:"Missions waiting for you",Icon:CircleAlert,tone:"amber"},
      {label:"Work accepted",value:metrics?.approved,detail:"Work approved · payment separate",Icon:CheckCircle2,tone:"green"},
      {label:"Confirmed transfers",value:metrics?formatNear(metrics.confirmedYocto):undefined,detail:"Testnet NEAR · verified receipts",Icon:Wallet,tone:"purple"},
    ].map(({label,value,detail,Icon,tone})=><article className={`dashboard-metric ${tone}`} key={label}><div><p>{label}</p><span className="metric-icon"><Icon size={18}/></span></div><strong>{value??"—"}</strong><span>{detail}</span></article>)}</section>
    <p className="dashboard-data-note">Recent recorded activity: up to 50 jobs and 50 payment intents. Subcontracts are excluded from main-job counts. Work acceptance and payment are separate.</p>
    <div className="dashboard-action-row">
      <section className="panel attention-panel"><div className="section-heading"><h2>Needs your approval <span className="count-pill">{data?reviews.length+ready.length:"—"}</span></h2><Link href="/economy">View activity <ArrowUpRight size={13}/></Link></div>
        {reviews.length+ready.length?<div className="attention-list">{reviews.slice(0,3).map(job=><Link key={job.missionId} href={`/missions/${job.missionId}`}><span className="attention-icon"><CircleAlert size={18}/></span><div><strong>Review work</strong><p>{job.title}</p></div><ArrowUpRight size={15}/></Link>)}{ready.slice(0,3).map(payment=><Link key={payment._id} href={payment.missionId?`/missions/${payment.missionId}`:"/payments"}><span className="attention-icon"><Wallet size={18}/></span><div><strong>Review exact payment</strong><p>{formatNear(payment.amountYocto)} testnet NEAR · {payment.recipient}</p></div><ArrowUpRight size={15}/></Link>)}</div>:<div className="attention-empty"><CheckCircle2 size={22}/><div><h3>{data?"No approvals waiting":"Checking your workspace…"}</h3><p>Work reviews and prepared payments appear here when they need your decision.</p></div></div>}
      </section>
      <section className="panel next-action-panel"><p className="eyebrow">Your next step</p><h2>{retry?"Revise an unsuccessful mission":results.some(m=>m.state==="draft")?"Continue your draft":"Start with a dataset"}</h2><p>{retry?`${retry.title} did not complete. Open its workspace to reuse the brief and correct the input or budget.`:"Upload a CSV, check its columns, and let independent agents compete for the work."}</p><Button asChild variant="outline"><Link href={retry?`/missions/${retry.missionId}`:results.find(m=>m.state==="draft")?`/missions/${results.find(m=>m.state==="draft")!._id}`:"/missions/new"}>{retry?"Review and reuse brief":"Create or edit a mission"}<ArrowUpRight size={14}/></Link></Button></section>
    </div>
    {data&&data.jobs.length>0&&<ActivityStory compact jobs={data.jobs} events={data.events} payments={data.payments} paymentsIncomplete={data.truncated.payments}/>}
    {status!=="LoadingFirstPage"&&!results.length&&<section className="workspace-onboarding"><h2>From CSV to verified result</h2><div>{[["01","Add your dataset","Upload a file, paste CSV or use a labeled sample."],["02","Choose the work","Pick normalization or statistics and set your budget."],["03","Review the result","Inspect the output; authorize payment separately."]].map(([n,title,description])=><div key={n}><span>{n}</span><h3>{title}</h3><p>{description}</p></div>)}</div></section>}
    <div id="missions" className="section-anchor"><MissionBrowser compact jobs={data?.jobs}/></div>
    <OperatorWalletPanel/><p className="text-xs mt-3"><Link href="/payments">View payment history and receipts ↗</Link></p>
    <section className="dashboard-samples"><div><h2>Try a sample first</h2><p>Owner-private synthetic drafts. Existing jobs and payment records are preserved.</p></div><DemoControls/></section>
  </>;
}
