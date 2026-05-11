import type {
  Commit,
  CommitDetail,
  CompareResult,
  GitRef,
  Repository,
  SignatureStatus,
} from "./components/refscope/data";

export const API_BASE_URL = import.meta.env.VITE_RTGV_API_BASE_URL ?? "http://127.0.0.1:4175";
const API_RECOVERY_COMMAND = "make dev-self";

// ---------------------------------------------------------------------------
// Repo management — POST /api/repos + DELETE /api/repos/:id
// ---------------------------------------------------------------------------

/**
 * Add a repository to the fleet at runtime.
 *
 * Returns a Result-pattern value so callers can surface inline errors without
 * throwing. HTTP 400/403/409 → `{ ok: false, error }` with the server literal.
 */
export async function postRepo(
  input: { id: string; path: string },
): Promise<{ ok: true; repository: Repository } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/repos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (res.status === 200) {
      const body = (await res.json()) as { repository: Repository };
      return { ok: true, repository: body.repository };
    }
    const errorBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    return { ok: false, error: errorBody.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Remove a runtime-added repository from the fleet.
 *
 * 204 → `{ ok: true }`. HTTP 400/403/404 → `{ ok: false, error }` passthrough.
 */
export async function deleteRepo(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE_URL}/api/repos/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    if (res.status === 204) return { ok: true };
    const errorBody = await res.json().catch(() => ({ error: `HTTP ${res.status}` })) as { error?: string };
    return { ok: false, error: errorBody.error ?? `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

type CommitResponse = {
  hash: string;
  shortHash?: string;
  parents: string[];
  subject: string;
  author: string;
  authorDate: string;
  refs: string[];
  isMerge: boolean;
  signed?: boolean;
  signatureStatus?: SignatureStatus;
  added?: number;
  deleted?: number;
  fileCount?: number;
  riskScore?: number;
  /** Lightweight coarse structural classification (D-2). Present when API ≥ 0.9. */
  coarseKind?: "empty" | "likely_refactor" | "likely_logic";
};

export type ViewerEvent =
  | { type: "connected"; repoId: string }
  | { type: "commit_added"; repoId: string; ref: GitRef; commit: CommitResponse }
  | {
      type: "history_rewritten";
      repoId: string;
      ref: GitRef;
      previousHash: string;
      currentHash: string;
      observedAt?: string;
      detectionSource?: "polling" | "reconnect_recovery" | "direct_ref_change";
      explanation?: string;
    }
  | { type: "ref_created" | "ref_updated" | "ref_deleted"; repoId: string; ref: GitRef }
  | { type: "error"; error: string; timedOut?: boolean; truncated?: boolean };

export function eventsUrl(repoId: string) {
  return `${API_BASE_URL}/api/repos/${encodeURIComponent(repoId)}/events`;
}

export async function listRepositories() {
  const body = await getJson<{ repositories: Repository[] }>("/api/repos");
  return body.repositories;
}

export async function listRefs(repoId: string) {
  const body = await getJson<{ refs: GitRef[] }>(`/api/repos/${encodeURIComponent(repoId)}/refs`);
  return body.refs;
}

export type StashEntry = {
  name: string;
  hash: string;
  shortHash: string;
  committedAt: string | null;
  subject: string;
};

export async function listStashes(repoId: string): Promise<StashEntry[]> {
  const body = await getJson<{ stashes: StashEntry[] }>(
    `/api/repos/${encodeURIComponent(repoId)}/stashes`,
  );
  return body.stashes;
}

export type WorktreeEntry = {
  path: string;
  head: string | null;
  branch: string | null;
  branchShortName: string | null;
  bare: boolean;
  detached: boolean;
  locked: boolean;
  prunable: boolean;
  isPrimary: boolean;
};

export async function listWorktrees(repoId: string): Promise<WorktreeEntry[]> {
  const body = await getJson<{ worktrees: WorktreeEntry[] }>(
    `/api/repos/${encodeURIComponent(repoId)}/worktrees`,
  );
  return body.worktrees;
}

export type SubmoduleEntry = {
  path: string;
  hash: string;
  shortHash: string;
  describe: string | null;
  initialized: boolean;
  modified: boolean;
  conflicted: boolean;
  uninitialized: boolean;
};

export async function listSubmodules(
  repoId: string,
): Promise<SubmoduleEntry[]> {
  const body = await getJson<{ submodules: SubmoduleEntry[] }>(
    `/api/repos/${encodeURIComponent(repoId)}/submodules`,
  );
  return body.submodules;
}

export type RepoOperation =
  | {
      kind: "merge";
      targetHash: string | null;
      message: string | null;
    }
  | { kind: "cherry-pick"; targetHash: string | null }
  | { kind: "revert"; targetHash: string | null }
  | {
      kind: "rebase";
      backend: "merge" | "apply";
      headName: string | null;
      onto: string | null;
    }
  | { kind: "bisect"; start: string | null }
  | { kind: "sequencer" };

export type RepoStateResponse = {
  gitDir: string;
  operations: RepoOperation[];
};

export async function getRepoState(
  repoId: string,
): Promise<RepoStateResponse> {
  return getJson<RepoStateResponse>(
    `/api/repos/${encodeURIComponent(repoId)}/state`,
  );
}

export type SearchMode = "subject" | "pickaxe" | "regex" | "message";

export async function listCommits(
  repoId: string,
  ref: string,
  search = "",
  author = "",
  path = "",
  searchMode: SearchMode = "subject",
  searchPattern = "",
  limit = 100,
) {
  const params = new URLSearchParams({ ref, limit: String(limit) });
  // subject mode uses the legacy `search` param; other modes use `mode`+`pattern`.
  if (searchMode === "subject") {
    const normalizedSearch = search.trim();
    if (normalizedSearch) {
      params.set("search", normalizedSearch);
    }
  } else {
    const normalizedPattern = searchPattern.trim();
    if (normalizedPattern) {
      params.set("mode", searchMode);
      params.set("pattern", normalizedPattern);
    }
  }
  const normalizedAuthor = author.trim();
  if (normalizedAuthor) {
    params.set("author", normalizedAuthor);
  }
  const normalizedPath = path.trim();
  if (normalizedPath) {
    params.set("path", normalizedPath);
  }
  const body = await getJson<CommitResponse[]>(
    `/api/repos/${encodeURIComponent(repoId)}/commits?${params}`,
  );
  return body.map(toCommit);
}

export async function getCommit(repoId: string, hash: string, signal?: AbortSignal) {
  return getJson<CommitDetail>(
    `/api/repos/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(hash)}`,
    signal,
  );
}

export type ContainingRef = {
  name: string;
  shortName: string;
  hash: string;
  type: "branch" | "tag" | "remote" | "other";
  updatedAt: string | null;
};

export async function getCommitContainingRefs(
  repoId: string,
  hash: string,
  signal?: AbortSignal,
): Promise<ContainingRef[]> {
  const body = await getJson<{ refs: ContainingRef[] }>(
    `/api/repos/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(hash)}/refs`,
    signal,
  );
  return body.refs;
}

export type DiffPayload = {
  diff: string;
  truncated: boolean;
  maxBytes: number;
};

export async function getDiff(
  repoId: string,
  hash: string,
  signal?: AbortSignal,
): Promise<DiffPayload> {
  const body = await getJson<{ diff: string; truncated?: boolean; maxBytes?: number }>(
    `/api/repos/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(hash)}/diff`,
    signal,
  );
  return {
    diff: body.diff ?? "",
    truncated: Boolean(body.truncated),
    maxBytes: typeof body.maxBytes === "number" ? body.maxBytes : 0,
  };
}

export async function compareRefs(repoId: string, base: string, target: string) {
  const params = new URLSearchParams({ base, target });
  return getJson<CompareResult>(`/api/repos/${encodeURIComponent(repoId)}/compare?${params}`);
}

/** Grade assigned to an equivalent cherry-pick entry (D-6). */
export type CherryGrade =
  | "identical"       // no diff lines between base commit and target equivalent
  | "near-identical"  // diff lines ≤ nearIdenticalThreshold
  | "divergent"       // diff lines > nearIdenticalThreshold
  | "ungraded";       // grade not computed (cap exceeded or target counterpart not found)

export type CherryEntry = {
  hash: string;
  shortHash: string;
  subject: string;
  // Graded equivalence fields (present only on `equivalent` entries, absent on `missing`).
  grade?: CherryGrade;
  /** Added and deleted line counts from `git diff T^..T` on the target-side commit. */
  diffLines?: { added: number; deleted: number };
  /**
   * Raw unified-diff output (-U3) for the target-side commit. Only present
   * when grade is `near-identical` or `divergent`. May include a `[truncated]`
   * suffix when the diff exceeded the server byte cap.
   */
  diffHunks?: string;
  /** True when the diff output was truncated by the server-side byte cap. */
  truncated?: boolean;
};

export type CompareCherryResult = {
  base: string;
  target: string;
  // Base commits whose patch-id has an equivalent on target — i.e. already
  // cherry-picked (or otherwise applied) to the release branch.
  equivalent: CherryEntry[];
  // Base commits with no patch-id match on target — still missing from
  // the release.
  missing: CherryEntry[];
  /**
   * The `nearIdenticalThreshold` that was used for grading (lines added +
   * deleted). Echoed back so the UI can display the active threshold.
   */
  threshold: number;
};

/**
 * Lazy fetch for cherry-pick equivalence between two refs. Heavier than
 * the regular compare summary (computes patch-ids) so callers should only
 * trigger it when the user explicitly asks for cherry-pick status.
 *
 * @param nearIdenticalThreshold Lines-changed threshold for `near-identical`
 *   grade (default 10 server-side, clamped to [1, 50]).
 */
export async function compareCherry(
  repoId: string,
  base: string,
  target: string,
  nearIdenticalThreshold?: number,
  signal?: AbortSignal,
): Promise<CompareCherryResult> {
  const params = new URLSearchParams({ base, target });
  if (nearIdenticalThreshold !== undefined) {
    params.set("nearIdenticalThreshold", String(nearIdenticalThreshold));
  }
  return getJson<CompareCherryResult>(
    `/api/repos/${encodeURIComponent(repoId)}/compare/cherry?${params}`,
    signal,
  );
}

export type CommitsSummaryGroup = {
  kind: "prefix" | "path" | "author";
  key: string;
  commitCount: number;
  added: number;
  deleted: number;
  authors: string[];
  sampleSubjects: string[];
  commitHashes: string[];
};

export type CommitsSummary = {
  period: { since: string; until: string; tz: "UTC" };
  ref: { input: string; resolved: string };
  observed: {
    totalCommits: number;
    totalAdded: number;
    totalDeleted: number;
    authorsCount: number;
  };
  groups: CommitsSummaryGroup[];
  uncategorized:
    | { kind: "prefix"; commitHashes: string[]; commitCount: number }
    | null;
  truncated: boolean;
};

export type FileHistoryEntry = {
  hash: string;
  shortHash: string;
  parents: string[];
  author: string;
  authorEmail: string;
  authorDate: string;
  subject: string;
  patch: string;
};

export type FileHistoryResponse = {
  path: string;
  ref: { input: string; resolved: string };
  entries: FileHistoryEntry[];
  truncated: boolean;
  limit: number;
};

export async function fetchFileHistory(
  repoId: string,
  params: { path: string; ref?: string; limit?: number },
  signal?: AbortSignal,
): Promise<FileHistoryResponse> {
  const search = new URLSearchParams();
  search.set("path", params.path);
  if (params.ref) search.set("ref", params.ref);
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    search.set("limit", String(params.limit));
  }
  return getJson<FileHistoryResponse>(
    `/api/repos/${encodeURIComponent(repoId)}/files/history?${search}`,
    signal,
  );
}

/**
 * One sibling-file row of the related-files (co-change) result. `coChangeCount`
 * is the literal number of commits where this path was edited together with
 * the target; `lastCoChangeAt` is the latest authorDate observed in that
 * subset (Git's own ISO-8601 string, never re-derived).
 */
export type RelatedFileEntry = {
  path: string;
  coChangeCount: number;
  lastCoChangeAt: string;
};

/**
 * Wire shape for `GET /api/repos/:repoId/files/related`. `scannedCommits`
 * tells the user how many target-touching commits were inspected to compute
 * the aggregate; `truncated` mirrors `getFileHistory` — true when the repo
 * has more matching commits than `limit` allowed us to scan.
 */
export type RelatedFilesResponse = {
  path: string;
  ref: { input: string; resolved: string };
  scannedCommits: number;
  truncated: boolean;
  related: RelatedFileEntry[];
};

export async function fetchRelatedFiles(
  repoId: string,
  params: { path: string; ref?: string; limit?: number },
  signal?: AbortSignal,
): Promise<RelatedFilesResponse> {
  const search = new URLSearchParams();
  search.set("path", params.path);
  if (params.ref) search.set("ref", params.ref);
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    search.set("limit", String(params.limit));
  }
  return getJson<RelatedFilesResponse>(
    `/api/repos/${encodeURIComponent(repoId)}/files/related?${search}`,
    signal,
  );
}

// ---------------------------------------------------------------------------
// Range history ("Why is this here?" panel)
// GET /api/repos/:repoId/files/range-history
// ---------------------------------------------------------------------------

export type RangeHistoryEntry = {
  hash: string;
  shortHash: string;
  author: string;
  authorDate: string;
  subject: string;
  body: string;
  urlsInBody: string[];
};

/**
 * Wire shape for `GET /api/repos/:repoId/files/range-history`. `entries` are
 * the commits that last touched the given line range, ordered newest-first.
 * `truncated` is true when the repo has more matching commits than `limit`
 * allowed us to surface.
 */
export type RangeHistoryResponse = {
  path: string;
  ref: { input: string; resolved: string };
  lineStart: number;
  lineEnd: number;
  entries: RangeHistoryEntry[];
  truncated: boolean;
  limit: number;
};

export async function fetchRangeHistory(
  repoId: string,
  params: { path: string; lineStart: number; lineEnd: number; ref?: string; limit?: number },
  signal?: AbortSignal,
): Promise<RangeHistoryResponse> {
  const search = new URLSearchParams();
  search.set("path", params.path);
  search.set("lineStart", String(params.lineStart));
  search.set("lineEnd", String(params.lineEnd));
  if (params.ref) search.set("ref", params.ref);
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    search.set("limit", String(params.limit));
  }
  return getJson<RangeHistoryResponse>(
    `/api/repos/${encodeURIComponent(repoId)}/files/range-history?${search}`,
    signal,
  );
}

/**
 * Working-tree changes payload. The API returns the literal `git diff` /
 * `git diff --cached` output; the UI feeds each side's `diff` straight into
 * `parseUnifiedDiff` (same parser used for committed diffs and file history).
 *
 * `notes.untrackedExcluded` records whether the API surfaced untracked
 * files. It is `false` when an `untracked` section is present and `true`
 * only on builds that haven't yet enabled the `ls-files`-backed listing.
 */
export type WorkTreeSection = {
  diff: string;
  summary: { fileCount: number; added: number; deleted: number };
  truncated: boolean;
};

export type WorkTreeUntrackedFile = {
  path: string;
  status: "A";
  added: number;
  deleted: 0;
};

export type WorkTreeUntrackedSection = {
  files: WorkTreeUntrackedFile[];
  /**
   * Synthesized unified diff covering every untracked path. The API stitches
   * `--- /dev/null / +++ b/<path>` headers + the file content (or a
   * `Binary files … differ` marker) so the UI can render untracked changes
   * with the same DiffViewer used for staged/unstaged sides.
   */
  diff: string;
  summary: { fileCount: number; added: number; deleted: 0 };
};

export type WorkTreeResponse = {
  staged: WorkTreeSection;
  unstaged: WorkTreeSection;
  untracked?: WorkTreeUntrackedSection;
  snapshotAt: string;
  notes: { untrackedExcluded: boolean };
};

export async function fetchWorkTree(
  repoId: string,
  signal?: AbortSignal,
): Promise<WorkTreeResponse> {
  return getJson<WorkTreeResponse>(
    `/api/repos/${encodeURIComponent(repoId)}/worktree`,
    signal,
  );
}

export type RefDriftEntry = {
  name: string;
  type: "branch" | "remote" | "tag" | "other";
  ahead: number;
  behind: number;
  mergeBase: string | null;
  hash: string;
};

export type RefDriftResponse = {
  base: { input: string; resolved: string };
  refs: RefDriftEntry[];
  truncated: boolean;
  limit: number;
};

export async function fetchRefDrift(
  repoId: string,
  params?: { base?: string; limit?: number },
  signal?: AbortSignal,
): Promise<RefDriftResponse> {
  const search = new URLSearchParams();
  if (params?.base) search.set("base", params.base);
  if (typeof params?.limit === "number" && Number.isFinite(params.limit)) {
    search.set("limit", String(params.limit));
  }
  const querySuffix = search.toString();
  return getJson<RefDriftResponse>(
    `/api/repos/${encodeURIComponent(repoId)}/refs/drift${querySuffix ? `?${querySuffix}` : ""}`,
    signal,
  );
}

export async function fetchCommitsSummary(
  repoId: string,
  params: {
    since: string;
    until: string;
    groupBy?: "prefix" | "path" | "author";
    ref?: string;
  },
  signal?: AbortSignal,
) {
  const search = new URLSearchParams();
  if (params.since) search.set("since", params.since);
  if (params.until) search.set("until", params.until);
  if (params.groupBy) search.set("groupBy", params.groupBy);
  if (params.ref) search.set("ref", params.ref);
  return getJson<CommitsSummary>(
    `/api/repos/${encodeURIComponent(repoId)}/commits/summary?${search}`,
    signal,
  );
}

// ---------------------------------------------------------------------------
// Branch group health fetch
// ---------------------------------------------------------------------------

/**
 * A single branch entry returned by the group-health endpoint.
 * Observed fields (raw Git data): ahead, behind, daysSinceLast, updatedAt.
 * Derived field (Refscope): rotScore = clamp(D/7,0,10)+clamp(B/5,0,10)+clamp(A/10,0,5).
 */
export type BranchGroupEntry = {
  name: string;
  shortName: string;
  hash: string;
  updatedAt: string | null;
  ahead: number;
  behind: number;
  mergeBase: string | null;
  daysSinceLast: number;
  /** Derived rot-risk score 0–25. See API docs for formula. */
  rotScore: number;
};

export type BranchGroupHealthResponse = {
  prefix: string | null;
  base: { input: string; resolved: string };
  /**
   * Currently checked-out branch when HEAD points to a branch.
   * `null` on detached HEAD or when the API cannot resolve it.
   * Use `head.hash` to match the corresponding entry in `branches`.
   */
  head: { name: string; hash: string } | null;
  branches: BranchGroupEntry[];
};

export async function fetchBranchGroupHealth(
  repoId: string,
  params?: { prefix?: string; base?: string },
  signal?: AbortSignal,
): Promise<BranchGroupHealthResponse> {
  const search = new URLSearchParams();
  if (params?.prefix) search.set("prefix", params.prefix);
  if (params?.base) search.set("base", params.base);
  const querySuffix = search.toString();
  return getJson<BranchGroupHealthResponse>(
    `/api/repos/${encodeURIComponent(repoId)}/branches/grouped${querySuffix ? `?${querySuffix}` : ""}`,
    signal,
  );
}

// ---------------------------------------------------------------------------
// Symbol history fetch (D-1)
// GET /api/repos/:repoId/symbols/history
// ---------------------------------------------------------------------------

/**
 * Rename evidence for a symbol-history entry.
 * When the file containing the symbol was renamed at this commit, Git reports
 * the old and new paths. `similarity` is the rename percentage as computed by
 * Git (never inferred by Refscope).
 */
export type SymbolRenameInfo = {
  from: string;
  to: string;
  /** Similarity percentage [0, 100] reported by Git, or null if not available. */
  similarity: number | null;
};

/**
 * One commit entry in a symbol-history response.
 * `renameInfo` is non-null only when the file was renamed at this commit.
 */
export type SymbolHistoryEntry = {
  hash: string;
  shortHash: string;
  author: string;
  authorDate: string;
  subject: string;
  body: string;
  renameInfo: SymbolRenameInfo | null;
};

/**
 * Wire shape for `GET /api/repos/:repoId/symbols/history`.
 * `truncated` is true when the repo has more matching commits than `limit`.
 */
export type SymbolHistoryResponse = {
  funcname: string;
  path: string;
  ref: { input: string; resolved: string };
  entries: SymbolHistoryEntry[];
  truncated: boolean;
  limit: number;
};

/**
 * Fetch the commit history for a named symbol (function/method).
 *
 * Uses `git log -L :<funcname>:<path>` under the hood. Symbol not found
 * (typo or unsupported language) rejects with an Error containing a `hint`
 * field; callers should surface this to the user.
 *
 * @param params.path     - File path relative to the repo root.
 * @param params.funcname - Symbol name (function, method, constant).
 * @param params.ref      - Git ref to start history from (default HEAD).
 * @param params.limit    - Max commits to return (default 20, max 50).
 */
export async function fetchSymbolHistory(
  repoId: string,
  params: { path: string; funcname: string; ref?: string; limit?: number },
  signal?: AbortSignal,
): Promise<SymbolHistoryResponse> {
  const search = new URLSearchParams();
  search.set("path", params.path);
  search.set("funcname", params.funcname);
  if (params.ref) search.set("ref", params.ref);
  if (typeof params.limit === "number" && Number.isFinite(params.limit)) {
    search.set("limit", String(params.limit));
  }
  return getJson<SymbolHistoryResponse>(
    `/api/repos/${encodeURIComponent(repoId)}/symbols/history?${search}`,
    signal,
  );
}

// ---------------------------------------------------------------------------
// Fleet snapshot fetch
// ---------------------------------------------------------------------------

/**
 * One repo entry in a fleet snapshot.
 * Type transcribed from apps/api/schemas/fleet-response.schema.json (version=1).
 * No new dependency; shape is manually kept in sync with the schema.
 */
export type FleetRepoEntry = {
  repoId: string;
  headShortSha: string | null;
  commits24h: number | null;
  refMove1h: boolean | null;
  worktreeDirty: boolean | null;
  lastEventAt: string | null;
  status: "ok" | "timeout" | "git_error" | "missing" | "unauthorized";
};

export type FleetSnapshot = {
  version: 1;
  snapshotAt: string;
  window: "1h" | "6h" | "24h" | "7d";
  repos: FleetRepoEntry[];
  estimatedCost: {
    subscribedRepoCount: number;
    snapshotIntervalMs: number;
    gitCallsPerMin: number;
  };
  notes: {
    untrackedExcluded: boolean;
    sseAvailable: boolean;
  };
};

/**
 * Fetch a fleet snapshot from GET /api/fleet/snapshot.
 *
 * AbortController support: pass `signal` to cancel an in-flight request when
 * a new poll cycle starts before the previous response has arrived, preventing
 * race conditions.
 *
 * Error handling: HTTP error or network failure throws a typed Error. The
 * caller (App.tsx polling loop) catches and maps to the `fleetError` state.
 *
 * @param params.include - Repo ids to include (excluded list already removed by caller).
 * @param params.window  - Observation window (default "24h").
 * @param params.signal  - AbortSignal for in-flight cancellation.
 */
export async function fetchFleetSnapshot(params: {
  include?: string[];
  window?: "1h" | "6h" | "24h" | "7d";
  signal?: AbortSignal;
}): Promise<FleetSnapshot> {
  const search = new URLSearchParams();
  if (params.include && params.include.length > 0) {
    search.set("include", params.include.join(","));
  }
  if (params.window) {
    search.set("window", params.window);
  }
  const suffix = search.toString();
  return getJson<FleetSnapshot>(
    `/api/fleet/snapshot${suffix ? `?${suffix}` : ""}`,
    params.signal,
  );
}

// ---------------------------------------------------------------------------
// Hotspot Lens
// ---------------------------------------------------------------------------

export type HotspotFileEntry = {
  path: string;
  lines: number;
  // bytes is intentionally omitted in Phase 1 (UTF-8 re-encoding makes it
  // inaccurate for binary files); will be re-introduced in Phase 2.
  churn: number;
  lastChangedAt: string; // ISO 8601
  authors: number;       // Phase 1 では 0 固定
};

export type HotspotResponse = {
  repoId: string;
  ref: string;           // 解決済み commit OID (40 hex)
  refLabel: string;      // 元の ref 表記
  scope: {
    commitsAnalyzed: number;
    commitCap: number;
    sinceISO?: string;
  };
  files: HotspotFileEntry[];
  truncated: boolean;
  truncationReason?: 'limit' | 'commitCap' | 'maxBytes' | 'timeout';
};

export async function fetchFileHotspot(
  repoId: string,
  params: { ref?: string; limit?: number; since?: string; commitCap?: number },
  signal?: AbortSignal,
): Promise<HotspotResponse> {
  const search = new URLSearchParams();
  if (params.ref)       search.set('ref', params.ref);
  if (params.limit)     search.set('limit', String(params.limit));
  if (params.since)     search.set('since', params.since);
  if (params.commitCap) search.set('commitCap', String(params.commitCap));
  const qs = search.toString();
  const path = `/api/repos/${encodeURIComponent(repoId)}/files/hotspot${qs ? `?${qs}` : ''}`;
  return getJson<HotspotResponse>(path, signal);
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    throw new Error(
      `Cannot reach API at ${API_BASE_URL}. Run ${API_RECOVERY_COMMAND} from the repository root, or start the API with RTGV_REPOS=viewer=/absolute/path pnpm dev:api if you want to inspect another repository.`,
      { cause: error },
    );
  }
  if (!response.ok) {
    const message = await readError(response);
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

async function readError(response: Response) {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed with ${response.status}`;
  } catch {
    return `Request failed with ${response.status}`;
  }
}

function toCommit(commit: CommitResponse): Commit {
  return {
    hash: commit.hash,
    shortHash: commit.shortHash,
    subject: commit.subject,
    author: commit.author,
    authorDate: commit.authorDate,
    time: formatRelativeTime(commit.authorDate),
    refs: commit.refs,
    added: commit.added ?? 0,
    deleted: commit.deleted ?? 0,
    fileCount: commit.fileCount ?? 0,
    files: [],
    isMerge: commit.isMerge,
    signed: commit.signed,
    signatureStatus: commit.signatureStatus,
    parents: commit.parents,
    lane: commit.isMerge ? 1 : 0,
    riskScore: commit.riskScore,
    coarseKind: commit.coarseKind,
  };
}

function formatRelativeTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
