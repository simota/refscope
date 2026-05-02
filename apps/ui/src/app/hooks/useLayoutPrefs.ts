import { useCallback, useEffect, useRef, useState } from "react";

const STORAGE_KEY = "refscope.layoutPrefs.v1";
const SCHEMA_VERSION = 1;

// Default ratios re-tuned to give the diff pane the largest share — the commit
// list only needs to fit hash + subject + meta, while the diff viewer benefits
// from every extra column. Sums to 100.
export const DEFAULT_PANEL_SIZES: PanelSizes = {
  sidebar: 18,
  center: 32,
  detail: 50,
};

export type PanelSizes = {
  sidebar: number;
  center: number;
  detail: number;
};

type LayoutPrefs = {
  sidebarCollapsed: boolean;
  panelSizes: PanelSizes;
};

type PersistedShape = {
  v: number;
  sidebarCollapsed: boolean;
  panelSizes: PanelSizes;
};

const DEFAULT_PREFS: LayoutPrefs = {
  sidebarCollapsed: false,
  panelSizes: DEFAULT_PANEL_SIZES,
};

// Layout preferences own two pieces of state: the resizable panel ratios and the
// sidebar collapse flag. Both are persisted under one schema-versioned key so
// that future schema bumps can fall back to defaults atomically rather than
// trying to merge mismatched partial blobs.
export function useLayoutPrefs() {
  const [prefs, setPrefs] = useState<LayoutPrefs>(readStoredPrefs);
  const writeFrameRef = useRef<number | null>(null);
  const pendingWriteRef = useRef<LayoutPrefs | null>(null);

  // Coalesce drag-storm writes through rAF so localStorage isn't pounded on every
  // pointer move; the last value within a frame wins, which matches user intent.
  const schedulePersist = useCallback((next: LayoutPrefs) => {
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
          sidebarCollapsed: value.sidebarCollapsed,
          panelSizes: value.panelSizes,
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

  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => {
      setPrefs((current) => {
        if (current.sidebarCollapsed === collapsed) return current;
        const next = { ...current, sidebarCollapsed: collapsed };
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  const toggleSidebar = useCallback(() => {
    setPrefs((current) => {
      const next = { ...current, sidebarCollapsed: !current.sidebarCollapsed };
      schedulePersist(next);
      return next;
    });
  }, [schedulePersist]);

  const setPanelSizes = useCallback(
    (sizes: PanelSizes) => {
      if (!isValidPanelSizes(sizes)) return;
      setPrefs((current) => {
        if (
          current.panelSizes.sidebar === sizes.sidebar &&
          current.panelSizes.center === sizes.center &&
          current.panelSizes.detail === sizes.detail
        ) {
          return current;
        }
        const next = { ...current, panelSizes: sizes };
        schedulePersist(next);
        return next;
      });
    },
    [schedulePersist],
  );

  return {
    sidebarCollapsed: prefs.sidebarCollapsed,
    panelSizes: prefs.panelSizes,
    setSidebarCollapsed,
    toggleSidebar,
    setPanelSizes,
  };
}

function readStoredPrefs(): LayoutPrefs {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed: unknown = JSON.parse(raw);
    if (!isPersistedShape(parsed)) return DEFAULT_PREFS;
    if (parsed.v !== SCHEMA_VERSION) return DEFAULT_PREFS;
    if (typeof parsed.sidebarCollapsed !== "boolean") return DEFAULT_PREFS;
    if (!isValidPanelSizes(parsed.panelSizes)) return DEFAULT_PREFS;
    return {
      sidebarCollapsed: parsed.sidebarCollapsed,
      panelSizes: parsed.panelSizes,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

function isPersistedShape(value: unknown): value is PersistedShape {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return "v" in v && "sidebarCollapsed" in v && "panelSizes" in v;
}

function isValidPanelSizes(value: unknown): value is PanelSizes {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const { sidebar, center, detail } = v;
  if (
    typeof sidebar !== "number" ||
    typeof center !== "number" ||
    typeof detail !== "number"
  ) {
    return false;
  }
  if (!isFinite(sidebar) || !isFinite(center) || !isFinite(detail)) return false;
  if (sidebar < 5 || sidebar > 80) return false;
  if (center < 5 || center > 80) return false;
  if (detail < 5 || detail > 80) return false;
  const sum = sidebar + center + detail;
  if (sum < 99 || sum > 101) return false;
  return true;
}
