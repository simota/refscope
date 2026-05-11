import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { GitCommandError, runGit } from "./gitRunner.js";
import { addRepository as configAddRepository, removeRepository as configRemoveRepository } from "./config.js";
import { classifyFileDiff } from "./structuralDiff.js";
import {
  isValidGitRef,
  isValidObjectId,
  parseAuthorQuery,
  parseBranchPrefixQuery,
  parseDateQuery,
  parseFuncNameQuery,
  parseGroupByQuery,
  parseLimitQuery,
  parseLineNumberQuery,
  parseNearIdenticalThresholdQuery,
  parsePathQuery,
  parsePatternQuery,
  parseSearchModeQuery,
  parseSearchQuery,
  BRANCH_GROUP_MAX_BRANCHES,
} from "./validation.js";

// Hard cap on commits returned by /commits/summary. We read +1
// (`SUMMARY_READ_LIMIT`) to detect over-cap repositories and surface
// `truncated: true` in the payload without exposing the extra commit.
export const SUMMARY_COMMIT_HARD_CAP = 200;
export const SUMMARY_READ_LIMIT = SUMMARY_COMMIT_HARD_CAP + 1;
export const SUMMARY_SAMPLE_SUBJECTS_MAX = 10;
export const SUMMARY_DEFAULT_GROUP_BY = "prefix";

// File-history hard caps. Default is 20 commits, capped at 50. We always read
// `limit + 1` so we can detect over-cap responses and emit `truncated: true`
// without leaking the extra commit. These bounds are observation-side limits
// (how many commits to surface), independent of `SUMMARY_COMMIT_HARD_CAP`.
export const FILE_HISTORY_DEFAULT_LIMIT = 20;
export const FILE_HISTORY_MAX_LIMIT = 50;

// Related-files (co-change) hard caps. Default is 30 commits to scan, capped at
// 50. We always read `limit + 1` so we can detect over-cap responses and emit
// `truncated: true` without leaking the extra commit. The number of related
// entries surfaced in the response is bounded separately by
// `RELATED_FILES_TOP_K` — counts and dates beyond the slice are *not* exposed,
// only the literal observed top-K rows.
export const RELATED_FILES_DEFAULT_LIMIT = 30;
export const RELATED_FILES_MAX_LIMIT = 50;
export const RELATED_FILES_TOP_K = 20;

// Ref-drift hard caps. Drift fans out to `2 * N + N` git calls (ahead + behind
// + merge-base) per request, all parallelised through `Promise.all`. We cap
// the number of refs surfaced so a repository with 1000+ branches doesn't
// pin a Node worker. Default 50, max 100; we read `limit + 1` to detect
// over-cap responses without leaking the extra ref into the payload.
export const REF_DRIFT_DEFAULT_LIMIT = 50;
export const REF_DRIFT_MAX_LIMIT = 100;

// Hotspot Lens hard caps. `limit` governs how many files appear in the
// response; `commitCap` bounds the `git log` scan depth so large repositories
// stay within the latency budget.  Both have explicit defaults and maxima that
// `parseLimitQuery` enforces before any Git command is invoked.
export const HOTSPOT_DEFAULT_LIMIT = 500;
export const HOTSPOT_MAX_LIMIT = 1000;
export const HOTSPOT_DEFAULT_COMMIT_CAP = 200;
export const HOTSPOT_MAX_COMMIT_CAP = 500;

// Range-history hard caps (D-4). Default is 20 commits, capped at 50.
// We always read `limit + 1` so we can detect over-cap responses and emit
// `truncated: true` without leaking the extra commit. git log -L can be slow
// on large files so keeping the default low is important for responsiveness.
export const RANGE_HISTORY_DEFAULT_LIMIT = 20;
export const RANGE_HISTORY_MAX_LIMIT = 50;

// Symbol-history hard caps (D-1). Reuses the same defaults as range-history:
// default 20 commits, capped at 50. `git log -L :name:path` can be slow on
// large repositories (full-history line-range scan), so a low default is
// important for responsiveness. Read `limit + 1` to detect truncation.
// #TODO(agent): consider cursor pagination (D-1.1) once real-user feedback
// confirms 50 commits is insufficient for typical refactor workflows.
export const SYMBOL_HISTORY_DEFAULT_LIMIT = 20;
export const SYMBOL_HISTORY_MAX_LIMIT = 50;

// Graded cherry-pick equivalence caps (D-6).
// Grade computation runs one `git diff` per equivalent entry — cap the number
// of entries that receive a grade to bound the request cost. Entries beyond
// the cap are returned with grade "ungraded". The threshold distinguishes
// `near-identical` (≤ threshold lines changed) from `divergent` (> threshold);
// it defaults to 10 and is clamped to [1, 50] so callers can tune it via URL.
export const CHERRY_GRADE_MAX_ENTRIES = 100;
export const CHERRY_THRESHOLD_DEFAULT = 10;
export const CHERRY_THRESHOLD_MAX = 50;

// Conventional-commit prefix grouping uses a literal regex match on the
// commit subject. `feat`, `fix`, `chore`, … with optional scope, then a colon
// + space. Subjects that do not match are kept as observed data and isolated
// into the `uncategorized` bucket — we never *infer* a category from text
// content.
const CONVENTIONAL_COMMIT_PREFIX_PATTERN = /^([a-z][a-z0-9-]*)(?:\([^)]*\))?:\s/;

const COMMIT_FIELD_SEPARATOR = "\u0000";
const COMMIT_RECORD_SEPARATOR = "\u001e";

// ---------------------------------------------------------------------------
// Risky Diff Detector — Hotspot cache (TTL 60 s) + scoring
// ---------------------------------------------------------------------------

/** TTL for the per-repo hotspot cache (milliseconds). */
const HOTSPOT_CACHE_TTL_MS = 60_000;

/**
 * Compute a risk score for a set of file diffs using hotspot churn data.
 *
 * Pure function — no I/O, testable in isolation.
 *
 * @param {Array<{ path: string; added: number; deleted: number }>} fileDiffs
 * @param {Map<string, { churn: number }>} hotspotCache  path → { churn }
 * @param {{ binaryAlpha?: number; massDeleteBeta?: number }} [opts]
 * @returns {number} Integer risk score ≥ 0
 */
export function scoreDiff(fileDiffs, hotspotCache, { binaryAlpha = 20, massDeleteBeta = 15 } = {}) {
  if (!fileDiffs || fileDiffs.length === 0) return 0;

  let score = 0;

  for (const file of fileDiffs) {
    const isBinary = file.added === -1 || file.deleted === -1;
    if (isBinary) {
      score += binaryAlpha;
      continue;
    }

    const hunkSize = (file.added ?? 0) + (file.deleted ?? 0);
    const churnEntry = hotspotCache.get(file.path);
    const churn = churnEntry?.churn ?? 0;

    // hotspotWeight: log-scale churn (adds a point per doubling, avoids extreme outliers)
    const hotspotWeight = churn > 0 ? Math.log2(churn + 1) : 0;
    score += hotspotWeight * hunkSize;

    // mass-delete penalty: ≥ 100 deleted lines in a single file
    if ((file.deleted ?? 0) >= 100) {
      score += massDeleteBeta;
    }
  }

  return Math.round(score);
}

