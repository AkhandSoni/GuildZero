"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { ConvexError } from "convex/values";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DatasetPreview } from "@/components/dataset-preview";
import { JobWorkspace } from "@/components/job-workspace";
import { readCsvFile, inspectDataset } from "@/lib/dataset-preview";
import { SAMPLE_CSV } from "@/lib/missions";
import { formatNear, nearToYocto } from "@/lib/money";
import { SERVICE_LABELS, type ServiceType } from "@/lib/services";
import type { MasterAgentPlanV1 } from "@/lib/master-agent/plan";

const messages: Record<string, string> = {
  GROQ_CONFIGURATION_REQUIRED: "Groq is not configured yet. Add the server-side API key and model to the ignored .env.local file, then restart Next.js. Your request is saved.",
  GROQ_ACCESS_DENIED: "Groq rejected the credentials or model access. Check the server configuration.",
  GROQ_RATE_LIMIT: "Groq's free-tier quota is temporarily exhausted. Wait before trying again; no work or payment was started.",
  GROQ_MODEL_OR_SCHEMA_UNSUPPORTED: "The configured Groq model does not accept this structured-output request. Choose a currently supported model.",
  PLANNING_RATE_LIMIT: "Too many planning requests. Wait a short while before trying again.",
  PLANNING_NOT_AVAILABLE: "Planning is already running or this version reached its three-attempt limit. Wait for a running request, or add a clarification to create a new version.",
  INVALID_NUMERIC_INPUT: "A selected numeric column contains unsupported values. Currency, thousands separators and percentages are not converted automatically.",
  INVALID_SERVICE_PLAN: "The proposed columns or processing options are invalid. Clarify the request or create a corrected request.",
  MASTER_AUTOPAY_DISABLED: "Automatic settlement is disabled pending security review. Exact payments can still be approved in each mission.",
  START_AUTHORIZATION_CHANGED: "The request or payment policy changed. Refresh Start and review its current budget and payment details.",
  START_AUTHORIZATION_INACTIVE: "This Start authorization expired or was revoked. No new automatic payment is permitted.",
  START_PLANNING_STOPPED: "Planning stopped and unused Start authority was revoked. Submit a new Start request to try again.",
  SETTLEMENT_NOT_READY_ACKNOWLEDGE_PREVIEW: "Settlement is not ready. Enable metadata-only processing explicitly below to run without unlocked results.",
};
const explain = (value: string) => messages[value] ?? value.replaceAll("_", " ").toLowerCase();
const errorMessage = (e: unknown) => e instanceof ConvexError && typeof e.data === "string" ? explain(e.data) : e instanceof Error && e.message.length < 250 ? e.message : "The request could not be completed. Your existing data is preserved.";
const localDate = (value: number) => new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 16);

