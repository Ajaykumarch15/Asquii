import { useEffect, useState } from "react";

export type ProjectStatus = "In progress" | "In review" | "Complete";
export type TaskStatus = "Backlog" | "To do" | "In progress" | "Dev completed" | "In review" | "Complete";
export type Priority = "Low" | "Medium" | "High";
export type WorkspaceRole = "Admin" | "Member";
export type ProgressMode = "auto" | "manual";
export type Milestone = { id: string; name: string; due: string };
export type MilestoneState = "At risk" | "Near" | "Upcoming";
export type ProjectHealth = "At risk" | "Needs attention" | "On track";
export type Subtask = { id: string; title: string; done: boolean };
export type TaskComment = { id: string; personId: string; text: string; at: string };
export type Meeting = { id: string; projectId: string; title: string; description: string; date: string; time: string; duration: number; type: string; agenda: string; attendees: string[] };
export type ResourceType = "Document" | "Spreadsheet" | "Design file" | "Folder" | "Link";
export type Resource = { id: string; projectId: string; name: string; type: ResourceType; category: string; ownerId: string; detail: string; link: string; updatedAt: string; size: string; tags: string[]; starred: boolean; deletedAt: string | null };
export const resourceTypes: ResourceType[] = ["Document", "Spreadsheet", "Design file", "Folder", "Link"];
export const resourceCategories = ["Documents", "Design", "Planning", "Engineering", "Research"];
export type Person = { id: string; name: string; role: string; email: string };
export type NotificationPreferences = { taskAssignments: boolean; projectUpdates: boolean; upcomingDeadlines: boolean };
export type Workspace = { id: string; name: string; url: string; visibility: "private" | "link"; notifications: NotificationPreferences };
export type Membership = { workspaceId: string; personId: string; role: WorkspaceRole };
export type Project = { id: string; workspaceId: string; name: string; description: string; status: ProjectStatus; progress: number; progressMode: ProgressMode; personIds: string[]; milestones: Milestone[] };
export type Task = { id: string; projectId: string; title: string; description: string; labels: string[]; status: TaskStatus; due: string; ownerId: string; priority: Priority; order: number; subtasks: Subtask[]; comments: TaskComment[] };
export type Invitation = { id: string; workspaceId: string; email: string; role: WorkspaceRole; status: "Pending" | "Accepted" };
export type AppData = { workspaces: Workspace[]; memberships: Membership[]; invitations: Invitation[]; projects: Project[]; tasks: Task[]; people: Person[]; meetings: Meeting[]; resources: Resource[] };

