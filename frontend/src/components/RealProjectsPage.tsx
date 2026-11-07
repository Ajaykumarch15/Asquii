/**
 * Real-data projects page for signed-in users.
 *
 * Mirrors the prototype Projects page: stat cards, status tabs, search,
 * filters, sorting, grid/list layouts, and CSV export. Data comes from the
 * workspace projects router; per-project progress/health/deadline are
 * enriched with a bounded per-project lookup (same budget as the
 * dashboard in RealWorkspaceHome). Prototype records are never shown.
 *
 * Archiving is backend-supported, but GET /projects always filters out
 * archived rows, so an "Archived" tab waits for an archived-listing flag.
 */

import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  Clock3,
  Download,
  FolderKanban,
  Grid2X2,
  List,
  Loader2,
  Plus,
  Search,
  Users,
} from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, LoadingState, Select, Textarea, TextInput } from "./ui";
import { friendlyError } from "../lib/api/client";
import {
  projectsApi,
  type ApiMilestone,
  type ApiProject,
  type ApiProjectStatus,
  type ApiTask,
} from "../lib/api/projects";
import type { WorkspaceState } from "../lib/real/useRealWorkspaces";

const statusTone = { "In progress": "brand", "In review": "warning", Complete: "success" } as const;

const PROJECT_STATUSES: ApiProjectStatus[] = ["In progress", "In review", "Complete"];

/** Aggregation budget: per-project task/milestone lookups, dashboard-style. */
const MAX_ENRICHED_PROJECTS = 20;

type ProjectHealth = "At risk" | "Needs attention" | "On track";

const healthTone: Record<ProjectHealth, "danger" | "warning" | "success"> = {
  "At risk": "danger",
  "Needs attention": "warning",
  "On track": "success",
};

