import { useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowRight, ArrowUp, CalendarDays, CheckCircle2, CircleDot, Clock3, Download, FolderKanban, Grid2X2, List, MoreHorizontal, Plus, Search, Upload, Users } from "lucide-react";
import { AvatarGroup, Badge, Button, EmptyState, Select, TextInput } from "../../../components/ui";
import { projectHealth, projectProgress, sortMilestones, type AppData, type Project, type ProjectStatus } from "../../../model";

export type ImportedProject = { name: string; description: string; status: ProjectStatus; progress: number };
const teamFor = (role: string) => /design|product|ux|research/i.test(role) ? "Product & UX" : /qa|test/i.test(role) ? "QA & Testing" : /engineer|develop|backend|frontend|engineering/i.test(role) ? "Engineering" : "Operations";
const projectKey = (name: string) => name.split(/[^a-z0-9]+/i).filter(Boolean).map(word => word.slice(0, 1).toUpperCase()).join("").slice(0, 3) || "PRJ";
const formatDate = (value: string) => { if (!value) return "No deadline"; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { month: "short", day: "numeric", year: "numeric" }); };

export function ProjectsPage({ data, canManage, onOpen, onEdit, onCreate, onImport }: { data: AppData; canManage: boolean; onOpen: (project: Project) => void; onEdit: (id: string) => void; onCreate: () => void; onImport: (projects: ImportedProject[]) => void }) {
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("All projects");
  const [teamFilter, setTeamFilter] = useState("all");
  const [memberFilter, setMemberFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [sort, setSort] = useState("recent");
  const [layout, setLayout] = useState<"grid" | "list">("grid");
  const fileInput = useRef<HTMLInputElement>(null);
  const statusForTab = (project: Project) => tab === "Active" ? project.status === "In progress" : tab === "Completed" ? project.status === "Complete" : tab === "On hold" ? (project.status as string) === "On hold" : tab === "Archived" ? (project.status as string) === "Archived" : true;
  const teams = [...new Set(data.people.map(person => teamFor(person.role)))].sort();
  const filtered = useMemo(() => data.projects.filter(project => {
    const members = data.people.filter(person => project.personIds.includes(person.id));
    const availableTeams: string[] = [...new Set(members.map(person => teamFor(person.role)))];
    const key = projectKey(project.name);
    return statusForTab(project)
      && `${project.name} ${project.description} ${key}`.toLowerCase().includes(search.trim().toLowerCase())
      && (teamFilter === "all" || availableTeams.includes(teamFilter))
      && (memberFilter === "all" || project.personIds.includes(memberFilter))
      && (statusFilter === "all" || project.status === statusFilter);
  }).sort((a, b) => sort === "name" ? a.name.localeCompare(b.name) : sort === "progress" ? projectProgress(b, data.tasks) - projectProgress(a, data.tasks) : sort === "deadline" ? (sortMilestones(a.milestones)[0]?.due ?? "9999-99-99").localeCompare(sortMilestones(b.milestones)[0]?.due ?? "9999-99-99") : 0), [data.projects, data.people, data.tasks, search, tab, teamFilter, memberFilter, statusFilter, sort]);
  const counts = { all: data.projects.length, active: data.projects.filter(project => project.status === "In progress").length, completed: data.projects.filter(project => project.status === "Complete").length, hold: data.projects.filter(project => (project.status as string) === "On hold").length, archived: data.projects.filter(project => (project.status as string) === "Archived").length };
  const exportProjects = () => {
    const rows = [["Project", "Key", "Description", "Status", "Progress", "Deadline", "Tasks", "Members", "Teams"], ...data.projects.map(project => {
      const members = data.people.filter(person => project.personIds.includes(person.id));
      const deadline = sortMilestones(project.milestones)[0]?.due ?? "";
      return [project.name, projectKey(project.name), project.description, project.status, `${projectProgress(project, data.tasks)}%`, deadline, String(data.tasks.filter(task => task.projectId === project.id).length), String(members.length), String(new Set(members.map(person => teamFor(person.role))).size)];
    })];
    const csv = rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); link.download = "workspace-projects.csv"; link.click(); URL.revokeObjectURL(link.href);
  };
  const importFile = async (file?: File) => {
    if (!file) return;
    const text = await file.text();
    const [header, ...lines] = text.split(/\r?\n/).filter(Boolean);
    const fields = parseCsvRow(header ?? "").map(value => value.trim().toLowerCase());
    const nameIndex = fields.indexOf("name") >= 0 ? fields.indexOf("name") : fields.indexOf("project");
    const imported = lines.map(line => parseCsvRow(line)).filter(row => nameIndex >= 0 && row[nameIndex]?.trim()).map(row => {
      const read = (name: string, fallback = "") => { const index = fields.indexOf(name); return index >= 0 ? row[index] ?? fallback : fallback; };
      const rawStatus = read("status", "In progress");
      const status: ProjectStatus = rawStatus === "Complete" ? "Complete" : rawStatus === "In review" ? "In review" : "In progress";
      const rawProgress = Number(read("progress", "0").replace("%", ""));
      return { name: row[nameIndex].trim(), description: read("description").trim(), status, progress: Number.isFinite(rawProgress) ? Math.max(0, Math.min(100, rawProgress)) : 0 };
    });
    if (imported.length) onImport(imported);
    if (fileInput.current) fileInput.current.value = "";
  };
  const tabs = [["All projects", counts.all], ["Active", counts.active], ["Completed", counts.completed], ["On hold", counts.hold], ["Archived", counts.archived]] as const;
  return <div className="space-y-4">
    <header className="flex flex-wrap items-end justify-between gap-3"><div><h1 className="text-2xl font-semibold tracking-tight">Projects</h1><p className="mt-1 text-sm text-muted">Create, track and manage all projects in this workspace.</p></div><div className="flex gap-2">{canManage && <><input ref={fileInput} type="file" accept=".csv,text/csv" className="hidden" onChange={event => void importFile(event.target.files?.[0])} /><Button variant="secondary" icon={<Upload size={14} />} onClick={() => fileInput.current?.click()}>Import</Button><Button variant="secondary" icon={<Download size={14} />} onClick={exportProjects}>Export</Button><Button variant="primary" icon={<Plus size={14} />} onClick={onCreate}>New project</Button></>}</div></header>
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-4"><MetricCard label="Total projects" value={counts.all} note="In this workspace" icon={<FolderKanban size={16} />} tone="violet" /><MetricCard label="Active" value={counts.active} note="Currently in progress" icon={<CircleDot size={16} />} tone="blue" /><MetricCard label="Completed" value={counts.completed} note="Successfully delivered" icon={<CheckCircle2 size={16} />} tone="green" /><MetricCard label="On hold" value={counts.hold} note="Paused projects" icon={<Clock3 size={16} />} tone="orange" /></section>
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="flex gap-5 overflow-x-auto border-b border-line px-4 pt-3">{tabs.map(([label, count]) => <button key={label} onClick={() => setTab(label)} className={`shrink-0 border-b-2 px-1 pb-2.5 text-xs font-medium ${tab === label ? "border-brand text-brand" : "border-transparent text-secondary hover:text-heading"}`}>{label} <span className="ml-1 text-[10px] opacity-70">({count})</span></button>)}</div>
      <div className="grid gap-2 border-b border-line p-4 sm:grid-cols-2 lg:grid-cols-[minmax(220px,1fr)_150px_150px_130px_145px_auto]"><TextInput icon={<Search size={15} />} aria-label="Search projects" placeholder="Search by name, key, or description…" value={search} onChange={event => setSearch(event.target.value)} /><Select aria-label="Filter projects by team" value={teamFilter} onChange={event => setTeamFilter(event.target.value)}><option value="all">All teams</option>{teams.map(team => <option key={team}>{team}</option>)}</Select><Select aria-label="Filter projects by member" value={memberFilter} onChange={event => setMemberFilter(event.target.value)}><option value="all">All members</option>{data.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select><Select aria-label="Filter projects by status" value={statusFilter} onChange={event => setStatusFilter(event.target.value)}><option value="all">All status</option>{["In progress", "In review", "Complete"].map(value => <option key={value}>{value}</option>)}</Select><Select aria-label="Sort projects" value={sort} onChange={event => setSort(event.target.value)}><option value="recent">Sort: Recently added</option><option value="name">Sort: Name</option><option value="progress">Sort: Progress</option><option value="deadline">Sort: Deadline</option></Select><div className="flex items-center justify-end gap-1"><button className={`icon-button ${layout === "grid" ? "bg-brand-soft text-brand" : "text-muted"}`} aria-label="Grid view" aria-pressed={layout === "grid"} onClick={() => setLayout("grid")}><Grid2X2 size={15} /></button><button className={`icon-button ${layout === "list" ? "bg-brand-soft text-brand" : "text-muted"}`} aria-label="List view" aria-pressed={layout === "list"} onClick={() => setLayout("list")}><List size={15} /></button></div></div>
      <div className="px-4 pb-3 text-[11px] text-muted">Showing {filtered.length} of {data.projects.length} projects</div>
      {filtered.length === 0 ? <EmptyState title={`No ${tab.toLowerCase()} found`} description="Try changing your search or filters." action={(search || teamFilter !== "all" || memberFilter !== "all" || statusFilter !== "all") && <Button size="sm" variant="secondary" onClick={() => { setSearch(""); setTeamFilter("all"); setMemberFilter("all"); setStatusFilter("all"); }}>Clear filters</Button>} /> : layout === "grid" ? <div className="grid gap-3 border-t border-line p-4 md:grid-cols-2 xl:grid-cols-3">{filtered.map(project => <ProjectCard key={project.id} project={project} data={data} canEdit={canManage} onOpen={() => onOpen(project)} onEdit={() => onEdit(project.id)} />)}</div> : <div className="overflow-x-auto border-t border-line"><table className="w-full min-w-[950px] text-left"><thead className="bg-hover text-[10px] uppercase tracking-wide text-muted"><tr>{["Project", "Status", "Progress", "Deadline", "Tasks", "Teams", "Members", ""].map(item => <th key={item} className="px-4 py-3 font-medium">{item}</th>)}</tr></thead><tbody>{filtered.map(project => <ProjectListRow key={project.id} project={project} data={data} canEdit={canManage} onOpen={() => onOpen(project)} onEdit={() => onEdit(project.id)} />)}</tbody></table></div>}
    </section>
  </div>;
}

function ProjectCard({ project, data, canEdit, onOpen, onEdit }: { project: Project; data: AppData; canEdit: boolean; onOpen: () => void; onEdit: () => void }) {
  const members = data.people.filter(person => project.personIds.includes(person.id));
  const teams = [...new Set(members.map(person => teamFor(person.role)))];
  const tasks = data.tasks.filter(task => task.projectId === project.id);
  const milestone = sortMilestones(project.milestones)[0];
  const progress = projectProgress(project, data.tasks);
  const health = projectHealth(project, data.tasks);
  const statusLabel = project.status === "Complete" ? "Completed" : project.status === "In review" ? "In review" : "Active";
  return <article className="group cursor-pointer rounded-xl border border-line bg-surface p-4 transition hover:border-strong hover:shadow-sm" onClick={onOpen}><div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><FolderKanban size={17} /></span><div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold group-hover:text-brand">{project.name}</h2><p className="mt-0.5 text-[10px] font-medium text-muted">{projectKey(project.name)}</p></div><Badge tone={project.status === "Complete" ? "success" : project.status === "In review" ? "warning" : "brand"}>{statusLabel}</Badge>{canEdit && <button className="icon-button -mr-2 -mt-2" aria-label={`Edit ${project.name}`} onClick={event => { event.stopPropagation(); onEdit(); }}><MoreHorizontal size={15} /></button>}</div><p className="mt-3 line-clamp-2 min-h-9 text-xs leading-5 text-secondary">{project.description || "No description added yet."}</p><div className="mt-3"><div className="mb-1.5 flex items-center justify-between text-[10px]"><span className="text-muted">Progress</span><span className="font-semibold">{progress}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-brand" style={{ width: `${progress}%` }} /></div></div><div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-[10px] text-secondary"><span className="inline-flex items-center gap-1"><CalendarDays size={12} className="text-muted" />{formatDate(milestone?.due ?? "")}</span><span className="inline-flex items-center gap-1"><CheckCircle2 size={12} className="text-muted" />{tasks.length} tasks</span><span className="inline-flex items-center gap-1"><Users size={12} className="text-muted" />{teams.length} {teams.length === 1 ? "team" : "teams"}</span><span className={`rounded-full px-2 py-0.5 ${health === "At risk" ? "bg-danger-soft text-danger" : health === "Needs attention" ? "bg-warning-soft text-warning" : "bg-success-soft text-success"}`}>{health}</span></div><div className="mt-3 flex items-center justify-between border-t border-line pt-3"><AvatarGroup names={members.map(person => person.name)} /><span className="text-[10px] text-muted">{members.length} members</span></div></article>;
}

function ProjectListRow({ project, data, canEdit, onOpen, onEdit }: { project: Project; data: AppData; canEdit: boolean; onOpen: () => void; onEdit: () => void }) {
  const members = data.people.filter(person => project.personIds.includes(person.id));
  const teams = [...new Set(members.map(person => teamFor(person.role)))];
  const tasks = data.tasks.filter(task => task.projectId === project.id);
  const progress = projectProgress(project, data.tasks);
  return <tr onClick={onOpen} className="cursor-pointer border-b border-line last:border-0 hover:bg-hover"><td className="px-4 py-3"><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-brand-soft text-brand"><FolderKanban size={15} /></span><span><span className="block text-xs font-semibold">{project.name}</span><span className="mt-0.5 block text-[10px] text-muted">{projectKey(project.name)}</span></span></div></td><td className="px-4 py-3"><Badge tone={project.status === "Complete" ? "success" : project.status === "In review" ? "warning" : "brand"}>{project.status}</Badge></td><td className="px-4 py-3"><div className="flex w-28 items-center gap-2"><span className="h-1.5 flex-1 overflow-hidden rounded-full bg-track"><span className="block h-full rounded-full bg-brand" style={{ width: `${progress}%` }} /></span><span className="text-[10px]">{progress}%</span></div></td><td className="px-4 py-3 text-xs text-secondary">{formatDate(sortMilestones(project.milestones)[0]?.due ?? "")}</td><td className="px-4 py-3 text-xs">{tasks.length}</td><td className="px-4 py-3 text-xs">{teams.length}</td><td className="px-4 py-3"><AvatarGroup names={members.map(person => person.name)} /></td><td className="px-4 py-3">{canEdit && <button className="icon-button" aria-label={`Edit ${project.name}`} onClick={event => { event.stopPropagation(); onEdit(); }}><MoreHorizontal size={15} /></button>}</td></tr>;
}

function MetricCard({ icon, label, value, note, tone }: { icon: React.ReactNode; label: string; value: number; note: string; tone: string }) {
  const colors = { violet: "bg-brand-soft text-brand", blue: "bg-blue-50 text-blue-600", green: "bg-success-soft text-success", orange: "bg-warning-soft text-warning" } as Record<string, string>;
  return <article className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${colors[tone]}`}>
    {icon}</span><div><p className="text-[11px] text-muted">{label}</p><p className="mt-0.5 text-xl font-semibold leading-tight">{value}</p><p className="mt-1 text-[10px] text-secondary">{note}</p></div></article>;
}

function parseCsvRow(line: string) {
  const cells: string[] = []; let cell = ""; let quoted = false;
  for (let index = 0; index < line.length; index++) { const char = line[index]; if (char === '"' && line[index + 1] === '"' && quoted) { cell += '"'; index++; } else if (char === '"') quoted = !quoted; else if (char === "," && !quoted) { cells.push(cell); cell = ""; } else cell += char; }
  cells.push(cell); return cells;
}
