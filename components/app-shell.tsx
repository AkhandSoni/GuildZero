"use client";
import { useConvexAuth } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
export function AppShell({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const { signOut } = useAuthActions();
  const router = useRouter();
  const [error, setError] = useState("");
  useEffect(() => {
    if (!isLoading && !isAuthenticated) router.replace("/sign-in");
  }, [isLoading, isAuthenticated, router]);
  if (isLoading || !isAuthenticated)
    return (
      <main className="muted p-12" role="status">
        Checking your session…
      </main>
    );
  return (
    <div className="mx-auto max-w-6xl px-5 py-6 sm:px-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 pb-5">
        <Link href="/dashboard" className="text-xl font-bold">
          guildzero<span className="text-emerald-300">.</span>
        </Link>
        <nav className="flex flex-wrap items-center gap-4 text-sm">
          <Link href="/dashboard">Missions</Link>
          <Link href="/economy">Economy</Link>
          <Link href="/security">Security</Link>
          <Link href="/missions/new" className="text-emerald-300">
            New mission
          </Link>
          <Button
            variant="outline"
            onClick={async () => {
              try {
                await signOut();
                router.replace("/sign-in");
              } catch {
                setError("Could not sign out. Try again.");
              }
            }}
          >
            Sign out
          </Button>
        </nav>
      </header>
      {error && (
        <p role="alert" className="mt-4 text-red-300">
          {error}
        </p>
      )}
      <main className="py-10">{children}</main>
      <footer className="muted border-t border-neutral-800 py-5 text-xs">
        Private workspace · NEAR testnet only · Check receipts for actual
        settlement.
      </footer>
    </div>
  );
}