const STORAGE_KEY = "asquii.prototype.v8";
const LEGACY_KEYS = ["asquii.prototype.v7", "asquii.prototype.v6", "asquii.prototype.v5", "asquii.prototype.v4", "asquii.prototype.v3", "asquii.prototype.v2", "asquii.prototype.v1"] as const;
const DEFAULT_DATA: AppData = {
  workspaces: [{ id: "workspace-product", name: "Product & Engineering", url: "asquii.com/product-engineering", visibility: "private", notifications: { taskAssignments: true, projectUpdates: true, upcomingDeadlines: true } }],
  people: [
    { id: "ava", name: "Ava Johnson", role: "Product designer", email: "ava@asquii.com" },
    { id: "sam", name: "Sam Lee", role: "Engineering lead", email: "sam@asquii.com" },
    { id: "maya", name: "Maya Patel", role: "Product manager", email: "maya@asquii.com" },
    { id: "noah", name: "Noah Kim", role: "Frontend engineer", email: "noah@asquii.com" },
    { id: "iris", name: "Iris Chen", role: "QA engineer", email: "iris@asquii.com" }
  ],
  memberships: ["ava", "sam", "maya", "noah", "iris"].map(personId => ({ workspaceId: "workspace-product", personId, role: personId === "ava" ? "Admin" as const : "Member" as const })),
  invitations: [],
  projects: [
    { id: "focusflow", workspaceId: "workspace-product", name: "FocusFlow", description: "Productivity workspace", status: "In progress", progress: 68, progressMode: "manual", personIds: ["ava", "sam", "maya", "noah"], milestones: [{ id: "focusflow-launch", name: "Beta launch", due: "2026-11-12" }] },
    { id: "ravindra", workspaceId: "workspace-product", name: "Ravindra Public School", description: "School website platform", status: "In review", progress: 82, progressMode: "manual", personIds: ["noah", "iris"], milestones: [{ id: "ravindra-review", name: "School review", due: "2026-11-14" }] },
    { id: "zerro", workspaceId: "workspace-product", name: "Zerro Workbench", description: "Engineering reports", status: "In progress", progress: 45, progressMode: "auto", personIds: ["sam", "ava"], milestones: [] }
  ],
  tasks: [
    { id: "task-onboarding", projectId: "focusflow", title: "Map onboarding flow", description: "Design and implement a guided onboarding flow for new users to help them get started with the product quickly.", labels: ["Feature", "Onboarding"], status: "In progress", due: "2026-11-04", ownerId: "ava", priority: "High", order: 0, subtasks: [{ id: "sub-survey", title: "Summarize user survey findings", done: true }, { id: "sub-wireframes", title: "Sketch first-run wireframes", done: true }, { id: "sub-review", title: "Share flow map for review", done: false }], comments: [{ id: "comment-timer", personId: "sam", text: "Can we timebox the wireframes to sprint 1?", at: "2026-11-01T09:30:00.000Z" }] },
    { id: "task-timer", projectId: "focusflow", title: "Build focus session timer", description: "Timed deep-work sessions with progress persistence and gentle reminders.", labels: ["Feature", "UX"], status: "Dev completed", due: "2026-11-06", ownerId: "sam", priority: "Medium", order: 1, subtasks: [], comments: [] },
    { id: "task-release", projectId: "focusflow", title: "Write release notes", description: "Summarize the shipped work for the November release.", labels: ["Documentation"], status: "To do", due: "2026-11-08", ownerId: "maya", priority: "Low", order: 2, subtasks: [], comments: [] },
    { id: "task-a11y", projectId: "focusflow", title: "Review accessibility pass", description: "Audit contrast, focus order, and keyboard traps across core screens.", labels: ["Enhancement"], status: "Complete", due: "2026-10-30", ownerId: "noah", priority: "Medium", order: 3, subtasks: [], comments: [] },
    { id: "task-integration", projectId: "focusflow", title: "Third-party API integration", description: "Integrate with external payment and notification services.", labels: ["Feature", "Backend"], status: "Backlog", due: "2026-11-15", ownerId: "sam", priority: "High", order: 4, subtasks: [], comments: [] },
    { id: "task-analytics", projectId: "focusflow", title: "User analytics dashboard", description: "Build dashboard to track user engagement and key metrics.", labels: ["Feature", "Analytics"], status: "Backlog", due: "2026-11-20", ownerId: "noah", priority: "Medium", order: 5, subtasks: [], comments: [] }
  ],
  meetings: [
    { id: "meeting-sync", projectId: "focusflow", title: "Weekly product sync", description: "Standing sync for the Product & Engineering team.", date: "2026-11-03", time: "10:30 AM - 11:15 AM", duration: 45, type: "Team sync", agenda: "Review sprint progress, unblock the team, and align next steps.", attendees: ["ava", "sam", "maya", "noah"] },
    { id: "meeting-critique", projectId: "focusflow", title: "Design critique", description: "Feedback session for the latest onboarding designs.", date: "2026-11-05", time: "2:00 PM - 2:45 PM", duration: 45, type: "Review", agenda: "Review the latest onboarding flow and share design feedback.", attendees: ["ava", "maya", "noah"] },
    { id: "meeting-planning", projectId: "focusflow", title: "Sprint planning", description: "Plan the scope and goals of the next sprint.", date: "2026-11-09", time: "11:00 AM - 12:00 PM", duration: 60, type: "Planning", agenda: "Prioritize work for the next sprint and confirm ownership.", attendees: ["ava", "sam", "noah"] },
    { id: "meeting-retro", projectId: "focusflow", title: "Sprint retrospective", description: "Reflect on the last sprint before planning the next one.", date: "2026-10-27", time: "3:00 PM - 3:45 PM", duration: 45, type: "Retrospective", agenda: "What went well, what blocked us, and process tweaks for the next sprint.", attendees: ["ava", "sam", "maya", "noah", "iris"] },
    { id: "meeting-school", projectId: "ravindra", title: "School review", description: "Walkthrough of the platform for school staff.", date: "2026-11-14", time: "11:00 AM - 12:00 PM", duration: 60, type: "Review", agenda: "Walk staff and IT through the platform and collect feedback.", attendees: ["noah", "iris"] }
  ],
  resources: [
    { id: "resource-prd", projectId: "focusflow", name: "Product requirements", type: "Document", category: "Documents", ownerId: "ava", detail: "PRD – 8 pages", link: "", updatedAt: "2026-11-01", size: "1.2 MB", tags: ["Requirements", "v2"], starred: true, deletedAt: null },
    { id: "resource-sprint", projectId: "focusflow", name: "Sprint plan - November", type: "Spreadsheet", category: "Planning", ownerId: "maya", detail: "XLSX – 24 KB", link: "", updatedAt: "2026-10-31", size: "48 KB", tags: ["Planning"], starred: false, deletedAt: null },
    { id: "resource-figma", projectId: "focusflow", name: "Onboarding explorations", type: "Design file", category: "Design", ownerId: "ava", detail: "Figma – 12 frames", link: "https://figma.com/file/onboarding-explorations", updatedAt: "2026-10-29", size: "8.4 MB", tags: ["Design", "Onboarding"], starred: true, deletedAt: null },
    { id: "resource-api", projectId: "focusflow", name: "API integration notes", type: "Document", category: "Engineering", ownerId: "sam", detail: "MD – 4 KB", link: "", updatedAt: "2026-10-27", size: "12 KB", tags: ["Engineering", "API"], starred: false, deletedAt: null },
    { id: "resource-interviews", projectId: "focusflow", name: "Customer interview themes", type: "Folder", category: "Research", ownerId: "noah", detail: "6 files", link: "", updatedAt: "2026-10-24", size: "—", tags: ["Research", "Interviews"], starred: false, deletedAt: null },
    { id: "resource-brand", projectId: "ravindra", name: "School brand assets", type: "Folder", category: "Design", ownerId: "iris", detail: "12 files", link: "", updatedAt: "2026-10-26", size: "—", tags: ["Design", "Brand"], starred: false, deletedAt: null },
    { id: "resource-draft", projectId: "focusflow", name: "Launch plan draft", type: "Document", category: "Planning", ownerId: "ava", detail: "DOCX – 9 KB", link: "", updatedAt: "2026-10-12", size: "9 KB", tags: ["Planning"], starred: false, deletedAt: "2026-10-15" }
  ]
};

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