export function createGitService(config) {
  // Hotspot cache: key = repoId, value = { files: Map<path, { churn }>, ts }
  /** @type {Map<string, { files: Map<string, { churn: number }>; ts: number }>} */
  const _hotspotCache = new Map();

  /**
   * Refresh the hotspot churn cache for a repo (fire-and-forget safe).
   * Uses the last 200 commits, no LOC fetching needed.
   *
   * @param {{ id: string; name: string; path: string }} repo
   * @returns {Promise<void>}
   */
  async function refreshHotspotCache(repo) {
    const logArgs = [
      "-z",
      "--no-show-signature",
      "--name-only",
      "--format=%H%x1f%aI",
      "--max-count=200",
      "--end-of-options",
      "HEAD",
      "--",
    ];
    const { stdout } = await runGit(repo, ["log", ...logArgs], {
      timeoutMs: config.gitTimeoutMs,
    });

    /** @type {Map<string, { churn: number }>} */
    const files = new Map();
    /** @type {Set<string> | null} */
    let currentCommitPaths = null;

    for (let raw of stdout.split("\x00")) {
      const record = raw.startsWith("\n") ? raw.slice(1) : raw;
      if (!record) continue;
      if (record.includes("\x1f")) {
        // Header record — start new commit
        currentCommitPaths = new Set();
      } else {
        if (currentCommitPaths !== null && !currentCommitPaths.has(record)) {
          currentCommitPaths.add(record);
          const existing = files.get(record);
          if (existing) {
            existing.churn += 1;
          } else {
            files.set(record, { churn: 1 });
          }
        }
      }
    }

    _hotspotCache.set(repo.id, { files, ts: Date.now() });
  }

  async function listRefs(repo) {
    const { stdout } = await runGit(
      repo,
      [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(committerdate:iso-strict)",
        "refs/heads",
        "refs/tags",
        "refs/remotes",
      ],
      { timeoutMs: config.gitTimeoutMs },
    );

    return stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name, objectHash, peeledHash, updatedAt] = line.split(COMMIT_FIELD_SEPARATOR);
        return {
          name,
          shortName: shortRefName(name),
          hash: peeledHash || objectHash,
          type: refType(name),
          updatedAt: updatedAt || null,
        };
      });
  }

  async function listCommitRange(repo, fromHash, toHash) {
    const { stdout } = await runGit(
      repo,
      [
        "log",
        "--max-count=50",
        "--date=iso-strict",
        `--format=${COMMIT_RECORD_SEPARATOR}%H%x00%P%x00%an%x00%aI%x00%s%x00%D`,
        "--no-show-signature",
        "--numstat",
        "--no-ext-diff",
        "--no-textconv",
        ...commitRangeLogArgs(fromHash, toHash),
        "--",
      ],
      { timeoutMs: config.gitTimeoutMs },
    );

    return parseCommitRecords(stdout).reverse();
  }

  async function isAncestor(repo, oldHash, newHash) {
    try {
      await runGit(repo, ancestorMergeBaseArgs(oldHash, newHash), {
        timeoutMs: config.gitTimeoutMs,
      });
      return true;
    } catch (error) {
      if (error instanceof GitCommandError && error.exitCode === 1) {
        return false;
      }
      throw error;
    }
  }

  return {
    listRepositories() {
      return Array.from(config.repositories.values()).map((repo) => ({
        id: repo.id,
        name: repo.name,
        origin: repo.origin,
      }));
    },

    getRepository(repoId) {
      return config.repositories.get(repoId);
    },

    /**
     * Add a repository to the runtime allowlist and persist it.
     * Delegates to config.addRepository which enforces capacity and dedup rules.
     *
     * @param {string} id - Pre-validated repository identifier
     * @param {string} normalizedPath - Absolute canonical Git working-tree root
     * @returns {{ id: string, name: string, path: string, origin: "ui", addedAt: string }}
     */
    addRepository(id, normalizedPath) {
      const entry = configAddRepository(id, normalizedPath);
      return {
        id: entry.id,
        name: entry.name,
        path: entry.path,
        origin: entry.origin,
        addedAt: new Date().toISOString(),
      };
    },

    /**
     * Remove a user-managed repository from the runtime allowlist and persist the change.
     * Throws if the repository is env-origin or does not exist.
     *
     * @param {string} id - Repository identifier to remove
     */
    removeRepository(id) {
      configRemoveRepository(id);
    },

    async listRefs(repo) {
      return listRefs(repo);
    },

    async listStashes(repo) {
      // Read-only stash list. Format mirrors listRefs (NUL-separated fields)
      // so the UI can rely on the same parsing convention. We use %ct (commit
      // timestamp, Unix seconds) over %gd's relative date because the UI
      // already humanizes timestamps elsewhere — keeping the API in absolute
      // values means clock drift is the parent's problem, not ours.
      // We can't put a literal NUL byte in the format argument because
      // Node's `spawn` rejects argv strings containing NUL. `%x00` is Git's
      // own escape — it expands to a NUL in the *output*, which is exactly
      // the separator we then split on (matching listRefs's convention).
      const { stdout } = await runGit(
        repo,
        [
          "stash",
          "list",
          "--no-show-signature",
          "--format=%gd%x00%H%x00%ct%x00%s",
        ],
        { timeoutMs: config.gitTimeoutMs },
      );

      const stashes = stdout
        .split("\n")
        .map((line) => line.trimEnd())
        .filter(Boolean)
        .map((line) => {
          const [refName, hash, ctimeRaw, subject] =
            line.split(COMMIT_FIELD_SEPARATOR);
          const committedAt = parseUnixSecondsToIso(ctimeRaw);
          return {
            name: refName,
            hash,
            shortHash: hash ? hash.slice(0, 7) : "",
            committedAt,
            subject: subject ?? "",
          };
        });
      return { status: 200, body: { stashes } };
    },

    async listWorktrees(repo) {
      // `git worktree list --porcelain` emits a stanza per worktree separated
      // by blank lines, with leading `worktree <path>` and optional
      // `HEAD <oid>`, `branch <ref>`, `bare`, `detached`, `locked`, `prunable`
      // attribute lines. We map the lot to a stable JSON shape so the UI
      // never has to re-parse Git's textual contract.
      const { stdout } = await runGit(
        repo,
        ["worktree", "list", "--porcelain"],
        { timeoutMs: config.gitTimeoutMs },
      );
      const worktrees = parseWorktreePorcelain(stdout, repo.path);
      return { status: 200, body: { worktrees } };
    },

    async getRepoState(repo) {
      // Active in-progress operations (merge / rebase / cherry-pick / revert
      // / bisect / sequencer). Detection is by presence of canonical marker
      // files inside `.git/`; the spec is in Git's documentation and stable
      // across versions. We resolve `.git` via `rev-parse --absolute-git-dir`
      // so linked worktrees (whose `.git` is a file pointing elsewhere) work.
      const { stdout } = await runGit(
        repo,
        ["rev-parse", "--absolute-git-dir"],
        { timeoutMs: config.gitTimeoutMs },
      );
      const gitDir = stdout.trim();
      const operations = collectInProgressOperations(gitDir);
      return { status: 200, body: { gitDir, operations } };
    },

    async listSubmodules(repo) {
      // `git submodule status --recursive` emits one line per submodule:
      //   ' <hash> <path> (<describe>)'   — initialized, in sync
      //   '+<hash> <path> (<describe>)'   — initialized, modified
      //   '-<hash> <path>'                — uninitialized
      //   'U<hash> <path>'                — merge conflicts in submodule
      // The leading space-or-flag is the status indicator. Repos with no
      // submodules return empty stdout.
      const { stdout } = await runGit(
        repo,
        ["submodule", "status", "--recursive"],
        { timeoutMs: config.gitTimeoutMs },
      );
      const submodules = parseSubmoduleStatus(stdout);
      return { status: 200, body: { submodules } };
    },

    async getRefSnapshot(repo) {
      const refs = await listRefs(repo);
      return new Map(refs.map((ref) => [ref.name, ref]));
    },

    async collectRefEvents(repo, previousSnapshot) {
      const refs = await listRefs(repo);
      const currentSnapshot = new Map(refs.map((ref) => [ref.name, ref]));
      const changes = compareRefSnapshots(previousSnapshot, currentSnapshot);
      const events = [];

      for (const change of changes) {
        if (change.type === "ref_created") {
          events.push({
            type: "ref_created",
            repoId: repo.id,
            ref: change.ref,
          });
          continue;
        }

        if (change.type === "ref_deleted") {
          events.push({
            type: "ref_deleted",
            repoId: repo.id,
            ref: change.ref,
          });
          continue;
        }

        if (change.ref.type !== "branch" && change.ref.type !== "remote") {
          events.push({
            type: "ref_updated",
            repoId: repo.id,
            ref: change.ref,
            previousHash: change.previousHash,
          });
          continue;
        }

        if (!(await isAncestor(repo, change.previousHash, change.ref.hash))) {
          events.push({
            type: "history_rewritten",
            repoId: repo.id,
            ref: change.ref,
            previousHash: change.previousHash,
            currentHash: change.ref.hash,
            observedAt: new Date().toISOString(),
            detectionSource: "polling",
            explanation:
              "The current commit is not a descendant of the previously observed commit.",
          });
          continue;
        }

        const commits = await listCommitRange(repo, change.previousHash, change.ref.hash);

        // Refresh hotspot cache if stale (fire-and-forget — never blocks the poller)
        const cached = _hotspotCache.get(repo.id);
        if (!cached || Date.now() - cached.ts > HOTSPOT_CACHE_TTL_MS) {
          refreshHotspotCache(repo).catch(() => {
            // Deliberate no-op: hotspot refresh failures fall back to score 0
          });
        }

        const hotspotFiles = _hotspotCache.get(repo.id)?.files ?? new Map();

        for (const commit of commits) {
          // commit.fileDiffs is populated by parseCommitRecords from --numstat output
          const riskScore = scoreDiff(commit.fileDiffs ?? [], hotspotFiles);

          // Strip internal fileDiffs before emitting — it's a scoring artefact,
          // not part of the public SSE payload contract.
          const { fileDiffs: _fd, ...commitPayload } = commit;
          events.push({
            type: "commit_added",
            repoId: repo.id,
            ref: change.ref,
            commit: { ...commitPayload, riskScore },
          });
        }
      }

      return { snapshot: currentSnapshot, events };
    },

    async listCommits(repo, query) {
      const queryValues = readCommitListQuery(query);
      if (!queryValues.ok) {
        return { status: 400, body: { error: queryValues.error } };
      }

      const limit = parseLimitQuery(queryValues.value.limit, 50, 200);
      if (!limit.ok) {
        return { status: 400, body: { error: limit.error } };
      }
      const ref = queryValues.value.ref || "HEAD";
      if (!isValidGitRef(ref)) {
        return { status: 400, body: { error: "Invalid ref parameter" } };
      }
      const search = parseSearchQuery(queryValues.value.search);
      if (!search.ok) {
        return { status: 400, body: { error: search.error } };
      }
      const author = parseAuthorQuery(queryValues.value.author);
      if (!author.ok) {
        return { status: 400, body: { error: author.error } };
      }
      const path = parsePathQuery(queryValues.value.path);
      if (!path.ok) {
        return { status: 400, body: { error: path.error } };
      }
      const mode = parseSearchModeQuery(queryValues.value.mode);
      if (!mode.ok) {
        return { status: 400, body: { error: mode.error } };
      }
      const pattern = parsePatternQuery(queryValues.value.pattern);
      if (!pattern.ok) {
        return { status: 400, body: { error: pattern.error } };
      }

      // `search` is the legacy subject-search parameter. Combining it with a
      // non-subject mode is ambiguous — reject early to surface the conflict.
      if (search.value && mode.value !== "subject") {
        return { status: 400, body: { error: "Cannot combine search and mode parameters" } };
      }

      const commitishRef = await resolveCommitishRevision(repo, ref, config.gitTimeoutMs);
      if (!commitishRef.ok) {
        return commitishRef.result;
      }

      const searchArgs = buildSearchModeArgs(mode.value, pattern.value, search.value);
      const authorArgs = author.value
        ? ["--regexp-ignore-case", "--extended-regexp", `--author=${escapeGitRegexLiteral(author.value)}`]
        : [];
      const pathArgs = path.value ? [formatLiteralPathspec(path.value)] : [];

      const { stdout } = await runGit(
        repo,
        commitListLogArgs(limit.value, searchArgs, authorArgs, commitishRef.hash, pathArgs),
        { timeoutMs: config.gitTimeoutMs },
      );

      const commits = parseCommitRecords(stdout);

      // Ensure hotspot cache is usable: cold start awaits once so the first
      // listCommits returns meaningful scores; warm cache uses fire-and-forget refresh.
      const cached = _hotspotCache.get(repo.id);
      if (!cached) {
        try {
          await refreshHotspotCache(repo);
        } catch {
          // Hotspot refresh failures fall back to score 0 — never block the list.
        }
      } else if (Date.now() - cached.ts > HOTSPOT_CACHE_TTL_MS) {
        refreshHotspotCache(repo).catch(() => {});
      }

      const hotspotFiles = _hotspotCache.get(repo.id)?.files ?? new Map();
      const scored = commits.map((commit) => {
        const riskScore = scoreDiff(commit.fileDiffs ?? [], hotspotFiles);
        const coarseKind = computeCoarseKind(commit.fileDiffs ?? [], commit.added, commit.deleted);
        const { fileDiffs: _fd, ...rest } = commit;
        return { ...rest, riskScore, coarseKind };
      });

      return { status: 200, body: scored };
    },

    async getCommit(repo, hash) {
      if (!isValidObjectId(hash)) {
        return { status: 400, body: { error: "Invalid commit hash" } };
      }
      const commitObject = await validateCommitObject(repo, hash, config.gitTimeoutMs);
      if (!commitObject.ok) {
        return commitObject.result;
      }

      const [metadata, numstat, nameStatus] = await Promise.all([
        runGit(
          repo,
          commitMetadataShowArgs(hash),
          { timeoutMs: config.gitTimeoutMs },
        ),
        runGit(
          repo,
          commitNumstatShowArgs(hash),
          { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
        ),
        runGit(
          repo,
          commitNameStatusShowArgs(hash),
          { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
        ),
      ]);
      const [fullHash, parents, author, authorEmail, authorDate, subject, body, refs, signatureCode] =
        metadata.stdout.split(COMMIT_FIELD_SEPARATOR);

      // Derive structuralKind for each file from numstat (added/deleted only).
      // This is a heuristic approximation; patch-text-based classification in
      // getDiff provides higher accuracy for the diff viewer.
      const rawFiles = parseChangedFiles(numstat.stdout, nameStatus.stdout);
      const filesWithKind = rawFiles.map((f) => {
        const { kind } = classifyFileDiff({ added: f.added, deleted: f.deleted });
        return { ...f, structuralKind: kind };
      });

      return {
        status: 200,
        body: {
          hash: fullHash,
          parents: splitParents(parents),
          subject,
          body: body?.trim() ?? "",
          author: { name: author, email: authorEmail },
          authorDate,
          refs: parseRefs(refs),
          signed: isSignedSignatureCode(signatureCode),
          signatureStatus: parseSignatureStatus(signatureCode),
          files: filesWithKind,
        },
      };
    },

    async getDiff(repo, hash) {
      if (!isValidObjectId(hash)) {
        return { status: 400, body: { error: "Invalid commit hash" } };
      }
      const commitObject = await validateCommitObject(repo, hash, config.gitTimeoutMs);
      if (!commitObject.ok) {
        return commitObject.result;
      }

      const { stdout } = await runGit(
        repo,
        commitDiffShowArgs(hash),
        { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
      );

      return {
        status: 200,
        body: {
          hash,
          diff: stdout,
          maxBytes: config.diffMaxBytes,
        },
      };
    },

    /**
     * Compute risk score for a specific commit by hash.
     * Used by GET /api/repos/:id/commits/:sha/risk (future UI integration).
     *
     * @param {{ id: string; name: string; path: string }} repo
     * @param {string} hash — 40-char OID (pre-validated by http.js)
     * @returns {Promise<{ status: number; body: object }>}
     */
    async getCommitRisk(repo, hash) {
      if (!isValidObjectId(hash)) {
        return { status: 400, body: { error: "Invalid commit hash" } };
      }
      const commitObject = await validateCommitObject(repo, hash, config.gitTimeoutMs);
      if (!commitObject.ok) {
        return commitObject.result;
      }

      const { stdout: numstatOut } = await runGit(
        repo,
        commitNumstatShowArgs(hash),
        { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
      );

      const fileDiffs = numstatOut
        .split("\n")
        .map((line) => {
          const parts = line.trimEnd().split("\t");
          if (parts.length < 3) return null;
          const filePath = normalizeNumstatPath(parts.at(-1));
          // Binary files are represented as "-" in numstat output.
          // Signal binary with -1 so scoreDiff can apply the binary penalty.
          const isBinaryLine = parts[0] === "-" || parts[1] === "-";
          return {
            path: filePath,
            added: isBinaryLine ? -1 : parseStatCount(parts[0]),
            deleted: isBinaryLine ? -1 : parseStatCount(parts[1]),
          };
        })
        .filter(Boolean);

      // Ensure hotspot cache is populated (best-effort)
      if (!_hotspotCache.has(repo.id)) {
        try {
          await refreshHotspotCache(repo);
        } catch {
          // Fall back to empty cache — score degrades gracefully to 0
        }
      }

      const hotspotFiles = _hotspotCache.get(repo.id)?.files ?? new Map();
      const riskScore = scoreDiff(fileDiffs, hotspotFiles);

      // Breakdown: top files by individual contribution
      const breakdown = fileDiffs.map((f) => {
        const churn = hotspotFiles.get(f.path)?.churn ?? 0;
        const weight = churn > 0 ? Math.log2(churn + 1) : 0;
        const contribution = Math.round(weight * ((f.added ?? 0) + (f.deleted ?? 0)));
        return { path: f.path, churn, contribution };
      }).sort((a, b) => b.contribution - a.contribution).slice(0, 10);

      return {
        status: 200,
        body: { hash, riskScore, breakdown },
      };
    },

    /**
     * List public refs whose history reaches the given commit (reachability).
     * Powers the DetailPanel "Contained in" section so users can answer
     * "is this fix in release/* yet?" without dropping to the CLI.
     *
     * Returns refs sorted newest-first by committer date so tags surface in
     * release order. UI is responsible for any further grouping (e.g.
     * branches vs tags). Empty array is a valid response — the commit may
     * exist but not yet be reachable from any public ref (e.g. a fresh local
     * commit before push).
     */
    async getCommitContainingRefs(repo, hash) {
      if (!isValidObjectId(hash)) {
        return { status: 400, body: { error: "Invalid commit hash" } };
      }
      const commitObject = await validateCommitObject(repo, hash, config.gitTimeoutMs);
      if (!commitObject.ok) {
        return commitObject.result;
      }

      const { stdout } = await runGit(
        repo,
        [
          "for-each-ref",
          "--format=%(refname)%00%(objectname)%00%(*objectname)%00%(committerdate:iso-strict)",
          "--sort=-committerdate",
          `--contains=${hash}`,
          "refs/heads",
          "refs/tags",
          "refs/remotes",
        ],
        { timeoutMs: config.gitTimeoutMs },
      );

      const refs = stdout
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [name, objectHash, peeledHash, updatedAt] = line.split(COMMIT_FIELD_SEPARATOR);
          return {
            name,
            shortName: shortRefName(name),
            hash: peeledHash || objectHash,
            type: refType(name),
            updatedAt: updatedAt || null,
          };
        });

      return { status: 200, body: { refs } };
    },

    async summarizeCommits(repo, query) {
      const queryValues = readSummaryQuery(query);
      if (!queryValues.ok) {
        return { status: 400, body: { error: queryValues.error } };
      }

      const { ref, since, until, groupBy } = queryValues.value;
      if (!isValidGitRef(ref)) {
        return { status: 400, body: { error: "Invalid ref parameter" } };
      }
      const commitishRef = await resolveCommitishRevision(repo, ref, config.gitTimeoutMs);
      if (!commitishRef.ok) {
        return commitishRef.result;
      }

      const { stdout } = await runGit(
        repo,
        commitSummaryLogArgs({
          since,
          until,
          revision: commitishRef.hash,
          maxCount: SUMMARY_READ_LIMIT,
        }),
        { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
      );

      const parsedRecords = parseSummaryRecords(stdout);
      const truncated = parsedRecords.length > SUMMARY_COMMIT_HARD_CAP;
      const records = truncated
        ? parsedRecords.slice(0, SUMMARY_COMMIT_HARD_CAP)
        : parsedRecords;

      const observed = aggregateObservedTotals(records);
      const groups = groupSummaryRecords(records, groupBy);
      const uncategorized =
        groupBy === "prefix" ? buildUncategorizedBucket(records) : null;

      return {
        status: 200,
        body: {
          period: { since: since ?? null, until: until ?? null, tz: "UTC" },
          ref: { input: ref, resolved: commitishRef.hash },
          observed,
          groups,
          uncategorized,
          truncated,
        },
      };
    },

    async getFileHistory(repo, query) {
      const queryValues = readFileHistoryQuery(query);
      if (!queryValues.ok) {
        return { status: 400, body: { error: queryValues.error } };
      }
      const { ref, limit, path: pathValue } = queryValues.value;
      if (!isValidGitRef(ref)) {
        return { status: 400, body: { error: "Invalid ref parameter" } };
      }

      const commitishRef = await resolveCommitishRevision(repo, ref, config.gitTimeoutMs);
      if (!commitishRef.ok) {
        return commitishRef.result;
      }

      // Read `limit + 1` so a 21-record response triggers `truncated: true`
      // without exposing the extra commit to the caller. The patches stay raw
      // — UI parses them with the same `parseUnifiedDiff` used elsewhere.
      const readLimit = limit + 1;
      const { stdout } = await runGit(
        repo,
        fileHistoryLogArgs({
          revision: commitishRef.hash,
          pathspec: formatLiteralPathspec(pathValue),
          maxCount: readLimit,
        }),
        { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
      );

      const parsed = parseFileHistoryRecords(stdout);
      const truncated = parsed.length > limit;
      const entries = (truncated ? parsed.slice(0, limit) : parsed).map((entry) => ({
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        parents: entry.parents,
        author: entry.author,
        authorEmail: entry.authorEmail,
        authorDate: entry.authorDate,
        subject: entry.subject,
        // Raw patch as observed from `git log --patch`. Keep verbatim — the UI
        // feeds it into `parseUnifiedDiff` exactly as it does for the per-commit
        // diff endpoint. We never reinterpret rename similarity here; Git's
        // `R<NN>` marker stays inside the patch text.
        patch: entry.patch,
      }));

      return {
        status: 200,
        body: {
          path: pathValue,
          ref: { input: ref, resolved: commitishRef.hash },
          entries,
          truncated,
          limit,
        },
      };
    },

    async getRelatedFiles(repo, query) {
      const queryValues = readRelatedFilesQuery(query);
      if (!queryValues.ok) {
        return { status: 400, body: { error: queryValues.error } };
      }
      const { ref, limit, path: pathValue } = queryValues.value;
      if (!isValidGitRef(ref)) {
        return { status: 400, body: { error: "Invalid ref parameter" } };
      }

      const commitishRef = await resolveCommitishRevision(repo, ref, config.gitTimeoutMs);
      if (!commitishRef.ok) {
        return commitishRef.result;
      }

      // Step 1: collect the commit hashes that touched the target path. We
      // read `limit + 1` so an over-cap response can flag `truncated: true`
      // without exposing the extra commit. `--follow` keeps the chain alive
      // across renames just as `getFileHistory` does — the same observation
      // surface, narrowed to commit identity (no patches needed here).
      const readLimit = limit + 1;
      const { stdout: hashesStdout } = await runGit(
        repo,
        relatedFilesHashLogArgs({
          revision: commitishRef.hash,
          pathspec: formatLiteralPathspec(pathValue),
          maxCount: readLimit,
        }),
        { timeoutMs: config.gitTimeoutMs },
      );

      const allHashes = hashesStdout
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^[A-Fa-f0-9]{40}$/.test(line));
      const truncated = allHashes.length > limit;
      const hashes = truncated ? allHashes.slice(0, limit) : allHashes;

      // Step 2: pull the changed file list for the bounded set of commits in
      // a single `git log --no-walk` call. `--no-walk` makes git print only
      // the commits we name, ignoring their parents — exactly the N-of-N
      // batched read we want, no fanout. With no commits to inspect we skip
      // the round-trip entirely.
      let related = [];
      let scannedCommits = 0;
      if (hashes.length > 0) {
        const { stdout: nameStdout } = await runGit(
          repo,
          relatedFilesNameLogArgs({ hashes }),
          { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
        );
        const parsed = parseRelatedFilesRecords(nameStdout, pathValue);
        scannedCommits = parsed.scannedCommits;
        related = parsed.related;
      }

      return {
        status: 200,
        body: {
          path: pathValue,
          ref: { input: ref, resolved: commitishRef.hash },
          scannedCommits,
          truncated,
          related,
        },
      };
    },

    async getRefDrift(repo, query) {
      const queryValues = readRefDriftQuery(query);
      if (!queryValues.ok) {
        return { status: 400, body: { error: queryValues.error } };
      }
      const { base, limit } = queryValues.value;

      const baseRevision = await resolveCommitishRevision(repo, base, config.gitTimeoutMs);
      if (!baseRevision.ok) {
        return baseRevision.result;
      }

      const allRefs = await listRefs(repo);
      // Drift only makes semantic sense for moving heads (branches) and the
      // shadows of remote heads. Tags are anchored to a fixed commit by
      // definition — ahead/behind against HEAD is a snapshot, not drift —
      // and surfacing it would dilute the signal Branch Drift Halo is meant
      // to carry. Filter is applied here, not in the UI, so the wire payload
      // already reflects the contract.
      const driftEligibleRefs = allRefs.filter(
        (ref) => ref.type === "branch" || ref.type === "remote",
      );

      // Read `limit + 1` so an over-cap fanout triggers `truncated: true`
      // without exposing the extra ref's drift to the caller. We slice before
      // dispatching git so we never spend the extra `2N+N` calls on a ref we
      // intend to drop.
      const truncated = driftEligibleRefs.length > limit;
      const refsToProcess = truncated
        ? driftEligibleRefs.slice(0, limit)
        : driftEligibleRefs;

      // Drift per ref runs in parallel; the outer Promise.all unions all
      // refs, and `computeRefDrift` itself runs ahead/behind/merge-base in
      // parallel internally. Total fanout is 3 * processedRefs git calls.
      const driftEntries = await Promise.all(
        refsToProcess.map((ref) =>
          computeRefDrift(repo, baseRevision.hash, ref, config.gitTimeoutMs),
        ),
      );

      return {
        status: 200,
        body: {
          base: { input: base, resolved: baseRevision.hash },
          refs: driftEntries,
          truncated,
          limit,
        },
      };
    },

    /**
     * GET /api/repos/:repoId/branches/grouped
     *
     * Returns all local branches whose short name starts with the given prefix,
     * augmented with ahead/behind counts (vs HEAD) and a derived rotScore.
     *
     * Observed values (from Git, no inference):
     *   - `ahead`          — git rev-list --count <base>..<branch>
     *   - `behind`         — git rev-list --count <branch>..<base>
     *   - `daysSinceLast`  — (now - committerdate) / 1 day (from for-each-ref)
     *
     * Derived value (Refscope only):
     *   rotScore = clamp(D/7, 0, 10) + clamp(B/5, 0, 10) + clamp(A/10, 0, 5)
     *   max 25 — "rot risk" only, not a definitive decay indicator.
     *
     * @param {{ id: string, name: string, path: string }} repo
     * @param {URLSearchParams} query
     */
    async getBranchGroupHealth(repo, query) {
      // Parse query parameters: prefix (required), base (optional, default HEAD)
      const prefixResult = parseBranchPrefixQuery(query.get("prefix"));
      if (!prefixResult.ok) {
        return { status: 400, body: { error: prefixResult.error } };
      }

      const baseResult = (() => {
        const raw = query.get("base") ?? "HEAD";
        if (!isValidGitRef(raw)) {
          return { ok: false, error: "Invalid base parameter" };
        }
        return { ok: true, value: raw };
      })();
      if (!baseResult.ok) {
        return { status: 400, body: { error: baseResult.error } };
      }
      const prefix = prefixResult.value;
      const base = baseResult.value;

      const baseRevision = await resolveCommitishRevision(repo, base, config.gitTimeoutMs);
      if (!baseRevision.ok) {
        return baseRevision.result;
      }

      // Fetch all local branches — type='branch' from for-each-ref refs/heads.
      // We use the existing listRefs helper which already encodes committerdate
      // in the updatedAt field. Filter by prefix after fetch; the wire payload
      // is already bounded by BRANCH_GROUP_MAX_BRANCHES.
      const allRefs = await listRefs(repo);
      const localBranches = allRefs.filter((ref) => ref.type === "branch");
      const matchingBranches = prefix
        ? localBranches.filter((ref) => ref.shortName.startsWith(prefix))
        : localBranches;

      if (matchingBranches.length > BRANCH_GROUP_MAX_BRANCHES) {
        return {
          status: 400,
          body: { error: `Too many branches: max ${BRANCH_GROUP_MAX_BRANCHES}` },
        };
      }

      const now = Date.now();

      // Compute drift + rotScore in parallel across matching branches.
      const branches = await Promise.all(
        matchingBranches.map(async (ref) => {
          const drift = await computeRefDrift(repo, baseRevision.hash, ref, config.gitTimeoutMs);
          const ahead = drift.ahead;
          const behind = drift.behind;
          const daysSinceLast = ref.updatedAt
            ? Math.max(0, Math.floor((now - Date.parse(ref.updatedAt)) / 86_400_000))
            : 0;

          // Derived rot score — proposal §5:
          // clamp(D/7, 0, 10) + clamp(B/5, 0, 10) + clamp(A/10, 0, 5) → max 25
          const rotScore =
            Math.min(10, Math.floor(daysSinceLast / 7)) +
            Math.min(10, Math.floor(behind / 5)) +
            Math.min(5, Math.floor(ahead / 10));

          return {
            name: ref.name,
            shortName: ref.shortName,
            hash: ref.hash,
            updatedAt: ref.updatedAt,
            ahead,
            behind,
            mergeBase: drift.mergeBase,
            daysSinceLast,
            rotScore,
          };
        }),
      );

      // Resolve HEAD so the UI can identify which entry in `branches` is the
      // currently checked-out branch. `git rev-parse --abbrev-ref HEAD`
      // returns the branch short name when HEAD points to a branch and the
      // literal "HEAD" string when HEAD is detached. We pair it with
      // `rev-parse --verify HEAD` to obtain the resolved hash, and surface
      // `head: null` on detached HEAD or on any runner failure.
      let head = null;
      try {
        const abbrev = await runGit(repo, ["rev-parse", "--abbrev-ref", "HEAD"], {
          timeoutMs: config.gitTimeoutMs,
        });
        const headName = abbrev.stdout.trim();
        if (headName && headName !== "HEAD") {
          const headHashResult = await runGit(repo, ["rev-parse", "--verify", "HEAD"], {
            timeoutMs: config.gitTimeoutMs,
          });
          const headHash = headHashResult.stdout.trim();
          if (headHash && /^[A-Fa-f0-9]{40}$/.test(headHash)) {
            head = { name: headName, hash: headHash };
          }
        }
      } catch {
        // Detached HEAD or rev-parse failure → leave `head` as null.
      }

      return {
        status: 200,
        body: {
          prefix: prefix ?? null,
          base: { input: base, resolved: baseRevision.hash },
          head,
          branches,
        },
      };
    },

    async getWorkTreeChanges(repo) {
      // Working tree changes: HEAD -> index ("staged"), index -> worktree
      // ("unstaged"), and untracked files (paths reported by
      // `ls-files --others --exclude-standard`). Each tracked side is sourced
      // literally from `git diff` — the staged side adds `--cached`. We fan
      // out the runs in parallel so numstat (summary aggregation), raw patch
      // (UI parses through `parseUnifiedDiff`), and the untracked listing
      // are all read concurrently.
      //
      // Boundary discipline:
      // - The patch text is preserved exactly as Git emits it. We never
      //   re-judge renames, never synthesize hunks, never normalize line
      //   endings.
      // - Untracked files are surfaced as paths only; line counts come from
      //   reading the file with a hard size cap so a forgotten huge artifact
      //   can't blow up the response. Binary or unreadable files report
      //   `added: 0`. We never alter the index or write to the repo.
      // - `truncated` mirrors `getDiff`: the runner emits GitCommandError on
      //   `diffMaxBytes` overflow, which bubbles to http.js as a 504. The
      //   field stays in the payload so the UI's contract stays uniform with
      //   other truncation-aware endpoints, but is always `false` on success.
      const [stagedNumstat, stagedPatch, unstagedNumstat, unstagedPatch, untrackedRaw] =
        await Promise.all([
          runGit(repo, workTreeNumstatArgs({ staged: true }), {
            timeoutMs: config.gitTimeoutMs,
            maxBytes: config.diffMaxBytes,
          }),
          runGit(repo, workTreePatchArgs({ staged: true }), {
            timeoutMs: config.gitTimeoutMs,
            maxBytes: config.diffMaxBytes,
          }),
          runGit(repo, workTreeNumstatArgs({ staged: false }), {
            timeoutMs: config.gitTimeoutMs,
            maxBytes: config.diffMaxBytes,
          }),
          runGit(repo, workTreePatchArgs({ staged: false }), {
            timeoutMs: config.gitTimeoutMs,
            maxBytes: config.diffMaxBytes,
          }),
          runGit(repo, workTreeUntrackedArgs(), {
            timeoutMs: config.gitTimeoutMs,
          }),
        ]);

      const untracked = describeUntrackedFiles(repo.path, untrackedRaw.stdout);
      const untrackedAdded = untracked.files.reduce((sum, file) => sum + file.added, 0);

      return {
        status: 200,
        body: {
          staged: {
            diff: stagedPatch.stdout,
            summary: parseNumstatSummary(stagedNumstat.stdout.split("\n")),
            // Mirrors `getDiff`: the runner throws on `diffMaxBytes`
            // overflow, so by the time we get here the diff was read in
            // full. We keep the field so the UI contract stays uniform with
            // other truncation-aware endpoints; flipping to `true` requires
            // a separate signaling mechanism that doesn't exist on the
            // current runner surface.
            truncated: false,
          },
          unstaged: {
            diff: unstagedPatch.stdout,
            summary: parseNumstatSummary(unstagedNumstat.stdout.split("\n")),
            truncated: false,
          },
          untracked: {
            files: untracked.files,
            // Synthesized unified diff: `git diff` won't see untracked paths,
            // and `--no-index` is rejected by the runner allowlist. We read
            // each file (capped by UNTRACKED_READ_BYTE_CAP, NUL-byte
            // heuristic for binary) and stitch a `--- /dev/null / +++ b/path`
            // patch so the UI's existing DiffViewer can render the new-file
            // contents alongside staged/unstaged tabs.
            diff: untracked.diff,
            summary: {
              fileCount: untracked.files.length,
              added: untrackedAdded,
              deleted: 0,
            },
          },
          snapshotAt: new Date().toISOString(),
          notes: {
            untrackedExcluded: false,
          },
        },
      };
    },

    /**
     * GET /api/repos/:repoId/range-history
     *
     * Returns the commit history for a line range within a file, using
     * `git log -L<lineStart>,<lineEnd>:<path>`. Each entry is the literal
     * commit metadata (hash, author, date, subject, body) as observed from Git.
     *
     * Boundary discipline:
     * - No LLM, no inference. commit messages are returned verbatim.
     * - patch output is discarded; only metadata is surfaced.
     * - URL/PR-like strings in the body are extracted as literal observed values
     *   from the commit text — Refscope never claims they are "related PRs".
     *
     * @param {{ id: string, name: string, path: string }} repo
     * @param {URLSearchParams} query
     */
    async getRangeHistory(repo, query) {
      // Validate query parameters.
      const lineStartResult = parseLineNumberQuery(query.get("lineStart"), "lineStart");
      if (!lineStartResult.ok) {
        return { status: 400, body: { error: lineStartResult.error } };
      }
      const lineEndResult = parseLineNumberQuery(query.get("lineEnd"), "lineEnd");
      if (!lineEndResult.ok) {
        return { status: 400, body: { error: lineEndResult.error } };
      }
      if (lineStartResult.value > lineEndResult.value) {
        return { status: 400, body: { error: "lineStart must be <= lineEnd" } };
      }

      const pathResult = parsePathQuery(query.get("path"));
      if (!pathResult.ok) {
        return { status: 400, body: { error: pathResult.error } };
      }
      const trimmedPath = pathResult.value.trim();
      if (!trimmedPath) {
        return { status: 400, body: { error: "Missing path parameter" } };
      }

      const rawRef = query.get("ref") ?? "HEAD";
      if (!isValidGitRef(rawRef)) {
        return { status: 400, body: { error: "Invalid ref parameter" } };
      }

      const limitResult = parseLimitQuery(
        query.get("limit"),
        RANGE_HISTORY_DEFAULT_LIMIT,
        RANGE_HISTORY_MAX_LIMIT,
      );
      if (!limitResult.ok) {
        return { status: 400, body: { error: limitResult.error } };
      }

      const commitishRef = await resolveCommitishRevision(repo, rawRef, config.gitTimeoutMs);
      if (!commitishRef.ok) {
        return commitishRef.result;
      }

      // Read `limit + 1` to detect truncation without exposing the extra commit.
      const readLimit = limitResult.value + 1;
      const lineStart = lineStartResult.value;
      const lineEnd = lineEndResult.value;

      // `git log -L<start>,<end>:<path>` traces the history of the given line
      // range. The `-L` argument is passed after `--format=...` so it is treated
      // as a `log` option argument, not a global option — the runner allowlist
      // checks only `args[0]` (the command name "log") which is already in the
      // allowlist.
      //
      // We use `--no-patch` to suppress the diff output entirely (metadata only),
      // keeping the response size bounded without depending on maxBytes truncation.
      // `--no-merges` reduces noise from merge commits that rarely touch line ranges.
      const { stdout } = await runGit(
        repo,
        rangeHistoryLogArgs({
          lineStart,
          lineEnd,
          path: trimmedPath,
          revision: commitishRef.hash,
          maxCount: readLimit,
        }),
        { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
      );

      const parsed = parseRangeHistoryRecords(stdout);
      const truncated = parsed.length > limitResult.value;
      const entries = (truncated ? parsed.slice(0, limitResult.value) : parsed).map((entry) => ({
        hash: entry.hash,
        shortHash: entry.hash.slice(0, 7),
        author: entry.author,
        authorDate: entry.authorDate,
        subject: entry.subject,
        body: entry.body,
        urlsInBody: extractUrlsFromBody(entry.body),
      }));

      return {
        status: 200,
        body: {
          path: trimmedPath,
          ref: { input: rawRef, resolved: commitishRef.hash },
          lineStart,
          lineEnd,
          entries,
          truncated,
          limit: limitResult.value,
        },
      };
    },

    /**
     * GET /api/repos/:repoId/symbols/history
     *
     * Returns the commit history for a named symbol (function/method) within a
     * file, using `git log -L :<funcname>:<path>`. Rename tracking is provided
     * by `--find-renames` applied to the diff output; renames are detected by
     * parsing the diff `--- a/<old>` / `+++ b/<new>` header pair.
     *
     * Note: `--follow` cannot be combined with `-L` in Git (git rejects it with
     * "fatal: --follow requires exactly one pathspec"). Instead, `--find-renames`
     * alone is used, which detects renames at each commit boundary.
     *
     * Boundary discipline:
     * - No LLM, no inference. commit messages returned verbatim.
     * - Diff hunks are discarded; only metadata + rename evidence is surfaced.
     * - funcname is validated by parseFuncNameQuery (allowlist: [A-Za-z0-9_:.~]).
     *
     * #TODO(agent): share parseRangeHistoryRecords helper once D-1 / D-4 have
     * settled — currently separate to avoid coupling surface during D-1 scope.
     *
     * @param {{ id: string, name: string, path: string }} repo
     * @param {URLSearchParams} query
     */
    async getSymbolHistory(repo, query) {
      // 1. Validate funcname (required, strict allowlist for injection prevention)
      const funcNameResult = parseFuncNameQuery(query.get("funcname"));
      if (!funcNameResult.ok) {
        return { status: 400, body: { error: funcNameResult.error } };
      }

      // 2. Validate path (required)
      const pathResult = parsePathQuery(query.get("path"));
      if (!pathResult.ok) {
        return { status: 400, body: { error: pathResult.error } };
      }
      const trimmedPath = pathResult.value.trim();
      if (!trimmedPath) {
        return { status: 400, body: { error: "Missing path parameter" } };
      }

      // 3. Validate ref (optional, default HEAD)
      const rawRef = query.get("ref") ?? "HEAD";
      if (!isValidGitRef(rawRef)) {
        return { status: 400, body: { error: "Invalid ref parameter" } };
      }

      // 4. Validate limit (optional, default 20, max 50)
      const limitResult = parseLimitQuery(
        query.get("limit"),
        SYMBOL_HISTORY_DEFAULT_LIMIT,
        SYMBOL_HISTORY_MAX_LIMIT,
      );
      if (!limitResult.ok) {
        return { status: 400, body: { error: limitResult.error } };
      }

      // 5. Resolve ref → commit OID
      const commitishRef = await resolveCommitishRevision(repo, rawRef, config.gitTimeoutMs);
      if (!commitishRef.ok) {
        return commitishRef.result;
      }

      // 6. Run git log -L :<funcname>:<path>
      // Read `limit + 1` to detect truncation without exposing the extra commit.
      const readLimit = limitResult.value + 1;
      const funcname = funcNameResult.value;

      let stdout;
      try {
        const result = await runGit(
          repo,
          symbolHistoryLogArgs({
            funcname,
            path: trimmedPath,
            revision: commitishRef.hash,
            maxCount: readLimit,
          }),
          { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
        );
        stdout = result.stdout;
      } catch (err) {
        // git log -L exits with code 128 when the symbol is not found in the
        // file (e.g. function name typo, unsupported language). Surface as a
        // structured 404-like response rather than a 502 so the UI can give
        // the user an actionable hint.
        if (err instanceof GitCommandError) {
          if (err.exitCode === 128) {
            return {
              status: 404,
              body: {
                error: "Symbol not found",
                funcname,
                path: trimmedPath,
                hint: "Check the symbol name spelling and verify the language is supported by Git's funcname regex.",
              },
            };
          }
        }
        throw err;
      }

      // 7. Parse the output — RS-separated records
      const rawEntries = parseSymbolHistoryRecords(stdout);
      const truncated = rawEntries.length > limitResult.value;
      const entries = (truncated ? rawEntries.slice(0, limitResult.value) : rawEntries).map(
        (entry) => ({
          hash: entry.hash,
          shortHash: entry.hash.slice(0, 7),
          author: entry.author,
          authorDate: entry.authorDate,
          subject: entry.subject,
          body: entry.body,
          renameInfo: entry.renameInfo,
        }),
      );

      return {
        status: 200,
        body: {
          funcname,
          path: trimmedPath,
          ref: { input: rawRef, resolved: commitishRef.hash },
          entries,
          truncated,
          limit: limitResult.value,
        },
      };
    },

    async compareRefs(repo, query) {
      const queryValues = readCompareQuery(query);
      if (!queryValues.ok) {
        return { status: 400, body: { error: queryValues.error } };
      }

      const { base, target } = queryValues.value;
      const [baseRevision, targetRevision] = await Promise.all([
        resolveCommitishRevision(repo, base, config.gitTimeoutMs),
        resolveCommitishRevision(repo, target, config.gitTimeoutMs),
      ]);
      if (!baseRevision.ok) {
        return baseRevision.result;
      }
      if (!targetRevision.ok) {
        return targetRevision.result;
      }

      const [ahead, behind, numstat, mergeBase] = await Promise.all([
        runGit(repo, compareRevListArgs(targetRevision.hash, baseRevision.hash), {
          timeoutMs: config.gitTimeoutMs,
        }),
        runGit(repo, compareRevListArgs(baseRevision.hash, targetRevision.hash), {
          timeoutMs: config.gitTimeoutMs,
        }),
        runGit(repo, compareNumstatArgs(baseRevision.hash, targetRevision.hash), {
          timeoutMs: config.gitTimeoutMs,
          maxBytes: config.diffMaxBytes,
        }),
        readMergeBase(repo, baseRevision.hash, targetRevision.hash, config.gitTimeoutMs),
      ]);
      const stats = parseNumstatSummary(numstat.stdout.split("\n"));

      return {
        status: 200,
        body: {
          base,
          target,
          mergeBase,
          ahead: parseCount(ahead.stdout),
          behind: parseCount(behind.stdout),
          files: stats.fileCount,
          added: stats.added,
          deleted: stats.deleted,
          commands: {
            log: `git log --oneline ${target} --not ${base}`,
            stat: `git diff --stat ${base} ${target}`,
            diff: `git diff ${base} ${target}`,
          },
        },
      };
    },

    /**
     * Cherry-pick equivalence detection for a base/target compare.
     *
     * Surfaces the SRE / release-engineer answer to "is this fix already on
     * the release branch?" — even when the cherry-pick produced a different
     * SHA. Internally runs `git cherry -v <target> <base>`, which tags each
     * base commit (in `base` but not in `target` by hash) with one of two
     * markers based on patch-id correlation:
     *
     *   `-` patch-id has an equivalent on target → cherry-picked already
     *   `+` patch-id is unique to base → still missing on target
     *
     * When `nearIdenticalThreshold` is supplied (or defaults to
     * `CHERRY_THRESHOLD_DEFAULT`), each equivalent entry is further graded:
     *
     *   `identical`      — the target-side equivalent commit adds/removes 0
     *                      lines compared to the base-side commit (same diff
     *                      content, same context). The most common case for
     *                      clean cherry-picks.
     *   `near-identical` — diff lines (added + deleted) ≤ threshold. Conflict
     *                      resolution added minor adjustments.
     *   `divergent`      — diff lines > threshold. The logic may have been
     *                      silently altered during the cherry-pick.
     *
     * Grade computation runs one `git diff T^..T` per graded equivalent entry
     * (sequential, single-user app). Entries beyond `CHERRY_GRADE_MAX_ENTRIES`
     * are returned with `grade: "ungraded"` to bound request cost.
     *
     * Target-side counterpart detection: `git log --left-right --cherry-mark`
     * emits `=`-prefixed lines for commits that are equivalent on both sides.
     * We collect base-side hashes from `git cherry` output, then cross-reference
     * against the `=` lines from `cherry-mark` to identify target-side hashes.
     * Subject is used as a secondary key when multiple equivalents share a
     * subject (unusual but possible), and index-based fallback guards against
     * subject collisions.
     *
     * This is intentionally a separate endpoint from `compareRefs` because
     * `git cherry` computes patch-ids and is more expensive than the
     * lightweight summary the comparison view loads first. Callers should
     * fetch this lazily (e.g. when the user opens a "cherry-pick status"
     * panel).
     */
    async getCompareCherry(repo, query) {
      const queryValues = readCompareQuery(query);
      if (!queryValues.ok) {
        return { status: 400, body: { error: queryValues.error } };
      }
      const { base, target } = queryValues.value;

      const thresholdQuery = parseNearIdenticalThresholdQuery(
        query.get("nearIdenticalThreshold"),
      );
      if (!thresholdQuery.ok) {
        return { status: 400, body: { error: thresholdQuery.error } };
      }
      const threshold = thresholdQuery.value ?? CHERRY_THRESHOLD_DEFAULT;

      const [baseRevision, targetRevision] = await Promise.all([
        resolveCommitishRevision(repo, base, config.gitTimeoutMs),
        resolveCommitishRevision(repo, target, config.gitTimeoutMs),
      ]);
      if (!baseRevision.ok) {
        return baseRevision.result;
      }
      if (!targetRevision.ok) {
        return targetRevision.result;
      }

      // `git cherry [-v] <upstream> <head>` — note positional order: the
      // upstream is the side we're checking *against*. Asking "is each
      // main commit already on release?" → upstream=release, head=main.
      const { stdout } = await runGit(
        repo,
        ["cherry", "-v", targetRevision.hash, baseRevision.hash],
        { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
      );

      const equivalent = [];
      const missing = [];
      for (const rawLine of stdout.split("\n")) {
        const line = rawLine.trimEnd();
        if (line.length < 2) continue;
        const marker = line[0];
        // Format: "<marker> <hash>[ <subject>]"
        const rest = line.slice(2);
        const spaceIdx = rest.indexOf(" ");
        const hash = spaceIdx === -1 ? rest : rest.slice(0, spaceIdx);
        const subject = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1);
        if (!isValidObjectId(hash)) continue;
        const entry = { hash, shortHash: hash.slice(0, 7), subject };
        if (marker === "-") {
          equivalent.push(entry);
        } else if (marker === "+") {
          missing.push(entry);
        }
      }

      // ── Graded equivalence (D-6) ────────────────────────────────────────────
      // If there are no equivalent entries, skip the extra git calls entirely.
      if (equivalent.length > 0) {
        // Build a Set of base-side hashes for quick lookup.
        const baseEquivHashes = new Set(equivalent.map((e) => e.hash));

        // `git log --left-right --cherry-mark` emits `=<hash>` for commits
        // that are equivalent on both sides of the symmetric diff. The `=`
        // marker appears for both the base-side and target-side commits; we
        // cross-reference with the known base hashes to identify target-side
        // counterparts. Output format: `=<40-hex> <subject>`.
        const { stdout: markStdout } = await runGit(
          repo,
          [
            "log",
            "--left-right",
            "--cherry-mark",
            "--no-show-signature",
            `--format=%m%H %s`,
            `${baseRevision.hash}...${targetRevision.hash}`,
          ],
          { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
        );

        // Collect all `=` lines, partitioned into base-side (known) and
        // target-side (unknown). Subjects may collide, so we track counts.
        /** @type {Map<string, string[]>} subject → [targetHash, ...] */
        const targetBySubject = new Map();
        for (const rawLine of markStdout.split("\n")) {
          const line = rawLine.trimEnd();
          if (line.length < 2 || line[0] !== "=") continue;
          const rest = line.slice(1);
          const spIdx = rest.indexOf(" ");
          const hash = spIdx === -1 ? rest : rest.slice(0, spIdx);
          const subj = spIdx === -1 ? "" : rest.slice(spIdx + 1);
          if (!isValidObjectId(hash)) continue;
          // If not a known base-side hash, it must be a target-side hash.
          if (!baseEquivHashes.has(hash)) {
            if (!targetBySubject.has(subj)) targetBySubject.set(subj, []);
            targetBySubject.get(subj).push(hash);
          }
        }

        // Map each equivalent base entry to its target-side counterpart.
        // Subject collisions are resolved by consumption order (FIFO), which
        // is the same traversal order git uses for both sides.
        /** @type {Map<string, string>} baseHash → targetHash */
        const targetHashForBase = new Map();
        // Track per-subject consumption index (reset per subject group).
        /** @type {Map<string, number>} subject → next index to consume */
        const subjectIdx = new Map();
        for (const entry of equivalent) {
          const candidates = targetBySubject.get(entry.subject) ?? [];
          const idx = subjectIdx.get(entry.subject) ?? 0;
          if (idx < candidates.length) {
            targetHashForBase.set(entry.hash, candidates[idx]);
            subjectIdx.set(entry.subject, idx + 1);
          }
        }

        // For each equivalent entry (up to CHERRY_GRADE_MAX_ENTRIES), grade
        // the cherry-pick fidelity.
        //
        // Strategy: compare the file-state of the base commit (`B`) against
        // the file-state of the target-side counterpart (`T`), but scoped
        // only to the paths that `B` actually touched. This correctly returns
        // an empty diff for a clean cherry-pick (same patch applied cleanly)
        // while surfacing divergence when conflict resolution altered the
        // logic on the target branch.
        //
        // Concretely:
        //   1. `git diff --name-only B^ B` → list of paths B touched.
        //   2. `git diff -U3 B T -- <paths>` → compare B vs T on those paths.
        //
        // Using `git diff B T` (not `T^..T`) avoids counting B's own changes
        // as divergence — a clean cherry-pick has identical file state for the
        // touched paths between B and T, so step 2 returns an empty diff.
        //
        // Entries beyond the cap receive grade "ungraded".
        const DIFF_MAX_BYTES_PER_ENTRY = Math.min(config.diffMaxBytes, 64 * 1024);
        for (let i = 0; i < equivalent.length; i++) {
          const entry = equivalent[i];
          const targetHash = targetHashForBase.get(entry.hash);
          if (!targetHash) {
            // Target-side counterpart not found — skip grading.
            entry.grade = "ungraded";
            continue;
          }
          if (i >= CHERRY_GRADE_MAX_ENTRIES) {
            entry.grade = "ungraded";
            continue;
          }
          try {
            // Step 1: resolve the paths touched by the base commit.
            const { stdout: nameOnlyOut } = await runGit(
              repo,
              [
                "diff",
                "--name-only",
                "--no-ext-diff",
                "--no-textconv",
                "--end-of-options",
                `${entry.hash}^`,
                entry.hash,
              ],
              { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
            );
            const touchedPaths = nameOnlyOut
              .split("\n")
              .map((l) => l.trim())
              .filter(Boolean);

            // Step 2: diff B vs T scoped to those paths. An empty diff means
            // the cherry-pick was applied cleanly (identical file state on the
            // touched paths). A non-empty diff reveals divergence.
            const diffArgs = [
              "diff",
              "--no-color",
              "--no-ext-diff",
              "--no-textconv",
              "-U3",
              "--end-of-options",
              entry.hash,
              targetHash,
              "--",
              ...touchedPaths,
            ];
            const { stdout: diffOut, truncated: diffTruncated } = await runGit(
              repo,
              diffArgs,
              { timeoutMs: config.gitTimeoutMs, maxBytes: DIFF_MAX_BYTES_PER_ENTRY },
            );
            // Count added/deleted lines from the diff output.
            let added = 0;
            let deleted = 0;
            for (const dline of diffOut.split("\n")) {
              if (dline.startsWith("+") && !dline.startsWith("+++")) added++;
              else if (dline.startsWith("-") && !dline.startsWith("---")) deleted++;
            }
            const linesDiff = added + deleted;
            /** @type {"identical"|"near-identical"|"divergent"} */
            const grade =
              linesDiff === 0
                ? "identical"
                : linesDiff <= threshold
                  ? "near-identical"
                  : "divergent";
            entry.grade = grade;
            entry.diffLines = { added, deleted };
            if (grade !== "identical") {
              entry.diffHunks = diffTruncated
                ? diffOut + "\n[truncated]"
                : diffOut;
              entry.truncated = diffTruncated ?? false;
            }
          } catch {
            // Diff failed (e.g. merge commit with no single parent) — mark
            // as ungraded rather than failing the whole request.
            entry.grade = "ungraded";
          }
        }
      }

      return {
        status: 200,
        body: { base, target, equivalent, missing, threshold },
      };
    },

    /**
     * Compute file hotspot data for a given ref: LOC + bytes (from `git show`)
     * and churn / lastChangedAt (from `git log --name-only`).
     *
     * Returns `{ status, body }` where body is a `HotspotResponse`-shaped object.
     *
     * @param {{ id: string, path: string }} repo
     * @param {{ ref?: string, limit?: number, commitCap?: number, since?: string | null }} query
     */
    async getFileHotspot(repo, query) {
      const { ref: refInput, limit, commitCap, since: sinceISO } = query;
      const refLabel = refInput ?? "HEAD";

      // Hotspot Lens has a dedicated per-request timeout cap (config.hotspotTimeoutMs,
      // default 20 s) to give large repos enough headroom.  Tests that need to exercise
      // the timeout/truncated path inject a tiny config.gitTimeoutMs — we honour
      // whichever of the two is smaller so test overrides still take effect.
      const hotspotTimeoutMs = Math.min(
        config.hotspotTimeoutMs ?? HOTSPOT_GIT_TIMEOUT_MS,
        config.gitTimeoutMs,
      );
      // maxBytes cap: use config override when supplied (tests inject small values
      // to trigger the truncated path), otherwise use the module constant.
      const hotspotMaxBytes = config.hotspotMaxBytes ?? HOTSPOT_MAX_BYTES;

      // ── Step 1: resolve ref to commit OID ──────────────────────────────────
      const commitishRef = await resolveCommitishRevision(repo, refLabel, hotspotTimeoutMs);
      if (!commitishRef.ok) {
        return commitishRef.result;
      }
      const resolvedOid = commitishRef.hash;

      // ── Step 2: collect file paths via git log --name-only ─────────────────
      // Allowlist does not include `ls-tree`, so we derive the file set from
      // the name-only log output (spec Q-1 resolution: no allowlist change).
      // -z uses NUL as the record separator so non-ASCII paths are preserved
      // verbatim (without -z, git may mangle or drop paths containing non-ASCII
      // characters on some platforms).  \x1f (ASCII unit separator) delimits the
      // header fields within each record; \x00 (NUL) is reserved for -z.
      const logArgs = [
        "-z",
        "--no-show-signature",
        "--name-only",
        "--format=%H%x1f%aI%x1f%aE",
        `--max-count=${commitCap}`,
        ...(sinceISO ? [`--since=${sinceISO}`] : []),
        "--end-of-options",
        resolvedOid,
        "--",
      ];

      let logStdout;
      try {
        const result = await runGit(repo, ["log", ...logArgs], {
          timeoutMs: hotspotTimeoutMs,
          maxBytes: hotspotMaxBytes,
        });
        logStdout = result.stdout;
      } catch (err) {
        if (err instanceof GitCommandError) {
          if (err.timedOut) {
            return {
              status: 504,
              body: { error: "timeout", truncated: true, truncationReason: "timeout" },
            };
          }
          if (err.truncated) {
            return {
              status: 504,
              body: { error: "timeout", truncated: true, truncationReason: "maxBytes" },
            };
          }
        }
        throw err;
      }

      // ── Step 3: parse log output ────────────────────────────────────────────
      // With -z, git log uses NUL (\x00) as the record separator between
      // fields within each entry.  The format is:
      //
      //   <header>\x00<path1>\x00<path2>\x00...<pathN>\x00<header>\x00...
      //
      // where <header> = %H\x1f%aI\x1f%aE  (fields within the header are
      // separated by \x1f, ASCII unit separator, to avoid collision with \x00).
      //
      // Records containing \x1f are commit headers; all others are file paths.
      // Path values must NOT be trimmed — non-ASCII filenames may contain
      // leading/trailing whitespace-like bytes on unusual filesystems.
      /** @type {Map<string, { churn: number; lastChangedAt: string }>} */
      const fileStats = new Map();
      let commitsAnalyzed = 0;
      let currentAuthorDate = "";
      /** @type {Set<string> | null} */
      let currentCommitPaths = null;

      for (let raw of logStdout.split("\x00")) {
        // git log -z emits a newline immediately after the NUL that follows
        // each header record (before the first path of that commit).  Strip
        // a single leading \n so paths are matched correctly.  This leading \n
        // is part of git's record-separator protocol — it is not part of the
        // actual file path.
        const record = raw.startsWith("\n") ? raw.slice(1) : raw;
        if (!record) continue; // empty record between NULs or trailing NUL
        if (record.includes("\x1f")) {
          // Header record: %H\x1f%aI\x1f%aE
          // A new header starts a new commit; reset the per-commit path set so
          // the same path touched twice in one commit only counts once.
          const parts = record.split("\x1f");
          currentAuthorDate = parts[1] ?? "";
          currentCommitPaths = new Set();
          commitsAnalyzed += 1;
        } else {
          // Path record — do not trim beyond the leading \n already removed,
          // so non-ASCII filenames with significant whitespace are preserved.
          if (currentCommitPaths !== null && !currentCommitPaths.has(record)) {
            currentCommitPaths.add(record);
            const existing = fileStats.get(record);
            if (existing) {
              existing.churn += 1;
              // keep the most-recent date (log is newest-first)
              if (!existing.lastChangedAt) existing.lastChangedAt = currentAuthorDate;
            } else {
              fileStats.set(record, { churn: 1, lastChangedAt: currentAuthorDate });
            }
          }
        }
      }

      const allPaths = [...fileStats.keys()];

      // ── Step 4: per-file lines + bytes via git show <oid>:<path> ───────────
      // Chunk to os.cpus().length / 2 concurrency to avoid saturating the
      // event loop on large repositories.
      const concurrency = Math.max(1, Math.floor(os.cpus().length / 2));

      /**
       * @param {string} filePath
       * @returns {Promise<{ lines: number, bytes: number }>}
       */
      async function fetchFileStat(filePath) {
        try {
          const { stdout } = await runGit(
            repo,
            ["show", "--no-show-signature", "--end-of-options", `${resolvedOid}:${filePath}`],
            { timeoutMs: hotspotTimeoutMs, maxBytes: hotspotMaxBytes },
          );
          // Split on \n; trailing newline produces an empty final element —
          // subtract it for an accurate line count.
          const rawLines = stdout.split("\n");
          const lines = rawLines.length > 0 && rawLines[rawLines.length - 1] === ""
            ? rawLines.length - 1
            : rawLines.length;
          return { lines };
        } catch (err) {
          if (err instanceof GitCommandError) {
            // Per-file timeouts indicate a single large blob (rare); surface to
            // the outer 504 handler so the caller knows the budget is exhausted.
            if (err.timedOut) throw err;
            // Per-file maxBytes truncation: omit this single path. A huge blob
            // (bundled assets, lockfiles) shouldn't fail the entire hotspot.
            if (err.truncated) return null;
            // exit 128 = file is deleted at this ref, binary blob, or path
            // does not exist. Return null so the caller omits this path.
            if (err.exitCode === 128) return null;
          }
          throw err;
        }
      }

      /** @type {Map<string, { lines: number } | null>} */
      const sizeMap = new Map();

      for (let i = 0; i < allPaths.length; i += concurrency) {
        const chunk = allPaths.slice(i, i + concurrency);
        const results = await Promise.all(chunk.map(fetchFileStat));
        for (let j = 0; j < chunk.length; j++) {
          sizeMap.set(chunk[j], results[j]);
        }
      }

      // ── Step 5: compose and sort ────────────────────────────────────────────
      // Exclude paths where git show returned null (deleted/binary at this ref).
      const composed = allPaths.flatMap((p) => {
        const size = sizeMap.get(p);
        if (size === null || size === undefined) {
          // Deleted or unreadable at this ref — omit from response.
          return [];
        }
        const stat = fileStats.get(p);
        return [{
          path: p,
          lines: size.lines,
          churn: stat?.churn ?? 0,
          lastChangedAt: stat?.lastChangedAt ?? "",
          authors: 0, // Phase 1: always 0
        }];
      });

      composed.sort((a, b) => b.lines - a.lines || b.churn - a.churn || a.path.localeCompare(b.path));

      const truncatedByLimit = composed.length > limit;

      // ── Step 5b: probe whether commitCap was a binding constraint ─────────
      // Probe actual reachable commit count using rev-list --count with
      // --max-count=(commitCap+1) so we only need to traverse one extra commit.
      // This is a tiny, fast call (maxBytes=64, short timeout) and runs only
      // when log returned exactly commitCap records (likely overflow).
      let truncatedByCommitCap = false;
      if (commitsAnalyzed >= commitCap) {
        try {
          const probeArgs = [
            "--count",
            `--max-count=${commitCap + 1}`,
            ...(sinceISO ? [`--since=${sinceISO}`] : []),
            "--end-of-options",
            resolvedOid,
            "--",
          ];
          const { stdout: countOut } = await runGit(repo, ["rev-list", ...probeArgs], {
            timeoutMs: Math.min(hotspotTimeoutMs, 5_000),
            maxBytes: 64,
          });
          const revCount = Number(countOut.trim());
          truncatedByCommitCap = Number.isInteger(revCount) && revCount > commitCap;
        } catch {
          // If the probe fails (timeout, error), assume the cap was binding to be
          // conservative — better to over-report truncation than to miss it.
          truncatedByCommitCap = true;
        }
      }

      // `limit` truncation takes priority when both apply (spec AC-LIMIT-2).
      let truncated = truncatedByLimit || truncatedByCommitCap;
      let truncationReason;
      if (truncatedByLimit) {
        truncationReason = "limit";
      } else if (truncatedByCommitCap) {
        truncationReason = "commitCap";
      }

      const files = truncatedByLimit ? composed.slice(0, limit) : composed;

      return {
        status: 200,
        body: {
          repoId: repo.id,
          ref: resolvedOid,
          refLabel,
          scope: {
            commitsAnalyzed,
            commitCap,
            ...(sinceISO ? { sinceISO } : {}),
          },
          files,
          truncated,
          ...(truncationReason ? { truncationReason } : {}),
        },
      };
    },
  };
}

export async function resolveCommitishRevision(repo, revision, timeoutMs) {
  try {
    const { stdout } = await runGit(repo, commitishRevParseArgs(revision), {
      timeoutMs,
      maxBytes: 128,
    });
    return { ok: true, hash: stdout.trim() };
  } catch (error) {
    if (error instanceof GitCommandError) {
      return {
        ok: false,
        result: { status: 404, body: { error: "Ref not found or not a commit" } },
      };
    }
    throw error;
  }
}

async function validateCommitObject(repo, hash, timeoutMs) {
  try {
    const { stdout } = await runGit(repo, commitObjectTypeArgs(hash), {
      timeoutMs,
      maxBytes: 128,
    });
    if (stdout.trim() !== "commit") {
      return {
        ok: false,
        result: { status: 400, body: { error: "Hash does not identify a commit" } },
      };
    }
    return { ok: true };
  } catch (error) {
    if (error instanceof GitCommandError) {
      return { ok: false, result: { status: 404, body: { error: "Commit not found" } } };
    }
    throw error;
  }
}

async function readMergeBase(repo, base, target, timeoutMs) {
  try {
    const { stdout } = await runGit(repo, compareMergeBaseArgs(base, target), { timeoutMs });
    return stdout.trim() || null;
  } catch (error) {
    if (error instanceof GitCommandError && error.exitCode === 1) {
      return null;
    }
    throw error;
  }
}

function readCommitListQuery(query) {
  const values = {};
  for (const name of ["limit", "ref", "search", "author", "path", "mode", "pattern"]) {
    const allValues = query.getAll(name);
    if (allValues.length > 1) {
      return { ok: false, error: `Duplicate ${name} parameter` };
    }
    values[name] = allValues[0] ?? "";
  }
  return { ok: true, value: values };
}

function readCompareQuery(query) {
  const values = {};
  for (const name of ["base", "target"]) {
    const allValues = query.getAll(name);
    if (allValues.length > 1) {
      return { ok: false, error: `Duplicate ${name} parameter` };
    }
    const value = allValues[0] ?? "";
    if (!isValidCompareRevision(value)) {
      return { ok: false, error: `Invalid ${name} parameter` };
    }
    values[name] = value;
  }
  return { ok: true, value: values };
}

function isValidCompareRevision(value) {
  return isValidObjectId(value) || isValidGitRef(value);
}

export function compareRevListArgs(fromRevision, notRevision) {
  return ["rev-list", "--count", "--not", notRevision, "--not", "--end-of-options", fromRevision];
}

export function commitRangeLogArgs(fromRevision, toRevision) {
  return ["--not", fromRevision, "--not", "--end-of-options", toRevision];
}

export function commitListLogArgs(limit, searchArgs, authorArgs, revision, pathArgs) {
  return [
    "log",
    `--max-count=${limit}`,
    "--date=iso-strict",
    ...searchArgs,
    ...authorArgs,
    `--format=${COMMIT_RECORD_SEPARATOR}%H%x00%P%x00%an%x00%aI%x00%s%x00%D`,
    "--no-show-signature",
    "--numstat",
    "--no-ext-diff",
    "--no-textconv",
    "--end-of-options",
    revision,
    "--",
    ...pathArgs,
  ];
}

export function commitishRevParseArgs(revision) {
  return ["rev-parse", "--verify", "--quiet", "--end-of-options", `${revision}^{commit}`];
}

export function compareNumstatArgs(base, target) {
  return [
    "diff",
    "--numstat",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--end-of-options",
    base,
    target,
    "--",
  ];
}

export function compareMergeBaseArgs(base, target) {
  return ["merge-base", "--end-of-options", base, target];
}

export function ancestorMergeBaseArgs(oldHash, newHash) {
  return ["merge-base", "--is-ancestor", "--end-of-options", oldHash, newHash];
}

export function commitObjectTypeArgs(hash) {
  return ["cat-file", "-t", "--end-of-options", hash];
}

export function commitMetadataShowArgs(hash) {
  return [
    "show",
    "-s",
    "--date=iso-strict",
    "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D",
    "--no-show-signature",
    "--end-of-options",
    hash,
  ];
}

export function commitNumstatShowArgs(hash) {
  return [
    "show",
    "--format=",
    "--no-show-signature",
    "--numstat",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--end-of-options",
    hash,
    "--",
  ];
}

export function commitNameStatusShowArgs(hash) {
  return [
    "show",
    "--format=",
    "--no-show-signature",
    "--name-status",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--end-of-options",
    hash,
    "--",
  ];
}

export function commitDiffShowArgs(hash) {
  return [
    "show",
    "--format=",
    "--no-show-signature",
    "--no-ext-diff",
    "--no-textconv",
    "--patch",
    "--find-renames",
    "--stat",
    "--no-color",
    "--end-of-options",
    hash,
  ];
}

/**
 * Build `git diff` arguments for the working-tree numstat side. `staged: true`
 * uses `--cached` (HEAD vs index); `staged: false` uses index vs worktree.
 * `--no-renames` keeps the numstat lane straightforward — rename detection
 * lives in the patch lane, where `parseUnifiedDiff` can surface Git's R<NN>
 * marker verbatim. Mirrors the hardening applied elsewhere: no ext-diff, no
 * textconv, no color, option parsing terminated even though no revision
 * follows.
 *
 * @param {{ staged: boolean }} args
 */
export function workTreeNumstatArgs({ staged }) {
  const cached = staged ? ["--cached"] : [];
  return [
    "diff",
    ...cached,
    "--numstat",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--end-of-options",
  ];
}

/**
 * Build `git diff` arguments for the working-tree patch side. `--find-renames`
 * is enabled here so the UI can show Git's literal rename similarity marker.
 * Mirrors `commitDiffShowArgs` hardening (no signature verification — `git
 * diff` doesn't have one, but the flags `--no-ext-diff` / `--no-textconv` /
 * `--no-color` keep the output stable across user gitconfig).
 *
 * @param {{ staged: boolean }} args
 */
export function workTreePatchArgs({ staged }) {
  const cached = staged ? ["--cached"] : [];
  return [
    "diff",
    ...cached,
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "--patch",
    "--find-renames",
    "--end-of-options",
  ];
}

/**
 * `git ls-files --others --exclude-standard -z` lists untracked paths that
 * are not gitignored. `-z` is mandatory: filenames may contain newlines and
 * the only safe separator is NUL. The runner's argument-array `spawn`
 * already prevents shell interpretation; this just keeps the parser
 * unambiguous.
 */
export function workTreeUntrackedArgs() {
  return ["ls-files", "--others", "--exclude-standard", "-z"];
}

// Hard cap for reading an untracked file to count its line additions. 1 MiB
// covers ordinary source files; anything larger is reported with `added: 0`
// to keep the worktree response bounded.
const UNTRACKED_READ_BYTE_CAP = 1_048_576;

/**
 * Resolve the untracked listing (NUL-separated stdout) into:
 *   - `files`: `[{ path, status: "A", added, deleted: 0 }]` records (line
 *     count matches `git diff --numstat` for new files).
 *   - `diff`: a synthesized unified-diff payload covering every untracked
 *     path so the UI can render their contents in the same DiffViewer used
 *     for staged/unstaged sides. `--no-index` is rejected by the runner
 *     allowlist, so we cannot ask Git to produce this; we stitch it from
 *     direct file reads instead.
 *
 * Files that fail to read, exceed `UNTRACKED_READ_BYTE_CAP`, or contain a
 * NUL byte (binary heuristic) report `added: 0` and emit a `Binary files …
 * differ` marker in place of a hunk — same shape Git would produce.
 */
function describeUntrackedFiles(repoPath, stdout) {
  if (!stdout) return { files: [], diff: "" };
  const files = [];
  let diff = "";
  for (const rel of stdout.split("\u0000")) {
    if (!rel) continue;
    const { added, patch } = readUntrackedEntry(repoPath, rel);
    files.push({ path: rel, status: "A", added, deleted: 0 });
    diff += patch;
  }
  return { files, diff };
}

function readUntrackedEntry(repoPath, relPath) {
  const fullPath = path.join(repoPath, relPath);
  const headers = `diff --git a/${relPath} b/${relPath}\nnew file mode 100644\n`;
  const headersOnly = `${headers}--- /dev/null\n+++ b/${relPath}\n`;
  const binaryPatch = `${headersOnly}Binary files /dev/null and b/${relPath} differ\n`;

  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return { added: 0, patch: binaryPatch };
  }
  if (!stat.isFile()) {
    // Symlinks, sockets, etc. — surface the headers so the file still
    // appears in the listing, but emit no hunk.
    return { added: 0, patch: headersOnly };
  }
  if (stat.size === 0) {
    return { added: 0, patch: headersOnly };
  }
  if (stat.size > UNTRACKED_READ_BYTE_CAP) {
    return { added: 0, patch: binaryPatch };
  }
  let buf;
  try {
    buf = fs.readFileSync(fullPath);
  } catch {
    return { added: 0, patch: binaryPatch };
  }
  // Cheap binary heuristic: bail if the file contains a NUL byte. Avoids
  // spending a line count on lockfile blobs, images that slipped through, etc.
  if (buf.includes(0)) {
    return { added: 0, patch: binaryPatch };
  }
  // Text path. Count lines and stitch the `+`-prefixed body in one pass.
  const text = buf.toString("utf8");
  const endsWithNewline = text.endsWith("\n");
  const body = endsWithNewline ? text.slice(0, -1) : text;
  const lines = body.length === 0 ? [] : body.split("\n");
  const added = lines.length;
  if (added === 0) {
    return { added: 0, patch: headersOnly };
  }
  let hunk = `--- /dev/null\n+++ b/${relPath}\n@@ -0,0 +1,${added} @@\n`;
  for (const line of lines) {
    hunk += `+${line}\n`;
  }
  if (!endsWithNewline) {
    hunk += "\\ No newline at end of file\n";
  }
  return { added, patch: headers + hunk };
}

export function compareRefSnapshots(previousSnapshot, currentSnapshot) {
  const changes = [];

  for (const [name, ref] of currentSnapshot) {
    const previous = previousSnapshot.get(name);
    if (!previous) {
      changes.push({ type: "ref_created", ref });
      continue;
    }
    if (previous.hash !== ref.hash) {
      changes.push({
        type: "ref_updated",
        ref,
        previousHash: previous.hash,
      });
    }
  }

  for (const [name, ref] of previousSnapshot) {
    if (!currentSnapshot.has(name)) {
      changes.push({ type: "ref_deleted", ref });
    }
  }

  return changes;
}

function parseCommitRecords(stdout) {
  return stdout
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const lines = record.split("\n").filter(Boolean);
      const metadata = lines[0] ?? "";
      const [hash, parents, author, authorDate, subject, refs, signatureCode] =
        metadata.split(COMMIT_FIELD_SEPARATOR);
      const numstatLines = lines.slice(1);
      const stats = parseNumstatSummary(numstatLines);
      // Parse per-file diffs for risk scoring (used by collectRefEvents).
      // parseNumstatLine returns added=0 for binary "-" lines, but scoreDiff
      // needs -1 to trigger the binary penalty, so we parse raw here.
      const fileDiffs = numstatLines.reduce((acc, line) => {
        const trimmed = line.trimEnd();
        if (!trimmed) return acc;
        const parts = trimmed.split("\t");
        if (parts.length < 3) return acc;
        const isBinaryLine = parts[0] === "-" || parts[1] === "-";
        const filePath = normalizeNumstatPath(parts.at(-1));
        if (!filePath) return acc;
        acc.push({
          path: filePath,
          added: isBinaryLine ? -1 : parseStatCount(parts[0]),
          deleted: isBinaryLine ? -1 : parseStatCount(parts[1]),
        });
        return acc;
      }, []);
      return {
        hash,
        shortHash: hash.slice(0, 7),
        parents: splitParents(parents),
        subject,
        author,
        authorDate,
        refs: parseRefs(refs),
        isMerge: splitParents(parents).length > 1,
        signed: isSignedSignatureCode(signatureCode),
        signatureStatus: parseSignatureStatus(signatureCode),
        added: stats.added,
        deleted: stats.deleted,
        fileCount: stats.fileCount,
        fileDiffs,
      };
    });
}

// ---------------------------------------------------------------------------
// Coarse-kind classifier for commit list (D-2)
// ---------------------------------------------------------------------------

/**
 * Compute a lightweight coarse structural kind for a commit based on numstat
 * totals. This is a DERIVATION (heuristic) — Refscope does NOT claim semantic
 * equivalence. It is intentionally less accurate than `classifyFileDiff` (D-5)
 * to keep the list endpoint fast.
 *
 * Rules (observation → derived label):
 *   - linesChanged === 0                          → 'empty'
 *   - symmetry ≥ 0.9 AND linesChanged ≤ 50       → 'likely_refactor'
 *   - otherwise                                   → 'likely_logic'
 *
 * 'symmetry' = 1 - |added - deleted| / max(added, deleted, 1)
 * 'linesChanged' = added + deleted
 *
 * @param {Array<{ added: number; deleted: number }>} fileDiffs
 * @param {number} totalAdded  — aggregate added (from numstat summary)
 * @param {number} totalDeleted — aggregate deleted (from numstat summary)
 * @returns {'empty' | 'likely_refactor' | 'likely_logic'}
 */
export function computeCoarseKind(fileDiffs, totalAdded, totalDeleted) {
  // Treat binary entries (added === -1) as logic change immediately.
  const hasBinary = fileDiffs.some((f) => f.added === -1 || f.deleted === -1);
  if (hasBinary) return "likely_logic";

  const added = totalAdded ?? 0;
  const deleted = totalDeleted ?? 0;
  const linesChanged = added + deleted;

  if (linesChanged === 0) return "empty";

  const maxLines = Math.max(added, deleted, 1);
  const symmetry = 1 - Math.abs(added - deleted) / maxLines;

  if (symmetry >= 0.9 && linesChanged <= 50) return "likely_refactor";

  return "likely_logic";
}

export function parseSignatureStatus(code) {
  switch (normalizeSignatureCode(code)) {
    case "G":
      return "valid";
    case "U":
      return "untrusted";
    case "B":
      return "bad";
    case "X":
      return "expired-signature";
    case "Y":
      return "expired-key";
    case "R":
      return "revoked-key";
    case "E":
      return "missing-key";
    case "N":
      return "unsigned";
    default:
      return "unknown";
  }
}

function isSignedSignatureCode(code) {
  const normalizedCode = normalizeSignatureCode(code);
  return normalizedCode !== "" && normalizedCode !== "N";
}

function normalizeSignatureCode(code) {
  return typeof code === "string" ? code.trim() : "";
}

function splitParents(value) {
  return value ? value.split(" ").filter(Boolean) : [];
}

function parseRefs(value) {
  return value
    ? value
        .split(",")
        .map((ref) => ref.trim())
        .filter(Boolean)
    : [];
}

export function parseChangedFiles(numstatOutput, nameStatusOutput) {
  const stats = new Map();

  for (const rawLine of numstatOutput.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const stat = parseNumstatLine(line);
    if (stat) {
      stats.set(stat.path, stat);
    }
  }

  const files = [];
  for (const rawLine of nameStatusOutput.split("\n")) {
    const line = rawLine.trimEnd();
    if (!line) continue;
    const file = parseNameStatusLine(line, stats);
    if (file) {
      files.push(file);
    }
  }

  return files;
}

function parseNumstatLine(line) {
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const path = normalizeNumstatPath(parts.at(-1));
  return {
    path,
    added: parseStatCount(parts[0]),
    deleted: parseStatCount(parts[1]),
  };
}

function normalizeNumstatPath(filePath) {
  if (!filePath?.includes(" => ")) {
    return filePath;
  }

  const arrowIndex = filePath.lastIndexOf(" => ");
  const beforeArrow = filePath.slice(0, arrowIndex);
  const afterArrow = filePath.slice(arrowIndex + " => ".length);
  const braceIndex = beforeArrow.lastIndexOf("{");
  if (braceIndex === -1) {
    return afterArrow;
  }

  const closingBraceIndex = afterArrow.indexOf("}");
  if (closingBraceIndex === -1) {
    return afterArrow;
  }

  return `${beforeArrow.slice(0, braceIndex)}${afterArrow.slice(0, closingBraceIndex)}${afterArrow.slice(
    closingBraceIndex + 1,
  )}`;
}

export function parseNumstatSummary(lines) {
  return lines.reduce(
    (summary, line) => {
      const stat = parseNumstatLine(line.trimEnd());
      if (!stat) return summary;
      return {
        added: summary.added + stat.added,
        deleted: summary.deleted + stat.deleted,
        fileCount: summary.fileCount + 1,
      };
    },
    { added: 0, deleted: 0, fileCount: 0 },
  );
}

function parseNameStatusLine(line, stats) {
  const parts = line.split("\t").filter(Boolean);
  if (parts.length < 2) return null;

  const rawStatus = parts[0];
  const status = rawStatus[0] ?? "M";
  const path = parts.at(-1);
  const stat = stats.get(path) ?? { added: 0, deleted: 0 };

  return {
    status,
    path,
    added: stat.added,
    deleted: stat.deleted,
  };
}

function parseStatCount(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function parseCount(value) {
  const parsed = Number(value.trim());
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function shortRefName(refName) {
  return refName
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/tags\//, "")
    .replace(/^refs\/remotes\//, "");
}

/**
 * Parse `git worktree list --porcelain` output. Each worktree is a stanza
 * separated by blank lines, with a mandatory `worktree <path>` first line
 * and optional attribute lines. Unknown attribute lines are tolerated and
 * ignored — Git can add new ones in future versions and refscope shouldn't
 * fail because of them.
 *
 * `primaryPath` is matched (after fs.realpath if needed by callers) to mark
 * which entry corresponds to the repo refscope is actually serving from;
 * the UI uses that flag to render an "(this repo)" affordance.
 */
function parseWorktreePorcelain(stdout, primaryPath) {
  const worktrees = [];
  let current = null;
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trimEnd();
    if (line === "") {
      if (current) {
        worktrees.push(current);
        current = null;
      }
      continue;
    }
    const spaceIndex = line.indexOf(" ");
    const key = spaceIndex === -1 ? line : line.slice(0, spaceIndex);
    const value = spaceIndex === -1 ? "" : line.slice(spaceIndex + 1);
    if (key === "worktree") {
      current = {
        path: value,
        head: null,
        branch: null,
        branchShortName: null,
        bare: false,
        detached: false,
        locked: false,
        prunable: false,
        isPrimary: value === primaryPath,
      };
      continue;
    }
    if (!current) continue;
    if (key === "HEAD") current.head = value || null;
    else if (key === "branch") {
      current.branch = value || null;
      current.branchShortName = value ? shortRefName(value) : null;
    } else if (key === "bare") current.bare = true;
    else if (key === "detached") current.detached = true;
    else if (key === "locked") current.locked = true;
    else if (key === "prunable") current.prunable = true;
  }
  if (current) worktrees.push(current);
  return worktrees;
}

/**
 * Probe the .git directory for canonical in-progress operation markers. The
 * file paths and semantics are part of Git's documented surface and have
 * been stable for many releases; new operations would just mean a new entry
 * here. We catch each `statSync` individually so a missing marker (the
 * common case) doesn't poison the whole probe.
 *
 * For each marker we expose just enough metadata for the UI to render a
 * meaningful banner — typically the target hash or branch name — without
 * promising any state we'd need to keep watching the filesystem to maintain.
 */
function collectInProgressOperations(gitDir) {
  const operations = [];
  const merge = readFirstLine(path.join(gitDir, "MERGE_HEAD"));
  if (merge !== null) {
    operations.push({
      kind: "merge",
      targetHash: merge || null,
      message: readFile(path.join(gitDir, "MERGE_MSG")) || null,
    });
  }
  const cherry = readFirstLine(path.join(gitDir, "CHERRY_PICK_HEAD"));
  if (cherry !== null) {
    operations.push({ kind: "cherry-pick", targetHash: cherry || null });
  }
  const revert = readFirstLine(path.join(gitDir, "REVERT_HEAD"));
  if (revert !== null) {
    operations.push({ kind: "revert", targetHash: revert || null });
  }
  if (statIsDir(path.join(gitDir, "rebase-merge"))) {
    operations.push({
      kind: "rebase",
      backend: "merge",
      headName: readFirstLine(path.join(gitDir, "rebase-merge", "head-name")) ?? null,
      onto: readFirstLine(path.join(gitDir, "rebase-merge", "onto")) ?? null,
    });
  } else if (statIsDir(path.join(gitDir, "rebase-apply"))) {
    operations.push({
      kind: "rebase",
      backend: "apply",
      headName: readFirstLine(path.join(gitDir, "rebase-apply", "head-name")) ?? null,
      onto: readFirstLine(path.join(gitDir, "rebase-apply", "onto")) ?? null,
    });
  }
  if (statExists(path.join(gitDir, "BISECT_LOG"))) {
    operations.push({
      kind: "bisect",
      start: readFirstLine(path.join(gitDir, "BISECT_START")) || null,
    });
  }
  if (statIsDir(path.join(gitDir, "sequencer"))) {
    // `sequencer/` is set up for multi-step cherry-pick / revert. Surfacing
    // it separately lets the UI explain the queue when CHERRY_PICK_HEAD /
    // REVERT_HEAD aren't currently set (between steps).
    operations.push({ kind: "sequencer" });
  }
  return operations;
}

function readFirstLine(filePath) {
  try {
    const data = fs.readFileSync(filePath, "utf8");
    const newline = data.indexOf("\n");
    return (newline === -1 ? data : data.slice(0, newline)).trim();
  } catch {
    return null;
  }
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8").trim();
  } catch {
    return null;
  }
}

function statIsDir(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function statExists(filePath) {
  try {
    fs.statSync(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Parse `git submodule status --recursive` lines. Each line starts with a
 * one-character status flag (or a leading space), followed by the SHA-1, the
 * path, and an optional `(describe)` annotation in parens. The describe
 * field is most useful when the submodule's HEAD points at a tag/branch and
 * may be omitted for detached states.
 */
function parseSubmoduleStatus(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => {
      const flag = line[0];
      // Strip the flag character. Then split: <hash> <path> [(describe)]
      const rest = line.slice(1);
      const hashEnd = rest.indexOf(" ");
      if (hashEnd === -1) return null;
      const hash = rest.slice(0, hashEnd);
      const afterHash = rest.slice(hashEnd + 1);
      // The describe annotation is wrapped in parens. We split on " (" to
      // protect against paths containing spaces (rare but allowed).
      const describeStart = afterHash.lastIndexOf(" (");
      let pathField;
      let describe = null;
      if (describeStart !== -1 && afterHash.endsWith(")")) {
        pathField = afterHash.slice(0, describeStart);
        describe = afterHash.slice(describeStart + 2, -1);
      } else {
        pathField = afterHash;
      }
      return {
        path: pathField,
        hash,
        shortHash: /^[0-9a-f]+$/i.test(hash) ? hash.slice(0, 7) : hash,
        describe,
        initialized: flag !== "-",
        modified: flag === "+",
        conflicted: flag === "U",
        uninitialized: flag === "-",
      };
    })
    .filter(Boolean);
}

/**
 * Convert Git's `%ct` (Unix seconds, integer) to an ISO-8601 string. Returns
 * null when the input is malformed so downstream consumers can render a
 * neutral "—" rather than blowing up on `Invalid Date`.
 */
function parseUnixSecondsToIso(raw) {
  if (typeof raw !== "string" || raw.length === 0) return null;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds)) return null;
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function refType(refName) {
  if (refName.startsWith("refs/heads/")) return "branch";
  if (refName.startsWith("refs/tags/")) return "tag";
  if (refName.startsWith("refs/remotes/")) return "remote";
  return "other";
}

export function escapeGitRegexLiteral(value) {
  return value.replace(/[.[\](){}?*+^$|\\]/g, "\\$&");
}

/**
 * Build `git log` search arguments for the requested mode. Attached form
 * (`-SPATTERN`, `-GPATTERN`) is used for pickaxe and regex so hyphen-leading
 * patterns never collide with Git option parsing, even without `--end-of-options`.
 *
 * @param {"subject"|"pickaxe"|"regex"|"message"} mode
 * @param {string} pattern  Validated pattern value (may be empty string).
 * @param {string} searchValue  Legacy `search` param value (subject mode only).
 * @returns {string[]}
 */
export function buildSearchModeArgs(mode, pattern, searchValue) {
  switch (mode) {
    case "pickaxe":
      return pattern ? [`-S${pattern}`] : [];
    case "regex":
      return pattern ? [`-G${pattern}`] : [];
    case "message":
      return pattern
        ? ["--regexp-ignore-case", "--extended-regexp", `--grep=${pattern}`]
        : [];
    default:
      // subject (default): use the legacy escaped search value for backward compatibility
      return searchValue
        ? ["--regexp-ignore-case", "--extended-regexp", `--grep=${escapeGitRegexLiteral(searchValue)}`]
        : [];
  }
}

export function formatLiteralPathspec(value) {
  return `:(literal,top)${value}`;
}

function readSummaryQuery(query) {
  const values = {};
  for (const name of ["ref", "since", "until", "groupBy"]) {
    const allValues = query.getAll(name);
    if (allValues.length > 1) {
      return { ok: false, error: `Duplicate ${name} parameter` };
    }
    values[name] = allValues[0] ?? "";
  }

  const since = parseDateQuery(values.since, "since");
  if (!since.ok) {
    return { ok: false, error: since.error };
  }
  const until = parseDateQuery(values.until, "until");
  if (!until.ok) {
    return { ok: false, error: until.error };
  }
  const groupBy = parseGroupByQuery(values.groupBy);
  if (!groupBy.ok) {
    return { ok: false, error: groupBy.error };
  }

  return {
    ok: true,
    value: {
      ref: values.ref || "HEAD",
      since: since.value,
      until: until.value,
      groupBy: groupBy.value ?? SUMMARY_DEFAULT_GROUP_BY,
    },
  };
}

/**
 * Build the `git log` arguments for the period summary endpoint. Mirrors the
 * hardening of `commitListLogArgs` (no signature verification, no rename
 * detection, no ext-diff/textconv, option parsing terminated before the
 * resolved revision). Adds `--since` / `--until` only when validated input
 * was provided, and reads at most `maxCount` records (one extra over the
 * public hard cap so we can detect truncation).
 *
 * @param {{ since: string|null, until: string|null, revision: string, maxCount: number }} args
 */
export function commitSummaryLogArgs({ since, until, revision, maxCount }) {
  const dateBounds = [];
  if (since) {
    dateBounds.push(`--since=${since}`);
  }
  if (until) {
    dateBounds.push(`--until=${until}`);
  }
  return [
    "log",
    `--max-count=${maxCount}`,
    "--date=iso-strict",
    "--no-show-signature",
    "--no-renames",
    "--numstat",
    "--no-ext-diff",
    "--no-textconv",
    `--format=${COMMIT_RECORD_SEPARATOR}%H%x00%an%x00%aI%x00%s`,
    ...dateBounds,
    "--end-of-options",
    revision,
    "--",
  ];
}

/**
 * Parse the NUL-separated record stream produced by `commitSummaryLogArgs`.
 * Returns one record per commit with raw observed data only — no derivation.
 *
 * @param {string} stdout
 * @returns {Array<{ hash: string, author: string, authorDate: string, subject: string, added: number, deleted: number, paths: string[] }>}
 */
export function parseSummaryRecords(stdout) {
  return stdout
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const lines = record.split("\n");
      const metadata = lines[0] ?? "";
      const [hash, author, authorDate, subject] = metadata.split(COMMIT_FIELD_SEPARATOR);
      let added = 0;
      let deleted = 0;
      const paths = [];
      for (const rawLine of lines.slice(1)) {
        const line = rawLine.trimEnd();
        if (!line) continue;
        const stat = parseSummaryNumstatLine(line);
        if (!stat) continue;
        added += stat.added;
        deleted += stat.deleted;
        if (stat.path) {
          paths.push(stat.path);
        }
      }
      return {
        hash: hash ?? "",
        author: author ?? "",
        authorDate: authorDate ?? "",
        subject: subject ?? "",
        added,
        deleted,
        paths,
      };
    })
    .filter((record) => record.hash.length === 40);
}

function readRefDriftQuery(query) {
  const values = {};
  for (const name of ["base", "limit"]) {
    const allValues = query.getAll(name);
    if (allValues.length > 1) {
      return { ok: false, error: `Duplicate ${name} parameter` };
    }
    values[name] = allValues[0] ?? "";
  }

  // `base` defaults to HEAD when omitted. Validation must run after the
  // default fill so an empty query string still yields a usable default,
  // mirroring the `readSummaryQuery` / `readCommitListQuery` pattern.
  const base = values.base || "HEAD";
  if (!isValidGitRef(base)) {
    return { ok: false, error: "Invalid base parameter" };
  }
  const limit = parseLimitQuery(
    values.limit,
    REF_DRIFT_DEFAULT_LIMIT,
    REF_DRIFT_MAX_LIMIT,
  );
  if (!limit.ok) {
    return { ok: false, error: limit.error };
  }

  return { ok: true, value: { base, limit: limit.value } };
}

/**
 * Compute drift for a single ref against the resolved base hash. Observation
 * fact: ahead is `git rev-list --count <ref>..<base>`'s reverse — i.e.
 * commits reachable from the ref but not from the base — and behind is the
 * mirror count. We never recompute these in-process; the numbers come from
 * Git literally.
 *
 * Short-circuit: when the ref already points at the base commit, ahead and
 * behind are trivially zero and the merge-base is the base hash itself. We
 * skip the three git calls in that case to keep large branch lists cheap.
 *
 * Internally we run ahead, behind, and merge-base in parallel — they share
 * no state and the Git invocation is cheap individually.
 *
 * @param {{ id: string, name: string, path: string }} repo
 * @param {string} baseHash  Already resolved object id for the base ref.
 * @param {{ name: string, type: "branch"|"remote"|"tag"|"other", hash: string }} ref
 * @param {number} timeoutMs
 */
async function computeRefDrift(repo, baseHash, ref, timeoutMs) {
  if (ref.hash === baseHash) {
    return {
      name: ref.name,
      type: ref.type,
      ahead: 0,
      behind: 0,
      mergeBase: baseHash,
      hash: ref.hash,
    };
  }
  const [ahead, behind, mergeBase] = await Promise.all([
    runGit(repo, compareRevListArgs(ref.hash, baseHash), { timeoutMs }),
    runGit(repo, compareRevListArgs(baseHash, ref.hash), { timeoutMs }),
    readMergeBase(repo, baseHash, ref.hash, timeoutMs),
  ]);
  return {
    name: ref.name,
    type: ref.type,
    ahead: parseCount(ahead.stdout),
    behind: parseCount(behind.stdout),
    mergeBase,
    hash: ref.hash,
  };
}

function readFileHistoryQuery(query) {
  const values = {};
  for (const name of ["path", "ref", "limit"]) {
    const allValues = query.getAll(name);
    if (allValues.length > 1) {
      return { ok: false, error: `Duplicate ${name} parameter` };
    }
    values[name] = allValues[0] ?? "";
  }

  // `path` is required for file history — there is no useful "history of
  // nothing" view. We surface the missing-input case explicitly rather than
  // silently defaulting to an empty pathspec (which would degrade into a full
  // commit log).
  const trimmedPath = values.path.trim();
  if (!trimmedPath) {
    return { ok: false, error: "Missing path parameter" };
  }
  const path = parsePathQuery(values.path);
  if (!path.ok) {
    return { ok: false, error: path.error };
  }

  const limit = parseLimitQuery(
    values.limit,
    FILE_HISTORY_DEFAULT_LIMIT,
    FILE_HISTORY_MAX_LIMIT,
  );
  if (!limit.ok) {
    return { ok: false, error: limit.error };
  }

  return {
    ok: true,
    value: {
      ref: values.ref || "HEAD",
      limit: limit.value,
      path: path.value,
    },
  };
}

/**
 * Build the `git log` arguments for file-history retrieval. Uses `--follow`
 * to keep the history connected across renames (Git emits `R<NN>` extended
 * headers inside the patch — we surface them verbatim, never re-judge the
 * rename ourselves). Mirrors the hardening of `commitSummaryLogArgs`:
 * no signature verification, no ext-diff/textconv, option parsing terminated
 * before the resolved revision, pathspec passed after `--`.
 *
 * @param {{ revision: string, pathspec: string, maxCount: number }} args
 */
export function fileHistoryLogArgs({ revision, pathspec, maxCount }) {
  return [
    "log",
    `--max-count=${maxCount}`,
    "--follow",
    "--find-renames",
    "--date=iso-strict",
    "--no-show-signature",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--patch",
    `--format=${COMMIT_RECORD_SEPARATOR}%H%x00%P%x00%an%x00%ae%x00%aI%x00%s`,
    "--end-of-options",
    revision,
    "--",
    pathspec,
  ];
}

/**
 * Parse the RECORD_SEPARATOR-separated stream produced by
 * `fileHistoryLogArgs`. Each record's first line is the NUL-separated metadata
 * block; everything after the first line is the raw `git log --patch` output
 * for that commit, preserved verbatim (including blank lines and `\ No newline`
 * markers) so the UI can feed it into `parseUnifiedDiff` directly.
 *
 * Records lacking a 40-char hex hash are dropped — that is observation hygiene
 * (the format always emits one), not derivation.
 *
 * @param {string} stdout
 * @returns {Array<{ hash: string, parents: string[], author: string, authorEmail: string, authorDate: string, subject: string, patch: string }>}
 */
export function parseFileHistoryRecords(stdout) {
  return stdout
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      const newlineIndex = record.indexOf("\n");
      const metadata = newlineIndex === -1 ? record : record.slice(0, newlineIndex);
      const rest = newlineIndex === -1 ? "" : record.slice(newlineIndex + 1);
      const [hash, parents, author, authorEmail, authorDate, subject] =
        metadata.split(COMMIT_FIELD_SEPARATOR);
      return {
        hash: hash ?? "",
        parents: splitParents(parents ?? ""),
        author: author ?? "",
        authorEmail: authorEmail ?? "",
        authorDate: authorDate ?? "",
        subject: subject ?? "",
        // Strip the blank-line padding Git emits between the format line and
        // the patch body, plus any trailing newlines, but keep internal blank
        // lines (`@@` headers and hunk bodies need their structure intact).
        patch: rest.replace(/^\n+/, "").replace(/\n+$/, ""),
      };
    })
    .filter((record) => /^[A-Fa-f0-9]{40}$/.test(record.hash));
}

function readRelatedFilesQuery(query) {
  const values = {};
  for (const name of ["path", "ref", "limit"]) {
    const allValues = query.getAll(name);
    if (allValues.length > 1) {
      return { ok: false, error: `Duplicate ${name} parameter` };
    }
    values[name] = allValues[0] ?? "";
  }

  // `path` is required for related-files — co-change "of nothing" is not a
  // useful view. We surface the missing-input case explicitly rather than
  // silently defaulting to an empty pathspec.
  const trimmedPath = values.path.trim();
  if (!trimmedPath) {
    return { ok: false, error: "Missing path parameter" };
  }
  const path = parsePathQuery(values.path);
  if (!path.ok) {
    return { ok: false, error: path.error };
  }

  const limit = parseLimitQuery(
    values.limit,
    RELATED_FILES_DEFAULT_LIMIT,
    RELATED_FILES_MAX_LIMIT,
  );
  if (!limit.ok) {
    return { ok: false, error: limit.error };
  }

  return {
    ok: true,
    value: {
      ref: values.ref || "HEAD",
      limit: limit.value,
      path: path.value,
    },
  };
}

/**
 * Build the `git log` arguments for the hash-only first pass of related-files
 * (co-change). Mirrors the hardening of `fileHistoryLogArgs` (no signature
 * verification, no ext-diff/textconv, option parsing terminated before the
 * resolved revision, pathspec passed after `--`) but emits *only* the commit
 * hash — no patch, no metadata. We use `--follow` to keep the chain alive
 * across renames so the second-pass name-only read sees every commit that
 * touched the file under any of its historical names.
 *
 * @param {{ revision: string, pathspec: string, maxCount: number }} args
 */
export function relatedFilesHashLogArgs({ revision, pathspec, maxCount }) {
  return [
    "log",
    `--max-count=${maxCount}`,
    "--follow",
    "--find-renames",
    "--no-show-signature",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--format=%H",
    "--end-of-options",
    revision,
    "--",
    pathspec,
  ];
}

/**
 * Build the `git log --no-walk` arguments for the second pass. `--no-walk`
 * makes git print only the named commits (no parent traversal), which is
 * exactly the batched N-of-N read we want — one syscall regardless of how
 * many hashes we pass. `--name-only` emits one path per line for each
 * commit, joined to the metadata block by the RECORD_SEPARATOR convention
 * already used elsewhere in this module.
 *
 * `--no-renames` keeps the name list straightforward — we don't need rename
 * detection for co-change aggregation, only the literal paths Git records
 * per commit. (`normalizeNumstatPath` further normalizes any `path/{old =>
 * new}` notation that surfaces from the parent diff.)
 *
 * @param {{ hashes: string[] }} args
 */
export function relatedFilesNameLogArgs({ hashes }) {
  return [
    "log",
    "--no-walk",
    "--name-only",
    "--no-show-signature",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-renames",
    `--format=${COMMIT_RECORD_SEPARATOR}%H%x00%aI`,
    "--end-of-options",
    ...hashes,
  ];
}

/**
 * Parse the RECORD_SEPARATOR-separated stream produced by
 * `relatedFilesNameLogArgs` and aggregate co-change counts per sibling path.
 *
 * Observation contract:
 * - The target path itself is excluded from the result.
 * - Each path appears at most once per commit (no inflation from name-only
 *   listing the same path twice — git doesn't, but we de-dup defensively).
 * - `coChangeCount` is the literal number of *commits* that touched both the
 *   target and the sibling. `lastCoChangeAt` is the latest authorDate seen
 *   in those commits — Git's own ISO-8601 string, never re-derived.
 * - Sort: count desc, then lastCoChangeAt desc; finally we slice to top-K so
 *   the wire payload stays bounded.
 *
 * @param {string} stdout
 * @param {string} targetPath  Original (validated) input path used to filter
 *                             the target out of the co-change list.
 * @returns {{ scannedCommits: number, related: Array<{ path: string, coChangeCount: number, lastCoChangeAt: string }> }}
 */
// ─── Range history (D-4) ─────────────────────────────────────────────────────

/**
 * Build `git log -L` arguments for range-history retrieval.
 *
 * The `-L<start>,<end>:<path>` argument traces the history of the given
 * line range within the file. `--no-patch` suppresses the diff output so
 * only commit metadata is returned, keeping the response size bounded.
 *
 * Key design decisions:
 * - `-L<s>,<e>:<path>` uses the "attached" form so git never misinterprets
 *   the value as a global flag (it's args[1+], not args[0]).
 * - `--no-merges` reduces noise: merge commits rarely touch specific line
 *   ranges and their messages rarely carry the "why" context we're after.
 * - `--no-show-signature` is mandatory (Refscope policy: no GPG invocations).
 * - `--format=` uses RS (\x1e) as the record separator for reliable parsing.
 * - `%b` captures the full body; `%x00` (NUL) is the field separator so
 *   newlines inside body text are preserved verbatim.
 *
 * @param {{ lineStart: number, lineEnd: number, path: string, revision: string, maxCount: number }} args
 */
export function rangeHistoryLogArgs({ lineStart, lineEnd, path: filePath, revision, maxCount }) {
  return [
    "log",
    `--max-count=${maxCount}`,
    "--no-merges",
    "--no-show-signature",
    "--no-patch",
    `--format=%x1e%H%x00%an%x00%aI%x00%s%x00%b%x00`,
    `-L${lineStart},${lineEnd}:${filePath}`,
    `--end-of-options`,
    revision,
  ];
}

/**
 * Parse the RS-separated stream produced by `rangeHistoryLogArgs`.
 * Each record contains NUL-separated fields: hash, author, authorDate,
 * subject, body. Body may span multiple lines — we trim trailing whitespace.
 *
 * Records lacking a valid 40-char hex hash are dropped (observation hygiene).
 *
 * @param {string} stdout
 * @returns {Array<{ hash: string, author: string, authorDate: string, subject: string, body: string }>}
 */
export function parseRangeHistoryRecords(stdout) {
  return stdout
    .split("\x1e")
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      // NUL-separated: hash, author, authorDate, subject, body, trailing ""
      const parts = record.split("\x00");
      const hash = (parts[0] ?? "").trim();
      const author = (parts[1] ?? "").trim();
      const authorDate = (parts[2] ?? "").trim();
      const subject = (parts[3] ?? "").trim();
      // body may contain newlines — preserve them, just trim leading/trailing whitespace
      const body = (parts[4] ?? "").trim();
      return { hash, author, authorDate, subject, body };
    })
    .filter((record) => /^[A-Fa-f0-9]{40}$/.test(record.hash));
}

/**
 * Extract URLs and GitHub-style issue references from a commit message body.
 * Returns an array of literal strings observed in the text — no semantic
 * meaning is inferred (Refscope never calls these "related PRs").
 *
 * Patterns matched (literal observed values only):
 *   - http:// and https:// URLs
 *   - #NNN GitHub issue/PR references (digits 1-6 chars)
 *
 * @param {string} body
 * @returns {string[]}
 */
export function extractUrlsFromBody(body) {
  if (!body) return [];
  const results = [];
  const seen = new Set();

  // https?:// URLs — capture up to the first whitespace or common terminators.
  const urlPattern = /https?:\/\/[^\s,;)"'>]+/g;
  for (const match of body.matchAll(urlPattern)) {
    const url = match[0].replace(/[.,]+$/, ""); // strip trailing punctuation
    if (!seen.has(url)) {
      seen.add(url);
      results.push(url);
    }
  }

  // #NNN GitHub-style references (1-6 digits).
  const refPattern = /#([0-9]{1,6})\b/g;
  for (const match of body.matchAll(refPattern)) {
    const ref = match[0];
    if (!seen.has(ref)) {
      seen.add(ref);
      results.push(ref);
    }
  }

  return results;
}

export function parseRelatedFilesRecords(stdout, targetPath) {
  const records = stdout
    .split(COMMIT_RECORD_SEPARATOR)
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.length > 0);

  /** @type {Map<string, { coChangeCount: number, lastCoChangeAt: string }>} */
  const aggregate = new Map();
  let scannedCommits = 0;

  for (const record of records) {
    const newlineIndex = record.indexOf("\n");
    const metadata = newlineIndex === -1 ? record : record.slice(0, newlineIndex);
    const rest = newlineIndex === -1 ? "" : record.slice(newlineIndex + 1);
    const [hash, authorDate] = metadata.split(COMMIT_FIELD_SEPARATOR);
    if (!/^[A-Fa-f0-9]{40}$/.test(hash ?? "")) continue;
    scannedCommits += 1;

    /** @type {Set<string>} */
    const seenInCommit = new Set();
    for (const rawLine of rest.split("\n")) {
      const line = rawLine.trim();
      if (!line) continue;
      // `--name-only` should never emit numstat tabs, but normalizeNumstatPath
      // also handles the `path/{old => new}` notation that may appear when a
      // rename surfaces — we run it for parity with the rest of the parser.
      const normalized = normalizeNumstatPath(line);
      if (!normalized) continue;
      if (normalized === targetPath) continue;
      if (seenInCommit.has(normalized)) continue;
      seenInCommit.add(normalized);

      const previous = aggregate.get(normalized);
      const dateValue = typeof authorDate === "string" ? authorDate : "";
      if (!previous) {
        aggregate.set(normalized, {
          coChangeCount: 1,
          lastCoChangeAt: dateValue,
        });
        continue;
      }
      previous.coChangeCount += 1;
      // String comparison is sufficient for ISO-8601 ordering (literal
      // observation: Git emits `--date=iso-strict`-equivalent strings via %aI).
      if (dateValue && dateValue > previous.lastCoChangeAt) {
        previous.lastCoChangeAt = dateValue;
      }
    }
  }

  const related = Array.from(aggregate, ([path, value]) => ({
    path,
    coChangeCount: value.coChangeCount,
    lastCoChangeAt: value.lastCoChangeAt,
  }))
    .sort((a, b) => {
      if (b.coChangeCount !== a.coChangeCount) {
        return b.coChangeCount - a.coChangeCount;
      }
      // Tie-break by lastCoChangeAt desc — most recently co-changed first.
      if (b.lastCoChangeAt > a.lastCoChangeAt) return 1;
      if (b.lastCoChangeAt < a.lastCoChangeAt) return -1;
      // Final stable tie-break by path so the order is deterministic across
      // runs even when count and date both match.
      return a.path.localeCompare(b.path);
    })
    .slice(0, RELATED_FILES_TOP_K);

  return { scannedCommits, related };
}

