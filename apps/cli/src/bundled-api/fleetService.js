/**
 * fleetService.js
 *
 * Fleet observation surface — snapshot orchestrator.
 *
 * Factory: createFleetService(config, gitService)
 *   Pattern follows createGitService (gitService.js).
 *
 * Option A subset (MVP):
 *   - Observed Git facts only: headShortSha / commits24h / worktreeDirty
 *   - No SSE integration — refMove1h is always null (v1 will wire SSE)
 *   - estimatedCost uses the Option A formula: 8*N git calls/min
 *     (Option B Hybrid formula is ~37*N calls/min per proposal §5.2;
 *      these two must never be mixed)
 *   - notes.sseAvailable: false
 *   - notes.untrackedExcluded: true (diff-only, no ls-files for dirty check)
 *
 * proposal §5.6: Promise.allSettled + per-repo 5s timeout + partial response.
 * proposal §4.1.6: cost formula 8N (Option A subset; the proposal's ~3
 *   calls per snapshot plus the filter-driver lookup the dirty probe needs).
 * charter §5: version=1.
 */

import fs from "node:fs";

/** Per-repo git call timeout in milliseconds (proposal §5.6). */
const REPO_TIMEOUT_MS = 5000;

/**
 * Snapshot interval the UI is expected to poll at.
 * This is a literal constant for estimatedCost transparency, not a server
 * enforcement value (proposal §4.1.6, charter §1.5).
 */
const SNAPSHOT_INTERVAL_MS = 30_000;

/**
 * Option A subset git calls per minute per repo.
 *
 * Formula: 8 * N (proposal §4.1.6, Option A subset).
 *   - rev-parse --short HEAD  (1 call)
 *   - log --since             (1 call)
 *   - config --get-regexp     (1 call; filter drivers to neutralize below)
 *   - diff --quiet HEAD       (1 call)
 *   × refresh twice per minute (30s interval) = 8 calls/repo/min
 *
 * Do NOT confuse with Option B Hybrid formula (~37*N calls/min, proposal §5.2).
 * Option B includes SSE polling + ahead/behind drift per ref, which are not
 * part of this MVP surface.
 *
 * @param {number} n - Number of subscribed repos
 * @returns {number}
 */
function optionAGitCallsPerMin(n) {
  return 8 * n;
}

/**
 * Map a repo path stat error to the fleet status enum.
 *
 * @param {NodeJS.ErrnoException} err
 * @returns {'missing'|'unauthorized'}
 */
function fsErrorToStatus(err) {
  if (err.code === "ENOENT" || err.code === "ENOTDIR") return "missing";
  if (err.code === "EACCES" || err.code === "EPERM") return "unauthorized";
  return "missing";
}

/**
 * Null repo snapshot fields for non-ok statuses (timeout / error / fs).
 */
function nullRepoFields() {
  return {
    headShortSha: null,
    commits24h: null,
    refMove1h: null,
    worktreeDirty: null,
    lastEventAt: null,
  };
}

/**
 * Convert the fleet window value to a sinceISO argument for `git log --since`.
 *
 * @param {string} window - One of '1h', '6h', '24h', '7d'
 * @returns {string} ISO 8601 UTC timestamp
 */
function windowToSinceISO(window) {
  const now = Date.now();
  const offsets = {
    "1h": 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "24h": 24 * 60 * 60 * 1000,
    "7d": 7 * 24 * 60 * 60 * 1000,
  };
  const offsetMs = offsets[window] ?? offsets["24h"];
  return new Date(now - offsetMs).toISOString();
}

/**
 * Collect observed facts for a single repo within a 5s hard timeout.
 *
 * Status enum (proposal §5.6):
 *   ok          — all git calls succeeded
 *   timeout     — per-repo 5s timeout exceeded
 *   git_error   — GitCommandError, timedOut false
 *   missing     — repo path does not exist (ENOENT / ENOTDIR)
 *   unauthorized — repo path access denied (EACCES / EPERM)
 *
 * refMove1h is SSE-derived. Option A subset has no SSE endpoint, so this
 * field is always null here. v1 will wire it to the SSE ref-event log.
 *
 * @param {string} repoId
 * @param {string} repoPath
 * @param {string} window   - fleet window value ('1h' | '6h' | '24h' | '7d')
 * @param {object} gitService
 * @returns {Promise<object>}
 */
