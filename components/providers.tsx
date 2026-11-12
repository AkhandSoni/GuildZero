"use client";
import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { useState } from "react";
import { convexLogger } from "@/lib/convex-logger";
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(() =>
    process.env.NEXT_PUBLIC_CONVEX_URL
      ? new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL, { logger: convexLogger })
      : null,
  );
  if (!client)
    return (
      <main className="mx-auto max-w-xl px-6 py-24">
        <p className="eyebrow">GuildZero · setup required</p>
        <h1>Connect your Convex backend.</h1>
        <p className="muted mt-4">
          Run <code>npm run dev:backend</code> to configure a free local or
          cloud deployment, then follow the authentication setup in README.md.
          Restart Next.js after setting NEXT_PUBLIC_CONVEX_URL.
        </p>
        <p className="muted mt-4">
          Authentication and mission storage require a running backend.
        </p>
      </main>
    );
  return <ConvexAuthProvider client={client}>{children}</ConvexAuthProvider>;
}
