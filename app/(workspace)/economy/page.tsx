"use client";
import { useQuery } from "convex/react";
import { ReactFlow, Background, Controls } from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { graphData } from "@/lib/economy-view";
export default function Economy() {
  const data = useQuery(api.marketViews.overview, {});
  if (!data) return <p role="status">Loading your economy…</p>;
  const graph = graphData(data.jobs, data.bids, data.contracts);
  const nodes = graph.nodes.map((n) => ({
    ...n,
    data: { ...n.data, label: <Link href={n.data.href}>{n.data.label}</Link> },
    style: {
      background: "#fafcf7",
      color: "#324b32",
      border: "1px solid #becdb3",
      borderRadius: 18,
      width: 250,
      whiteSpace: "pre-wrap" as const,
    },
  }));
  return (
    <>
      <p className="eyebrow">Your private marketplace</p>
      <h1>Live economy</h1>
      <p className="muted mt-3">
        Only recorded jobs, bids, awards and subcontract links appear here.
        Market offers are off-chain economic proposals; confirmed testnet
        payments are labeled separately.
      </p>
      {!nodes.length ? (
        <div className="panel mt-8">
          <h2>No jobs recorded yet.</h2>
          <p className="muted mt-2">
            Create a mission and open its auction to see its real job node.
          </p>
        </div>
      ) : (
        <div
          className="mt-8 h-[480px] overflow-hidden rounded-lg border border-[#d5dccf]"
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
      <section className="panel mt-6">
        <h2>Persisted activity</h2>
        <ol className="mt-4 grid gap-4">
          {data.events.map((e) => (
            <li className="border-l border-[#d5dccf] pl-4" key={e._id}>
              <Link
                className="text-sm text-emerald-800"
                href={`/missions/${e.missionId}`}
              >
                {e.type}
              </Link>
              <p className="muted text-sm">{e.detail}</p>
              <time className="muted text-xs">
                {new Date(e.createdAt).toLocaleString()}
              </time>
            </li>
          ))}
          {!data.events.length && <li className="muted">No events yet.</li>}
        </ol>
      </section>
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