/** Fill in volatile fields that older schema versions might not have. */
function normalizeTask(task: Task): Task {
  return { ...task, description: typeof task.description === "string" ? task.description : "", labels: Array.isArray(task.labels) ? task.labels : [], order: Number.isFinite(task.order) ? task.order : 0, subtasks: Array.isArray(task.subtasks) ? task.subtasks : [], comments: Array.isArray(task.comments) ? task.comments : [] };
}
function normalizeResource(resource: Resource): Resource {
  return { ...resource, size: typeof resource.size === "string" ? resource.size : "", tags: Array.isArray(resource.tags) ? resource.tags : [], starred: resource.starred === true, deletedAt: typeof resource.deletedAt === "string" || resource.deletedAt === null ? resource.deletedAt : null };
}
function normalizeMeeting(meeting: Meeting): Meeting {
  return { ...meeting, description: typeof meeting.description === "string" ? meeting.description : "", duration: Number.isFinite(meeting.duration) && meeting.duration > 0 ? meeting.duration : 60 };
}
function normalizeProject(project: Project): Project {
  const legacyMilestone = (project as unknown as { milestone?: { name: string; due: string } | null }).milestone ?? null;
  return { ...project, progressMode: project.progressMode === "auto" ? "auto" : "manual", milestones: Array.isArray(project.milestones) ? project.milestones : legacyMilestone ? [{ id: `${project.id}-milestone`, name: legacyMilestone.name, due: legacyMilestone.due }] : [] };
}
function normalize(value: AppData): AppData {
  return { ...value, tasks: value.tasks.map(normalizeTask), projects: value.projects.map(normalizeProject), meetings: Array.isArray(value.meetings) ? value.meetings.map(normalizeMeeting) : [], resources: Array.isArray(value.resources) ? value.resources.map(normalizeResource) : [] };
}

