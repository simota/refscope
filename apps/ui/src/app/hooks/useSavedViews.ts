import { useCallback, useEffect, useState } from "react";
import {
  removeSavedView,
  sanitizeSavedViews,
  savedViewsStorageKey,
  upsertSavedView,
  type SavedView,
  type TimelineFilters,
} from "../lib/timelineViews";

// Saved timeline views (named filter sets), stored per repository in this
// browser's localStorage. Other tabs pick changes up through `storage`.

function readViews(repoId: string): SavedView[] {
  if (!repoId || typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(savedViewsStorageKey(repoId));
    return raw ? sanitizeSavedViews(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

function writeViews(repoId: string, views: SavedView[]): boolean {
  try {
    window.localStorage.setItem(savedViewsStorageKey(repoId), JSON.stringify(views));
    return true;
  } catch {
    // Disabled storage / quota: the view still works for this page session.
    return false;
  }
}

function makeId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function useSavedViews(repoId: string) {
  const [state, setState] = useState(() => ({ repoId, views: readViews(repoId) }));
  // Re-read synchronously on a repo switch so another repo's views never render.
  const views = state.repoId === repoId ? state.views : readViews(repoId);
  useEffect(() => {
    if (state.repoId !== repoId) setState({ repoId, views: readViews(repoId) });
  }, [repoId, state.repoId]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === savedViewsStorageKey(repoId)) setState({ repoId, views: readViews(repoId) });
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [repoId]);

  /** Returns the saved view and whether it persisted beyond this session. */
  const saveView = useCallback(
    (name: string, filters: TimelineFilters) => {
      const result = upsertSavedView(views, name, filters, new Date().toISOString(), makeId);
      if (!result.view) return { view: null, persisted: false };
      const persisted = writeViews(repoId, result.views);
      setState({ repoId, views: result.views });
      return { view: result.view, persisted };
    },
    [repoId, views],
  );

  const deleteView = useCallback(
    (id: string) => {
      const next = removeSavedView(views, id);
      writeViews(repoId, next);
      setState({ repoId, views: next });
    },
    [repoId, views],
  );

  return { views, saveView, deleteView };
}
