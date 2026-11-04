/**
 * Sign-in / sign-up modal layered over the offline prototype.
 *
 * Uses the published ui.tsx primitives; errors are user-facing already and
 * are shown as a single message. Prototype data stays untouched while the
 * dialog is open.
 */

import { useState, type FormEvent } from "react";
import { LogIn, UserRoundPlus, X } from "lucide-react";
import { Button, StateMessage, TextInput } from "./ui";
import { useAuthActions, useAuthState } from "../lib/auth/AuthContext";

type Mode = "sign-in" | "sign-up";

export function AuthPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const actions = useAuthActions();
  const { status } = useAuthState();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (!open) return null;

  const busy = submitting || status === "unconfigured" || status === "loading";

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      if (mode === "sign-in") {
        const result = await actions.signIn(email.trim(), password);
        if (!result.ok) {
          setError(result.error ?? "Sign-in failed");
          return;
        }
        onClose(); // SIGNED_IN drives the provider into authed state.
        return;
      }
      const result = await actions.signUp(email.trim(), password);
      if (!result.ok) {
        setError(result.error ?? "Sign-up failed");
        return;
      }
      if (result.needsConfirmation) {
        setInfo("Account created. Confirm your email address through the link we sent, then sign in.");
        setMode("sign-in");
        return;
      }
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label="Sign in to Asquii">
      <button className="absolute inset-0 bg-black/30" aria-label="Close sign-in dialog" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-5 shadow-xl">
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold text-heading">{mode === "sign-in" ? "Sign in to Asquii" : "Create your account"}</h2>
            <p className="mt-1 text-xs text-muted">Your workspace data lives in Asquii, not on this device.</p>
          </div>
          <button className="icon-button" aria-label="Close" onClick={onClose}><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="space-y-3">
          <TextInput
            label="Email"
            type="email"
            autoComplete="username"
            required
            value={email}
            onChange={event => setEmail(event.target.value)}
            placeholder="you@company.com"
          />
          <TextInput
            label="Password"
            type="password"
            autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
            required
            minLength={8}
            value={password}
            onChange={event => setPassword(event.target.value)}
            placeholder={mode === "sign-in" ? "Your password" : "At least 8 characters"}
            hint={mode === "sign-up" ? undefined : undefined}
          />
          {error && <StateMessage kind="error" title="Try again">{error}</StateMessage>}
          {info && <StateMessage kind="success" title="Check your email">{info}</StateMessage>}
          <Button type="submit" variant="primary" className="w-full justify-center" disabled={busy} icon={mode === "sign-in" ? <LogIn size={15} /> : <UserRoundPlus size={15} />}>
            {submitting ? "Working…" : mode === "sign-in" ? "Sign in" : "Create account"}
          </Button>
        </form>
        <p className="mt-3 text-center text-xs text-muted">
          {mode === "sign-in"
            ? <>
              New to Asquii? <button type="button" className="font-semibold text-brand hover:text-brand-pressed" onClick={() => { setMode("sign-up"); setError(null); setInfo(null); }}>Create an account</button>
            </>
            : <>
              Already have an account? <button type="button" className="font-semibold text-brand hover:text-brand-pressed" onClick={() => { setMode("sign-in"); setError(null); setInfo(null); }}>Sign in</button>
            </>}
        </p>
      </div>
    </div>
  );
}
