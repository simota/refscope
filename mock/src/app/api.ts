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

export type SearchMode = "subject" | "pickaxe" | "regex" | "message";

export async function listCommits(
  repoId: string,
  ref: string,
  search = "",
  author = "",
  path = "",
  searchMode: SearchMode = "subject",
  searchPattern = "",
) {
  const params = new URLSearchParams({ ref, limit: "100" });
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

export async function getCommit(repoId: string, hash: string) {
  return getJson<CommitDetail>(
    `/api/repos/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(hash)}`,
  );
}

export type DiffPayload = {
  diff: string;
  truncated: boolean;
  maxBytes: number;
};

export async function getDiff(repoId: string, hash: string): Promise<DiffPayload> {
  const body = await getJson<{ diff: string; truncated?: boolean; maxBytes?: number }>(
    `/api/repos/${encodeURIComponent(repoId)}/commits/${encodeURIComponent(hash)}/diff`,
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
 * Working-tree changes payload. The API returns the literal `git diff` /
 * `git diff --cached` output; the UI feeds each side's `diff` straight into
 * `parseUnifiedDiff` (same parser used for committed diffs and file history).
 *
 * `notes.untrackedExcluded` is a boundary marker: refscope's gitRunner
 * allowlist does not include `status` or `ls-files`, so this view only
 * observes tracked changes. The UI renders that fact as an in-panel notice.
 */
export type WorkTreeSection = {
  diff: string;
  summary: { fileCount: number; added: number; deleted: number };
  truncated: boolean;
};

export type WorkTreeResponse = {
  staged: WorkTreeSection;
  unstaged: WorkTreeSection;
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