function parseSummaryNumstatLine(line) {
  const parts = line.split("\t");
  if (parts.length < 3) return null;
  const rawAdded = parts[0];
  const rawDeleted = parts[1];
  const path = normalizeNumstatPath(parts.at(-1));
  const added = rawAdded === "-" ? 0 : parseStatCount(rawAdded);
  const deleted = rawDeleted === "-" ? 0 : parseStatCount(rawDeleted);
  return { added, deleted, path: path ?? "" };
}

function aggregateObservedTotals(records) {
  const authors = new Set();
  let totalAdded = 0;
  let totalDeleted = 0;
  for (const record of records) {
    totalAdded += record.added;
    totalDeleted += record.deleted;
    if (record.author) authors.add(record.author);
  }
  return {
    totalCommits: records.length,
    totalAdded,
    totalDeleted,
    authorsCount: authors.size,
  };
}

/**
 * Group summary records by the requested kind. `prefix` uses the literal
 * conventional-commit regex; non-matching subjects are *not* placed in any
 * group (caller surfaces them via `buildUncategorizedBucket`). `path` uses
 * the first path segment of each changed file; commits touching multiple
 * top-segments are counted in each segment's group (commit hashes can repeat
 * across path groups, by design — drilldown still resolves to real commits).
 * `author` uses the literal `commit.author` string.
 *
 * @param {ReturnType<typeof parseSummaryRecords>} records
 * @param {"prefix"|"path"|"author"} groupBy
 */
