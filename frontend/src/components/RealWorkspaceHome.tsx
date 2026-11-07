/**
 * Real-data workspace body for signed-in users.
 *
 * Replaces prototype screens while a session is active so sample records are
 * never mixed with account data. Slice scope: workspace identity, members
 * (role change, removal, self-leave), invitations (create/list/revoke/accept),
 * workspace settings (rename, archive), and project entry points.
 */

import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { AlertCircle, Archive, ArrowRight, ArrowUpRight, BriefcaseBusiness, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, Copy, Crown, Download, FileText, FolderKanban, Gauge, Loader2, Mail, Pencil, Plus, Search, Trash2, Users } from "lucide-react";
import { AvatarGroup, Badge, Button, EmptyState, ErrorState, LoadingState, Select, Tabs, Textarea, TextInput } from "./ui";
import { friendlyError } from "../lib/api/client";
import { activitiesApi, activityText, type ApiActivity } from "../lib/api/activities";
import {
  projectsApi,
  type ApiMilestone,
  type ApiProject,
  type ApiProjectMember,
  type ApiProjectStatus,
  type ApiProgressMode,
  type ApiResource,
  type ApiTask,
} from "../lib/api/projects";
import { workspaceApi, type ApiInvitation, type ApiWorkspace, type ApiWorkspaceMember, type EditableWorkspaceRole } from "../lib/api/workspace";
import type { WorkspaceState } from "../lib/real/useRealWorkspaces";

const roleBadgeTone = { Owner: "brand", Admin: "warning", Member: "neutral" } as const;
const PROJECT_STATUSES: ApiProjectStatus[] = ["In progress", "In review", "Complete"];
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

function shortDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Feed page size: one screen of events plus explicit "Load more" paging. */
const ACTIVITY_PAGE_SIZE = 8;

/**
 * Dashboard aggregation budget. The backend has no workspace-wide analytics
 * endpoint, so progress/health come from per-project task lists; cap how many
 * projects are profiled to keep the dashboard fetch bounded.
 */
const MAX_DASHBOARD_PROJECTS = 20;
const FEATURED_PROJECTS = 5;

type WorkspaceDetail = {
  tasks: Record<string, ApiTask[]>;
  milestones: Record<string, ApiMilestone[]>;
  projectMembers: Record<string, ApiProjectMember[]>;
  resources: ApiResource[];
};

type ProjectHealth = "At risk" | "Needs attention" | "On track";

const healthTone: Record<ProjectHealth, "danger" | "warning" | "success"> = {
  "At risk": "danger",
  "Needs attention": "warning",
  "On track": "success",
};

/** Prototype parity (model.ts teamFor): bucket member job titles for the Teams metric. */
const teamFor = (jobTitle: string) =>
  /design|product|ux|research/i.test(jobTitle) ? "Product & UX"
    : /qa|test/i.test(jobTitle) ? "QA & Testing"
      : /engineer|develop|backend|frontend|engineering/i.test(jobTitle) ? "Engineering"
        : "Operations";

function startOfToday() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

/** Mirrors model.ts projectProgress against real task rows. */
function progressFor(project: ApiProject, tasks: ApiTask[]) {
  if (project.progress_mode === "manual") return project.manual_progress ?? 0;
  if (tasks.length === 0) return 0;
  return Math.round((tasks.filter(task => task.status === "Complete").length / tasks.length) * 100);
}

/** Mirrors model.ts projectHealth against real task rows. */
function healthFor(tasks: ApiTask[]): ProjectHealth {
  if (tasks.some(task =>
    task.status !== "Complete" &&
    task.due_date !== null &&
    new Date(`${task.due_date}T00:00:00`) < startOfToday(),
  )) return "At risk";
  if (tasks.some(task => task.status === "In review")) return "Needs attention";
  return "On track";
}

