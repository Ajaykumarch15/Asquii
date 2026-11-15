/**
 * React session context for Supabase Auth plus the Asquii backend identity.
 *
 * States: unconfigured -> prototype demo mode; loading -> session check in
 * flight; demo -> no signed-in user (prototype persona picker applies);
 * authed -> verified backend profile; error -> recoverable failure with a
 * message and a retry path.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { apiFetch, friendlyError } from "../api/client";
import { getSupabaseClient } from "./client";

export type AuthIdentity = {
  userId: string;
  email: string | null;
  displayName: string;
  jobTitle: string | null;
};

export type AuthState =
  | { status: "unconfigured"; reason: string }
  | { status: "loading" }
  | { status: "demo" }
  | { status: "authed"; identity: AuthIdentity }
  | { status: "error"; message: string };

type CurrentProfile = { user_id: string; display_name: string; job_title: string | null };
type MeResponse = { user_id: string; email: string | null; display_name: string; job_title: string | null };

type AuthActions = {
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  signUp: (email: string, password: string) => Promise<{ ok: boolean; error?: string; needsConfirmation?: boolean }>;
  signOut: () => Promise<void>;
  /** Update the signed-in account password through Supabase Auth. */
  changePassword: (password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Request an email change; Supabase Auth sends the confirmation link. */
  changeEmail: (email: string) => Promise<{ ok: boolean; error?: string }>;
  /** Current Supabase access token, refreshed by the SDK; null in demo mode. */
  getAccessToken: () => Promise<string | null>;
  /** Replace the cached identity after a self-service profile update. */
  applyIdentity: (identity: AuthIdentity) => void;
  retry: () => void;
};

const AuthStateContext = createContext<AuthState>({ status: "loading" });
const AuthActionsContext = createContext<AuthActions | null>(null);

/**
 * How long to wait for the SDK to restore a persisted session before treating
 * the visitor as signed out. Without this, a stuck session refresh leaves the
 * UI in `loading` indefinitely, which also disables the sign-in button.
 */
const SESSION_RESTORE_TIMEOUT_MS = 12_000;

export function useAuthState(): AuthState {
  return useContext(AuthStateContext);
}

export function useAuthActions(): AuthActions {
  const actions = useContext(AuthActionsContext);
  if (!actions) throw new Error("useAuthActions must be used inside AuthProvider");
  return actions;
}

