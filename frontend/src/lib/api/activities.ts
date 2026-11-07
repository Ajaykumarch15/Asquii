/**
 * Activity feeds (Sprint 11e).
 *
 * The backend has no notifications table; the notification-like surface is the
 * activity log, exposed at GET /workspaces/{wid}/activities and the
 * project-scoped equivalent. Reads only — records are written server-side by
 * the mutating services.
 */

import { apiGet } from "./client";

export type ApiActivity = {
  id: string;
  workspace_id: string;
  project_id: string | null;
  actor_user_id: string | null;
  actor_display_name: string | null;
  action: string;
  resource_type: string;
  resource_id: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ApiActivityPage = {
  items: ApiActivity[];
  total: number;
  limit: number;
  offset: number;
};

export type ActivityFilters = {
  project_id?: string;
  actor_user_id?: string;
  action?: string;
  resource_type?: string;
  limit?: number;
  offset?: number;
};

/**
 * The feed contract exposes the raw `action` string. Map known actions to
 * readable copy; unknown actions fall back to a de-underscored rendering so
 * new backend actions never show as empty text.
 */
const ACTION_TEXT: Record<string, string> = {
  "workspace.created": "created the workspace",
  "workspace.updated": "updated the workspace",
  "workspace.archived": "archived the workspace",
  "workspace.member_removed": "removed a member from the workspace",
  "workspace.member_role_changed": "changed a member's workspace role",
  "workspace.ownership_transferred": "transferred workspace ownership",
  "workspace.invitation_created": "invited a new teammate",
  "workspace.invitation_accepted": "accepted a workspace invitation",
  "workspace.invitation_revoked": "revoked an invitation",
  "project.created": "created the project",
  "project.updated": "updated the project",
  "project.archived": "archived the project",
  "project.manager_transferred": "transferred project management",
  "project.member_added": "added a project member",
  "project.member_removed": "removed a project member",
  "project.member_role_changed": "changed a project member's role",
  "project.milestone_created": "added a milestone",
  "project.milestone_updated": "updated a milestone",
  "project.milestone_deleted": "removed a milestone",
  "task.created": "created a task",
  "task.updated": "updated a task",
  "task.deleted": "deleted a task",
  "task.assignee_changed": "changed a task's assignee",
  "task.subtask_created": "added a subtask",
  "task.subtask_updated": "updated a subtask",
  "task.subtask_deleted": "removed a subtask",
  "task.comment_created": "commented on a task",
  "task.comment_updated": "updated a comment",
  "task.comment_deleted": "deleted a comment",
  "resource.created": "added a resource",
  "resource.updated": "updated a resource",
  "resource.deleted": "deleted a resource",
  "meeting.created": "scheduled a meeting",
  "meeting.updated": "updated a meeting",
  "meeting.deleted": "deleted a meeting",
  "meeting.attendee_added": "added an attendee to a meeting",
  "meeting.attendee_removed": "removed an attendee from a meeting",
};

export function activityText(activity: ApiActivity): string {
  return ACTION_TEXT[activity.action] ?? `did ${activity.action.replace(/[._]/g, " ")}`;
}

export interface ActivitiesApi {
  listWorkspaceActivities(accessToken: string, workspaceId: string, filters?: ActivityFilters): Promise<ApiActivityPage>;
  /** GET /workspaces/{wid}/projects/{pid}/activities — the project-scoped feed. */
  listProjectActivities(accessToken: string, workspaceId: string, projectId: string, filters?: Omit<ActivityFilters, "project_id">): Promise<ApiActivityPage>;
}

/** Values accepted by both feeds; `project_id` exists only on the workspace feed. */
function buildQuery(filters?: ActivityFilters): string {
  const params: string[] = [];
  if (filters?.project_id) params.push(`project_id=${encodeURIComponent(filters.project_id)}`);
  if (filters?.actor_user_id) params.push(`actor_user_id=${encodeURIComponent(filters.actor_user_id)}`);
  if (filters?.action) params.push(`action=${encodeURIComponent(filters.action)}`);
  if (filters?.resource_type) params.push(`resource_type=${encodeURIComponent(filters.resource_type)}`);
  if (filters?.limit) params.push(`limit=${filters.limit}`);
  if (filters?.offset) params.push(`offset=${filters.offset}`);
  return params.length > 0 ? `?${params.join("&")}` : "";
}

export const activitiesApi: ActivitiesApi = {
  async listWorkspaceActivities(accessToken: string, workspaceId: string, filters?: ActivityFilters) {
    return apiGet<ApiActivityPage>(`/workspaces/${workspaceId}/activities${buildQuery(filters)}`, accessToken);
  },
  async listProjectActivities(accessToken: string, workspaceId: string, projectId: string, filters?: Omit<ActivityFilters, "project_id">) {
    return apiGet<ApiActivityPage>(`/workspaces/${workspaceId}/projects/${projectId}/activities${buildQuery(filters)}`, accessToken);
  },
};
