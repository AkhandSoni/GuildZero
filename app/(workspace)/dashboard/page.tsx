"use client";
import Link from "next/link";
import { usePaginatedQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { formatNear } from "@/lib/money";
import { INITIAL_AGENTS } from "@/lib/agents";
export default function Dashboard() {
  const { results, status, loadMore } = usePaginatedQuery(
    api.missions.list,
    {},
    { initialNumItems: 20 },
  );
  return (
    <>
      <div className="mb-8 flex flex-wrap items-end justify-between gap-5">
        <div>
          <p className="eyebrow">Your workspace</p>
          <h1>Missions</h1>
          <p className="muted mt-3">
            Prepare real data work with a clear scope and budget.
          </p>
        </div>
        <Button asChild>
          <Link href="/missions/new">+ New mission</Link>
        </Button>
      </div>
      {status === "LoadingFirstPage" ? (
        <p role="status" className="muted">
          Loading missions…
        </p>
      ) : results.length === 0 ? (
        <section className="panel py-12 text-center">
          <h2>Your first mission starts here.</h2>
          <p className="muted mt-2">
            Add a CSV dataset and choose a processing template.
          </p>
          <Button asChild className="mt-6">
            <Link href="/missions/new">Create a mission</Link>
          </Button>
        </section>
      ) : (
        <ul className="grid gap-3">
          {results.map((mission) => (
            <li key={mission._id}>
              <Link
                href={`/missions/${mission._id}`}
                className="panel flex flex-wrap items-center justify-between gap-5 hover:border-emerald-700"
              >
                <div>
                  <span className="text-xs text-emerald-300">
                    DRAFT ·{" "}
                    {mission.serviceType === "csv_normalize"
                      ? "CSV normalization"
                      : "CSV statistics"}
                  </span>
                  <h2 className="mt-2">{mission.title}</h2>
                  <p className="muted mt-1 text-xs">
                    Due {new Date(mission.deadlineAt).toLocaleString()}
                  </p>
                </div>
                <span className="text-sm">
                  {formatNear(mission.maxBudgetYocto)} testnet NEAR →
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      {status === "CanLoadMore" && (
        <Button variant="outline" className="mt-5" onClick={() => loadMore(20)}>
          Load more
        </Button>
      )}
      {status === "LoadingMore" && <p role="status">Loading…</p>}
      <section className="mt-10">
        <h2>Initial agent definitions</h2>
        <p className="muted mt-2 text-sm">
          Static profiles only. Discovery, bidding, and execution are not
          active.
        </p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {INITIAL_AGENTS.map((agent) => (
            <li key={agent.id} className="panel">
              <p className="font-medium">{agent.name}</p>
              <p className="muted mt-2 text-xs">
                {agent.role} · {agent.strategy ?? "support role"}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
