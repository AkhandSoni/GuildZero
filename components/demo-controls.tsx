"use client";
import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@/convex/_generated/api";
import { Button } from "@/components/ui/button";
export function DemoControls() {
  const seed = useMutation(api.demo.seed),
    reset = useMutation(api.demo.resetUnused);
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState("");
  return (
    <div className="mb-6">
      <div className="flex flex-wrap gap-3">
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await seed({});
              setMessage(
                "Synthetic sample missions are ready. Existing work is preserved.",
              );
            } catch {
              setMessage("Unable to add samples.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Add sample missions
        </Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const r = await reset({});
              setMessage(
                `Removed ${r.removed} unused sample drafts. Active work and payment history were preserved.`,
              );
            } catch {
              setMessage("Unable to reset unused samples.");
            } finally {
              setBusy(false);
            }
          }}
        >
          Remove unused samples
        </Button>
      </div>
      {message && (
        <p role="status" className="muted mt-3 text-sm">
          {message}
        </p>
      )}
    </div>
  );
}
