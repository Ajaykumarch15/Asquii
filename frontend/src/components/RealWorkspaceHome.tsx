/**
 * Real-data workspace body for signed-in users.
 *
 * Replaces prototype screens while a session is active so sample records are
 * never mixed with account data. Slice scope: workspace identity, members,
 * invitations (create/list/revoke/accept), and project entry points.
 */

import { useEffect, useState, type FormEvent } from "react";
import { BriefcaseBusiness, Copy, Loader2, Plus, Trash2, Users } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, LoadingState, Select, TextInput } from "./ui";
import { friendlyError } from "../lib/api/client";
import { workspaceApi, type ApiInvitation, type ApiWorkspace, type ApiWorkspaceMember } from "../lib/api/workspace";
import type { WorkspaceState } from "../lib/real/useRealWorkspaces";

const roleBadgeTone = { Owner: "brand", Admin: "warning", Member: "neutral" } as const;
const inviteStatusTone: Record<ApiInvitation["status"], "warning" | "success" | "neutral" | "danger"> = {
  pending: "warning",
  accepted: "success",
  expired: "neutral",
  revoked: "danger",
};

const placeholderNames = ["Product", "Family", "Engineering", "Operations"];

function readInviteToken(): string | null {
  const token = new URLSearchParams(window.location.search).get("invite");
  return token && token.length >= 32 && token.length <= 512 ? token : null;
}

function shortDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function RealWorkspaceHome({ workspaceState, getAccessToken }: {
  workspaceState: WorkspaceState;
  getAccessToken: () => Promise<string | null>;
}) {
  const [members, setMembers] = useState<ApiWorkspaceMember[] | null>(null);
  const [membersState, setMembersState] = useState<"loading" | "ready" | "error">("loading");
  const [invitationsState, setInvitationsState] = useState<"none" | "loading" | "ready" | "error">("loading");
  const [invitations, setInvitations] = useState<ApiInvitation[]>([]);
  const [inviteFormOpen, setInviteFormOpen] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"Admin" | "Member">("Member");
  const [inviteSubmitting, setInviteSubmitting] = useState(false);
  const [inviteFormError, setInviteFormError] = useState<string | null>(null);
  const [createdToken, setCreatedToken] = useState<{ email: string; token: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
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
        setInvitations(invites);
        setInvitationsState("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load invitations");
        setInvitationsState("error");
        setNotice({ tone: "error", text: `Invitations unavailable: ${friendly.message}` });
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

  async function submitInvite(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setInviteSubmitting(true);
    setInviteFormError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setInviteFormError("Sign-in session ended. Please sign in again.");
        return;
      }
      const created = await workspaceApi.createInvitation(token, workspace.id, {
        email: inviteEmail.trim().toLowerCase(),
        role: inviteRole,
      });
      setInvitations(previous => [created, ...previous]);
      setCreatedToken({ email: created.email, token: created.token });
      setCopied(false);
      setInviteEmail("");
      setInviteFormOpen(false);
      setNotice({ tone: "success", text: `Invitation for ${created.email} created.` });
    } catch (error) {
      const friendly = friendlyError(error, "Could not create invitation");
      setInviteFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setInviteSubmitting(false);
    }
  }

  async function revokeInvite(invitation: ApiInvitation) {
    if (!workspace) return;
    if (!window.confirm(`Revoke the invitation for ${invitation.email}?`)) return;
    setInvitations(previous => previous.map(item => (item.id === invitation.id ? { ...item, status: "revoked" } : item)));
    try {
      const token = await getAccessToken();
      if (!token) return;
      await workspaceApi.revokeInvitation(token, workspace.id, invitation.id);
      setNotice({ tone: "success", text: `Invitation for ${invitation.email} revoked.` });
    } catch (error) {
      const friendly = friendlyError(error, "Could not revoke invitation");
      setNotice({ tone: "error", text: `${friendly.title}: ${friendly.message}` });
      setReloadToken(value => value + 1);
    }
  }

  async function copyToken(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
    } catch {
      // Clipboard access denied (insecure context); the token stays visible.
      setNotice({ tone: "error", text: "Copy failed — select the token text manually." });
    }
  }

  async function acceptInvite(token: string) {
    setNotice(null);
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) {
        setNotice({ tone: "error", text: "Sign-in session ended. Please sign in again." });
        return;
      }
      const accepted = await workspaceApi.acceptInvitation(accessToken, token);
      window.history.replaceState(null, "", window.location.pathname);
      await workspaceState.reload();
      setNotice({ tone: "success", text: `Invitation accepted — you joined as ${accepted.role === "Admin" ? "an Admin" : "a Member"}.` });
    } catch (error) {
      const friendly = friendlyError(error, "Could not accept invitation");
      setNotice({ tone: "error", text: `${friendly.title}: ${friendly.message}` });
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
  const pendingCount = invitations.filter(item => item.status === "pending").length;
  const inviteToken = readInviteToken();

  return (
    <div className="space-y-6">
      {notice && (
        <div role="status" className={`rounded-xl border border-line px-4 py-3 text-xs font-medium ${notice.tone === "success" ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>
          {notice.text}
        </div>
      )}
      {inviteToken && (
        <div className="rounded-xl border border-line bg-warning-soft px-4 py-3">
          <p className="text-xs font-semibold text-heading">You have a workspace invitation</p>
          <p className="mt-1 text-xs text-muted">Accepting joins you at the invited role.</p>
          <Button variant="primary" size="sm" className="mt-2" icon={<Users size={14} />} onClick={() => void acceptInvite(inviteToken)}>
            Accept invitation
          </Button>
        </div>
      )}
      <div className="rounded-2xl border border-line bg-surface p-5 sm:p-6">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid h-12 w-12 place-items-center rounded-2xl bg-brand text-lg font-semibold text-white"><BriefcaseBusiness size={20} /></span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-bold tracking-tight">{workspace.name}</h1>
            <p className="mt-0.5 text-xs text-muted">asquii.com/{workspace.slug}</p>
          </div>
          <Badge tone={roleBadgeTone[workspace.role]}>{workspace.role}</Badge>
          {invitationsState === "ready" && <Badge tone={pendingCount > 0 ? "warning" : "neutral"}>{pendingCount === 0 ? "No pending invitations" : `${pendingCount} pending invitation${pendingCount === 1 ? "" : "s"}`}</Badge>}
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
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-heading">Invitations</h2>
          {isAdmin && invitationsState === "ready" && (
            <Button size="sm" icon={inviteFormOpen ? <Users size={14} /> : <Plus size={14} />} onClick={() => { setInviteFormOpen(open => !open); setCreatedToken(null); }}>
              {inviteFormOpen ? "Cancel" : "Invite person"}
            </Button>
          )}
        </div>

        {invitationsState === "loading" && <LoadingState label="Loading invitations" />}
        {invitationsState === "error" && (
          <ErrorState
            title="Invitations could not be loaded"
            description="The invitation list is temporarily unavailable."
            action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>}
          />
        )}

        {invitationsState === "ready" && isAdmin && inviteFormOpen && (
          <form onSubmit={submitInvite} className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
            <TextInput label="Email" required type="email" maxLength={320} className="min-w-0 flex-1" value={inviteEmail} onChange={event => setInviteEmail(event.target.value)} placeholder="teammate@example.com" />
            <Select label="Role" className="w-40" value={inviteRole} onChange={event => setInviteRole(event.target.value as "Admin" | "Member")}>
              <option value="Member">Member</option>
              <option value="Admin">Admin</option>
            </Select>
            <Button type="submit" variant="primary" size="sm" disabled={inviteSubmitting} icon={inviteSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
              {inviteSubmitting ? "Sending…" : "Create invitation"}
            </Button>
            {inviteFormError && <p className="w-full text-xs text-danger">{inviteFormError}</p>}
          </form>
        )}

        {createdToken && (
          <div className="rounded-xl border border-line bg-brand-soft p-4">
            <p className="text-xs font-semibold text-brand">Invitation for {createdToken.email} is ready.</p>
            <p className="mt-1 text-[10px] text-muted">Email delivery is not wired yet — copy the token and share it. The invitee opens the app signed in as that email with <code>?invite=&lt;token&gt;</code>.</p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <code className="max-w-full flex-1 truncate rounded-lg border border-line bg-surface px-2 py-1.5 text-[10px]">{createdToken.token}</code>
              <Button size="sm" icon={<Copy size={13} />} onClick={() => void copyToken(createdToken.token)}>
                {copied ? "Copied" : "Copy token"}
              </Button>
            </div>
          </div>
        )}

        {invitationsState === "ready" && invitations.length === 0 && (
          <EmptyState title="No invitations" description={isAdmin ? "Invite teammates to collaborate in this workspace." : "Workspace admins invite new teammates — ask them for an invitation."} />
        )}

        {invitationsState === "ready" && invitations.length > 0 && (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {invitations.map(invitation => (
              <li key={invitation.id} className="flex flex-wrap items-center gap-3 p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="truncate text-xs font-semibold text-heading">{invitation.email}</p>
                    <Badge tone={inviteStatusTone[invitation.status]}>{invitation.status}</Badge>
                    <Badge tone={invitation.role === "Admin" ? "warning" : "neutral"}>{invitation.role}</Badge>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted">Created {shortDate(invitation.created_at)} · Expires {shortDate(invitation.expires_at)}</p>
                </div>
                {isAdmin && invitation.status === "pending" && (
                  <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} aria-label={`Revoke invitation for ${invitation.email}`} onClick={() => void revokeInvite(invitation)}>
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-heading">Projects</h2>
        <EmptyState
          title="No projects yet"
          description={isAdmin ? "Create the first project from the Projects page in the sidebar." : "A workspace Owner or Admin sets up projects."}
        />
      </section>
    </div>
  );
}
