/**
 * Workspace API calls (Sprint 4 contract, doc 10).
 *
 * Responses are typed from the API contract; the backend derives identity
 * and decides roles — the client never submits either.
 */

import { apiGet, apiPost } from "./client";

export type ApiWorkspace = {
  id: string;
  name: string;
  slug: string;
  role: "Owner" | "Admin" | "Member";
  created_at: string;
  updated_at: string;
};

export type WorkspaceList = ApiWorkspace[];

export interface WorkspaceApi {
  listWorkspaces(accessToken: string): Promise<WorkspaceList>;
  createWorkspace(accessToken: string, name: string): Promise<ApiWorkspace>;
}

export const workspaceApi: WorkspaceApi = {
  // eslint-disable-next-line @typescript-eslint/require-await -- kept async for future paging
  async listWorkspaces(accessToken: string) {
    return apiGet<WorkspaceList>("/workspaces", accessToken);
  },
  async createWorkspace(accessToken: string, name: string) {
    return apiPost<ApiWorkspace>("/workspaces", { name }, accessToken);
  },
};
