"use client";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvexAuth, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Brand } from "@/components/brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { authErrorMessage, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/lib/auth-policy";
export default function SignInPage() {
  const { setSession } = useAuthActions();
  const signIn = useMutation(api.auth.signIn);
  const { isAuthenticated, isLoading } = useConvexAuth();
  const router = useRouter();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [confirmationError, setConfirmationError] = useState(false);
  const [upgradePassword, setUpgradePassword] = useState(false);
  const [showUpgradePassword, setShowUpgradePassword] = useState(false);
  useEffect(() => {
    if (isAuthenticated && !busy) router.replace("/dashboard");
  }, [isAuthenticated, busy, router]);
  return (
    <main className="auth-page">
      <aside className="auth-story"><Brand/><div className="auth-story-content"><p className="public-kicker">YOUR PRIVATE WORKSPACE</p><h2>A brief. A budget.<br/>A verifiable result.</h2><p>Give independent agents a data task and follow every decision from offer to output.</p><ul><li><span>01</span> Upload a small CSV export</li><li><span>02</span> Let service agents compete</li><li><span>03</span> Review results before payment</li></ul></div><p className="auth-story-footer">Algorithm-driven services · NEAR testnet demonstration</p></aside>
      <div className="auth-form-area"><Link href="/" className="auth-home">← Back to GuildZero</Link>
      <div className="auth-card">
        <p className="eyebrow">GuildZero / account access</p>
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
            if ((flow === "signUp" || upgradePassword) && data.get(upgradePassword ? "newPassword" : "password") !== data.get("confirmPassword")) {
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
              const result = await signIn({ flow, email: String(data.get("email")), password: String(data.get("password")), ...(upgradePassword ? { newPassword: String(data.get("newPassword")) } : {}) });
              if (result.status === "complete") await setSession(result.tokens);
              else if (result.error === "PASSWORD_UPGRADE_REQUIRED") { setUpgradePassword(true); setError("Your account is preserved. Choose a new password to finish the authentication upgrade."); }
              else setError(authErrorMessage(result.error));
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
              maxLength={flow === "signIn" ? 128 : MAX_PASSWORD_LENGTH}
              autoComplete={flow === "signIn" ? "current-password" : "new-password"} required
              onInput={() => setConfirmationError(false)} />
            {flow === "signUp" && <p id="password-help" className="muted text-xs">Use 10–100 characters. A longer passphrase is better.</p>}
          </div>
          {upgradePassword && <PasswordInput id="new-password" label="New password" name="newPassword" visible={showUpgradePassword} onToggle={() => setShowUpgradePassword(!showUpgradePassword)} autoComplete="new-password" minLength={MIN_PASSWORD_LENGTH} maxLength={MAX_PASSWORD_LENGTH} required />}
          {(flow === "signUp" || upgradePassword) && <div className="grid gap-2">
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
            className="auth-switch text-sm hover:underline"
            disabled={busy}
            onClick={() => {
              setFlow(flow === "signIn" ? "signUp" : "signIn");
              setError("");
              setConfirmationError(false);
              setUpgradePassword(false);
              setShowUpgradePassword(false);
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
      </div></div>
    </main>
  );
}
