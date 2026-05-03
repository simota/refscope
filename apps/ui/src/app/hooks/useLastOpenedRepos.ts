import { useCallback, useState } from "react";

/**
 * useLastOpenedRepos — tracks which repos the user has navigated to in Detail mode.
 *
 * localStorage key: refscope.fleet.last_opened.v1
 * Schema: Array<{ repoId: string; openedAt: string }>
 *   - repoId: allowlisted repo identifier (never a filesystem path)
 *   - openedAt: ISO 8601 timestamp string
 *
 * Constraints (Magi D5 O3):
 *   - Maximum 20 entries; older entries are dropped when the cap is exceeded.
 *   - Only repo id + timestamp are stored — no path, no event payload.
 *   - Broken / missing data falls back to an empty array (defensive parse).
 *   - Default fleet row order is NOT affected by this hook; it is additive-only.
 */

const STORAGE_KEY = "refscope.fleet.last_opened.v1";
const MAX_ENTRIES = 20;

export type LastOpenedEntry = {
  repoId: string;
  openedAt: string;
};

function readStored(): LastOpenedEntry[] {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const result: LastOpenedEntry[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const candidate = item as Partial<LastOpenedEntry>;
      if (
        typeof candidate.repoId !== "string" ||
        candidate.repoId.length === 0 ||
        candidate.repoId.length > 64
      ) continue;
      if (typeof candidate.openedAt !== "string" || candidate.openedAt.length === 0) continue;
      // Validate openedAt is a parseable timestamp — reject garbage values.
      if (!Number.isFinite(Date.parse(candidate.openedAt))) continue;
      result.push({ repoId: candidate.repoId, openedAt: candidate.openedAt });
      if (result.length >= MAX_ENTRIES) break;
    }
    return result;
  } catch {
    return [];
  }
}

function writeStored(entries: LastOpenedEntry[]): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded or storage disabled — in-session state still works.
  }
}

export function useLastOpenedRepos() {
  const [lastOpenedRepos, setLastOpenedRepos] = useState<LastOpenedEntry[]>(readStored);

  /**
   * Record a repo as just opened. Moves an existing entry to the front (updating
   * its timestamp) or prepends a new one. Trims to MAX_ENTRIES.
   */
  const recordLastOpened = useCallback((repoId: string) => {
    setLastOpenedRepos((prev) => {
      const filtered = prev.filter((e) => e.repoId !== repoId);
      const next = [
        { repoId, openedAt: new Date().toISOString() },
        ...filtered,
      ].slice(0, MAX_ENTRIES);
      writeStored(next);
      return next;
    });
  }, []);

  /**
   * Remove a repo from the last-opened list. Used when a repo is deleted at
   * runtime so the CommandPalette "Recently opened" section never shows a
   * stale entry for a repo that no longer exists.
   *
   * No-op if `repoId` is not present.
   */
  const evictRepo = useCallback((repoId: string) => {
    setLastOpenedRepos((prev) => {
      const next = prev.filter((e) => e.repoId !== repoId);
      if (next.length === prev.length) return prev; // nothing changed
      writeStored(next);
      return next;
    });
  }, []);

  /**
   * Return `allRepos` ordered by most recently opened first.
   * Repos that have never been opened appear at the end in their original order.
   */
  const getOrderedRepos = useCallback(
    (allRepos: string[]): string[] => {
      const openedIds = lastOpenedRepos.map((e) => e.repoId);
      const openedSet = new Set(openedIds);
      // Repos with a recorded open, sorted by recency (lastOpenedRepos is already newest-first).
      const withHistory = openedIds.filter((id) => allRepos.includes(id));
      // Repos without any recorded open, preserving original order.
      const withoutHistory = allRepos.filter((id) => !openedSet.has(id));
      return [...withHistory, ...withoutHistory];
    },
    [lastOpenedRepos],
  );

  return { lastOpenedRepos, recordLastOpened, evictRepo, getOrderedRepos };
}
