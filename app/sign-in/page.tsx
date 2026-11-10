"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
export default function SignInPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, router]);
  return (
    <main className="mx-auto max-w-md px-6 py-16">
      <Link href="/" className="text-lg font-bold">
        guildzero<span className="text-emerald-300">.</span>
      </Link>
      <div className="panel mt-12">
        <p className="eyebrow">Private mission workspace</p>
        <h1>{flow === "signIn" ? "Welcome back." : "Create your account."}</h1>
        <p className="muted mt-3 text-sm">
          Use an email and password. No wallet connection required.
        </p>
        <form
          className="mt-6 grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            const data = new FormData(event.currentTarget);
            data.set("flow", flow);
            try {
              await signIn("password", data);
            } catch {
              setError(
                flow === "signIn"
                  ? "Unable to sign in. Check your credentials and backend connection."
                  : "Unable to create account. Check your details or try signing in.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="field">
            Email
            <Input
              type="email"
              name="email"
              maxLength={254}
              autoComplete="email"
              required
            />
          </label>
          <div className="field">
            <label htmlFor="password">Password</label>
            <Input
              id="password"
              aria-describedby="password-help"
              type="password"
              name="password"
              minLength={12}
              maxLength={128}
              autoComplete={
                flow === "signIn" ? "current-password" : "new-password"
              }
              required
            />
            <span id="password-help" className="muted text-xs">
              12–128 characters. Keep your password; email recovery is not
              enabled in this demo.
            </span>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-300">
              {error}
            </p>
          )}
          <Button disabled={busy || isLoading || isAuthenticated} type="submit">
            {busy
              ? "Please wait…"
              : flow === "signIn"
                ? "Sign in"
                : "Create account"}
          </Button>
          <button
            type="button"
            className="text-sm text-emerald-300 hover:underline"
            disabled={busy}
            onClick={() => {
              setFlow(flow === "signIn" ? "signUp" : "signIn");
              setError("");
            }}
          >
            {flow === "signIn"
              ? "Need an account? Sign up"
              : "Already registered? Sign in"}
          </button>
        </form>
      </div>
    </main>
  );
}