export function groupSummaryRecords(records, groupBy) {
  /** @type {Map<string, { added: number, deleted: number, authors: Set<string>, sampleSubjects: string[], commitHashes: string[] }>} */
  const buckets = new Map();

  const addToBucket = (key, record) => {
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        added: 0,
        deleted: 0,
        authors: new Set(),
        sampleSubjects: [],
        commitHashes: [],
      };
      buckets.set(key, bucket);
    }
    bucket.added += record.added;
    bucket.deleted += record.deleted;
    if (record.author) bucket.authors.add(record.author);
    if (bucket.sampleSubjects.length < SUMMARY_SAMPLE_SUBJECTS_MAX) {
      bucket.sampleSubjects.push(record.subject);
    }
    if (bucket.commitHashes.length < SUMMARY_COMMIT_HARD_CAP) {
      bucket.commitHashes.push(record.hash);
    }
  };

  for (const record of records) {
    if (groupBy === "prefix") {
      const prefixMatch = CONVENTIONAL_COMMIT_PREFIX_PATTERN.exec(record.subject);
      if (!prefixMatch) continue; // uncategorized — handled separately
      addToBucket(prefixMatch[1], record);
      continue;
    }
    if (groupBy === "author") {
      const author = record.author || "(unknown)";
      addToBucket(author, record);
      continue;
    }
    // path: each top-segment of every changed file. Deduplicate within a
    // single commit so the same commit isn't double-counted into the *same*
    // top-segment group, but *is* counted into multiple distinct segments.
    const seenSegments = new Set();
    for (const filePath of record.paths) {
      const topSegment = topPathSegment(filePath);
      if (!topSegment || seenSegments.has(topSegment)) continue;
      seenSegments.add(topSegment);
      addToBucket(topSegment, record);
    }
  }

  return Array.from(buckets, ([key, bucket]) => ({
    kind: groupBy,
    key,
    commitCount: bucket.commitHashes.length,
    added: bucket.added,
    deleted: bucket.deleted,
    authors: Array.from(bucket.authors),
    sampleSubjects: bucket.sampleSubjects,
    commitHashes: bucket.commitHashes,
  }));
}