function migrateFromV1(value: unknown): AppData | null {
  if (!value || typeof value !== "object") return null;
  const old = value as { projects?: Omit<Project, "workspaceId" | "progressMode" | "milestones">[]; tasks?: Task[]; people?: Person[]; settings?: Workspace };
  if (!Array.isArray(old.projects) || !Array.isArray(old.tasks) || !Array.isArray(old.people) || !old.settings) return null;
  const workspace: Workspace = { id: "workspace-product", name: old.settings.name, url: old.settings.url, visibility: old.settings.visibility, notifications: { taskAssignments: true, projectUpdates: true, upcomingDeadlines: true } };
  const memberships = old.people.map(person => ({ workspaceId: workspace.id, personId: person.id, role: (person.id === "ava" ? "Admin" : "Member") as WorkspaceRole }));
  const migratedProjects = old.projects.map(project => ({ ...project, workspaceId: workspace.id, personIds: [...new Set([...project.personIds, ...old.tasks!.filter(task => task.projectId === project.id).map(task => task.ownerId)])], milestone: null, progressMode: "manual" as const, milestones: [] as Milestone[] }));
  const migrated: AppData = { workspaces: [workspace], memberships, invitations: [], people: old.people, projects: migratedProjects, tasks: old.tasks, meetings: [], resources: [] };
  return migrated;
}

function isValidData(value: unknown): value is AppData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<AppData>;
  if (![data.workspaces, data.memberships, data.invitations, data.projects, data.tasks, data.people].every(Array.isArray)) return false;
  const workspaces = data.workspaces as Workspace[];
  const people = data.people as Person[];
  const projects = data.projects as Project[];
  const memberships = data.memberships as Membership[];
  const workspaceIds = new Set(workspaces.map(item => item.id));
  const personIds = new Set(people.map(item => item.id));
  const projectIds = new Set(projects.map(item => item.id));
  const memberKey = (workspaceId: string, personId: string) => `${workspaceId}:${personId}`;
  const membershipKeys = new Set(memberships.map(item => memberKey(item.workspaceId, item.personId)));
  return workspaces.every(item => typeof item.id === "string" && typeof item.name === "string" && typeof item.url === "string" && (item.visibility === "private" || item.visibility === "link") && !!item.notifications && typeof item.notifications.taskAssignments === "boolean" && typeof item.notifications.projectUpdates === "boolean" && typeof item.notifications.upcomingDeadlines === "boolean")
    && people.every(item => typeof item.id === "string" && typeof item.name === "string" && typeof item.role === "string" && typeof item.email === "string")
    && memberships.every(item => workspaceIds.has(item.workspaceId) && personIds.has(item.personId) && (item.role === "Admin" || item.role === "Member"))
    && projects.every(item => workspaceIds.has(item.workspaceId) && typeof item.id === "string" && typeof item.name === "string" && typeof item.description === "string" && typeof item.progress === "number" && item.progress >= 0 && item.progress <= 100 && (item.progressMode === "auto" || item.progressMode === "manual") && (item.status === "In progress" || item.status === "In review" || item.status === "Complete") && Array.isArray(item.personIds) && item.personIds.every(id => personIds.has(id) && membershipKeys.has(memberKey(item.workspaceId, id))) && Array.isArray(item.milestones) && item.milestones.every(milestone => typeof milestone.id === "string" && typeof milestone.name === "string" && typeof milestone.due === "string"))
    && (data.tasks as Task[]).every(item => projectIds.has(item.projectId) && typeof item.title === "string" && (item.status === "Backlog" || item.status === "To do" || item.status === "In progress" || item.status === "Dev completed" || item.status === "In review" || item.status === "Complete") && typeof item.due === "string" && personIds.has(item.ownerId) && (item.priority === "Low" || item.priority === "Medium" || item.priority === "High") && typeof item.order === "number" && Array.isArray(item.subtasks) && item.subtasks.every(sub => typeof sub.id === "string" && typeof sub.title === "string" && typeof sub.done === "boolean") && Array.isArray(item.comments) && item.comments.every(comment => typeof comment.id === "string" && typeof comment.personId === "string" && typeof comment.text === "string" && typeof comment.at === "string") && typeof item.description === "string" && Array.isArray(item.labels))
    && (data.invitations as Invitation[]).every(item => workspaceIds.has(item.workspaceId) && typeof item.email === "string" && (item.role === "Admin" || item.role === "Member") && (item.status === "Pending" || item.status === "Accepted"))
    && (data.meetings as Meeting[]).every(item => projectIds.has(item.projectId) && typeof item.id === "string" && typeof item.title === "string" && typeof item.date === "string" && typeof item.time === "string" && typeof item.type === "string" && typeof item.agenda === "string" && Array.isArray(item.attendees) && item.attendees.every(id => personIds.has(id)) && typeof item.description === "string" && typeof item.duration === "number")
    && (data.resources as Resource[]).every(item => projectIds.has(item.projectId) && typeof item.id === "string" && typeof item.name === "string" && resourceTypes.includes(item.type) && typeof item.category === "string" && personIds.has(item.ownerId) && typeof item.detail === "string" && typeof item.link === "string" && typeof item.updatedAt === "string" && typeof item.size === "string" && Array.isArray(item.tags) && typeof item.starred === "boolean" && (item.deletedAt === null || typeof item.deletedAt === "string"));
}

