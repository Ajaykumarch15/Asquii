/**
 * Workspace API calls (Sprint 4 contract, doc 10).
 *
 * Responses are typed from the API contract; the backend derives identity
 * and decides roles — the client never submits either.
 */

import { apiDelete, apiGet, apiPost, apiPatch } from "./client";

export type ApiWorkspace = {
  id: string;
  name: string;
  slug: string;
  role: "Owner" | "Admin" | "Member";
  created_at: string;
  updated_at: string;
};

export type WorkspaceList = ApiWorkspace[];

export type ApiWorkspaceMember = {
  user_id: string;
  display_name: string;
  job_title: string | null;
  role: string;
  created_at: string;
};

export type ApiInvitation = {
  id: string;
  workspace_id: string;
  email: string;
  role: string;
  invited_by_user_id: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  status: "pending" | "expired" | "accepted" | "revoked";
};

export interface WorkspaceApi {
  listWorkspaces(accessToken: string): Promise<WorkspaceList>;
  createWorkspace(accessToken: string, name: string): Promise<ApiWorkspace>;
  renameWorkspace(accessToken: string, workspaceId: string, name: string): Promise<ApiWorkspace>;
  listMembers(accessToken: string, workspaceId: string): Promise<ApiWorkspaceMember[]>;
  listInvitations(accessToken: string, workspaceId: string): Promise<ApiInvitation[]>;
  createInvitation(accessToken: string, workspaceId: string, input: { email: string; role: "Admin" | "Member" }): Promise<ApiInvitation & { token: string }>;
  revokeInvitation(accessToken: string, workspaceId: string, invitationId: string): Promise<void>;
  acceptInvitation(accessToken: string, token: string): Promise<{ workspace_id: string; role: string }>;
}

export const workspaceApi: WorkspaceApi = {
  // eslint-disable-next-line @typescript-eslint/require-await -- kept async for future paging
  async listWorkspaces(accessToken: string) {
    return apiGet<WorkspaceList>("/workspaces", accessToken);
  },
  async createWorkspace(accessToken: string, name: string) {
    return apiPost<ApiWorkspace>("/workspaces", { name }, accessToken);
  },
  async renameWorkspace(accessToken: string, workspaceId: string, name: string) {
    return apiPatch<ApiWorkspace>(`/workspaces/${workspaceId}`, { name }, accessToken);
  },
  async listMembers(accessToken: string, workspaceId: string) {
    return apiGet<ApiWorkspaceMember[]>(`/workspaces/${workspaceId}/members`, accessToken);
  },
  async listInvitations(accessToken: string, workspaceId: string) {
    return apiGet<ApiInvitation[]>(`/workspaces/${workspaceId}/invitations`, accessToken);
  },
  async createInvitation(accessToken: string, workspaceId: string, input) {
    return apiPost<ApiInvitation & { token: string }>(`/workspaces/${workspaceId}/invitations`, input, accessToken);
  },
  async revokeInvitation(accessToken: string, workspaceId: string, invitationId: string) {
    return apiDelete(`/workspaces/${workspaceId}/invitations/${invitationId}`, accessToken);
  },
  async acceptInvitation(accessToken: string, token: string) {
    return apiPost<{ workspace_id: string; role: string }>("/invitations/accept", { token }, accessToken);
  },
};
