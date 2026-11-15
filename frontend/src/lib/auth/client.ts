/**
 * Supabase Auth client factory.
 *
 * Configuration is provided through Vite environment variables only; the
 * publishable key is safe for browsers. When configuration is absent the app
 * degrades to the offline prototype mode instead of crashing.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type ResolvedAuthConfig =
  | { ok: true; client: SupabaseClient }
  | { ok: false; reason: string };

const configuredUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const configuredKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Supabase Auth's built-in fetch has no timeout. A token-refresh request that
 * was in flight when the machine slept (or when the network dropped) can stay
 * pending indefinitely. Because `initialize()` / `getSession()` await that
 * refresh, the whole auth provider would then stay in `loading` forever: the
 * landing page renders with a permanently disabled sign-in button, while the
 * stale session remains in localStorage. Aborting stalled auth requests makes
 * the SDK treat them as retryable failures, so initialization always settles
 * and the app can fall back to the signed-out state.
 */
const AUTH_REQUEST_TIMEOUT_MS = 10_000;

const fetchWithTimeout: typeof fetch = (input, init) => {
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), AUTH_REQUEST_TIMEOUT_MS);
  return fetch(input, { ...init, signal: controller.signal }).finally(() => window.clearTimeout(timer));
};

let cached: ResolvedAuthConfig | null = null;

function resolve(): ResolvedAuthConfig {
  const missing: string[] = [];
  if (!configuredUrl) missing.push("VITE_SUPABASE_URL");
  if (!configuredKey) missing.push("VITE_SUPABASE_ANON_KEY");
  if (missing.length > 0) {
    return { ok: false, reason: `Missing frontend configuration: ${missing.join(", ")}. See frontend/.env.example.` };
  }

  let parsed: URL;
  try {
    parsed = new URL(configuredUrl as string);
  } catch {
    return { ok: false, reason: "VITE_SUPABASE_URL is not a valid URL." };
  }
  if (parsed.protocol !== "https:") {
    return { ok: false, reason: "VITE_SUPABASE_URL must use https." };
  }

  const client = createClient(configuredUrl as string, configuredKey as string, {
    global: { fetch: fetchWithTimeout },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: "asquii.auth.session",
    },
  });
  return { ok: true, client };
}

export function getSupabaseClient(): ResolvedAuthConfig {
  if (cached === null) cached = resolve();
  return cached;
}
