/**
 * Pure helpers for browsing history beyond the first timeline page, the
 * server-side date window, and shareable deep links. Kept free of runtime
 * imports so `node --test` can load this module directly.
 */

type Hashed = { hash: string };

/**
 * Append an older page to the loaded list. Offsets (`skip`) are computed at
 * request time, so commits that landed on top in the meantime shift the page
 * and can repeat rows already shown — those are dropped here.
 */
export function appendOlderPage<T extends Hashed>(current: readonly T[], page: readonly T[]): T[] {
  const seen = new Set(current.map((commit) => commit.hash));
  const fresh = page.filter((commit) => {
    if (seen.has(commit.hash)) return false;
    seen.add(commit.hash);
    return true;
  });
  return fresh.length === 0 ? [...current] : [...current, ...fresh];
}

/**
 * Merge a live refresh (which re-reads only the first page) with older pages
 * the user already loaded. When the fresh first page ends on a commit that is
 * still in the loaded list, everything after that commit is kept, so a push
 * does not throw away "Load older" progress. When there is no overlap (more
 * new commits than a page, or history was rewritten) the fresh page replaces
 * the list and `reset` is true so the caller can recompute `hasMore`.
 */
export function mergeLiveFirstPage<T extends Hashed>(
  fresh: readonly T[],
  current: readonly T[],
  pageSize: number,
): { commits: T[]; reset: boolean } {
  // A short page is the whole (filtered) history: nothing older to keep.
  if (fresh.length < pageSize || current.length <= pageSize) {
    return { commits: [...fresh], reset: true };
  }
  const last = fresh[fresh.length - 1];
  const at = current.findIndex((commit) => commit.hash === last.hash);
  if (at === -1) return { commits: [...fresh], reset: true };
  return { commits: appendOlderPage(fresh, current.slice(at + 1)), reset: false };
}

/** Whether a page of `received` rows for a `requested` limit may have more after it. */
export function pageMayHaveMore(received: number, requested: number): boolean {
  return received >= requested;
}

const LOCAL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Convert an `<input type="date">` value (local calendar day) into the UTC
 * instant the API accepts. `start` is local midnight; `end` is the last
 * millisecond of that local day, so a one-day window covers the whole day in
 * the viewer's time zone. Returns "" for empty or malformed input.
 */
export function localDateToIsoBound(value: string, edge: "start" | "end"): string {
  const match = LOCAL_DATE_PATTERN.exec(value.trim());
  if (!match) return "";
  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  const date =
    edge === "start"
      ? new Date(year, month, day, 0, 0, 0, 0)
      : new Date(year, month, day, 23, 59, 59, 999);
  if (Number.isNaN(date.getTime()) || date.getMonth() !== month) return "";
  const iso = date.toISOString();
  // The API accepts years 1900–2099 only.
  const isoYear = Number(iso.slice(0, 4));
  if (isoYear < 1900 || isoYear > 2099) return "";
  return iso;
}

/** State a deep link restores. Empty strings mean "not specified". */
export type DeepLinkState = {
  repo: string;
  ref: string;
  commit: string;
  path: string;
};

const DEEP_LINK_KEYS = { repo: "repo", ref: "ref", commit: "commit", path: "path" } as const;
const HASH_PATTERN = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const MAX_PARAM_LENGTH = 256;

function readParam(params: URLSearchParams, key: string): string {
  const value = params.get(key) ?? "";
  // Control characters (including NUL / newlines) never come from a link
  // Refscope produced; ignore the parameter instead of forwarding it.
  // eslint-disable-next-line no-control-regex
  if (value.length > MAX_PARAM_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return "";
  return value;
}

/**
 * Read `?repo=&ref=&commit=&path=` from a location search string. Values are
 * only shape-checked here (the API validates for real): a malformed commit
 * hash is dropped so the app falls back to the newest commit.
 */
export function parseDeepLink(search: string): DeepLinkState {
  const params = new URLSearchParams(search);
  const commit = readParam(params, DEEP_LINK_KEYS.commit).toLowerCase();
  return {
    repo: readParam(params, DEEP_LINK_KEYS.repo),
    ref: readParam(params, DEEP_LINK_KEYS.ref),
    commit: HASH_PATTERN.test(commit) ? commit : "",
    path: readParam(params, DEEP_LINK_KEYS.path),
  };
}

/**
 * Write the deep-link state into `search`, preserving unrelated parameters
 * (e.g. `fleet`, `flight`). Empty values remove their parameter, and `ref`
 * is omitted when it is the default `HEAD`. Returns the new search string
 * including the leading `?` (or "" when no parameters remain).
 */
export function buildDeepLinkSearch(search: string, state: DeepLinkState): string {
  const params = new URLSearchParams(search);
  const entries: Array<[string, string]> = [
    [DEEP_LINK_KEYS.repo, state.repo],
    [DEEP_LINK_KEYS.ref, state.ref === "HEAD" ? "" : state.ref],
    [DEEP_LINK_KEYS.commit, state.commit],
    [DEEP_LINK_KEYS.path, state.path],
  ];
  for (const [key, value] of entries) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}
