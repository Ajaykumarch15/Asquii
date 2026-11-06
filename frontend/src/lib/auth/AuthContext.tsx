/**
 * React session context for Supabase Auth plus the Asquii backend identity.
 *
 * States: unconfigured -> prototype demo mode; loading -> session check in
 * flight; demo -> no signed-in user (prototype persona picker applies);
 * authed -> verified backend profile; error -> recoverable failure with a
 * message and a retry path.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
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
  /** Current Supabase access token, refreshed by the SDK; null in demo mode. */
  getAccessToken: () => Promise<string | null>;
  retry: () => void;
};

const AuthStateContext = createContext<AuthState>({ status: "loading" });
const AuthActionsContext = createContext<AuthActions | null>(null);

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

  const applySession = useCallback(
    async (session: Session | null) => {
      // Every caller captures its own epoch; superseded calls never write.
      const myEpoch = epoch;
      if (!session || !client) {
        setState(previous => (previous.status === "unconfigured" || previous.status === "authed" ? previous : { status: "demo" }));
        return;
      }
      setState(previous => (previous.status === "authed" ? previous : { status: "loading" }));
      try {
        const identity = await fetchIdentity(session.access_token);
        if (epoch !== myEpoch) return;
        setState({ status: "authed", identity });
      } catch (error) {
        if (epoch !== myEpoch) return;
        const friendly = friendlyError(error, "Could not load your account");
        setState({ status: "error", message: `${friendly.title}: ${friendly.message}` });
      }
    },
    [client, epoch],
  );

  useEffect(() => {
    if (!client) return;

    let disposed = false;
    void client.auth.getSession().then(({ data }) => {
      if (!disposed) void applySession(data.session);
    });

    const {
      data: { subscription },
    } = client.auth.onAuthStateChange((event, session) => {
      if (disposed) return;
      if (event === "SIGNED_OUT") {
        setEpoch(previous => previous + 1);
        setState({ status: "demo" });
        return;
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "USER_UPDATED") {
        void applySession(session);
      }
    });

    return () => {
      disposed = true;
      subscription.unsubscribe();
    };
    // Re-run when the epoch changes so SIGNED_OUT cannot leave ghost sessions.
  }, [client, epoch, applySession]);

  const actions = useMemo<AuthActions>(() => {
    if (!client) {
      return {
        signIn: async () => ({ ok: false, error: "Sign-in is not configured in this build." }),
        signUp: async () => ({ ok: false, error: "Sign-up is not configured in this build." }),
        signOut: async () => undefined,
        getAccessToken: async () => null,
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
      getAccessToken: async () => {
        const { data, error } = await client.auth.getSession();
        if (error || !data.session) return null;
        return data.session.access_token;
      },
      retry: () => {
        setEpoch(previous => previous + 1);
        void client.auth.getSession().then(({ data }) => void applySession(data.session));
      },
    };
  }, [client, applySession]);

  return (
    <AuthStateContext.Provider value={state}>
      <AuthActionsContext.Provider value={actions}>{children}</AuthActionsContext.Provider>
    </AuthStateContext.Provider>
  );
}
