/**
 * Project API calls (backend projects contract).
 *
 * The workspace-scoped router returns a plain array for listings; filters are
 * optional query parameters. Identity and permissions stay server-side.
 */

import { apiGet, apiPatch, apiPost } from "./client";

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

export interface ProjectsApi {
  listProjects(accessToken: string, workspaceId: string, filters?: ProjectListFilters): Promise<ApiProject[]>;
  createProject(accessToken: string, workspaceId: string, input: { name: string; description?: string; status?: ApiProjectStatus; progress_mode?: ApiProgressMode; manual_progress?: number }): Promise<ApiProject>;
  getProject(accessToken: string, workspaceId: string, projectId: string): Promise<ApiProject>;
  renameProject(accessToken: string, workspaceId: string, projectId: string, name: string): Promise<ApiProject>;
}

function buildQuery(filters?: ProjectListFilters): string {
  const params: string[] = [];
  if (filters?.status) params.push(`status=${encodeURIComponent(filters.status)}`);
  if (filters?.q) params.push(`q=${encodeURIComponent(filters.q)}`);
  if (filters?.limit) params.push(`limit=${filters.limit}`);
  if (filters?.offset) params.push(`offset=${filters.offset}`);
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
};
