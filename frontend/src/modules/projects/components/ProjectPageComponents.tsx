import { CalendarDays, Check, CircleDot, Flag, Grab, ListChecks, Plus, X } from "lucide-react";
import { Avatar, Badge, Button, EmptyState, Select } from "../../../components/ui";
import { isOverdueTask, type AppData, type Task, type TaskStatus } from "../../../model";

const taskStatuses: TaskStatus[] = ["Backlog", "To do", "In progress", "Dev completed", "In review", "Complete"];

export function TaskStat({ icon, tone, label, value }: { icon: React.ReactNode; tone: "brand" | "muted" | "warning" | "success"; label: string; value: number }) {
  const chip = tone === "brand" ? "bg-brand-soft text-brand" : tone === "warning" ? "bg-warning-soft text-warning" : tone === "success" ? "bg-success-soft text-success" : "bg-hover text-secondary";
  return <article className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full ${chip}`}>{icon}</span><div className="min-w-0"><p className="text-xl font-semibold leading-none">{value}</p><p className="mt-1 text-[11px] text-muted">{label}</p></div></article>;
}
export function Kpi({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: number | string; sub: string }) {
  return <article className="flex items-center gap-3 rounded-xl border border-line bg-surface p-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand">{icon}</span><div className="min-w-0"><div className="flex items-baseline gap-2"><strong className="text-xl font-semibold">{value}</strong><span className="truncate text-[11px] text-muted">{label}</span></div><p className="mt-1 text-[10px] text-muted">{sub}</p></div></article>;
}

export function TaskListRow({ task, data, onEdit, onUpdate }: { task: Task; data: AppData; onEdit: () => void; onUpdate: (patch: Partial<Task>) => void }) {
  const owner = data.people.find(person => person.id === task.ownerId);
  const isOverdue = isOverdueTask(task);
  return <div className="flex items-center gap-3 px-4 py-3 sm:px-5"><button className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg ${task.status === "Complete" ? "bg-success-soft text-success" : isOverdue ? "bg-danger-soft text-danger" : "bg-hover text-secondary"}`} onClick={() => onUpdate({ status: task.status === "Complete" ? "To do" : "Complete" })} aria-label={`Mark ${task.title} ${task.status === "Complete" ? "incomplete" : "complete"}`}>{task.status === "Complete" ? <Check size={14} /> : <CircleDot size={14} />}</button><button className="min-w-0 flex-1 text-left" onClick={onEdit}><span className="block truncate text-xs font-medium">{task.title}</span><span className={`mt-1 block text-[10px] ${isOverdue ? "font-medium text-danger" : "text-muted"}`}>{isOverdue ? "Overdue · due " : "Due "}{formatDate(task.due)}</span></button><Badge tone={task.priority === "High" ? "danger" : task.priority === "Medium" ? "warning" : "neutral"}>{task.priority}</Badge>{owner && <Avatar name={owner.name} size="sm" />}</div>;
}

