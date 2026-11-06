/**
 * Real-data project detail page for signed-in users.
 *
 * Reads the project-scoped backend routers (tasks, members, milestones,
 * meetings with attendee management) and keeps the same loading/error/empty
 * discipline as the other real views. Prototype project data is never mixed
 * in. Resources remain the last prototype-only slice.
 */

import { useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Loader2, Plus, Trash2, UserPlus, UserMinus, Users } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  Select,
  Tabs,
  Textarea,
  TextInput,
} from "./ui";
import { friendlyError } from "../lib/api/client";
import {
  projectsApi,
  type ApiMilestone,
  type ApiMeeting,
  type ApiMeetingAttendee,
  type ApiMeetingType,
  type ApiProject,
  type ApiProjectMember,
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

type TabName = "Tasks" | "Meetings" | "Resources" | "Members" | "Milestones";
const TABS: TabName[] = ["Tasks", "Meetings", "Resources", "Members", "Milestones"];

export function RealProjectDetailPage({ workspaceState, projectId, getAccessToken, identityUserId, onBack }: {
  workspaceState: WorkspaceState;
  projectId: string;
  getAccessToken: () => Promise<string | null>;
  /** Signed-in user's id; attendees may always remove themselves from meetings. */
  identityUserId: string;
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
  // Backend meeting management = Project Manager OR workspace Owner/Admin.
  const canManageMeetings = isManager || workspace?.role === "Owner" || workspace?.role === "Admin";

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

          {tab === "Meetings" && (
            <MeetingsPanel
              workspaceId={workspace.id}
              projectId={projectId}
              members={members}
              isCollaborator={isCollaborator}
              canManageMeetings={canManageMeetings}
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
                    </div>
                    {task.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{task.description}</p>}
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                      <span>{task.assignee_display_name ?? "Unassigned"}</span>
                      <span>Due {shortDate(task.due_date)}</span>
                      <span className={expanded ? "text-brand" : ""}>{expanded ? "Hide details" : "Details"}</span>
                    </p>
                  </button>
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
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
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
      const starts = new Date(startAt);
      if (Number.isNaN(starts.getTime())) {
        setFormError("Pick a start date and time.");
        return;
      }
      const created = await projectsApi.createMeeting(token, workspaceId, projectId, {
        title: title.trim(),
        description: description.trim(),
        starts_at: starts.toISOString(),
        duration_minutes: duration,
        meeting_type: meetingType,
      });
      setMeetings(previous => [...previous, created]);
      onNotice(`Meeting "${created.title}" scheduled.`);
      setTitle("");
      setDescription("");
      setStartAt("");
      setFormOpen(false);
    } catch (error) {
      const friendly = friendlyError(error, "Could not schedule meeting");
      setFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  async function removeMeeting(meeting: ApiMeeting) {
    if (!window.confirm(`Delete meeting "${meeting.title}"?`)) return;
    setMeetings(previous => previous.filter(item => item.id !== meeting.id));
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
          <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => { setFormOpen(open => !open); onNotice(""); }}>
            {formOpen ? "Cancel" : "Schedule meeting"}
          </Button>
        )}
      </div>

      {formOpen && isCollaborator && !archived && (
        <form onSubmit={submitCreate} className="space-y-3 rounded-xl border border-line bg-surface p-4">
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
          <Textarea label="Description" rows={2} maxLength={20000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Optional notes for attendees (agenda/editing arrive later)" />
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <Button type="submit" variant="primary" size="sm" disabled={submitting} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
            {submitting ? "Scheduling…" : "Schedule meeting"}
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
                    <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                      <span>{formatDateTime(meeting.starts_at)}</span>
                      <span>{meeting.duration_minutes} min</span>
                      <span>{meeting.attendee_count} attendee{meeting.attendee_count === 1 ? "" : "s"}</span>
                      {meeting.organizer_display_name && <span>Organizer: {meeting.organizer_display_name}</span>}
                    </p>
                  </div>
                  <Button variant="ghost" size="sm" icon={<Trash2 size={14} />} aria-label={`Delete ${meeting.title}`} onClick={() => void removeMeeting(meeting)}>
                    Delete
                  </Button>
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
        const rows = await projectsApi.listResources(token, workspaceId, projectId, { limit: 100 });
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
  }, [workspaceId, projectId, getAccessToken, reloadToken]);

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

  const sorted = [...resources].sort((a, b) => Number(b.is_starred) - Number(a.is_starred) || b.updated_at.localeCompare(a.updated_at));

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
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
