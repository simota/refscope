import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "refscope.timeline.collapsed.v1";
const SCHEMA_VERSION = 1;

type TimelinePrefs = {
  compareBarCollapsed: boolean;
  activityGraphCollapsed: boolean;
};

type PersistedShape = {
  v: number;
  compareBarCollapsed: boolean;
  activityGraphCollapsed: boolean;
};

const DEFAULT_PREFS: TimelinePrefs = {
  compareBarCollapsed: true,
  activityGraphCollapsed: true,
};

// Persists collapse state for CompareBar and CommitActivityGraph under a
// schema-versioned key. Corrupted or mismatched data falls back to defaults.
// Write coalescing via rAF mirrors the useLayoutPrefs pattern.
export function useTimelinePrefs() {
  const [prefs, setPrefs] = useState<TimelinePrefs>(readStoredPrefs);
  const writeFrameRef = useRef<number | null>(null);
  const pendingWriteRef = useRef<TimelinePrefs | null>(null);

  const schedulePersist = useCallback((next: TimelinePrefs) => {
    pendingWriteRef.current = next;
    if (writeFrameRef.current !== null) return;
    writeFrameRef.current = window.requestAnimationFrame(() => {
      writeFrameRef.current = null;
      const value = pendingWriteRef.current;
      pendingWriteRef.current = null;
      if (!value) return;
      try {
        const payload: PersistedShape = {
          v: SCHEMA_VERSION,
          compareBarCollapsed: value.compareBarCollapsed,
          activityGraphCollapsed: value.activityGraphCollapsed,
        };
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
      } catch {
        // Storage may be unavailable (private mode, quota); in-memory state still works.
      }
    });
  }, []);

  useEffect(() => {
    return () => {
      if (writeFrameRef.current !== null) {
        window.cancelAnimationFrame(writeFrameRef.current);
      }
    };
  }, []);

  const toggleCompareBar = useCallback(() => {
    setPrefs((current) => {
      const next = { ...current, compareBarCollapsed: !current.compareBarCollapsed };
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  const toggleActivityGraph = useCallback(() => {
    setPrefs((current) => {
      const next = { ...current, activityGraphCollapsed: !current.activityGraphCollapsed };
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  return {
    compareBarCollapsed: prefs.compareBarCollapsed,
    activityGraphCollapsed: prefs.activityGraphCollapsed,
    toggleCompareBar,
    toggleActivityGraph,
  };
}

function readStoredPrefs(): TimelinePrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedShape(parsed)) return DEFAULT_PREFS;
    if (parsed.v !== SCHEMA_VERSION) return DEFAULT_PREFS;
    if (typeof parsed.compareBarCollapsed !== "boolean") return DEFAULT_PREFS;
    if (typeof parsed.activityGraphCollapsed !== "boolean") return DEFAULT_PREFS;
    return {
      compareBarCollapsed: parsed.compareBarCollapsed,
      activityGraphCollapsed: parsed.activityGraphCollapsed,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function isPersistedShape(value: unknown): value is PersistedShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return "v" in v && "compareBarCollapsed" in v && "activityGraphCollapsed" in v;
}
