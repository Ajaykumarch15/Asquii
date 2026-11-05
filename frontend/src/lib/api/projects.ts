/**
 * Project API calls (backend projects contract).
 *
 * The workspace-scoped router returns a plain array for listings; filters are
 * optional query parameters. Identity and permissions stay server-side.
 */

import { apiDelete, apiGet, apiPatch, apiPost } from "./client";

export type ApiProjectStatus = "In progress" | "In review" | "Complete";
export type ApiProgressMode = "auto" | "manual";
export type ApiProjectRole = "Project Manager" | "Project Member";

export type ApiProject = {
  id: string;
  workspace_id: string;
  name: string;
  description: string;
  status: ApiProjectStatus;
  progress_mode: ApiProgressMode;
  manual_progress: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  current_user_role: ApiProjectRole | null;
  member_count: number;
  manager_count: number;
};

export type ProjectListFilters = {
  status?: ApiProjectStatus;
  q?: string;
  limit?: number;
  offset?: number;
};

/**
 * Tasks under `GET/POST /workspaces/{wid}/projects/{pid}/tasks`.
 * `due_date` is calendar-only (YYYY-MM-DD). `position` is a Decimal the
 * backend serializes as a string ("1.5"); the UI relies on server ordering
 * (sort defaults to position) instead of doing arithmetic on it.
 */
export type ApiTaskStatus = "Backlog" | "To do" | "In progress" | "Dev completed" | "In review" | "Complete";
export type ApiTaskPriority = "Low" | "Medium" | "High";
export type ApiTaskSortBy = "created_at" | "updated_at" | "due_date" | "title" | "status" | "priority" | "position";

export type ApiTask = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  description: string;
  labels: string[];
  status: ApiTaskStatus;
  due_date: string | null;
  assignee_user_id: string | null;
  assignee_display_name: string | null;
  priority: ApiTaskPriority;
  position: string;
  created_at: string;
  updated_at: string;
  creator_user_id: string | null;
  creator_display_name: string | null;
};

export type ApiProjectMember = {
  user_id: string;
  display_name: string;
  job_title: string | null;
  role: ApiProjectRole;
  workspace_member_active: boolean;
  created_at: string;
  updated_at: string;
};

export type ApiMilestone = {
  id: string;
  workspace_id: string;
  project_id: string;
  name: string;
  due_date: string;
  created_at: string;
  updated_at: string;
};

export type TaskListFilters = {
  status?: ApiTaskStatus;
  q?: string;
  assignee_user_id?: string;
  limit?: number;
  offset?: number;
  sort_by?: ApiTaskSortBy;
  sort_direction?: "asc" | "desc";
};

export interface ProjectsApi {
  listProjects(accessToken: string, workspaceId: string, filters?: ProjectListFilters): Promise<ApiProject[]>;
  createProject(accessToken: string, workspaceId: string, input: { name: string; description?: string; status?: ApiProjectStatus; progress_mode?: ApiProgressMode; manual_progress?: number }): Promise<ApiProject>;
  getProject(accessToken: string, workspaceId: string, projectId: string): Promise<ApiProject>;
  renameProject(accessToken: string, workspaceId: string, projectId: string, name: string): Promise<ApiProject>;
  listProjectMembers(accessToken: string, workspaceId: string, projectId: string): Promise<ApiProjectMember[]>;
  listMilestones(accessToken: string, workspaceId: string, projectId: string): Promise<ApiMilestone[]>;
  createMilestone(accessToken: string, workspaceId: string, projectId: string, input: { name: string; due_date: string }): Promise<ApiMilestone>;
  listTasks(accessToken: string, workspaceId: string, projectId: string, filters?: TaskListFilters): Promise<ApiTask[]>;
  createTask(accessToken: string, workspaceId: string, projectId: string, input: {
    title: string;
    description?: string;
    status?: ApiTaskStatus;
    priority?: ApiTaskPriority;
    due_date?: string | null;
    assignee_user_id?: string | null;
  }): Promise<ApiTask>;
  updateTask(accessToken: string, workspaceId: string, projectId: string, taskId: string, patch: {
    status?: ApiTaskStatus;
    priority?: ApiTaskPriority;
    due_date?: string | null;
    assignee_user_id?: string | null;
    title?: string;
    description?: string;
  }): Promise<ApiTask>;
  deleteTask(accessToken: string, workspaceId: string, projectId: string, taskId: string): Promise<void>;
}

