/**
 * Shared real-data project list for signed-in users.
 *
 * Mirrors useRealWorkspaces: one fetch feeds the shell (sidebar project
 * list, switcher, palette) and the Projects page so they always agree.
 * Prototype data stays fully separate; it is never mixed into these values.
 */

import { useCallback, useEffect, useState } from "react";
import { friendlyError } from "../api/client";
import { projectsApi, type ApiProject } from "../api/projects";

export type ProjectsPhase = "idle" | "loading" | "ready" | "error";

export type ProjectsState = {
  phase: ProjectsPhase;
  errorMessage: string | null;
  projects: ApiProject[];
  /** True when the list hit the fetch ceiling and may continue past it. */
  truncated: boolean;
  /** Local upsert after a successful create/update to avoid a refetch. */
  applyProject: (next: ApiProject) => void;
  removeProject: (id: string) => void;
  reload: () => void;
};

/** GET /projects hard-filters archived rows server-side. */
const FETCH_LIMIT = 100;

export function useRealProjects(
  enabled: boolean,
  workspaceId: string | null,
  getAccessToken: () => Promise<string | null>,
): ProjectsState {
  const [phase, setPhase] = useState<ProjectsPhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [projects, setProjects] = useState<ApiProject[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken(token => token + 1), []);

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setPhase("idle");
      return;
    }
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));
    void (async () => {
      const token = await getAccessToken();
      if (!token || disposed) return;
      try {
        // The endpoint never returns archived projects; limit 100 covers the
        // workspace until real paging becomes worth the shell's complexity.
        const rows = await projectsApi.listProjects(token, workspaceId, { limit: FETCH_LIMIT });
        if (disposed) return;
        setProjects(rows);
        setTruncated(rows.length >= FETCH_LIMIT);
        setErrorMessage(null);
        setPhase("ready");
      } catch (error) {
        if (disposed) return;
        const friendly = friendlyError(error, "Could not load projects");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();
    return () => { disposed = true; };
  }, [enabled, workspaceId, getAccessToken, reloadToken]);

  const applyProject = useCallback((next: ApiProject) => {
    setProjects(previous => previous.some(item => item.id === next.id)
      ? previous.map(item => (item.id === next.id ? next : item))
      : [next, ...previous]);
  }, []);

  const removeProject = useCallback((id: string) => {
    setProjects(previous => previous.filter(item => item.id !== id));
  }, []);

  return { phase, errorMessage, projects, truncated, applyProject, removeProject, reload };
}
