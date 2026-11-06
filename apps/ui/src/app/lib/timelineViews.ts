// Timeline views: the history shape (first-parent / merges / no-merges),
// saved filter sets ("views") per repository, shareable filter links, and
// exporting the commits the timeline currently lists.
//
// Pure helpers only (no React, no DOM, no storage access) so they run under
// `node --test` with type stripping. Every import here must stay type-only.
import type { SearchMode } from "../api";
import type { Commit } from "../components/refscope/data";

// ---------------------------------------------------------------------------
// History shape
// ---------------------------------------------------------------------------

export type HistoryShape = "all" | "first-parent" | "merges" | "no-merges";

export const HISTORY_SHAPES: readonly HistoryShape[] = ["all", "first-parent", "merges", "no-merges"];

export const HISTORY_SHAPE_INFO: Record<HistoryShape, { label: string; chip: string; description: string }> = {
  all: {
    label: "All commits",
    chip: "",
    description: "Every commit reachable from the ref.",
  },
  "first-parent": {
    label: "First parent",
    chip: "first-parent",
    description: "Only the ref's own line: each merged branch appears as its merge commit.",
  },
  merges: {
    label: "Merges only",
    chip: "merges only",
    description: "Merge commits on the first-parent line — one row per merged pull request.",
  },
  "no-merges": {
    label: "No merges",
    chip: "no merges",
    description: "Every commit except merge commits.",
  },
};

export function parseHistoryShape(value: unknown): HistoryShape {
  return typeof value === "string" && (HISTORY_SHAPES as readonly string[]).includes(value)
    ? (value as HistoryShape)
    : "all";
}

// ---------------------------------------------------------------------------
// Filter sets
// ---------------------------------------------------------------------------

/** Everything that decides which commits the timeline lists. */
export type TimelineFilters = {
  /** Full ref name (`refs/heads/main`) or `HEAD`. */
  ref: string;
  searchMode: SearchMode;
  /** Subject-mode text (the API's legacy `search`). */
  search: string;
  /** Pickaxe / regex / message pattern. */
  searchPattern: string;
  author: string;
  path: string;
  /** `YYYY-MM-DD` local days, or "". */
  since: string;
  until: string;
  history: HistoryShape;
};

export const SEARCH_MODES: readonly SearchMode[] = ["subject", "pickaxe", "regex", "message"];

const SEARCH_MODE_CHIP: Record<SearchMode, string> = {
  subject: "Subject",
  pickaxe: "Pickaxe -S",
  regex: "Regex -G",
  message: "Message --grep",
};

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_TEXT_LENGTH = 256;
// eslint-disable-next-line no-control-regex
const CONTROL_PATTERN = /[\u0000-\u001f\u007f]/;

function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.length > MAX_TEXT_LENGTH || CONTROL_PATTERN.test(value)) return "";
  return value;
}

function cleanDay(value: unknown): string {
  const text = cleanText(value);
  return DAY_PATTERN.test(text) ? text : "";
}

function cleanSearchMode(value: unknown): SearchMode {
  return typeof value === "string" && (SEARCH_MODES as readonly string[]).includes(value)
    ? (value as SearchMode)
    : "subject";
}

/** Shape-check an untrusted filter object (storage, links). */
export function sanitizeFilters(raw: unknown): TimelineFilters {
  const value = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    ref: cleanText(value.ref) || "HEAD",
    searchMode: cleanSearchMode(value.searchMode),
    search: cleanText(value.search),
    searchPattern: cleanText(value.searchPattern),
    author: cleanText(value.author),
    path: cleanText(value.path),
    since: cleanDay(value.since),
    until: cleanDay(value.until),
    history: parseHistoryShape(value.history),
  };
}

/** The query text that is actually in effect for the current search mode. */
export function activeQueryText(filters: Pick<TimelineFilters, "searchMode" | "search" | "searchPattern">): string {
  return (filters.searchMode === "subject" ? filters.search : filters.searchPattern).trim();
}

/** Comparable form: only the values that change the listed commits. */
function effectiveFilters(filters: TimelineFilters) {
  return {
    ref: filters.ref,
    searchMode: activeQueryText(filters) ? filters.searchMode : "subject",
    query: activeQueryText(filters),
    author: filters.author.trim(),
    path: filters.path.trim(),
    since: filters.since,
    until: filters.until,
    history: filters.history,
  };
}

export function sameFilters(a: TimelineFilters, b: TimelineFilters): boolean {
  const left = effectiveFilters(a);
  const right = effectiveFilters(b);
  return (Object.keys(left) as Array<keyof typeof left>).every((key) => left[key] === right[key]);
}

