"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function WorkspaceError({ reset }: { reset: () => void }) {
  return (
    <section className="panel">
      <h1>Workspace unavailable.</h1>
      <p className="muted mt-4">
        This mission may not exist, may belong to another account, or the
        backend may be unavailable.
      </p>
      <div className="mt-6 flex gap-4">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">Back to missions</Link>
        </Button>
      </div>
    </section>
  );
}
