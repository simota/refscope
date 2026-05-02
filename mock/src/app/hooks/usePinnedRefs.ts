import { useCallback, useEffect, useState } from "react";

// User-curated favourites for the BRANCHES / TAGS / REMOTES sections. Fully
// client-side: stored in localStorage and scoped per-repo so pins from one
// project don't leak into another. Persisted shape is schema-versioned so
// future renames or additions can be migrated atomically.

const STORAGE_KEY = "refscope.pinnedRefs.v1";
const SCHEMA_VERSION = 1;

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
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const repoPins = allPins[repoId] ?? [];
  const pinnedSet = new Set(repoPins);

  const toggle = useCallback(
    (refName: string) => {
      if (!repoId || !refName) return;
      setAllPins((current) => {
        const existing = current[repoId] ?? [];
        const next = existing.includes(refName)
          ? existing.filter((entry) => entry !== refName)
          : [...existing, refName];
        const merged = { ...current, [repoId]: next };
        writePersisted(merged);
        return merged;
      });
    },
    [repoId],
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
