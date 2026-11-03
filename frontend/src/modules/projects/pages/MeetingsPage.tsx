import { useEffect, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowDown, ArrowRight, ArrowUp, ArrowUpRight, CalendarDays, CalendarClock, Check, CheckCircle2, ChevronLeft, ChevronRight, CircleDot, Clock3, Crown, Download, ExternalLink, FileImage, FileSpreadsheet, FileText, Filter, Flag, Folder, FolderPlus, Grab, LayoutGrid, Link2, List, ListChecks, ListTodo, Mail, MoreHorizontal, Pencil, Play, Plus, RotateCcw, Search, Star, Trash2, Upload, Users, Video } from "lucide-react";
import { Avatar, AvatarGroup, Badge, Button, EmptyState, Select, Tabs, TextInput } from "../../../components/ui";
import { isOverdueTask, isPastMeeting, isRecentlyUpdated, projectProgress, resourceCategories, resourceTypes, sortMeetingsByDate, sortMilestones, type AppData, type Meeting, type Priority, type Project, type Resource, type Task, type TaskStatus } from "../../../model";

const taskStatuses: TaskStatus[] = ["Backlog", "To do", "In progress", "Dev completed", "In review", "Complete"];
const colors = ["violet", "blue", "green", "orange"] as const;

import { EmptyBoard, Kpi, KanbanCard, TaskListRow, TaskStat, dueThisWeek, formatDate, formatDateLong, relativeDate, startOfToday } from "../components/ProjectPageComponents";
export function MeetingsPage({ project, data, personaId, canManage, onCreate, onEdit, onDelete }: { project?: Project; data: AppData; personaId: string; canManage: boolean; onCreate: () => void; onEdit: (meetingId: string) => void; onDelete: (meetingId: string) => void }) {
  const [tab, setTab] = useState("calendar");
  const [monthOffset, setMonthOffset] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const projectMeetings = data.meetings.filter(meeting => meeting.projectId === project?.id);
  const meetingsById = new Map(projectMeetings.map(meeting => [meeting.id, meeting]));
  const upcoming = sortMeetingsByDate(projectMeetings.filter(meeting => !isPastMeeting(meeting)));
  const past = sortMeetingsByDate(projectMeetings.filter(meeting => isPastMeeting(meeting)), -1);
  const mine = sortMeetingsByDate(projectMeetings.filter(meeting => meeting.attendees.includes(personaId)));
  const meetingsByDate = new Map<string, Meeting[]>();
  for (const meeting of projectMeetings) meetingsByDate.set(meeting.date, [...(meetingsByDate.get(meeting.date) ?? []), meeting]);
  const dayMonth = (value: string) => { const parsed = new Date(`${value}T00:00:00`); if (Number.isNaN(parsed.getTime())) return { day: value || "\u2013", month: "DATE", label: value || "Unknown date" }; return { day: String(parsed.getDate()).padStart(2, "0"), month: parsed.toLocaleDateString("en", { month: "short" }).toUpperCase(), label: parsed.toLocaleDateString("en", { weekday: "short", month: "short", day: "numeric" }) }; };
  const attendeeName = (id: string) => data.people.find(person => person.id === id)?.name ?? "Guest";
  const tabs = ["Calendar", `Upcoming (${upcoming.length})`, `History (${past.length})`, `My meetings (${mine.length})`];
  const tabKey = (label: string) => label.startsWith("Calendar") ? "calendar" : label.startsWith("Upcoming") ? "upcoming" : label.startsWith("History") ? "history" : "mine";
  const activeTab = tabs.find(label => tabKey(label) === tab) ?? tabs[0];
  const exportCsv = () => {
    const projectName = project?.name ?? "project";
    const lines = [["Meeting", "Date", "Time", "Duration (min)", "Type", "Participants"], ...projectMeetings.map(meeting => [meeting.title, meeting.date, meeting.time, String(meeting.duration), meeting.type, meeting.attendees.map(attendeeName).join("; ")])];
    const csv = lines.map(line => line.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8;" }));
    link.download = `${projectName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}-meetings.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  };
  const anchor = new Date();
  anchor.setDate(1);
  anchor.setMonth(anchor.getMonth() + monthOffset);
  const monthLabel = anchor.toLocaleDateString("en", { month: "long", year: "numeric" });
  const firstWeekday = anchor.getDay();
  const daysInMonth = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0).getDate();
  const prevDays = new Date(anchor.getFullYear(), anchor.getMonth(), 0).getDate();
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let index = firstWeekday - 1; index >= 0; index--) cells.push({ date: new Date(anchor.getFullYear(), anchor.getMonth() - 1, prevDays - index), inMonth: false });
  for (let day = 1; day <= daysInMonth; day++) cells.push({ date: new Date(anchor.getFullYear(), anchor.getMonth(), day), inMonth: true });
  let nextDay = 1;
  while (cells.length % 7 !== 0) cells.push({ date: new Date(anchor.getFullYear(), anchor.getMonth() + 1, nextDay++), inMonth: false });
  const isoKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const todayKey = isoKey(startOfToday());
  const chipStyle = (index: number) => ["bg-brand-soft text-brand-pressed", "bg-warning-soft text-warning", "bg-success-soft text-success"][index % 3];
  const chipBorder = (index: number) => ["border-l-brand", "border-l-warning", "border-l-success"][index % 3];
  const meetingRow = (meeting: Meeting, index: number) => {
    const stamp = dayMonth(meeting.date);
    return <div key={meeting.id} className={`border-b border-l-2 border-line py-3 pl-3 pr-1 last:border-b-0 ${chipBorder(index)}`}>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-hover text-center"><span className="block text-[8px] font-semibold uppercase tracking-wide text-muted">{stamp.month}</span><span className="block text-xs font-bold">{stamp.day}</span></span>
      <div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{meeting.title}</p><p className="mt-0.5 flex items-center gap-1 truncate text-[11px] text-muted"><Clock3 size={11} />{meeting.time} · {meeting.duration} min</p></div>
      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted"><Users size={12} />{meeting.attendees.length}</span>
      <div className="flex shrink-0 items-center">{rowActions(meeting)}</div>
    </div>;
  };
  const recentRow = (meeting: Meeting) => <div key={meeting.id} className="flex items-center gap-3 border-b border-line py-2.5 last:border-b-0"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-success-soft text-success"><Check size={14} /></span><div className="min-w-0 flex-1"><p className="text-[10px] text-muted">{formatDate(meeting.date)}</p><p className="truncate text-xs font-semibold">{meeting.title}</p><p className="text-[10px] text-muted">{meeting.duration} min · {meeting.attendees.length} participants</p></div><button className="icon-button shrink-0 text-muted hover:text-heading" aria-label={`Edit ${meeting.title}`} onClick={() => onEdit(meeting.id)}><MoreHorizontal size={15} /></button></div>;
  const rowActions = (meeting: Meeting) => <>{confirmDelete === meeting.id ? <><span className="text-[11px] font-medium text-danger">Delete?</span><Button size="sm" variant="danger" onClick={() => { onDelete(meeting.id); setConfirmDelete(null); }}>Yes</Button><button className="text-[11px] text-muted hover:text-heading" onClick={() => setConfirmDelete(null)}>No</button></> : <>{canManage && <button className="icon-button text-muted hover:text-danger" aria-label={`Delete ${meeting.title}`} onClick={() => setConfirmDelete(meeting.id)}><Trash2 size={14} /></button>}{canManage && <button className="icon-button text-muted hover:text-heading" aria-label={`Edit ${meeting.title}`} onClick={() => onEdit(meeting.id)}><Pencil size={14} /></button>}</>}</>;
  return <div className="space-y-5">
    <div className="mb-1 flex flex-wrap items-center justify-between gap-3"><div className="min-w-0"><h1 className="mobile-page-title text-2xl font-semibold tracking-tight">Meetings</h1><p className="mt-1.5 text-sm text-muted">Plan, run and track project meetings, agendas, notes and action items.</p></div><div className="flex flex-wrap items-center gap-2"><Button variant="secondary" size="sm" icon={<Download size={14} />} onClick={exportCsv} aria-label="Export meetings as CSV">Export</Button>{canManage && <Button variant="primary" size="sm" icon={<Plus size={14} />} onClick={onCreate}>Schedule meeting</Button>}</div></div>
    <section className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="border-b border-line px-4 pt-3 sm:px-5"><Tabs items={tabs} active={activeTab} onChange={label => { setTab(tabKey(label)); setConfirmDelete(null); }} /></div>
      {tab === "calendar" ? <div className="grid gap-4 p-4 sm:px-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="overflow-hidden rounded-xl border border-line">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3"><div className="flex items-center gap-2"><button className="icon-button text-secondary hover:text-heading" aria-label="Previous month" onClick={() => setMonthOffset(offset => offset - 1)}><ChevronLeft size={15} /></button><button className="icon-button text-secondary hover:text-heading" aria-label="Next month" onClick={() => setMonthOffset(offset => offset + 1)}><ChevronRight size={15} /></button><span className="text-sm font-semibold">{monthLabel}</span></div><div className="flex rounded-lg border border-line p-1">{["Month", "Week", "Day"].map(item => <button key={item} disabled={item !== "Month"} title={item !== "Month" ? "Prototype shows the month view" : undefined} className={`rounded-md px-3 py-1.5 text-[11px] font-medium ${item === "Month" ? "bg-brand-soft text-brand-pressed" : "text-muted"}`}>{item}</button>)}</div></div>
          <div className="grid grid-cols-7 border-b border-line bg-hover/60 text-center text-[10px] font-semibold uppercase tracking-wide text-muted">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => <div key={day} className="px-1 py-2">{day}</div>)}</div>
          <div className="grid grid-cols-7 gap-px bg-line">{cells.map((cell, index) => {
            const key = isoKey(cell.date);
            const dayMeetings = meetingsByDate.get(key) ?? [];
            return <div key={index} className={`min-h-[92px] bg-surface p-1.5 ${cell.inMonth ? "" : "bg-hover/40"}`}><span className={`inline-grid h-6 w-6 place-items-center rounded-full text-[11px] ${key === todayKey ? "bg-brand text-white" : cell.inMonth ? "text-secondary" : "text-muted/60"}`}>{cell.date.getDate()}</span><div className="mt-1 space-y-1">{dayMeetings.slice(0, 2).map((meeting, chipIndex) => <button key={meeting.id} onClick={() => onEdit(meeting.id)} className={`block w-full truncate rounded-md px-1.5 py-0.5 text-left text-[9px] font-medium ${chipStyle(chipIndex)}`} title={`${meeting.title} · ${meeting.time}`}>{meeting.title}</button>)}{dayMeetings.length > 2 && <span className="block px-1.5 text-[9px] text-muted">+{dayMeetings.length - 2} more</span>}</div></div>;
          })}</div>
        </div>
        <aside className="space-y-4">
          <section className="rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="flex items-center gap-2 text-xs font-semibold"><CalendarDays size={14} className="text-brand" />Upcoming Meetings ({upcoming.length})</h2><button className="text-[11px] font-medium text-brand hover:underline" onClick={() => setTab("upcoming")}>View all →</button></div>
            <div className="px-4">{upcoming.length === 0 ? <p className="py-4 text-[11px] text-muted">Nothing scheduled yet.</p> : upcoming.map((meeting, index) => meetingRow(meeting, index))}</div>
          </section>
          <section className="rounded-xl border border-line">
            <div className="flex items-center justify-between border-b border-line px-4 py-3"><h2 className="flex items-center gap-2 text-xs font-semibold"><Clock3 size={14} className="text-brand" />Recent Meetings ({past.length})</h2><button className="text-[11px] font-medium text-brand hover:underline" onClick={() => setTab("history")}>View all →</button></div>
            <div className="px-4">{past.length === 0 ? <p className="py-4 text-[11px] text-muted">No past meetings yet.</p> : past.slice(0, 4).map(recentRow)}</div>
          </section>
        </aside>
      </div>
      : <div className="p-4 sm:px-5">{(tab === "upcoming" ? upcoming : tab === "history" ? past : mine).length === 0 ? <EmptyState title={tab === "upcoming" ? "No upcoming meetings" : tab === "history" ? "No past meetings" : "No meetings include you"} description={tab === "upcoming" && canManage ? "Use Schedule meeting to plan the next session." : "Meetings for this project will appear here."} action={tab === "upcoming" && canManage ? <Button variant="secondary" size="sm" icon={<Plus size={14} />} onClick={onCreate}>Schedule meeting</Button> : undefined} /> : <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{(tab === "upcoming" ? upcoming : tab === "history" ? past : mine).map((meeting, index) => {
        const stamp = dayMonth(meeting.date);
        return <article key={meeting.id} className={`rounded-xl border border-line border-l-2 p-4 ${chipBorder(index)}`}><div className="flex items-start justify-between gap-2"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-line bg-hover text-center"><span className="block text-[8px] font-semibold uppercase tracking-wide text-muted">{stamp.month}</span><span className="block text-xs font-bold">{stamp.day}</span></span><div className="flex items-center">{rowActions(meeting)}</div></div><p className="mt-2 truncate text-xs font-semibold">{meeting.title}</p><p className="mt-0.5 text-[11px] text-muted">{stamp.label} · {meeting.time}</p><p className="mt-0.5 text-[11px] text-muted">{meeting.duration} min · {meeting.type}</p><div className="mt-3 flex flex-wrap items-center gap-1">{meeting.attendees.slice(0, 4).map(id => <Avatar key={id} name={attendeeName(id)} size="sm" color={["violet", "blue", "green", "orange"][Math.abs(data.people.findIndex(person => person.id === id)) % 4] as "violet" | "blue" | "green" | "orange"} />)}{meeting.attendees.length > 4 && <span className="rounded-full bg-hover px-2 py-1 text-[10px] text-muted">+{meeting.attendees.length - 4}</span>}{meeting.attendees.length === 0 && <span className="text-[10px] text-muted">No participants yet</span>}</div>{meeting.description && <p className="mt-2 line-clamp-2 text-[11px] text-secondary">{meeting.description}</p>}</article>;
      })}</div>}</div>}
    </section>
  </div>;
}

