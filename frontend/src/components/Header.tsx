import { BriefcaseBusiness, CalendarDays, ChevronDown, FolderKanban, ListTodo, Menu, Moon, Plus, Search, Settings2, Sun, UserRound, Video, FolderOpen, Bell, ArrowRight, ArrowLeft } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";
import type { Person, Project, Workspace, WorkspaceRole } from "../model";
import type { NotificationItem, Scope } from "./AppShell";

type HeaderProps = {
  scope: Scope; active: string; workspace: Workspace; workspaces: Workspace[]; projects: Project[]; project?: Project;
  setMobileOpen: Dispatch<SetStateAction<boolean>>; switcherOpen: boolean; setSwitcherOpen: Dispatch<SetStateAction<boolean>>;
  setPaletteOpen: Dispatch<SetStateAction<boolean>>; unreadCount: number; bellOpen: boolean; setBellOpen: Dispatch<SetStateAction<boolean>>;
  notifications: NotificationItem[]; onMarkAllNotificationsRead: () => void; onReadNotification: (id: string) => void; navigate: (label: string) => void;
  onOpenProjectPage: (projectId: string, page: string) => void; theme: "light" | "dark"; onToggleTheme: () => void; onQuickCreate?: () => void;
  currentPerson?: Person; personaOpen: boolean; setPersonaOpen: Dispatch<SetStateAction<boolean>>; people: Person[]; role: WorkspaceRole; personaId: string; onSelectPersona: (id: string) => void;
  chooseWorkspace: (id: string) => void; chooseProject: (id: string) => void; onCreateWorkspace: () => void;
  account?: { name: string; email: string | null } | null; onShowSignIn: () => void; onSignOut: () => void;
  /** Set only while an anonymous visitor is inside the prototype demo. */
  onBackToLanding?: () => void;
};

const notificationTones = { danger: "bg-danger-soft text-danger", warning: "bg-warning-soft text-warning", brand: "bg-brand-soft text-brand", neutral: "bg-hover text-secondary" } as const;
function notificationIcon(kind: NotificationItem["kind"]) { return kind === "task" ? <ListTodo size={14} /> : kind === "invite" ? <BriefcaseBusiness size={14} /> : kind === "meeting" ? <Video size={14} /> : kind === "milestone" ? <CalendarDays size={14} /> : <FolderOpen size={14} />; }
const notificationPages: Record<Exclude<NotificationItem["kind"], "invite">, string> = { task: "Tasks", meeting: "Meetings", milestone: "Overview", resource: "Resources" };

