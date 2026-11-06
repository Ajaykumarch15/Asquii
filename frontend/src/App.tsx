import { useEffect, useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { AuthPanel } from "./components/AuthPanel";
import { LandingPage } from "./components/LandingPage";
import { KanbanPage } from "./modules/projects/pages/KanbanPage";
import { MeetingsPage } from "./modules/projects/pages/MeetingsPage";
import { ProjectOverviewPage } from "./modules/projects/pages/OverviewPage";
import { ProjectPeoplePage } from "./modules/projects/pages/PeoplePage";
import { ResourcesPage } from "./modules/projects/pages/ResourcesPage";
import { TasksPage } from "./modules/projects/pages/TasksPage";
import { ProjectSettingsPage } from "./modules/projects/pages/SettingsPage";
import { WorkspaceOverviewPage } from "./modules/workspace/pages/OverviewPage";
import { ProjectsPage, type ImportedProject } from "./modules/workspace/pages/ProjectsPage";
import { PeoplePage } from "./modules/workspace/pages/PeoplePage";
import { SettingsPage } from "./modules/workspace/pages/SettingsPage";
import { WorkspaceEditor } from "./modules/workspace/components/WorkspaceEditor";
import { AppShell, type NotificationItem, type Scope } from "./components/AppShell";
import { Button } from "./components/ui";
import { ProjectEditor, TaskEditor, MeetingEditor, ResourceEditor, type EditorState } from "./modules/projects/components/ProjectEditors";
import { createId, isPastMeeting, isRecentlyUpdated, milestoneState, sortMeetingsByDate, sortMilestones, type AppData, type Invitation, type Meeting, type Membership, type Project, type Resource, type Task, type TaskStatus, type Workspace, type WorkspaceRole, useAppData } from "./model";
import { useAuthActions, useAuthState } from "./lib/auth/AuthContext";
import { useRealWorkspaces } from "./lib/real/useRealWorkspaces";
import { RealWorkspaceHome } from "./components/RealWorkspaceHome";
import { RealProjectsPage } from "./components/RealProjectsPage";
import { RealProjectDetailPage } from "./components/RealProjectDetailPage";
import { workspaceApi, type ApiWorkspace } from "./lib/api/workspace";
import { friendlyError } from "./lib/api/client";

const prototypeWorkspace = (source: ApiWorkspace): Workspace => ({
  id: source.id,
  name: source.name,
  url: `asquii.com/${source.slug}`,
  visibility: "private",
  notifications: { taskAssignments: true, projectUpdates: true, upcomingDeadlines: true },
});

export default function App() {
  const { data, setData, storageError, clearStorageError } = useAppData();
  const auth = useAuthState();
  const authActions = useAuthActions();
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-in");
  /** Anonymous visitors see the landing first; the prototype demo is opt-in. */
  const [demoMode, setDemoMode] = useState(false);
  const [workspaceNotice, setWorkspaceNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const signedIn = auth.status === "authed";
  const realWorkspaces = useRealWorkspaces(signedIn, authActions.getAccessToken);
  const account = signedIn ? { name: auth.identity.displayName, email: auth.identity.email } : null;
  const identityUserId = signedIn ? auth.identity.userId : "";
  const [scope, setScope] = useState<Scope>("workspace");
  const [active, setActive] = useState("Overview");
  const [workspaceId, setWorkspaceId] = useState(() => readLocal("asquii.active-workspace", "workspace-product"));
  const [personaId, setPersonaId] = useState(() => readLocal("asquii.preview-persona", "ava"));
  const [projectId, setProjectId] = useState("focusflow");
  const [editor, setEditor] = useState<EditorState>(null);
  const [readIds, setReadIds] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("asquii.notifications-read") ?? "[]");
      return Array.isArray(saved) ? saved.filter(item => typeof item === "string") : [];
    } catch { return []; }
  });
  const [recentIds, setRecentIds] = useState<string[]>(() => {
    try {
      const saved: unknown = JSON.parse(localStorage.getItem("asquii.recent-projects") ?? "[]");
      return Array.isArray(saved) ? saved.filter(item => typeof item === "string") : [];
    } catch { return []; }
  });
  const [workspaceEditorOpen, setWorkspaceEditorOpen] = useState(false);
  const [realProjectId, setRealProjectId] = useState<string | null>(null);
  // Real project detail is a transient drill-down: navigating anywhere else or
  // switching workspace closes it, so returning to Projects shows the list.
  useEffect(() => {
    setRealProjectId(null);
  }, [active]);
  const realWorkspaceSelectedId = realWorkspaces.selected?.id;
  useEffect(() => {
    setRealProjectId(null);
  }, [realWorkspaceSelectedId]);
  const [theme, setTheme] = useState<"light" | "dark">(readTheme);

  const membership = data.memberships.find(item => item.workspaceId === workspaceId && item.personId === personaId);
  const role: WorkspaceRole = membership?.role ?? "Member";
  const canAdmin = role === "Admin";
  const visibleWorkspaces = data.workspaces.filter(workspace => data.memberships.some(item => item.workspaceId === workspace.id && item.personId === personaId));
  const workspace = visibleWorkspaces.find(item => item.id === workspaceId) ?? visibleWorkspaces[0] ?? data.workspaces[0];
  const workspaceMemberships = data.memberships.filter(item => item.workspaceId === workspace?.id);
  const workspacePeople = data.people.filter(person => workspaceMemberships.some(item => item.personId === person.id));
  const projectAccess = (project: Project) => canAdmin || project.personIds.includes(personaId);
  const visibleProjects = data.projects.filter(project => project.workspaceId === workspace?.id && projectAccess(project));
  const selectedProject = visibleProjects.find(project => project.id === projectId) ?? visibleProjects[0];
  const workspaceTasks = data.tasks.filter(task => visibleProjects.some(project => project.id === task.projectId));
  const scopedWorkspaceData: AppData = { ...data, projects: visibleProjects, tasks: workspaceTasks, people: workspacePeople };
  const projectPeople = workspacePeople.filter(person => selectedProject?.personIds.includes(person.id));
  const projectData: AppData = { ...data, projects: selectedProject ? [selectedProject] : [], tasks: data.tasks.filter(task => task.projectId === selectedProject?.id), people: projectPeople };

  // Signed-in display shim: the shell is driven by real API data while the
  // prototype values stay untouched for demo mode. Real roles map onto the
  // prototype's two-value role model (Member, or Admin for Owner/Admin).
  const emptyWorkspace: Workspace = { id: "", name: "Workspace", url: "asquii.com", visibility: "private", notifications: { taskAssignments: true, projectUpdates: true, upcomingDeadlines: true } };
  const displayWorkspace = signedIn ? (realWorkspaces.selected ? prototypeWorkspace(realWorkspaces.selected) : emptyWorkspace) : workspace;
  const displayWorkspaces = signedIn ? realWorkspaces.workspaces.map(prototypeWorkspace) : visibleWorkspaces;
  const displayRole: WorkspaceRole = signedIn ? (realWorkspaces.selected?.role === "Member" ? "Member" : realWorkspaces.selected ? "Admin" : "Member") : role;
  const displayCanAdmin = signedIn ? displayRole === "Admin" : canAdmin;
  const displayProjects = signedIn ? [] as Project[] : visibleProjects;
  const displaySelectedProject = signedIn ? undefined : selectedProject;

  const notifications = useMemo<NotificationItem[]>(() => {
    if (signedIn) return []; // Prototype-derived notifications stay in demo mode; real ones arrive with later slices.
    const prefs = workspace?.notifications ?? { taskAssignments: true, projectUpdates: true, upcomingDeadlines: true };
    const read = new Set(readIds);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const soon = new Date(today); soon.setDate(soon.getDate() + 7);
    const shortDate = (value: string) => { const parsed = new Date(`${value}T00:00:00`); return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleDateString("en", { month: "short", day: "numeric" }); };
    type Draft = { id: string; kind: NotificationItem["kind"]; title: string; detail: string; tone: NotificationItem["tone"]; projectId?: string };
    const drafts: Draft[] = [];
    if (prefs.taskAssignments) for (const task of workspaceTasks) {
      if (task.ownerId !== personaId || task.status === "Complete" || !task.due) continue;
      const date = new Date(`${task.due}T00:00:00`);
      if (Number.isNaN(date.getTime())) continue;
      const overdue = date < today, dueSoon = date >= today && date <= soon;
      if (!overdue && !dueSoon) continue;
      const project = data.projects.find(item => item.id === task.projectId);
      drafts.push({ id: task.id, kind: "task", title: task.title, detail: `${project?.name ?? "Project"} – ${overdue ? "Overdue" : `Due ${shortDate(task.due)}`}`, tone: overdue ? "danger" : "warning", projectId: task.projectId });
    }
    if (prefs.upcomingDeadlines) for (const project of visibleProjects) {
      for (const meeting of data.meetings) {
        if (meeting.projectId !== project.id || isPastMeeting(meeting)) continue;
        const date = new Date(`${meeting.date}T00:00:00`);
        if (Number.isNaN(date.getTime()) || date > soon) continue;
        drafts.push({ id: `meeting:${meeting.id}`, kind: "meeting", title: meeting.title, detail: `${project.name} – ${date.getTime() === today.getTime() ? "Today" : shortDate(meeting.date)} · ${meeting.attendees.includes(personaId) ? "You're attending" : meeting.time || "Time TBD"}`, tone: "brand", projectId: project.id });
      }
      for (const milestone of sortMilestones(project.milestones)) {
        const state = milestoneState(milestone.due);
        if (state === "Upcoming") continue;
        drafts.push({ id: `milestone:${project.id}:${milestone.id}`, kind: "milestone", title: milestone.name, detail: `${project.name} – ${state} · ${shortDate(milestone.due)}`, tone: state === "At risk" ? "danger" : "warning", projectId: project.id });
      }
    }
    if (prefs.projectUpdates) for (const project of visibleProjects) for (const resource of data.resources) {
      if (resource.projectId !== project.id || resource.deletedAt || !isRecentlyUpdated(resource)) continue;
      drafts.push({ id: `resource:${resource.id}`, kind: "resource", title: resource.name, detail: `${project.name} · ${resource.type.toLowerCase()} added or updated in the last 7 days`, tone: "neutral", projectId: project.id });
    }
    if (canAdmin) for (const invite of data.invitations) {
      if (invite.workspaceId !== workspace?.id || invite.status !== "Pending") continue;
      drafts.push({ id: invite.id, kind: "invite", title: invite.email, detail: `Pending ${invite.role.toLowerCase()} invitation – People`, tone: "warning" });
    }
    return drafts.slice(0, 10).map(item => ({ ...item, read: read.has(item.id) }));
  }, [workspaceTasks, visibleProjects, readIds, data.projects, data.meetings, data.resources, data.invitations, canAdmin, workspace?.id]);


  useEffect(() => { if (workspace?.id && workspace.id !== workspaceId) setWorkspaceId(workspace.id); }, [workspace?.id, workspaceId]);
  useEffect(() => { try { localStorage.setItem("asquii.active-workspace", workspace?.id ?? ""); } catch { /* Preview selection is optional. */ } }, [workspace?.id]);
  useEffect(() => { try { localStorage.setItem("asquii.preview-persona", personaId); } catch { /* Preview selection is optional. */ } }, [personaId]);
  useEffect(() => { document.documentElement.dataset.theme = theme; try { localStorage.setItem("asquii.theme", theme); } catch { /* Theme still applies for this session. */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem("asquii.notifications-read", JSON.stringify(readIds)); } catch { /* Read state still applies for this session. */ } }, [readIds]);
  useEffect(() => { try { localStorage.setItem("asquii.recent-projects", JSON.stringify(recentIds)); } catch { /* Recent projects still apply for this session. */ } }, [recentIds]);

  // Landing <-> demo history: entering the demo pushes an entry, so both the
  // in-app "Back to landing" control and the browser Back/Forward buttons stay
  // in sync. Anonymous only — signed-in app state is untouched.
  useEffect(() => {
    if (signedIn) {
      if (window.location.hash === "#demo") {
        window.history.replaceState({ asquiiView: "app" }, "", window.location.pathname + window.location.search);
      }
      return;
    }
    // Direct loads with a stale #demo hash land on the landing page.
    if (window.location.hash === "#demo" || window.history.state?.asquiiView !== "landing") {
      window.history.replaceState({ asquiiView: "landing" }, "", window.location.pathname + window.location.search);
    }
    const onPopState = (event: PopStateEvent) => {
      const view = (event.state as { asquiiView?: string } | null)?.asquiiView;
      setDemoMode(view === "demo");
      if (view !== "demo") setActive("Overview");
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [signedIn]);

  const navigate = (item: string) => {
    if (item === "Workspace overview") { setScope("workspace"); setActive("Overview"); return; }
    if (item === "Projects") { setScope("workspace"); setActive("Projects"); return; }
    setActive(item);
  };
  const selectWorkspace = (id: string) => { setWorkspaceId(id); setScope("workspace"); setActive("Overview"); setProjectId(""); };
  const rememberProject = (id: string) => { if (!id) return; setRecentIds(previous => [id, ...previous.filter(value => value !== id)].slice(0, 6)); };
  const selectProject = (id: string) => { setProjectId(id); setScope("project"); setActive("Overview"); rememberProject(id); };
  const openProjectPage = (id: string, page: string) => { setProjectId(id); setScope("project"); setActive(page); rememberProject(id); };
  const markNotificationRead = (id: string) => setReadIds(previous => previous.includes(id) ? previous : [...previous, id]);
  const markAllNotificationsRead = () => setReadIds(previous => { const all = new Set(previous); for (const item of notifications) all.add(item.id); return [...all]; });
  const openCreateProject = () => { if (canAdmin && workspace) setEditor({ kind: "project" }); };
  const openCreateTask = (status?: TaskStatus) => { if (selectedProject) setEditor({ kind: "task", projectId: selectedProject.id, status }); };
  const openQuickCreate = scope === "workspace" ? (canAdmin ? openCreateProject : undefined) : openCreateTask;
  const pageTitle = active === "Overview" ? (scope === "workspace" ? (canAdmin ? "Workspace overview" : "Your workspace") : `${selectedProject?.name ?? "Project"} overview`) : active === "Settings" ? (scope === "workspace" ? "Workspace settings" : "Project settings") : active;
  const action = scope === "workspace" ? (canAdmin && ["Overview", "Projects"].includes(active) ? "New project" : null) : (["Overview", "Tasks", "Kanban"].includes(active) ? "New task" : null);

  const saveProject = (input: Omit<Project, "id">, id?: string) => {
    if (!canAdmin || !workspace) return;
    setData(previous => id
      ? { ...previous, projects: previous.projects.map(project => project.id === id && project.workspaceId === workspace.id ? { ...input, id } : project) }
      : { ...previous, projects: [...previous.projects, { ...input, id: createId("project") }] });
    setEditor(null);
  };
  const saveTask = (input: Omit<Task, "id">, id?: string) => {
    const target = data.projects.find(project => project.id === input.projectId);
    if (!target || !projectAccess(target) || !target.personIds.includes(input.ownerId)) return;
    setData(previous => id
      ? { ...previous, tasks: previous.tasks.map(task => task.id === id && task.projectId === target.id ? { ...input, id } : task) }
      : { ...previous, tasks: [...previous.tasks, { ...input, id: createId("task"), order: Math.max(-1, ...previous.tasks.filter(item => item.projectId === input.projectId).map(item => item.order)) + 1 }] });
    setEditor(null);
  };
  const reorderTask = (taskId: string, beforeTaskId: string | null) => setData(previous => {
    const task = previous.tasks.find(item => item.id === taskId);
    const project = previous.projects.find(item => item.id === task?.projectId);
    if (!task || !project || !projectAccess(project)) return previous;
    const column = previous.tasks.filter(item => item.projectId === task.projectId && item.status === task.status && item.id !== taskId).sort((a, b) => a.order - b.order);
    const index = beforeTaskId ? column.findIndex(item => item.id === beforeTaskId) : column.length;
    if (index < 0) return previous;
    column.splice(index, 0, task);
    const orders = new Map(column.map((item, position) => [item.id, position]));
    return { ...previous, tasks: previous.tasks.map(item => orders.has(item.id) ? { ...item, order: orders.get(item.id)! } : item) };
  });
  const updateTask = (id: string, patch: Partial<Task>) => setData(previous => ({ ...previous, tasks: previous.tasks.map(task => {
    const project = previous.projects.find(item => item.id === task.projectId);
    return task.id === id && project && projectAccess(project) && (!patch.ownerId || project.personIds.includes(patch.ownerId)) ? { ...task, ...patch } : task;
  }) }));
  const deleteTask = (taskId: string) => setData(previous => ({ ...previous, tasks: previous.tasks.filter(task => task.id !== taskId) }));
  const saveSettings = (settings: Workspace) => { if (!canAdmin) return; setData(previous => ({ ...previous, workspaces: previous.workspaces.map(item => item.id === settings.id ? settings : item) })); };
  const createWorkspace = async (input: Omit<Workspace, "id">) => {
    // Picker (WorkspaceEditor) works in both modes; signed-in creation goes
    // to the real API while demo mode keeps modifying prototype data only.
    if (signedIn) {
      try {
        const token = await authActions.getAccessToken();
        if (!token) {
          setWorkspaceNotice({ tone: "error", text: "Sign-in session ended. Please sign in again." });
          return;
        }
        const created = await workspaceApi.createWorkspace(token, input.name);
        realWorkspaces.applyWorkspace(created);
        setWorkspaceNotice({ tone: "success", text: `Workspace "${created.name}" is live — you are its Owner.` });
        setWorkspaceEditorOpen(false);
      } catch (error) {
        const friendly = friendlyError(error, "Could not create workspace");
        setWorkspaceNotice({ tone: "error", text: `${friendly.title}: ${friendly.message}` });
      }
      return;
    }
    const created: Workspace = { ...input, id: createId("workspace") };
    setData(previous => ({ ...previous, workspaces: [...previous.workspaces, created], memberships: [...previous.memberships, { workspaceId: created.id, personId: personaId, role: "Admin" }] }));
    setWorkspaceId(created.id); setProjectId(""); setScope("workspace"); setActive("Overview"); setWorkspaceEditorOpen(false);
  };
  const createInvite = (email: string, inviteRole: WorkspaceRole) => {
    if (!canAdmin || !workspace) return false;
    const duplicate = workspacePeople.some(person => person.email.toLowerCase() === email)
      || data.invitations.some(item => item.workspaceId === workspace.id && item.email.toLowerCase() === email && item.status === "Pending");
    if (duplicate) return false;
    setData(previous => ({ ...previous, invitations: [...previous.invitations, { id: createId("invite"), workspaceId: workspace.id, email, role: inviteRole, status: "Pending" }] }));
    return true;
  };
  const importProjects = (items: ImportedProject[]) => {
    if (!canAdmin || !workspace || items.length === 0) return;
    setData(previous => ({ ...previous, projects: [...previous.projects, ...items.filter(item => !previous.projects.some(project => project.workspaceId === workspace.id && project.name.toLowerCase() === item.name.toLowerCase())).map(item => ({ ...item, id: createId("project"), workspaceId: workspace.id, progressMode: "manual" as const, personIds: [], milestones: [] }))] }));
  };
  const updateMemberRole = (personId: string, nextRole: WorkspaceRole) => setData(previous => {
    const admins = previous.memberships.filter(item => item.workspaceId === workspace?.id && item.role === "Admin");
    if (admins.length <= 1 && admins.some(item => item.personId === personId) && nextRole !== "Admin") return previous;
    return { ...previous, memberships: previous.memberships.map(item => item.workspaceId === workspace?.id && item.personId === personId ? { ...item, role: nextRole } : item) };
  });
  const acceptInvite = (invitationId: string) => setData(previous => {
    const invitation = previous.invitations.find(item => item.id === invitationId && item.workspaceId === workspace?.id);
    if (!invitation || invitation.status !== "Pending") return previous;
    const existingPerson = previous.people.find(person => person.email.toLowerCase() === invitation.email.toLowerCase());
    const person = existingPerson ?? { id: createId("person"), name: invitation.email.split("@")[0].replace(/[._-]/g, " ").replace(/\b\w/g, char => char.toUpperCase()), role: "Workspace member", email: invitation.email };
    const alreadyMember = previous.memberships.some(item => item.workspaceId === invitation.workspaceId && item.personId === person.id);
    return {
      ...previous,
      people: existingPerson ? previous.people : [...previous.people, person],
      memberships: alreadyMember ? previous.memberships : [...previous.memberships, { workspaceId: invitation.workspaceId, personId: person.id, role: invitation.role }],
      invitations: previous.invitations.map(item => item.id === invitationId ? { ...item, status: "Accepted" } : item)
    };
  });
  const revokeInvite = (invitationId: string) => setData(previous => ({ ...previous, invitations: previous.invitations.filter(item => item.id !== invitationId) }));
  const saveMeeting = (input: Omit<Meeting, "id">, id?: string) => {
    const target = data.projects.find(project => project.id === input.projectId);
    if (!target || !projectAccess(target)) return;
    setData(previous => id
      ? { ...previous, meetings: previous.meetings.map(item => item.id === id && item.projectId === input.projectId ? { ...input, id } : item) }
      : { ...previous, meetings: [...previous.meetings, { ...input, id: createId("meeting") }] });
    setEditor(null);
  };
  const deleteMeeting = (meetingId: string) => setData(previous => ({ ...previous, meetings: previous.meetings.filter(item => item.id !== meetingId) }));
  const openCreateMeeting = () => { if (selectedProject) setEditor({ kind: "meeting", projectId: selectedProject.id }); };
  const openEditMeeting = (meetingId: string) => setEditor({ kind: "meeting", id: meetingId });
  const saveResource = (input: Omit<Resource, "id">, id?: string) => {
    const target = data.projects.find(project => project.id === input.projectId);
    if (!target || !projectAccess(target)) return;
    setData(previous => id
      ? { ...previous, resources: previous.resources.map(item => item.id === id ? { ...input, id } : item) }
      : { ...previous, resources: [...previous.resources, { ...input, id: createId("resource") }] });
    setEditor(null);
  };
  const deleteResource = (resourceId: string) => setData(previous => ({ ...previous, resources: previous.resources.map(item => item.id === resourceId ? { ...item, deletedAt: new Date().toISOString().slice(0, 10) } : item) }));
  const restoreResource = (resourceId: string) => setData(previous => ({ ...previous, resources: previous.resources.map(item => item.id === resourceId ? { ...item, deletedAt: null } : item) }));
  const purgeResource = (resourceId: string) => setData(previous => ({ ...previous, resources: previous.resources.filter(item => item.id !== resourceId) }));
  const starResource = (resourceId: string) => setData(previous => ({ ...previous, resources: previous.resources.map(item => item.id === resourceId ? { ...item, starred: !item.starred } : item) }));
  const uploadResource = (file: { name: string; size: string }) => {
    if (!selectedProject) return;
    const lower = file.name.toLowerCase();
    const type: Resource["type"] = /\.(xlsx|xls|csv|numbers|ods)$/.test(lower) ? "Spreadsheet" : /\.(fig|psd|ai|sketch|png|jpg|jpeg|svg|webp|avif)$/.test(lower) ? "Design file" : "Document";
    saveResource({ projectId: selectedProject.id, name: file.name, type, category: type === "Design file" ? "Design" : "Documents", ownerId: personaId, detail: file.size, link: "", updatedAt: new Date().toISOString().slice(0, 10), size: file.size, tags: [], starred: false, deletedAt: null });
  };
  const openCreateResource = (type?: Resource["type"]) => { if (selectedProject) setEditor({ kind: "resource", projectId: selectedProject.id, type }); };
  const openEditResource = (resourceId: string) => setEditor({ kind: "resource", id: resourceId });

  const isPeoplePage = active === "People" || (scope === "project" && (active === "Resources" || active === "Meetings" || active === "Tasks" || active === "Kanban"));
  const handleSignOut = async () => {
    await authActions.signOut();
    setWorkspaceNotice(null);
    // Anonymous home is the landing again; the demo stays opt-in per session.
    setDemoMode(false);
    setActive("Overview");
  };
  const showLanding = !signedIn && !demoMode && active === "Overview";
  const openSignIn = () => { setAuthMode("sign-in"); setAuthOpen(true); };
  const openSignUp = () => { setAuthMode("sign-up"); setAuthOpen(true); };
  const exploreDemo = () => {
    window.history.pushState({ asquiiView: "demo" }, "", "#demo");
    setDemoMode(true);
    setActive("Overview");
  };
  const exitDemo = () => {
    // Prefer the real history stack so browser Back/Forward stays coherent.
    if (window.history.state?.asquiiView === "demo") {
      window.history.back();
    } else {
      setDemoMode(false);
      setActive("Overview");
    }
  };
  const invitePending = !signedIn && new URLSearchParams(window.location.search).has("invite");

  return <>
    {showLanding ? (
      <div className="min-h-screen bg-page text-heading">
        {auth.status === "error" && (
          <div role="alert" className="ui-error-banner mx-auto mt-4 max-w-6xl !items-center">
            <span className="flex-1">{auth.message}</span>
            <button className="ui-button ui-button-secondary ui-button-sm shrink-0" onClick={authActions.retry}>Retry</button>
          </div>
        )}
        <LandingPage
          theme={theme}
          onToggleTheme={() => setTheme(previous => previous === "light" ? "dark" : "light")}
          onSignIn={openSignIn}
          onSignUp={openSignUp}
          onExploreDemo={exploreDemo}
          invitePending={invitePending}
        />
      </div>
    ) : (
    <AppShell scope={signedIn ? "workspace" : scope} active={signedIn && active !== "Projects" ? "Overview" : active} onNavigate={navigate} workspace={displayWorkspace} workspaces={displayWorkspaces} projects={displayProjects} project={displaySelectedProject} tasks={workspaceTasks} people={data.people} personaId={personaId} role={displayRole} canAdmin={displayCanAdmin} notifications={notifications} onSelectWorkspace={selectWorkspace} onSelectProject={selectProject} onSelectPersona={setPersonaId} onCreateWorkspace={() => setWorkspaceEditorOpen(true)} onOpenProjectPage={openProjectPage} onReadNotification={markNotificationRead} onMarkAllNotificationsRead={markAllNotificationsRead} recentProjectIds={recentIds} onCreateProject={!signedIn && displayCanAdmin ? openCreateProject : undefined} onCreateTask={!signedIn && selectedProject ? () => openCreateTask() : undefined} onCreateMeeting={!signedIn && selectedProject ? openCreateMeeting : undefined} onCreateResource={!signedIn && selectedProject ? openCreateResource : undefined} onQuickCreate={!signedIn ? openQuickCreate : undefined} theme={theme} onToggleTheme={() => setTheme(previous => previous === "light" ? "dark" : "light")} account={account} onShowSignIn={openSignIn} onSignOut={() => void handleSignOut()} onBackToLanding={!signedIn && demoMode ? exitDemo : undefined}>
    {storageError && <div role="alert" className="ui-error-banner mb-5"><span className="flex-1">{storageError}</span><button className="icon-button -my-1 text-danger" aria-label="Dismiss message" onClick={clearStorageError}><X size={15} /></button></div>}
    {auth.status === "error" && (
      <div role="alert" className="ui-error-banner mb-5 !items-center">
        <span className="flex-1">{auth.message}</span>
        <button className="ui-button ui-button-secondary ui-button-sm shrink-0" onClick={authActions.retry}>Retry</button>
      </div>
    )}
    {signedIn ? <>
        {workspaceNotice && <div role="status" className={`mb-5 rounded-xl border border-line px-4 py-3 text-xs font-medium ${workspaceNotice.tone === "success" ? "bg-brand-soft text-brand" : "bg-danger-soft text-danger"}`}>{workspaceNotice.text}</div>}
        {active === "Projects"
          ? (realProjectId
            ? <RealProjectDetailPage workspaceState={realWorkspaces} projectId={realProjectId} getAccessToken={authActions.getAccessToken} identityUserId={identityUserId} onBack={() => setRealProjectId(null)} />
            : <RealProjectsPage workspaceState={realWorkspaces} getAccessToken={authActions.getAccessToken} onOpenProject={setRealProjectId} />)
          : <RealWorkspaceHome workspaceState={realWorkspaces} getAccessToken={authActions.getAccessToken} identityUserId={identityUserId} onOpenProject={id => { setRealProjectId(id); navigate("Projects"); }} />}
      </>
      : <>
        {!isPeoplePage && active !== "Overview" && !(scope === "project" && active === "Settings") && !(scope === "workspace" && active === "Projects") && <div className="mb-5 flex flex-wrap items-end justify-between gap-3 sm:mb-6"><div><h1 className="mobile-page-title text-2xl font-semibold tracking-tight">{pageTitle}</h1><p className="mt-1.5 text-sm text-muted">{description(scope, active, role)}</p></div>{action && <Button variant="primary" icon={<Plus size={15} />} onClick={scope === "workspace" ? openCreateProject : () => openCreateTask()}>{action}</Button>}</div>}
        {scope === "workspace"
          ? <WorkspaceRoute active={active} data={scopedWorkspaceData} workspace={workspace} memberships={workspaceMemberships} invitations={data.invitations.filter(item => item.workspaceId === workspace.id)} canAdmin={canAdmin} role={role} personaId={personaId} onOpenProject={selectProject} onEditProject={id => canAdmin && setEditor({ kind: "project", id })} onCreateProject={openCreateProject} onImportProjects={importProjects} onSaveSettings={saveSettings} theme={theme} onToggleTheme={() => setTheme(previous => previous === "light" ? "dark" : "light")} onViewProjects={() => navigate("Projects")} onViewPeople={() => navigate("People")} onInvite={createInvite} onRoleChange={updateMemberRole} onAcceptInvite={acceptInvite} onRevokeInvite={revokeInvite} />
          : <ProjectRoute active={active} project={selectedProject} data={projectData} canAdmin={canAdmin} personaId={personaId} onNavigate={navigate} onEditProject={id => canAdmin && setEditor({ kind: "project", id })} onEditTask={id => setEditor({ kind: "task", id })} onCreateTask={openCreateTask} onUpdateTask={updateTask} onDeleteTask={deleteTask} onReorderTask={reorderTask} onCreateMeeting={openCreateMeeting} onEditMeeting={openEditMeeting} onDeleteMeeting={deleteMeeting} onCreateResource={openCreateResource} onEditResource={openEditResource} onDeleteResource={deleteResource} onRestoreResource={restoreResource} onPurgeResource={purgeResource} onStarResource={starResource} onUploadResource={uploadResource} onSaveSettings={saveSettings} theme={theme} onToggleTheme={() => setTheme(previous => previous === "light" ? "dark" : "light")} />}
        {editor?.kind === "project" && canAdmin && <ProjectEditor project={editor.id ? data.projects.find(project => project.id === editor.id && project.workspaceId === workspace.id) : undefined} workspaceId={workspace.id} projects={data.projects.filter(project => project.workspaceId === workspace.id)} people={workspacePeople} onClose={() => setEditor(null)} onSave={saveProject} />}
        {editor?.kind === "task" && selectedProject && <TaskEditor task={editor.id ? data.tasks.find(task => task.id === editor.id && task.projectId === selectedProject.id) : undefined} projectId={editor.projectId ?? selectedProject.id} initialStatus={editor.status} projects={[selectedProject]} people={projectPeople} personaId={personaId} onClose={() => setEditor(null)} onSave={saveTask} />}
        {editor?.kind === "meeting" && selectedProject && <MeetingEditor meeting={editor.id ? data.meetings.find(meeting => meeting.id === editor.id && meeting.projectId === selectedProject.id) : undefined} projectId={selectedProject.id} projects={[selectedProject]} people={projectPeople} onClose={() => setEditor(null)} onSave={saveMeeting} />}
        {editor?.kind === "resource" && selectedProject && <ResourceEditor resource={editor.id ? data.resources.find(resource => resource.id === editor.id && resource.projectId === selectedProject.id) : undefined} initialType={editor.type} projectId={selectedProject.id} people={projectPeople} onClose={() => setEditor(null)} onSave={saveResource} />}
      </>}
    {workspaceEditorOpen && <WorkspaceEditor onClose={() => setWorkspaceEditorOpen(false)} onSave={createWorkspace} />}
    </AppShell>
    )}
    <AuthPanel open={authOpen} initialMode={authMode} onClose={() => setAuthOpen(false)} />
  </>;
}

function WorkspaceRoute({ active, data, workspace, memberships, invitations, canAdmin, role, personaId, onOpenProject, onEditProject, onCreateProject, onImportProjects, onSaveSettings, theme, onToggleTheme, onViewProjects, onViewPeople, onInvite, onRoleChange, onAcceptInvite, onRevokeInvite }: { active: string; data: AppData; workspace: Workspace; memberships: Membership[]; invitations: Invitation[]; canAdmin: boolean; role: WorkspaceRole; personaId: string; onOpenProject: (id: string) => void; onEditProject: (id: string) => void; onCreateProject: () => void; onImportProjects: (projects: ImportedProject[]) => void; onSaveSettings: (settings: Workspace) => void; theme: "light" | "dark"; onToggleTheme: () => void; onViewProjects: () => void; onViewPeople: () => void; onInvite: (email: string, role: WorkspaceRole) => boolean; onRoleChange: (personId: string, role: WorkspaceRole) => void; onAcceptInvite: (id: string) => void; onRevokeInvite: (id: string) => void }) {
  if (active === "Projects") return <ProjectsPage data={data} canManage={canAdmin} onOpen={project => onOpenProject(project.id)} onEdit={onEditProject} onCreate={onCreateProject} onImport={onImportProjects} />;
  if (active === "People") return <PeoplePage data={data} workspaceId={workspace.id} memberships={memberships} invitations={invitations} canManage={canAdmin} onInvite={onInvite} onRoleChange={onRoleChange} onAcceptInvite={onAcceptInvite} onRevokeInvite={onRevokeInvite} />;
  if (active === "Settings" && canAdmin) return <SettingsPage key={workspace.id} settings={workspace} onSave={onSaveSettings} theme={theme} onToggleTheme={onToggleTheme} people={data.people} workspaceId={workspace.id} memberships={memberships} canManage={canAdmin} onRoleChange={onRoleChange} />;
  return <WorkspaceOverviewPage data={data} workspace={workspace} role={role} personaId={personaId} onOpenProject={project => onOpenProject(project.id)} onEditProject={onEditProject} onViewProjects={onViewProjects} onViewPeople={onViewPeople} onCreateProject={onCreateProject} />;
}

function ProjectRoute({ active, project, data, canAdmin, personaId, onNavigate, onEditProject, onEditTask, onCreateTask, onUpdateTask, onDeleteTask, onReorderTask, onCreateMeeting, onEditMeeting, onDeleteMeeting, onCreateResource, onEditResource, onDeleteResource, onRestoreResource, onPurgeResource, onStarResource, onUploadResource }: { active: string; project?: Project; data: AppData; canAdmin: boolean; personaId: string; onNavigate: (item: string) => void; onEditProject: (id: string) => void; onEditTask: (id: string) => void; onCreateTask: (status?: TaskStatus) => void; onUpdateTask: (id: string, patch: Partial<Task>) => void; onDeleteTask: (taskId: string) => void; onReorderTask: (taskId: string, beforeTaskId: string | null) => void; onCreateMeeting: () => void; onEditMeeting: (meetingId: string) => void; onDeleteMeeting: (meetingId: string) => void; onCreateResource: () => void; onEditResource: (resourceId: string) => void; onDeleteResource: (resourceId: string) => void; onRestoreResource: (resourceId: string) => void; onPurgeResource: (resourceId: string) => void; onStarResource: (resourceId: string) => void; onUploadResource: (file: { name: string; size: string }) => void; onSaveSettings: (settings: Workspace) => void; theme: "light" | "dark"; onToggleTheme: () => void }) {
  if (active === "Settings") return <ProjectSettingsPage project={project} data={data} canManage={canAdmin} onEdit={onEditProject} onNavigate={onNavigate} />;
  if (active === "People") return <ProjectPeoplePage project={project} data={data} canManage={canAdmin} onEditProject={onEditProject} />;
  if (active === "Kanban") return <KanbanPage projectId={project?.id ?? ""} data={data} onEdit={onEditTask} onCreate={onCreateTask} onUpdate={onUpdateTask} onReorder={onReorderTask} onNavigate={onNavigate} />;
  if (active === "Tasks") return <TasksPage projectId={project?.id ?? ""} data={data} onEdit={onEditTask} onUpdate={onUpdateTask} onCreate={() => onCreateTask()} onViewBoard={() => onNavigate("Kanban")} onDelete={onDeleteTask} />;
  if (active === "Meetings") return <MeetingsPage project={project} data={data} personaId={personaId} canManage={canAdmin} onCreate={onCreateMeeting} onEdit={onEditMeeting} onDelete={onDeleteMeeting} />;
  if (active === "Resources") return <ResourcesPage project={project} data={data} canManage={canAdmin} onCreate={onCreateResource} onEdit={onEditResource} onDelete={onDeleteResource} onRestore={onRestoreResource} onPurge={onPurgeResource} onStar={onStarResource} onUpload={onUploadResource} />;
  return <ProjectOverviewPage project={project} data={data} canManage={canAdmin} onEditProject={onEditProject} onViewTasks={() => onNavigate("Tasks")} />;
}

function description(scope: Scope, active: string, role: WorkspaceRole) {
  if (active === "Overview" && scope === "workspace") return role === "Admin" ? "Portfolio health, project progress, and team workload across this workspace." : "Your assigned projects, work in progress, and upcoming priorities.";
  const descriptions: Record<string, string> = { Overview: "Plan, track, and ship work together.", Projects: "Explore project health across this workspace and open the work you’re assigned to.", People: "Manage workspace members, roles and access across all projects in this workspace.", Settings: "Configure this workspace’s details and appearance.", Kanban: "Visualize the flow of work from backlog to completion.", Tasks: "A clear, actionable view of every project deliverable.", Meetings: "Plan, run and track project meetings, agendas, notes and action items.", Resources: "Manage project files, documents, links and other shared assets." };
  return descriptions[active] ?? "Manage your workspace and project work.";
}

function readLocal(key: string, fallback: string) { try { return localStorage.getItem(key) ?? fallback; } catch { return fallback; } }
function readTheme(): "light" | "dark" { try { const theme = localStorage.getItem("asquii.theme") === "dark" ? "dark" : "light"; document.documentElement.dataset.theme = theme; return theme; } catch { return "light"; } }