/** Human-readable chips for the filters that narrow the list (ref excluded). */
export function describeFilters(filters: TimelineFilters): string[] {
  const query = activeQueryText(filters);
  return [
    query ? `${SEARCH_MODE_CHIP[filters.searchMode]}: "${query}"` : "",
    filters.author.trim() ? `author "${filters.author.trim()}"` : "",
    filters.path.trim() ? `path "${filters.path.trim()}"` : "",
    filters.since || filters.until ? `date ${filters.since || "…"} → ${filters.until || "…"}` : "",
    HISTORY_SHAPE_INFO[filters.history].chip,
  ].filter(Boolean);
}

/** Short ref label: `refs/heads/main` → `main`, `refs/tags/v1` → `v1`. */
export function shortRefName(ref: string): string {
  return ref.replace(/^refs\/(?:heads|tags|remotes)\//, "");
}

// ---------------------------------------------------------------------------
// Saved views
// ---------------------------------------------------------------------------

export type SavedView = {
  id: string;
  name: string;
  filters: TimelineFilters;
  /** ISO timestamp of the last save. */
  savedAt: string;
};

export const SAVED_VIEWS_MAX = 30;
export const SAVED_VIEW_NAME_MAX = 60;
const SAVED_VIEWS_STORAGE_PREFIX = "refscope.savedViews.v1:";

export function savedViewsStorageKey(repoId: string): string {
  return `${SAVED_VIEWS_STORAGE_PREFIX}${repoId}`;
}

export function normalizeViewName(name: string): string {
  return name.replace(/\s+/g, " ").trim().slice(0, SAVED_VIEW_NAME_MAX);
}

/** Parse what storage held; malformed entries are dropped, not repaired. */
export function sanitizeSavedViews(raw: unknown): SavedView[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  const views: SavedView[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const value = entry as Record<string, unknown>;
    const id = cleanText(value.id);
    const name = typeof value.name === "string" ? normalizeViewName(value.name) : "";
    if (!id || !name || CONTROL_PATTERN.test(name)) continue;
    const nameKey = name.toLowerCase();
    if (seenIds.has(id) || seenNames.has(nameKey)) continue;
    seenIds.add(id);
    seenNames.add(nameKey);
    views.push({
      id,
      name,
      filters: sanitizeFilters(value.filters),
      savedAt: cleanText(value.savedAt),
    });
    if (views.length >= SAVED_VIEWS_MAX) break;
  }
  return views;
}

/**
 * Save `filters` under `name`. A view with the same name (case-insensitive)
 * is overwritten in place; a new one goes first. The list is capped at
 * `SAVED_VIEWS_MAX` by dropping the oldest entries.
 */
export function upsertSavedView(
  views: SavedView[],
  name: string,
  filters: TimelineFilters,
  savedAt: string,
  makeId: () => string,
): { views: SavedView[]; view: SavedView | null } {
  const normalized = normalizeViewName(name);
  if (!normalized || CONTROL_PATTERN.test(normalized)) return { views, view: null };
  const clean = sanitizeFilters(filters);
  const existing = views.find((view) => view.name.toLowerCase() === normalized.toLowerCase());
  if (existing) {
    const view = { ...existing, name: normalized, filters: clean, savedAt };
    return { views: views.map((item) => (item.id === existing.id ? view : item)), view };
  }
  const view = { id: makeId(), name: normalized, filters: clean, savedAt };
  return { views: [view, ...views].slice(0, SAVED_VIEWS_MAX), view };
}

export function removeSavedView(views: SavedView[], id: string): SavedView[] {
  return views.filter((view) => view.id !== id);
}

/** The saved view whose filters match the current ones, if any. */
export function findMatchingView(views: SavedView[], filters: TimelineFilters): SavedView | null {
  return views.find((view) => sameFilters(view.filters, filters)) ?? null;
}

// ---------------------------------------------------------------------------
// Shareable filter links
// ---------------------------------------------------------------------------

const LINK_KEYS = {
  query: "q",
  mode: "mode",
  author: "author",
  since: "since",
  until: "until",
  history: "history",
} as const;

export type FilterLinkState = Pick<
  TimelineFilters,
  "searchMode" | "search" | "searchPattern" | "author" | "since" | "until" | "history"
>;

/** Read the timeline filters a link carries (ref / path live in the deep link). */
export function parseFilterLink(search: string): FilterLinkState {
  const params = new URLSearchParams(search);
  const searchMode = cleanSearchMode(params.get(LINK_KEYS.mode));
  const query = cleanText(params.get(LINK_KEYS.query));
  return {
    searchMode,
    search: searchMode === "subject" ? query : "",
    searchPattern: searchMode === "subject" ? "" : query,
    author: cleanText(params.get(LINK_KEYS.author)),
    since: cleanDay(params.get(LINK_KEYS.since)),
    until: cleanDay(params.get(LINK_KEYS.until)),
    history: parseHistoryShape(params.get(LINK_KEYS.history)),
  };
}

/**
 * Write the filters into `search`, preserving unrelated parameters. Defaults
 * (subject mode, empty values, `all`) remove their parameter. With
 * `includeAuthor: false` (Redact mode) the author never reaches the URL bar.
 */
export function buildFilterLinkSearch(
  search: string,
  state: FilterLinkState,
  options: { includeAuthor: boolean },
): string {
  const params = new URLSearchParams(search);
  const query = activeQueryText(state);
  const entries: Array<[string, string]> = [
    [LINK_KEYS.query, query],
    [LINK_KEYS.mode, query && state.searchMode !== "subject" ? state.searchMode : ""],
    [LINK_KEYS.author, options.includeAuthor ? state.author.trim() : ""],
    [LINK_KEYS.since, state.since],
    [LINK_KEYS.until, state.until],
    [LINK_KEYS.history, state.history === "all" ? "" : state.history],
  ];
  for (const [key, value] of entries) {
    if (value) params.set(key, value);
    else params.delete(key);
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

export type TimelineExportContext = {
  repo: string;
  filters: TimelineFilters;
  /** ISO timestamp. */
  generatedAt: string;
  /** Whether older commits exist past the loaded rows. */
  hasMore: boolean;
  /** Client-side narrowing on top of the filters (kind filter, brushed range). */
  extraFilters?: string[];
};

function commitDay(commit: Commit): string {
  return commit.authorDate ? commit.authorDate.slice(0, 10) : "";
}

function shortHash(commit: Commit): string {
  return commit.shortHash || commit.hash.slice(0, 7);
}

/** Keep Markdown inline text on one line and stop it opening code spans or links. */
function markdownInline(text: string): string {
  return text.replace(/\s+/g, " ").replace(/([\\`*_[\]<>|])/g, "\\$1").trim();
}

export function timelineToMarkdown(commits: Commit[], context: TimelineExportContext): string {
  const { filters } = context;
  const chips = [...describeFilters(filters), ...(context.extraFilters ?? [])];
  const lines = [
    `# ${markdownInline(context.repo)} — ${markdownInline(shortRefName(filters.ref))} history`,
    "",
    `- Ref: \`${filters.ref.replace(/`/g, "")}\``,
    `- Filters: ${chips.length ? chips.map(markdownInline).join(", ") : "none"}`,
    `- Commits: ${commits.length}${context.hasMore ? " (more exist past the loaded rows)" : ""}`,
    `- Generated: ${context.generatedAt}`,
    "",
  ];
  if (commits.length === 0) {
    lines.push("_No commits match these filters._", "");
    return lines.join("\n");
  }
  const authors = new Set(commits.map((commit) => commit.author));
  const added = commits.reduce((sum, commit) => sum + (commit.added || 0), 0);
  const deleted = commits.reduce((sum, commit) => sum + (commit.deleted || 0), 0);
  const merges = commits.filter((commit) => commit.isMerge).length;
  lines.push(
    `${commits.length} commit${commits.length === 1 ? "" : "s"} by ${authors.size} author${authors.size === 1 ? "" : "s"}, +${added} −${deleted}${merges ? `, ${merges} merge${merges === 1 ? "" : "s"}` : ""}.`,
    "",
  );
  for (const commit of commits) {
    const day = commitDay(commit);
    const meta = [markdownInline(commit.author), day, `+${commit.added || 0} −${commit.deleted || 0}`]
      .filter(Boolean)
      .join(", ");
    lines.push(`- \`${shortHash(commit)}\` ${markdownInline(commit.subject) || "(no subject)"} — ${meta}`);
  }
  lines.push("");
  return lines.join("\n");
}

const CSV_HEADER = ["hash", "date", "author", "subject", "added", "deleted", "files", "merge", "refs"];

/**
 * Quote a CSV cell (RFC 4180). Cells that a spreadsheet would evaluate as a
 * formula (`=`, `+`, `-`, `@`, tab, CR) are prefixed with `'` so an exported
 * commit subject cannot run in Excel / Sheets.
 */
export function csvCell(value: string | number | boolean): string {
  let text = String(value);
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function timelineToCsv(commits: Commit[]): string {
  const rows = [CSV_HEADER.join(",")];
  for (const commit of commits) {
    rows.push(
      [
        commit.hash,
        commit.authorDate ?? "",
        commit.author,
        commit.subject,
        commit.added || 0,
        commit.deleted || 0,
        commit.fileCount ?? commit.files.length,
        Boolean(commit.isMerge),
        (commit.refs ?? []).join(" "),
      ]
        .map(csvCell)
        .join(","),
    );
  }
  return `${rows.join("\r\n")}\r\n`;
}

/** File name stem for downloads: `refscope-<repo>-<ref>-<yyyy-mm-dd>`. */
export function exportFileStem(repo: string, ref: string, generatedAt: string): string {
  const slug = (text: string) =>
    text
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "x";
  return `refscope-${slug(repo)}-${slug(shortRefName(ref))}-${generatedAt.slice(0, 10)}`;
}
