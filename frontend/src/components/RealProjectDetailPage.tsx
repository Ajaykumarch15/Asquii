/**
 * Real-data project detail page for signed-in users.
 *
 * Reads the project-scoped backend routers (tasks, members, milestones) and
 * keeps the same loading/error/empty discipline as the other real views.
 * Prototype project data is never mixed in. Meetings/resources remain
 * prototype-only until a later slice.
 */

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Plus, Trash2 } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  Tabs,
  TextInput,
} from "./ui";
import { friendlyError } from "../lib/api/client";
import {
  projectsApi,
  type ApiMilestone,
  type ApiProject,
  type ApiProjectMember,
  type ApiProjectStatus,
  type ApiTask,
  type ApiTaskPriority,
  type ApiTaskStatus,
} from "../lib/api/projects";
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

type TabName = "Tasks" | "Members" | "Milestones";
const TABS: TabName[] = ["Tasks", "Members", "Milestones"];

export function RealProjectDetailPage({ workspaceState, projectId, getAccessToken, onBack }: {
  workspaceState: WorkspaceState;
  projectId: string;
  getAccessToken: () => Promise<string | null>;
  onBack: () => void;
}) {
  const workspace = workspaceState.selected;

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [project, setProject] = useState<ApiProject | null>(null);
  const [members, setMembers] = useState<ApiProjectMember[]>([]);
  const [milestones, setMilestones] = useState<ApiMilestone[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [tab, setTab] = useState<TabName>("Tasks");

  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const isCollaborator = (project?.current_user_role ?? null) !== null;
  const isManager = project?.current_user_role === "Project Manager";

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
      <Button variant="ghost" size="sm" icon={<ArrowLeft size={14} />} onClick={onBack}>
        All projects
      </Button>

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
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
                <Badge tone={projectStatusTone[project.status]}>{project.status}</Badge>
                {archived && <Badge tone="danger">Archived</Badge>}
              </div>
              {project.description && <p className="mt-1.5 max-w-2xl text-sm text-muted">{project.description}</p>}
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                <span>{project.member_count} member{project.member_count === 1 ? "" : "s"}</span>
                {project.current_user_role && <span>You: {project.current_user_role}</span>}
                <span>Updated {shortDate(project.updated_at)}</span>
                {project.progress_mode === "manual" && project.manual_progress !== null && <span>{project.manual_progress}% manual progress</span>}
              </p>
            </div>
          </div>

          <Tabs items={TABS} active={tab} onChange={item => setTab(item as TabName)} />

          {(statusNotice || actionError) && (
            <div role="status" className={`rounded-xl border border-line px-4 py-3 text-xs font-medium ${statusNotice ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>
              {statusNotice ?? actionError}
            </div>
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
            <MembersPanel members={members} milestones={milestones.length} />
          )}

          {tab === "Milestones" && (
            <MilestonesPanel
              workspaceId={workspace.id}
              projectId={projectId}
              milestones={milestones}
              isManager={isManager}
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
  }, [workspaceId, projectId, statusFilter, getAccessToken, reloadToken]);

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
      setTitle("");
      setDescription("");
      setFormOpen(false);
    } catch (error) {
      const friendly = friendlyError(error, "Could not create task");
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
        <Select label="Status" className="w-44" value={statusFilter} onChange={event => setStatusFilter(event.target.value as ApiTaskStatus | "")}>
          <option value="">All statuses</option>
          {TASK_STATUSES.map(option => <option key={option} value={option}>{option}</option>)}
        </Select>
        {isCollaborator && !archived && (
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => { setFormOpen(open => !open); onNotice(""); }}>
            {formOpen ? "Cancel" : "New task"}
          </Button>
        )}
      </div>

      {formOpen && isCollaborator && !archived && (
        <form onSubmit={submitCreate} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <TextInput label="Title" required maxLength={240} value={title} onChange={event => setTitle(event.target.value)} placeholder="Draft the homepage copy" />
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
          <Button type="submit" variant="primary" size="sm" disabled={submitting || title.trim().length === 0} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
            {submitting ? "Creating…" : "Create task"}
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
          {tasks.map(task => (
            <li key={task.id} className="flex flex-wrap items-start gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-heading">{task.title}</p>
                  <Badge tone={taskStatusTone[task.status]}>{task.status}</Badge>
                  <Badge tone={priorityTone[task.priority]}>{task.priority}</Badge>
                </div>
                {task.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{task.description}</p>}
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                  <span>{task.assignee_display_name ?? "Unassigned"}</span>
                  <span>Due {shortDate(task.due_date)}</span>
                </p>
              </div>
              {isCollaborator && !archived && (
                <Select className="w-36" aria-label={`Change status of ${task.title}`} value={task.status} onChange={event => void changeStatus(task, event.target.value as ApiTaskStatus)}>
                  {TASK_STATUSES.map(option => <option key={option} value={option}>{option}</option>)}
                </Select>
              )}
              {isManager && !archived && (
                <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={`Delete ${task.title}`} onClick={() => void removeTask(task)}>
                  Delete
                </Button>
              )}
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

function MembersPanel({ members, milestones }: { members: ApiProjectMember[]; milestones: number }) {
  return (
    <div className="space-y-3">
      <ul className="grid gap-2 lg:grid-cols-2">
        {members.map(member => (
          <li key={member.user_id} className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm font-semibold text-heading">{member.display_name}</p>
                <Badge tone={member.role === "Project Manager" ? "brand" : "neutral"}>{member.role}</Badge>
                {!member.workspace_member_active && <Badge tone="warning">Inactive workspace member</Badge>}
              </div>
              {member.job_title && <p className="mt-1 text-xs text-muted">{member.job_title}</p>}
            </div>
          </li>
        ))}
      </ul>
      <p className="text-[10px] text-muted">{members.length} project member{members.length === 1 ? "" : "s"} · {milestones} milestone{milestones === 1 ? "" : "s"} tracked. Adding and removing members lands in a later slice.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Milestones                                                          */
/* ------------------------------------------------------------------ */

function MilestonesPanel({ workspaceId, projectId, milestones, isManager, archived, getAccessToken, onChanged, onNotice, onError }: {
  workspaceId: string;
  projectId: string;
  milestones: ApiMilestone[];
  isManager: boolean;
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

  return (
    <div className="space-y-3">
      {isManager && !archived && (
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
        <EmptyState title="No milestones" description={isManager && !archived ? "Mark a target date the team can aim for." : "No milestones have been set for this project yet."} />
      )}
      {sorted.length > 0 && (
        <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
          {sorted.map(milestone => {
            const overdue = milestone.due_date < today;
            return (
              <li key={milestone.id} className="flex flex-wrap items-center gap-3 p-4">
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full bg-brand" />
                <p className="min-w-0 flex-1 truncate text-sm font-semibold text-heading">{milestone.name}</p>
                {overdue && <Badge tone="danger">Overdue</Badge>}
                <span className="text-[10px] text-muted">Due {shortDate(milestone.due_date)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
