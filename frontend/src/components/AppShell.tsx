import { useEffect, useMemo, useState } from "react";
import { Header } from "./Header";
import { Sidebar } from "./Sidebar";
import { Activity, ArrowRight, Bell, BriefcaseBusiness, CalendarDays, ChevronDown, ChevronsLeft, ChevronsRight, CornerDownLeft, FolderKanban, LayoutDashboard, ListTodo, Menu, Moon, Plus, Search, Settings2, Sun, UserRound, Users, Video, FolderOpen, X } from "lucide-react";
import type { Person, Project, Task, Workspace, WorkspaceRole } from "../model";

export type Scope = "workspace" | "project";
export type NotificationKind = "task" | "invite" | "meeting" | "milestone" | "resource";
export type NotificationItem = { id: string; kind: NotificationKind; title: string; detail: string; projectId?: string; tone: "danger" | "warning" | "brand" | "neutral"; read: boolean };

const notificationTones = { danger: "bg-danger-soft text-danger", warning: "bg-warning-soft text-warning", brand: "bg-brand-soft text-brand", neutral: "bg-hover text-secondary" } as const;

function notificationIcon(kind: NotificationKind) { return kind === "task" ? <ListTodo size={14} /> : kind === "invite" ? <BriefcaseBusiness size={14} /> : kind === "meeting" ? <Video size={14} /> : kind === "milestone" ? <CalendarDays size={14} /> : <FolderOpen size={14} />; }

const notificationPages: Record<Exclude<NotificationKind, "invite">, string> = { task: "Tasks", meeting: "Meetings", milestone: "Overview", resource: "Resources" };

type Props = {
  scope: Scope; active: string; onNavigate: (item: string) => void;
  workspace: Workspace; workspaces: Workspace[]; projects: Project[]; project?: Project;
  tasks: Task[]; people: Person[]; personaId: string; role: WorkspaceRole; canAdmin: boolean;
  notifications: NotificationItem[];
  onSelectWorkspace: (id: string) => void; onSelectProject: (id: string) => void; onSelectPersona: (id: string) => void; onCreateWorkspace: () => void;
  onOpenProjectPage: (projectId: string, page: string) => void; onReadNotification: (id: string) => void; onMarkAllNotificationsRead: () => void; recentProjectIds: string[]; onCreateProject?: () => void; onCreateTask?: () => void; onCreateMeeting?: () => void; onCreateResource?: () => void; onQuickCreate?: () => void; theme: "light" | "dark"; onToggleTheme: () => void; children: React.ReactNode;
  /** Real session account; null means unauthenticated prototype demo mode. */
  account?: { name: string; email: string | null } | null;
  onShowSignIn: () => void; onSignOut: () => void;
};

const workspaceItems = [{ label: "Overview", icon: LayoutDashboard }, { label: "Projects", icon: FolderKanban }, { label: "People", icon: Users }];
const projectItems = [{ label: "Overview", icon: LayoutDashboard }, { label: "People", icon: Users }, { label: "Kanban", icon: Activity }, { label: "Tasks", icon: ListTodo }, { label: "Meetings", icon: Video }, { label: "Resources", icon: FolderOpen }];
type PaletteResult = { key: string; type: "Project" | "Task" | "Person" | "Action"; id: string; name: string; sub: string; projectId?: string; run: () => void; icon?: React.ReactNode };

const paletteIcon = (result: PaletteResult) => result.icon ?? (result.type === "Project" ? <FolderKanban size={14} /> : result.type === "Task" ? <ListTodo size={14} /> : result.type === "Person" ? <UserRound size={14} /> : <CornerDownLeft size={14} />);

