/**
 * Self-service profile calls (doc 09): GET/PATCH /auth/me.
 *
 * Mutations accept only the user-editable fields; the backend derives the
 * subject from the verified JWT and rejects email/role changes.
 */

import { apiGet, apiPatch } from "./client";

export type ApiProfile = {
  user_id: string;
  email: string | null;
  display_name: string;
  job_title: string | null;
};

export type ApiProfileUpdate = {
  display_name?: string;
  job_title?: string | null;
};

export interface ProfileApi {
  getProfile(accessToken: string): Promise<ApiProfile>;
  updateProfile(accessToken: string, input: ApiProfileUpdate): Promise<ApiProfile>;
}

export const profileApi: ProfileApi = {
  async getProfile(accessToken) {
    return apiGet<ApiProfile>("/auth/me", accessToken);
  },
  async updateProfile(accessToken, input) {
    return apiPatch<ApiProfile>("/auth/me", input, accessToken);
  },
};
