// Release and ownership insights derived from committed history.
//
//   - Releases (`/releases`): the tags reachable from a ref, newest first,
//     each with the commits it added over the previous reachable tag, plus
//     the "unreleased" commits on the ref since its latest tag. The UI hands
//     a (previous tag, tag) pair straight to the compare review, which turns
//     it into release notes.
//   - Path owners (`/paths/owners`): who has changed a file or folder at a
//     commit — commit count, line churn, first/last change, and recent
//     activity — so a reader knows whom to ask or to request a review from.
//
// Every value here is derived from Git objects; nothing is persisted, and no
// free text (tag messages, subjects) is read, so a crafted message cannot
// forge a record. All Git calls go through `runGit` with option parsing
// terminated before client-derived values, and client paths travel as
// literal pathspecs.
import { GitCommandError, runGit } from "./gitRunner.js";
import { isValidGitRef, isValidObjectId, parseLimitQuery, parsePathQuery } from "./validation.js";

export const RELEASES_DEFAULT_LIMIT = 30;
export const RELEASES_MAX_LIMIT = 100;
// Commits read per release range. A first-ever tag on a large repository can
// reach its whole history; the count is then reported as a lower bound.
export const RELEASE_RANGE_CAP = 5000;
const RELEASE_RANGE_MAX_BYTES = 4 * 1024 * 1024;
const RELEASE_CONCURRENCY = 4;
const TAG_LIST_MAX_BYTES = 4 * 1024 * 1024;

export const OWNERS_COMMIT_CAP = 3000;
export const OWNERS_DEFAULT_LIMIT = 50;
export const OWNERS_MAX_LIMIT = 200;
export const OWNERS_RECENT_DAYS = 90;
const OWNERS_MAX_BYTES = 16 * 1024 * 1024;

const HASH_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;
const NUMSTAT_LINE_PATTERN = /^(\d+|-)\t(\d+|-)\t/;
const DAY_MS = 24 * 60 * 60 * 1000;

function readSingleParams(query, names) {
  const values = {};
  for (const name of names) {
    const all = query.getAll(name);
    if (all.length > 1) {
      return { ok: false, error: `Duplicate ${name} parameter` };
    }
    values[name] = all[0] ?? "";
  }
  return { ok: true, value: values };
}

function badRequest(error) {
  return { status: 400, body: { error } };
}

async function checkCommitObject(repo, commit, timeoutMs) {
  if (!isValidObjectId(commit)) {
    return { ok: false, result: badRequest("Invalid commit parameter") };
  }
  try {
    const { stdout } = await runGit(repo, ["cat-file", "-t", commit], { timeoutMs, maxBytes: 128 });
    if (stdout.trim() !== "commit") {
      return { ok: false, result: badRequest("Hash does not identify a commit") };
    }
    return { ok: true, hash: commit.toLowerCase() };
  } catch (error) {
    if (error instanceof GitCommandError && !error.timedOut) {
      return { ok: false, result: { status: 404, body: { error: "Commit not found" } } };
    }
    throw error;
  }
}

