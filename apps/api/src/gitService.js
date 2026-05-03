import fs from "node:fs";
import path from "node:path";
import { GitCommandError, runGit } from "./gitRunner.js";
import {
  isValidGitRef,
  isValidObjectId,
  parseAuthorQuery,
  parseDateQuery,
  parseGroupByQuery,
  parseLimitQuery,
  parsePathQuery,
  parsePatternQuery,
  parseSearchModeQuery,
  parseSearchQuery,
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

// Conventional-commit prefix grouping uses a literal regex match on the
// commit subject. `feat`, `fix`, `chore`, … with optional scope, then a colon
// + space. Subjects that do not match are kept as observed data and isolated
// into the `uncategorized` bucket — we never *infer* a category from text
// content.
const CONVENTIONAL_COMMIT_PREFIX_PATTERN = /^([a-z][a-z0-9-]*)(?:\([^)]*\))?:\s/;

const COMMIT_FIELD_SEPARATOR = "\u0000";
const COMMIT_RECORD_SEPARATOR = "\u001e";

export function createGitService(config) {
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
      }));
    },

    getRepository(repoId) {
      return config.repositories.get(repoId);
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
        for (const commit of commits) {
          events.push({
            type: "commit_added",
            repoId: repo.id,
            ref: change.ref,
            commit,
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

      return { status: 200, body: parseCommitRecords(stdout) };
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
          files: parseChangedFiles(numstat.stdout, nameStatus.stdout),
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

      const untrackedFiles = describeUntrackedFiles(repo.path, untrackedRaw.stdout);
      const untrackedAdded = untrackedFiles.reduce((sum, file) => sum + file.added, 0);

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
            files: untrackedFiles,
            summary: {
              fileCount: untrackedFiles.length,
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
 * Resolve untracked file paths to `{ path, status, added, deleted }` records.
 * `added` is the number of newlines in the file (treating final-newline as
 * the line terminator, matching how `git diff --numstat` counts new files).
 * Files that fail to read, exceed `UNTRACKED_READ_BYTE_CAP`, or contain a
 * NUL byte (binary heuristic) report `added: 0` rather than crashing the
 * whole response.
 */
function describeUntrackedFiles(repoPath, stdout) {
  if (!stdout) return [];
  const out = [];
  for (const rel of stdout.split("\u0000")) {
    if (!rel) continue;
    out.push({
      path: rel,
      status: "A",
      added: countAddedLines(repoPath, rel),
      deleted: 0,
    });
  }
  return out;
}

function countAddedLines(repoPath, relPath) {
  const fullPath = path.join(repoPath, relPath);
  let stat;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    return 0;
  }
  if (!stat.isFile() || stat.size === 0 || stat.size > UNTRACKED_READ_BYTE_CAP) {
    return 0;
  }
  let buf;
  try {
    buf = fs.readFileSync(fullPath);
  } catch {
    return 0;
  }
  // Cheap binary heuristic: bail if the file contains a NUL byte. Avoids
  // spending a line count on lockfile blobs, images that slipped through, etc.
  if (buf.includes(0)) return 0;
  let count = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0a) count += 1;
  }
  // Files without a trailing newline still represent one logical line.
  if (buf[buf.length - 1] !== 0x0a) count += 1;
  return count;
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
      const stats = parseNumstatSummary(lines.slice(1));
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
      };
    });
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
