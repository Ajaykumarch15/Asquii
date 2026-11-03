import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, CalendarDays, CalendarClock, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, Clock3, Crown, Download, ExternalLink, FileImage, FileSpreadsheet, FileText, Filter, Flag, Folder, FolderPlus, Grab, LayoutGrid, Link2, List, ListChecks, ListTodo, Mail, MoreHorizontal, Pencil, Play, Plus, RotateCcw, Search, Star, Trash2, Upload, Users, Video } from "lucide-react";
import { Avatar, AvatarGroup, Badge, Button, EmptyState, Select, Tabs, TextInput } from "../../../components/ui";
import { isOverdueTask, isPastMeeting, isRecentlyUpdated, projectProgress, resourceCategories, resourceTypes, sortMeetingsByDate, sortMilestones, type AppData, type Meeting, type Priority, type Project, type Resource, type Task, type TaskStatus } from "../../../model";

const taskStatuses: TaskStatus[] = ["Backlog", "To do", "In progress", "Dev completed", "In review", "Complete"];
const colors = ["violet", "blue", "green", "orange"] as const;

import { EmptyBoard, Kpi, KanbanCard, TaskListRow, TaskStat, dueThisWeek, formatDate, formatDateLong, relativeDate, startOfToday } from "../components/ProjectPageComponents";
export function KanbanPage({ projectId, data, onEdit, onCreate, onUpdate, onReorder, onNavigate }: { projectId: string; data: AppData; onEdit: (id: string) => void; onCreate: (status: TaskStatus) => void; onUpdate: (id: string, patch: Partial<Task>) => void; onReorder: (taskId: string, beforeTaskId: string | null) => void; onNavigate: (item: string) => void }) {
  const [search, setSearch] = useState("");
  const [owner, setOwner] = useState("all");
  const [label, setLabel] = useState("all");
  const [priority, setPriority] = useState("all");
  const [dragging, setDragging] = useState<string | null>(null);
  const [target, setTarget] = useState<{ status: TaskStatus; before: string | null } | null>(null);
  const labelPool = [...new Set(data.tasks.filter(task => task.projectId === projectId).flatMap(task => task.labels))].sort((a, b) => a.localeCompare(b));
  const projectName = data.projects.find(project => project.id === projectId)?.name ?? "";
  const projectAbbr = projectName.split(/\s+/).map(word => word.charAt(0).toUpperCase()).join("").slice(0, 2);
  const taskKey = (task: Task) => `${projectAbbr}-${100 + Math.abs([...task.id].reduce((accumulator, character) => (accumulator * 31 + character.charCodeAt(0)) % 7919, 0)) % 800}`;
  const tasks = data.tasks.filter(task => task.projectId === projectId && task.title.toLowerCase().includes(search.toLowerCase()) && (owner === "all" || task.ownerId === owner) && (label === "all" || task.labels.includes(label)) && (priority === "all" || task.priority === priority));
  const ordered = (status: TaskStatus) => tasks.filter(task => task.status === status).sort((a, b) => a.order - b.order);
  const clearDrag = () => { setDragging(null); setTarget(null); };
  const dropInSection = (status: TaskStatus) => {
    const source = tasks.find(task => task.id === dragging);
    if (!dragging || !source) return clearDrag();
    if (source.status !== status) onUpdate(dragging, { status });
    if (!target || target.status !== status || target.before) onReorder(dragging, null);
    clearDrag();
  };
  const dropOnCard = (card: Task) => {
    const source = tasks.find(task => task.id === dragging);
    if (!dragging || !source) return clearDrag();
    if (source.status !== card.status) onUpdate(dragging, { status: card.status });
    onReorder(dragging, card.id);
    clearDrag();
  };
  const columnDot = (status: TaskStatus) => status === "Complete" ? "bg-success" : status === "In review" ? "bg-warning" : status === "Dev completed" ? "bg-cyan-500" : status === "In progress" ? "bg-brand" : status === "To do" ? "bg-blue-500" : "bg-gray-400";
  return <div className="space-y-5">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h1 className="mobile-page-title text-2xl font-semibold tracking-tight">Kanban</h1><p className="mt-1.5 text-sm text-muted">Visualize and manage work with a flexible, drag-and-drop board.</p></div><div className="flex flex-wrap items-center gap-2"><div className="flex rounded-lg border border-line p-1" role="group" aria-label="View mode"><button className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[11px] font-medium text-muted transition hover:text-heading" onClick={() => onNavigate("Tasks")}><List size={14} />List</button><button className="flex items-center gap-1.5 rounded-md bg-brand-soft px-3 py-1.5 text-[11px] font-medium text-brand-pressed" aria-pressed="true"><LayoutGrid size={14} />Board</button></div><Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={() => onCreate("To do")}>Add task</Button></div></div>
    <div className="flex gap-2 overflow-x-auto pb-2"><TextInput icon={<Search size={15} />} placeholder="Search tasks…" aria-label="Search board" value={search} onChange={event => setSearch(event.target.value)} /><Select aria-label="Filter board by assignee" value={owner} onChange={event => setOwner(event.target.value)}><option value="all">All assignees</option>{data.people.map(person => <option key={person.id} value={person.id}>{person.name}</option>)}</Select><Select aria-label="Filter board by label" value={label} onChange={event => setLabel(event.target.value)}><option value="all">All labels</option>{labelPool.map(value => <option key={value} value={value}>{value}</option>)}</Select><Select aria-label="Filter board by priority" value={priority} onChange={event => setPriority(event.target.value)}><option value="all">All priorities</option><option>High</option><option>Medium</option><option>Low</option></Select></div>
    {tasks.length === 0 ? <EmptyBoard onCreate={() => onCreate("Backlog")} /> : <div className="overflow-x-auto pb-2"><div className="mobile-kanban grid gap-6 grid-cols-6 min-w-[1500px]">{taskStatuses.map(status => { const columnTasks = ordered(status); return <section key={status} aria-label={`${status} column, ${columnTasks.length} tasks`} onDragOver={event => { if (!dragging) return; event.preventDefault(); setTarget({ status, before: null }); }} onDrop={event => { event.preventDefault(); dropInSection(status); }} className={`flex min-h-[460px] flex-col rounded-xl border p-4 transition ${target?.status === status && !target.before ? "border-brand bg-brand-soft/50" : "border-line bg-column/70"}`}><div className="mb-4 flex items-center justify-between px-1"><div className="flex items-center gap-2"><span className={`h-2.5 w-2.5 rounded-full ${columnDot(status)}`} /><h2 className="text-xs font-semibold">{status}</h2><span className="rounded-full bg-hover px-2 py-0.5 text-[10px] font-medium text-muted">{columnTasks.length}</span></div><span className="flex items-center gap-1"><button className="icon-button text-muted hover:text-heading" aria-label={`Add task to ${status}`} onClick={() => onCreate(status)}><Plus size={14} /></button>{dragging && <Grab size={13} className="text-muted" />}</span></div><div className="min-h-8 flex-1 space-y-3">{columnTasks.map(task => <KanbanCard key={task.id} task={task} data={data} isDragging={dragging === task.id} isInsertTarget={target?.before === task.id} onDragStart={() => setDragging(task.id)} onDragOverCard={event => { if (!dragging) return; event.preventDefault(); event.stopPropagation(); setTarget({ status, before: task.id }); }} onDropCard={event => { event.preventDefault(); event.stopPropagation(); dropOnCard(task); }} onDragEnd={clearDrag} onEdit={() => onEdit(task.id)} onUpdate={patch => onUpdate(task.id, patch)} />)}</div><Button variant="ghost" size="sm" className="mt-4 w-full justify-start" icon={<Plus size={14} />} onClick={() => onCreate(status)}>Add task</Button></section>; })}</div></div>}
  </div>;
}