async function fetchIdentity(accessToken: string): Promise<AuthIdentity> {
  // The backend derives identity from the JWT and upserts a missing profile;
  // it never trusts client-submitted identity or roles. The generous timeout
  // covers cold backend starts that verify the JWT against a remote JWKS.
  const me = await apiFetch<MeResponse>("/auth/me", { method: "GET", accessToken, timeoutMs: 30000 });
  return { userId: me.user_id, email: me.email, displayName: me.display_name, jobTitle: me.job_title };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const resolved = useMemo(() => getSupabaseClient(), []);
  const client = resolved.ok ? resolved.client : null;

  const [state, setState] = useState<AuthState>(() =>
    resolved.ok ? { status: "loading" } : { status: "unconfigured", reason: resolved.reason },
  );
  // Prevents restoring stale state from an async me-response after a sign-out.
  const [epoch, setEpoch] = useState(0);
  // Async callers capture values when they start; read the live generation from
  // a ref so a response that began before sign-out cannot write "authed" after.
  const sessionGeneration = useRef(0);
  const bumpEpoch = useCallback(() => {
    sessionGeneration.current += 1;
    setEpoch(previous => previous + 1);
  }, []);

  const applySession = useCallback(
    async (session: Session | null) => {
      // Every caller captures its own generation; superseded calls never write.
      const myGeneration = sessionGeneration.current;
      if (!session || !client) {
        if (sessionGeneration.current !== myGeneration) return;
        setState(previous => (previous.status === "unconfigured" || previous.status === "authed" ? previous : { status: "demo" }));
        return;
      }
      setState(previous => (previous.status === "authed" ? previous : { status: "loading" }));
      try {
        const identity = await fetchIdentity(session.access_token);
        if (sessionGeneration.current !== myGeneration) return;
        setState({ status: "authed", identity });
      } catch (error) {
        if (sessionGeneration.current !== myGeneration) return;
        const friendly = friendlyError(error, "Could not load your account");
        // A late failure from a superseded restore must not sign out a user who
        // has since authenticated successfully.
        setState(previous => (previous.status === "authed" ? previous : { status: "error", message: `${friendly.title}: ${friendly.message}` }));
      }
    },
    [client],
  );

  useEffect(() => {
    if (!client) return;

    let disposed = false;
    // Safety net: if the SDK's session restore never settles, do not leave the
    // app permanently in "loading" (landing page + disabled sign-in). Fall back
    // to the signed-out state; a late session result can still promote us.
    const restoreWatchdog = window.setTimeout(() => {
      if (disposed) return;
      setState(previous => (previous.status === "loading" ? { status: "demo" } : previous));
    }, SESSION_RESTORE_TIMEOUT_MS);
    const settleRestore = () => window.clearTimeout(restoreWatchdog);

    void client.auth
      .getSession()
      .then(({ data }) => {
        settleRestore();
        if (!disposed) void applySession(data.session);
      })
      .catch(() => {
        settleRestore();
        if (!disposed) setState(previous => (previous.status === "loading" ? { status: "demo" } : previous));
      });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      if (event === "SIGNED_OUT") {
        settleRestore();
        bumpEpoch();
        setState({ status: "demo" });
        return;
      }
      if (event === "INITIAL_SESSION" || event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        settleRestore();
        void applySession(session);
      }
    });

    return () => {
      disposed = true;
      settleRestore();
      subscription.unsubscribe();
    };
    // Re-run when the epoch changes so SIGNED_OUT cannot leave ghost sessions.
  }, [client, epoch, applySession, bumpEpoch]);

  const actions = useMemo<AuthActions>(() => {
    if (!client) {
      return {
        signIn: async () => ({ ok: false, error: "Sign-in is not configured in this build." }),
        signUp: async () => ({ ok: false, error: "Sign-up is not configured in this build." }),
        signOut: async () => undefined,
        changePassword: async () => ({ ok: false, error: "Account security is not configured in this build." }),
        changeEmail: async () => ({ ok: false, error: "Account security is not configured in this build." }),
        getAccessToken: async () => null,
        applyIdentity: () => undefined,
        retry: () => undefined,
      };
    }
    return {
      signIn: async (email: string, password: string) => {
        try {
          const { error } = await client.auth.signInWithPassword({ email, password });
          if (error) return { ok: false, error: error.message };
          return { ok: true };
        } catch (error) {
          return { ok: false, error: friendlyError(error).message };
        }
      },
      signUp: async (email: string, password: string) => {
        try {
          const { data, error } = await client.auth.signUp({ email, password });
          if (error) return { ok: false, error: error.message };
          return { ok: true, needsConfirmation: data.session === null };
        } catch (error) {
          return { ok: false, error: friendlyError(error).message };
        }
      },
      signOut: async () => {
        await client.auth.signOut();
      },
      changePassword: async (password: string) => {
        try {
          const { error } = await client.auth.updateUser({ password });
          return error ? { ok: false, error: error.message } : { ok: true };
        } catch (error) {
          return { ok: false, error: friendlyError(error).message };
        }
      },
      changeEmail: async (email: string) => {
        try {
          const { error } = await client.auth.updateUser({ email });
          return error ? { ok: false, error: error.message } : { ok: true };
        } catch (error) {
          return { ok: false, error: friendlyError(error).message };
        }
      },
      getAccessToken: async () => {
        const { data, error } = await client.auth.getSession();
        if (error || !data.session) return null;
        return data.session.access_token;
      },
      applyIdentity: (identity: AuthIdentity) => {
        // Only refresh a session that is still authenticated; a pending
        // sign-out must not be resurrected by a stale PATCH response.
        setState(previous => (previous.status === "authed" ? { status: "authed", identity } : previous));
      },
      retry: () => {
        // Re-runs the restore effect (and its watchdog) without duplicating
        // getSession calls here.
        bumpEpoch();
      },
    };
  }, [client, applySession, bumpEpoch]);

  return (
    <AuthStateContext.Provider value={state}>
      <AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>
    </AuthStateContext.Provider>
  );
}