function shortDate(value: string | null): string {
  if (!value) return "—";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function projectKey(name: string): string {
  return name.split(/[^a-z0-9]+/i).filter(Boolean).map(word => word.slice(0, 1).toUpperCase()).join("").slice(0, 3) || "PRJ";
}

type TabName = "All projects" | "Active" | "In review" | "Complete";

function tabMatchesStatus(tab: TabName, status: ApiProjectStatus): boolean {
  if (tab === "All projects") return true;
  if (tab === "Active") return status === "In progress";
  if (tab === "In review") return status === "In review";
  return status === "Complete";
}

export function RealProjectsPage({ workspaceState, getAccessToken, onOpenProject }: {
  workspaceState: WorkspaceState;
  getAccessToken: () => Promise<string | null>;
  onOpenProject: (projectId: string) => void;
}) {
  const workspace = workspaceState.selected;
  // Project creation is workspace Owner/Admin (the backend logs the creator
  // in as the project's Project Manager).
  const isAdmin = workspace?.role === "Owner" || workspace?.role === "Admin";

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
  const [truncated, setTruncated] = useState(false);

  // Real enrichment: per-project tasks + milestones for progress,
  // task count, health, and next deadline on cards.
  const [detail, setDetail] = useState<{
    tasks: Record<string, ApiTask[]>;
    milestones: Record<string, ApiMilestone[]>;
  } | null>(null);

  // View state (prototype parity).
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<TabName>("All projects");
  const [statusFilter, setStatusFilter] = useState("" as ApiProjectStatus | "");
  const [sort, setSort] = useState<"recent" | "name" | "progress">("recent");
  const [layout, setLayout] = useState<"grid" | "list">("grid");

  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [status, setStatus] = useState<ApiProjectStatus>("In progress");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!workspace) return;
    const workspaceId = workspace.id;
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      try {
        // GET /projects never returns archived rows; limit 100 covers the
        // workspace until server-side paging becomes worth the UI cost.
        const rows = await projectsApi.listProjects(token, workspaceId, { limit: 100 });
        if (disposed) return;
        setProjects(rows);
        setTruncated(rows.length >= 100);
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load projects");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [workspace, getAccessToken, reloadToken]);

  // Rows belong to one workspace; drop detail on switch to avoid a stale flash.
  useEffect(() => {
    setDetail(null);
  }, [workspace?.id]);

  useEffect(() => {
    if (phase !== "ready" || projects.length === 0 || !workspace) return;
    const workspaceId = workspace.id;
    const targets = projects.slice(0, MAX_ENRICHED_PROJECTS);
    let disposed = false;
    void (async () => {
      const token = await getAccessToken();
      if (!token) return;
      const [taskResults, milestoneResults] = await Promise.all([
        Promise.allSettled(targets.map(project => projectsApi.listTasks(token, workspaceId, project.id, { limit: 100 }))),
        Promise.allSettled(targets.map(project => projectsApi.listMilestones(token, workspaceId, project.id))),
      ]);
      if (disposed) return;
      const tasks: Record<string, ApiTask[]> = {};
      const milestones: Record<string, ApiMilestone[]> = {};
      targets.forEach((project, index) => {
        const taskPage = taskResults[index];
        if (taskPage.status === "fulfilled") tasks[project.id] = taskPage.value;
        const milestonePage = milestoneResults[index];
        if (milestonePage.status === "fulfilled") milestones[project.id] = milestonePage.value;
      });
      setDetail({ tasks, milestones });
    })();
    return () => { disposed = true; };
  }, [phase, projects, workspace, getAccessToken, reloadToken]);

  async function submitCreate(event: FormEvent) {
    event.preventDefault();
    if (!workspace) return;
    setSubmitting(true);
    setFormError(null);
    try {
      const token = await getAccessToken();
      if (!token) {
        setFormError("Sign-in session ended. Please sign in again.");
        return;
      }
      const created = await projectsApi.createProject(token, workspace.id, {
        name: name.trim(),
        description: description.trim(),
        status,
      });
      setProjects(previous => [created, ...previous.filter(item => item.id !== created.id)]);
      setNotice({ tone: "success", text: `Project "${created.name}" created — you are its Project Manager.` });
      setName("");
      setDescription("");
      setFormOpen(false);
    } catch (error) {
      const friendly = friendlyError(error, "Could not create project");
      setFormError(`${friendly.title}: ${friendly.message}`);
    } finally {
      setSubmitting(false);
    }
  }

  const progressFor = (project: ApiProject): number | null => {
    if (project.progress_mode === "manual") return project.manual_progress ?? 0;
    const tasks = detail?.tasks[project.id];
    if (!tasks) return null; // not loaded yet
    if (tasks.length === 0) return 0;
    return Math.round((tasks.filter(task => task.status === "Complete").length / tasks.length) * 100);
  };

  const healthFor = (project: ApiProject): ProjectHealth | null => {
    const tasks = detail?.tasks[project.id];
    if (!tasks) return null;
    const today = new Date().toISOString().slice(0, 10);
    if (tasks.some(task => task.status !== "Complete" && task.due_date !== null && task.due_date < today)) return "At risk";
    if (tasks.some(task => task.status === "In review")) return "Needs attention";
    return "On track";
  };

  const nextDeadlineFor = (project: ApiProject): ApiMilestone | null =>
    [...(detail?.milestones[project.id] ?? [])].sort((a, b) => a.due_date.localeCompare(b.due_date))[0] ?? null;

  const taskCountFor = (project: ApiProject): number | null => detail?.tasks[project.id]?.length ?? null;

  const tabs = useMemo(() => {
    const counts: Record<TabName, number> = {
      "All projects": projects.length,
      Active: projects.filter(project => tabMatchesStatus("Active", project.status)).length,
      "In review": projects.filter(project => tabMatchesStatus("In review", project.status)).length,
      Complete: projects.filter(project => tabMatchesStatus("Complete", project.status)).length,
    };
    return (Object.keys(counts) as TabName[]).map(label => ({ label, count: counts[label] }));
  }, [projects]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return projects
      .filter(project =>
        tabMatchesStatus(tab, project.status)
        && (statusFilter === "" || project.status === statusFilter)
        && (query === "" || `${project.name} ${projectKey(project.name)} ${project.description}`.toLowerCase().includes(query)))
      .sort((a, b) =>
        sort === "name" ? a.name.localeCompare(b.name)
          : sort === "progress" ? (progressFor(b) ?? -1) - (progressFor(a) ?? -1)
            : a.created_at.localeCompare(b.created_at) * -1);
  }, [projects, tab, statusFilter, search, sort, detail]);

  const counts = {
    total: projects.length,
    active: projects.filter(project => project.status === "In progress").length,
    review: projects.filter(project => project.status === "In review").length,
    complete: projects.filter(project => project.status === "Complete").length,
  };

  function exportCsv() {
    // CSV export uses the loaded page (same scope as the visible grid).
    const rows = [["Project", "Key", "Description", "Status", "Progress", "Tasks", "Members", "Next deadline", "You"]];
    for (const project of filtered) {
      const progress = progressFor(project);
      rows.push([
        project.name,
        projectKey(project.name),
        project.description,
        project.status,
        progress === null ? "" : `${progress}%`,
        String(taskCountFor(project) ?? ""),
        String(project.member_count),
        nextDeadlineFor(project)?.due_date ?? "",
        project.current_user_role ?? "",
      ]);
    }
    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = "workspace-projects.csv";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  if (!workspace) return <LoadingState label="Loading workspace" />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1.5 text-sm text-muted">Create, track and manage all projects in {workspace.name}.</p>
        </div>
        <div className="flex gap-2">
          {projects.length > 0 && (
            <Button variant="secondary" icon={<Download size={14} />} onClick={exportCsv}>Export</Button>
          )}
          {isAdmin && (
            <Button
              variant="primary"
              icon={formOpen ? <ChevronDown size={15} /> : <Plus size={15} />}
              onClick={() => { setFormOpen(open => !open); setNotice(null); }}
            >
              {formOpen ? "Cancel" : "New project"}
            </Button>
          )}
        </div>
      </div>
      {notice && <div role="status" className={`rounded-xl border border-line px-4 py-3 text-xs font-medium ${notice.tone === "success" ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>{notice.text}</div>}

      {formOpen && isAdmin && (
        <form onSubmit={submitCreate} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <TextInput label="Project name" required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Website revamp" />
          <Textarea label="Description" rows={2} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Optional context for the team" />
          <Select label="Initial status" value={status} onChange={event => setStatus(event.target.value as ApiProjectStatus)}>
            {PROJECT_STATUSES.map(option => <option key={option} value={option}>{option}</option>)}
          </Select>
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <Button type="submit" variant="primary" size="sm" disabled={submitting || name.trim().length === 0} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </form>
      )}

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard label="Total projects" value={counts.total} note="In this workspace" icon={<FolderKanban size={16} />} tone="violet" />
        <MetricCard label="Active" value={counts.active} note="Currently in progress" icon={<CircleDot size={16} />} tone="blue" />
        <MetricCard label="In review" value={counts.review} note="Awaiting decisions" icon={<Clock3 size={16} />} tone="orange" />
        <MetricCard label="Completed" value={counts.complete} note="Successfully delivered" icon={<CheckCircle2 size={16} />} tone="green" />
      </section>

      <section className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex gap-5 overflow-x-auto border-b border-line px-4 pt-3">
          {tabs.map(item => (
            <button
              key={item.label}
              onClick={() => setTab(item.label)}
              className={`shrink-0 border-b-2 px-1 pb-2.5 text-xs font-medium ${tab === item.label ? "border-brand text-brand" : "border-transparent text-secondary hover:text-heading"}`}
            >
              {item.label} <span className="ml-1 text-[10px] opacity-70">({item.count})</span>
            </button>
          ))}
        </div>
        <div className="grid gap-2 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_150px_145px_auto]">
          <TextInput
            icon={<Search size={15} />}
            aria-label="Search projects"
            placeholder="Search by name, key, or description…"
            value={search}
            onChange={event => setSearch(event.target.value)}
          />
          <Select aria-label="Filter projects by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value as ApiProjectStatus | "")}>
            <option value="">All status</option>
            {PROJECT_STATUSES.map(value => <option key={value}>{value}</option>)}
          </Select>
          <Select aria-label="Sort projects" value={sort} onChange={event => setSort(event.target.value as typeof sort)}>
            <option value="recent">Sort: Newest</option>
            <option value="name">Sort: Name</option>
            <option value="progress">Sort: Progress</option>
          </Select>
          <div className="flex items-center justify-end gap-1">
            <button className={`icon-button ${layout === "grid" ? "bg-brand-soft text-brand" : "text-muted"}`} aria-label="Grid view" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><Grid2X2 size={15} /></button>
            <button className={`icon-button ${layout === "list" ? "bg-brand-soft text-brand" : "text-muted"}`} aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={15} /></button>
          </div>
        </div>
        <div className="px-4 pb-3 text-[11px] text-muted">
          Showing {filtered.length} of {projects.length} projects{truncated ? " (first 100 — refine your filters to see more)" : ""}
        </div>

        {phase === "loading" && <LoadingState label="Loading projects" />}
        {phase === "error" && (
          <ErrorState title="Projects could not be loaded" description={errorMessage ?? "Retry in a moment."} action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>} />
        )}
        {phase === "ready" && projects.length === 0 && (
          <EmptyState
            title="No projects yet"
            description={isAdmin ? "Create the first project to start planning work — you become its Project Manager." : "A workspace Owner or Admin sets up projects."}
          />
        )}
        {phase === "ready" && projects.length > 0 && (filtered.length === 0 ? (
          <EmptyState
            title={`No ${tab === "All projects" ? "" : `${tab.toLowerCase()} `}projects match`}
            description="Try changing your search or filters."
            action={(search || statusFilter) && (
              <Button size="sm" variant="secondary" onClick={() => { setSearch(""); setStatusFilter(""); }}>Clear filters</Button>
            )}
          />
        ) : layout === "grid" ? (
          <div className="grid gap-3 border-t border-line p-4 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                progress={progressFor(project)}
                health={healthFor(project)}
                taskCount={taskCountFor(project)}
                deadline={nextDeadlineFor(project)?.due_date ?? null}
                onOpen={() => onOpenProject(project.id)}
              />
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto border-t border-line">
            <table className="w-full min-w-[860px] text-left">
              <thead className="bg-hover text-[10px] uppercase tracking-wide text-muted">
                <tr>
                  {["Project", "Status", "Progress", "Deadline", "Tasks", "Members", "Updated", ""].map(item => (
                    <th key={item} className="px-4 py-3 font-medium">{item}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(project => (
                  <ProjectListRow
                    key={project.id}
                    project={project}
                    progress={progressFor(project)}
                    taskCount={taskCountFor(project)}
                    deadline={nextDeadlineFor(project)?.due_date ?? null}
                    onOpen={() => onOpenProject(project.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </section>
      <p className="text-[10px] text-muted">
        Archived projects are hidden. Rename, status, and tracking mode live in each project's Settings tab.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Cards and rows                                                      */
/* ------------------------------------------------------------------ */

function ProjectCard({ project, progress, health, taskCount, deadline, onOpen }: {
  project: ApiProject;
  progress: number | null;
  health: ProjectHealth | null;
  taskCount: number | null;
  deadline: string | null;
  onOpen: () => void;
}) {
  const statusLabel = project.status === "Complete" ? "Completed" : project.status;
  const deadlineOverdue = deadline !== null && deadline < new Date().toISOString().slice(0, 10) && project.status !== "Complete";
  return (
    <article className="group cursor-pointer rounded-xl border border-line bg-surface p-4 transition hover:border-strong hover:shadow-sm" onClick={onOpen}>
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><FolderKanban size={17} /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-sm font-semibold group-hover:text-brand">{project.name}</h2>
          <p className="mt-0.5 text-[10px] font-medium text-muted">{projectKey(project.name)}</p>
        </div>
        <Badge tone={statusTone[project.status]}>{statusLabel}</Badge>
      </div>
      <p className="mt-3 line-clamp-2 min-h-9 text-xs leading-5 text-secondary">{project.description || "No description added yet."}</p>
      <div className="mt-3">
        <div className="mb-1.5 flex items-center justify-between text-[10px]">
          <span className="text-muted">
            Progress{project.progress_mode === "manual" && <span className="ml-1 text-[10px] font-medium text-muted">(manual)</span>}
          </span>
          <span className="font-semibold">{progress === null ? "—" : `${progress}%`}</span>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-track">
          <div className="h-full rounded-full bg-brand" style={{ width: `${progress ?? 0}%` }} />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-secondary">
        <span className="inline-flex items-center gap-1"><CalendarDays size={12} className="text-muted" />{deadline ? shortDate(deadline) : "No deadline"}</span>
        <span className="inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-muted" />{taskCount === null ? "…" : `${taskCount} task${taskCount === 1 ? "" : "s"}`}</span>
        <span className="inline-flex items-center gap-1"><Users size={12} className="text-muted" />{project.member_count} member{project.member_count === 1 ? "" : "s"}</span>
        {health && <span className={`rounded-full px-2 py-0.5 font-medium ${healthTone[health] === "danger" ? "bg-danger-soft text-danger" : healthTone[health] === "warning" ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>{health}</span>}
      </div>
      {deadlineOverdue && <p className="mt-2 text-[10px] font-medium text-danger">Next milestone is overdue</p>}
      <p className="mt-2 flex flex-wrap items-center gap-x-3 text-[10px] text-muted">
        {project.current_user_role && <span>You: {project.current_user_role}</span>}
        <span>Updated {shortDate(project.updated_at)}</span>
      </p>
    </article>
  );
}

function ProjectListRow({ project, progress, taskCount, deadline, onOpen }: {
  project: ApiProject;
  progress: number | null;
  taskCount: number | null;
  deadline: string | null;
  onOpen: () => void;
}) {
  return (
    <tr onClick={onOpen} className="cursor-pointer border-b border-line last:border-0 hover:bg-hover">
      <td className="px-4 py-3">
        <div className="flex items-center gap-3">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand"><FolderKanban size={15} /></span>
          <span>
            <span className="block text-xs font-semibold">{project.name}</span>
            <span className="mt-0.5 block text-[10px] text-muted">{projectKey(project.name)}</span>
          </span>
        </div>
      </td>
      <td className="px-4 py-3"><Badge tone={statusTone[project.status]}>{project.status}</Badge></td>
      <td className="px-4 py-3">
        <div className="flex w-28 items-center gap-2">
          <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track">
            <span className="block h-full rounded-full bg-brand" style={{ width: `${progress ?? 0}%` }} />
          </span>
          <span className="text-[10px]">{progress === null ? "—" : `${progress}%`}</span>
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-secondary">{deadline ? shortDate(deadline) : "No deadline"}</td>
      <td className="px-4 py-3 text-xs">{taskCount === null ? "…" : taskCount}</td>
      <td className="px-4 py-3 text-xs">{project.member_count}</td>
      <td className="px-4 py-3 text-xs text-muted">{shortDate(project.updated_at)}</td>
      <td className="px-4 py-3">{project.current_user_role && <Badge tone="neutral">{project.current_user_role}</Badge>}</td>
    </tr>
  );
}

function MetricCard({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: number; note: string; tone: string }) {
  const colors: Record<string, string> = {
    violet: "bg-brand-soft text-brand",
    blue: "bg-blue-50 text-blue-600",
    green: "bg-success-soft text-success",
    orange: "bg-warning-soft text-warning",
  };
  return (
    <article className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4">
      <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${colors[tone]}`}>{icon}</span>
      <div>
        <p className="text-[11px] text-muted">{label}</p>
        <p className="mt-0.5 text-xl font-semibold leading-tight">{value}</p>
        <p className="mt-1 text-[10px] text-secondary">{note}</p>
      </div>
    </article>
  );
}