/** Run `fn` over `items` with at most `limit` in flight; results keep order. */
async function mapLimited(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

// ─── Releases ───────────────────────────────────────────────────────────────

// No free-text atoms: a tag message or tagger name could carry the field or
// record separators. `creatordate` is the tagger date for an annotated tag
// and the commit date for a lightweight one.
const TAG_FORMAT =
  "--format=%(refname)%00%(objectname)%00%(objecttype)%00%(*objectname)%00%(*objecttype)%00%(creatordate:unix)%00%(committerdate:unix)%00%(*committerdate:unix)%00%(symref)";
const TAG_FIELD_COUNT = 9;

/** `for-each-ref` over tags, filtered by reachability from `commit`. */
export function tagListArgs(commit, merged) {
  return ["for-each-ref", TAG_FORMAT, `${merged ? "--merged" : "--no-merged"}=${commit}`, "refs/tags"];
}

/**
 * Parse `tagListArgs` output into release candidates. Only tags that name a
 * commit (directly, or through one annotated tag object) are kept: a tag of a
 * tree or blob is not a release, a tag-of-a-tag would need another peel, and
 * a symref under refs/tags is an alias, not a release. Ordered newest commit
 * first (ties: newer tag date, then name) so the next entry approximates the
 * previous release on the same line.
 *
 * @param {string} stdout
 */
export function parseTagList(stdout) {
  const tags = [];
  for (const line of stdout.split("\n")) {
    if (!line) continue;
    const fields = line.split("\0");
    if (fields.length !== TAG_FIELD_COUNT) continue;
    const [name, objectId, objectType, peeledId, peeledType, creatorDate, commitDate, peeledCommitDate, symref] = fields;
    if (!name.startsWith("refs/tags/") || symref) continue;
    let commit = "";
    let annotated = false;
    let commitSeconds = "";
    if (objectType === "commit") {
      commit = objectId;
      commitSeconds = commitDate;
    } else if (objectType === "tag" && peeledType === "commit") {
      commit = peeledId;
      annotated = true;
      commitSeconds = peeledCommitDate;
    } else {
      continue;
    }
    if (!HASH_PATTERN.test(commit)) continue;
    const taggedSeconds = Number(creatorDate);
    const committedSeconds = Number(commitSeconds);
    tags.push({
      name,
      shortName: name.slice("refs/tags/".length),
      commit,
      annotated,
      taggedAt: Number.isFinite(taggedSeconds) && creatorDate ? new Date(taggedSeconds * 1000).toISOString() : null,
      committedAt:
        Number.isFinite(committedSeconds) && commitSeconds ? new Date(committedSeconds * 1000).toISOString() : null,
      sortKey: [Number.isFinite(committedSeconds) ? committedSeconds : 0, Number.isFinite(taggedSeconds) ? taggedSeconds : 0],
    });
  }
  tags.sort((a, b) => {
    if (a.sortKey[0] !== b.sortKey[0]) return b.sortKey[0] - a.sortKey[0];
    if (a.sortKey[1] !== b.sortKey[1]) return b.sortKey[1] - a.sortKey[1];
    return a.name < b.name ? 1 : a.name > b.name ? -1 : 0;
  });
  for (const tag of tags) delete tag.sortKey;
  return tags;
}

/**
 * Commits in `tip` that are not in `base` (`base` null: all of `tip`'s
 * history). Revisions stay separate tokens: `tip` then `^base`.
 */
export function rangeAuthorsArgs(tip, base) {
  return [
    "log",
    "--no-show-signature",
    "--no-color",
    `--max-count=${RELEASE_RANGE_CAP + 1}`,
    "--format=%H%x00%ae%x00%an",
    "--end-of-options",
    tip,
    ...(base ? [`^${base}`] : []),
    "--",
  ];
}

/** Commit and contributor counts for one range; capped counts are a lower bound. */
export function summarizeRange(stdout) {
  let commits = 0;
  const contributors = new Set();
  for (const line of stdout.split("\n")) {
    const [hash, email = "", name = ""] = line.split("\0");
    if (!HASH_PATTERN.test(hash)) continue;
    commits += 1;
    if (commits > RELEASE_RANGE_CAP) break;
    contributors.add((email || name).toLowerCase());
  }
  const truncated = commits > RELEASE_RANGE_CAP;
  return {
    commitCount: truncated ? RELEASE_RANGE_CAP : commits,
    contributorCount: contributors.size,
    truncated,
  };
}

async function readRange(repo, tip, base, timeoutMs) {
  if (base && base === tip) {
    return { commitCount: 0, contributorCount: 0, truncated: false };
  }
  const { stdout, truncated } = await runGit(repo, rangeAuthorsArgs(tip, base), {
    timeoutMs,
    maxBytes: RELEASE_RANGE_MAX_BYTES,
    allowTruncatedStdout: true,
  });
  const summary = summarizeRange(stdout);
  return truncated ? { ...summary, truncated: true } : summary;
}

// ─── Path owners ────────────────────────────────────────────────────────────

const OWNERS_RECORD_SEPARATOR = "\x1e";

export function pathOwnersArgs(commit, pathspec) {
  return [
    "log",
    "--no-merges",
    "--no-show-signature",
    "--no-color",
    "--no-renames",
    `--max-count=${OWNERS_COMMIT_CAP + 1}`,
    "--numstat",
    `--format=${OWNERS_RECORD_SEPARATOR}%H%x00%an%x00%ae%x00%at`,
    "--end-of-options",
    commit,
    "--",
    ...(pathspec ? [pathspec] : []),
  ];
}

/**
 * Aggregate `pathOwnersArgs` output by author (e-mail, case-folded; the name
 * on the newest commit is shown). A record whose hash field is not a hash is
 * dropped, and only `<n>\t<n>\t` lines count as churn, so path text in the
 * numstat lines can never be read as a record or a number.
 *
 * @param {string} stdout
 * @param {{ recentSinceMs: number }} options
 */
export function aggregatePathOwners(stdout, { recentSinceMs }) {
  const byAuthor = new Map();
  let scanned = 0;
  let truncated = false;
  let newestMs = null;
  let oldestMs = null;
  for (const record of stdout.split(OWNERS_RECORD_SEPARATOR)) {
    if (!record) continue;
    const newline = record.indexOf("\n");
    const header = newline === -1 ? record : record.slice(0, newline);
    const [hash, name = "", email = "", seconds = ""] = header.split("\0");
    if (!HASH_PATTERN.test(hash)) continue;
    if (scanned >= OWNERS_COMMIT_CAP) {
      truncated = true;
      break;
    }
    scanned += 1;
    const atMs = Number(seconds) * 1000;
    const validTime = seconds !== "" && Number.isFinite(atMs);
    let added = 0;
    let deleted = 0;
    let binary = 0;
    if (newline !== -1) {
      for (const line of record.slice(newline + 1).split("\n")) {
        const match = NUMSTAT_LINE_PATTERN.exec(line);
        if (!match) continue;
        if (match[1] === "-" || match[2] === "-") {
          binary += 1;
          continue;
        }
        added += Number(match[1]);
        deleted += Number(match[2]);
      }
    }
    const key = (email || name).toLowerCase();
    let entry = byAuthor.get(key);
    if (!entry) {
      entry = {
        author: name,
        authorEmail: email,
        commits: 0,
        recentCommits: 0,
        added: 0,
        deleted: 0,
        binaryChanges: 0,
        firstChangedAt: null,
        lastChangedAt: null,
        _firstMs: Infinity,
        _lastMs: -Infinity,
        _names: new Set(),
      };
      byAuthor.set(key, entry);
    }
    entry.commits += 1;
    if (name) entry._names.add(name);
    entry.added += added;
    entry.deleted += deleted;
    entry.binaryChanges += binary;
    if (validTime) {
      if (atMs >= recentSinceMs) entry.recentCommits += 1;
      if (atMs > entry._lastMs) {
        entry._lastMs = atMs;
        // Log order is newest first, but dates can be skewed; the name on the
        // newest-dated commit wins.
        entry.author = name;
        entry.authorEmail = email;
      }
      if (atMs < entry._firstMs) entry._firstMs = atMs;
      if (newestMs === null || atMs > newestMs) newestMs = atMs;
      if (oldestMs === null || atMs < oldestMs) oldestMs = atMs;
    }
  }

  const authors = [...byAuthor.values()]
    .map(({ _firstMs, _lastMs, _names, ...entry }) => ({
      ...entry,
      // Other names used with the same e-mail (renames, machine configs).
      authorAliases: [..._names].filter((alias) => alias !== entry.author).sort(),
      firstChangedAt: Number.isFinite(_firstMs) ? new Date(_firstMs).toISOString() : null,
      lastChangedAt: Number.isFinite(_lastMs) ? new Date(_lastMs).toISOString() : null,
      _lastMs,
    }))
    .sort((a, b) => {
      if (a.commits !== b.commits) return b.commits - a.commits;
      if (a._lastMs !== b._lastMs) return b._lastMs - a._lastMs;
      return a.authorEmail < b.authorEmail ? -1 : a.authorEmail > b.authorEmail ? 1 : 0;
    })
    .map(({ _lastMs, ...entry }) => entry);

  // Derived: the fewest authors who together made at least half the commits.
  let covered = 0;
  let majorityAuthors = 0;
  for (const entry of authors) {
    if (covered * 2 >= scanned) break;
    covered += entry.commits;
    majorityAuthors += 1;
  }

  return {
    authors,
    scannedCommits: scanned,
    truncated,
    majorityAuthors,
    firstChangedAt: oldestMs === null ? null : new Date(oldestMs).toISOString(),
    lastChangedAt: newestMs === null ? null : new Date(newestMs).toISOString(),
  };
}

// ─── Service methods ────────────────────────────────────────────────────────

/**
 * @param {{ gitTimeoutMs: number }} config
 * @param {{ resolveCommitishRevision: (repo: { path: string }, revision: string, timeoutMs: number) => Promise<{ ok: true, hash: string } | { ok: false, result: { status: number, body: object } }> }} deps
 */
export function createInsightMethods(config, deps) {
  return {
    /**
     * GET /api/repos/:id/releases[?ref=<ref-or-oid>][&limit=N]
     *
     * Tags reachable from `ref` (default HEAD), newest commit first. Each
     * release carries the commits and contributors it added over the next
     * older reachable tag (`previous`); `unreleased` is what `ref` holds past
     * its newest tag. Tags not reachable from `ref` (other release lines)
     * are counted, not listed.
     */
    async getReleases(repo, query) {
      const params = readSingleParams(query, ["ref", "limit"]);
      if (!params.ok) return badRequest(params.error);
      const ref = params.value.ref || "HEAD";
      if (!isValidGitRef(ref)) return badRequest("Invalid ref parameter");
      const limit = parseLimitQuery(params.value.limit || undefined, RELEASES_DEFAULT_LIMIT, RELEASES_MAX_LIMIT);
      if (!limit.ok) return badRequest(limit.error);
      const target = await deps.resolveCommitishRevision(repo, ref, config.gitTimeoutMs);
      if (!target.ok) return target.result;

      const [mergedOut, otherOut] = await Promise.all([
        runGit(repo, tagListArgs(target.hash, true), { timeoutMs: config.gitTimeoutMs, maxBytes: TAG_LIST_MAX_BYTES, allowTruncatedStdout: true }),
        runGit(repo, tagListArgs(target.hash, false), { timeoutMs: config.gitTimeoutMs, maxBytes: TAG_LIST_MAX_BYTES, allowTruncatedStdout: true }),
      ]);
      // A record cut by the byte cap fails the field-count check and drops.
      const tags = parseTagList(mergedOut.stdout);
      const otherTagCount = parseTagList(otherOut.stdout).length;
      const shown = tags.slice(0, limit.value);

      const ranges = await mapLimited(
        [{ tip: target.hash, base: shown[0]?.commit ?? null, unreleased: true }, ...shown.map((tag, index) => ({ tip: tag.commit, base: tags[index + 1]?.commit ?? null }))],
        RELEASE_CONCURRENCY,
        ({ tip, base, unreleased }) =>
          // With no tag at all, the whole history is "unreleased" — not worth
          // walking; the UI says there is no release yet.
          unreleased && !base ? null : readRange(repo, tip, base, config.gitTimeoutMs),
      );

      const releases = shown.map((tag, index) => {
        const previous = tags[index + 1] ?? null;
        return {
          ...tag,
          previous: previous ? { name: previous.name, shortName: previous.shortName, commit: previous.commit } : null,
          ...ranges[index + 1],
        };
      });

      return {
        status: 200,
        body: {
          ref,
          commit: target.hash,
          releases,
          unreleased: shown[0] ? { since: { name: shown[0].name, shortName: shown[0].shortName, commit: shown[0].commit }, ...ranges[0] } : null,
          totalTags: tags.length,
          otherTagCount,
          truncated: tags.length > shown.length || mergedOut.truncated,
          rangeCap: RELEASE_RANGE_CAP,
        },
      };
    },

    /**
     * GET /api/repos/:id/paths/owners?commit=<oid>[&path=<file-or-dir>][&limit=N]
     *
     * Who changed `path` (whole repository when omitted) in the history of
     * `commit`: per author commit count, line churn, first/last change, and
     * commits within the last OWNERS_RECENT_DAYS days before `commit`.
     * Merge commits are excluded; the newest OWNERS_COMMIT_CAP commits are read.
     */
    async getPathOwners(repo, query) {
      const params = readSingleParams(query, ["commit", "path", "limit"]);
      if (!params.ok) return badRequest(params.error);
      const scope = parsePathQuery(params.value.path);
      if (!scope.ok) return badRequest(scope.error);
      const limit = parseLimitQuery(params.value.limit || undefined, OWNERS_DEFAULT_LIMIT, OWNERS_MAX_LIMIT);
      if (!limit.ok) return badRequest(limit.error);
      const commit = await checkCommitObject(repo, params.value.commit, config.gitTimeoutMs);
      if (!commit.ok) return commit.result;

      const { stdout: dateOut } = await runGit(
        repo,
        ["log", "-1", "--no-show-signature", "--format=%ct", "--end-of-options", commit.hash, "--"],
        { timeoutMs: config.gitTimeoutMs, maxBytes: 64 },
      );
      const commitSeconds = Number(dateOut.trim());
      const referenceMs = Number.isFinite(commitSeconds) && dateOut.trim() ? commitSeconds * 1000 : Date.now();
      const recentSinceMs = referenceMs - OWNERS_RECENT_DAYS * DAY_MS;

      let stdout = "";
      let byteTruncated = false;
      try {
        ({ stdout, truncated: byteTruncated } = await runGit(
          repo,
          pathOwnersArgs(commit.hash, scope.value ? `:(literal,top)${scope.value}` : null),
          { timeoutMs: config.gitTimeoutMs, maxBytes: OWNERS_MAX_BYTES, allowTruncatedStdout: true },
        ));
      } catch (error) {
        if (error instanceof GitCommandError && error.timedOut) {
          return { status: 504, body: { error: "Ownership read timed out; narrow the path" } };
        }
        throw error;
      }
      const result = aggregatePathOwners(stdout, { recentSinceMs });
      return {
        status: 200,
        body: {
          commit: commit.hash,
          path: scope.value,
          authors: result.authors.slice(0, limit.value),
          authorCount: result.authors.length,
          scannedCommits: result.scannedCommits,
          truncated: result.truncated || byteTruncated,
          commitCap: OWNERS_COMMIT_CAP,
          majorityAuthors: result.majorityAuthors,
          firstChangedAt: result.firstChangedAt,
          lastChangedAt: result.lastChangedAt,
          recentWindowDays: OWNERS_RECENT_DAYS,
          recentSince: new Date(recentSinceMs).toISOString(),
        },
      };
    },
  };
}
