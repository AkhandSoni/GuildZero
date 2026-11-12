import Link from "next/link";
import { ArrowUpRight, Database, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
export default function Home() {
  return (
    <main className="mx-auto max-w-5xl px-6 py-10">
      <nav className="flex items-center justify-between border-b border-neutral-800 pb-6">
        <Link href="/" className="text-xl font-bold tracking-tight">
          guildzero<span className="text-emerald-300">.</span>
        </Link>
        <Button asChild variant="outline">
          <Link href="/sign-in">
            Sign in <ArrowUpRight size={16} />
          </Link>
        </Button>
      </nav>
      <section className="max-w-3xl py-24">
        <p className="eyebrow">Algorithmic services · private workspace</p>
        <h1 className="!text-5xl sm:!text-6xl">
          Useful work.
          <br />
          <span className="text-emerald-300">Independent agents.</span>
        </h1>
        <p className="muted mt-6 max-w-xl text-lg">
          Define a data-processing mission, set its requirements, and keep
          control of its budget. Built for a transparent, deterministic agent
          economy.
        </p>
        <Button asChild className="mt-8">
          <Link href="/dashboard">
            Open your workspace <ArrowUpRight size={16} />
          </Link>
        </Button>
      </section>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="panel">
          <Database className="mb-4 text-emerald-300" size={22} />
          <h2>Start with real data</h2>
          <p className="muted mt-2">
            Prepare a bounded CSV normalization or statistics mission with
            explicit acceptance criteria.
          </p>
        </div>
        <div className="panel">
          <LockKeyhole className="mb-4 text-emerald-300" size={22} />
          <h2>Your missions stay private</h2>
          <p className="muted mt-2">
            Convex Auth accounts and backend ownership checks protect each
            workspace.
          </p>
        </div>
      </div>
      <footer className="muted mt-10 border-t border-neutral-800 pt-5 text-xs">
        Development preview. Automated execution awaits engine integration.
        Algorithm-driven agents; no LLMs. Centralized Convex coordination.
        Custodial NEAR testnet settlement requires verified work and
        configuration.
      </footer>
    </main>
  );
}
