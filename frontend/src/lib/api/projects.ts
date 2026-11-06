/**
 * Project API calls (backend projects contract).
 *
 * The workspace-scoped router returns a plain array for listings; filters are
 * optional query parameters. Identity and permissions stay server-side.
 */

import { apiDelete, apiGet, apiPatch, apiPost, apiPut } from "./client";

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
  getTaskDetail(accessToken: string, workspaceId: string, projectId: string, taskId: string): Promise<ApiTaskDetail>;
  listSubtasks(accessToken: string, workspaceId: string, projectId: string, taskId: string): Promise<ApiTaskSubtask[]>;
  createSubtask(accessToken: string, workspaceId: string, projectId: string, taskId: string, input: { title: string }): Promise<ApiTaskSubtask>;
  updateSubtask(accessToken: string, workspaceId: string, projectId: string, taskId: string, subtaskId: string, patch: { title?: string; is_done?: boolean }): Promise<ApiTaskSubtask>;
  deleteSubtask(accessToken: string, workspaceId: string, projectId: string, taskId: string, subtaskId: string): Promise<void>;
  listComments(accessToken: string, workspaceId: string, projectId: string, taskId: string): Promise<ApiTaskComment[]>;
  createComment(accessToken: string, workspaceId: string, projectId: string, taskId: string, body: string): Promise<ApiTaskComment>;
  deleteComment(accessToken: string, workspaceId: string, projectId: string, taskId: string, commentId: string): Promise<void>;
  listMeetings(accessToken: string, workspaceId: string, projectId: string, filters?: { limit?: number }): Promise<ApiMeeting[]>;
  createMeeting(accessToken: string, workspaceId: string, projectId: string, input: {
    title: string;
    description?: string;
    starts_at: string;
    duration_minutes: number;
    meeting_type?: ApiMeetingType;
    agenda?: string;
    attendee_user_ids?: string[];
  }): Promise<ApiMeeting>;
  deleteMeeting(accessToken: string, workspaceId: string, projectId: string, meetingId: string): Promise<void>;
  /**
   * PATCH with any non-null subset of fields; the backend rejects an empty
   * patch (422) and nulls. Update is meeting-manager-only server-side
   * (`can_manage_settings`: Project Manager OR workspace Owner/Admin).
   */
  updateMeeting(accessToken: string, workspaceId: string, projectId: string, meetingId: string, patch: {
    title?: string;
    description?: string;
    starts_at?: string;
    duration_minutes?: number;
    meeting_type?: ApiMeetingType;
    agenda?: string;
  }): Promise<ApiMeeting>;
  listAttendees(accessToken: string, workspaceId: string, projectId: string, meetingId: string): Promise<ApiMeetingAttendee[]>;
  /** 201 with the attendee row; the backend rejects duplicates (409) and non-members (422). */
  addAttendee(accessToken: string, workspaceId: string, projectId: string, meetingId: string, userId: string): Promise<ApiMeetingAttendee>;
  /** 204; allowed for managers and for the attendee removing themselves. */
  removeAttendee(accessToken: string, workspaceId: string, projectId: string, meetingId: string, userId: string): Promise<void>;
  listResources(accessToken: string, workspaceId: string, projectId: string, filters?: { type?: ApiResourceType | ""; limit?: number }): Promise<ApiResource[]>;
  createResource(accessToken: string, workspaceId: string, projectId: string, input: {
    name: string;
    type: ApiResourceType;
    category: string;
    detail?: string;
    external_url?: string | null;
  }): Promise<ApiResource>;
  toggleResourceStar(accessToken: string, workspaceId: string, projectId: string, resourceId: string): Promise<ApiResourceStar>;
  deleteResource(accessToken: string, workspaceId: string, projectId: string, resourceId: string): Promise<void>;
}

/** GET /tasks/{task_id} detail response: adds subtask counters. */
export type ApiTaskDetail = ApiTask & {
  subtask_count: number;
  completed_subtask_count: number;
};

export type ApiTaskSubtask = {
  id: string;
  task_id: string;
  title: string;
  is_done: boolean;
  position: string;
  created_at: string;
  updated_at: string;
};

/**
 * Comments under GET/POST /tasks/{task_id}/comments. `body` becomes null and
 * `deleted_at` set once a comment is deleted (soft-delete contract).
 */