function buildQuery(filters?: ProjectListFilters): string {
  const params: string[] = [];
  if (filters?.status) params.push(`status=${encodeURIComponent(filters.status)}`);
  if (filters?.q) params.push(`q=${encodeURIComponent(filters.q)}`);
  if (filters?.limit) params.push(`limit=${filters.limit}`);
  if (filters?.offset) params.push(`offset=${filters.offset}`);
  return params.length > 0 ? `?${params.join("&")}` : "";
}

function buildTaskQuery(filters?: TaskListFilters): string {
  const params: string[] = [];
  if (filters?.status) params.push(`status=${encodeURIComponent(filters.status)}`);
  if (filters?.q) params.push(`q=${encodeURIComponent(filters.q)}`);
  if (filters?.assignee_user_id) params.push(`assignee_user_id=${encodeURIComponent(filters.assignee_user_id)}`);
  if (filters?.limit) params.push(`limit=${filters.limit}`);
  if (filters?.offset) params.push(`offset=${filters.offset}`);
  if (filters?.sort_by) params.push(`sort_by=${filters.sort_by}`);
  if (filters?.sort_direction) params.push(`sort_direction=${filters.sort_direction}`);
  return params.length > 0 ? `?${params.join("&")}` : "";
}

export const projectsApi: ProjectsApi = {
  async listProjects(accessToken: string, workspaceId: string, filters?: ProjectListFilters) {
    return apiGet<ApiProject[]>(`/workspaces/${workspaceId}/projects${buildQuery(filters)}`, accessToken);
  },
  async createProject(accessToken: string, workspaceId: string, input) {
    return apiPost<ApiProject>(`/workspaces/${workspaceId}/projects`, input, accessToken);
  },
  async getProject(accessToken: string, workspaceId: string, projectId: string) {
    return apiGet<ApiProject>(`/workspaces/${workspaceId}/projects/${projectId}`, accessToken);
  },
  async renameProject(accessToken: string, workspaceId: string, projectId: string, name: string) {
    return apiPatch<ApiProject>(`/workspaces/${workspaceId}/projects/${projectId}`, { name }, accessToken);
  },
  async listProjectMembers(accessToken: string, workspaceId: string, projectId: string) {
    return apiGet<ApiProjectMember[]>(`/workspaces/${workspaceId}/projects/${projectId}/members`, accessToken);
  },
  async listMilestones(accessToken: string, workspaceId: string, projectId: string) {
    return apiGet<ApiMilestone[]>(`/workspaces/${workspaceId}/projects/${projectId}/milestones`, accessToken);
  },
  async createMilestone(accessToken: string, workspaceId: string, projectId: string, input) {
    return apiPost<ApiMilestone>(`/workspaces/${workspaceId}/projects/${projectId}/milestones`, input, accessToken);
  },
  async listTasks(accessToken: string, workspaceId: string, projectId: string, filters?: TaskListFilters) {
    return apiGet<ApiTask[]>(`/workspaces/${workspaceId}/projects/${projectId}/tasks${buildTaskQuery(filters)}`, accessToken);
  },
  async createTask(accessToken: string, workspaceId: string, projectId: string, input) {
    return apiPost<ApiTask>(`/workspaces/${workspaceId}/projects/${projectId}/tasks`, input, accessToken);
  },
  async updateTask(accessToken: string, workspaceId: string, projectId: string, taskId: string, patch) {
    return apiPatch<ApiTask>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`, patch, accessToken);
  },
  async deleteTask(accessToken: string, workspaceId: string, projectId: string, taskId: string) {
    return apiDelete(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`, accessToken);
  },
};