export function KanbanCard({ task, data, isDragging, isInsertTarget, onDragStart, onDragOverCard, onDropCard, onDragEnd, onEdit, onUpdate }: { task: Task; data: AppData; isDragging: boolean; isInsertTarget: boolean; onDragStart: () => void; onDragOverCard: (event: React.DragEvent) => void; onDropCard: (event: React.DragEvent) => void; onDragEnd: () => void; onEdit: () => void; onUpdate: (patch: Partial<Task>) => void }) {
  const owner = data.people.find(person => person.id === task.ownerId);
  const ownerIndex = Math.abs(data.people.findIndex(person => person.id === task.ownerId));
  const ownerColor = (["violet", "blue", "green", "orange"] as const)[ownerIndex % 4];
  const isComplete = task.status === "Complete";
  const isOverdue = isOverdueTask(task);
  return <article draggable onDragStart={event => { event.dataTransfer.effectAllowed = "move"; onDragStart(); }} onDragOver={onDragOverCard} onDrop={onDropCard} onDragEnd={onDragEnd} className={`group flex items-start gap-3 cursor-grab rounded-lg border bg-surface p-4 shadow-sm transition hover:shadow-md active:cursor-grabbing ${isComplete ? "border-success-soft" : "border-line"} ${isDragging ? "opacity-40" : ""} ${isInsertTarget ? "ring-2 ring-brand" : ""}`}>
    <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-md bg-hover text-muted transition ${isDragging ? "bg-brand-soft text-brand" : ""}`} title="Drag this card to another column" aria-label="Drag handle"><Grab size={16} /></span>
    <div className="min-w-0 flex-1">
      <div className="mb-2 flex items-start justify-between gap-2"><button className="font-mono text-[11px] font-semibold text-muted transition hover:text-brand" onClick={onEdit} title={`Open ${task.title}`}>{data.projects.find(project => project.id === task.projectId)?.name.split(/\s+/).map(word => word.charAt(0).toUpperCase()).join("").slice(0, 2)}-{100 + Math.abs([...task.id].reduce((accumulator, character) => (accumulator * 31 + character.charCodeAt(0)) % 7919, 0)) % 800}</button>{isComplete && <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-success text-white" aria-label="Done"><Check size={12} /></span>}</div>
      <button className={`block text-left text-xs font-semibold leading-5 transition hover:text-brand ${isComplete ? "line-through decoration-success/60" : ""}`} onClick={onEdit}>{task.title}</button>
      {task.labels.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{task.labels.slice(0, 2).map(label => <span key={label} className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${isComplete ? "bg-hover text-muted" : "bg-brand-soft text-brand-pressed"}`}>{label}</span>)}{task.labels.length > 2 && <span className="rounded-full bg-hover px-2 py-0.5 text-[10px] text-muted">+{task.labels.length - 2}</span>}</div>}
      {task.subtasks.length > 0 && <p className={`mt-2 inline-flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${isComplete ? "bg-hover text-muted" : "bg-brand-soft text-brand-pressed"}`}><ListChecks size={11} />{task.subtasks.filter(sub => sub.done).length}/{task.subtasks.length} subtasks</p>}
      <div className="mt-3 space-y-1.5 border-t border-line pt-3">
        <p className="flex items-center gap-1.5 text-[11px] font-medium"><span className={`inline-flex items-center gap-1.5 ${task.priority === "High" ? "text-danger" : task.priority === "Medium" ? "text-warning" : "text-muted"}`}><Flag size={12} className="fill-current opacity-90" />{task.priority}</span></p>
        <p className={`flex items-center gap-1 text-[10px] ${isOverdue ? "font-medium text-danger" : "text-muted"}`}><CalendarDays size={11} className="shrink-0" />{formatDate(task.due)}</p>
        {owner && <div className="flex items-center gap-2"><Avatar name={owner.name} size="sm" color={ownerColor} /><span className="truncate text-[11px] text-secondary">{owner.name}</span></div>}
      </div>
      <Select aria-label={`Move ${task.title} to another column`} className="mt-2.5" value={task.status} onChange={event => onUpdate({ status: event.target.value as TaskStatus })}>{taskStatuses.map(value => <option key={value}>{value}</option>)}</Select>
    </div>
  </article>;
}

export function EmptyBoard({ onCreate }: { onCreate: () => void }) { return <div className="rounded-xl border border-line bg-surface"><EmptyState title="Your board is clear" description="Create tasks and move them through each stage of your project." action={<Button variant="primary" size="sm" onClick={onCreate}><Plus size={14} /> Add first task</Button>} /></div>; }
export function dueThisWeek(value: string) { if (!value) return false; const now = new Date(); now.setHours(0, 0, 0, 0); const end = new Date(now); end.setDate(end.getDate() + 7); const date = new Date(`${value}T00:00:00`); return !Number.isNaN(date.getTime()) && date >= now && date <= end; }
export function startOfToday() { const date = new Date(); date.setHours(0, 0, 0, 0); return date; }
export function formatDate(value: string) { if (!value) return "No due date"; const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { month: "short", day: "numeric" }); }
export function formatDateLong(value: string) { const date = new Date(`${value}T12:00:00`); return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en", { weekday: "long", month: "long", day: "numeric" }); }
export function relativeDate(value: string) { const date = new Date(`${value}T00:00:00`); if (!value || Number.isNaN(date.getTime())) return value || "Unknown"; const today = new Date(); today.setHours(0, 0, 0, 0); const days = Math.round((today.getTime() - date.getTime()) / 86400000); if (days <= 0) return "Today"; if (days === 1) return "Yesterday"; if (days < 7) return `${days} days ago`; return formatDate(value); }