export function RealWorkspaceHome({ workspaceState, getAccessToken, identityUserId, onOpenProject, onViewProjects, onViewPeople, section = "home" }: {
  workspaceState: WorkspaceState;
  getAccessToken: () => Promise<string | null>;
  /** Signed-in user's id; used to distinguish "Leave" from "Remove" in the people list. */
  identityUserId: string;
  /** Drill into a project from the home overview (switches to the Projects route). */
  onOpenProject: (projectId: string) => void;
  /** Header/panel buttons that jump to the workspace Projects page. */
  onViewProjects: () => void;
  /** Header "Invite people" — jumps to the workspace People page. */
  onViewPeople: () => void;
  /** "people"/"settings" render just that sidebar page; "home" is the full overview. */
  section?: "home" | "people" | "settings";
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
  const [renameName, setRenameName] = useState("");
  const [renameSubmitting, setRenameSubmitting] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  // People section view state (prototype PeoplePage parity): tabs, filters,
  // pagination, and Owner-only bulk role selection.
  const [peopleTab, setPeopleTab] = useState<"members" | "invitations" | "roles">("members");
  const [peopleSearch, setPeopleSearch] = useState("");
  const [peopleRoleFilter, setPeopleRoleFilter] = useState("all");
  const [peopleProjectFilter, setPeopleProjectFilter] = useState("all");
  const [peoplePage, setPeoplePage] = useState(1);
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([]);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [busyMemberId, setBusyMemberId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  // Activity feed doubles as the notification surface: the backend has no
  // notifications table, so everyone reads the workspace activity log.
  const [activities, setActivities] = useState<ApiActivity[] | null>(null);
  const [activityTotal, setActivityTotal] = useState(0);
  const [activityState, setActivityState] = useState<"loading" | "ready" | "error">("loading");
  const [activityLoadingMore, setActivityLoadingMore] = useState(false);
  // Projects: real list + Owner/Admin creation form (backend gates creation to
  // workspace Owner/Admin and makes the creator Project Manager).
  const [projects, setProjects] = useState<ApiProject[] | null>(null);
  const [projectsState, setProjectsState] = useState<"loading" | "ready" | "error">("loading");
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [projectDescription, setProjectDescription] = useState("");
  const [projectStatus, setProjectStatus] = useState<ApiProjectStatus>("In progress");
  const [projectProgressMode, setProjectProgressMode] = useState<ApiProgressMode>("auto");
  const [projectManualProgress, setProjectManualProgress] = useState(0);
  const [projectSubmitting, setProjectSubmitting] = useState(false);
  const [projectFormError, setProjectFormError] = useState<string | null>(null);
  // Dashboard detail: per-project tasks/milestones/members plus merged
  // resources, keyed by project id (the members endpoint rows lack project_id).
  const [detail, setDetail] = useState<WorkspaceDetail | null>(null);

  useEffect(() => {
    if (!workspaceState.selected) return;
    const workspaceId = workspaceState.selected.id;
    // Members get 403 from GET /invitations; skip the call instead of
    // surfacing an "invitations unavailable" error for a feature they
    // cannot use anyway.
    const canSeeInvitations = workspaceState.selected.role === "Owner" || workspaceState.selected.role === "Admin";
    let disposed = false;
    setMembersState("loading");
    setMembers(null);
    setInvitationsState(canSeeInvitations ? "loading" : "ready");
    if (!canSeeInvitations) setInvitations([]);
    setActivityState("loading");
    setActivities(null);
    setProjectsState(previous => (previous === "ready" ? previous : "loading"));

    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      // The four reads run concurrently: chaining them serially multiplied the
      // load time by the number of round trips (members → invitations →
      // projects → activity). Per-read try/catch keeps the original failure
      // semantics — one dataset failing never takes the others down.
      const loadMembers = async () => {
        try {
          const rows = await workspaceApi.listMembers(token, workspaceId);
          if (disposed) return;
          setMembers(rows);
          setMembersState("ready");
        } catch {
          if (!disposed) setMembersState("error");
        }
      };
      const loadInvitations = async () => {
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
      };
      const loadProjects = async () => {
        try {
          const rows = await projectsApi.listProjects(token, workspaceId, { limit: 50 });
          if (disposed) return;
          setProjects(rows);
          setProjectsState("ready");
        } catch (error) {
          if (disposed) return;
          const friendly = friendlyError(error, "Could not load projects");
          setProjectsState("error");
          setNotice({ tone: "error", text: `Projects unavailable: ${friendly.message}` });
        }
      };
      const loadActivities = async () => {
        try {
          const page = await activitiesApi.listWorkspaceActivities(token, workspaceId, { limit: ACTIVITY_PAGE_SIZE });
          if (disposed) return;
          setActivities(page.items);
          setActivityTotal(page.total);
          setActivityState("ready");
        } catch (error) {
          if (disposed) return;
          const friendly = friendlyError(error, "Could not load activity");
          setActivityState("error");
          setNotice({ tone: "error", text: `Recent activity unavailable: ${friendly.message}` });
        }
      };
      await Promise.all([
        loadMembers(),
        canSeeInvitations ? loadInvitations() : Promise.resolve(),
        loadProjects(),
        loadActivities(),
      ]);
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
      setReloadToken(value => value + 1); // refresh the activity feed too
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
      setReloadToken(value => value + 1); // refresh the activity feed too
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

  async function changeRole(member: ApiWorkspaceMember, role: EditableWorkspaceRole) {
    if (!workspace) return;
    if (!window.confirm(`Change ${member.display_name}'s role from ${member.role} to ${role}?`)) return;
    setBusyMemberId(member.user_id);
    // Optimistically reflect the new role; roll back if the backend refuses.
    setMembers(previous => (previous ?? []).map(row => (row.user_id === member.user_id ? { ...row, role } : row)));
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      await workspaceApi.updateMemberRole(token, workspace.id, member.user_id, role);
      setNotice({ tone: "success", text: `${member.display_name} is now ${role === "Admin" ? "an Admin" : "a Member"}.` });
      setReloadToken(value => value + 1); // refresh the activity feed too
    } catch (error) {
      const friendly = friendlyError(error, "Could not change the role");
      setNotice({ tone: "error", text: `${friendly.title}: ${friendly.message}` });
      setMembers(previous => (previous ?? []).map(row => (row.user_id === member.user_id ? { ...row, role: member.role } : row)));
      setReloadToken(value => value + 1);
    } finally {
      setBusyMemberId(null);
    }
  }

  /**
   * Owner-only bulk role change (the backend role endpoint is owner-only).
   * Runs sequentially and reports per-member failures; the server is the
   * source of truth for rules like the last-admin rejection.
   */
  async function bulkChangeRole(next: EditableWorkspaceRole) {
    if (!workspace || selectedMemberIds.length === 0) return;
    setBulkBusy(true);
    const failures: string[] = [];
    let changed = 0;
    try {
      for (const userId of selectedMemberIds) {
        const member = (members ?? []).find(row => row.user_id === userId);
        if (!member || member.role === next || member.role === "Owner") continue;
        try {
          const token = await getAccessToken();
          if (!token) throw new Error("Sign-in session ended. Please sign in again.");
          await workspaceApi.updateMemberRole(token, workspace.id, member.user_id, next);
          changed += 1;
        } catch {
          failures.push(member.display_name);
        }
      }
    } finally {
      if (changed > 0 || failures.length > 0) setReloadToken(value => value + 1);
      setNotice({
        tone: failures.length === 0 ? "success" : "error",
        text: failures.length === 0
          ? `Updated ${changed} member${changed === 1 ? "" : "s"} to ${next === "Admin" ? "Admin" : "Member"}.`
          : `Updated ${changed}, could not update: ${failures.join(", ")}.`,
      });
      setSelectedMemberIds([]);
      setBulkBusy(false);
    }
  }

  async function removeMemberAction(member: ApiWorkspaceMember) {
    if (!workspace) return;
    const selfRemoval = member.user_id === identityUserId;
    const confirmed = selfRemoval
      ? window.confirm(`Leave "${workspace.name}"? You lose access to its projects until an admin invites you again.`)
      : window.confirm(`Remove ${member.display_name} from the workspace? They lose access until invited again.`);
    if (!confirmed) return;
    setBusyMemberId(member.user_id);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      await workspaceApi.removeMember(token, workspace.id, member.user_id);
      if (selfRemoval) {
        // The workspace disappears from this account's list; the shell reselects.
        setNotice({ tone: "success", text: `You left ${workspace.name}.` });
        workspaceState.reload();
      } else {
        setNotice({ tone: "success", text: `${member.display_name} removed from the workspace.` });
        setReloadToken(value => value + 1);
      }
    } catch (error) {
      const friendly = friendlyError(error, selfRemoval ? "Could not leave the workspace" : "Could not remove the member");
      setNotice({ tone: "error", text: `${friendly.title}: ${friendly.message}` });
      setReloadToken(value => value + 1);
    } finally {
      setBusyMemberId(null);
    }
  }

  async function submitRename(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    const name = renameName.trim();
    if (!name || name === workspace.name) return;
    setRenameSubmitting(true);
    setRenameError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setRenameError("Sign-in session ended. Please sign in again.");
        return;
      }
      const updated = await workspaceApi.renameWorkspace(token, workspace.id, name);
      workspaceState.applyWorkspace(updated);
      setRenameName(updated.name);
      setNotice({ tone: "success", text: `Workspace renamed to ${updated.name}.` });
      setReloadToken(value => value + 1); // refresh the activity feed too
    } catch (error) {
      const friendly = friendlyError(error, "Could not rename the workspace");
      setRenameError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setRenameSubmitting(false);
    }
  }

  async function archiveCurrent() {
    if (!workspace) return;
    if (!window.confirm(`Archive "${workspace.name}"? It is hidden from every member and cannot be reopened from the app.`)) return;
    setArchiving(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      await workspaceApi.archiveWorkspace(token, workspace.id);
      // No resume endpoint: the workspace must drop out of the account's list.
      setNotice({ tone: "success", text: `${workspace.name} archived. Pending invitations were revoked.` });
      workspaceState.reload();
    } catch (error) {
      const friendly = friendlyError(error, "Could not archive the workspace");
      setNotice({ tone: "error", text: `${friendly.title}: ${friendly.message}` });
    } finally {
      setArchiving(false);
    }
  }

  async function submitCreateProject(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setProjectSubmitting(true);
    setProjectFormError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setProjectFormError("Sign-in session ended. Please sign in again.");
        return;
      }
      const created = await projectsApi.createProject(token, workspace.id, {
        name: projectName.trim(),
        description: projectDescription.trim(),
        status: projectStatus,
        progress_mode: projectProgressMode,
        manual_progress: projectProgressMode === "manual" ? projectManualProgress : undefined,
      });
      setProjects(previous => [...(previous ?? []), created]);
      setNotice({ tone: "success", text: `Project "${created.name}" created — you are its Project Manager.` });
      setProjectName("");
      setProjectDescription("");
      setProjectStatus("In progress");
      setProjectProgressMode("auto");
      setProjectManualProgress(0);
      setProjectFormOpen(false);
      setReloadToken(value => value + 1); // refresh the activity feed too
    } catch (error) {
      const friendly = friendlyError(error, "Could not create the project");
      setProjectFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setProjectSubmitting(false);
    }
  }

  // Project rows belong to one workspace; drop them on switch so another
  // workspace's list never flashes while the new fetch is in flight.
  useEffect(() => {
    setProjects(null);
    setProjectsState("loading");
    setProjectFormOpen(false);
    setProjectFormError(null);
    setDetail(null);
  }, [workspaceState.selected?.id]);

  // Dashboard session: per-project tasks for the first MAX_DASHBOARD_PROJECTS
  // non-archived projects (the stats cap), plus milestones/members/resources
  // only for the FEATURED projects that render them — the per-project burst is
  // what the DB connection pool has to absorb, so it is kept as small as the
  // visible data allows. Each lookup is independent, so failures degrade per
  // project rather than taking the whole dashboard down.
  useEffect(() => {
    if (projectsState !== "ready" || !projects) return;
    const workspaceId = workspaceState.selected?.id;
    if (!workspaceId) return;
    const targets = projects.filter(project => !project.archived_at).slice(0, MAX_DASHBOARD_PROJECTS);
    const featured = targets.slice(0, FEATURED_PROJECTS);
    if (targets.length === 0) {
      setDetail({ tasks: {}, milestones: {}, projectMembers: {}, resources: [] });
      return;
    }
    let disposed = false;
    void (async () => {
      const token = await getAccessToken();
      if (!token) return; // detached from shell data; by design for this read
      const [taskResults, milestoneResults, memberResults, resourceResults] = await Promise.all([
        Promise.allSettled(targets.map(project => projectsApi.listTasks(token, workspaceId, project.id, { limit: 100 }))),
        Promise.allSettled(featured.map(project => projectsApi.listMilestones(token, workspaceId, project.id))),
        Promise.allSettled(featured.map(project => projectsApi.listProjectMembers(token, workspaceId, project.id))),
        Promise.allSettled(featured.map(project => projectsApi.listResources(token, workspaceId, project.id, { limit: 10 }))),
      ]);
      if (disposed) return;
      const tasks: Record<string, ApiTask[]> = {};
      const milestones: Record<string, ApiMilestone[]> = {};
      const projectMembers: Record<string, ApiProjectMember[]> = {};
      const resources: ApiResource[] = [];
      targets.forEach((project, index) => {
        const taskPage = taskResults[index];
        if (taskPage.status === "fulfilled") tasks[project.id] = taskPage.value;
      });
      featured.forEach((project, index) => {
        const milestonePage = milestoneResults[index];
        if (milestonePage.status === "fulfilled") milestones[project.id] = milestonePage.value;
        const memberPage = memberResults[index];
        if (memberPage.status === "fulfilled") projectMembers[project.id] = memberPage.value;
        const resourcePage = resourceResults[index];
        if (resourcePage.status === "fulfilled") resources.push(...resourcePage.value);
      });
      setDetail({ tasks, milestones, projectMembers, resources });
    })();
    return () => { disposed = true; };
  }, [workspaceState.selected?.id, projects, projectsState, getAccessToken, reloadToken]);

  // Workspace analytics mirror the prototype overview's math (model.ts
  // projectProgress/projectHealth) but always recompute from real rows.
  const analytics = useMemo(() => {
    if (!detail) return null;
    const activeProjects = (projects ?? []).filter(project => !project.archived_at).slice(0, MAX_DASHBOARD_PROJECTS);
    const rows = activeProjects.map(project => {
      const tasks = detail.tasks[project.id] ?? [];
      return { project, progress: progressFor(project, tasks), health: healthFor(tasks) };
    });
    const tasks = rows.flatMap(row => detail.tasks[row.project.id] ?? []);
    const openTasks = tasks.filter(task => task.status !== "Complete");
    const today = startOfToday();
    return {
      rows,
      taskCount: tasks.length,
      completed: tasks.filter(task => task.status === "Complete").length,
      inProgress: tasks.filter(task => task.status === "In progress").length,
      todo: tasks.filter(task => task.status === "To do" || task.status === "Backlog").length,
      overdue: openTasks.filter(task => task.due_date !== null && new Date(`${task.due_date}T00:00:00`) < today).length,
      open: openTasks.length,
      overall: rows.length ? Math.round(rows.reduce((sum, row) => sum + row.progress, 0) / rows.length) : 0,
      teams: new Set((members ?? []).filter(member => member.job_title).map(member => teamFor(member.job_title as string))).size,
      featured: rows.slice(0, FEATURED_PROJECTS),
      activeRows: rows.slice(0, FEATURED_PROJECTS).map(row => ({
        project: row.project,
        progress: row.progress,
        members: (detail.projectMembers[row.project.id] ?? []).map(member => member.display_name),
        nextMilestone: [...(detail.milestones[row.project.id] ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null,
      })),
      resources: detail.resources
        .slice()
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 4),
    };
  }, [detail, projects, members]);

  // Keep the rename field aligned with the currently selected workspace.
  useEffect(() => {
    setRenameName(workspaceState.selected?.name ?? "");
    setRenameError(null);
  }, [workspaceState.selected?.id, workspaceState.selected?.name]);

  async function loadMoreActivity() {
    const workspace = workspaceState.selected;
    if (!workspace || activities === null) return;
    setActivityLoadingMore(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      const page = await activitiesApi.listWorkspaceActivities(token, workspace.id, {
        limit: ACTIVITY_PAGE_SIZE,
        offset: activities.length,
      });
      setActivities(previous => [...(previous ?? []), ...page.items]);
      setActivityTotal(page.total);
    } catch (error) {
      const friendly = friendlyError(error, "Could not load activity");
      setNotice({ tone: "error", text: `Could not load more activity: ${friendly.message}` });
    } finally {
      setActivityLoadingMore(false);
    }
  }

  // The notice must survive paths that unmount the workspace body (e.g. the
  // first-run create form shown right after archiving the only workspace).
  const noticeBlock = notice && (
    <div role="status" className={`rounded-xl border border-line px-4 py-3 text-xs font-medium ${notice.tone === "success" ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>
      {notice.text}
    </div>
  );

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

  // Derived flags shared by the workspace and first-run paths; must be declared
  // before the early returns that consume them.
  const inviteToken = readInviteToken();
  const workspace = workspaceState.selected;
  if (!workspace) {
    // No real workspaces: first-run creation path.
    return (
      <div className="space-y-5">
        {noticeBlock}
        {inviteToken && (
          <div className="rounded-xl border border-line bg-warning-soft px-4 py-3">
            <p className="text-xs font-semibold text-heading">You have a workspace invitation</p>
            <p className="mt-1 text-xs text-muted">Accepting joins you at the invited role — no workspace of your own needed.</p>
            <Button variant="primary" size="sm" className="mt-2" icon={<Users size={14} />} onClick={() => void acceptInvite(inviteToken)}>
              Accept invitation
            </Button>
          </div>
        )}
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
  const isOwner = workspace.role === "Owner";

  // People section derivation (prototype PeoplePage parity, real data).
  // project/open-task counts reuse the dashboard detail budget (first
  // MAX_DASHBOARD_PROJECTS projects) — no extra requests.
  const sortedMembers = [...(members ?? [])].sort((a, b) => a.display_name.localeCompare(b.display_name));
  const admins = sortedMembers.filter(member => member.role === "Admin");
  const owners = sortedMembers.filter(member => member.role === "Owner");
  const pendingInviteCount = invitations.filter(invitation => invitation.status === "pending").length;
  const profiles = detail?.projectMembers ?? {};
  const projectCountFor = (userId: string) => Object.values(profiles).filter(rows => rows.some(row => row.user_id === userId)).length;
  const projectNamesForMember = (userId: string) => Object.entries(profiles).filter(([, rows]) => rows.some(row => row.user_id === userId)).map(([projectId]) => (projects ?? []).find(project => project.id === projectId)?.name).filter((name): name is string => Boolean(name));
  const openTasksFor = (userId: string) => Object.values(detail?.tasks ?? {}).reduce((total, rows) => total + rows.filter(task => task.assignee_user_id === userId && task.status !== "Complete").length, 0);
  const projectMemberCount = sortedMembers.filter(member => projectCountFor(member.user_id) > 0).length;
  const profileCapped = (projects ?? []).length > MAX_DASHBOARD_PROJECTS;
  const peopleFiltered = sortedMembers.filter(member =>
    `${member.display_name} ${member.job_title ?? ""}`.toLowerCase().includes(peopleSearch.trim().toLowerCase())
    && (peopleRoleFilter === "all" || member.role === peopleRoleFilter)
    && (peopleProjectFilter === "all" || (profiles[peopleProjectFilter]?.some(row => row.user_id === member.user_id) ?? false)));
  const PEOPLE_PAGE_SIZE = 6;
  const peoplePageCount = Math.max(1, Math.ceil(peopleFiltered.length / PEOPLE_PAGE_SIZE));
  const currentPeoplePage = Math.min(peoplePage, peoplePageCount);
  const peopleRows = peopleFiltered.slice((currentPeoplePage - 1) * PEOPLE_PAGE_SIZE, currentPeoplePage * PEOPLE_PAGE_SIZE);
  const jobTitleCounts = [...new Set(sortedMembers.filter(member => member.job_title).map(member => member.job_title as string))]
    .map(title => ({ title, count: sortedMembers.filter(member => member.job_title === title).length }))
    .sort((a, b) => b.count - a.count || a.title.localeCompare(b.title));
  const peopleTabs = [`Members (${members?.length ?? 0})`, `Invitations (${invitations.length})`, "Roles & access"] as const;
  const peopleProfileNote = profileCapped ? `Project and open-task counts cover the first ${MAX_DASHBOARD_PROJECTS} projects.` : null;

  function toggleAllVisible(checked: boolean) {
    setSelectedMemberIds(previous => checked
      ? [...new Set([...previous, ...peopleRows.filter(member => member.role !== "Owner").map(member => member.user_id)])]
      : previous.filter(id => !peopleRows.some(member => member.user_id === id)));
  }

  function exportPeopleCsv() {
    const lines = [["Member", "Job title", "Workspace role", "Projects", "Open tasks"], ...peopleFiltered.map(member => [
      member.display_name,
      member.job_title ?? "",
      member.role,
      String(projectCountFor(member.user_id)),
      String(openTasksFor(member.user_id)),
    ])];
    const csv = lines.map(line => line.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    link.download = "workspace-members.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  return (
    <div className="space-y-6">
      {noticeBlock}
      {inviteToken && (
        <div className="rounded-xl border border-line bg-warning-soft px-4 py-3">
          <p className="text-xs font-semibold text-heading">You have a workspace invitation</p>
          <p className="mt-1 text-xs text-muted">Accepting joins you at the invited role.</p>
          <Button variant="primary" size="sm" className="mt-2" icon={<Users size={14} />} onClick={() => void acceptInvite(inviteToken)}>
            Accept invitation
          </Button>
        </div>
      )}
      <section className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand text-sm font-semibold text-white">
            {workspace.name.split(/\s+/).map(part => part[0]).join("").slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight text-heading">{workspace.name}</h1>
              <Badge tone={roleBadgeTone[workspace.role]}>{workspace.role}</Badge>
            </div>
            <p className="mt-1 truncate text-xs text-muted">asquii.com/{workspace.slug} · Workspace overview across your projects.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {members && members.length > 0 && <AvatarGroup names={members.map(member => member.display_name)} />}
          <Button variant="secondary" size="sm" icon={<Mail size={14} />} onClick={onViewPeople}>Invite people</Button>
          {isAdmin && section === "home" && (
            <Button
              variant="primary"
              size="sm"
              icon={<Plus size={14} />}
              onClick={() => { setProjectFormOpen(open => !open); setProjectFormError(null); }}
            >
              {projectFormOpen ? "Cancel" : "New project"}
            </Button>
          )}
        </div>
      </section>

      {section === "settings" && (
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-heading">Workspace settings</h2>
        {(isAdmin || isOwner) && (
          <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
            {isAdmin && (
              <form onSubmit={submitRename} className="flex flex-wrap items-end gap-2">
                <div className="min-w-0 flex-1">
                  <TextInput
                    label="Workspace name"
                    required
                    maxLength={120}
                    className="w-full"
                    value={renameName}
                    onChange={event => setRenameName(event.target.value)}
                    icon={<Pencil size={13} />}
                  />
                  <p className="mt-1 text-[10px] text-muted">Shared URL is asquii.com/{workspace.slug} — the slug is set at creation and stays stable when renamed.</p>
                </div>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={renameSubmitting || !renameName.trim() || renameName.trim() === workspace.name}
                  icon={renameSubmitting ? <Loader2 size={14} className="animate-spin" /> : undefined}
                >
                  {renameSubmitting ? "Saving…" : "Save name"}
                </Button>
                {renameError && <p className="w-full text-xs text-danger">{renameError}</p>}
              </form>
            )}
            {isOwner && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line p-3">
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold text-heading">Archive this workspace</p>
                  <p className="mt-0.5 text-[10px] text-muted">Hides it from every member, revokes pending invitations, and cannot be undone from the app — there is no resume endpoint yet.</p>
                </div>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={archiving}
                  icon={archiving ? <Loader2 size={14} className="animate-spin" /> : <Archive size={13} />}
                  onClick={() => void archiveCurrent()}
                >
                  {archiving ? "Archiving…" : "Archive workspace"}
                </Button>
              </div>
            )}
          </div>
        )}
      </section>
      )}

      {section === "people" && (<>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-2xl font-semibold tracking-tight">People</h1>
          <p className="mt-1.5 text-sm text-muted">Manage workspace members, roles and access across all projects in {workspace.name}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(members?.length ?? 0) > 0 && <Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportPeopleCsv} aria-label="Export members as CSV">Export</Button>}
          {isAdmin && <Button variant="secondary" size="sm" icon={<Mail size={14} />} onClick={() => { setPeopleTab("invitations"); setInviteFormOpen(true); setCreatedToken(null); }}>Invite people</Button>}
          {isAdmin && <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => { setPeopleTab("invitations"); setInviteFormOpen(true); setCreatedToken(null); }}>Add member</Button>}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <PeopleStat icon={<Users size={17} />} label="Total members" value={members?.length ?? 0} />
        <PeopleStat icon={<Crown size={17} />} label="Workspace admins" value={admins.length + owners.length} />
        <PeopleStat icon={<CheckCircle2 size={17} />} label="On project teams" value={projectMemberCount} />
        <PeopleStat icon={<Mail size={17} />} label="Pending invitations" value={pendingInviteCount} />
      </div>
      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="border-b border-line px-4 pt-3 sm:px-5">
          <Tabs
            items={[...peopleTabs]}
            active={peopleTab === "members" ? peopleTabs[0] : peopleTab === "invitations" ? peopleTabs[1] : peopleTabs[2]}
            onChange={item => setPeopleTab(item.startsWith("Members") ? "members" : item.startsWith("Invitations") ? "invitations" : "roles")}
          />
        </div>
        {peopleTab === "members" && (
        <div>
          <div className="grid gap-2 border-b border-line p-4 sm:px-5 lg:grid-cols-[minmax(220px,1fr)_140px_170px_140px]">
            <TextInput icon={<Search size={15} />} placeholder="Search members by name or title…" aria-label="Search members" value={peopleSearch} onChange={event => { setPeopleSearch(event.target.value); setPeoplePage(1); }} />
            <Select aria-label="Filter by workspace role" value={peopleRoleFilter} onChange={event => { setPeopleRoleFilter(event.target.value); setPeoplePage(1); }}>
              <option value="all">All roles</option>
              {(["Owner", "Admin", "Member"] as const).filter(role => sortedMembers.some(member => member.role === role)).map(role => <option key={role} value={role}>{role}s</option>)}
            </Select>
            <Select aria-label="Filter by project" value={peopleProjectFilter} onChange={event => { setPeopleProjectFilter(event.target.value); setPeoplePage(1); }}>
              <option value="all">All projects</option>
              {(projects ?? []).map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
            </Select>
            <Select aria-label="Filter by status" value="Active" title="Every listed member is active in this workspace"><option value="Active">Status: Active</option></Select>
          </div>
          {isOwner && selectedMemberIds.length > 0 && (
            <div role="toolbar" aria-label="Bulk member actions" className="flex flex-wrap items-center gap-2 border-b border-line bg-brand-soft/40 px-4 py-2.5 sm:px-5">
              <span className="text-xs font-medium text-brand-pressed">{selectedMemberIds.length} selected</span>
              <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkChangeRole("Admin")}>Make admin</Button>
              <Button size="sm" variant="secondary" disabled={bulkBusy} onClick={() => void bulkChangeRole("Member")}>Make member</Button>
              <button className="text-[11px] text-muted hover:text-heading" onClick={() => setSelectedMemberIds([])}>Clear</button>
            </div>
          )}
          {membersState === "loading" && <LoadingState label="Loading people" />}
          {membersState === "error" && (
            <ErrorState
              title="People could not be loaded"
              description="Membership details are temporarily unavailable."
              action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>}
            />
          )}
          {membersState === "ready" && peopleRows.length === 0 && (
            <EmptyState title="No members match" description="Try a different search or clear the filters." />
          )}
          {membersState === "ready" && peopleRows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="ui-table w-full min-w-[880px] border-collapse text-left">
                <thead>
                  <tr className="border-b border-line text-[10px] uppercase tracking-wide">
                    {isOwner && <th className="w-10 px-4 py-3"><input type="checkbox" className="accent-brand" aria-label="Select visible members" checked={peopleRows.filter(member => member.role !== "Owner").every(member => selectedMemberIds.includes(member.user_id))} onChange={event => toggleAllVisible(event.target.checked)} /></th>}
                    <th className="px-4 py-3 font-semibold">Member</th>
                    <th className="px-4 py-3 font-semibold" title="Workspace-level access set by the Owner">Role</th>
                    <th className="px-4 py-3 font-semibold" title="Projects this member belongs to">Projects</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold" title="Open tasks currently assigned">Open tasks</th>
                    <th className="px-4 py-3 text-right font-semibold">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {peopleRows.map(member => {
                    const self = member.user_id === identityUserId;
                    const busy = bulkBusy || busyMemberId === member.user_id;
                    // Role editing is Owner-only (the backend rejects it for everyone else);
                    // the Owner member itself is excluded — ownership moves via transfer.
                    const roleEditable = isOwner && !self && (member.role === "Admin" || member.role === "Member");
                    // Removal mirrors the service rules: self-leave for Admin/Member,
                    // the Owner removes Admins and Members, Admins remove Members only.
                    const canRemove = self ? workspace.role !== "Owner" : isOwner || (isAdmin && member.role === "Member");
                    const projectCount = projectCountFor(member.user_id);
                    const projectNames = projectNamesForMember(member.user_id);
                    return (
                      <tr key={member.user_id} className={`border-b border-line last:border-0 ${selectedMemberIds.includes(member.user_id) ? "bg-brand-soft/40" : ""}`}>
                        {isOwner && (
                          <td className="px-4 py-3.5">
                            {member.role !== "Owner" && <input type="checkbox" className="accent-brand" aria-label={`Select ${member.display_name}`} checked={selectedMemberIds.includes(member.user_id)} onChange={() => setSelectedMemberIds(previous => previous.includes(member.user_id) ? previous.filter(id => id !== member.user_id) : [...previous, member.user_id])} />}
                          </td>
                        )}
                        <td className="px-4 py-3.5">
                          <div className="flex items-center gap-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-hover text-[10px] font-semibold text-secondary">
                              {member.display_name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}
                            </span>
                            <div className="min-w-0">
                              <p className="truncate text-xs font-semibold text-heading">{member.display_name}{self && <span className="ml-1 text-[10px] text-muted">(you)</span>}</p>
                              <p className="truncate text-[10px] text-muted">{member.job_title ?? "No title yet"}</p>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3.5">
                          {roleEditable ? (
                            <Select aria-label={`Role for ${member.display_name}`} className="w-24" value={member.role} disabled={busy} onChange={event => void changeRole(member, event.target.value as EditableWorkspaceRole)}>
                              <option value="Member">Member</option>
                              <option value="Admin">Admin</option>
                            </Select>
                          ) : (
                            <Badge tone={roleBadgeTone[member.role as keyof typeof roleBadgeTone] ?? "neutral"}>{member.role}</Badge>
                          )}
                        </td>
                        <td className="px-4 py-3.5 text-xs text-secondary" title={projectNames.length > 0 ? projectNames.join(", ") : undefined}>{projectCount === 0 ? "—" : projectCount}{projectNames.length > 1 && <span className="ml-1 text-[10px] text-muted">projects</span>}</td>
                        <td className="px-4 py-3.5"><Badge tone="success">Active</Badge></td>
                        <td className="px-4 py-3.5 text-xs text-secondary">{openTasksFor(member.user_id)}</td>
                        <td className="px-4 py-3.5 text-right">
                          {canRemove && (
                            <Button variant="ghost" size="sm" icon={busy ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} aria-label={self ? `Leave ${workspace.name}` : `Remove ${member.display_name}`} disabled={busy} onClick={() => void removeMemberAction(member)}>
                              {self ? "Leave" : "Remove"}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {membersState === "ready" && peopleFiltered.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3 text-[11px] text-muted sm:px-5">
              <span>Showing {(currentPeoplePage - 1) * PEOPLE_PAGE_SIZE + 1}–{Math.min(currentPeoplePage * PEOPLE_PAGE_SIZE, peopleFiltered.length)} of {peopleFiltered.length} members</span>
              <div className="flex items-center gap-1">
                <button className="icon-button" aria-label="Previous page" disabled={currentPeoplePage <= 1} onClick={() => setPeoplePage(currentPeoplePage - 1)}><ChevronLeft size={15} /></button>
                {Array.from({ length: peoplePageCount }, (_, index) => index + 1).map(pageValue => <button key={pageValue} aria-label={`Go to page ${pageValue}`} aria-current={pageValue === currentPeoplePage ? "page" : undefined} onClick={() => setPeoplePage(pageValue)} className={`h-7 min-w-7 rounded-md px-2 text-[11px] font-medium transition ${pageValue === currentPeoplePage ? "bg-brand text-white" : "text-secondary hover:bg-hover"}`}>{pageValue}</button>)}
                <button className="icon-button" aria-label="Next page" disabled={currentPeoplePage >= peoplePageCount} onClick={() => setPeoplePage(currentPeoplePage + 1)}><ChevronRight size={15} /></button>
              </div>
            </div>
          )}
          {peopleProfileNote && <p className="px-4 pb-3 text-[10px] text-muted sm:px-5">{peopleProfileNote}</p>}
        </div>
        )}
        {peopleTab === "roles" && (
        <div className="grid gap-3 p-4 sm:px-5 sm:grid-cols-2 xl:grid-cols-4">
          <article className="rounded-xl border border-line p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><Crown size={17} /></span><div className="mt-3 flex items-center justify-between"><p className="text-sm font-semibold">Owner</p><Badge tone="brand">{owners.length === 1 ? "1 member" : `${owners.length} members`}</Badge></div><p className="mt-2 text-[11px] leading-5 text-muted">Holds full control of the workspace; ownership moves only by transfer.</p><ul className="mt-3 space-y-1.5 text-[11px] text-secondary"><li>· Change member roles and remove members</li><li>· Archive the workspace</li><li>· Manages every project's settings</li></ul></article>
          <article className="rounded-xl border border-line p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><AlertCircle size={17} /></span><div className="mt-3 flex items-center justify-between"><p className="text-sm font-semibold">Admin</p><Badge tone="warning">{admins.length === 1 ? "1 member" : `${admins.length} members`}</Badge></div><p className="mt-2 text-[11px] leading-5 text-muted">Runs day-to-day administration alongside the Owner.</p><ul className="mt-3 space-y-1.5 text-[11px] text-secondary"><li>· Invite teammates and create projects</li><li>· Remove members and revoke invitations</li><li>· Manages every project's settings</li></ul></article>
          <article className="rounded-xl border border-line p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><Users size={17} /></span><div className="mt-3 flex items-center justify-between"><p className="text-sm font-semibold">Member</p><Badge>{sortedMembers.filter(member => member.role === "Member").length === 1 ? "1 member" : `${sortedMembers.filter(member => member.role === "Member").length} members`}</Badge></div><p className="mt-2 text-[11px] leading-5 text-muted">Works inside assigned projects without workspace administration.</p><ul className="mt-3 space-y-1.5 text-[11px] text-secondary"><li>· View and work on assigned projects</li><li>· Create and update tasks, join meetings</li><li>· Add resources to project libraries</li></ul></article>
          <article className="rounded-xl border border-line p-4"><span className="grid h-10 w-10 place-items-center rounded-xl bg-brand-soft text-brand"><BriefcaseBusiness size={17} /></span><div className="mt-3 flex items-center justify-between"><p className="text-sm font-semibold">Job titles</p><Badge>{jobTitleCounts.length} {jobTitleCounts.length === 1 ? "title" : "titles"}</Badge></div><p className="mt-2 text-[11px] leading-5 text-muted">Titles across all workspace members.</p><div className="mt-3 space-y-1.5">{jobTitleCounts.map(item => <div key={item.title} className="flex items-center justify-between text-[11px]"><span className="truncate text-secondary">{item.title}</span><span className="font-medium text-muted">{item.count}</span></div>)}{jobTitleCounts.length === 0 && <p className="text-[11px] text-muted">No titles set yet.</p>}</div></article>
        </div>
        )}
        {peopleTab === "invitations" && (
          <div className="p-4 space-y-4 sm:px-5">
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
          </div>
        )}
      </section>
      </>)}

      {section === "home" && (<>
        {isAdmin && projectFormOpen && (
          <form onSubmit={submitCreateProject} className="space-y-3 rounded-xl border border-line bg-surface p-4">
            <TextInput
              label="Project name"
              required
              maxLength={160}
              value={projectName}
              onChange={event => setProjectName(event.target.value)}
              placeholder="Website redesign"
            />
            <Textarea
              label="Description"
              rows={2}
              maxLength={5000}
              value={projectDescription}
              onChange={event => setProjectDescription(event.target.value)}
              placeholder="Optional summary of the project's goal"
            />
            <div className="flex flex-wrap gap-3">
              <Select label="Status" className="w-40" value={projectStatus} onChange={event => setProjectStatus(event.target.value as ApiProjectStatus)}>
                {PROJECT_STATUSES.map(option => <option key={option} value={option}>{option}</option>)}
              </Select>
              <Select label="Progress" className="w-44" value={projectProgressMode} onChange={event => setProjectProgressMode(event.target.value as ApiProgressMode)}>
                <option value="auto">Automatic (from tasks)</option>
                <option value="manual">Manual</option>
              </Select>
              {projectProgressMode === "manual" && (
                <label className="block w-36 space-y-1.5">
                  <span className="ui-label">Manual progress (%)</span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    className="ui-input"
                    value={projectManualProgress}
                    onChange={event => setProjectManualProgress(Math.max(0, Math.min(100, Number(event.target.value) || 0)))}
                  />
                </label>
              )}
            </div>
            {projectFormError && <p className="text-xs text-danger">{projectFormError}</p>}
            <Button type="submit" variant="primary" size="sm" disabled={projectSubmitting} icon={projectSubmitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
              {projectSubmitting ? "Creating…" : "Create project"}
            </Button>
          </form>
        )}

        {projectsState === "error" && (
          <ErrorState
            title="The dashboard could not be loaded"
            description="Workspace projects are temporarily unavailable."
            action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>}
          />
        )}
        {(projectsState === "loading" || (projectsState === "ready" && !detail)) && (
          <LoadingState label="Loading workspace dashboard" />
        )}

        {detail && analytics && (
          <>
            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <OverviewMetric icon={<FolderKanban size={17} />} label="Projects" value={analytics.rows.length} note={`${analytics.inProgress} active`} tone="violet" />
              <OverviewMetric icon={<Users size={17} />} label="People" value={members?.length ?? 0} note="Workspace members" tone="blue" />
              <OverviewMetric icon={<Gauge size={17} />} label="Teams" value={analytics.teams} note="Across job titles" tone="orange" />
              <OverviewMetric icon={<CheckCircle2 size={17} />} label="Tasks" value={analytics.taskCount} note={`${analytics.completed} completed · ${analytics.open} open`} tone="green" />
            </section>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
              <div className="space-y-4">
                <section className="grid gap-4 lg:grid-cols-2">
                  <article className="rounded-xl border border-line bg-surface p-5">
                    <div className="flex items-start justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-heading">Workspace progress</h2>
                        <p className="mt-1 text-xs text-muted">Average progress across all projects</p>
                      </div>
                      <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand"><Gauge size={17} /></span>
                    </div>
                    <div className="mt-5 flex flex-wrap items-center gap-5">
                      <div className="grid h-32 w-32 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(var(--brand-primary) ${analytics.overall}%, var(--bg-track) ${analytics.overall}% 100%)` }}>
                        <div className="grid h-[102px] w-[102px] place-items-center rounded-full bg-surface text-center">
                          <span>
                            <strong className="block text-2xl font-semibold">{analytics.overall}%</strong>
                            <span className="text-[11px] text-muted">Overall</span>
                          </span>
                        </div>
                      </div>
                      <div className="min-w-[150px] flex-1 space-y-3">
                        {[
                          { label: "Completed", value: analytics.completed, color: "bg-success" },
                          { label: "In progress", value: analytics.inProgress, color: "bg-brand" },
                          { label: "To do", value: analytics.todo, color: "bg-muted" },
                          { label: "Overdue", value: analytics.overdue, color: "bg-danger" },
                        ].map(item => (
                          <div key={item.label} className="flex items-center gap-2 text-xs">
                            <span className={`h-2 w-2 rounded-full ${item.color}`} />
                            <span className="flex-1 text-secondary">{item.label}</span>
                            <strong className="text-heading">{item.value}</strong>
                          </div>
                        ))}
                      </div>
                    </div>
                  </article>
                  <article className="rounded-xl border border-line bg-surface p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <h2 className="text-sm font-semibold text-heading">Project progress</h2>
                        <p className="mt-1 text-xs text-muted">Progress of active projects in this workspace</p>
                      </div>
                      <button className="text-xs font-medium text-brand" onClick={onViewProjects}>
                        View all <ArrowRight size={13} className="ml-1 inline" />
                      </button>
                    </div>
                    <div className="space-y-4">
                      {analytics.featured.map(row => (
                        <button key={row.project.id} className="group flex w-full items-center gap-3 text-left" onClick={() => onOpenProject(row.project.id)}>
                          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><FolderKanban size={15} /></span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-center justify-between gap-2">
                              <span className="truncate text-xs font-medium text-heading group-hover:text-brand">{row.project.name}</span>
                              <span className="text-[11px] text-muted">{row.progress}%</span>
                            </span>
                            <span className="mt-1.5 block h-1.5 overflow-hidden rounded-full bg-track">
                              <span className="block h-full rounded-full bg-brand" style={{ width: `${row.progress}%` }} />
                            </span>
                          </span>
                          <span className="hidden sm:block"><Badge tone={healthTone[row.health]}>{row.health}</Badge></span>
                        </button>
                      ))}
                      {analytics.rows.length === 0 && (
                        <EmptyState
                          title="No projects yet"
                          description={isAdmin ? "Create the first project with New project — you become its Project Manager." : "A workspace Owner or Admin sets up projects."}
                        />
                      )}
                    </div>
                  </article>
                </section>

                <section className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,.8fr)]">
                  <article className="overflow-hidden rounded-xl border border-line bg-surface">
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                      <div>
                        <h2 className="text-sm font-semibold text-heading">Active projects</h2>
                        <p className="mt-1 text-xs text-muted">Teams, progress and upcoming deadlines</p>
                      </div>
                      <button className="text-xs font-medium text-brand" onClick={onViewProjects}>
                        View all <ArrowRight size={13} className="ml-1 inline" />
                      </button>
                    </div>
                    <div className="divide-y divide-line">
                      {analytics.activeRows.map(row => (
                        <button
                          key={row.project.id}
                          onClick={() => onOpenProject(row.project.id)}
                          className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 px-4 py-3 text-left hover:bg-hover sm:grid-cols-[minmax(0,1.1fr)_minmax(90px,.7fr)_minmax(90px,.7fr)_auto]"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-xs font-semibold text-heading">{row.project.name}</span>
                            <span className="mt-1 block truncate text-[11px] text-muted">{row.project.status}</span>
                          </span>
                          <span className="hidden sm:block"><AvatarGroup names={row.members} /></span>
                          <span className="flex items-center gap-2 text-[11px] text-secondary">
                            <span className="h-1.5 w-16 overflow-hidden rounded-full bg-track">
                              <span className="block h-full rounded-full bg-brand" style={{ width: `${row.progress}%` }} />
                            </span>
                            {row.progress}%
                          </span>
                          <span className="text-[11px] text-muted">{row.nextMilestone ? shortDate(row.nextMilestone.due_date) : "No due date"}</span>
                        </button>
                      ))}
                      {analytics.rows.length === 0 && <EmptyState title="No active projects" description="Projects you can access appear here." />}
                    </div>
                  </article>
                  <article className="overflow-hidden rounded-xl border border-line bg-surface">
                    <div className="flex items-center justify-between border-b border-line px-4 py-3">
                      <div>
                        <h2 className="text-sm font-semibold text-heading">Recent resources</h2>
                        <p className="mt-1 text-xs text-muted">Recently updated project files</p>
                      </div>
                      <FileText size={16} className="text-brand" />
                    </div>
                    {analytics.resources.length ? (
                      <div className="divide-y divide-line">
                        {analytics.resources.map(resource => (
                          <div key={resource.id} className="flex items-center gap-3 px-4 py-3">
                            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><FileText size={14} /></span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-xs font-medium text-heading">{resource.name}</span>
                              <span className="mt-1 block truncate text-[11px] text-muted">{resource.type} · Updated {shortDate(resource.updated_at)}</span>
                            </span>
                            <ArrowUpRight size={13} className="text-muted" />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <EmptyState title="No shared resources" description="Resources from your workspace projects appear here." />
                    )}
                  </article>
                </section>
              </div>

              <aside className="space-y-4">
                <article className="overflow-hidden rounded-xl border border-line bg-surface">
                  <div className="flex items-center justify-between border-b border-line px-4 py-3">
                    <div>
                      <h2 className="text-sm font-semibold text-heading">Recent activity</h2>
                      <p className="mt-1 text-xs text-muted">Latest work across projects</p>
                    </div>
                    <CircleDot size={16} className="text-brand" />
                  </div>
                  {activityState === "loading" && <LoadingState label="Loading activity" />}
                  {activityState === "error" && (
                    <ErrorState
                      title="Recent activity could not be loaded"
                      description="The activity feed is temporarily unavailable."
                      action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>}
                    />
                  )}
                  {activityState === "ready" && activities?.length === 0 && (
                    <EmptyState title="No activity yet" description="Actions taken in this workspace appear here — projects, tasks, meetings, and memberships." />
                  )}
                  {activityState === "ready" && activities && activities.length > 0 && (
                    <div className="divide-y divide-line">
                      {activities.map(activity => (
                        <div key={activity.id} className="flex items-start gap-3 px-4 py-3">
                          <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium text-heading">
                              {activity.actor_display_name?.trim() || "Someone"} {activityText(activity)}
                            </span>
                            <span className="mt-1 block truncate text-[11px] text-muted">
                              {shortDateTime(activity.created_at)} · {activity.resource_type}
                              {activity.actor_user_id ? "" : " · System"}
                            </span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                  {activityState === "ready" && activities !== null && activities.length < activityTotal && (
                    <div className="flex justify-center border-t border-line px-4 py-3">
                      <Button
                        size="sm"
                        disabled={activityLoadingMore}
                        icon={activityLoadingMore ? <Loader2 size={13} className="animate-spin" /> : undefined}
                        onClick={() => void loadMoreActivity()}
                      >
                        {activityLoadingMore ? "Loading…" : `Load more (${activityTotal - activities.length} older)`}
                      </Button>
                    </div>
                  )}
                  <p className="border-t border-line px-4 py-3 text-[10px] text-muted">
                    This feed is the workspace's notification surface — every action is recorded here; there is no separate per-person inbox yet.
                  </p>
                </article>
              </aside>
            </div>
          </>
        )}
      </>
      )}
    </div>
  );
}

/** Demo-parity metric tile (WorkspaceOverviewPage's OverviewMetric). */
function OverviewMetric({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: number; note: string; tone: "violet" | "blue" | "orange" | "green" }) {
  const tones = { violet: "bg-brand-soft text-brand", blue: "bg-blue-50 text-blue-600", orange: "bg-warning-soft text-warning", green: "bg-success-soft text-success" } as const;
  return (
    <article className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tones[tone]}`}>{icon}</span>
      <div className="min-w-0">
        <p className="text-[11px] text-muted">{label}</p>
        <p className="mt-0.5 text-xl font-semibold leading-tight">{value}</p>
        <p className="mt-1 truncate text-[10px] text-secondary">{note}</p>
      </div>
    </article>
  );
}

/** People section stat tile (prototype PeoplePage parity). */
function PeopleStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <article className="flex items-center gap-3.5 rounded-xl border border-line bg-surface p-4">
      <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</span>
      <div className="min-w-0">
        <p className="truncate text-xs text-muted">{label}</p>
        <p className="mt-0.5 text-xl font-semibold leading-tight">{value}</p>
      </div>
    </article>
  );
}
