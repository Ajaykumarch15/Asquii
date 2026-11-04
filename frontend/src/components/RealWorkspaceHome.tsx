/**
 * Real-data workspace body for signed-in users.
 *
 * Replaces prototype screens while a session is active so sample records are
 * never mixed with account data. Slice scope: workspace identity, members,
 * and an invitation summary; projects arrive with the next slice.
 */

import { useEffect, useState, type FormEvent } from "react";
import { BriefcaseBusiness, Loader2, Plus, Users } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, LoadingState, TextInput } from "./ui";
import { friendlyError } from "../lib/api/client";
import { workspaceApi, type ApiWorkspace, type ApiWorkspaceMember } from "../lib/api/workspace";
import type { WorkspaceState } from "../lib/real/useRealWorkspaces";

const roleBadgeTone = { Owner: "brand", Admin: "warning", Member: "neutral" } as const;

const placeholderNames = ["Product", "Family", "Engineering", "Operations"];

function invitationSummary(kind: "none" | "loading" | "ready" | "error", pendingCount: number, errorMessage: string | null) {
  if (kind === "none" || kind === "loading") return null;
  if (kind === "error") return <p className="text-xs text-muted">Invitation summary unavailable.</p>;
  return <Badge tone={pendingCount > 0 ? "warning" : "neutral"}>{pendingCount === 0 ? "No pending invitations" : `${pendingCount} pending invitation${pendingCount === 1 ? "" : "s"}`}</Badge>;
}

export function RealWorkspaceHome({ workspaceState, getAccessToken }: {
  workspaceState: WorkspaceState;
  getAccessToken: () => Promise<string | null>;
}) {
  const [members, setMembers] = useState<ApiWorkspaceMember[] | null>(null);
  const [membersState, setMembersState] = useState<"loading" | "ready" | "error">("loading");
  const [invitationsState, setInvitationsState] = useState<"none" | "loading" | "ready" | "error">("loading");
  const [pendingInvites, setPendingInvites] = useState(0);
  const [invitationsError, setInvitationsError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!workspaceState.selected) return;
    const workspaceId = workspaceState.selected.id;
    let disposed = false;
    setMembersState("loading");
    setMembers(null);
    setInvitationsState("loading");

    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const rows = await workspaceApi.listMembers(token, workspaceId);
        if (disposed) return;
        setMembers(rows);
        setMembersState("ready");
      } catch {
        if (!disposed) setMembersState("error");
      }
      try {
        const invites = await workspaceApi.listInvitations(token, workspaceId);
        if (disposed) return;
        setPendingInvites(invites.filter(item => item.status === "pending").length);
        setInvitationsError(null);
        setInvitationsState("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load invitations");
        setInvitationsError(friendly.title);
        setInvitationsState("error");
      }
    })();

    return () => { disposed = true; };
  }, [workspaceState.selected, getAccessToken, reloadToken]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setCreateError("Sign-in session ended. Please sign in again.");
        return;
      }
      const created = await workspaceApi.createWorkspace(token, newName.trim());
      workspaceState.applyWorkspace(created);
      setNewName("");
    } catch (error) {
      const friendly = friendlyError(error, "Could not create workspace");
      setCreateError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setCreating(false);
    }
  }

  if (workspaceState.phase === "loading") {
    return <LoadingState label="Loading your workspace" />;
  }
  if (workspaceState.phase === "error") {
    return (
      <ErrorState
        title="Your workspaces could not be loaded"
        description={workspaceState.errorMessage ?? "Sign in again or retry."}
        action={<Button onClick={workspaceState.reload}>Retry</Button>}
      />
    );
  }
  if (workspaceState.phase === "idle") return null;

  const workspace = workspaceState.selected;
  if (!workspace) {
    // No real workspaces: first-run creation path.
    return (
      <div className="space-y-5">
        <div className="ui-state"><div className="ui-state-mark">✦</div>
          <h3>Create your first workspace</h3>
          <p>Workspaces group projects, people, and roles.</p>
        </div>
        <form onSubmit={submitCreate} className="mx-auto flex max-w-md flex-wrap items-end justify-center gap-2">
          <TextInput
            label="Workspace name"
            required
            maxLength={120}
            value={newName}
            onChange={event => setNewName(event.target.value)}
            placeholder={placeholderNames[Math.floor(Date.now() / 86400000) % placeholderNames.length]}
          />
          <Button type="submit" variant="primary" disabled={creating || newName.trim().length === 0} icon={creating ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
            {creating ? "Creating…" : "Create workspace"}
          </Button>
        </form>
        {createError && <p className="mx-auto max-w-md text-xs text-danger">{createError}</p>}
      </div>
    );
  }

  const isAdmin = workspace.role === "Owner" || workspace.role === "Admin";

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-lg font-semibold text-white"><BriefcaseBusiness size={20} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight">{workspace.name}</h1>
            <p className="mt-0.5 text-xs text-muted">asquii.com/{workspace.slug}</p>
          </div>
          <Badge tone={roleBadgeTone[workspace.role]}>{workspace.role}</Badge>
          {invitationSummary(invitationsState === "ready" ? "ready" : invitationsState === "error" ? "error" : "loading", pendingInvites, invitationsError)}
        </div>
      </div>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-heading"><Users size={15} className="text-muted" />People ({members?.length ?? 0})</h2>
        </div>
        {membersState === "loading" && <LoadingState label="Loading people" />}
        {membersState === "error" && (
          <ErrorState
            title="People could not be loaded"
            description="Membership details are temporarily unavailable."
            action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>}
          />
        )}
        {membersState === "ready" && members && (
          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {members.map(member => (
              <li key={member.user_id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-hover text-[10px] font-semibold text-secondary">
                  {member.display_name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-heading">{member.display_name}</span>
                  <span className="block truncate text-[10px] text-muted">{member.job_title ?? "No title yet"}</span>
                </span>
                <Badge tone={roleBadgeTone[member.role as keyof typeof roleBadgeTone] ?? "neutral"}>{member.role}</Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-heading">Projects</h2>
        <EmptyState
          title="No projects yet"
          description={isAdmin ? "Project creation arrives in the next integration slice." : "A workspace Owner or Admin sets up projects."}
        />
        {isAdmin && invitationsState === "ready" && (
          <p className="text-xs text-muted">Suggest this workspace by inviting people through the workspace switcher in an upcoming slice.</p>
        )}
      </section>
    </div>
  );
}
