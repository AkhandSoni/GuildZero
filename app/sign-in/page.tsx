"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth } from "convex/react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
export default function SignInPage() {
  const { signIn } = useAuthActions();
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationError, setConfirmationError] = useState(false);
  useEffect(() => {
    if (isAuthenticated) router.replace("/dashboard");
  }, [isAuthenticated, router]);
  return (
    <main className="mx-auto w-full max-w-lg px-5 py-10 sm:py-14">
      <Link href="/" className="text-lg font-bold">
        guildzero<span className="text-emerald-800">.</span>
      </Link>
      <div className="panel auth-card mt-8">
        <p className="eyebrow">Private mission workspace</p>
        <h1 className="!text-[1.75rem] !font-semibold !tracking-tight">{flow === "signIn" ? "Welcome back." : "Create your account."}</h1>
        <p className="muted mt-3 text-sm">
          {flow === "signIn" ? "Sign in to an account created in this app. First visit? Choose Sign up below." : "Create your private workspace with an email and password."}
        </p>
        <form
          className="mt-6 grid gap-5"
          onSubmit={async (event) => {
            event.preventDefault();
            setError("");
            setConfirmationError(false);
            const data = new FormData(event.currentTarget);
            if (flow === "signUp" && data.get("password") !== data.get("confirmPassword")) {
              setConfirmationError(true);
              document.getElementById("confirm-password")?.focus();
              return;
            }
            // Confirmation is a local typing check, never an account field.
            data.delete("confirmPassword");
            data.set("flow", flow);
            setBusy(true);
            setShowPassword(false);
            setShowConfirmation(false);
            try {
              const result = await signIn("password", data);
              if (!result.signingIn) setError("Sign-in was not completed. Check your details and try again.");
            } catch {
              setError(
                flow === "signIn"
                  ? "Unable to sign in. Check your email and password. If you have not registered in this app, choose Sign up below."
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
              autoCapitalize="off"
              spellCheck={false}
              required
            />
          </label>
          <div className="grid gap-2">
            <PasswordInput id="password" label="Password" name="password"
              visible={showPassword} onToggle={() => setShowPassword(!showPassword)}
              aria-describedby={flow === "signUp" ? "password-help" : undefined}
              minLength={flow === "signUp" ? MIN_PASSWORD_LENGTH : undefined}
              maxLength={MAX_PASSWORD_LENGTH}
              autoComplete={flow === "signIn" ? "current-password" : "new-password"} required
              onInput={() => setConfirmationError(false)} />
            {flow === "signUp" && <p id="password-help" className="muted text-xs">Use 8–128 characters. A longer passphrase is better.</p>}
          </div>
          {flow === "signUp" && <div className="grid gap-2">
            <PasswordInput id="confirm-password" label="Confirm password" name="confirmPassword"
              visible={showConfirmation} onToggle={() => setShowConfirmation(!showConfirmation)}
              autoComplete="new-password" maxLength={MAX_PASSWORD_LENGTH} required
              aria-invalid={confirmationError || undefined}
              aria-describedby={confirmationError ? "confirmation-error" : undefined}
              onInput={() => setConfirmationError(false)} />
            {confirmationError && <p id="confirmation-error" role="alert" className="text-sm text-red-800">Passwords do not match. Enter the same password in both fields.</p>}
          </div>}
          {error && (
            <p role="alert" className="text-sm text-red-800">
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
            className="text-sm text-emerald-800 hover:underline"
            disabled={busy}
            onClick={() => {
              setFlow(flow === "signIn" ? "signUp" : "signIn");
              setError("");
              setConfirmationError(false);
              setShowPassword(false);
              setShowConfirmation(false);
            }}
          >
            {flow === "signIn"
              ? "Need an account? Sign up"
              : "Already registered? Sign in"}
          </button>
        </form>
        <p className="muted mt-6 border-t border-[#d9ddd6] pt-4 text-xs">Demo accounts use email and password. Email verification and password recovery are not enabled.</p>
      </div>
    </main>
  );
}