function buildUncategorizedBucket(records) {
  const commitHashes = [];
  for (const record of records) {
    if (CONVENTIONAL_COMMIT_PREFIX_PATTERN.test(record.subject)) continue;
    if (commitHashes.length >= SUMMARY_COMMIT_HARD_CAP) break;
    commitHashes.push(record.hash);
  }
  return {
    kind: "prefix",
    commitHashes,
    commitCount: commitHashes.length,
  };
}

function topPathSegment(filePath) {
  if (typeof filePath !== "string" || filePath.length === 0) return "";
  const slashIndex = filePath.indexOf("/");
  return slashIndex === -1 ? filePath : filePath.slice(0, slashIndex);
}

// ─── Fleet observation surface helpers ──────────────────────────────────────
//
// These three functions are the only git call sites for the fleet snapshot
// endpoint (GET /api/fleet/snapshot). They reuse existing allowlisted commands
// (rev-parse, log, diff) — the gitRunner allowlist is not changed.
//
// All three accept a raw `repoPath` string so they can be called by
// fleetService.js without constructing a full repo object; internally they
// wrap the path in the `{ path }` shape that runGit expects.

/**
 * Return the short SHA of HEAD for the given repo path.
 *
 * Uses `git rev-parse --short HEAD` — already allowlisted. The runner default
 * 7-character short form matches Git's own default; the exact length may vary
 * if the repo needs more characters to avoid ambiguity.
 *
 * @param {string} repoPath - Absolute canonical path to the git working tree.
 * @returns {Promise<string|null>} Short SHA string, or null on error.
 */
