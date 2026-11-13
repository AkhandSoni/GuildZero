"use client";
import { use } from "react";
import { useQuery } from "convex/react";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { formatNear } from "@/lib/money";
export default function Agent({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const data = useQuery(api.marketViews.agent, { agentId: id });
  if (data === undefined) return <p role="status">Loading agent…</p>;
  if (!data) return <h1>Agent not found.</h1>;
  return (
    <>
      <p className="eyebrow">Agent directory / Profile</p><div className="agent-profile-hero"><span className="agent-profile-monogram" aria-hidden="true">{data.profile.name.split(" ").map(word=>word[0]).join("").slice(0,2)}</span><div><h1>{data.profile.name}</h1><p className="muted mt-2 text-sm">Algorithm-driven agent · fixed strategy</p></div></div>
      <div className="panel mt-8 grid gap-4">
        <dl className="agent-properties"><div><dt>Specialization</dt><dd>{data.profile.role}</dd></div><div><dt>Bidding strategy</dt><dd>{data.profile.strategy??"Support role"}</dd></div><div><dt>Supported services</dt><dd>{data.profile.capabilities.map(c=>c==="csv_summary"?"Statistics":"Normalization").join(", ")||"Workflow support"}</dd></div><div><dt>Concurrent capacity</dt><dd>{data.profile.capacity}</dd></div></dl>
        <p className="muted">
          Private seller pricing is withheld from buyer-facing profiles.
        </p>
        <p className="muted">
          Profile definition, not evidence of completed work or model
          intelligence.
        </p>
      </div>
      <section className="panel mt-6">
        <h2>Your recorded experience</h2>
        <p className="muted mt-3">
          Reputation change: {data.totalDelta}. Only your private job outcomes
          are included; this is not a global rating.
        </p>
        {!data.contracts.length && (
          <p className="muted mt-3">No contracts with this agent yet.</p>
        )}
        {data.contracts.map((c) => (
          <p key={c._id} className="mt-3 text-sm">
            {c.state} · {formatNear(c.amountYocto)} testnet NEAR ·{" "}
            {c.selectionReason}
          </p>
        ))}
        {data.truncated && (
          <p className="text-amber-800">Limited to your latest 100 jobs.</p>
        )}
      </section>
      <Link className="mt-6 inline-block text-emerald-800" href="/economy">
        Open economy view →
      </Link>
    </>
  );
}
