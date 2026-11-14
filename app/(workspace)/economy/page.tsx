"use client";
import { useQuery } from "convex/react";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { ActivityStory } from "@/components/activity-story";
import { graphData } from "@/lib/economy-view";
export default function Economy() {
  const data = useQuery(api.marketViews.overview, {});
  if (!data) return <p role="status">Loading your economy…</p>;
  const graph = graphData(data.jobs, data.bids, data.contracts);
  const nodes = graph.nodes.map((n) => ({
    ...n,
    data: { ...n.data, label: <Link href={n.data.href}>{n.data.label}</Link> },
    style: {
      background: "var(--surface)",
      color: "var(--foreground)",
      border: "1px solid var(--sage)",
      borderRadius: 6,
      width: 250,
      whiteSpace: "pre-wrap" as const,
    },
  }));
  return (
    <>
      <div className="detail-heading"><p className="eyebrow">Workspace / Economy</p>
      <h1>Live economy</h1>
      <p className="muted mt-3">
        Only recorded jobs, bids, awards and subcontract links appear here.
        Market offers are off-chain economic proposals; confirmed testnet
        payments are labeled separately.
      </p></div>
      {nodes.length > 0 && (
        <div
          className="mt-8 h-[420px] overflow-hidden rounded-lg border border-[var(--border)]"
          aria-label="Recorded economy network"
        >
          <ReactFlow
            colorMode="light"
            nodes={nodes}
            edges={graph.edges}
            nodesDraggable={false}
            nodesConnectable={false}
            edgesReconnectable={false}
            fitView
            minZoom={0.1}
            maxZoom={2}
          >
            <Background />
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
      {(graph.truncated || Object.values(data.truncated).some(Boolean)) && (
        <p className="mt-3 text-amber-800">
          Bounded view: latest 50 jobs, 100 events, 50 payment intents and 150
          edges. Older records are omitted.
        </p>
      )}
      <div className="mt-7"><ActivityStory jobs={data.jobs} events={data.events} payments={data.payments} paymentsIncomplete={data.truncated.payments}/></div>
      <section className="panel mt-6">
        <h2>Testnet payment intents</h2>
        {!data.payments.length && (
          <p className="muted mt-3">No payments prepared or confirmed.</p>
        )}
        {data.payments.map((p) => (
          <div key={p._id} className="mt-4 text-sm">
            <p>
              {p.status} · {p.recipient}
            </p>
            {p.txHash && (
              <a
                className="break-all text-emerald-800 underline"
                target="_blank"
                rel="noreferrer"
                href={`https://testnet.nearblocks.io/txns/${encodeURIComponent(p.txHash)}`}
              >
                {p.txHash}
              </a>
            )}
            <p className="muted">
              {p.status === "CONFIRMED"
                ? "Final matching receipt verified"
                : "Not a confirmed transfer"}
            </p>
          </div>
        ))}
      </section>
    </>
  );
}
