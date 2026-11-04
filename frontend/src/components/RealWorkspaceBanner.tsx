/**
 * Slice-1 connection surface between the signed-in account and the real API.
 *
 * On sign-in this loads the caller's real workspaces. With none available it
 * offers the first-run "create your workspace" flow backed by
 * POST /api/v1/workspaces. Prototype screens stay visible below; full module
 * wiring is deliberately deferred to the next slices.
 */

import { useEffect, useState, type FormEvent } from "react";
import { ChevronRight, Loader2, ShieldCheck, Users } from "lucide-react";
import { Button, TextInput } from "./ui";
import { friendlyError } from "../lib/api/client";
import { workspaceApi, type ApiWorkspace } from "../lib/api/workspace";

type Phase =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "ready"; workspaces: ApiWorkspace[] }
  | { kind: "error"; message: string };

const placeholders = [
  "Product",
  "Family",
  "Engineering",
  "Operations",
];

export function RealWorkspaceBanner({ displayName, api = workspaceApi, getAccessToken }: {
  displayName: string;
  api?: WorkspaceApiLike;
  getAccessToken: () => Promise<string | null>;
}) {
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let disposed = false;
    setPhase({ kind: "loading" });
    void (async () => {
      const token = await getAccessToken();
      if (!token) {
        if (!disposed) setPhase({ kind: "error", message: "Sign-in session is unavailable. Reload and sign in again." });
        return;
      }
      try {
        const workspaces = await api.listWorkspaces(token);
        if (disposed) return;
        setPhase(workspaces.length === 0 ? { kind: "empty" } : { kind: "ready", workspaces });
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load workspaces");
        setPhase({ kind: "error", message: `${friendly.title}: ${friendly.message}` });
      }
    })();
    return () => { disposed = true; };
  }, [api, getAccessToken, reload]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setNotice(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setNotice({ tone: "error", text: "Sign-in session ended. Please sign in again." });
        return;
      }
      const created = await api.createWorkspace(token, name.trim());
      setNotice({ tone: "success", text: `Workspace "${created.name}" created — you are its Owner.` });
      setName("");
      setReload(previous => previous + 1);
    } catch (error) {
      const friendly = friendlyError(error, "Could not create workspace");
      setNotice({ tone: "error", text: `${friendly.title}: ${friendly.message}` });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="mb-5 rounded-xl border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-brand-soft text-brand"><ShieldCheck size={15} /></span>
        <p className="text-sm font-semibold text-heading">{displayName}, your Asquii account is connected.</p>
      </div>
      {phase.kind === "loading" && <div className="mt-3 flex items-center gap-2 text-xs text-muted"><Loader2 size={14} className="animate-spin" />Loading your workspaces…</div>}
      {phase.kind === "error" && (
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-danger">
          <span>{phase.message}</span>
          <button className="font-semibold hover:underline" onClick={() => setReload(previous => previous + 1)}>Retry</button>
        </div>
      )}
      {phase.kind === "ready" && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-secondary">
          <Users size={14} className="text-muted" />
          <span>Your real workspaces:</span>
          {phase.workspaces.map(workspace => (
            <span key={workspace.id} className="flex items-center gap-1.5 rounded-lg bg-hover px-2 py-1 font-medium text-heading">
              {workspace.name}
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">{workspace.role}</span>
            </span>
          ))}
        </div>
      )}
      {phase.kind === "empty" && (
        <form onSubmit={submit} className="mt-3 flex flex-wrap items-end gap-2">
          <TextInput
            label="Create your first workspace"
            className="w-full max-w-xs"
            required
            maxLength={120}
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={placeholders[Math.floor(Date.now() / 86400000) % placeholders.length]}
            hint="Workspaces group projects, people, and roles."
          />
          <Button type="submit" variant="primary" size="sm" disabled={creating || name.trim().length === 0} icon={creating ? <Loader2 size={14} className="animate-spin" /> : <ChevronRight size={14} />}>
            {creating ? "Creating…" : "Create workspace"}
          </Button>
        </form>
      )}
      {notice && <p className={notice.tone === "success" ? "mt-3 text-xs text-success" : "mt-3 text-xs text-danger"}>{notice.text}</p>}
    </div>
  );
}

export type WorkspaceApiLike = typeof workspaceApi;