function readData(): { data: AppData; error: string | null } {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed: unknown = JSON.parse(saved);
      return isValidData(parsed) ? { data: parsed, error: null } : { data: clone(DEFAULT_DATA), error: "Saved workspace data was invalid. Sample data has been restored." };
    }
    for (const legacyKey of LEGACY_KEYS) {
      const legacy = localStorage.getItem(legacyKey);
      if (!legacy) continue;
      const isV1 = legacyKey.endsWith("v1");
      const parsed: unknown = JSON.parse(legacy);
      const normalized = normalize((isV1 ? migrateFromV1(parsed) : parsed) as AppData);
      if (normalized && isValidData(normalized)) return { data: normalized, error: null };
      return { data: clone(DEFAULT_DATA), error: "Saved workspace data could not be upgraded. Sample data has been restored." };
    }
  } catch {
    return { data: clone(DEFAULT_DATA), error: "Saved workspace data could not be read. Sample data has been restored." };
  }
  return { data: clone(DEFAULT_DATA), error: null };
}

export function useAppData() {
  const [initial] = useState(readData);
  const [data, setData] = useState<AppData>(initial.data);
  const [storageError, setStorageError] = useState<string | null>(initial.error);
  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
    catch { setStorageError("Browser storage is unavailable. Changes will be lost when you close this tab."); }
  }, [data]);
  return { data, setData, storageError, clearStorageError: () => setStorageError(null) } as const;
}

export function createId(prefix: string) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
}

/** Single source of truth for "this open task is past its due date". */
export function isOverdueTask(task: Pick<Task, "status" | "due">, now: Date = new Date()) {
  if (task.status === "Complete" || !task.due) return false;
  const date = new Date(`${task.due}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return date < today;
}

/** Manual mode shows the stored value; auto mode derives progress from completed tasks (falling back when a project has none). */
export function projectProgress(project: Pick<Project, "id" | "progress" | "progressMode">, tasks: Task[]) {
  if (project.progressMode === "manual") return project.progress;
  const scoped = tasks.filter(task => task.projectId === project.id);
  if (scoped.length === 0) return project.progress;
  return Math.round(scoped.filter(task => task.status === "Complete").length / scoped.length * 100);
}

export function projectHealth(project: Pick<Project, "id">, tasks: Task[]): ProjectHealth {
  const scoped = tasks.filter(task => task.projectId === project.id);
  if (scoped.some(task => isOverdueTask(task))) return "At risk";
  if (scoped.some(task => task.status === "In review")) return "Needs attention";
  return "On track";
}

/** Milestone state derived from how soon the due date arrives. */
export function milestoneState(due: string, now: Date = new Date()): MilestoneState {
  const date = new Date(`${due}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Upcoming";
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const inSevenDays = new Date(today); inSevenDays.setDate(inSevenDays.getDate() + 7);
  if (date < today) return "At risk";
  if (date <= inSevenDays) return "Near";
  return "Upcoming";
}

/** Milestones sorted soonest first. */
export function sortMilestones(milestones: Milestone[]) {
  return [...milestones].sort((a, b) => (a.due || "9999-99-99").localeCompare(b.due || "9999-99-99"));
}

/** Same-day meetings count as upcoming; anything older is archive material. */
export function isPastMeeting(meeting: Pick<Meeting, "date">, now: Date = new Date()) {
  const date = new Date(`${meeting.date}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  return date < today;
}

export function sortMeetingsByDate(meetings: Meeting[], direction: 1 | -1 = 1) {
  return [...meetings].sort((a, b) => ((a.date || "9999-99-99").localeCompare(b.date || "9999-99-99") || a.time.localeCompare(b.time)) * direction);
}

/** Updated within the trailing window (by default the last 7 days). */
export function isRecentlyUpdated(resource: Pick<Resource, "updatedAt">, days = 7, now: Date = new Date()) {
  const date = new Date(`${resource.updatedAt}T00:00:00`);
  if (Number.isNaN(date.getTime())) return false;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const cutoff = new Date(today); cutoff.setDate(cutoff.getDate() - days);
  return date >= cutoff;
}
