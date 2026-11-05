/**
 * Base HTTP client for the Asquii FastAPI backend.
 *
 * Every request carries the Supabase access JWT; identity and roles are
 * derived server-side only. Responses follow doc 10: 401 session handling,
 * 403 access denied, 404 concealed cross-tenant misses, 409 duplicates or
 * conflicts, 422 validation mapping, 429 retry guidance.
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "";

export type ApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class ApiError extends Error {
  status: number;
  requestKind: "network" | "auth" | "forbidden" | "not_found" | "conflict" | "validation" | "rate_limited" | "server";

  constructor(status: number, message: string, requestKind: ApiError["requestKind"]) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.requestKind = requestKind;
  }
}

export type FriendlyError = { kind: ApiError["requestKind"]; title: string; message: string };

/** Convert any thrown value into a user-facing, actionable summary. */
export function friendlyError(error: unknown, fallbackTitle = "Something went wrong"): FriendlyError {
  if (error instanceof ApiError) {
    switch (error.requestKind) {
      case "network":
        return { kind: "network", title: "Connection problem", message: "The app could not reach the Asquii service. Check your connection or try again." };
      case "auth":
        return { kind: "auth", title: "Session expired", message: "You need to sign in again to continue." };
      case "forbidden":
        return { kind: "forbidden", title: "Not allowed", message: "Your account does not have permission for this action." };
      case "not_found":
        return { kind: "not_found", title: "Not available", message: "This item no longer exists or you do not have access to it." };
      case "conflict":
        return { kind: "conflict", title: "Change conflict", message: error.message };
      case "validation":
        return { kind: "validation", title: "Check the form", message: error.message };
      case "rate_limited":
        return { kind: "rate_limited", title: "Too many requests", message: "Please wait a moment and retry." };
      default:
        return { kind: "server", title: fallbackTitle, message: "The service reported a problem. Retry after a moment." };
    }
  }
  return { kind: "server", title: fallbackTitle, message: error instanceof Error ? error.message : "Unexpected error." };
}

function kindForStatus(status: number): ApiError["requestKind"] {
  switch (status) {
    case 401:
    case 403:
      return "auth";
    case 404:
      return "not_found";
    case 409:
      return "conflict";
    case 422:
      return "validation";
    case 429:
      return "rate_limited";
    default:
      return status >= 500 ? "server" : "network";
  }
}

/** Extract a single readable message from a FastAPI/Pydantic error body. */
function detailToMessage(status: number, body: unknown): string {
  if (typeof body === "object" && body !== null && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
      const first = detail[0] as { msg?: string; loc?: unknown[] } | undefined;
      if (first?.msg) return first.msg;
    }
  }
  return status >= 500 ? "Unexpected service error" : "Request rejected";
}

export async function apiFetch<T>(
  path: string,
  options: { method?: ApiMethod; accessToken?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const { method = "GET", body, accessToken, timeoutMs = 15000 } = options;
  if (!API_URL) throw new ApiError(0, "VITE_API_URL is not configured", "network");

  const headers: Record<string, string> = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (accessToken) headers["Authorization"] = `Bearer ${accessToken}`;

  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), timeoutMs);
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (error) {
    window.clearTimeout(timer);
    throw new ApiError(0, error instanceof Error ? error.message : "Network request failed", "network");
  }
  window.clearTimeout(timer);

  const text = await response.text();
  let parsed: unknown = null;
  if (text.startsWith("{") || text.startsWith("[")) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    if (response.status === 401 && accessToken) {
      // The access token was rejected; the auth layer refreshes and retries.
      throw new ApiError(401, "Rejected access token", "auth");
    }
    throw new ApiError(response.status, detailToMessage(response.status, parsed), kindForStatus(response.status));
  }
  return (parsed ?? {}) as T;
}

export function apiGet<T>(path: string, accessToken?: string): Promise<T> {
  return apiFetch<T>(path, { method: "GET", accessToken });
}

export function apiPost<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  return apiFetch<T>(path, { method: "POST", body, accessToken });
}

export function apiPatch<T>(path: string, body: unknown, accessToken?: string): Promise<T> {
  return apiFetch<T>(path, { method: "PATCH", body, accessToken });
}

export async function apiDelete(path: string, accessToken?: string): Promise<void> {
  await apiFetch(path, { method: "DELETE", accessToken });
}