export type ApiTaskComment = {
  id: string;
  task_id: string;
  workspace_id: string;
  project_id: string;
  author_user_id: string;
  author_display_name: string;
  body: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * Meetings under GET/POST /workspaces/{wid}/projects/{pid}/meetings.
 * `starts_at`/`ends_at` are UTC ISO instants; creation requires a
 * timezone-bearing `starts_at` (the client sends an ISO instant).
 */
export type ApiMeetingType = "Team sync" | "Review" | "Planning" | "Retrospective" | "Other";
export type ApiMeeting = {
  id: string;
  workspace_id: string;
  project_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  duration_minutes: number;
  meeting_type: ApiMeetingType;
  agenda: string;
  created_at: string;
  updated_at: string;
  organizer_user_id: string | null;
  organizer_display_name: string | null;
  attendee_count: number;
};

/**
 * Meeting attendees under
 * GET/POST/DELETE /workspaces/{wid}/projects/{pid}/meetings/{mid}/attendees.
 * Adding is meeting-manager-only; removal is manager-or-self; listing is open
 * to any workspace member.
 */
export type ApiMeetingAttendee = {
  user_id: string;
  display_name: string;
  created_at: string;
};

/** Resources under GET/POST /workspaces/{wid}/projects/{pid}/resources. */
export type ApiResourceType = "Document" | "Spreadsheet" | "Design file" | "Folder" | "Link";
export type ApiResource = {
  id: string;
  workspace_id: string;
  project_id: string;
  owner_user_id: string;
  owner_display_name: string;
  name: string;
  type: ApiResourceType;
  category: string;
  detail: string;
  external_url: string | null;
  storage_object_path: string | null;
  size_bytes: number | null;
  tags: string[];
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
  is_starred: boolean;
};

export type ApiResourceStar = {
  resource_id: string;
  starred: boolean;
};

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
  async getTaskDetail(accessToken: string, workspaceId: string, projectId: string, taskId: string) {
    return apiGet<ApiTaskDetail>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}`, accessToken);
  },
  async listSubtasks(accessToken: string, workspaceId: string, projectId: string, taskId: string) {
    return apiGet<ApiTaskSubtask[]>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/subtasks`, accessToken);
  },
  async createSubtask(accessToken: string, workspaceId: string, projectId: string, taskId: string, input: { title: string }) {
    return apiPost<ApiTaskSubtask>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/subtasks`, input, accessToken);
  },
  async updateSubtask(accessToken: string, workspaceId: string, projectId: string, taskId: string, subtaskId: string, patch: { title?: string; is_done?: boolean }) {
    return apiPatch<ApiTaskSubtask>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/subtasks/${subtaskId}`, patch, accessToken);
  },
  async deleteSubtask(accessToken: string, workspaceId: string, projectId: string, taskId: string, subtaskId: string) {
    return apiDelete(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/subtasks/${subtaskId}`, accessToken);
  },
  async listComments(accessToken: string, workspaceId: string, projectId: string, taskId: string) {
    return apiGet<ApiTaskComment[]>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments`, accessToken);
  },
  async createComment(accessToken: string, workspaceId: string, projectId: string, taskId: string, body: string) {
    return apiPost<ApiTaskComment>(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments`, { body }, accessToken);
  },
  async deleteComment(accessToken: string, workspaceId: string, projectId: string, taskId: string, commentId: string) {
    return apiDelete(`/workspaces/${workspaceId}/projects/${projectId}/tasks/${taskId}/comments/${commentId}`, accessToken);
  },
  async listMeetings(accessToken: string, workspaceId: string, projectId: string, filters?: { limit?: number }) {
    const query = filters?.limit ? `?limit=${filters.limit}` : "";
    return apiGet<ApiMeeting[]>(`/workspaces/${workspaceId}/projects/${projectId}/meetings${query}`, accessToken);
  },
  async createMeeting(accessToken: string, workspaceId: string, projectId: string, input: {
    title: string;
    description?: string;
    starts_at: string;
    duration_minutes: number;
    meeting_type?: ApiMeetingType;
    agenda?: string;
    attendee_user_ids?: string[];
  }) {
    return apiPost<ApiMeeting>(`/workspaces/${workspaceId}/projects/${projectId}/meetings`, input, accessToken);
  },
  async deleteMeeting(accessToken: string, workspaceId: string, projectId: string, meetingId: string) {
    return apiDelete(`/workspaces/${workspaceId}/projects/${projectId}/meetings/${meetingId}`, accessToken);
  },
  async updateMeeting(accessToken: string, workspaceId: string, projectId: string, meetingId: string, patch) {
    return apiPatch<ApiMeeting>(`/workspaces/${workspaceId}/projects/${projectId}/meetings/${meetingId}`, patch, accessToken);
  },
  async listAttendees(accessToken: string, workspaceId: string, projectId: string, meetingId: string) {
    return apiGet<ApiMeetingAttendee[]>(`/workspaces/${workspaceId}/projects/${projectId}/meetings/${meetingId}/attendees`, accessToken);
  },
  async addAttendee(accessToken: string, workspaceId: string, projectId: string, meetingId: string, userId: string) {
    return apiPost<ApiMeetingAttendee>(
      `/workspaces/${workspaceId}/projects/${projectId}/meetings/${meetingId}/attendees`,
      { user_id: userId },
      accessToken,
    );
  },
  async removeAttendee(accessToken: string, workspaceId: string, projectId: string, meetingId: string, userId: string) {
    return apiDelete(`/workspaces/${workspaceId}/projects/${projectId}/meetings/${meetingId}/attendees/${userId}`, accessToken);
  },
  async listResources(accessToken: string, workspaceId: string, projectId: string, filters?: { type?: ApiResourceType | ""; limit?: number }) {
    const params: string[] = [];
    if (filters?.type) params.push(`type=${encodeURIComponent(filters.type)}`);
    if (filters?.limit) params.push(`limit=${filters.limit}`);
    const query = params.length > 0 ? `?${params.join("&")}` : "";
    return apiGet<ApiResource[]>(`/workspaces/${workspaceId}/projects/${projectId}/resources${query}`, accessToken);
  },
  async createResource(accessToken: string, workspaceId: string, projectId: string, input: {
    name: string;
    type: ApiResourceType;
    category: string;
    detail?: string;
    external_url?: string | null;
  }) {
    return apiPost<ApiResource>(`/workspaces/${workspaceId}/projects/${projectId}/resources`, input, accessToken);
  },
  async toggleResourceStar(accessToken: string, workspaceId: string, projectId: string, resourceId: string) {
    return apiPut<ApiResourceStar>(`/workspaces/${workspaceId}/projects/${projectId}/resources/${resourceId}/star`, accessToken);
  },
  async deleteResource(accessToken: string, workspaceId: string, projectId: string, resourceId: string) {
    return apiDelete(`/workspaces/${workspaceId}/projects/${projectId}/resources/${resourceId}`, accessToken);
  },
};
