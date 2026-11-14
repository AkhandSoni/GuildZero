"use client";
import { useAction, useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { MCP_SCOPES } from "@/lib/mcp/contracts";
import type { Id } from "@/convex/_generated/dataModel";

const scopeLabels: Record<string, string> = {
  "catalog:read": "Discover services and agents",
  "missions:read": "Read mission briefs and auctions",
  "missions:create": "Create private mission drafts",
  "auctions:start": "Start funded auctions",
  "activity:read": "Read recorded activity",
  "verification:read": "Read verification status",
  "results:read": "Read payment-released results",
  "payments:read": "Read exact payment status",
  "payments:prepare": "Prepare an eligible payment",
  "payments:request-approval": "Request your separate payment approval",
};
export default function Integrations() {
  const listing = useQuery(api.mcpCredentials.list, {});
  const credentials = listing?.integrations;
  const create = useAction(api.mcpCredentials.create);
  const revoke = useMutation(api.mcpCredentials.revoke);
  const revokeAll = useMutation(api.mcpCredentials.revokeAll);
  const [label, setLabel] = useState("");
  const [ttlSeconds, setTtlSeconds] = useState(3600);
  const [scopes, setScopes] = useState<string[]>(["catalog:read"]);
  const [missionIds, setMissionIds] = useState("");
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const act = async (operation: () => Promise<unknown>) => {
    setBusy(true); setError(""); setNotice("");
    try { await operation(); }
    catch { setError("Request unavailable. Check your session and try again. If creation was interrupted, revoke the unused credential before issuing another."); }
    finally { setBusy(false); }
  };
  return <>
    <div className="detail-heading">
      <h1>Assistant connections</h1>
      <p className="muted mt-3 max-w-2xl">Give a local MCP client limited access to your private marketplace. Each connection has its own credential and expires automatically.</p>
    </div>
    <div className="integration-layout">
      <section className="panel">
        <h2>Create a connection</h2>
        <p className="muted mt-3 text-sm">The selected permissions can expose your data to the assistant and its model provider. They never permit payment authorization, signing, dispute decisions or account administration.</p>
        <form className="mt-6 grid gap-5" onSubmit={event => {
          event.preventDefault();
          void act(async () => {
            setToken("");
            const restricted = missionIds.trim() ? missionIds.split(/[\s,]+/).filter(Boolean) as Id<"missions">[] : undefined;
            const result = await create({ label: label.trim(), scopes: scopes as (typeof MCP_SCOPES)[number][], ttlSeconds, ...(restricted ? { missionIds: restricted } : {}) });
            setToken(result.token); setLabel("");
            setNotice("Connection created. Save its credential now; it cannot be retrieved later.");
          });
        }}>
          <label className="field">Connection name<input className="control" required minLength={1} maxLength={80} value={label} disabled={busy} placeholder="My local assistant" onChange={event => setLabel(event.target.value)} /></label>
          <label className="field">Expires after<select className="control" value={ttlSeconds} disabled={busy} onChange={event => setTtlSeconds(Number(event.target.value))}><option value={3600}>1 hour</option><option value={14400}>4 hours</option><option value={86400}>24 hours</option></select></label>
          <fieldset className="grid gap-3" disabled={busy}><legend className="mb-3 font-semibold text-sm">Allowed operations</legend>
            {MCP_SCOPES.map(scope => <label key={scope} className="flex gap-3 items-start text-sm"><input type="checkbox" checked={scopes.includes(scope)} onChange={event => setScopes(current => event.target.checked ? [...current, scope] : current.filter(item => item !== scope))}/><span>{scopeLabels[scope]}</span></label>)}
          </fieldset>
          <label className="field">Restrict to mission IDs (optional)<textarea className="control" rows={2} maxLength={2000} disabled={busy} value={missionIds} onChange={event => setMissionIds(event.target.value)} aria-describedby="mission-restriction-help"/><span id="mission-restriction-help" className="muted text-xs">Separate your own mission IDs with commas. Leave empty for all of your missions. Restricted connections cannot create new missions.</span></label>
          {missionIds.trim() && scopes.includes("missions:create") && <p className="muted text-sm">Clear “Create private mission drafts” to restrict this connection to existing missions.</p>}
          <Button className="w-fit" disabled={busy || !scopes.length || !label.trim() || Boolean(missionIds.trim() && scopes.includes("missions:create"))}>Create scoped credential</Button>
        </form>
        {error && <p role="alert" className="mt-4 text-red-800">{error}</p>}
        {notice && <p role="status" className="mt-4">{notice}</p>}
        {token && <section className="mt-5 grid gap-3" aria-label="New credential">
          <label className="field">One-time credential<input type="password" className="control font-mono text-xs" readOnly autoComplete="off" value={token}/></label>
          <p className="muted text-sm">Save this in a private file outside Git, readable only by you (mode 0600). Set the MCP child’s GUILDZERO_MCP_TOKEN_FILE to its absolute path. Keep the value out of prompts, arguments and client configuration.</p>
          <Button variant="outline" className="w-fit" onClick={() => void navigator.clipboard.writeText(token).then(() => setNotice("Credential copied. Save it to your private file, then hide it."), () => setError("Clipboard unavailable. Select the credential field and copy it manually."))}>Copy credential</Button>
          <Button variant="outline" className="w-fit" onClick={() => { setToken(""); setNotice("Credential hidden. Revoke the connection if you did not save it."); }}>I saved it — hide credential</Button>
        </section>}
      </section>
      <section className="panel self-start">
        <div className="flex items-start justify-between flex-wrap gap-4"><h2>Your connections</h2><Button variant="outline" disabled={busy || !credentials?.length} onClick={() => void act(async () => { await revokeAll({}); setToken(""); setNotice("All connection credentials revoked."); })}>Revoke all</Button></div>
        <p className="muted mt-3 text-sm">Signing out does not revoke these separately issued credentials. Revoke them before leaving a shared computer. Revocation stops subsequent operations; committed work continues.</p>
        {listing?.truncated && <p className="muted mt-3 text-xs">Showing the latest 100 connections. Revoke all also covers active connections outside this list.</p>}
        {credentials === undefined ? <p role="status" className="mt-5">Loading connections…</p> : !credentials.length ? <p className="muted mt-5">No connections yet. Create one with only the operations your assistant needs.</p> : <ul className="mt-5 grid gap-5">
          {credentials.map(credential => <li key={credential.integrationId} className="border-t border-[var(--border)] pt-4 min-w-0">
            <div className="flex items-start justify-between flex-wrap gap-3"><h3 className="font-semibold break-words">{credential.label}</h3><Button variant="outline" disabled={busy || !!credential.revokedAt} onClick={() => void act(async () => { await revoke({ integrationId: credential.integrationId }); setToken(""); setNotice("Connection revoked."); })}>Revoke</Button></div>
            <p className="muted text-xs mt-2">{credential.revokedAt ? "Revoked" : !credential.active ? "Expired" : "Active"} · Expires {new Date(credential.expiresAt).toLocaleString()}</p>
            <p className="text-sm mt-2 break-words">{credential.scopes.map(scope => scopeLabels[scope]).join(", ")}</p>
            <p className="muted text-xs mt-2">{credential.missionIds?.length ? `${credential.missionIds.length} specific missions` : "All of your missions"}</p>
          </li>)}
        </ul>}
      </section>
    </div>
  </>;
}