function CsvField({ label, csv, onChange, onReadingChange }: { label: string; csv: string; onChange: (csv: string) => void; onReadingChange: (reading: boolean) => void }) {
  const [error, setError] = useState("");
  const [reading, setReading] = useState(false);
  return <div className="grid min-w-0 gap-3">
    <label className="grid gap-2 text-sm">{label} file<Input type="file" accept=".csv,text/csv" disabled={reading} onChange={async event => {
      const file = event.target.files?.[0]; if (!file) return;
      setReading(true); onReadingChange(true); setError("");
      try { onChange(await readCsvFile(file)); } catch (e) { setError(errorMessage(e)); }
      finally { setReading(false); onReadingChange(false); event.target.value = ""; }
    }} /></label>
    <label className="grid gap-2 text-sm">{label}<textarea className="control min-h-36 font-mono text-xs" value={csv} maxLength={65536} onChange={e => onChange(e.target.value)} required /></label>
    {reading && <p role="status">Reading CSV…</p>}
    {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
    {csv && <DatasetPreview csv={csv} data={inspectDataset(csv)} />}
  </div>;
}

const serviceSuggestions: Record<ServiceType, string> = {
  csv_normalize: "Trim surrounding whitespace in this CSV. Preserve case and every row.",
  csv_summary: "Summarize the numeric columns in this CSV, including counts and missing values.",
  csv_validate: "Audit this CSV for missing values, repeated values and numeric suitability.",
  csv_reconcile: "Reconcile these two CSV datasets. Ask me which shared unique key and value columns to compare.",
  csv_report: "Create a grouped numeric report from this CSV. Ask me which grouping column and measures to use.",
};
export function MasterAgentHome({ initialService }: { initialService?: ServiceType } = {}) {
  const start = useMutation(api.masterStart.start), review = useQuery(api.masterStart.review, {}), runs = useQuery(api.masterAgent.list, {}), router = useRouter();
  const [prompt, setPrompt] = useState(initialService ? serviceSuggestions[initialService] : ""), [csv, setCsv] = useState(""), [comparison, setComparison] = useState("");
  const [twoDatasets, setTwoDatasets] = useState(initialService === "csv_reconcile"), [budget, setBudget] = useState("0.5");
  const [deadline, setDeadline] = useState(() => localDate(Date.now() + 86400000)), [humanReview, setHumanReview] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [primaryReading, setPrimaryReading] = useState(false), [comparisonReading, setComparisonReading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<"automatic" | "preview" | null>(null);
  const mode = selectedMode ?? (review?.enabled ? "automatic" : "preview");
  const request = useRef<{ input: string; id: string; consent: { mode: "automatic" | "preview"; policyHash: string; expiresAt: number; purpose: "human_start_and_pay_verified" } } | null>(null);
  return <div className="grid min-w-0 gap-6">
    <header><p className="eyebrow">New mission · Personal Master Agent</p><h1 className="mt-3 text-3xl">Give your data a job.</h1>
      <p className="muted mt-3 max-w-3xl text-sm">Enter your task, upload CSV and set a budget, then select Start. GuildZero plans, runs the auction, processes and verifies the work, and pays eligible contracts within your authorization.</p>
      <Link className="mt-4 inline-block text-sm underline" href={initialService ? `/missions/new/manual?service=${initialService}` : "/missions/new/manual"}>Advanced / Manual Mission Creation</Link>
      {initialService && <p className="muted mt-3 text-xs">Starting suggestion: {SERVICE_LABELS[initialService]}. Edit the request to choose what you need.</p>}</header>
    <form className="panel grid min-w-0 gap-6" onKeyDown={event => {
      if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !event.repeat && event.target instanceof HTMLTextAreaElement && event.target.id === "master-agent-prompt") {
        event.preventDefault(); if (!busy && !primaryReading && !comparisonReading && review) event.currentTarget.requestSubmit();
      }
    }} onSubmit={async event => {
      if (busy || primaryReading || comparisonReading || !review) { event.preventDefault(); return; }
      event.preventDefault(); setBusy(true); setError("");
      try {
        const input = { prompt, datasets: [{ ref: "primary", name: "primary.csv", csv }, ...(twoDatasets ? [{ ref: "comparison", name: "comparison.csv", csv: comparison }] : [])],
          capYocto: nearToYocto(budget), deadlineAt: new Date(deadline).getTime(), requiresHumanReview: humanReview };
        const serialized = JSON.stringify({ ...input, mode, policyHash: mode === "automatic" ? review.policyHash : review.previewPolicyHash });
        if (request.current?.input !== serialized) request.current = { input: serialized, id: crypto.randomUUID(), consent: {
          mode, policyHash: mode === "automatic" ? review.policyHash : review.previewPolicyHash,
          expiresAt: Math.min(review.expiresAt, input.deadlineAt), purpose: "human_start_and_pay_verified" } };
        const runId = await start({ ...input, requestId: request.current!.id, ...request.current!.consent });
        router.push(`/master-agent/${runId}?plan=1`);
      } catch (e) { setError(errorMessage(e)); setBusy(false); }
    }}>
      <fieldset disabled={busy} className="grid min-w-0 gap-6">
      <div className="grid gap-2 text-sm"><label htmlFor="master-agent-prompt">What should the agents do?</label><textarea id="master-agent-prompt" aria-describedby="master-start-keyboard" className="control min-h-28" value={prompt} maxLength={4000} required onChange={e => setPrompt(e.target.value)} placeholder="Group my sales by product and summarize the existing units and revenue columns." /><p id="master-start-keyboard" className="muted text-xs">Enter to Start · Shift+Enter for a new line.</p></div>
      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm">Maximum contract transfers (testnet NEAR)<Input value={budget} onChange={e => setBudget(e.target.value)} inputMode="decimal" required /><span className="muted text-xs">A planning cap, not a deposit. Network gas is separate.</span></label>
        <label className="grid gap-2 text-sm">Deadline (your local time)<Input type="datetime-local" value={deadline} onChange={e => setDeadline(e.target.value)} required /></label>
      </div>
      <CsvField label="Primary CSV" csv={csv} onChange={setCsv} onReadingChange={setPrimaryReading} />
      <Button variant="outline" className="w-fit" type="button" onClick={() => setCsv(SAMPLE_CSV)}>Use synthetic sample CSV</Button>
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={twoDatasets} onChange={e => setTwoDatasets(e.target.checked)} />Add a comparison dataset for reconciliation</label>
      {twoDatasets && <CsvField label="Comparison CSV" csv={comparison} onChange={setComparison} onReadingChange={setComparisonReading} />}
      <label className="flex items-center gap-3 text-sm"><input type="checkbox" checked={humanReview} onChange={e => setHumanReview(e.target.checked)} />Require my review of acceptance notes</label>
      <div className="grid gap-2 text-sm"><label htmlFor="master-payment-mode">Payment mode</label><select id="master-payment-mode" className="control" value={mode} onChange={e => setSelectedMode(e.target.value as "automatic" | "preview")}><option value="automatic" disabled={!review?.enabled}>Pay verified work automatically within my budget</option><option value="preview">Processing preview only — no automatic payment</option></select></div>
      <div className="grid gap-3 rounded-lg border border-[var(--border)] p-4 text-sm" aria-label="Start authorization">
        {mode === "automatic" ? <><p>By selecting Start, I authorize up to <strong>{budget} testnet NEAR in total contract transfers</strong> for at most three supported CSV services on these uploaded datasets, including any one-level cleaning subcontract. Actual network gas is separate.</p><p className="muted text-xs">Authority expires within one hour or at the deadline. Only configured agents with verified, eligible work can be paid. No second plan or payment approval is needed. Ambiguity, disputes, failed or uncertain payments pause for review. Stop delegation revokes future authority; admitted transactions cannot be recalled.</p><details><summary>Operator and permitted agent recipients</summary><p className="mt-2 break-all text-xs">Operator: {review?.operator}</p><ul className="mt-2 grid gap-1 text-xs">{review?.recipients.map(r => <li key={r.agentId} className="break-all">{r.agentId}: {r.accountId}</li>)}</ul></details></> : <><p>Start plans and executes supported work without another acceptance click. This mode authorizes no payment; full results stay locked until separately confirmed settlement.</p>{!review?.enabled && <p className="muted text-xs">Automatic payments are unavailable: {explain(review?.reason ?? "LOADING_PAYMENT_POLICY")}. Preview does not spend testnet funds.</p>}</>}
      </div>
      <p className="muted text-xs">Groq receives your request, exact column names and bounded aggregate counts. Raw CSV rows are never sent to the model. Your private CSV is stored in Convex for the existing services. Use synthetic data for this demo.</p>
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <Button disabled={busy || primaryReading || comparisonReading || !review || mode === "automatic" && !review.enabled} className="w-fit">{busy ? "Starting…" : "Start"}</Button>
      </fieldset>
    </form>
    <section className="panel"><h2>Your recent planning requests</h2><p className="muted mt-2 text-xs">Up to 20 most recent requests. These are separate from your manual missions.</p>
      {!runs ? <p role="status" className="mt-4">Loading requests…</p> : !runs.length ? <p className="muted mt-4 text-sm">No planning requests yet.</p> : <ul className="mt-4 divide-y divide-[var(--border)]">{runs.map(r => <li key={r.id} className="flex min-w-0 flex-wrap items-center justify-between gap-3 py-4"><Link className="min-w-0 break-words text-sm underline" href={`/master-agent/${r.id}`}>{r.title}</Link><span className="muted text-xs">{r.state.replaceAll("_", " ")}</span></li>)}</ul>}
    </section>
  </div>;
}

function MasterMission({ missionId }: { missionId: Id<"missions"> }) {
  const mission = useQuery(api.missions.get, { id: missionId });
  if (!mission) return <p role="status">Loading mission…</p>;
  return <section className="min-w-0 border-t border-[var(--border)] pt-6"><div className="flex flex-wrap items-center justify-between gap-3"><h2>{mission.title}</h2><Link className="text-sm underline" href={`/missions/${missionId}`}>Open mission</Link></div><JobWorkspace mission={mission} /></section>;
}

export function MasterAgentWorkspace({ runId }: { runId: Id<"masterRuns"> }) {
  const data = useQuery(api.masterAgent.get, { runId }), review = useQuery(api.masterAgent.spendingReview, { runId });
  const accept = useMutation(api.masterAgent.accept), clarify = useMutation(api.masterAgent.clarify);
  const authorize = useMutation(api.masterAgent.authorizeSpending), revoke = useMutation(api.masterAgent.revokeSpending);
  const refresh = useMutation(api.masterAgent.refresh), cancel = useMutation(api.masterAgent.cancel), removeContent = useMutation(api.masterAgent.removeContent);
  const token = useAuthToken(), autoStarted = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [reply, setReply] = useState(""), [allowPreview, setAllowPreview] = useState(false);
  const revision = data?.run.revision;
  const plan = useCallback(async () => {
    if (!token || !revision) return;
    setBusy(true); setError("");
    try {
      const result = await fetch("/api/master-agent/plan", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + token }, body: JSON.stringify({ runId, revision }), signal: AbortSignal.timeout(50000) });
      const body = await result.json(); if (!result.ok || !body.ok) setError(explain(typeof body.code === "string" ? body.code : "PLANNING_FAILED"));
    } catch { setError("Planning could not complete. Your request is saved; check your connection or retry after a minute."); }
    finally { setBusy(false); }
  }, [token, revision, runId]);
  useEffect(() => {
    if (!autoStarted.current && data?.run.state === "ready" && token && new URL(window.location.href).searchParams.get("plan") === "1") {
      autoStarted.current = true; void plan();
    }
  }, [data?.run.state, token, plan]);
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(errorMessage(e)); } finally { setBusy(false); } };
  if (!data) return <p role="status">Loading private planning workspace…</p>;
  const run = data.run;
  const proposed = run.planJson ? JSON.parse(run.planJson) as MasterAgentPlanV1 : null;
  return <div className="grid min-w-0 gap-6">
    <header><p className="eyebrow">Personal planner · {run.state.replaceAll("_", " ")}</p><h1 className="mt-3 text-3xl">Your request, in motion.</h1><p className="mt-4 max-w-3xl break-words text-sm">{run.prompt}</p>
      <p className="muted mt-3 text-xs">Transfer cap {formatNear(run.capYocto)} testnet NEAR · {run.datasets.map(d => d.name).join(" + ")} · deadline {new Date(run.deadlineAt).toLocaleString()}</p></header>
    {error && <p role="alert" className="panel text-sm text-red-800">{error}</p>}
    {run.error && <p role="status" className="panel text-sm">{explain(run.error)}</p>}
    {run.startConsent && <section className="panel grid gap-3 text-sm" aria-label="Started workflow authorization"><h2>{run.startConsent.mode === "automatic" ? "Automatic workflow" : "Processing-only preview"}</h2><p>{run.startConsent.revokedAt ? "Unused or future Start authority has been revoked. Existing work and receipts remain." : `Your Start covers this exact request until ${new Date(run.startConsent.expiresAt).toLocaleString()}.`}</p><p className="muted text-xs">No second plan acceptance is required. Only automatic mode can pay verified, eligible work within the original cap. Disputes need your decision; an incomplete planning request can be stopped below.</p>{!run.acceptedAt && <><p>{proposed?.summary}</p>{proposed?.questions.map(q => <p key={q}>{q}</p>)}{run.startConsent.revokedAt && <Link href="/missions/new" className="underline">Start a clarified or corrected request</Link>}<Button className="w-fit" variant="outline" disabled={busy} onClick={() => void act(() => cancel({ runId }))}>Stop this request</Button></>}</section>}
    {!run.startConsent && !run.acceptedAt && run.state !== "cancelled" && run.state !== "content_removed" && <section className="panel grid gap-4"><h2>Planning</h2>
      <p className="muted text-sm">Inference proposes work only. Accepting a plan starts real private auctions; spending authorization is a separate action.</p>
      <Button className="w-fit" disabled={busy} onClick={() => void plan()}>{busy ? "Planning…" : "Generate or retry plan"}</Button>
      {proposed && <><p>{proposed.summary}</p>{proposed.questions.length > 0 && <ul className="list-disc pl-5 text-sm">{proposed.questions.map(q => <li key={q}>{q}</li>)}</ul>}</>}
      {run.clarifications.length > 0 && <details><summary className="text-sm">Your clarification replies</summary><ul className="mt-3 list-disc pl-5 text-sm">{run.clarifications.map((r, i) => <li key={i}>{r}</li>)}</ul></details>}
      {run.clarifications.length < 3 && <form className="grid gap-3" onSubmit={e => { e.preventDefault(); void act(async () => { await clarify({ runId, reply }); setReply(""); }); }}><label className="grid gap-2 text-sm">Clarify or revise your request<textarea className="control" value={reply} onChange={e => setReply(e.target.value)} maxLength={1000} required /></label><Button className="w-fit" variant="outline" disabled={busy}>Save clarification</Button><p className="muted text-xs">Then generate the next plan. Up to three clarification replies and three planning attempts per version.</p></form>}
    </section>}
    {proposed?.decision === "execute" && <section className="panel grid gap-5" aria-label="Proposed execution plan"><h2>{run.acceptedAt ? "Accepted execution plan" : "Review the proposed plan"}</h2>
      <p className="muted text-sm">{proposed.summary}</p><p className="muted text-xs">Steps analyze uploaded datasets independently. A summary uses cleaned input only when its cleaning subcontract is explicitly included.</p><ol className="grid gap-4">{proposed.steps.map(step => <li className="rounded-md border border-[var(--border)] p-4" key={step.stepId}><h3>{step.title}</h3><p className="muted mt-2 text-sm">{SERVICE_LABELS[step.serviceType]} · {formatNear(step.maxBudgetYocto)} testnet NEAR maximum</p><p className="mt-2 break-words text-sm">Dataset: {step.datasetRef}{step.comparisonDatasetRef ? ` + ${step.comparisonDatasetRef}` : ""}. Columns: {step.options.columns.join(", ")}.</p>{step.options.groupBy && <p className="text-sm">Group by: {step.options.groupBy}</p>}{step.options.keyColumn && <p className="text-sm">Reconcile by: {step.options.keyColumn}</p>}{step.options.caseMode && <p className="text-sm">Case: {step.options.caseMode}</p>}{step.options.numericColumns && <p className="text-sm">Numeric checks: {step.options.numericColumns.join(", ") || "none"}</p>}<p className="muted mt-2 text-xs">{step.cleanBeforeProcessing ? "One-level cleaning subcontract included in this cap. " : ""}{run.requiresHumanReview || step.requiresHumanReview ? "Human review required." : "Existing template verification applies."}</p><p className="mt-2 text-xs">{step.acceptanceCriteria}</p></li>)}</ol>
      {!run.startConsent && !run.acceptedAt && run.state !== "cancelled" && run.state !== "content_removed" && <form className="grid gap-4" onSubmit={e => { e.preventDefault(); void act(() => accept({ runId, planHash: run.planHash!, allowUnfundedPreview: allowPreview })); }}>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" checked={allowPreview} onChange={e => setAllowPreview(e.target.checked)} /><span>If settlement is unavailable, I explicitly allow metadata-only processing. Full results stay locked until actual payments confirm.</span></label>
        <p className="muted text-xs">Accepting starts only the displayed work. It does not authorize spending; payment approval and unresolved disputes remain separate.</p><Button className="w-fit" disabled={busy}>Accept plan and start marketplace</Button>
      </form>}
    </section>}
    {run.acceptedAt && run.state !== "cancelled" && run.state !== "content_removed" && <section className="panel grid gap-4" aria-label="Mission spending authorization"><h2>Spending authorization</h2>
      <dl className="grid gap-4 sm:grid-cols-3 text-sm"><div><dt className="muted text-xs">Committed awards (cleaning included)</dt><dd className="mt-1">{formatNear(data.financials.committedYocto)} testnet NEAR</dd></div><div><dt className="muted text-xs">Confirmed contract transfers</dt><dd className="mt-1">{formatNear(data.financials.confirmedTransfersYocto)} testnet NEAR</dd></div><div><dt className="muted text-xs">Pending or uncertain transfers</dt><dd className="mt-1">{formatNear(data.financials.pendingTransfersYocto)} testnet NEAR</dd></div></dl>
      <p className="muted text-sm">{run.startConsent ? "Your Start authorized this request. Automatic mode pays only eligible verified contracts within that original cap and expiry. Disputes still need your decision." : "This is a separate human decision, not model consent. It covers only this accepted plan and its private missions; disputes still need your decision."}</p>
      {!data.autopayEnabled && <p className="text-sm">Automatic settlement is disabled pending security review. You can inspect and approve each exact payment in the mission panels below.</p>}
      {review && <><p>Maximum transfers: {formatNear(review.capYocto)} testnet NEAR across {review.missions.length} mission(s), including cleaning allocations.</p><p className="muted text-xs">{review.gasPolicy} This is shared custodial testnet funding, not your personal wallet. Per-transaction gas cost is not included in the transfer totals above.</p><details><summary className="text-sm">Authorized operator and configured recipients</summary><p className="mt-3 break-all text-xs">Operator: {review.operator}</p><ul className="mt-2 grid gap-2 text-xs">{review.recipients.map(r => <li key={r.agentId} className="break-all">{r.agentId}: {r.accountId}</li>)}</ul></details></>}
      {data.grant && <div className="grid gap-3"><p className="text-sm">{data.grant.revokedAt ? "Authorization revoked." : `Authorization expires ${new Date(data.grant.expiresAt).toLocaleString()}.`}</p>{!data.grant.revokedAt && <Button className="w-fit" variant="outline" disabled={busy} onClick={() => void act(() => revoke({ runId }))}>Revoke automatic spending</Button>}</div>}
      {!run.startConsent && review?.enabled && (!data.grant || data.grant.revokedAt || data.grant.expired) && <form key={review.policyHash + review.planHash} className="grid gap-4" onSubmit={e => { e.preventDefault(); void act(() => authorize({ runId, planHash: review.planHash, policyHash: review.policyHash, capYocto: review.capYocto, expiresAt: review.expiresAt, purpose: "human_mission_spending" })); }}>
        <label className="flex items-start gap-3 text-sm"><input type="checkbox" required /><span>I authorize only eligible verified contracts in this plan, up to the displayed transfer cap. Network gas is separate. This expires within one hour; revocation cannot undo a transaction already admitted for signing.</span></label>
        <Button className="w-fit" disabled={busy}>Authorize this mission bundle</Button>
      </form>}
      <Button className="w-fit" variant="outline" disabled={busy} onClick={() => void act(() => refresh({ runId }))}>Refresh workflow status</Button>
    </section>}
    {data.steps.map(step => <MasterMission key={step.missionId} missionId={step.missionId} />)}
    <section className="panel"><h2>Planner activity</h2><p className="muted mt-2 text-xs">Persistent planner transitions; each mission shows its actual economic events and receipt. Up to 50 latest entries.</p><ul className="mt-4 grid gap-4">{data.events.map(e => <li key={e._id} className="border-l-2 border-[var(--border)] pl-4"><p className="text-sm">{e.detail}</p><p className="muted mt-1 text-xs">{new Date(e.createdAt).toLocaleString()}</p></li>)}</ul>
      {run.inference && <p className="muted mt-5 text-xs">{run.inference.provider} / {run.inference.model} · inference {run.inference.inferenceMs} ms · planning {run.inference.planningMs} ms · tokens {run.inference.inputTokens ?? "unavailable"} in / {run.inference.outputTokens ?? "unavailable"} out. Workflow latency is separate.</p>}
    </section>
    {run.state !== "content_removed" && <details className="panel"><summary>Remove private planner content</summary><form className="mt-4 grid gap-4" onSubmit={e => { e.preventDefault(); void act(() => removeContent({ runId, confirm: "REMOVE_PLANNER_AND_MISSION_CONTENT" })); }}><p className="muted text-sm">Removes this request, both uploaded inputs, proposed plan, clarification text, and all bound mission inputs/outputs together. All work must be terminal and required settlement resolved first. Financial history and public blockchain receipts remain. Existing downloads and backups are separate.</p><label className="flex items-start gap-3 text-sm"><input type="checkbox" required /><span>I understand this permanently removes the private content for this entire planning workflow and its missions.</span></label><Button className="w-fit" variant="destructive" disabled={busy}>Remove planner and mission content</Button></form></details>}
    {run.state !== "cancelled" && run.state !== "content_removed" && run.state !== "completed" && <details className="panel"><summary>Stop delegation</summary><p className="muted my-4 text-sm">Cancels unawarded auctions and revokes future automatic spending. Committed services, uncertain payments and transaction history are preserved.</p><Button variant="destructive" disabled={busy} onClick={() => void act(() => cancel({ runId }))}>Stop this planning workflow</Button></details>}
  </div>;
}
