"use client";
import { useConvexAuth, useConvexConnectionState } from "convex/react";
import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ArrowUpRight, Boxes, LayoutGrid, LogOut, Network, ShieldCheck } from "lucide-react";
export function AppShell({ children }: { children: React.ReactNode }) {
  const { isLoading, isAuthenticated } = useConvexAuth();
  const connection = useConvexConnectionState();
  const { signOut } = useAuthActions();
  const router = useRouter();
  const pathname = usePathname();
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
    <div className="app-frame">
      <aside className="app-rail" aria-label="Workspace sidebar">
        <Link href="/dashboard" className="brand-mark" aria-label="GuildZero home"><Boxes size={23} strokeWidth={1.6} /></Link>
        <nav className="rail-links" aria-label="Main navigation">
          {[
            { href: "/dashboard", name: "Missions", Icon: LayoutGrid, active: pathname === "/dashboard" || pathname.startsWith("/missions") },
            { href: "/economy", name: "Economy", Icon: Network, active: pathname === "/economy" },
            { href: "/security", name: "Security", Icon: ShieldCheck, active: pathname === "/security" },
          ].map(({ href, name, Icon, active }) => <Link key={href} href={href} className="rail-link" aria-label={name} title={name} aria-current={active ? "page" : undefined}><Icon size={18} strokeWidth={1.6} /></Link>)}
        </nav>
        <div className="rail-spacer" />
          <button
            className="rail-link rail-signout" aria-label="Sign out" title="Sign out"
            onClick={async () => {
              try {
                await signOut();
                router.replace("/sign-in");
              } catch {
                setError("Could not sign out. Try again.");
              }
            }}
          >
            <LogOut size={18} strokeWidth={1.6} />
          </button>
      </aside>
      <div className="app-content">
      <header className="workspace-header">
        <Link href="/dashboard" className="wordmark">guildzero<span className="text-[#7b985f]">.</span></Link>
        <div className="workspace-header-actions">
          <span className="network-label">NEAR testnet</span>
          <Button asChild variant="outline"><Link href="/missions/new">New mission <ArrowUpRight size={14} /></Link></Button>
        </div>
      </header>
      {connection.hasEverConnected && !connection.isWebSocketConnected && <p role="status" className="mb-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-900">Reconnecting to your workspace. Changes will sync when the backend returns.</p>}
      {error && (
        <p role="alert" className="mt-4 text-red-800">
          {error}
        </p>
      )}
      <main>{children}</main>
      <footer className="workspace-footer">
        Private by default. Algorithm-driven services. Payments use testnet tokens; confirmation appears in each receipt.
      </footer>
      </div>
    </div>
  );
}
