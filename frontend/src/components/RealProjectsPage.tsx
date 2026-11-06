/**
 * Real-data projects page for signed-in users.
 *
 * Driven by GET/POST on the workspace-scoped projects router. Project detail
 * pages arrive in a later slice; this view covers list, create, and status
 * overview. Prototype project data is never shown alongside real records.
 */

import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, ChevronUp, FolderKanban, Loader2, Plus } from "lucide-react";
import { Badge, Button, EmptyState, ErrorState, LoadingState, Select, Textarea, TextInput } from "./ui";
import { friendlyError } from "../lib/api/client";
import { projectsApi, type ApiProject, type ApiProjectStatus } from "../lib/api/projects";
import type { WorkspaceState } from "../lib/real/useRealWorkspaces";

const statusTone = { "In progress": "brand", "In review": "warning", Complete: "neutral" } as const;

function shortDate(value: string): string {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en", { month: "short", day: "numeric" });
}

export function RealProjectsPage({ workspaceState, getAccessToken, onOpenProject }: {
  workspaceState: WorkspaceState;
  getAccessToken: () => Promise<string | null>;
  onOpenProject: (projectId: string) => void;
}) {
  const workspace = workspaceState.selected;
  const isAdmin = workspace?.role === "Owner" || workspace?.role === "Admin";

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [reloadToken, setReloadToken] = useState(0);
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
        const rows = await projectsApi.listProjects(token, workspaceId, { limit: 100 });
        if (disposed) return;
        setProjects(rows);
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
      setNotice({ tone: "success", text: `Project "${created.name}" created.` });
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

  if (!workspace) return <LoadingState label="Loading workspace" />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1.5 text-sm text-muted">Real projects in {workspace.name}.</p>
        </div>
        {isAdmin && (
          <Button variant="primary" icon={formOpen ? <ChevronUp size={15} /> : <Plus size={15} />} onClick={() => { setFormOpen(open => !open); setNotice(null); }}>
            {formOpen ? "Cancel" : "New project"}
          </Button>
        )}
      </div>
      {notice && <div role="status" className={`rounded-xl border border-line px-4 py-3 text-xs font-medium ${notice.tone === "success" ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>{notice.text}</div>}

      {formOpen && isAdmin && (
        <form onSubmit={submitCreate} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <TextInput label="Project name" required maxLength={160} value={name} onChange={event => setName(event.target.value)} placeholder="Website revamp" />
          <Textarea label="Description" rows={2} maxLength={5000} value={description} onChange={event => setDescription(event.target.value)} placeholder="Optional context for the team" />
          <Select label="Initial status" value={status} onChange={event => setStatus(event.target.value as ApiProjectStatus)}>
            <option value="In progress">In progress</option>
            <option value="In review">In review</option>
            <option value="Complete">Complete</option>
          </Select>
          {formError && <p className="text-xs text-danger">{formError}</p>}
          <Button type="submit" variant="primary" size="sm" disabled={submitting || name.trim().length === 0} icon={submitting ? <Loader2 size={14} className="animate-spin" /> : <ChevronDown size={14} />}>
            {submitting ? "Creating…" : "Create project"}
          </Button>
        </form>
      )}

      {phase === "loading" && <LoadingState label="Loading projects" />}
      {phase === "error" && (
        <ErrorState title="Projects could not be loaded" description={errorMessage ?? "Retry in a moment."} action={<Button onClick={() => setReloadToken(token => token + 1)}>Retry</Button>} />
      )}
      {phase === "ready" && projects.length === 0 && (
        <EmptyState
          title="No projects yet"
          description={isAdmin ? "Create the first project to start planning work." : "A workspace Owner or Admin sets up projects."}
        />
      )}
      {phase === "ready" && projects.length > 0 && (
        <ul className="grid gap-2 lg:grid-cols-2">
          {projects.map(project => (
            <li key={project.id} className="flex items-start gap-3 rounded-xl border border-line bg-surface p-4">
              <button type="button" className="flex flex-1 items-start gap-3 rounded-xl text-left focus:outline-none" aria-label={`Open project ${project.name}`} onClick={() => onOpenProject(project.id)}>
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-soft text-brand"><FolderKanban size={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-heading">{project.name}</p>
                  <Badge tone={statusTone[project.status]}>{project.status}</Badge>
                </div>
                {project.description && <p className="mt-1 line-clamp-2 text-xs text-muted">{project.description}</p>}
                <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] text-muted">
                  <span>{project.member_count} member{project.member_count === 1 ? "" : "s"}</span>
                  {project.current_user_role && <span>You: {project.current_user_role}</span>}
                  <span>Updated {shortDate(project.updated_at)}</span>
                  {project.progress_mode === "manual" && project.manual_progress !== null && <span>{project.manual_progress}% manual</span>}
                </p>
              </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
