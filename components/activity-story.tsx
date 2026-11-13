"use client";
import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, CheckCircle2, CircleAlert, FileSpreadsheet, GitBranch } from "lucide-react";
import { eventLabel, eventTone, statusLabels, workLabel, type WorkEvent, type WorkJob } from "@/lib/workflow-view";
import { WorkflowProgress } from "@/components/workflow-progress";
import { Button } from "@/components/ui/button";
export function ActivityStory({ jobs, events, payments = [], compact = false, paymentsIncomplete = false }: { jobs: WorkJob[]; events: WorkEvent[]; payments?: { jobId: string; status: string }[]; compact?: boolean; paymentsIncomplete?: boolean }) {
  const [filter,setFilter] = useState("all");
  const [limit,setLimit] = useState(compact ? 3 : 6);
  const roots = jobs.filter((job) => !job.parentId);
  const visible = roots.filter((job) => filter === "all" || (filter === "attention" ? job.state === "disputed" || job.state === "rejected" || job.state === "unawarded" : filter === "working" ? ["bidding","working","revision","verifying"].includes(job.state) : job.state === "approved"));
  const known = new Map(jobs.map((job) => [job._id,job]));
  return <section className="workflow-stories" aria-label="Workflow activity">
    <div className="section-heading"><div><h2>{compact ? "Recent workflows" : "Workflow activity"}</h2><p className="muted text-sm">Main work, cleaning and payment each have their own outcome.</p></div>{compact && <Link href="/economy" className="text-sm">View economy <ArrowUpRight size={13} className="inline" /></Link>}</div>
    {!compact && <div className="story-filters" aria-label="Filter workflows">{[["all","All workflows"],["attention","Needs attention"],["working","In progress"],["complete","Work accepted"]].map(([value,label]) => <button type="button" key={value} aria-pressed={filter===value} onClick={() => {setFilter(value);setLimit(6);}}>{label}</button>)}</div>}
    <div className="grid gap-4">{visible.slice(0,limit).map((job) => {
      const child = jobs.find((j) => j.parentId === job._id);
      const rootEvents = events.filter((event) => event.jobId === job._id);
      const related = events.filter((event) => event.missionId === job.missionId);
      const latest = [...related].sort((a,b) => b.createdAt-a.createdAt).slice(0,compact ? 2 : 4);
      const needsReview = job.state === "disputed";
      return <article key={job._id} className="workflow-card" aria-label={`Workflow for ${job.title ?? workLabel(job)}`}>
        <div className="workflow-card-heading"><div className="flex min-w-0 gap-3"><span className="workflow-service"><FileSpreadsheet size={19} /></span><div className="min-w-0"><p className="workflow-caption">{workLabel(job)}</p><Link className="workflow-title" href={`/missions/${job.missionId}`}>{job.title ?? "Open mission"}</Link></div></div><span className={`outcome-pill ${job.state}`}>{statusLabels[job.state] ?? job.state}</span></div>
        <WorkflowProgress state={job.state} eventTypes={rootEvents.map((e) => e.type)} paymentStatus={payments.find((p) => p.jobId === job._id)?.status ?? (paymentsIncomplete ? "UNAVAILABLE" : "NONE")} />
        {child && <div className="subcontract-outcome"><GitBranch size={16} /><div><p>Cleaning subcontract</p><span>{statusLabels[child.state] ?? child.state}{child.state === "approved" && job.state !== "approved" ? " · Cleaning finished; the main analysis has a separate outcome." : ""}</span></div><span className={`outcome-pill ${child.state}`}>{child.state === "approved" ? "Complete" : statusLabels[child.state] ?? child.state}</span></div>}
        {!compact && <div className="story-milestones">{latest.map((event) => {const actor=known.get(event.jobId);const tone=eventTone(event.type);const Icon=tone==="done"?CheckCircle2:CircleAlert;return <div className={`story-milestone ${tone}`} key={event._id}><Icon size={15} /><div><p>{eventLabel(event.type)}</p><span>{actor ? workLabel(actor) : "Recorded work"} · <time dateTime={new Date(event.createdAt).toISOString()}>{new Date(event.createdAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"})}</time></span></div></div>;})}</div>}
        <div className="workflow-card-footer"><p>{needsReview ? "Open the mission to review the result or failure and record your decision." : job.state === "rejected" || job.state === "unawarded" ? "You can reuse this brief and correct the input or budget." : job.state === "approved" ? "Results are ready. Approval of work does not mean payment was sent." : "Updates appear automatically as work progresses."}</p><Link href={`/missions/${job.missionId}`}>{needsReview ? "Review mission" : "Open workspace"}<ArrowUpRight size={14}/></Link></div>
      </article>;
    })}
    {!visible.length && <div className="workflow-empty"><FileSpreadsheet size={23}/><h3>{roots.length ? "No workflows match this view." : "No jobs recorded yet."}</h3><p>Save a mission and open its auction to start a workflow.</p><Link href="/missions/new">Create a mission <ArrowUpRight size={13} className="inline" /></Link></div>}
    </div>
    {visible.length>limit && <Button variant="outline" className="mt-4" onClick={() => setLimit(limit+6)}>Show more workflows</Button>}
    {!compact && <details className="audit-details"><summary>Technical audit trail · {events.length} recorded events</summary><p className="muted text-xs my-3">Original event codes and details. Each event is labeled with its job so main work and subcontract outcomes remain separate.</p><ol className="grid gap-3">{events.map((event) => <li key={event._id} className="audit-event"><Link href={`/missions/${event.missionId}`}>{event.type}</Link><span>{known.has(event.jobId) ? workLabel(known.get(event.jobId)!) : "Older job outside this view"} · {new Date(event.createdAt).toLocaleString()}</span><p>{event.detail}</p></li>)}</ol></details>}
  </section>;
}
