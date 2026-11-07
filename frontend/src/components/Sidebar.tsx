import { Activity, BriefcaseBusiness, ChevronsLeft, ChevronsRight, FolderKanban, LayoutDashboard, ListTodo, Milestone, Plus, Settings2, Users, Video, FolderOpen, X } from "lucide-react";
import type { Project, Workspace } from "../model";
import type { Scope } from "./AppShell";

type SidebarProps = { scope: Scope; active: string; workspace: Workspace; workspaces: Workspace[]; projects: Project[]; project?: Project; mobileOpen: boolean; setMobileOpen: (open: boolean) => void; collapsed: boolean; setCollapsed: (update: (value: boolean) => boolean) => void; canAdmin: boolean; /** Real (signed-in) project scope: backend project tabs. */ projectNav?: boolean; onNavigate: (item: string) => void; onSelectWorkspace: (id: string) => void; onSelectProject: (id: string) => void; onCreateWorkspace: () => void };

const workspaceNav = [{ label: "Overview", icon: LayoutDashboard }, { label: "Projects", icon: FolderKanban }, { label: "People", icon: Users }];
const prototypeProjectNav = [{ label: "Overview", icon: LayoutDashboard }, { label: "People", icon: Users }, { label: "Kanban", icon: Activity }, { label: "Tasks", icon: ListTodo }, { label: "Meetings", icon: Video }, { label: "Resources", icon: FolderOpen }];
/** Mirrors the backend's project tabs for the signed-in shell. */
const realProjectNav = [{ label: "Overview", icon: LayoutDashboard }, { label: "Kanban", icon: Activity }, { label: "Tasks", icon: ListTodo }, { label: "Meetings", icon: Video }, { label: "Resources", icon: FolderOpen }, { label: "Members", icon: Users }, { label: "Milestones", icon: Milestone }];

export function Sidebar({ scope, active, workspace, workspaces, projects, project, mobileOpen, setMobileOpen, collapsed, setCollapsed, canAdmin, projectNav, onNavigate, onSelectWorkspace, onSelectProject, onCreateWorkspace }: SidebarProps) {
  const navItems = scope === "workspace" ? workspaceNav : projectNav ? realProjectNav : prototypeProjectNav;
  const sidebarWidth = collapsed ? "md:w-[56px]" : "md:w-[220px]";
  const navigate = (label: string) => { onNavigate(label); setMobileOpen(false); };
  const chooseWorkspace = (id: string) => { onSelectWorkspace(id); setMobileOpen(false); };
  const chooseProject = (id: string) => { onSelectProject(id); setMobileOpen(false); };
  return (
    <aside className={`fixed bottom-0 left-0 top-14 z-50 flex ${sidebarWidth} w-[min(82vw,280px)] flex-col border-r border-line bg-sidebar transition-[width] duration-200 md:z-20 ${mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"}`}>
      <div className="flex items-center justify-between px-3 pb-2 pt-5">{!collapsed && <span className="section-label">{scope === "workspace" ? "WORKSPACE" : "PROJECT"}</span>}<button className="icon-button hidden md:grid" onClick={() => setCollapsed(value => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}</button><button className="icon-button md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={16} /></button></div>
      <nav className="space-y-1 px-2">{navItems.map(({ label, icon: Icon }) => <button key={label} onClick={() => navigate(label)} title={collapsed ? label : undefined} className={`nav-item ${active === label ? "nav-item-active" : ""} ${collapsed ? "md:justify-center md:px-0" : ""}`}><Icon size={17} strokeWidth={1.8} />{!collapsed && <span>{label}</span>}</button>)}</nav>
      {!collapsed && <div className="mt-6 px-3"><div className="mb-2 flex items-center justify-between"><span className="section-label">{scope === "project" ? `PROJECTS · ${workspace.name}` : "WORKSPACE"}</span>{scope === "project" && <span className="text-[10px] text-muted">{projects.length}</span>}</div>
        {scope === "project" && <button className="recent-item mb-1 w-full text-secondary" onClick={() => navigate("Workspace overview")}><LayoutDashboard size={14} /><span className="truncate">{workspace.name} overview</span></button>}
        {projects.slice(0, 8).map(item => <button key={item.id} className={`recent-item w-full ${item.id === project?.id && scope === "project" ? "bg-brand-soft font-medium text-brand-pressed" : ""}`} onClick={() => chooseProject(item.id)}><span className={`h-2 w-2 shrink-0 rounded-sm ${item.id === project?.id ? "bg-brand" : "bg-brand-soft"}`} /><span className="truncate">{item.name}</span></button>)}
        <div className="mt-4 border-t border-line pt-3 md:hidden"><p className="section-label mb-2">YOUR WORKSPACES</p>{workspaces.map(item => <button key={item.id} className={`recent-item w-full ${item.id === workspace.id ? "bg-brand-soft font-medium text-brand-pressed" : ""}`} onClick={() => chooseWorkspace(item.id)}><BriefcaseBusiness size={13} /><span className="truncate">{item.name}</span></button>)}<button className="recent-item w-full text-brand" onClick={onCreateWorkspace}><Plus size={13} /><span>Create workspace</span></button></div>
      </div>}
      <div className="mt-auto px-2 pb-4">{canAdmin && <button className={`nav-item ${active === "Settings" ? "nav-item-active" : ""} ${collapsed ? "md:justify-center md:px-0" : ""}`} onClick={() => navigate("Settings")}><Settings2 size={17} strokeWidth={1.8} />{!collapsed && <span>{scope === "workspace" ? "Workspace settings" : "Project settings"}</span>}</button>}</div>
    </aside>
  );
}
