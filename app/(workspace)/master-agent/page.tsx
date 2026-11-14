"use client";
import { useState, useEffect, useCallback } from "react";
import { useMutation, useQuery } from "convex/react";
import { useAuthToken } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatNear, nearToYocto } from "@/lib/money";
import { BENCHMARK_FIXTURES } from "@/lib/master-agent/benchmark-manifest";

type HealthResponse = {
  ok: boolean;
  health?: {
    reachable: boolean;
    baseUrl: string;
    configuredModel: string;
    version: string | null;
    modelAvailable: boolean;
    modelDigest: string | null;
    quantizationLevel: string | null;
    parameterSize: string | null;
    errorCode?: string;
    message: string;
  };
  message?: string;
};

export default function MasterAgentPage() {
  const router = useRouter();
  const token = useAuthToken();
  const runs = useQuery(api.masterAgent.listRuns, {});
  const settlementStatus = useQuery(api.payments.status, {});
  const createRun = useMutation(api.masterAgent.createRun);

  const [title, setTitle] = useState("Sales & product performance plan");
  const [prompt, setPrompt] = useState(
    "Analyze my sales data, identify the most successful products, and generate a summary. Spend no more than 0.5 testnet NEAR.",
  );
  const [primaryCsv, setPrimaryCsv] = useState<string>(BENCHMARK_FIXTURES.F1.csv);
  const [primaryName, setPrimaryName] = useState<string>(BENCHMARK_FIXTURES.F1.name);
  const [comparisonCsv, setComparisonCsv] = useState<string>("");
  const [comparisonName, setComparisonName] = useState<string>("");
  const [maxBudgetNear, setMaxBudgetNear] = useState("0.5");
  const [deadlineDays, setDeadlineDays] = useState("3");
  const [requiresHumanReview, setRequiresHumanReview] = useState(false);
  const [allowUnfundedPreview, setAllowUnfundedPreview] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [healthState, setHealthState] = useState<HealthResponse | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);

  const checkHealth = useCallback(async () => {
    if (!token) return;
    setCheckingHealth(true);
    try {
      const res = await fetch("/api/master-agent/plan", {
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json()) as HealthResponse;
      setHealthState(data);
    } catch {
      setHealthState({
        ok: false,
        message: "Could not query Next.js local Ollama health endpoint.",
      });
    } finally {
      setCheckingHealth(false);
    }
  }, [token]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    fetch("/api/master-agent/plan", {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => res.json() as Promise<HealthResponse>)
      .then((data) => {
        if (!cancelled) setHealthState(data);
      })
      .catch(() => {
        if (!cancelled) {
          setHealthState({
            ok: false,
            message: "Could not query Next.js local Ollama health endpoint.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function handleFileUpload(
    file: File | undefined,
    target: "primary" | "comparison",
  ) {
    if (!file) return;
    if (file.size > 64 * 1024) {
      setError("CSV file must be at most 64 KiB.");
      return;
    }
    const text = await file.text();
    if (target === "primary") {
      setPrimaryCsv(text);
      setPrimaryName(file.name);
    } else {
      setComparisonCsv(text);
      setComparisonName(file.name);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!token) {
      setError("Sign in again before starting a Master Agent run.");
      return;
    }
    let maxBudgetYocto: string;
    try {
      maxBudgetYocto = nearToYocto(maxBudgetNear.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enter a valid NEAR budget.");
      return;
    }
    const days = Number(deadlineDays);
    if (!Number.isFinite(days) || days < 1 || days > 30) {
      setError("Deadline must be between 1 and 30 days.");
      return;
    }

    setSubmitting(true);
    try {
      const created = await createRun({
        title: title.trim() || prompt.trim().slice(0, 80),
        prompt: prompt.trim(),
        primaryCsv,
        primaryName,
        ...(comparisonCsv.trim() ? { comparisonCsv, comparisonName: comparisonName || "comparison.csv" } : {}),
        maxBudgetYocto,
        deadlineAt: Date.now() + Math.round(days * 86400000),
        requiresHumanReview,
        allowUnfundedPreview,
      });

      // Trigger local Ollama inference asynchronously or await before navigating
      await fetch("/api/master-agent/plan", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          runId: created.runId,
          requestId: created.requestId,
        }),
      });

      router.push(`/master-agent/${created.runId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Master Agent run.");
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">Personal Master Agent · Local Ollama Qwen3.5 4B</p>
          <h1>Master Agent Orchestrator</h1>
          <p className="muted text-sm mt-2">
            Plan multi-step CSV analyses locally with <code>qwen3.5:4b</code> on Ollama. The model proposes a strict{" "}
            <code>MasterAgentPlanV1</code> plan; deterministic GuildZero agents bid, negotiate, execute, and verify.
            Spending requires a separate, scoped human grant.
          </p>
        </div>
        <Button type="button" variant="outline" onClick={() => void checkHealth()} disabled={checkingHealth}>
          {checkingHealth ? "Checking Ollama…" : "Check local Ollama"}
        </Button>
      </div>

      {healthState && (
        <section className="panel" aria-label="Local Ollama runtime status">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="eyebrow">Local inference boundary</p>
              <h2 className="mt-1">
                {healthState.ok
                  ? `Ready · ${healthState.health?.configuredModel} on ${healthState.health?.baseUrl}`
                  : "Local Ollama setup required"}
              </h2>
              <p className="muted text-sm mt-1">
                {healthState.health?.message ?? healthState.message}
              </p>
            </div>
            <span className={`outcome-pill ${healthState.ok ? "approved" : ""}`}>
              {healthState.ok ? `Ollama v${healthState.health?.version ?? "local"}` : healthState.health?.errorCode ?? "OFFLINE"}
            </span>
          </div>
          {healthState.health?.modelDigest && (
            <p className="muted text-xs mt-2">
              Digest: <code>{healthState.health.modelDigest.slice(0, 16)}…</code> · Quantization:{" "}
              <code>{healthState.health.quantizationLevel ?? "GGUF"}</code> · Parameters:{" "}
              <code>{healthState.health.parameterSize ?? "4B"}</code> · Co-located with local Next.js server; no cloud API key.
            </p>
          )}
          {!healthState.ok && (
            <p className="muted text-xs mt-2">
              Setup on Linux: run <code>ollama serve</code> and <code>ollama pull qwen3.5:4b</code> on the same machine running Next.js.
            </p>
          )}
        </section>
      )}

      <section className="panel">
        <p className="eyebrow">1 · Request & bounded datasets</p>
        <h2 className="mt-1">Create a Master Agent run</h2>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTitle("Sales & product performance plan");
              setPrompt(
                "Analyze my sales data, identify the most successful products, and generate a summary. Spend no more than 0.5 testnet NEAR.",
              );
              setPrimaryCsv(BENCHMARK_FIXTURES.F1.csv);
              setPrimaryName(BENCHMARK_FIXTURES.F1.name);
              setComparisonCsv("");
              setMaxBudgetNear("0.5");
            }}
          >
            Load product report + summary (F1)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTitle("Sales ambiguity check");
              setPrompt(
                "Make this data better and tell me which products are winning.",
              );
              setPrimaryCsv(BENCHMARK_FIXTURES.F1.csv);
              setPrimaryName(BENCHMARK_FIXTURES.F1.name);
              setComparisonCsv("");
              setMaxBudgetNear("0.5");
            }}
          >
            Load clarification example (F1)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTitle("Grouped product summary");
              setPrompt(
                "Group by product and summarize units and revenue. Use the existing revenue column.",
              );
              setPrimaryCsv(BENCHMARK_FIXTURES.F1.csv);
              setPrimaryName(BENCHMARK_FIXTURES.F1.name);
              setComparisonCsv("");
              setMaxBudgetNear("0.5");
            }}
          >
            Load grouped product report (F1)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTitle("Audit + grouped multi-step");
              setPrompt(
                "Audit product and units with numeric checks on units, and separately group by product to summarize units and revenue.",
              );
              setPrimaryCsv(BENCHMARK_FIXTURES.F1.csv);
              setPrimaryName(BENCHMARK_FIXTURES.F1.name);
              setComparisonCsv("");
              setMaxBudgetNear("1");
            }}
          >
            Load 2-step audit + report (F1)
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTitle("Keyed order reconciliation");
              setPrompt("Reconcile primary with comparison by id; compare status and amount exactly.");
              setPrimaryCsv(BENCHMARK_FIXTURES.F3.csv);
              setPrimaryName(BENCHMARK_FIXTURES.F3.name);
              setComparisonCsv(BENCHMARK_FIXTURES.F4.csv);
              setComparisonName(BENCHMARK_FIXTURES.F4.name);
              setMaxBudgetNear("0.5");
            }}
          >
            Load reconciliation pair (F3+F4)
          </Button>
        </div>

        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 mt-5">
          <div>
            <label htmlFor="ma-title" className="block text-sm font-semibold">
              Run title
            </label>
            <Input
              id="ma-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={100}
              required
              disabled={submitting}
              className="mt-1"
            />
          </div>

          <div>
            <label htmlFor="ma-prompt" className="block text-sm font-semibold">
              Natural-language request
            </label>
            <textarea
              id="ma-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              maxLength={2000}
              required
              disabled={submitting}
              className="w-full rounded border px-3 py-2 text-sm mt-1"
            />
            <p className="muted text-xs mt-1">
              Dataset headers and values are treated as untrusted data. Unsupported or ambiguous requests return clarification questions or a refusal with zero missions created.
            </p>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="ma-primary-csv" className="block text-sm font-semibold">
                Primary CSV (<code>d1</code>: {primaryName})
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={submitting}
                onChange={(e) => void handleFileUpload(e.target.files?.[0], "primary")}
                className="block text-xs mt-1 mb-2"
              />
              <textarea
                id="ma-primary-csv"
                value={primaryCsv}
                onChange={(e) => setPrimaryCsv(e.target.value)}
                rows={5}
                required
                disabled={submitting}
                className="w-full rounded border px-3 py-2 font-mono text-xs"
              />
            </div>

            <div>
              <label htmlFor="ma-comparison-csv" className="block text-sm font-semibold">
                Optional comparison CSV (<code>d2</code>, for keyed reconciliation)
              </label>
              <input
                type="file"
                accept=".csv,text/csv"
                disabled={submitting}
                onChange={(e) => void handleFileUpload(e.target.files?.[0], "comparison")}
                className="block text-xs mt-1 mb-2"
              />
              <textarea
                id="ma-comparison-csv"
                value={comparisonCsv}
                onChange={(e) => setComparisonCsv(e.target.value)}
                rows={5}
                disabled={submitting}
                placeholder="Paste optional second CSV for keyed reconciliation…"
                className="w-full rounded border px-3 py-2 font-mono text-xs"
              />
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="ma-budget" className="block text-sm font-semibold">
                Maximum total transfer budget (testnet NEAR, max 1 NEAR)
              </label>
              <Input
                id="ma-budget"
                value={maxBudgetNear}
                onChange={(e) => setMaxBudgetNear(e.target.value)}
                required
                disabled={submitting}
                className="mt-1"
              />
              <p className="muted text-xs mt-1">
                Proposal cap only. No funds move until you accept the plan and grant scoped spending authority.
              </p>
            </div>
            <div>
              <label htmlFor="ma-deadline" className="block text-sm font-semibold">
                Deadline (days from now, 1–30)
              </label>
              <Input
                id="ma-deadline"
                type="number"
                min={1}
                max={30}
                value={deadlineDays}
                onChange={(e) => setDeadlineDays(e.target.value)}
                required
                disabled={submitting}
                className="mt-1"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={requiresHumanReview}
                onChange={(e) => setRequiresHumanReview(e.target.checked)}
                disabled={submitting}
              />
              <span>Require human review of acceptance criteria on all compiled steps</span>
            </label>

            {settlementStatus && !settlementStatus.enabled && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={allowUnfundedPreview}
                  onChange={(e) => setAllowUnfundedPreview(e.target.checked)}
                  disabled={submitting}
                />
                <span>
                  Acknowledge metadata-only preview (settlement is not configured; full outputs stay locked until testnet payments confirm)
                </span>
              </label>
            )}
          </div>

          {error && (
            <p role="alert" className="text-red-800 text-sm font-medium">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" disabled={submitting}>
              {submitting ? "Planning with local Qwen3.5 4B…" : "Generate Master Agent Plan"}
            </Button>
          </div>
        </form>
      </section>

      <section className="panel">
        <p className="eyebrow">Saved runs</p>
        <h2 className="mt-1">Your Master Agent runs</h2>
        {!runs ? (
          <p className="muted text-sm mt-3">Loading runs…</p>
        ) : runs.length === 0 ? (
          <p className="muted text-sm mt-3">No Master Agent runs yet. Create one above.</p>
        ) : (
          <div className="space-y-3 mt-4">
            {runs.map((run) => (
              <div
                key={run._id}
                className="flex flex-wrap items-center justify-between gap-3 rounded border p-4"
              >
                <div>
                  <Link href={`/master-agent/${run._id}`} className="font-semibold underline">
                    {run.title}
                  </Link>
                  <p className="muted text-xs mt-1">{run.prompt}</p>
                  <p className="muted text-xs mt-1">
                    Budget cap: {formatNear(run.maxBudgetYocto)} NEAR · Plan v{run.planVersion} ·{" "}
                    {run.stepCount} compiled step{run.stepCount === 1 ? "" : "s"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className={`outcome-pill ${run.state === "completed" ? "approved" : ""}`}>
                    {run.state}
                  </span>
                  <Button asChild variant="outline">
                    <Link href={`/master-agent/${run._id}`}>Open run</Link>
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