export async function getHeadShortSha(repoPath) {
  const { stdout } = await runGit(
    { path: repoPath },
    ["rev-parse", "--short", "HEAD"],
    { timeoutMs: FLEET_GIT_TIMEOUT_MS, maxBytes: 64 },
  );
  return stdout.trim() || null;
}

/**
 * Return the number of commits reachable from HEAD since the given ISO 8601
 * timestamp. Counts newlines in `git log --format=%H --since=<sinceISO> HEAD`
 * output — each non-empty line is one commit hash.
 *
 * `--format=%H` is the shortest safe format that avoids any derived text.
 * `--no-show-signature` prevents GPG/SSH verification calls.
 *
 * @param {string} repoPath  - Absolute canonical path to the git working tree.
 * @param {string} sinceISO  - ISO 8601 UTC timestamp (validated by fleetService).
 * @returns {Promise<number>} Commit count (>= 0).
 */
export async function getCommits24hCount(repoPath, sinceISO) {
  const { stdout } = await runGit(
    { path: repoPath },
    [
      "log",
      `--since=${sinceISO}`,
      "--format=%H",
      "--no-show-signature",
      "--end-of-options",
      "HEAD",
      "--",
    ],
    { timeoutMs: FLEET_GIT_TIMEOUT_MS, maxBytes: 4 * 1024 * 1024 },
  );
  // Count non-empty lines — each line is one full commit SHA.
  return stdout.split("\n").filter(Boolean).length;
}

