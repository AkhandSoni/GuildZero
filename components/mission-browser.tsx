"use client";
import { useState } from "react";
import { SERVICE_LABELS, SERVICE_TYPES } from "@/lib/services";
import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import { ArrowUpRight, FileSpreadsheet } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { statusLabels, type WorkJob } from "@/lib/workflow-view";
import { formatNear } from "@/lib/money";
export function MissionBrowser({ jobs = [], compact = false }: { jobs?: WorkJob[]; compact?: boolean }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [state, setState] = useState<"" | "draft" | "active">("");
  const [service, setService] = useState<"" | "csv_summary" | "csv_normalize">("");
  const [error, setError] = useState("");
  const filtered = !!(search || state || service);
  const { results, status, loadMore } = usePaginatedQuery(api.missions.list, {
    ...(search ? { search } : {}), ...(state ? { state } : {}), ...(service ? { serviceType: service } : {}),
  }, { initialNumItems: 20 });
  function clear() { setSearchInput(""); setSearch(""); setState(""); setService(""); setError(""); }
  return <section className="panel mission-section min-w-0">
    <div className="card-title"><h2>{compact ? "Recent missions" : "Missions"}</h2>{compact ? <Link href="/missions">View all missions ↗</Link> : <span className="muted text-[11px]">{results.length} loaded{filtered ? " matches" : ""}</span>}</div>
    {!compact && <form className="mission-search mt-4 grid gap-3" onSubmit={(event) => {
      event.preventDefault(); const text = searchInput.trim();
      if (text && (text.length > 100 || (text.match(/[\p{L}\p{N}]+/gu)?.length ?? 0) > 16 || !/[\p{L}\p{N}]/u.test(text))) { setError("Search titles using up to 16 words and 100 characters."); return; }
      setError(""); setSearch(text);
    }}>
      <label className="field">Search saved missions<Input type="search" value={searchInput} maxLength={100} onChange={(event) => setSearchInput(event.target.value)} placeholder="For example, weekly sales" /></label>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="field">Mission status<select aria-label="Mission status" className="control" value={state} onChange={(e) => setState(e.target.value as typeof state)}><option value="">All briefs</option><option value="draft">Draft</option><option value="active">Started / locked</option></select></label>
        <label className="field">Filter by service<select aria-label="Filter by service" className="control" value={service} onChange={(e) => setService(e.target.value as typeof service)}><option value="">All services</option>{SERVICE_TYPES.map(s => <option key={s} value={s}>{SERVICE_LABELS[s]}</option>)}</select></label>
      </div>
      <div className="flex flex-wrap gap-3"><Button type="submit" variant="outline">Search missions</Button>{(filtered || searchInput) && <Button type="button" variant="outline" onClick={clear}>Clear filters</Button>}</div>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <p className="muted text-xs">Search your saved titles by keyword. Searches cover your missions beyond the current page; newest first without a search, best title matches first with one.</p>
    </form>}
    {status === "LoadingFirstPage" ? <p role="status" className="muted mt-6">Loading missions…</p> : !results.length ? filtered ? <div className="py-8"><h3>No missions match these filters.</h3><Button className="mt-3" variant="outline" onClick={clear}>Show all missions</Button></div> : <div className="py-8"><h2 className="!text-base">Your first mission starts here.</h2><p className="muted mt-2 text-sm">Upload or paste a CSV dataset and choose a processing template.</p><Button asChild variant="outline" className="mt-4"><Link href="/missions/new">Create a mission</Link></Button></div> : <ul className="mission-list">{results.slice(0, compact ? 5 : results.length).map((mission) => <li className="mission-item" key={mission._id}><Link href={`/missions/${mission._id}`}><FileSpreadsheet size={16} /><div className="mission-copy"><h2>{mission.title}</h2><p>{SERVICE_LABELS[mission.serviceType]} · {formatNear(mission.maxBudgetYocto)} testnet NEAR</p><p>Due {new Date(mission.deadlineAt).toLocaleString()}</p></div><span className={`outcome-pill ${jobs.find((j) => j.missionId === mission._id && !j.parentId)?.state ?? mission.state}`}>{mission.state === "draft" ? "Draft" : statusLabels[jobs.find((j) => j.missionId === mission._id && !j.parentId)?.state ?? ""] ?? "Started brief"}</span><ArrowUpRight size={13} /></Link></li>)}</ul>}
    {!compact && status === "CanLoadMore" && <Button variant="outline" className="mt-5" onClick={() => loadMore(20)}>Load more</Button>}
    {status === "LoadingMore" && <p role="status">Loading…</p>}
  </section>;
}
