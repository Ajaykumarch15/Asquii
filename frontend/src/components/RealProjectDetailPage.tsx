/**
 * Real-data project detail page for signed-in users.
 *
 * Reads the project-scoped backend routers (tasks, members, milestones,
 * meetings with attendee management) and keeps the same loading/error/empty
 * discipline as the other real views. Prototype project data is never mixed
 * in. Resources remain the last prototype-only slice.
 */

import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleDot,
  Clock3,
  ExternalLink,
  FileText,
  Flag,
  FolderKanban,
  Gauge,
  Link2,
  ListTodo,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  UserMinus,
  UserPlus,
  Users,
  Zap,
} from "lucide-react";
import {
  AvatarGroup,
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  Textarea,
  TextInput,
} from "./ui";
import { friendlyError } from "../lib/api/client";
import { activityText, activitiesApi, type ApiActivity } from "../lib/api/activities";
import {
  projectsApi,
  type ApiMilestone,
  type ApiMeeting,
  type ApiMeetingAttendee,
  type ApiMeetingType,
  type ApiProject,
  type ApiProjectMember,
  type ApiProjectRole,
  type ApiProjectStatus,
  type ApiResource,
  type ApiResourceType,
  type ApiTask,
  type ApiTaskComment,
  type ApiTaskDetail,
  type ApiTaskPriority,
  type ApiTaskStatus,
  type ApiTaskSubtask,
} from "../lib/api/projects";
import { workspaceApi, type ApiWorkspaceMember } from "../lib/api/workspace";
import type { WorkspaceState } from "../lib/real/useRealWorkspaces";

const projectStatusTone = { "In progress": "brand", "In review": "warning", Complete: "success" } as const;
const taskStatusTone: Record<ApiTaskStatus, "neutral" | "brand" | "warning" | "success"> = {
  Backlog: "neutral",
  "To do": "neutral",
  "In progress": "brand",
  "Dev completed": "brand",
  "In review": "warning",
  Complete: "success",
};
const priorityTone: Record<ApiTaskPriority, "neutral" | "warning" | "danger"> = {
  Low: "neutral",
  Medium: "warning",
  High: "danger",
};

const TASK_STATUSES: ApiTaskStatus[] = ["Backlog", "To do", "In progress", "Dev completed", "In review", "Complete"];

function shortDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en", { month: "short", day: "numeric" });
}