/**
 * Return true if the working tree has uncommitted changes (tracked files only).
 *
 * Uses `git diff --quiet HEAD` — exit code 1 means changes exist, 0 means
 * clean. Untracked files are excluded (proposal §4.1.5; notes.untrackedExcluded
 * is set to true in the snapshot response to surface this limitation).
 *
 * Delegates to the existing getWorkTreeChanges helper to reuse the diff args
 * that are already hardened (--no-ext-diff, --no-textconv, --no-color, etc.).
 * Specifically calls `workTreeNumstatArgs({ staged: false })` and checks
 * whether any file rows appear, keeping the call surface minimal.
 *
 * @param {string} repoPath - Absolute canonical path to the git working tree.
 * @returns {Promise<boolean>} true if tracked files differ from HEAD.
 */
export async function getWorktreeDirtyBoolean(repoPath) {
  const repo = { path: repoPath };
  // diff HEAD (unstaged): exit 0 = clean, exit 1 = dirty (GitCommandError).
  // We use --quiet so git exits 1 immediately on first change; no output needed.
  try {
    await runGit(
      repo,
      ["diff", "--quiet", "--no-ext-diff", "--end-of-options", "HEAD", "--"],
      { timeoutMs: FLEET_GIT_TIMEOUT_MS, maxBytes: 64 },
    );
    return false;
  } catch (err) {
    if (err && err.name === "GitCommandError" && err.exitCode === 1 && !err.timedOut) {
      // exit 1 = dirty working tree
      return true;
    }
    throw err;
  }
}