async function getFleetRepoSnapshot(repoId, repoPath, window, gitService) {
  // Check file system access before spawning git (avoids GitCommandError noise).
  try {
    fs.statSync(repoPath);
  } catch (fsErr) {
    return {
      repoId,
      ...nullRepoFields(),
      status: fsErrorToStatus(fsErr),
    };
  }

  const sinceISO = windowToSinceISO(window);

  /** Wraps the git data collection so we can race it against a timeout. */
  async function collectGitFacts() {
    // All three probes run in parallel so their latencies share one
    // per-repo deadline instead of adding up.
    const [head, commits, dirty] = await Promise.allSettled([
      gitService.getHeadShortSha(repoPath),
      gitService.getCommits24hCount(repoPath, sinceISO),
      gitService.getWorktreeDirtyBoolean(repoPath),
    ]);
    if (head.status === "rejected") throw head.reason;
    if (head.value === null) {
      // Unborn HEAD (freshly initialised repo): the HEAD-relative probes
      // fail by design; there are no commits and nothing to diff against.
      return { headShortSha: null, commits24h: 0, worktreeDirty: null };
    }
    if (commits.status === "rejected") throw commits.reason;
    if (dirty.status === "rejected") throw dirty.reason;
    return { headShortSha: head.value, commits24h: commits.value, worktreeDirty: dirty.value };
  }

  /**
   * Per-repo 5s timeout (proposal §5.6).
   * Promise.race ensures a slow git call in one repo cannot block the others.
   */
  let timeoutTimer;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutTimer = setTimeout(
      () => reject(Object.assign(new Error("Fleet repo timeout"), { isFleetTimeout: true })),
      REPO_TIMEOUT_MS,
    );
  });

  try {
    const { headShortSha, commits24h, worktreeDirty } = await Promise.race([
      collectGitFacts(),
      timeoutPromise,
    ]);

    return {
      repoId,
      headShortSha,
      commits24h,
      // refMove1h is SSE-derived; Option A subset has no SSE. Always null.
      // v1 will wire this to the per-repo SSE ref-event log (proposal §5.5).
      refMove1h: null,
      worktreeDirty,
      // lastEventAt is server-side in-memory SSE state. Option A subset: null.
      lastEventAt: null,
      status: "ok",
    };
  } catch (err) {
    // The probes carry their own git timeout, shorter than REPO_TIMEOUT_MS,
    // so a slow repo usually surfaces as a timed-out GitCommandError rather
    // than through the race; both mean the repo did not answer in time.
    if (err.isFleetTimeout || (err?.name === "GitCommandError" && err.timedOut)) {
      return {
        repoId,
        ...nullRepoFields(),
        status: "timeout",
      };
    }
    // Import is hoisted; GitCommandError is re-exported from gitService.
    if (err && err.name === "GitCommandError") {
      return {
        repoId,
        ...nullRepoFields(),
        status: "git_error",
      };
    }
    // Unknown error: surface as git_error to avoid leaking internals.
    return {
      repoId,
      ...nullRepoFields(),
      status: "git_error",
    };
  } finally {
    // Without this, every snapshot leaves one 5 s timer pending per repo.
    clearTimeout(timeoutTimer);
  }
}

/**
 * Orchestrate a fleet snapshot across all allowlisted repos (or an include
 * subset). Each repo runs in parallel via Promise.allSettled so a single
 * slow repo cannot block the rest (proposal §5.6).
 *
 * @param {object} config          - Parsed server config (config.repositories Map)
 * @param {object} gitService      - createGitService return value (with fleet helpers)
 * @returns {function} getFleetSnapshot
 */
export function createFleetService(config, gitService) {
  // Snapshots in flight, keyed by window + repo set. Several tabs polling at
  // once share one round of git probes instead of queueing a second round
  // behind the first in the runner's process pool, where the queue wait
  // would push every repo of the later request past its 5 s deadline.
  const inFlight = new Map();

  function getFleetSnapshot({ include = null, window = null } = {}) {
    const key = JSON.stringify([window ?? "24h", include && include.length > 0 ? include : null]);
    const pending = inFlight.get(key);
    if (pending) return pending;
    const promise = collectFleetSnapshot({ include, window }).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, promise);
    return promise;
  }

  /**
   * Build and return a fleet snapshot response object.
   *
   * @param {{ include?: string[]|null, window?: string|null }} opts
   * @returns {Promise<object>} Fleet snapshot matching fleet-response.schema.json
   */
  async function collectFleetSnapshot({ include, window }) {
    const effectiveWindow = window ?? "24h";

    // Resolve the repos to observe. `include` is a validated string[] or null.
    let targetRepos;
    if (include && include.length > 0) {
      // Filter to the intersection of include[] and the allowlist.
      targetRepos = include
        .map((id) => config.repositories.get(id))
        .filter(Boolean);
    } else {
      targetRepos = Array.from(config.repositories.values());
    }

    const N = targetRepos.length;

    // Parallel collection with per-repo timeout via Promise.allSettled.
    // allSettled never short-circuits, so a timeout in one repo does not
    // affect others (proposal §5.6, charter AC9 silence 2).
    const settled = await Promise.allSettled(
      targetRepos.map((repo) =>
        getFleetRepoSnapshot(repo.id, repo.path, effectiveWindow, gitService),
      ),
    );

    // allSettled results are always fulfilled here because getFleetRepoSnapshot
    // itself catches all errors. Map fulfilled values; treat any unexpected
    // rejection as a git_error placeholder.
    const repos = settled.map((result, idx) => {
      if (result.status === "fulfilled") {
        return result.value;
      }
      // Defensive: should not happen since getFleetRepoSnapshot never throws.
      const repoId = targetRepos[idx]?.id ?? "unknown";
      return { repoId, ...nullRepoFields(), status: "git_error" };
    });

    return {
      version: 1,
      snapshotAt: new Date().toISOString(),
      window: effectiveWindow,
      repos,
      /**
       * Literal cost figures for user transparency (charter §1.5, no adjectives).
       *
       * Option A subset formula: 8 * N git calls/min (proposal §4.1.6).
       *   4 git calls per repo per snapshot × 2 snapshots/min (30s interval)
       *   = 8 * N
       *
       * Do NOT confuse with Option B Hybrid: ~37 * N calls/min (proposal §5.2).
       * Option B adds SSE polling + drift detection (not in this MVP surface).
       */
      estimatedCost: {
        subscribedRepoCount: N,
        snapshotIntervalMs: SNAPSHOT_INTERVAL_MS,
        gitCallsPerMin: optionAGitCallsPerMin(N),
      },
      /**
       * Informational flags about Option A subset collection behavior.
       * untrackedExcluded: true — worktreeDirty uses diff HEAD only, not ls-files.
       * sseAvailable: false    — Option A subset has no SSE endpoint.
       *                          v1 will add SSE (proposal §5.5).
       */
      notes: {
        untrackedExcluded: true,
        sseAvailable: false,
      },
    };
  }

  return { getFleetSnapshot };
}