/** Date-only values (due dates, milestone dates) anchored at noon so a UTC offset never shifts the visible day. */
function formatDay(value: string | null): string {
  if (!value) return "No date";
  const parsed = new Date(`${value.slice(0, 10)}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en", { month: "short", day: "numeric" });
}

type TabName = "Overview" | "Kanban" | "Tasks" | "Meetings" | "Resources" | "Members" | "Milestones" | "Settings";
const TABS_BASE: TabName[] = ["Overview", "Kanban", "Tasks", "Meetings", "Resources", "Members", "Milestones"];

/**
 * Lowercase tab keys shared with the shell for sidebar navigation and
 * `#project/{projectId}/{tab}` deep links. Unknown keys fall back to overview.
 */
export type RealProjectTab = "overview" | "kanban" | "tasks" | "meetings" | "resources" | "members" | "milestones" | "settings";
export const REAL_PROJECT_TABS: RealProjectTab[] = ["overview", "kanban", "tasks", "meetings", "resources", "members", "milestones", "settings"];

const TAB_NAME_BY_KEY = Object.fromEntries(TABS_BASE.concat("Settings").map(name => [name.toLowerCase(), name])) as Record<RealProjectTab, TabName>;

export const realProjectTabName = (key: RealProjectTab): TabName => TAB_NAME_BY_KEY[key] ?? "Overview";

export function RealProjectDetailPage({ workspaceState, projectId, getAccessToken, identityUserId, activeTab, onTabChange }: {
  workspaceState: WorkspaceState;
  projectId: string;
  getAccessToken: () => Promise<string | null>;
  /** Signed-in user's id; attendees may always remove themselves from meetings. */
  identityUserId: string;
  /** Tab is owned by the shell (sidebar + deep links). */
  activeTab: RealProjectTab;
  onTabChange: (tab: RealProjectTab) => void;
}) {
  const workspace = workspaceState.selected;

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [members, setMembers] = useState<ApiProjectMember[]>([]);
  const [milestones, setMilestones] = useState<ApiMilestone[]>([]);
  const [reloadToken, setReloadToken] = useState(0);

  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isCollaborator = (project?.current_user_role ?? null) !== null;
  const isManager = project?.current_user_role === "Project Manager";
  // Backend settings management = Project Manager OR workspace Owner/Admin
  // (`can_manage_settings`); the same gate covers meetings and settings.
  const canManage = isManager || workspace?.role === "Owner" || workspace?.role === "Admin";
  // The shell owns the tab (project sidebar, deep links); unknown or
  // manager-only requests degrade to Overview instead of a broken screen.
  const requestedTab = realProjectTabName(activeTab);
  const tab: TabName = requestedTab === "Settings" && !canManage ? "Overview" : requestedTab;
  /** Internal jumps (header button, overview links) honor the same fallback. */
  const changeTab = (next: RealProjectTab) => onTabChange(next === "settings" && !canManage ? "overview" : next);

  useEffect(() => {
    if (!workspace) return;
    const workspaceId = workspace.id;
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const [projectRecord, memberRows, milestoneRows] = await Promise.all([
          projectsApi.getProject(token, workspaceId, projectId),
          projectsApi.listProjectMembers(token, workspaceId, projectId),
          projectsApi.listMilestones(token, workspaceId, projectId),
        ]);
        if (disposed) return;
        setProject(projectRecord);
        setMembers(memberRows);
        setMilestones(milestoneRows);
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load the project");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [workspace, projectId, getAccessToken, reloadToken]);

  if (!workspace) return <LoadingState label="Loading workspace" />;

  const archived = project?.archived_at != null;

  return (
    <div className="space-y-5">
      {phase === "loading" && <LoadingState label="Loading project" />}
      {phase === "error" && (
        <ErrorState
          title="Project could not be loaded"
          description={errorMessage ?? "Retry in a moment."}
          action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>}
        />
      )}

      {phase === "ready" && project && (
        <>
          <section className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><FolderKanban size={21} /></span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-xl font-semibold tracking-tight">{project.name}</h1>
                  <Badge tone={projectStatusTone[project.status]}>{project.status}</Badge>
                  {archived && <Badge tone="danger">Archived</Badge>}
                </div>
                <p className="mt-1 max-w-2xl truncate text-xs text-muted">{project.description || "Project execution, progress and team overview."}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="hidden sm:block"><AvatarGroup names={members.map(member => member.display_name)} /></div>
              {canManage && (
                <Button size="sm" variant="secondary" icon={<Pencil size={14} />} onClick={() => onTabChange("settings")}>
                  Project settings
                </Button>
              )}
            </div>
          </section>

          {(statusNotice || actionError) && (
            <div role="status" className={`rounded-xl border border-line px-4 py-3 text-xs font-medium ${statusNotice ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>
              {statusNotice ?? actionError}
            </div>
          )}

          {tab === "Overview" && (
            <OverviewPanel
              workspaceId={workspace.id}
              projectId={projectId}
              project={project}
              members={members}
              milestones={milestones}
              getAccessToken={getAccessToken}
              onNavigateTab={changeTab}
            />
          )}

          {tab === "Kanban" && (
            <KanbanPanel
              workspaceId={workspace.id}
              projectId={projectId}
              members={members}
              isCollaborator={isCollaborator}
              archived={archived}
              getAccessToken={getAccessToken}
              onNotice={text => { setStatusNotice(text); setActionError(null); }}
              onError={text => { setActionError(text); setStatusNotice(null); }}
            />
          )}

          {tab === "Tasks" && (
            <TasksPanel
              workspaceId={workspace.id}
              projectId={projectId}
              project={project}
              members={members}
              isCollaborator={isCollaborator}
              isManager={isManager}
              archived={archived}
              getAccessToken={getAccessToken}
              onNotice={text => { setStatusNotice(text); setActionError(null); }}
              onError={text => { setActionError(text); setStatusNotice(null); }}
            />
          )}

          {tab === "Members" && (
            <MembersPanel
              workspaceId={workspace.id}
              projectId={projectId}
              members={members}
              canManage={canManage}
              identityUserId={identityUserId}
              archived={archived}
              milestones={milestones.length}
              getAccessToken={getAccessToken}
              onChanged={() => setReloadToken(token => token + 1)}
              onNotice={text => { setStatusNotice(text); setActionError(null); }}
              onError={text => { setActionError(text); setStatusNotice(null); }}
            />
          )}

          {tab === "Meetings" && (
            <MeetingsPanel
              workspaceId={workspace.id}
              projectId={projectId}
              members={members}
              isCollaborator={isCollaborator}
              canManageMeetings={canManage}
              archived={archived}
              identityUserId={identityUserId}
              getAccessToken={getAccessToken}
              onNotice={text => { setStatusNotice(text); setActionError(null); }}
              onError={text => { setActionError(text); setStatusNotice(null); }}
            />
          )}

          {tab === "Resources" && (
            <ResourcesPanel
              workspaceId={workspace.id}
              projectId={projectId}
              isCollaborator={isCollaborator}
              archived={archived}
              getAccessToken={getAccessToken}
              onNotice={text => { setStatusNotice(text); setActionError(null); }}
              onError={text => { setActionError(text); setStatusNotice(null); }}
            />
          )}

          {tab === "Milestones" && (
            <MilestonesPanel
              workspaceId={workspace.id}
              projectId={projectId}
              milestones={milestones}
              canManage={canManage}
              archived={archived}
              getAccessToken={getAccessToken}
              onChanged={() => setReloadToken(token => token + 1)}
              onNotice={text => { setStatusNotice(text); setActionError(null); }}
              onError={text => { setActionError(text); setStatusNotice(null); }}
            />
          )}

          {tab === "Settings" && canManage && (
            <SettingsPanel
              workspaceId={workspace.id}
              project={project}
              archived={archived}
              getAccessToken={getAccessToken}
              onChanged={() => setReloadToken(token => token + 1)}
              onNotice={text => { setStatusNotice(text); setActionError(null); }}
              onError={text => { setActionError(text); setStatusNotice(null); }}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Kanban: six statuses, drag & drop reorder/cross-column moves        */
/* ------------------------------------------------------------------ */

const columnDots: Record<ApiTaskStatus, string> = {
  Backlog: "bg-secondary/60",
  "To do": "bg-brand",
  "In progress": "bg-brand",
  "Dev completed": "bg-brand",
  "In review": "bg-warning",
  Complete: "bg-success",
};

/** Server ordering is by position; ties resolve by creation time. */
const sortRows = (rows: ApiTask[]) =>
  [...rows].sort((a, b) =>
    Number(a.position) - Number(b.position)
    || a.created_at.localeCompare(b.created_at)
    || a.id.localeCompare(b.id));

const midOf = (prev: number, next: number) => (prev + next) / 2;

function KanbanPanel({ workspaceId, projectId, members, isCollaborator, archived, getAccessToken, onNotice, onError }: {
  workspaceId: string;
  projectId: string;
  members: ApiProjectMember[];
  isCollaborator: boolean;
  archived: boolean;
  getAccessToken: () => Promise<string | null>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  /** Where the ghost line sits: status of the column and the card to insert before (null = end). */
  const [dropAt, setDropAt] = useState<{ status: ApiTaskStatus; beforeTaskId: string | null } | null>(null);
  const [moving, setMoving] = useState(false);
  const [quickAdd, setQuickAdd] = useState<ApiTaskStatus | null>(null);
  const [quickTitle, setQuickTitle] = useState("");
  const [quickBusy, setQuickBusy] = useState(false);

  useEffect(() => {
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        // New tasks start at position 0, so server-side ties are resolved by
        // created_at — the same rule the client sort applies below.
        // The backend caps limit at 100 (Query(le=100)); anything higher 422s.
        const rows = await projectsApi.listTasks(token, workspaceId, projectId, { limit: 100, sort_by: "position" });
        if (disposed) return;
        setTasks(rows);
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load the board");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [workspaceId, projectId, getAccessToken, reloadToken]);

  const columns = TASK_STATUSES.map(status => ({ status, rows: sortRows(tasks.filter(task => task.status === status)) }));
  const editable = isCollaborator && !archived;
  const expandedTask = expandedId === null ? null : sortRows(tasks).find(task => task.id === expandedId) ?? null;

  /**
   * Drop-reorder contract: PATCH the dragged task only; its new Decimal
   * position is the midpoint of its neighbours in the final order (so the
   * backend stores one row per move, like the prototype's order map).
   */
  async function moveTask(taskId: string, status: ApiTaskStatus, beforeTaskId: string | null) {
    const task = tasks.find(item => item.id === taskId);
    if (!task || !editable || moving) return;
    const sameColumn = task.status === status;
    if (sameColumn) {
      // No-op drops: back onto itself, immediately after itself, or at its own end.
      const selfIndex = sortRows(tasks.filter(item => item.status === status)).findIndex(item => item.id === taskId);
      const rows = sortRows(tasks.filter(item => item.status === status));
      const removesBefore = beforeTaskId === taskId;
      const removesAfter = selfIndex >= 0 && rows[selfIndex + 1]?.id === beforeTaskId;
      const removesEnd = beforeTaskId === null && selfIndex === rows.length - 1;
      if (removesBefore || removesAfter || removesEnd) {
        setDropAt(null);
        setDragId(null);
        return;
      }
    }
    const target = sortRows(tasks.filter(item => item.status === status && item.id !== taskId));
    const index = beforeTaskId ? target.findIndex(item => item.id === beforeTaskId) : target.length;
    if (index < 0) return;
    const prevIndex = index - 1;
    const prev = prevIndex >= 0 ? Number(target[prevIndex].position) : null;
    const next = index < target.length ? Number(target[index].position) : null;
    // Midpoint of the persisted Decimal neighbours; ±0.5 lands past an end.
    const position = prev !== null && next !== null ? midOf(prev, next) : prev !== null ? prev + 0.5 : next !== null ? next - 0.5 : 0;

    setDropAt(null);
    setDragId(null);
    // Optimistic: the card lands at the drop slot before the PATCH resolves.
    setTasks(previous => [...previous.filter(item => item.id !== taskId), { ...task, status, position: String(position) }]);
    setMoving(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const patch: { status?: ApiTaskStatus; position?: number } = { position };
      if (!sameColumn) patch.status = status;
      const updated = await projectsApi.updateTask(token, workspaceId, projectId, taskId, patch);
      setTasks(previous => previous.map(item => (item.id === updated.id ? updated : item)));
      if (!sameColumn) onNotice(`"${updated.title}" moved to ${updated.status}.`);
    } catch (error) {
      const friendly = friendlyError(error, "Could not move the task");
      onError(`${friendly.title}: ${friendly.message}`);
      setReloadToken(value => value + 1);
    } finally {
      setMoving(false);
    }
  }

  async function createQuick(status: ApiTaskStatus) {
    const title = quickTitle.trim();
    if (!title) return;
    setQuickBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        onError("Sign-in session ended. Please sign in again.");
        return;
      }
      const column = columns.find(item => item.status === status);
      const rows = column?.rows ?? [];
      const last = rows.length > 0 ? Number(rows[rows.length - 1].position) : null;
      const created = await projectsApi.createTask(token, workspaceId, projectId, {
        title,
        status,
        position: last !== null ? last + 0.5 : undefined,
      });
      setTasks(previous => [created, ...previous]);
      onNotice(`Task "${created.title}" created.`);
      setQuickTitle("");
      setQuickAdd(null);
    } catch (error) {
      const friendly = friendlyError(error, "Could not create task");
      onError(`${friendly.title}: ${friendly.message}`);
      setReloadToken(value => value + 1);
    } finally {
      setQuickBusy(false);
    }
  }

  if (phase === "loading") return <LoadingState label="Loading board" />;
  if (phase === "error") {
    return (
      <ErrorState title="Board could not be loaded" description={errorMessage ?? "Retry in a moment."} action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>} />
    );
  }

  return (
    <div className="space-y-3">
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] text-muted">
        <span>{tasks.length} task{tasks.length === 1 ? "" : "s"} on the board</span>
        {editable ? <span>Drag cards between columns; each move saves one position update.</span> : <span>Only project collaborators can move cards.</span>}
        {archived && <span>This project is archived, so the board is read-only.</span>}
      </p>

      <div className="flex items-start gap-3 overflow-x-auto pb-2">
        {columns.map(column => {
          const activeDrop = dropAt !== null && dropAt.status === column.status;
          return (
            <section
              key={column.status}
              aria-label={`${column.status} column`}
              className={`flex min-h-40 w-[260px] shrink-0 flex-col rounded-xl border bg-surface ${activeDrop ? "border-brand" : "border-line"}`}
              onDragOver={event => { if (editable) { event.preventDefault(); setDropAt({ status: column.status, beforeTaskId: null }); } }}
              onDrop={event => {
                event.preventDefault();
                const taskId = event.dataTransfer.getData("text/plain") || dragId || "";
                if (taskId && dropAt && dropAt.status === column.status) void moveTask(taskId, column.status, dropAt.beforeTaskId);
              }}
            >
              <header className="flex items-center justify-between gap-2 border-b border-line px-3 py-2.5">
                <span className="flex items-center gap-2 text-xs font-semibold text-heading">
                  <span aria-hidden className={`h-2 w-2 rounded-full ${columnDots[column.status]}`} />
                  {column.status}
                  <span className="text-[10px] font-normal text-muted">{column.rows.length}</span>
                </span>
                {editable && (
                  <button className="icon-button h-6 w-6" aria-label={`Add task to ${column.status}`} onClick={() => { setQuickAdd(status => status === column.status ? null : column.status); setQuickTitle(""); }}>
                    <Plus size={14} />
                  </button>
                )}
              </header>
              <div className="flex flex-1 flex-col gap-2 p-2">
                {column.rows.map((task, index) => {
                  const ghostBefore = activeDrop && dropAt.beforeTaskId === task.id;
                  return (
                    <div key={task.id}>
                      {ghostBefore && <span aria-hidden className="mb-2 block h-0.5 rounded-full bg-brand" />}
                      <article
                        draggable={editable}
                        onDragStart={event => { setDragId(task.id); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); }}
                        onDragEnd={() => { setDragId(null); setDropAt(null); }}
                        onDragOver={event => {
                          if (!editable) return;
                          event.preventDefault();
                          event.stopPropagation();
                          event.dataTransfer.dropEffect = "move";
                          const bounds = event.currentTarget.getBoundingClientRect();
                          const before = event.clientY < bounds.top + bounds.height / 2;
                          setDropAt({ status: column.status, beforeTaskId: before ? task.id : column.rows[index + 1]?.id ?? null });
                        }}
                        onClick={() => setExpandedId(expandedId === task.id ? null : task.id)}
                        className={`cursor-pointer rounded-lg border border-line bg-surface p-2.5 shadow-none transition hover:border-strong ${dragId === task.id ? "opacity-40" : ""}`}
                        role="button"
                        tabIndex={0}
                        onKeyDown={event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setExpandedId(expandedId === task.id ? null : task.id); } }}
                        aria-label={`Open task ${task.title}`}
                      >
                        <p className="line-clamp-3 text-xs font-semibold text-heading">{task.title}</p>
                        <div className="mt-2 flex flex-wrap items-center gap-1.5">
                          <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${priorityTone[task.priority] === "danger" ? "bg-danger-soft text-danger" : priorityTone[task.priority] === "warning" ? "bg-warning-soft text-warning" : "bg-hover text-secondary"}`}>{task.priority}</span>
                          {task.due_date && (
                            <span className={`text-[9px] font-medium ${task.due_date < new Date().toISOString().slice(0, 10) && task.status !== "Complete" ? "text-danger" : "text-muted"}`}>
                              {formatDay(task.due_date)}
                            </span>
                          )}
                          <span className="ml-auto grid h-5 w-5 place-items-center rounded-full bg-hover text-[8px] font-semibold text-secondary" title={task.assignee_display_name ?? "Unassigned"}>
                            {task.assignee_display_name ? task.assignee_display_name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() : "—"}
                          </span>
                        </div>
                      </article>
                    </div>
                  );
                })}
                {activeDrop && dropAt.beforeTaskId === null && <span aria-hidden className="block h-0.5 rounded-full bg-brand" />}
                {column.rows.length === 0 && !activeDrop && (
                  <p className="px-1 py-3 text-center text-[10px] text-muted">{editable ? "Drop a card here or use +" : "No tasks"}</p>
                )}
                {quickAdd === column.status && editable && (
                  <form
                    onSubmit={event => { event.preventDefault(); void createQuick(column.status); }}
                    className="rounded-lg border border-line bg-surface p-2">
                    <input
                      autoFocus
                      className="ui-input !py-1.5 text-xs"
                      maxLength={240}
                      aria-label={`New task title in ${column.status}`}
                      placeholder="Task title…"
                      value={quickTitle}
                      disabled={quickBusy}
                      onChange={event => setQuickTitle(event.target.value)}
                    />
                    <div className="mt-2 flex gap-1">
                      <Button type="submit" size="sm" disabled={quickBusy || quickTitle.trim().length === 0} icon={quickBusy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}>Add</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => { setQuickAdd(null); setQuickTitle(""); }}>Cancel</Button>
                    </div>
                  </form>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {expandedTask && (
        <div className="fixed inset-0 z-50 flex justify-end bg-overlay" onMouseDown={event => { if (event.target === event.currentTarget) setExpandedId(null); }}>
          <aside
            role="dialog"
            aria-modal="true"
            aria-label={`Task ${expandedTask.title}`}
            className="h-full w-full max-w-md overflow-y-auto border-l border-line bg-page p-4"
            onKeyDown={event => { if (event.key === "Escape") setExpandedId(null); }}
          >
            <div className="mb-1 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-heading">{expandedTask.title}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[10px] text-muted">
                  <Badge tone={taskStatusTone[expandedTask.status]}>{expandedTask.status}</Badge>
                  <span>{expandedTask.assignee_display_name ?? "Unassigned"}</span>
                  <span>Due {shortDate(expandedTask.due_date)}</span>
                </p>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setExpandedId(null)}>Close</Button>
            </div>
            <TaskDrawer
              workspaceId={workspaceId}
              projectId={projectId}
              task={expandedTask}
              getAccessToken={getAccessToken}
              onClose={() => setExpandedId(null)}
              onNotice={onNotice}
              onError={onError}
            />
          </aside>
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tasks                                                               */
/* ------------------------------------------------------------------ */

function TasksPanel({ workspaceId, projectId, project, members, isCollaborator, isManager, archived, getAccessToken, onNotice, onError }: {
  workspaceId: string;
  projectId: string;
  project: ApiProject;
  members: ApiProjectMember[];
  isCollaborator: boolean;
  isManager: boolean;
  archived: boolean;
  getAccessToken: () => Promise<string | null>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [statusFilter, setStatusFilter] = useState("" as ApiTaskStatus | "");
  const [search, setSearch] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState("");
  /** Task being edited; null means the open form creates a new task. */
  const [editId, setEditId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ApiTaskStatus>("To do");
  const [priority, setPriority] = useState<ApiTaskPriority>("Medium");
  const [assignee, setAssignee] = useState("" as string);
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const rows = await projectsApi.listTasks(token, workspaceId, projectId, {
          limit: 100,
          status: statusFilter || undefined,
          q: search.trim() || undefined,
          assignee_user_id: assigneeFilter || undefined,
          sort_by: "position",
        });
        if (disposed) return;
        setTasks(rows);
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load tasks");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [workspaceId, projectId, statusFilter, search, assigneeFilter, getAccessToken, reloadToken]);

  function openEdit(task: ApiTask) {
    setTitle(task.title);
    setDescription(task.description);
    setStatus(task.status);
    setPriority(task.priority);
    setAssignee(task.assignee_user_id ?? "");
    setDueDate(task.due_date ?? "");
    setEditId(task.id);
    setFormError(null);
    setFormOpen(true);
  }

  function resetTaskForm() {
    setTitle("");
    setDescription("");
    setStatus("To do");
    setPriority("Medium");
    setAssignee("");
    setDueDate("");
    setEditId(null);
    setFormError(null);
  }

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setFormError("Sign-in session ended. Please sign in again.");
        return;
      }
      if (editId !== null) {
        // PATCH contract: send only the fields that differ from the stored
        // values so unrelated edits never trigger `task.updated` noise.
        const editing = tasks.find(item => item.id === editId);
        if (!editing) {
          setFormError("This task no longer exists.");
          return;
        }
        const patch: {
          title?: string;
          description?: string;
          status?: ApiTaskStatus;
          priority?: ApiTaskPriority;
          due_date?: string | null;
          assignee_user_id?: string | null;
        } = {};
        if (title.trim() !== editing.title) patch.title = title.trim();
        if (description.trim() !== editing.description) patch.description = description.trim();
        if (status !== editing.status) patch.status = status;
        if (priority !== editing.priority) patch.priority = priority;
        if (dueDate !== (editing.due_date ?? "")) patch.due_date = dueDate || null;
        if (assignee !== (editing.assignee_user_id ?? "")) patch.assignee_user_id = assignee || null;
        if (Object.keys(patch).length === 0) {
          onNotice("");
          resetTaskForm();
          setFormOpen(false);
          return;
        }
        const updated = await projectsApi.updateTask(token, workspaceId, projectId, editId, patch);
        setTasks(previous => previous.map(item => (item.id === updated.id ? updated : item)));
        onNotice(`Task "${updated.title}" updated.`);
      } else {
        const created = await projectsApi.createTask(token, workspaceId, projectId, {
          title: title.trim(),
          description: description.trim(),
          status,
          priority,
          assignee_user_id: assignee || null,
          due_date: dueDate || null,
        });
        setTasks(previous => [created, ...previous]);
        onNotice(`Task "${created.title}" created.`);
      }
      resetTaskForm();
      setFormOpen(false);
    } catch (error) {
      const friendly = friendlyError(error, editId !== null ? "Could not update task" : "Could not create task");
      setFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function changeStatus(task: ApiTask, next: ApiTaskStatus) {
    setTasks(previous => previous.map(item => (item.id === task.id ? { ...item, status: next } : item)));
    try {
      const token = await getAccessToken();
      if (!token) return;
      const updated = await projectsApi.updateTask(token, workspaceId, projectId, task.id, { status: next });
      setTasks(previous => previous.map(item => (item.id === updated.id ? updated : item)));
      onNotice(`Task moved to ${updated.status}.`);
    } catch (error) {
      const friendly = friendlyError(error, "Could not update task");
      onError(`${friendly.title}: ${friendly.message}`);
      setTasks(previous => previous.map(item => (item.id === task.id ? task : item)));
    }
  }

  async function removeTask(task: ApiTask) {
    if (!window.confirm(`Delete task "${task.title}"? This cannot be undone.`)) return;
    setTasks(previous => previous.filter(item => item.id !== task.id));
    try {
      const token = await getAccessToken();
      if (!token) return;
      await projectsApi.deleteTask(token, workspaceId, projectId, task.id);
      onNotice(`Task "${task.title}" deleted.`);
    } catch (error) {
      const friendly = friendlyError(error, "Could not delete task");
      onError(`${friendly.title}: ${friendly.message}`);
      setReloadToken(token => token + 1);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <TextInput
          label="Search"
          className="w-64"
          value={search}
          onChange={event => setSearch(event.target.value)}
          placeholder="Search title or description…"
          aria-label="Search tasks"
        />
        <Select label="Assignee" className="w-48" value={assigneeFilter} onChange={event => setAssigneeFilter(event.target.value)}>
          <option value="">All assignees</option>
          <option value="none">Unassigned</option>
          {members.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
        </Select>
        <Select label="Status" className="w-44" value={statusFilter} onChange={event => setStatusFilter(event.target.value as ApiTaskStatus | "")}>
          <option value="">All statuses</option>
          {TASK_STATUSES.map(option => <option key={option} value={option}>{option}</option>)}
        </Select>
        {isCollaborator && !archived && (
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => { if (formOpen) { setFormOpen(false); } else { resetTaskForm(); setFormOpen(true); } onNotice(""); }}>
            {formOpen ? "Cancel" : "New task"}
          </Button>
        )}
      </div>

      {formOpen && isCollaborator && !archived && (
        <form onSubmit={submitCreate} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{editId !== null ? "Editing task" : "New task"}</p>
          <TextInput label="Title" required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} placeholder="Draft the homepage copy" />
          <Textarea label="Description" rows={3} maxLength={20000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What needs to happen" />
          <Select label="Status" value={status} onChange={event => setStatus(event.target.value as ApiTaskStatus)}>
            {TASK_STATUSES.map(option => <option key={option} value={option}>{option}</option>)}
          </Select>
          <Select label="Priority" value={priority} onChange={event => setPriority(event.target.value as ApiTaskPriority)}>
            <option value="Low">Low</option>
            <option value="Medium">Medium</option>
            <option value="High">High</option>
          </Select>
          <Select label="Assignee" value={assignee} onChange={event => setAssignee(event.target.value)}>
            <option value="">Unassigned</option>
            {members.map(member => <option key={member.user_id} value={member.user_id}>{member.display_name}</option>)}
          </Select>
          <label className="block space-y-1.5">
            <span className="ui-label">Due date</span>
            <input type="date" className="ui-input" value={dueDate} onChange={event => setDueDate(event.target.value)} />
          </label>
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <Button type="submit" variant="primary" size="sm" disabled={submitting || title.trim().length === 0} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : (editId !== null ? <Pencil size={14} /> : <Plus size={14} />)}>
            {submitting ? (editId !== null ? "Saving…" : "Creating…") : editId !== null ? "Save changes" : "Create task"}
          </Button>
        </form>
      )}

      {phase === "loading" && <LoadingState label="Loading tasks" />}
      {phase === "error" && (
        <ErrorState title="Tasks could not be loaded" description={errorMessage ?? "Retry in a moment."} action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>} />
      )}
      {phase === "ready" && tasks.length === 0 && (
        <EmptyState title="No tasks" description={statusFilter ? `No tasks with status "${statusFilter}".` : isCollaborator && !archived ? "Create the first task to start tracking work." : "No tasks recorded for this project yet."} />
      )}
      {phase === "ready" && tasks.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {tasks.map(task => {
            const expanded = expandedId === task.id;
            return (
              <li key={task.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <button
                    type="button"
                    className="min-w-0 flex-1 text-left"
                    aria-expanded={expanded}
                    aria-label={`Task details: ${task.title}`}
                    onClick={() => setExpandedId(expanded ? null : task.id)}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-heading">{task.title}</p>
                      <Badge tone={taskStatusTone[task.status]}>{task.status}</Badge>
                      <Badge tone={priorityTone[task.priority]}>{task.priority}</Badge>
                      {task.labels.map(label => <Badge key={label} tone="neutral">{label}</Badge>)}
                    </div>
                    {task.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{task.description}</p>}
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                      <span>{task.assignee_display_name ?? "Unassigned"}</span>
                      <span>Due {formatDay(task.due_date)}</span>
                      <span className={expanded ? "text-brand" : ""}>{expanded ? "Hide details" : "Details"}</span>
                    </p>
                  </button>
                  {isCollaborator && !archived && (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="sm"
                        icon={<Pencil size={13} />}
                        aria-label={`Edit ${task.title}`}
                        onClick={() => {
                          if (expandedId === task.id) setExpandedId(null);
                          openEdit(task);
                          onNotice("");
                        }}
                      >
                        Edit
                      </Button>
                      <Select className="w-36" aria-label={`Change status of ${task.title}`} value={task.status} onChange={event => void changeStatus(task, event.target.value as ApiTaskStatus)}>
                        {TASK_STATUSES.map(option => <option key={option} value={option}>{option}</option>)}
                      </Select>
                    </div>
                  )}
                  {isManager && !archived && (
                    <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={`Delete ${task.title}`} onClick={() => void removeTask(task)}>
                      Delete
                    </Button>
                  )}
                </div>
                {expanded && (
                  <TaskDrawer
                    workspaceId={workspaceId}
                    projectId={projectId}
                    task={task}
                    getAccessToken={getAccessToken}
                    onClose={() => setExpandedId(null)}
                    onNotice={onNotice}
                    onError={onError}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Task drawer: description, subtasks, comments                        */
/* ------------------------------------------------------------------ */

function TaskDrawer({ workspaceId, projectId, task, getAccessToken, onClose, onNotice, onError }: {
  workspaceId: string;
  projectId: string;
  task: ApiTask;
  getAccessToken: () => Promise<string | null>;
  onClose: () => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [detail, setDetail] = useState<ApiTaskDetail | null>(null);
  const [subtasks, setSubtasks] = useState<ApiTaskSubtask[]>([]);
  const [comments, setComments] = useState<ApiTaskComment[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const [addingSubtask, setAddingSubtask] = useState(false);
  const [commentBody, setCommentBody] = useState("");
  const [addingComment, setAddingComment] = useState(false);

  useEffect(() => {
    let disposed = false;
    setPhase("loading");
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const [detailRow, subtaskRows, commentRows] = await Promise.all([
          projectsApi.getTaskDetail(token, workspaceId, projectId, task.id),
          projectsApi.listSubtasks(token, workspaceId, projectId, task.id),
          projectsApi.listComments(token, workspaceId, projectId, task.id),
        ]);
        if (disposed) return;
        setDetail(detailRow);
        setSubtasks(subtaskRows);
        setComments(commentRows.filter(row => row.deleted_at === null));
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load task details");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [workspaceId, projectId, task.id, getAccessToken, reloadToken]);

  async function addSubtask(event: FormEvent) {
    event.preventDefault();
    if (!subtaskTitle.trim()) return;
    setAddingSubtask(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const created = await projectsApi.createSubtask(token, workspaceId, projectId, task.id, { title: subtaskTitle.trim() });
      setSubtasks(previous => [...previous, created]);
      setSubtaskTitle("");
      onNotice("Subtask added.");
    } catch (error) {
      const friendly = friendlyError(error, "Could not add subtask");
      onError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setAddingSubtask(false);
    }
  }

  async function toggleSubtask(subtask: ApiTaskSubtask) {
    setSubtasks(previous => previous.map(item => (item.id === subtask.id ? { ...item, is_done: !item.is_done } : item)));
    try {
      const token = await getAccessToken();
      if (!token) return;
      const updated = await projectsApi.updateSubtask(token, workspaceId, projectId, task.id, subtask.id, { is_done: !subtask.is_done });
      setSubtasks(previous => previous.map(item => (item.id === updated.id ? updated : item)));
    } catch (error) {
      const friendly = friendlyError(error, "Could not update subtask");
      onError(`${friendly.title}: ${friendly.message}`);
      setSubtasks(previous => previous.map(item => (item.id === subtask.id ? subtask : item)));
    }
  }

  async function removeSubtask(subtask: ApiTaskSubtask) {
    setSubtasks(previous => previous.filter(item => item.id !== subtask.id));
    try {
      const token = await getAccessToken();
      if (!token) return;
      await projectsApi.deleteSubtask(token, workspaceId, projectId, task.id, subtask.id);
      onNotice("Subtask removed.");
    } catch (error) {
      const friendly = friendlyError(error, "Could not remove subtask");
      onError(`${friendly.title}: ${friendly.message}`);
      setReloadToken(token => token + 1);
    }
  }

  async function addComment(event: FormEvent) {
    event.preventDefault();
    if (!commentBody.trim()) return;
    setAddingComment(true);
    try {
      const token = await getAccessToken();
      if (!token) return;
      const created = await projectsApi.createComment(token, workspaceId, projectId, task.id, commentBody.trim());
      setComments(previous => [...previous, created]);
      setCommentBody("");
      onNotice("Comment posted.");
    } catch (error) {
      const friendly = friendlyError(error, "Could not post comment");
      onError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setAddingComment(false);
    }
  }

  async function removeComment(comment: ApiTaskComment) {
    if (!window.confirm("Delete this comment?")) return;
    setComments(previous => previous.filter(item => item.id !== comment.id));
    try {
      const token = await getAccessToken();
      if (!token) return;
      await projectsApi.deleteComment(token, workspaceId, projectId, task.id, comment.id);
      onNotice("Comment deleted.");
    } catch (error) {
      const friendly = friendlyError(error, "Could not delete comment");
      onError(`${friendly.title}: ${friendly.message}`);
      setReloadToken(token => token + 1);
    }
  }

  const doneCount = subtasks.filter(item => item.is_done).length;

  return (
    <div className="mt-3 space-y-4 rounded-xl border border-line bg-surface p-4">
      {phase === "loading" && <LoadingState label="Loading task details" />}
      {phase === "error" && (
        <ErrorState title="Task details could not be loaded" description={errorMessage ?? "Retry in a moment."} action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>} />
      )}
      {phase === "ready" && detail && (
        <>
          <div className="flex items-start justify-between gap-3">
            <p className="whitespace-pre-line text-sm text-muted">{detail.description || "No description."}</p>
            <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-heading">Subtasks {subtasks.length > 0 && <span className="font-normal text-muted">({doneCount}/{subtasks.length} done)</span>}</p>
            {subtasks.length === 0 && <p className="text-xs text-muted">No subtasks yet.</p>}
            {subtasks.length > 0 && (
              <ul className="space-y-1">
                {subtasks.map(subtask => (
                  <li key={subtask.id} className="flex items-center gap-2 rounded-lg border border-line px-3 py-2">
                    <input type="checkbox" checked={subtask.is_done} onChange={() => void toggleSubtask(subtask)} aria-label={`Mark subtask ${subtask.title}`} className="h-4 w-4" />
                    <p className={`min-w-0 flex-1 truncate text-xs ${subtask.is_done ? "text-muted line-through" : "text-heading"}`}>{subtask.title}</p>
                    <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} aria-label={`Remove subtask ${subtask.title}`} onClick={() => void removeSubtask(subtask)}>Remove</Button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addSubtask} className="flex flex-wrap items-end gap-2">
              <TextInput className="min-w-0 flex-1" maxLength={240} value={subtaskTitle} onChange={event => setSubtaskTitle(event.target.value)} placeholder="New subtask" aria-label="New subtask title" />
              <Button type="submit" size="sm" disabled={addingSubtask || subtaskTitle.trim().length === 0}>
                Add
              </Button>
            </form>
          </div>

          <div className="space-y-2">
            <p className="text-xs font-semibold text-heading">Comments {comments.length > 0 && <span className="font-normal text-muted">({comments.length})</span>}</p>
            {comments.length === 0 && <p className="text-xs text-muted">No comments yet.</p>}
            {comments.length > 0 && (
              <ul className="space-y-1">
                {comments.map(comment => (
                  <li key={comment.id} className="flex items-start gap-2 rounded-lg border border-line px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[10px] text-muted">{comment.author_display_name} · {shortDate(comment.created_at)}</p>
                      <p className="mt-0.5 whitespace-pre-line text-xs text-heading">{comment.body ?? ""}</p>
                    </div>
                    <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} aria-label="Delete comment" onClick={() => void removeComment(comment)}>Delete</Button>
                  </li>
                ))}
              </ul>
            )}
            <form onSubmit={addComment} className="space-y-2">
              <Textarea rows={2} maxLength={20000} value={commentBody} onChange={event => setCommentBody(event.target.value)} placeholder="Write a comment…" aria-label="New comment" />
              <Button type="submit" size="sm" disabled={addingComment || commentBody.trim().length === 0}>
                Post comment
              </Button>
            </form>
          </div>
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Meetings                                                            */
/* ------------------------------------------------------------------ */

const MEETING_TYPES: ApiMeetingType[] = ["Team sync", "Review", "Planning", "Retrospective", "Other"];

function formatDateTime(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? value
    : parsed.toLocaleString("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

/** Convert a UTC instant to the `datetime-local` input format in local time. */
function toLocalInput(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

function MeetingsPanel({ workspaceId, projectId, members, isCollaborator, canManageMeetings, archived, identityUserId, getAccessToken, onNotice, onError }: {
  workspaceId: string;
  projectId: string;
  members: ApiProjectMember[];
  isCollaborator: boolean;
  canManageMeetings: boolean;
  archived: boolean;
  identityUserId: string;
  getAccessToken: () => Promise<string | null>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [meetings, setMeetings] = useState<ApiMeeting[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [startAt, setStartAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [meetingType, setMeetingType] = useState<ApiMeetingType>("Team sync");
  const [agenda, setAgenda] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Meeting currently being edited; null means the open form creates. */
  const [editId, setEditId] = useState<string | null>(null);
  // Attendee management: loaded lazily per meeting on first expand.
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null);
  const [attendeesByMeeting, setAttendeesByMeeting] = useState<Record<string, ApiMeetingAttendee[]>>({});
  const [attendeeLoadState, setAttendeeLoadState] = useState<Record<string, "loading" | "ready" | "error">>({});
  const [addSelection, setAddSelection] = useState("");
  const [busyAttendeeKey, setBusyAttendeeKey] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const rows = await projectsApi.listMeetings(token, workspaceId, projectId, { limit: 100 });
        if (disposed) return;
        setMeetings(rows);
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load meetings");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [workspaceId, projectId, getAccessToken, reloadToken]);

  // Attendee caches belong to one project scope; clear them when it changes.
  useEffect(() => {
    setAttendeesByMeeting({});
    setAttendeeLoadState({});
    setExpandedMeetingId(null);
    setAddSelection("");
  }, [workspaceId, projectId]);

  async function loadAttendees(meetingId: string) {
    const token = await getAccessToken();
    if (!token) {
      setAttendeeLoadState(state => ({ ...state, [meetingId]: "error" }));
      return;
    }
    try {
      const rows = await projectsApi.listAttendees(token, workspaceId, projectId, meetingId);
      setAttendeesByMeeting(state => ({ ...state, [meetingId]: rows }));
      setAttendeeLoadState(state => ({ ...state, [meetingId]: "ready" }));
    } catch (error) {
      const friendly = friendlyError(error, "Could not load attendees");
      onError(`${friendly.title}: ${friendly.message}`);
      setAttendeeLoadState(state => ({ ...state, [meetingId]: "error" }));
    }
  }

  async function toggleAttendees(meeting: ApiMeeting) {
    const next = expandedMeetingId === meeting.id ? null : meeting.id;
    setExpandedMeetingId(next);
    if (next && attendeesByMeeting[next] === undefined) {
      setAttendeeLoadState(state => ({ ...state, [next]: "loading" }));
      void loadAttendees(next);
    }
  }

  async function removeAttendeeAction(meeting: ApiMeeting, attendee: ApiMeetingAttendee) {
    const selfRemoval = attendee.user_id === identityUserId;
    const confirmed = window.confirm(
      selfRemoval
        ? `Leave "${meeting.title}"? You can be re-added by a manager.`
        : `Remove ${attendee.display_name} from "${meeting.title}"?`,
    );
    if (!confirmed) return;
    const key = `${meeting.id}:${attendee.user_id}`;
    const previous = attendeesByMeeting[meeting.id] ?? [];
    setBusyAttendeeKey(key);
    // Optimistic removal with rollback: the chip disappears immediately.
    setAttendeesByMeeting(state => ({ ...state, [meeting.id]: previous.filter(item => item.user_id !== attendee.user_id) }));
    setMeetings(list => list.map(item => (item.id === meeting.id ? { ...item, attendee_count: Math.max(0, item.attendee_count - 1) } : item)));
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      await projectsApi.removeAttendee(token, workspaceId, projectId, meeting.id, attendee.user_id);
      onNotice(selfRemoval ? `You left "${meeting.title}".` : `${attendee.display_name} removed from "${meeting.title}".`);
    } catch (error) {
      const friendly = friendlyError(error, "Could not update attendees");
      onError(`${friendly.title}: ${friendly.message}`);
      void loadAttendees(meeting.id);
    } finally {
      setBusyAttendeeKey(null);
    }
  }

  async function addAttendeeAction(meeting: ApiMeeting) {
    if (!addSelection) return;
    const member = members.find(item => item.user_id === addSelection);
    if (!member) return;
    const key = `${meeting.id}:add`;
    setBusyAttendeeKey(key);
    const optimistic: ApiMeetingAttendee = { user_id: member.user_id, display_name: member.display_name, created_at: new Date().toISOString() };
    setAttendeesByMeeting(state => ({
      ...state,
      [meeting.id]: [...(state[meeting.id] ?? []), optimistic].sort((a, b) => a.display_name.localeCompare(b.display_name)),
    }));
    setMeetings(list => list.map(item => (item.id === meeting.id ? { ...item, attendee_count: item.attendee_count + 1 } : item)));
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      const created = await projectsApi.addAttendee(token, workspaceId, projectId, meeting.id, member.user_id);
      // Swap the optimistic row for the server's authoritative record.
      setAttendeesByMeeting(state => ({
        ...state,
        [meeting.id]: (state[meeting.id] ?? []).map(item => (item.user_id === created.user_id ? created : item)).sort((a, b) => a.display_name.localeCompare(b.display_name)),
      }));
      onNotice(`${created.display_name} added to "${meeting.title}".`);
      setAddSelection("");
    } catch (error) {
      const friendly = friendlyError(error, "Could not add attendee");
      onError(`${friendly.title}: ${friendly.message}`);
      void loadAttendees(meeting.id);
    } finally {
      setBusyAttendeeKey(null);
    }
  }

  function startEdit(meeting: ApiMeeting) {
    setTitle(meeting.title);
    setDescription(meeting.description);
    setStartAt(toLocalInput(meeting.starts_at));
    setDuration(meeting.duration_minutes);
    setMeetingType(meeting.meeting_type);
    setAgenda(meeting.agenda);
    setEditId(meeting.id);
    setFormError(null);
    setFormOpen(true);
  }

  function resetForm() {
    setTitle("");
    setDescription("");
    setStartAt("");
    setDuration(60);
    setMeetingType("Team sync");
    setAgenda("");
    setEditId(null);
    setFormError(null);
  }

  async function submitMeetingForm(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setFormError("Sign-in session ended. Please sign in again.");
        return;
      }
      const starts = new Date(startAt);
      if (Number.isNaN(starts.getTime())) {
        setFormError("Pick a start date and time.");
        return;
      }
      if (editId !== null) {
        // PATCH contract: any non-null subset of fields; only changed fields
        // are sent so unrelated manager notes never trigger `meeting.updated`.
        const meeting = meetings.find(item => item.id === editId);
        if (!meeting) {
          setFormError("This meeting no longer exists.");
          return;
        }
        const patch: {
          title?: string;
          description?: string;
          starts_at?: string;
          duration_minutes?: number;
          meeting_type?: ApiMeetingType;
          agenda?: string;
        } = {};
        if (title.trim() !== meeting.title) patch.title = title.trim();
        if (description.trim() !== meeting.description) patch.description = description.trim();
        if (starts.toISOString() !== meeting.starts_at) patch.starts_at = starts.toISOString();
        if (duration !== meeting.duration_minutes) patch.duration_minutes = duration;
        if (meetingType !== meeting.meeting_type) patch.meeting_type = meetingType;
        if (agenda.trim() !== meeting.agenda) patch.agenda = agenda.trim();
        if (Object.keys(patch).length === 0) {
          onNotice("");
          resetForm();
          setFormOpen(false);
          return;
        }
        const updated = await projectsApi.updateMeeting(token, workspaceId, projectId, editId, patch);
        setMeetings(previous => previous.map(item => (item.id === updated.id ? updated : item)));
        onNotice(`Meeting "${updated.title}" updated.`);
      } else {
        const created = await projectsApi.createMeeting(token, workspaceId, projectId, {
          title: title.trim(),
          description: description.trim(),
          starts_at: starts.toISOString(),
          duration_minutes: duration,
          meeting_type: meetingType,
          agenda: agenda.trim(),
        });
        setMeetings(previous => [...previous, created]);
        onNotice(`Meeting "${created.title}" scheduled.`);
      }
      resetForm();
      setFormOpen(false);
    } catch (error) {
      const friendly = friendlyError(error, editId !== null ? "Could not update meeting" : "Could not schedule meeting");
      setFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMeeting(meeting: ApiMeeting) {
    if (!window.confirm(`Delete meeting "${meeting.title}"?`)) return;
    setMeetings(previous => previous.filter(item => item.id !== meeting.id));
    if (editId === meeting.id) resetForm();
    setAttendeesByMeeting(state => {
      const next = { ...state };
      delete next[meeting.id];
      return next;
    });
    try {
      const token = await getAccessToken();
      if (!token) return;
      await projectsApi.deleteMeeting(token, workspaceId, projectId, meeting.id);
      onNotice(`Meeting "${meeting.title}" deleted.`);
    } catch (error) {
      const friendly = friendlyError(error, "Could not delete meeting");
      onError(`${friendly.title}: ${friendly.message}`);
      setReloadToken(token => token + 1);
    }
  }

  const sorted = [...meetings].sort((a, b) => a.starts_at.localeCompare(b.starts_at));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        {isCollaborator && !archived && (
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => { if (formOpen) { setFormOpen(false); } else { resetForm(); setFormOpen(true); } onNotice(""); }}>
            {formOpen ? "Cancel" : "Schedule meeting"}
          </Button>
        )}
      </div>

      {formOpen && isCollaborator && !archived && (
        <form onSubmit={submitMeetingForm} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <p className="text-[10px] font-medium uppercase tracking-wide text-muted">{editId !== null ? "Editing meeting" : "New meeting"}</p>
          <TextInput label="Title" required maxLength={200} value={title} onChange={event => setTitle(event.target.value)} placeholder="Weekly review" />
          <label className="block space-y-1.5">
            <span className="ui-label">Starts at</span>
            <input type="datetime-local" required className="ui-input" value={startAt} onChange={event => setStartAt(event.target.value)} />
          </label>
          <div className="flex flex-wrap gap-3">
            <Select label="Type" className="w-44" value={meetingType} onChange={event => setMeetingType(event.target.value as ApiMeetingType)}>
              {MEETING_TYPES.map(option => <option key={option} value={option}>{option}</option>)}
            </Select>
            <label className="block flex-1 space-y-1.5">
              <span className="ui-label">Duration (minutes)</span>
              <input type="number" min={1} max={1440} required className="ui-input" value={duration} onChange={event => setDuration(Number(event.target.value) || 0)} />
            </label>
          </div>
          <Textarea label="Description" rows={2} maxLength={20000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Optional notes for attendees" />
          <Textarea label="Agenda" rows={3} maxLength={20000} value={agenda} onChange={event => setAgenda(event.target.value)} placeholder="Optional structured agenda — shown on the meeting record" />
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <Button type="submit" variant="primary" size="sm" disabled={submitting} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : (editId !== null ? <Pencil size={14} /> : <Plus size={14} />)}>
            {submitting ? (editId !== null ? "Saving…" : "Scheduling…") : (editId !== null ? "Save changes" : "Schedule meeting")}
          </Button>
        </form>
      )}

      {phase === "loading" && <LoadingState label="Loading meetings" />}
      {phase === "error" && (
        <ErrorState title="Meetings could not be loaded" description={errorMessage ?? "Retry in a moment."} action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>} />
      )}
      {phase === "ready" && sorted.length === 0 && (
        <EmptyState title="No meetings" description={isCollaborator && !archived ? "Schedule the first meeting for this project." : "No meetings recorded for this project yet."} />
      )}
      {phase === "ready" && sorted.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {sorted.map(meeting => {
            const expanded = expandedMeetingId === meeting.id;
            const attendeeRows = attendeesByMeeting[meeting.id] ?? [];
            const attendeeIds = new Set(attendeeRows.map(item => item.user_id));
            const addable = members.filter(item => item.workspace_member_active && !attendeeIds.has(item.user_id));
            const attendeeState = attendeeLoadState[meeting.id] ?? "loading";
            return (
              <li key={meeting.id} className="p-4">
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-semibold text-heading">{meeting.title}</p>
                      <Badge tone="brand">{meeting.meeting_type}</Badge>
                    </div>
                    {meeting.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{meeting.description}</p>}
                    {meeting.agenda && (
                      <div className="mt-2 rounded-lg border border-line bg-hover px-3 py-2">
                        <p className="text-[10px] font-semibold uppercase tracking-wide text-muted">Agenda</p>
                        <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-secondary">{meeting.agenda}</p>
                      </div>
                    )}
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                      <span>{formatDateTime(meeting.starts_at)}</span>
                      <span>{meeting.duration_minutes} min</span>
                      <span>{meeting.attendee_count} attendee{meeting.attendee_count === 1 ? "" : "s"}</span>
                      {meeting.organizer_display_name && <span>Organizer: {meeting.organizer_display_name}</span>}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {canManageMeetings && !archived && (
                      <Button variant="ghost" size="sm" icon={<Pencil size={13} />} aria-label={`Edit ${meeting.title}`} disabled={busyAttendeeKey !== null} onClick={() => { startEdit(meeting); onNotice(""); }}>
                        Edit
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={`Delete ${meeting.title}`} onClick={() => void removeMeeting(meeting)}>
                      Delete
                    </Button>
                  </div>
                </div>

                <div className="mt-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    icon={<Users size={13} />}
                    aria-expanded={expanded}
                    aria-controls={`attendees-${meeting.id}`}
                    onClick={() => void toggleAttendees(meeting)}
                  >
                    {expanded ? "Hide attendees" : "Attendees"}
                  </Button>
                </div>

                {expanded && (
                  <div id={`attendees-${meeting.id}`} className="mt-2 space-y-2 rounded-xl border border-line bg-hover/40 p-3">
                    {attendeeState === "loading" && <LoadingState label="Loading attendees" />}
                    {attendeeState === "error" && (
                      <ErrorState
                        title="Attendees could not be loaded"
                        description="Retry in a moment."
                        action={<Button size="sm" onClick={() => { setAttendeeLoadState(state => ({ ...state, [meeting.id]: "loading" })); void loadAttendees(meeting.id); }}>Retry</Button>}
                      />
                    )}
                    {attendeeState === "ready" && (
                      <>
                        {attendeeRows.length === 0 && (
                          <p className="text-xs text-muted">
                            No attendees yet.{canManageMeetings && !archived && addable.length > 0 ? " Add a project member below." : canManageMeetings ? " All project members are already attendees, or none can be." : " A manager adds attendees."}
                          </p>
                        )}
                        {attendeeRows.length > 0 && (
                          <ul className="flex flex-wrap gap-2">
                            {attendeeRows.map(attendee => {
                              const self = attendee.user_id === identityUserId;
                              const canRemove = canManageMeetings || self;
                              const busy = busyAttendeeKey === `${meeting.id}:${attendee.user_id}`;
                              return (
                                <li key={attendee.user_id} className="flex items-center gap-2 rounded-full border border-line bg-surface py-1 pl-1 pr-2">
                                  <span className="grid h-6 w-6 place-items-center rounded-full bg-hover text-[9px] font-semibold text-secondary">
                                    {attendee.display_name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}
                                  </span>
                                  <span className="text-[11px] font-medium text-heading">
                                    {attendee.display_name}
                                    {self && <span className="ml-1 text-[10px] text-muted">(you)</span>}
                                  </span>
                                  {canRemove && !archived && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      aria-label={self ? `Leave ${meeting.title}` : `Remove ${attendee.display_name} from ${meeting.title}`}
                                      disabled={busyAttendeeKey !== null}
                                      className="!px-1.5 !py-0"
                                      icon={busy ? <Loader2 size={12} className="animate-spin" /> : <UserMinus size={12} />}
                                      onClick={() => void removeAttendeeAction(meeting, attendee)}
                                    >
                                      {self ? "Leave" : "Remove"}
                                    </Button>
                                  )}
                                </li>
                              );
                            })}
                          </ul>
                        )}
                        {canManageMeetings && !archived && (
                          <div className="flex flex-wrap items-end gap-2">
                            <Select
                              aria-label={`Add attendee to ${meeting.title}`}
                              className="w-56"
                              value={addSelection}
                              disabled={busyAttendeeKey !== null || addable.length === 0}
                              onChange={event => setAddSelection(event.target.value)}
                            >
                              <option value="">{addable.length === 0 ? "No members left to add" : "Select a project member…"}</option>
                              {addable.map(item => <option key={item.user_id} value={item.user_id}>{item.display_name}</option>)}
                            </Select>
                            <Button
                              variant="primary"
                              size="sm"
                              icon={busyAttendeeKey === `${meeting.id}:add` ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}
                              disabled={!addSelection || busyAttendeeKey !== null}
                              onClick={() => void addAttendeeAction(meeting)}
                            >
                              Add attendee
                            </Button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-[10px] text-muted">
        {members.length} project member{members.length === 1 ? "" : "s"} — attendees must be project members. Managers add and remove attendees; everyone can leave a meeting themselves.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Resources                                                           */
/* ------------------------------------------------------------------ */

const RESOURCE_TYPES: ApiResourceType[] = ["Document", "Spreadsheet", "Design file", "Folder", "Link"];

function ResourcesPanel({ workspaceId, projectId, isCollaborator, archived, getAccessToken, onNotice, onError }: {
  workspaceId: string;
  projectId: string;
  isCollaborator: boolean;
  archived: boolean;
  getAccessToken: () => Promise<string | null>;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [resources, setResources] = useState<ApiResource[]>([]);
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [formOpen, setFormOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("" as ApiResourceType | "");
  const [starredOnly, setStarredOnly] = useState(false);
  const [name, setName] = useState("");
  const [resourceType, setResourceType] = useState<ApiResourceType>("Link");
  const [category, setCategory] = useState("");
  const [detail, setDetail] = useState("");
  const [externalUrl, setExternalUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const rows = await projectsApi.listResources(token, workspaceId, projectId, { limit: 100, type: typeFilter || undefined });
        if (disposed) return;
        setResources(rows);
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load resources");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [workspaceId, projectId, typeFilter, getAccessToken, reloadToken]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setFormError("Sign-in session ended. Please sign in again.");
        return;
      }
      const created = await projectsApi.createResource(token, workspaceId, projectId, {
        name: name.trim(),
        type: resourceType,
        category: category.trim(),
        detail: detail.trim(),
        external_url: externalUrl.trim() || null,
      });
      setResources(previous => [created, ...previous]);
      onNotice(`Resource "${created.name}" added.`);
      setName("");
      setCategory("");
      setDetail("");
      setExternalUrl("");
      setFormOpen(false);
    } catch (error) {
      const friendly = friendlyError(error, "Could not add resource");
      setFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleStar(resource: ApiResource) {
    setResources(previous => previous.map(item => (item.id === resource.id ? { ...item, is_starred: !item.is_starred } : item)));
    try {
      const token = await getAccessToken();
      if (!token) return;
      const star = await projectsApi.toggleResourceStar(token, workspaceId, projectId, resource.id);
      setResources(previous => previous.map(item => (item.id === star.resource_id ? { ...item, is_starred: star.starred } : item)));
    } catch (error) {
      const friendly = friendlyError(error, "Could not update star");
      onError(`${friendly.title}: ${friendly.message}`);
      setResources(previous => previous.map(item => (item.id === resource.id ? resource : item)));
    }
  }

  async function removeResource(resource: ApiResource) {
    if (!window.confirm(`Delete resource "${resource.name}"?`)) return;
    setResources(previous => previous.filter(item => item.id !== resource.id));
    try {
      const token = await getAccessToken();
      if (!token) return;
      await projectsApi.deleteResource(token, workspaceId, projectId, resource.id);
      onNotice(`Resource "${resource.name}" deleted.`);
    } catch (error) {
      const friendly = friendlyError(error, "Could not delete resource");
      onError(`${friendly.title}: ${friendly.message}`);
      setReloadToken(token => token + 1);
    }
  }

  const filterButton = "rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-medium text-muted hover:text-heading";
  const sorted = [...resources]
    .filter(item => !starredOnly || item.is_starred)
    .sort((a, b) => Number(b.is_starred) - Number(a.is_starred) || b.updated_at.localeCompare(a.updated_at));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <Select label="Type" className="w-40" aria-label="Filter resources by type" value={typeFilter} onChange={event => setTypeFilter(event.target.value as ApiResourceType | "")}>
            <option value="">All types</option>
            {RESOURCE_TYPES.map(option => <option key={option} value={option}>{option}</option>)}
          </Select>
          <button type="button" className={starredOnly ? `${filterButton} border-brand bg-brand-soft text-brand` : filterButton} aria-pressed={starredOnly} onClick={() => setStarredOnly(value => !value)}>
            ★ Starred
          </button>
        </div>
        {isCollaborator && !archived && (
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => { setFormOpen(open => !open); onNotice(""); }}>
            {formOpen ? "Cancel" : "Add resource"}
          </Button>
        )}
      </div>

      {formOpen && isCollaborator && !archived && (
        <form onSubmit={submitCreate} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <TextInput label="Name" required maxLength={240} value={name} onChange={event => setName(event.target.value)} placeholder="Design system Figma" />
          <Select label="Type" value={resourceType} onChange={event => setResourceType(event.target.value as ApiResourceType)}>
            {RESOURCE_TYPES.map(option => <option key={option} value={option}>{option}</option>)}
          </Select>
          <TextInput label="Category" required maxLength={100} value={category} onChange={event => setCategory(event.target.value)} placeholder="Design" />
          <TextInput label="Link URL" type="url" maxLength={2048} value={externalUrl} onChange={event => setExternalUrl(event.target.value)} placeholder="https://…" hint="Optional; upload support comes later" />
          <Textarea label="Detail" rows={2} maxLength={20000} value={detail} onChange={event => setDetail(event.target.value)} placeholder="Short description" />
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <Button type="submit" variant="primary" size="sm" disabled={submitting} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
            {submitting ? "Adding…" : "Add resource"}
          </Button>
        </form>
      )}

      {phase === "loading" && <LoadingState label="Loading resources" />}
      {phase === "error" && (
        <ErrorState title="Resources could not be loaded" description={errorMessage ?? "Retry in a moment."} action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>} />
      )}
      {phase === "ready" && sorted.length === 0 && (
        <EmptyState title="No resources" description={isCollaborator && !archived ? "Add the first link or document reference." : "No resources recorded for this project yet."} />
      )}
      {phase === "ready" && sorted.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {sorted.map(resource => (
            <li key={resource.id} className="flex flex-wrap items-start gap-3 p-4">
              <button type="button" aria-label={resource.is_starred ? `Unstar ${resource.name}` : `Star ${resource.name}`} className="text-lg leading-6" onClick={() => void toggleStar(resource)}>
                {resource.is_starred ? "★" : "☆"}
              </button>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-heading">{resource.name}</p>
                  <Badge tone="neutral">{resource.type}</Badge>
                </div>
                {resource.external_url && (
                  <a href={resource.external_url} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-brand underline">{resource.external_url}</a>
                )}
                {resource.detail && <p className="mt-1 line-clamp-2 text-xs text-muted">{resource.detail}</p>}
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                  <span>{resource.category}</span>
                  {resource.owner_display_name && <span>Owner: {resource.owner_display_name}</span>}
                </p>
              </div>
              <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={`Delete ${resource.name}`} onClick={() => void removeResource(resource)}>
                Delete
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Members                                                             */
/* ------------------------------------------------------------------ */

const PROJECT_ROLES: ApiProjectRole[] = ["Project Member", "Project Manager"];

function MembersPanel({ workspaceId, projectId, members, canManage, identityUserId, archived, milestones, getAccessToken, onChanged, onNotice, onError }: {
  workspaceId: string;
  projectId: string;
  members: ApiProjectMember[];
  canManage: boolean;
  identityUserId: string;
  archived: boolean;
  milestones: number;
  getAccessToken: () => Promise<string | null>;
  onChanged: () => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [workspaceMembers, setWorkspaceMembers] = useState<ApiWorkspaceMember[]>([]);
  const [rosterPhase, setRosterPhase] = useState<"loading" | "ready" | "error">("loading");
  const [reloadToken, setReloadToken] = useState(0);
  const [addUserId, setAddUserId] = useState("");
  const [addRole, setAddRole] = useState<ApiProjectRole>("Project Member");
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // The workspace roster is only needed for managers, and only to fill the
  // "add member" picker.
  useEffect(() => {
    if (!canManage || archived) return;
    let disposed = false;
    setRosterPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const rows = await workspaceApi.listMembers(token, workspaceId);
        if (disposed) return;
        setWorkspaceMembers(rows.filter(row => row.role !== "Owner"));
        setRosterPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load workspace members");
        setRosterPhase("ready");
        onError(`${friendly.title}: ${friendly.message}`);
      }
    })();
    return () => { disposed = true; };
  }, [canManage, archived, workspaceId, getAccessToken, reloadToken]);

  const memberIds = new Set(members.map(item => item.user_id));
  // Exclude Owner (ownership transfer is a separate slice) and anyone already
  // on the project. Remove-after-add lands in the picker immediately.
  const addable = workspaceMembers.filter(item => !memberIds.has(item.user_id));

  async function addMember(event: FormEvent) {
    event.preventDefault();
    if (!addUserId) return;
    const member = workspaceMembers.find(item => item.user_id === addUserId);
    if (!member) return;
    setBusyKey("add");
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      const created = await projectsApi.addProjectMember(token, workspaceId, projectId, {
        user_id: member.user_id,
        role: addRole,
      });
      setAddUserId("");
      setAddRole("Project Member");
      onNotice(`${created.display_name} added as ${created.role.toLowerCase()}.`);
      onChanged();
    } catch (error) {
      const friendly = friendlyError(error, "Could not add member");
      onError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function changeRole(member: ApiProjectMember, role: ApiProjectRole) {
    const key = `role:${member.user_id}`;
    setBusyKey(key);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      const updated = await projectsApi.updateProjectMemberRole(token, workspaceId, projectId, member.user_id, role);
      onNotice(`${updated.display_name} is now ${updated.role.toLowerCase()}.`);
      onChanged();
    } catch (error) {
      const friendly = friendlyError(error, "Could not change role");
      onError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setBusyKey(null);
    }
  }

  async function removeMember(member: ApiProjectMember) {
    const self = member.user_id === identityUserId;
    const confirmed = window.confirm(
      self
        ? "Leave this project? A manager can re-add you later."
        : `Remove ${member.display_name} from this project?`,
    );
    if (!confirmed) return;
    const key = `remove:${member.user_id}`;
    setBusyKey(key);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      await projectsApi.removeProjectMember(token, workspaceId, projectId, member.user_id);
      onNotice(self ? `You left this project.` : `${member.display_name} removed from this project.`);
      onChanged();
    } catch (error) {
      const friendly = friendlyError(error, "Could not remove member");
      onError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <div className="space-y-3">
      {canManage && !archived && rosterPhase === "ready" && (
        <form onSubmit={addMember} className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
          <Select
            label="Workspace member"
            className="min-w-0 flex-1"
            value={addUserId}
            disabled={addable.length === 0}
            onChange={event => setAddUserId(event.target.value)}
          >
            <option value="">{addable.length === 0 ? "Everyone eligible is already on the project" : "Select a workspace member…"}</option>
            {addable.map(item => <option key={item.user_id} value={item.user_id}>{item.display_name}</option>)}
          </Select>
          <Select label="Project role" className="w-52" value={addRole} onChange={event => setAddRole(event.target.value as ApiProjectRole)}>
            {PROJECT_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
          </Select>
          <Button type="submit" variant="primary" size="sm" disabled={!addUserId || busyKey !== null} icon={busyKey === "add" ? <Loader2 size={13} className="animate-spin" /> : <UserPlus size={13} />}>
            Add member
          </Button>
        </form>
      )}
      {canManage && !archived && rosterPhase === "loading" && <LoadingState label="Loading workspace members" />}

      <ul className="grid gap-2 lg:grid-cols-2">
        {members.map(member => {
          const self = member.user_id === identityUserId;
          const busy = busyKey !== null;
          return (
            <li key={member.user_id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-heading">{member.display_name}{self && <span className="ml-1 text-[10px] text-muted">(you)</span>}</p>
                  <Badge tone={member.role === "Project Manager" ? "brand" : "neutral"}>{member.role}</Badge>
                  {!member.workspace_member_active && <Badge tone="warning">Inactive workspace member</Badge>}
                </div>
                {member.job_title && <p className="mt-1 text-xs text-muted">{member.job_title}</p>}
              </div>
              {!archived && (
                <div className="flex items-center gap-1">
                  {canManage && (
                    <Select
                      className="w-44"
                      aria-label={`Project role of ${member.display_name}`}
                      value={member.role}
                      disabled={busy}
                      onChange={event => void changeRole(member, event.target.value as ApiProjectRole)}
                    >
                      {PROJECT_ROLES.map(role => <option key={role} value={role}>{role}</option>)}
                    </Select>
                  )}
                  {(canManage || self) && (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon={busy ? <Loader2 size={14} className="animate-spin" /> : <UserMinus size={14} />}
                      aria-label={self ? `Leave this project` : `Remove ${member.display_name} from this project`}
                      disabled={busy}
                      onClick={() => void removeMember(member)}
                    >
                      {self ? "Leave" : "Remove"}
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-muted">
        {members.length} project member{members.length === 1 ? "" : "s"} · {milestones} milestone{milestones === 1 ? "" : "s"} tracked.
        {canManage && !archived ? " Managers add members from the workspace roster, change roles, and remove people." : members.some(item => item.user_id === identityUserId) ? " You can leave this project at any time." : " A manager manages this project's members."}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

function MilestonesPanel({ workspaceId, projectId, milestones, canManage, archived, getAccessToken, onChanged, onNotice, onError }: {
  workspaceId: string;
  projectId: string;
  milestones: ApiMilestone[];
  canManage: boolean;
  archived: boolean;
  getAccessToken: () => Promise<string | null>;
  onChanged: () => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [name, setName] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  /** Milestone being edited inline; null means the form creates. */
  const [editId, setEditId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDue, setEditDue] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const sorted = [...milestones].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const today = new Date().toISOString().slice(0, 10);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setFormError("Sign-in session ended. Please sign in again.");
        return;
      }
      const created = await projectsApi.createMilestone(token, workspaceId, projectId, { name: name.trim(), due_date: dueDate });
      onNotice(`Milestone "${created.name}" created.`);
      onChanged();
      setName("");
      setDueDate("");
    } catch (error) {
      const friendly = friendlyError(error, "Could not create milestone");
      setFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  function startEdit(milestone: ApiMilestone) {
    setEditId(milestone.id);
    setEditName(milestone.name);
    setEditDue(milestone.due_date);
  }

  function cancelEdit() {
    setEditId(null);
    setEditName("");
    setEditDue("");
  }

  async function submitEdit(event: FormEvent) {
    event.preventDefault();
    if (!editId) return;
    const editing = milestones.find(item => item.id === editId);
    if (!editing) return;
    setBusyId(editId);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign-in session ended. Please sign in again.");
      // PATCH contract: only send the fields that actually changed.
      const patch: { name?: string; due_date?: string } = {};
      if (editName.trim() !== editing.name) patch.name = editName.trim();
      if (editDue !== editing.due_date) patch.due_date = editDue;
      if (Object.keys(patch).length > 0) {
        const updated = await projectsApi.updateMilestone(token, workspaceId, projectId, editId, patch);
        onNotice(`Milestone "${updated.name}" updated.`);
        onChanged();
      }
      cancelEdit();
    } catch (error) {
      const friendly = friendlyError(error, "Could not update milestone");
      onError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setBusyId(null);
    }
  }

  async function removeMilestone(milestone: ApiMilestone) {
    if (!window.confirm(`Delete milestone "${milestone.name}"?`)) return;
    setBusyId(milestone.id);
    try {
      const token = await getAccessToken();
      if (!token) return;
      await projectsApi.deleteMilestone(token, workspaceId, projectId, milestone.id);
      onNotice(`Milestone "${milestone.name}" deleted.`);
      onChanged();
    } catch (error) {
      const friendly = friendlyError(error, "Could not delete milestone");
      onError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-3">
      {canManage && !archived && (
        <form onSubmit={submitCreate} className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-4">
          <TextInput label="Milestone name" required maxLength={160} className="min-w-0 flex-1" value={name} onChange={event => setName(event.target.value)} placeholder="Public beta" />
          <label className="block space-y-1.5">
            <span className="ui-label">Due date</span>
            <input type="date" required className="ui-input" value={dueDate} onChange={event => setDueDate(event.target.value)} />
          </label>
          <Button type="submit" variant="primary" size="sm" disabled={submitting} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
            {submitting ? "Creating…" : "Add milestone"}
          </Button>
          {formError && <p className="w-full text-xs text-danger">{formError}</p>}
        </form>
      )}
      {sorted.length === 0 && (
        <EmptyState title="No milestones" description={canManage && !archived ? "Mark a target date the team can aim for." : "No milestones have been set for this project yet."} />
      )}
      {sorted.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {sorted.map(milestone => {
            const overdue = milestone.due_date < today;
            const editing = editId === milestone.id;
            const rowBusy = busyId === milestone.id;
            return (
              <li key={milestone.id} className="flex flex-wrap items-center gap-3 p-4">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                {editing ? (
                  <form onSubmit={submitEdit} className="flex min-w-0 flex-1 flex-wrap items-end gap-3">
                    <TextInput className="min-w-0 flex-1" required maxLength={160} value={editName} onChange={event => setEditName(event.target.value)} aria-label="Milestone name" />
                    <label className="space-y-1.5">
                      <span className="ui-label">Due date</span>
                      <input type="date" required className="ui-input" value={editDue} onChange={event => setEditDue(event.target.value)} />
                    </label>
                    <Button type="submit" variant="primary" size="sm" disabled={rowBusy} icon={rowBusy ? <Loader2 size={13} className="animate-spin" /> : undefined}>
                      Save
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={cancelEdit}>Cancel</Button>
                  </form>
                ) : (
                  <>
                    <p className="min-w-0 flex-1 truncate text-sm font-semibold text-heading">{milestone.name}</p>
                    {overdue && <Badge tone="danger">Overdue</Badge>}
                    <span className="text-[10px] text-muted">Due {formatDay(milestone.due_date)}</span>
                    {canManage && !archived && (
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" icon={<Pencil size={13} />} aria-label={`Edit ${milestone.name}`} disabled={busyId !== null} onClick={() => startEdit(milestone)}>
                          Edit
                        </Button>
                        <Button variant="ghost" size="sm" icon={<Trash2 size={13} />} aria-label={`Delete ${milestone.name}`} disabled={busyId !== null} onClick={() => void removeMilestone(milestone)}>
                          Delete
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Overview: KPIs, delivery, milestones, team, project activity        */
/* ------------------------------------------------------------------ */

function OverviewPanel({ workspaceId, projectId, project, members, milestones, getAccessToken, onNavigateTab }: {
  workspaceId: string;
  projectId: string;
  project: ApiProject;
  members: ApiProjectMember[];
  milestones: ApiMilestone[];
  getAccessToken: () => Promise<string | null>;
  /** Deep links from overview panels into sibling tabs. */
  onNavigateTab: (tab: RealProjectTab) => void;
}) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const [tasks, setTasks] = useState<ApiTask[]>([]);
  const [activities, setActivities] = useState<ApiActivity[]>([]);
  const [resources, setResources] = useState<ApiResource[]>([]);

  useEffect(() => {
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        const [taskRows, activityPage, resourceRows] = await Promise.all([
          projectsApi.listTasks(token, workspaceId, projectId, { limit: 100, sort_by: "position" }),
          activitiesApi.listProjectActivities(token, workspaceId, projectId, { limit: 10 }),
          projectsApi.listResources(token, workspaceId, projectId, { limit: 100 }),
        ]);
        if (disposed) return;
        setTasks(taskRows);
        setActivities(activityPage.items);
        setResources(resourceRows.filter(row => row.deleted_at === null));
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load the project overview");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [workspaceId, projectId, getAccessToken, reloadToken]);

  if (phase === "loading") return <LoadingState label="Loading project overview" />;
  if (phase === "error") {
    return (
      <ErrorState title="Overview could not be loaded" description={errorMessage ?? "Retry in a moment."} action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>} />
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const completedTasks = tasks.filter(task => task.status === "Complete");
  const openTasks = tasks.filter(task => task.status !== "Complete");
  const byStatus = (status: ApiTaskStatus) => tasks.filter(task => task.status === status).length;
  const overdueTasks = openTasks.filter(task => task.due_date !== null && task.due_date < today);
  const inReviewCount = byStatus("In review");
  const deployed = project.progress_mode === "manual";
  const progress = deployed ? project.manual_progress ?? 0 : tasks.length === 0 ? 0 : Math.round((completedTasks.length / tasks.length) * 100);
  const sortedMilestones = [...milestones].sort((a, b) => a.due_date.localeCompare(b.due_date));
  const nextMilestone = sortedMilestones.find(milestone => milestone.due_date >= today) ?? sortedMilestones[0] ?? null;
  const daysUntil = nextMilestone
    ? Math.ceil((new Date(`${nextMilestone.due_date}T12:00:00`).getTime() - new Date(`${today}T12:00:00`).getTime()) / 86400000)
    : null;
  const projectKeyValue = project.name.split(/[^a-z0-9]+/i).filter(Boolean).map(word => word.slice(0, 1).toUpperCase()).join("").slice(0, 3) || "PRJ";
  // Modules mirror the prototype: task labels become progress groups.
  const modules = [...new Set(tasks.flatMap(task => task.labels))].slice(0, 5).map(label => {
    const related = tasks.filter(task => task.labels.includes(label));
    return { label, count: related.length, progress: related.length ? Math.round(related.filter(task => task.status === "Complete").length / related.length * 100) : 0 };
  });
  /** Team groups derive from real job titles (members without one stay "General"). */
  const groupOf = (member: ApiProjectMember) => {
    const title = member.job_title ?? "";
    return /design|product|ux|research/i.test(title) ? "Product & UX"
      : /qa|test/i.test(title) ? "QA & Testing"
        : /backend/i.test(title) ? "Backend"
          : /engineer|develop|frontend/i.test(title) ? "Frontend"
            : /lead|manager|owner|admin/i.test(title) ? "Leadership"
              : title ? "General" : "General";
  };
  const teamGroups = [...new Set(members.map(groupOf))].map(name => ({ name, count: members.filter(member => groupOf(member) === name).length }));
  const owner = members.find(member => member.role === "Project Manager") ?? members[0] ?? null;
  const sharedResources = resources.length;
  const linkedResources = resources.filter(resource => resource.external_url).slice(0, 4);
  const health = overdueTasks.length > 0 ? "At risk" : inReviewCount > 0 ? "Needs attention" : "On track";
  const healthTone = health === "At risk" ? "danger" as const : health === "Needs attention" ? "warning" as const : "success" as const;
  const healthChecks = [
    { label: "Scope", ok: tasks.length > 0, detail: tasks.length > 0 ? `${tasks.length} tasks planned` : "No tasks yet" },
    { label: "Timeline", ok: overdueTasks.length === 0, detail: overdueTasks.length > 0 ? `${overdueTasks.length} overdue` : "On schedule" },
    { label: "Resources", ok: sharedResources > 0, detail: `${sharedResources} shared` },
    { label: "Quality", ok: inReviewCount === 0, detail: `${inReviewCount} in review` },
    { label: "Risks", ok: overdueTasks.length === 0, detail: overdueTasks.length > 0 ? "Needs attention" : "No overdue work" },
  ];

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <OverviewStat icon={<Gauge size={17} />} label="Overall progress" value={`${progress}%`} sub={deployed ? "Manual tracking mode" : "Project completion"} />
        <OverviewStat icon={<ListTodo size={17} />} label="Total tasks" value={tasks.length} sub={`${completedTasks.length} completed`} />
        <OverviewStat icon={<Clock3 size={17} />} label="Until deadline" value={daysUntil === null ? "—" : `${Math.max(0, daysUntil)} days`} sub={nextMilestone ? formatDay(nextMilestone.due_date) : "No deadline set"} />
        <OverviewStat icon={<Users size={17} />} label="Project team" value={teamGroups.length} sub={`${members.length} member${members.length === 1 ? "" : "s"}`} />
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-line bg-surface p-4">
          <PanelTitle icon={<FolderKanban size={15} />} title="Progress by module" />
          <div className="mt-4 space-y-3">
            {modules.length > 0 ? modules.map(module => (
              <div key={module.label} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-heading">{module.label}</span>
                <span className="h-1.5 w-20 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full bg-brand" style={{ width: `${module.progress}%` }} /></span>
                <span className="w-8 text-right text-[10px] font-semibold text-heading">{module.progress}%</span>
              </div>
            )) : <p className="text-xs text-muted">Task labels will form project modules.</p>}
          </div>
        </article>

        <article className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <PanelTitle icon={<Zap size={15} />} title="Task delivery" />
            <Badge tone={projectStatusTone[project.status]}>{project.status}</Badge>
          </div>
          <p className="mt-3 text-[11px] text-muted">Work completed across this project</p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-track">
            <div className="h-full rounded-full bg-brand transition-[width]" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2">
            {[
              { label: "Completed", value: completedTasks.length, tone: "bg-success-soft text-success" },
              { label: "In progress", value: byStatus("In progress") + byStatus("Dev completed"), tone: "bg-brand-soft text-brand" },
              { label: "To do", value: byStatus("Backlog") + byStatus("To do"), tone: "bg-warning-soft text-warning" },
            ].map(item => (
              <div key={item.label} className="rounded-lg border border-line p-2 text-center">
                <p className="text-base font-semibold text-heading">{item.value}</p>
                <p className={`mt-1 text-[9px] font-medium ${item.tone}`}>{item.label}</p>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between">
            <button onClick={() => onNavigateTab("kanban")} className="text-[11px] font-medium text-brand">Task board <ArrowUpRight size={12} className="ml-1 inline" /></button>
            <span className="text-[10px] text-muted">{openTasks.length} task{openTasks.length === 1 ? "" : "s"} open</span>
          </div>
        </article>

        <article className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <PanelTitle icon={<CircleDot size={15} />} title="Project health" />
            <Badge tone={healthTone}>{health}</Badge>
          </div>
          <div className="mt-4 space-y-3">
            {healthChecks.map(item => (
              <div key={item.label} className="flex items-center gap-2">
                <span className={`grid h-5 w-5 place-items-center rounded-full ${item.ok ? "bg-success-soft text-success" : "bg-warning-soft text-warning"}`}>
                  {item.ok ? <Check size={12} /> : <AlertTriangle size={12} />}
                </span>
                <span className="flex-1 text-[11px] font-medium text-heading">{item.label}</span>
                <span className="text-[10px] text-muted">{item.detail}</span>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <article className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <PanelTitle icon={<Flag size={15} />} title="Key milestones" />
            <button onClick={() => onNavigateTab("milestones")} className="text-[10px] font-medium text-brand">Manage <ArrowRight size={11} className="ml-1 inline" /></button>
          </div>
          {sortedMilestones.length > 0 ? (
            <div className="mt-3 divide-y divide-line">
              {sortedMilestones.slice(0, 5).map((milestone, index) => {
                const past = milestone.due_date < today;
                return (
                  <div key={milestone.id} className="flex items-center gap-2 py-2.5">
                    <span aria-hidden className={`grid h-5 w-5 place-items-center rounded-full ${past ? "bg-success-soft text-success" : index === 0 ? "bg-brand-soft text-brand" : "bg-hover text-muted"}`}>
                      {past ? <Check size={11} /> : <CircleDot size={11} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-heading">{milestone.name}</span>
                    <span className="shrink-0 text-[10px] text-muted">{formatDay(milestone.due_date)}</span>
                  </div>
                );
              })}
            </div>
          ) : <p className="mt-4 text-xs text-muted">No milestones added yet.</p>}
        </article>

        <article className="rounded-xl border border-line bg-surface p-4">
          <div className="flex items-center justify-between gap-2">
            <PanelTitle icon={<Users size={15} />} title="Team at a glance" />
            <button onClick={() => onNavigateTab("tasks")} className="text-[10px] font-medium text-brand">View tasks <ArrowRight size={11} className="ml-1 inline" /></button>
          </div>
          <div className="mt-3 flex items-center justify-between border-b border-line pb-3">
            <AvatarGroup names={members.map(member => member.display_name)} />
            <div className="text-right">
              <p className="text-sm font-semibold text-heading">{members.length}</p>
              <p className="text-[9px] text-muted">Members</p>
            </div>
          </div>
          <div className="mt-2 space-y-1.5">
            {teamGroups.map(group => (
              <div key={group.name} className="flex items-center gap-2 rounded-lg bg-hover/70 px-2 py-1.5">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-brand-soft text-brand"><Users size={12} /></span>
                <span className="flex-1 text-[10px] font-medium text-heading">{group.name}</span>
                <Badge>{group.count}</Badge>
              </div>
            ))}
            {teamGroups.length === 0 && <p className="text-xs text-muted">Add project members to build your team.</p>}
          </div>
        </article>

        <article className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <PanelTitle icon={<CircleDot size={15} />} title="Recent activity" />
            <button onClick={() => onNavigateTab("tasks")} className="text-[10px] font-medium text-brand">View all <ArrowRight size={11} className="ml-1 inline" /></button>
          </div>
          {activities.length > 0 ? (
            <div className="divide-y divide-line">
              {activities.slice(0, 4).map(activity => (
                <div key={activity.id} className="flex items-start gap-2.5 px-4 py-2.5">
                  <span aria-hidden className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-brand" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[10px] font-medium text-heading">{activity.actor_display_name ?? "Someone"} {activityText(activity)}</span>
                    <span className="mt-0.5 block truncate text-[9px] text-muted">{formatDateTime(activity.created_at)}</span>
                  </span>
                </div>
              ))}
            </div>
          ) : <p className="p-4 text-xs text-muted">Task comments and project changes will appear here.</p>}
        </article>
      </section>

      <aside className="grid gap-4 md:grid-cols-2">
        <article className="rounded-xl border border-line bg-surface p-4">
          <PanelTitle icon={<FileText size={15} />} title="Project info" />
          <div className="mt-3 divide-y divide-line">
            {[
              { label: "Project key", value: projectKeyValue },
              { label: "Owner", value: owner?.display_name ?? "Unassigned" },
              { label: "Project lead", value: owner?.display_name ?? "Unassigned" },
              { label: "Status", value: project.status },
              { label: "Deadline", value: nextMilestone ? formatDay(nextMilestone.due_date) : "Not set" },
            ].map(item => (
              <div key={item.label} className="flex items-center justify-between gap-2 py-2">
                <span className="text-[10px] text-muted">{item.label}</span>
                <span className="truncate text-right text-[10px] font-medium text-heading">{item.value}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-3">
            <span className="text-[10px] text-muted">Methodology</span>
            <div className="mt-1"><Badge tone="brand">{deployed ? "Manual %" : "Task-based"}</Badge></div>
          </div>
        </article>
        <article className="rounded-xl border border-line bg-surface p-4">
          <PanelTitle icon={<Link2 size={15} />} title="Project links" />
          {linkedResources.length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {linkedResources.map(resource => (
                <a key={resource.id} href={resource.external_url ?? "#"} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg px-2 py-2 text-[10px] text-secondary hover:bg-hover hover:text-brand">
                  <FileText size={13} />
                  <span className="min-w-0 flex-1 truncate">{resource.name}</span>
                  <ExternalLink size={12} />
                </a>
              ))}
            </div>
          ) : <p className="mt-3 text-[10px] text-muted">Add links to project resources to keep them handy here.</p>}
        </article>
      </aside>
    </div>
  );
}

function PanelTitle({ icon, title }: { icon: ReactNode; title: string }) {
  return <h2 className="flex items-center gap-2 text-xs font-semibold text-heading"><span className="text-brand">{icon}</span>{title}</h2>;
}

function OverviewStat({ icon, label, value, sub }: { icon: ReactNode; label: string; value: number | string; sub: string }) {
  return (
    <article className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
      <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <strong className="text-xl font-semibold text-heading">{value}</strong>
          <span className="truncate text-[11px] text-muted">{label}</span>
        </div>
        <p className="mt-1 text-[10px] text-muted">{sub}</p>
      </div>
    </article>
  );
}

/* ------------------------------------------------------------------ */
/* Settings: rename, status, tracking mode, archive                    */
/* ------------------------------------------------------------------ */

function SettingsPanel({ workspaceId, project, archived, getAccessToken, onChanged, onNotice, onError }: {
  workspaceId: string;
  project: ApiProject;
  archived: boolean;
  getAccessToken: () => Promise<string | null>;
  onChanged: () => void;
  onNotice: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState<ApiProjectStatus>(project.status);
  const [progressMode, setProgressMode] = useState(project.progress_mode);
  const [manualProgress, setManualProgress] = useState(String(project.manual_progress ?? 0));
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [archiving, setArchiving] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setFormError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setFormError("Sign-in session ended. Please sign in again.");
        return;
      }
      // PATCH contract: non-empty subset; nulls only allowed on manual_progress.
      const patch: {
        name?: string;
        description?: string;
        status?: ApiProjectStatus;
        progress_mode?: "auto" | "manual";
        manual_progress?: number | null;
      } = {};
      if (name.trim() !== project.name) patch.name = name.trim();
      if (description.trim() !== project.description) patch.description = description.trim();
      if (status !== project.status) patch.status = status;
      if (progressMode !== project.progress_mode) patch.progress_mode = progressMode;
      if (progressMode === "manual") {
        const parsed = Number(manualProgress);
        const numeric = Number.isFinite(parsed) ? Math.min(100, Math.max(0, Math.round(parsed))) : 0;
        if (numeric !== (project.manual_progress ?? 0)) patch.manual_progress = numeric;
      }
      if (Object.keys(patch).length === 0) {
        onNotice("No changes to save.");
        return;
      }
      const updated = await projectsApi.updateProject(token, workspaceId, project.id, patch);
      onNotice(patch.name ? `Renamed to "${updated.name}".` : `Project updated.`);
      onChanged();
    } catch (error) {
      const friendly = friendlyError(error, "Could not update the project");
      setFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function archive() {
    if (!window.confirm(`Archive "${project.name}"? Archived projects become read-only and are hidden from the active list.`)) return;
    setArchiving(true);
    try {
      const token = await getAccessToken();
      if (!token) {
        onError("Sign-in session ended. Please sign in again.");
        return;
      }
      await projectsApi.archiveProject(token, workspaceId, project.id);
      onNotice(`Project "${project.name}" archived.`);
      onChanged();
    } catch (error) {
      const friendly = friendlyError(error, "Could not archive the project");
      onError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setArchiving(false);
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Project configuration</p>
        <TextInput label="Project name" required maxLength={160} value={name} onChange={event => setName(event.target.value)} />
        <Textarea label="Description" rows={2} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} placeholder="What this project delivers" />
        <div className="flex flex-wrap gap-3">
          <Select label="Status" className="w-48" value={status} onChange={event => setStatus(event.target.value as ApiProjectStatus)}>
            <option value="In progress">In progress</option>
            <option value="In review">In review</option>
            <option value="Complete">Complete</option>
          </Select>
          <Select label="Tracking mode" className="w-48" value={progressMode} onChange={event => setProgressMode(event.target.value as "auto" | "manual")}>
            <option value="auto">Automatic — from completed tasks</option>
            <option value="manual">Manual — set a percentage</option>
          </Select>
          {progressMode === "manual" && (
            <label className="block space-y-1.5">
              <span className="ui-label">Manual progress (%)</span>
              <input
                type="number"
                min={0}
                max={100}
                className="ui-input w-32"
                value={manualProgress}
                onChange={event => setManualProgress(event.target.value)}
              />
            </label>
          )}
        </div>
        {formError && <p className="text-xs text-danger">{formError}</p>}
        <Button type="submit" variant="primary" size="sm" disabled={submitting || archived} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Pencil size={14} />}>
          {submitting ? "Saving…" : "Save changes"}
        </Button>
        {archived && <p className="text-xs text-muted">This project is archived, so its settings are read-only.</p>}
      </form>

      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-[10px] font-medium uppercase tracking-wide text-muted">Access</p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-secondary">
          <span>Created {shortDate(project.created_at)}</span>
          <span>Last updated {shortDate(project.updated_at)}</span>
          <span>{project.manager_count} project manager{project.manager_count === 1 ? "" : "s"}</span>
          <span>{project.member_count} member{project.member_count === 1 ? "" : "s"}</span>
          {project.current_user_role && <span>You: {project.current_user_role}</span>}
        </p>
        <p className="mt-2 text-[10px] text-muted">
          Project managers come from the Manager role on the Members tab; workspace Owners and Admins can manage every project.
        </p>
      </div>

      <div className="rounded-xl border border-line bg-surface p-4">
        <p className="text-sm font-semibold text-heading">Archive project</p>
        <p className="mt-1 text-xs text-muted">Archived projects stop accepting edits and drop out of the active projects list.</p>
        {!archived && (
          <Button variant="danger" size="sm" className="mt-3" disabled={archiving} icon={archiving ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />} onClick={() => void archive()}>
            {archiving ? "Archiving…" : "Archive project"}
          </Button>
        )}
      </div>
    </div>
  );
}