export function Header({ scope, active, workspace, workspaces, projects, project, setMobileOpen, switcherOpen, setSwitcherOpen, setPaletteOpen, unreadCount, bellOpen, setBellOpen, notifications, onMarkAllNotificationsRead, onReadNotification, navigate, onOpenProjectPage, theme, onToggleTheme, onQuickCreate, currentPerson, personaOpen, setPersonaOpen, people, role, personaId, onSelectPersona, chooseWorkspace, chooseProject, onCreateWorkspace, account, onShowSignIn, onSignOut, onBackToLanding }: HeaderProps) {
  return (
    <header className="fixed inset-x-0 top-0 z-40 flex h-14 items-center justify-between border-b border-line bg-surface px-3 sm:px-4 md:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <button className="icon-button md:hidden" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button>
        <div className="flex items-center gap-2"><div className="grid h-7 w-7 place-items-center rounded-lg bg-brand text-sm font-semibold text-white">A</div><span className="text-[17px] font-semibold tracking-tight">Asquii</span></div>
        {onBackToLanding && <span className="hidden rounded-full bg-brand-soft px-2 py-0.5 text-[10px] font-semibold text-brand sm:inline">Demo</span>}
        <span className="hidden h-6 w-px bg-line sm:block" />
        <button className="hidden max-w-[280px] items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-hover sm:flex" aria-expanded={switcherOpen} onClick={() => setSwitcherOpen(value => !value)}>
          <span className="min-w-0"><span className="block truncate text-[10px] leading-4 text-muted">{scope === "workspace" ? "WORKSPACE" : `PROJECT · ${workspace.name.toUpperCase()}`}</span><span className="block truncate text-[13px] font-semibold text-heading">{scope === "workspace" ? workspace.name : project?.name}</span></span><ChevronDown size={14} className="shrink-0 text-muted" />
        </button>
        {switcherOpen && <div className="absolute left-3 top-14 z-50 max-h-[75vh] w-72 overflow-y-auto rounded-xl border border-line bg-surface p-2 shadow-lg sm:left-[220px]">
          <div className="flex items-center justify-between px-3 pb-1 pt-2"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Workspaces</p><span className="text-[10px] text-muted">{workspaces.length}</span></div>
          {workspaces.map(item => <button key={item.id} className={`menu-row flex items-center gap-2.5 ${item.id === workspace.id ? "bg-brand-soft text-brand-pressed" : ""}`} onClick={() => chooseWorkspace(item.id)}><BriefcaseBusiness size={15} />{item.name}{item.id === workspace.id && <span className="ml-auto text-[10px] text-muted">Current</span>}</button>)}
          <button className="menu-row flex items-center gap-2.5 text-brand" onClick={() => { setSwitcherOpen(false); onCreateWorkspace(); }}><Plus size={15} />Create workspace</button>
          <div className="my-2 border-t border-line" />
          <div className="px-3 pb-1 pt-1"><p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Projects · {workspace.name}</p></div>
          {projects.map(item => <button key={item.id} className={`menu-row flex items-center gap-2.5 ${item.id === project?.id && scope === "project" ? "bg-brand-soft text-brand-pressed" : ""}`} onClick={() => chooseProject(item.id)}><FolderKanban size={15} />{item.name}</button>)}
          {projects.length === 0 && <p className="px-3 py-2 text-xs text-muted">No projects available for this account.</p>}
        </div>}
      </div>
      <div className="flex items-center gap-2">
        <button className="hidden h-9 w-56 items-center gap-2 rounded-md border border-line px-3 text-muted hover:border-strong hover:text-secondary lg:flex" aria-label="Search projects, tasks, and people" aria-haspopup="dialog" onClick={() => { setPaletteOpen(true); setSwitcherOpen(false); }}><Search size={15} /><span className="flex-1 text-left text-xs">Search anything</span><kbd className="rounded border border-line px-1.5 py-0.5 text-[10px]">⌘ K</kbd></button>
        <button className="icon-button lg:hidden" aria-label="Search anything" onClick={() => { setPaletteOpen(true); setSwitcherOpen(false); }}><Search size={17} /></button>
        <div className="relative">{bellOpen && <button className="fixed inset-0 z-30" aria-label="Close notifications" onClick={() => setBellOpen(false)} />}
          <button className="icon-button relative" aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "No new notifications"} aria-expanded={bellOpen} aria-haspopup="menu" onClick={() => setBellOpen(value => !value)}><Bell size={17} />{unreadCount > 0 && <span className="absolute right-1 top-1 grid h-3.5 min-w-[14px] place-items-center rounded-full bg-danger px-0.5 text-[8px] font-bold text-surface">{unreadCount > 9 ? "9+" : unreadCount}</span>}</button>
          {bellOpen && <div role="menu" aria-label="Notifications" className="absolute right-0 top-11 z-50 w-80 overflow-hidden rounded-xl border border-line bg-surface shadow-lg">
            <div className="flex items-center justify-between border-b border-line px-4 py-3"><p className="text-xs font-semibold">Notifications</p><span className="flex items-center gap-3"><span className="text-[10px] text-muted">{unreadCount} unread · {notifications.length} total</span>{unreadCount > 0 && <button className="text-[10px] font-semibold text-brand hover:text-brand-pressed" onClick={onMarkAllNotificationsRead}>Mark all read</button>}</span></div>
            {notifications.length === 0 ? <p className="px-4 py-6 text-center text-xs text-muted">You're all caught up.</p> : <div className="max-h-80 overflow-y-auto">{notifications.map(item => <button key={item.id} role="menuitem" className={`flex w-full items-start gap-3 border-b border-line px-4 py-3 text-left transition last:border-0 ${item.read ? "hover:bg-hover" : "bg-hover/60 hover:bg-hover"}`} onClick={() => { setBellOpen(false); onReadNotification(item.id); if (item.kind === "invite") navigate("People"); else onOpenProjectPage(item.projectId ?? "", notificationPages[item.kind]); }}><span className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg ${notificationTones[item.tone]}`}>{notificationIcon(item.kind)}</span><span className="min-w-0 flex-1"><span className="flex items-center gap-1.5"><span className={`block truncate text-xs ${item.read ? "text-secondary" : "font-semibold text-heading"}`}>{item.title}</span>{!item.read && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" title="Unread" />}</span><span className="mt-0.5 block truncate text-[11px] text-muted">{item.detail}</span></span><ArrowRight size={13} className="mt-1.5 shrink-0 text-muted" /></button>)}</div>}
          </div>}
        </div>
        {onBackToLanding && (
          <button className="flex items-center gap-1.5 rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-secondary hover:bg-hover" aria-label="Back to the landing page" onClick={onBackToLanding}>
            <ArrowLeft size={13} /><span className="hidden sm:inline">Back to landing</span>
          </button>
        )}
        <button className="icon-button" aria-label={`Switch to ${theme === "light" ? "dark" : "light"} theme`} aria-pressed={theme === "dark"} onClick={onToggleTheme}>{theme === "light" ? <Moon size={17} /> : <Sun size={17} />}</button>
        {onQuickCreate && <button className="icon-button hidden sm:grid" aria-label="Quick create" onClick={onQuickCreate}><Plus size={18} /></button>}
        {account
          ? <div className="relative">
            <button className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-label={`Account, signed in as ${account.name}`} aria-expanded={personaOpen} onClick={() => setPersonaOpen(value => !value)}>{account.name.trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</button>
            {personaOpen && <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-line bg-surface p-2 shadow-lg">
              <div className="border-b border-line px-3 pb-2 pt-1">
                <p className="truncate text-xs font-semibold">{account.name}</p>
                {account.email && <p className="mt-0.5 truncate text-[10px] text-muted">{account.email}</p>}
                <p className="mt-1 text-[10px] text-muted">Signed in · project lists still show sample data until integration is complete</p>
              </div>
              <button className="menu-row flex w-full items-center gap-2.5 text-danger" onClick={() => { setPersonaOpen(false); onSignOut(); }}>Sign out</button>
            </div>}
          </div>
          : <>
            <button className="hidden rounded-lg border border-line px-2.5 py-1.5 text-xs font-semibold text-brand hover:border-brand hover:text-brand-pressed sm:block" onClick={onShowSignIn}>Sign in</button>
            <button className="rounded-md px-2 py-1.5 text-xs font-semibold text-brand hover:text-brand-pressed sm:hidden" aria-label="Sign in" onClick={onShowSignIn}>Sign in</button>
            <div className="relative"><button className="grid h-8 w-8 place-items-center rounded-full bg-brand-soft text-xs font-semibold text-brand" aria-label="Switch preview persona" aria-expanded={personaOpen} onClick={() => setPersonaOpen(value => !value)}>{currentPerson?.name.split(" ").map(part => part[0]).join("") ?? "A"}</button>
              {personaOpen && <div className="absolute right-0 top-10 z-50 w-64 rounded-xl border border-line bg-surface p-2 shadow-lg"><div className="border-b border-line px-3 pb-2 pt-1"><p className="text-xs font-semibold">Preview as</p><p className="mt-1 text-[10px] text-muted">Local prototype persona · {role}</p></div>{people.map(person => <button key={person.id} className={`menu-row flex items-center gap-2.5 ${person.id === personaId ? "bg-brand-soft text-brand-pressed" : ""}`} onClick={() => { onSelectPersona(person.id); setPersonaOpen(false); }}><span className="grid h-7 w-7 place-items-center rounded-full bg-hover text-[10px] font-semibold">{person.name.split(" ").map(part => part[0]).join("")}</span><span className="min-w-0 flex-1"><span className="block truncate">{person.name}</span><span className="block truncate text-[10px] text-muted">{person.role}</span></span></button>)}</div>}
            </div>
          </>}
      </div>
    </header>
  );
}
