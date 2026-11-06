import { useCallback, useEffect, useMemo, useState } from "react";

const EMPTY_PINS: string[] = [];

// User-curated favourites for the BRANCHES / TAGS / REMOTES sections. Fully
// client-side: stored in localStorage and scoped per-repo so pins from one
// project don't leak into another. Persisted shape is schema-versioned so
// future renames or additions can be migrated atomically.

const STORAGE_KEY = "refscope.pinnedRefs.v1";
const SCHEMA_VERSION = 1;
// Same-tab broadcast: `storage` only fires in *other* tabs, but the sidebar
// and App (watch list / since-last-visit) each hold an instance of this hook.
const CHANGE_EVENT = "refscope:pinned-refs-changed";

type PersistedShape = {
  v: typeof SCHEMA_VERSION;
  // Map repoId → list of full ref names (e.g. "refs/heads/foo").
  pinned: Record<string, string[]>;
};

function readPersisted(): Record<string, string[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const candidate = parsed as Partial<PersistedShape>;
    if (candidate.v !== SCHEMA_VERSION) return {};
    if (!candidate.pinned || typeof candidate.pinned !== "object") return {};
    const cleaned: Record<string, string[]> = {};
    for (const [repoId, refs] of Object.entries(candidate.pinned)) {
      if (typeof repoId !== "string" || !Array.isArray(refs)) continue;
      cleaned[repoId] = refs.filter(
        (ref): ref is string => typeof ref === "string" && ref.length > 0,
      );
    }
    return cleaned;
  } catch {
    return {};
  }
}

function writePersisted(value: Record<string, string[]>): void {
  if (typeof window === "undefined") return;
  try {
    const payload: PersistedShape = { v: SCHEMA_VERSION, pinned: value };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // Storage may be disabled (private mode / quota); pinning still works in
    // memory for the current session, just doesn't persist.
  }
}

/**
 * Returns the active set of pinned refs for `repoId` plus mutators. The set
 * is recomputed when the repo changes; toggling refreshes both in-memory
 * state and localStorage.
 *
 * Refs are tracked by their full name (`refs/heads/foo`) so pins survive
 * branches/tags with the same shortName across categories.
 */
export function usePinnedRefs(repoId: string) {
  const [allPins, setAllPins] = useState<Record<string, string[]>>(() =>
    readPersisted(),
  );

  // Re-read from storage when the tab regains focus — pins toggled in
  // another tab should appear here without a refresh.
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key !== STORAGE_KEY) return;
      setAllPins(readPersisted());
    };
    const onLocalChange = () => setAllPins(readPersisted());
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onLocalChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, onLocalChange);
    };
  }, []);

  const repoPins = allPins[repoId] ?? EMPTY_PINS;
  const pinnedSet = useMemo(() => new Set(repoPins), [repoPins]);

  const toggle = useCallback(
    (refName: string) => {
      if (!repoId || !refName) return;
      // Computed outside a state updater: writePersisted broadcasts to the
      // other hook instances, which must not be updated mid-render.
      const current = allPins;
      const existing = current[repoId] ?? [];
      const next = existing.includes(refName)
        ? existing.filter((entry) => entry !== refName)
        : [...existing, refName];
      const merged = { ...current, [repoId]: next };
      writePersisted(merged);
      setAllPins(merged);
    },
    [repoId, allPins],
  );

  const isPinned = useCallback(
    (refName: string) => pinnedSet.has(refName),
    [pinnedSet],
  );

  return {
    pinnedRefs: repoPins,
    pinnedSet,
    isPinned,
    toggle,
  };
}
