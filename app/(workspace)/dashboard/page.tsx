"use client";
import Link from "next/link";
import { useId } from "react";
import { usePaginatedQuery, useQuery } from "convex/react";
import { ArrowUpRight, Check, CircleDashed, FileSpreadsheet, Network, ShieldCheck, Sparkles } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatNear } from "@/lib/money";
import { PUBLIC_AGENTS } from "@/lib/agent-directory";
import { MissionBrowser } from "@/components/mission-browser";
import { DemoControls } from "@/components/demo-controls";

function DotNumber({ value, label }: { value: number | undefined; label: string }) {
  const id = useId().replaceAll(":", "");
  return <svg className="metric-number" viewBox="0 0 240 95" role="img" aria-label={`${label}: ${value ?? "Loading"}`}>
    <defs><pattern id={id} width="7" height="7" patternUnits="userSpaceOnUse"><rect width="4.5" height="4.5" fill="#fff" /></pattern></defs>
    <text x="0" y="80" fontSize="95" fill={`url(#${id})`}>{value ?? "—"}</text>
  </svg>;
}
export default function Dashboard() {
  const { results, status } = usePaginatedQuery(api.missions.list, {}, { initialNumItems: 20 });
  const overview = useQuery(api.marketViews.overview, {});
  const loading = status === "LoadingFirstPage";
  const drafts = results.filter((m) => m.state === "draft").length;
  const active = results.filter((m) => m.state === "active").length;
  const ready = overview?.payments.filter((p) => p.status === "READY" && !p.authorizedAt) ?? [];
  const latest = overview?.events.slice(0, 3) ?? [];
  const reviews = [...new Map((overview?.jobs.filter((job) => job.state === "disputed") ?? []).map((job) => [job.missionId, job])).values()];
  return <>
    <div className="dashboard-heading">
      <div><p className="eyebrow">Your private workspace</p><h1>A little order. More possibility.</h1><p className="muted mt-2 text-sm">Your missions, independent agents and every step in between.</p></div>
      <Button asChild><Link href="/missions/new">+ New mission</Link></Button>
    </div>
    <div className="workspace-grid">
      <section className="panel brief-card">
        <div className="card-kicker"><div className="flex items-center gap-3"><span className="round-icon"><Sparkles size={17} /></span><div><p className="font-medium">Workspace brief</p><p className="muted text-[10px]">Built from your recorded activity</p></div></div><span className="state-pill">Overview</span></div>
        <p className="brief-text">{loading ? "Getting your workspace ready…" : results.length ? <>{drafts} {drafts === 1 ? "mission is" : "missions are"} in draft. {active} {active === 1 ? "brief is" : "briefs are"} locked for work. <span className="text-[#6e7867]">Your next step is right here.</span></> : <>A clear brief is where good work begins. <span className="text-[#6e7867]">Give your data a mission.</span></>}</p>
        <div className="brief-actions"><Link className="soft-link" href="/economy"><Network size={12} /> Recorded activity</Link><Link className="soft-link" href="/security"><ShieldCheck size={12} /> Security lab</Link><Link href="/missions/new" className="ml-auto inline-flex items-center gap-1 text-xs">Create a brief <ArrowUpRight size={13} /></Link></div>
      </section>
      <section className="panel approval-card">
        <div className="card-title"><h2>Needs your approval <span className="count-pill">{overview ? ready.length + reviews.length : "—"}</span></h2><Link href="/economy">View all</Link></div>
        {ready.length + reviews.length ? <div className="mt-5 grid gap-3">{reviews.slice(0,2).map((job) => <Link key={job.missionId} href={`/missions/${job.missionId}`} className="flex items-center gap-3 rounded-2xl bg-white/60 p-3"><span className="round-icon purple"><Check size={16} /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium">Review completed work</p><p className="muted text-[10px] break-words">{job.title} · Your decision is needed</p></div><ArrowUpRight size={14} /></Link>)}{ready.slice(0,2).map((p) => <Link key={p._id} href={overview!.jobs.some((j) => j._id === p.jobId) ? `/missions/${overview!.jobs.find((j) => j._id === p.jobId)!.missionId}` : "/economy"} className="flex items-center gap-3 rounded-2xl bg-white/60 p-3"><span className="round-icon purple"><Check size={16} /></span><div className="min-w-0 flex-1"><p className="text-xs font-medium">Review exact payment</p><p className="muted text-[10px] break-all">{formatNear(p.amountYocto)} testnet NEAR · {p.recipient}</p></div><ArrowUpRight size={14} /></Link>)}</div> : <div className="quiet-empty"><span className="round-icon purple"><Check size={17} /></span><div><p>{overview ? "All clear for now." : "Checking approvals…"}</p><p className="muted text-[11px]">Work awaiting your decision and prepared payments appear here.</p></div></div>}
        <p className="muted mt-4 text-[10px]">Every payment needs approved work and your confirmation.</p>
      </section>
      <div className="metrics-grid">
        <section className="metric-card metric-green"><div className="flex justify-between items-center"><h2 className="metric-label">Locked mission briefs</h2><ArrowUpRight size={14} /></div><DotNumber value={loading ? undefined : active} label="Locked mission briefs" /><div className="metric-caption"><span className="rounded-full bg-white/60 px-2 py-1 w-fit">{loading ? "Loading" : active ? "Published briefs" : "Ready when you are"}</span><span>In 20 most recent missions</span></div><div className="metric-bars" aria-hidden="true" /></section>
        <section className="metric-card metric-orange"><div className="flex justify-between items-center"><h2 className="metric-label">Drafts to shape</h2><FileSpreadsheet size={14} /></div><DotNumber value={loading ? undefined : drafts} label="Draft missions" /><div className="metric-caption"><span className="rounded-full bg-white/60 px-2 py-1 w-fit">Planning only</span><span>No funds moved</span></div><div className="metric-bars" aria-hidden="true" /></section>
        <section className="panel activity-card"><div className="card-title"><h2>Latest activity</h2><Link href="/economy">Open economy ↗</Link></div><p className="muted mt-1 text-[11px]">Actual events, as they happen.</p>{latest.length ? latest.map((e) => <div key={e._id} className="activity-row"><span className="activity-dot" /><div className="min-w-0"><Link href={`/missions/${e.missionId}`}>{e.type.replaceAll("_", " ").toLowerCase()}</Link><p className="muted text-[11px] line-clamp-1">{e.detail}</p><time>{new Date(e.createdAt).toLocaleString()}</time></div></div>) : <div className="quiet-empty"><CircleDashed size={25} className="text-[#9eac93] shrink-0" /><div><p>{overview ? "A quiet start." : "Loading activity…"}</p><p className="muted text-[11px]">Launch a mission to start its recorded timeline.</p></div></div>}</section>
      </div>
      <MissionBrowser />
      <section className="panel team-section"><div className="card-title"><h2>Your agent directory</h2><span className="muted text-[11px]">{PUBLIC_AGENTS.length} built-in profiles</span></div><p className="muted mt-1 text-[11px]">Five service sellers. Two support roles.</p><div className="agent-grid">{PUBLIC_AGENTS.map((agent, i) => <Link className="agent-card" href={`/agents/${agent.id}`} key={agent.id}><div className="flex items-center justify-between"><span className={`round-icon ${i % 3 === 0 ? "green" : i % 3 === 1 ? "purple" : ""}`}><span className="text-xs font-medium">{agent.name[0]}</span></span><ArrowUpRight size={12} className="text-[#8a9680]" /></div><div><h3>{agent.name}</h3><p>{agent.role} · {agent.strategy ?? "support"}</p></div></Link>)}</div><p className="muted mt-4 text-[10px]">Fixed strategies. Service agents compete on price, capability, reputation and completion time.</p></section>
    </div>
    <div className="dashboard-tools"><p>Need a starting point?</p><DemoControls /></div>
    {overview && Object.values(overview.truncated).some(Boolean) && <p className="muted mt-3 text-xs">Recent overview only: up to 50 jobs, 100 events and 50 payment intents. Overview counts use the 20 most recent missions; the mission list has separate search and pagination.</p>}
  </>;
}
