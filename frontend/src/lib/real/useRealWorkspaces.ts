/**
 * Shared real-data state for signed-in users.
 *
 * Lifts workspace fetching out of individual components so the shell,
 * header, and body all see the same list. Prototype data stays fully
 * separate; it is never mixed into these values.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { friendlyError } from "../api/client";
import { workspaceApi, type ApiWorkspace } from "../api/workspace";

export type WorkspacePhase = "idle" | "loading" | "ready" | "error";

export type WorkspaceState = {
  phase: WorkspacePhase;
  errorMessage: string | null;
  workspaces: ApiWorkspace[];
  selectedId: string | null;
  selected: ApiWorkspace | null;
  select: (id: string) => void;
  reload: () => void;
  /** Local update after a successful create/rename to avoid a refetch round-trip. */
  applyWorkspace: (next: ApiWorkspace) => void;
};

const SELECTED_KEY = "asquii.real-workspace";

function readSelectedId(): string | null {
  try {
    return localStorage.getItem(SELECTED_KEY) ?? null;
  } catch {
    return null;
  }
}

export function useRealWorkspaces(enabled: boolean, getAccessToken: () => Promise<string | null>): WorkspaceState {
  const [phase, setPhase] = useState<WorkspacePhase>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [workspaces, setWorkspaces] = useState<ApiWorkspace[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);
  const loadEpoch = useRef(0);

  const select = useCallback(
    (id: string) => {
      setSelectedId(id);
      try {
        localStorage.setItem(SELECTED_KEY, id);
      } catch {
        /* selection persistence is optional */
      }
    },
    [],
  );

  const reload = useCallback(() => setReloadToken(token => token + 1), []);

  const applyWorkspace = useCallback((next: ApiWorkspace) => {
    setWorkspaces(previous => {
      const without = previous.filter(item => item.id !== next.id);
      return [...without, next];
    });
    setSelectedId(next.id);
    try {
      localStorage.setItem(SELECTED_KEY, next.id);
    } catch {
      /* selection persistence is optional */
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const epoch = ++loadEpoch.current;
    let disposed = false;
    setPhase(previous => (previous === "ready" ? previous : "loading"));

    void (async () => {
      const token = await getAccessToken();
      if (!token) return; // Signed out while in flight; stay silent.
      try {
        const list = await workspaceApi.listWorkspaces(token);
        if (disposed || epoch !== loadEpoch.current) return;
        setWorkspaces(list);
        const remembered = readSelectedId();
        const stillValid = remembered !== null && list.some(item => item.id === remembered);
        setSelectedId(previous => {
          if (previous !== null && list.some(item => item.id === previous)) return previous;
          if (stillValid) return remembered;
          return list[0]?.id ?? null;
        });
        setErrorMessage(null);
        setPhase("ready");
      } catch (error) {
        if (disposed || epoch !== loadEpoch.current) return;
        const friendly = friendlyError(error, "Could not load workspaces");
        setErrorMessage(`${friendly.title}: ${friendly.message}`);
        setPhase("error");
      }
    })();

    return () => { disposed = true; };
  }, [enabled, getAccessToken, reloadToken]);

  if (!enabled) {
    return { phase: "idle", errorMessage: null, workspaces: [], selectedId: null, selected: null, select, reload, applyWorkspace };
  }

  const selected = workspaces.find(item => item.id === selectedId) ?? null;
  return { phase, errorMessage, workspaces, selectedId, selected, select, reload, applyWorkspace };
}