export function AppShell({ scope, active, onNavigate, workspace, workspaces, projects, project, tasks, people, personaId, role, canAdmin, notifications, onSelectWorkspace, onSelectProject, onSelectPersona, onCreateWorkspace, onOpenProjectPage, onReadNotification, onMarkAllNotificationsRead, recentProjectIds, onCreateProject, onCreateTask, onCreateMeeting, onCreateResource, onQuickCreate, theme, onToggleTheme, account, onShowSignIn, onSignOut, children }: Props) {
  const unreadCount = notifications.filter(item => !item.read).length;
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [personaOpen, setPersonaOpen] = useState(false);
  const [bellOpen, setBellOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [paletteQuery, setPaletteQuery] = useState("");
  const [paletteIndex, setPaletteIndex] = useState(0);
  const navItems = scope === "workspace" ? workspaceItems : projectItems;
  const sidebarWidth = collapsed ? "md:w-[56px]" : "md:w-[220px]";
  const currentPerson = people.find(person => person.id === personaId);
  const navigate = (label: string) => { onNavigate(label); setMobileOpen(false); };
  const chooseWorkspace = (id: string) => { onSelectWorkspace(id); setSwitcherOpen(false); setMobileOpen(false); };
  const chooseProject = (id: string) => { onSelectProject(id); setSwitcherOpen(false); setMobileOpen(false); };

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setPaletteOpen(value => !value); setSwitcherOpen(false); setMobileOpen(false); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteResults = useMemo<PaletteResult[]>(() => {
    const query = paletteQuery.trim().toLowerCase();
    const score = (label: string) => { const at = label.toLowerCase().indexOf(query); return at < 0 ? 999 : at; };
    const projectName = (projectId: string) => projects.find(item => item.id === projectId)?.name ?? "Project";
    const results: PaletteResult[] = [];
    const addPage = (name: string, sub: string, run: () => void, icon: React.ReactNode) => results.push({ key: `action-${name}`, type: "Action" as const, id: name, name, sub, run, icon });
    if (scope === "workspace") {
      addPage("Go to workspace overview", "Portfolio, milestones, and team workload", () => navigate("Overview"), <LayoutDashboard size={14} />);
      addPage("Go to projects", "All workspace projects", () => navigate("Projects"), <FolderKanban size={14} />);
      addPage("Go to people", "Workspace directory and roles", () => navigate("People"), <Users size={14} />);
      if (canAdmin) addPage("Go to settings", "Workspace settings and preferences", () => navigate("Settings"), <Settings2 size={14} />);
    } else {
      addPage("Go to project overview", project?.name ?? "Project", () => navigate("Overview"), <LayoutDashboard size={14} />);
      addPage("Go to kanban", "Project board", () => navigate("Kanban"), <Activity size={14} />);
      addPage("Go to tasks", "Project task list", () => navigate("Tasks"), <ListTodo size={14} />);
      addPage("Go to meetings", "Project meeting schedule", () => navigate("Meetings"), <Video size={14} />);
      addPage("Go to resources", "Project library", () => navigate("Resources"), <FolderOpen size={14} />);
      addPage("Back to workspace overview", workspace.name, () => navigate("Workspace overview"), <BriefcaseBusiness size={14} />);
    }
    if (onCreateProject) addPage("Create project", "Adds a project to this workspace", onCreateProject, <Plus size={14} />);
    if (onCreateTask) addPage("Create task", "Adds a task to this project", onCreateTask, <Plus size={14} />);
    if (onCreateMeeting) addPage("Schedule meeting", "Books a meeting in this project", onCreateMeeting, <Plus size={14} />);
    if (onCreateResource) addPage("Add resource", "Adds a file or link to this project", onCreateResource, <Plus size={14} />);
    addPage(`Switch to ${theme === "light" ? "dark" : "light"} theme`, "Appearance", onToggleTheme, theme === "light" ? <Moon size={14} /> : <Sun size={14} />);
    const recents = recentProjectIds.map(id => projects.find(item => item.id === id)).filter((item): item is Project => Boolean(item)).slice(0, 3).map(item => ({ key: `project-${item.id}`, type: "Project" as const, id: item.id, name: item.name, sub: `Recent · ${item.description || workspace.name}`, projectId: item.id, run: () => chooseProject(item.id) }));
    if (query) {
      results.push(...projects.map(item => ({ key: `project-${item.id}`, type: "Project" as const, id: item.id, name: item.name, sub: item.description || workspace.name, projectId: item.id, run: () => chooseProject(item.id) })));
      results.push(...tasks.map(item => ({ key: `task-${item.id}`, type: "Task" as const, id: item.id, name: item.title, sub: `${projectName(item.projectId)} – ${item.status}`, projectId: item.projectId, run: () => onOpenProjectPage(item.projectId, "Tasks") })));
      results.push(...people.map(item => ({ key: `person-${item.id}`, type: "Person" as const, id: item.id, name: item.name, sub: item.role, run: () => navigate("People") })));
    } else {
      results.push(...recents);
      results.push(...workspaces.filter(item => item.id !== workspace.id).map(item => ({ key: `workspace-${item.id}`, type: "Action" as const, id: item.id, name: `Open workspace: ${item.name}`, sub: "Switch workspace", run: () => chooseWorkspace(item.id), icon: <BriefcaseBusiness size={14} /> })));
      results.push(...people.filter(item => item.id !== personaId && !account).map(item => ({ key: `persona-${item.id}`, type: "Action" as const, id: item.id, name: `Preview as ${item.name}`, sub: item.role, run: () => { onSelectPersona(item.id); setPersonaOpen(false); }, icon: <UserRound size={14} /> })));
    }
    const matched = query ? results.filter(item => `${item.name} ${item.sub}`.toLowerCase().includes(query)) : results;
    return matched.sort((a, b) => score(`${a.type} ${a.name} ${a.sub}`) - score(`${b.type} ${b.name} ${b.sub}`)).slice(0, 10);
  }, [paletteQuery, projects, tasks, people, workspaces, workspace, scope, canAdmin, project?.id, theme, recentProjectIds, personaId, onToggleTheme, onCreateProject, onCreateTask, onCreateMeeting, onCreateResource, onSelectPersona, account]);

  const runPaletteResult = (result: PaletteResult) => {
    setPaletteOpen(false); setPaletteQuery(""); setPaletteIndex(0); setMobileOpen(false);
    result.run();
  };
  const onPaletteKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") { event.preventDefault(); setPaletteIndex(value => Math.min(value + 1, paletteResults.length - 1)); }
    if (event.key === "ArrowUp") { event.preventDefault(); setPaletteIndex(value => Math.max(value - 1, 0)); }
    if (event.key === "Enter" && paletteResults[paletteIndex]) { event.preventDefault(); runPaletteResult(paletteResults[paletteIndex]); }
  };

  return <div className="min-h-screen bg-page text-heading">
    <Header scope={scope} active={active} workspace={workspace} workspaces={workspaces} projects={projects} project={project} setMobileOpen={setMobileOpen} switcherOpen={switcherOpen} setSwitcherOpen={setSwitcherOpen} setPaletteOpen={setPaletteOpen} unreadCount={unreadCount} bellOpen={bellOpen} setBellOpen={setBellOpen} notifications={notifications} onMarkAllNotificationsRead={onMarkAllNotificationsRead} onReadNotification={onReadNotification} navigate={navigate} onOpenProjectPage={onOpenProjectPage} theme={theme} onToggleTheme={onToggleTheme} onQuickCreate={onQuickCreate} currentPerson={currentPerson} personaOpen={personaOpen} setPersonaOpen={setPersonaOpen} people={people} role={role} personaId={personaId} onSelectPersona={onSelectPersona} chooseWorkspace={chooseWorkspace} chooseProject={chooseProject} onCreateWorkspace={onCreateWorkspace} account={account} onShowSignIn={onShowSignIn} onSignOut={onSignOut} />
    {mobileOpen && <button className="fixed inset-0 z-40 bg-overlay md:hidden" aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} />}
    <Sidebar scope={scope} active={active} workspace={workspace} workspaces={workspaces} projects={projects} project={project} mobileOpen={mobileOpen} setMobileOpen={setMobileOpen} collapsed={collapsed} setCollapsed={setCollapsed} canAdmin={canAdmin} onNavigate={onNavigate} onSelectWorkspace={onSelectWorkspace} onSelectProject={onSelectProject} onCreateWorkspace={onCreateWorkspace} />
    <main className={`min-h-screen pt-14 transition-[padding] duration-200 ${collapsed ? "md:pl-14" : "md:pl-[220px]"}`}><div className="mobile-content mx-auto max-w-[1600px] p-5 md:p-8">
      <div className="relative -top-[10px] mb-5 flex flex-wrap items-center gap-2 text-xs text-muted sm:mb-6"><span>Workspace</span><span>/</span><button className="text-secondary hover:text-brand" onClick={() => navigate("Workspace overview")}>{workspace.name}</button>{scope === "project" && <><span>/</span><button className="hover:text-brand" onClick={() => navigate("Projects")}>Projects</button><span>/</span><span className="font-medium text-heading">{project?.name}</span></>}{active !== "Overview" && <><span>/</span><span className="text-heading">{active}</span></>}</div>
      {children}
    </div></main>
    {paletteOpen && <div className="ui-modal-backdrop fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]" onMouseDown={event => { if (event.target === event.currentTarget) { setPaletteOpen(false); setPaletteQuery(""); setPaletteIndex(0); } }}>
      <div role="dialog" aria-modal="true" aria-label="Search anything" onKeyDown={event => { if (event.key === "Escape") { setPaletteOpen(false); setPaletteQuery(""); setPaletteIndex(0); } }} className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3"><Search size={16} className="shrink-0 text-muted" /><input autoFocus className="min-w-0 flex-1 bg-transparent text-sm text-heading outline-none placeholder:text-muted" placeholder="Search or run a command…" value={paletteQuery} onChange={event => { setPaletteQuery(event.target.value); setPaletteIndex(0); }} onKeyDown={onPaletteKeyDown} aria-activedescendant={paletteResults[paletteIndex]?.key} /><kbd className="rounded border border-line px-1.5 py-0.5 text-[10px] text-muted">esc</kbd></div>
        {paletteResults.length === 0 ? <p className="px-4 py-8 text-center text-xs text-muted">No matches for “{paletteQuery}”.</p> : <ul className="max-h-80 overflow-y-auto p-1.5">{paletteResults.map((result, index) => <li key={result.key}>
          <button id={result.key} onMouseEnter={() => setPaletteIndex(index)} onClick={() => runPaletteResult(result)} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left ${index === paletteIndex ? "bg-brand-soft" : ""}`}><span className={`grid h-7 w-7 shrink-0 place-items-center rounded-lg ${index === paletteIndex ? "bg-surface text-brand" : "bg-hover text-secondary"}`}>{paletteIcon(result)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium text-heading">{result.name}</span><span className="block truncate text-[10px] text-muted">{result.sub}</span></span>
            <span className="shrink-0 text-[9px] font-semibold uppercase tracking-wider text-muted">{result.type}</span>{index === paletteIndex && <CornerDownLeft size={12} className="shrink-0 text-brand" />}</button></li>)}</ul>}
        <div className="flex items-center gap-4 border-t border-line px-4 py-2.5 text-[10px] text-muted"><span>↑↓ to navigate</span><span>↵ to open</span><span className="ml-auto">{paletteResults.length} results</span></div>
      </div>
    </div>}
  </div>;
}