/**
 * Default git call timeout for fleet helpers (ms).
 * Kept shorter than the global gitTimeoutMs so the per-repo 5s fleet timeout
 * in fleetService.js is the binding limit, not the git runner.
 *
 * @type {number}
 */
const FLEET_GIT_TIMEOUT_MS = 4000;

/**
 * Dedicated git call timeout for Hotspot Lens (ms).
 * Large repos with many tracked files need more headroom than the default
 * gitTimeoutMs, but we cap it at 20 s to stay within the 504 budget.
 *
 * @type {number}
 */
const HOTSPOT_GIT_TIMEOUT_MS = 20_000;

/**
 * Per-call stdout cap for Hotspot Lens git invocations (bytes).
 * 1 MiB covers ordinary source repositories; anything larger is truncated and
 * reported as `truncationReason: "maxBytes"` by the git runner.
 *
 * @type {number}
 */
const HOTSPOT_MAX_BYTES = 1_048_576;

// ─── Symbol-history helpers (D-1) ────────────────────────────────────────────

/**
 * Build `git log` arguments for the symbol-history endpoint.
 *
 * Uses `-L :<funcname>:<path>` to trace the history of a named symbol.
 * `--find-renames` is passed to enable rename detection in the diff output;
 * rename evidence is extracted from the diff header by `parseSymbolHistoryRecords`.
 *
 * Note: `--follow` cannot be combined with `-L` in Git — if passed, git exits
 * 128 with "fatal: --follow requires exactly one pathspec". We use
 * `--find-renames` only, which detects renames at each commit boundary.
 *
 * The `-L` argument uses the `:funcname:path` form so Git applies its
 * built-in funcname regex for the file's language. This is a `log` sub-option,
 * not a separate command — the runner allowlist checks only `args[0]` ("log").
 *
 * We emit `--no-patch` to suppress the large diff body; only the commit
 * metadata header and the rename information (from the diff header line) are
 * needed. The diff header is always emitted before the patch hunk, so we can
 * detect renames from the minimal header output without `--patch`.
 *
 * @param {{ funcname: string, path: string, revision: string, maxCount: number }} args
 * @returns {string[]}
 */
export function symbolHistoryLogArgs({ funcname, path: filePath, revision, maxCount }) {
  return [
    "log",
    `--max-count=${maxCount}`,
    "--no-merges",
    "--no-show-signature",
    "--no-patch",
    `--format=%x1e%H%x00%an%x00%aI%x00%s%x00%b%x00`,
    `--find-renames`,
    `-L:${funcname}:${filePath}`,
    `--end-of-options`,
    revision,
  ];
}

/**
 * Parse the RS-separated stream produced by `symbolHistoryLogArgs`.
 *
 * Each record contains NUL-separated fields: hash, author, authorDate,
 * subject, body. Because `--no-patch` is used, there is no diff output to
 * scan for rename headers. Rename detection via diff headers requires
 * `--patch` output; with `--no-patch` we can only surface that git ran the
 * `-L` trace successfully.
 *
 * For rename detection with `--no-patch`, we rely on a separate pass:
 * we keep the `renameInfo` field as `null` in the `--no-patch` mode. If
 * rename tracking is a hard requirement in a future iteration, the caller
 * can switch to `--patch` and call `extractSymbolRenameFromDiff`.
 *
 * Records lacking a valid 40-char hex hash are dropped (observation hygiene).
 *
 * @param {string} stdout
 * @returns {Array<{
 *   hash: string,
 *   author: string,
 *   authorDate: string,
 *   subject: string,
 *   body: string,
 *   renameInfo: { from: string, to: string, similarity: number | null } | null
 * }>}
 */
export function parseSymbolHistoryRecords(stdout) {
  return stdout
    .split("\x1e")
    .map((record) => record.replace(/^\n+/, ""))
    .filter((record) => record.length > 0)
    .map((record) => {
      // NUL-separated: hash, author, authorDate, subject, body, trailing ""
      const parts = record.split("\x00");
      const hash = (parts[0] ?? "").trim();
      const author = (parts[1] ?? "").trim();
      const authorDate = (parts[2] ?? "").trim();
      const subject = (parts[3] ?? "").trim();
      // body may contain newlines — preserve them, just trim leading/trailing whitespace
      const body = (parts[4] ?? "").trim();
      return { hash, author, authorDate, subject, body, renameInfo: null };
    })
    .filter((record) => /^[A-Fa-f0-9]{40}$/.test(record.hash));
}

/**
 * Extract rename information from a `-L`-range diff output block.
 *
 * When `--patch` is used (not `--no-patch`), git emits a diff header before
 * each hunk. For renamed files, the header contains:
 *   diff --git a/<oldPath> b/<newPath>
 *   similarity index NN%
 *   rename from <oldPath>
 *   rename to <newPath>
 *
 * This function scans a single commit's diff block for these markers and
 * returns the rename evidence, or `null` if no rename occurred.
 *
 * Exported for unit testing.
 *
 * @param {string} diffBlock  The diff portion of one commit's output.
 * @returns {{ from: string, to: string, similarity: number | null } | null}
 */
export function extractSymbolRenameFromDiff(diffBlock) {
  if (!diffBlock) return null;

  // Look for "rename from" / "rename to" markers in the diff header.
  // These lines are emitted by git only when a rename is detected.
  const renameFromMatch = diffBlock.match(/^rename from (.+)$/m);
  const renameToMatch = diffBlock.match(/^rename to (.+)$/m);

  if (!renameFromMatch || !renameToMatch) return null;

  const from = renameFromMatch[1].trim();
  const to = renameToMatch[1].trim();

  if (!from || !to || from === to) return null;

  // Extract similarity percentage from "similarity index NN%" line.
  const simMatch = diffBlock.match(/^similarity index (\d+)%$/m);
  const similarity = simMatch ? Number(simMatch[1]) : null;

  return { from, to, similarity };
}
