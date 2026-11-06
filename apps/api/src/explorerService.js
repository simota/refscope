// Repository explorer: browse the tree at any commit, search code at a
// commit (`git grep`), and walk a ref's reflog with lost-commit detection.
//
// Every read targets committed objects only (a commit object ID the client
// already holds, or a public ref's reflog), never the working tree, so no
// filter driver, fsmonitor, or textconv program is involved. All Git calls go
// through `runGit`; option parsing is terminated before any client value and
// client paths travel as literal pathspecs or on stdin.
import { GitCommandError, runGit } from "./gitRunner.js";
import {
  isPublicFullRefName,
  isValidGitRef,
  isValidObjectId,
  parseLimitQuery,
  parsePathQuery,
  parsePatternQuery,
  parseSkipQuery,
} from "./validation.js";

// One directory listing. Monorepo roots can be wide, but a listing past this
// is not browsable anyway; the response says it was cut.
export const TREE_MAX_ENTRIES = 5000;
const TREE_MAX_BYTES = 2 * 1024 * 1024;
// The "go to file" index. 100k paths covers very large repositories; the
// byte cap keeps a pathological tree from producing a huge response.
export const TREE_PATHS_MAX = 100_000;
const TREE_PATHS_MAX_BYTES = 8 * 1024 * 1024;

export const CODE_SEARCH_DEFAULT_LIMIT = 200;
export const CODE_SEARCH_MAX_LIMIT = 1000;
// Per-file cap so one generated file cannot use up the whole result budget.
const CODE_SEARCH_PER_FILE = 50;
const CODE_SEARCH_MAX_BYTES = 4 * 1024 * 1024;
export const CODE_SEARCH_LINE_MAX_CHARS = 400;
const CODE_SEARCH_MODES = new Set(["fixed", "regex"]);

export const REFLOG_DEFAULT_LIMIT = 100;
export const REFLOG_MAX_LIMIT = 500;
const REFLOG_FIELD_COUNT = 9;
const REACHABILITY_MAX_BYTES = 2 * 1024 * 1024;

const BATCH_CHECK_LINE_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64}) (blob|tree|commit|tag) (\d+)$/;
const LS_TREE_RECORD_PATTERN = /^([0-7]{6}) (blob|tree|commit) ([0-9a-f]{40}|[0-9a-f]{64}) +(\d+|-)\t([\s\S]+)$/;
const HASH_PATTERN = /^([0-9a-f]{40}|[0-9a-f]{64})$/;

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

/** `0`/`1` flags only; anything else is a client bug worth surfacing. */
function parseFlagQuery(raw, name) {
  if (raw === "" || raw === "0") return { ok: true, value: false };
  if (raw === "1") return { ok: true, value: true };
  return { ok: false, error: `Invalid ${name} parameter` };
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

/** Type and ID of `<commit>:<path>`; the object name travels on stdin. */
async function lookupPathObject(repo, commit, filePath, timeoutMs) {
  const { stdout } = await runGit(
    repo,
    ["cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
    { timeoutMs, maxBytes: 4096, input: `${commit}:${filePath}\n` },
  );
  const match = BATCH_CHECK_LINE_PATTERN.exec(stdout.replace(/\n$/, ""));
  return match ? { objectId: match[1], type: match[2] } : null;
}

// ─── Tree listing ───────────────────────────────────────────────────────────

export function treeListArgs(treeish) {
  return ["ls-tree", "-z", "-l", "--end-of-options", treeish];
}

export function treePathsArgs(commit) {
  return ["ls-tree", "-r", "-z", "--name-only", "--end-of-options", commit];
}

/**
 * Parse `ls-tree -z -l` output into display entries. A record cut by the
 * byte cap fails the pattern and is dropped. Directories sort first, then
 * names case-insensitively (stable on exact name for determinism).
 *
 * @param {string} stdout
 * @param {string} parentPath directory being listed ("" for the root)
 */
export function parseTreeEntries(stdout, parentPath) {
  const entries = [];
  for (const record of stdout.split("\0")) {
    const match = LS_TREE_RECORD_PATTERN.exec(record);
    if (!match) continue;
    const [, mode, objectType, objectId, size, name] = match;
    let type = "file";
    if (objectType === "tree") type = "dir";
    else if (objectType === "commit") type = "submodule";
    else if (mode === "120000") type = "symlink";
    entries.push({
      name,
      path: parentPath ? `${parentPath}/${name}` : name,
      type,
      mode,
      objectId,
      size: size === "-" ? null : Number(size),
    });
  }
  entries.sort((a, b) => {
    const dirA = a.type === "dir" ? 0 : 1;
    const dirB = b.type === "dir" ? 0 : 1;
    if (dirA !== dirB) return dirA - dirB;
    const folded = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
    return folded !== 0 ? folded : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
  return entries;
}

// ─── Code search ────────────────────────────────────────────────────────────

/**
 * `git grep` over one commit's tree. The pattern is attached to `-e` so it
 * can never be read as an option (or trip the runner's flag guards), and the
 * explicit `--no-column` / `--no-heading` / `--no-break` keep a repository's
 * `grep.*` config from changing the NUL-framed record shape.
 *
 * @param {{ commit: string, pattern: string, mode: "fixed"|"regex", ignoreCase: boolean, pathspec: string|null }} options
 */
export function codeSearchArgs({ commit, pattern, mode, ignoreCase, pathspec }) {
  return [
    "grep",
    "--no-color",
    "--no-column",
    "--no-heading",
    "--no-break",
    "-I",
    "-n",
    "--null",
    "--full-name",
    "--no-textconv",
    mode === "regex" ? "--extended-regexp" : "--fixed-strings",
    ...(ignoreCase ? ["--ignore-case"] : []),
    `--max-count=${CODE_SEARCH_PER_FILE}`,
    `-e${pattern}`,
    commit,
    "--",
    ...(pathspec ? [pathspec] : []),
  ];
}

/**
 * Parse `git grep --null -n <tree>` output: `<tree>:<path>\0<line>\0<text>\n`.
 * The path is NUL-terminated (it may contain newlines); the text cannot
 * contain a newline. Parsing is sequential so file content can never forge a
 * record boundary. A record cut by the byte cap is dropped.
 *
 * @param {string} stdout
 * @param {string} commit the tree-ish passed to grep (stripped from paths)
 * @param {number} limit
 */
export function parseCodeSearchOutput(stdout, commit, limit) {
  const matches = [];
  const prefix = `${commit}:`;
  let index = 0;
  let limited = false;
  while (index < stdout.length) {
    const pathEnd = stdout.indexOf("\0", index);
    if (pathEnd === -1) break;
    const lineEnd = stdout.indexOf("\0", pathEnd + 1);
    if (lineEnd === -1) break;
    const textEnd = stdout.indexOf("\n", lineEnd + 1);
    if (textEnd === -1) break;
    const rawPath = stdout.slice(index, pathEnd);
    const lineNo = Number(stdout.slice(pathEnd + 1, lineEnd));
    const text = stdout.slice(lineEnd + 1, textEnd);
    index = textEnd + 1;
    if (!rawPath.startsWith(prefix) || !Number.isSafeInteger(lineNo) || lineNo < 1) continue;
    if (matches.length >= limit) {
      limited = true;
      break;
    }
    const clipped = text.length > CODE_SEARCH_LINE_MAX_CHARS;
    matches.push({
      path: rawPath.slice(prefix.length),
      line: lineNo,
      text: clipped ? text.slice(0, CODE_SEARCH_LINE_MAX_CHARS) : text,
      clipped,
    });
  }
  return { matches, limited };
}

// ─── Reflog ─────────────────────────────────────────────────────────────────

const REFLOG_FORMAT = "--format=%H%x00%P%x00%an%x00%aI%x00%s%x00%gd%x00%gs%x00%gn%x00%ge";

export function reflogArgs({ ref, maxCount, skip }) {
  return [
    "log",
    "--walk-reflogs",
    `--max-count=${maxCount}`,
    ...(skip > 0 ? [`--skip=${skip}`] : []),
    "--date=unix",
    "--no-show-signature",
    "--no-color",
    "-z",
    REFLOG_FORMAT,
    "--end-of-options",
    ref,
    "--",
  ];
}

/**
 * Which of `hashes` are reachable from no branch, tag, remote-tracking ref,
 * or HEAD. `rev-list` prints every commit reachable from the candidates but
 * not from those refs, so a candidate in the output is lost.
 */
export function unreachableArgs(hashes) {
  return ["rev-list", "--not", "--branches", "--tags", "--remotes", "HEAD", "--not", ...hashes];
}

/**
 * Classify a reflog message (`%gs`) into the operation that moved the ref.
 * `rewrites` marks operations that can leave the previous tip unreachable.
 *
 * @param {string} message
 */
export function classifyReflogMessage(message) {
  const head = message.split(":", 1)[0].trim().toLowerCase();
  let action = "other";
  if (head === "commit (amend)") action = "amend";
  else if (head === "commit (merge)") action = "merge";
  else if (head.startsWith("commit")) action = "commit";
  else if (head.startsWith("rebase")) action = "rebase";
  else if (head.startsWith("reset")) action = "reset";
  else if (head.startsWith("checkout") || head.startsWith("switch")) action = "checkout";
  else if (head.startsWith("merge")) action = "merge";
  else if (head.startsWith("pull")) action = "pull";
  else if (head.startsWith("cherry-pick")) action = "cherry-pick";
  else if (head.startsWith("revert")) action = "revert";
  else if (head.startsWith("branch")) action = "branch";
  else if (head.startsWith("fetch")) action = "fetch";
  else if (head.startsWith("update by push") || head.startsWith("push")) action = "push";
  else if (head.startsWith("clone")) action = "clone";
  return { action, rewrites: action === "amend" || action === "rebase" || action === "reset" };
}

/**
 * Parse `reflogArgs` output: NUL-separated fields, NUL-terminated records,
 * a fixed field count per record. None of the fields can contain NUL, so a
 * record whose hash field is not a hash means the stream is misaligned and
 * parsing stops rather than guessing.
 *
 * @param {string} stdout
 */
export function parseReflogRecords(stdout) {
  const fields = stdout.split("\0");
  if (fields.length > 0 && fields[fields.length - 1].replace(/\n$/, "") === "") fields.pop();
  const records = [];
  for (let i = 0; i + REFLOG_FIELD_COUNT <= fields.length; i += REFLOG_FIELD_COUNT) {
    // `-z` separates records with NUL, but a tformat newline can lead the next one.
    const [hashField, parents, author, authorDate, subject, selector, message, actor, actorEmail] = fields.slice(
      i,
      i + REFLOG_FIELD_COUNT,
    );
    const hash = hashField.replace(/^\n/, "");
    if (!HASH_PATTERN.test(hash)) break;
    const stamp = /@\{(\d+)\}$/.exec(selector);
    records.push({
      hash,
      parents: parents ? parents.split(" ").filter(Boolean) : [],
      author,
      authorDate,
      subject,
      message,
      actor,
      actorEmail,
      movedAt: stamp ? new Date(Number(stamp[1]) * 1000).toISOString() : null,
    });
  }
  return records;
}

/** Short display name of a reflog ref (`refs/heads/main` → `main`). */
export function shortReflogRef(ref) {
  if (ref.startsWith("refs/heads/")) return ref.slice("refs/heads/".length);
  if (ref.startsWith("refs/remotes/")) return ref.slice("refs/remotes/".length);
  return ref;
}

// ─── Service methods ────────────────────────────────────────────────────────

/**
 * @param {{ gitTimeoutMs: number }} config
 */
export function createExplorerMethods(config) {
  return {
    /**
     * GET /api/repos/:id/tree?commit=<oid>&path=<dir>
     * One directory of the commit's tree ("" or omitted = repository root).
     */
    async getTree(repo, query) {
      const params = readSingleParams(query, ["commit", "path"]);
      if (!params.ok) return badRequest(params.error);
      const commit = await checkCommitObject(repo, params.value.commit, config.gitTimeoutMs);
      if (!commit.ok) return commit.result;
      const dirPath = parsePathQuery(params.value.path);
      if (!dirPath.ok) return badRequest(dirPath.error);

      let treeish = commit.hash;
      if (dirPath.value) {
        const object = await lookupPathObject(repo, commit.hash, dirPath.value, config.gitTimeoutMs);
        if (!object) return { status: 404, body: { error: "Path not found at this commit" } };
        if (object.type !== "tree") return badRequest("Path is not a directory at this commit");
        treeish = object.objectId;
      }

      const { stdout, truncated: byteTruncated } = await runGit(repo, treeListArgs(treeish), {
        timeoutMs: config.gitTimeoutMs,
        maxBytes: TREE_MAX_BYTES,
        allowTruncatedStdout: true,
      });
      const entries = parseTreeEntries(stdout, dirPath.value);
      const truncated = byteTruncated || entries.length > TREE_MAX_ENTRIES;
      return {
        status: 200,
        body: {
          commit: commit.hash,
          path: dirPath.value,
          entries: entries.slice(0, TREE_MAX_ENTRIES),
          truncated,
        },
      };
    },

    /**
     * GET /api/repos/:id/tree/paths?commit=<oid>
     * Every file path in the commit's tree, for a "go to file" finder.
     */
    async getTreePaths(repo, query) {
      const params = readSingleParams(query, ["commit"]);
      if (!params.ok) return badRequest(params.error);
      const commit = await checkCommitObject(repo, params.value.commit, config.gitTimeoutMs);
      if (!commit.ok) return commit.result;

      const { stdout, truncated: byteTruncated } = await runGit(repo, treePathsArgs(commit.hash), {
        timeoutMs: config.gitTimeoutMs,
        maxBytes: TREE_PATHS_MAX_BYTES,
        allowTruncatedStdout: true,
      });
      const records = stdout.split("\0");
      // The last record is either the empty tail after the final NUL or a
      // path cut by the byte cap; neither is a complete path.
      records.pop();
      const truncated = byteTruncated || records.length > TREE_PATHS_MAX;
      return {
        status: 200,
        body: {
          commit: commit.hash,
          paths: records.slice(0, TREE_PATHS_MAX),
          truncated,
        },
      };
    },

    /**
     * GET /api/repos/:id/code-search?commit=<oid>&q=<pattern>
     *   [&mode=fixed|regex][&ignoreCase=1][&path=<dir-or-file>][&limit=N]
     */
    async searchCode(repo, query) {
      const params = readSingleParams(query, ["commit", "q", "mode", "ignoreCase", "path", "limit"]);
      if (!params.ok) return badRequest(params.error);
      const values = params.value;
      const pattern = parsePatternQuery(values.q);
      if (!pattern.ok) return badRequest("Invalid q parameter");
      if (!pattern.value) return badRequest("Missing q parameter");
      const mode = values.mode || "fixed";
      if (!CODE_SEARCH_MODES.has(mode)) return badRequest("Invalid mode parameter");
      const ignoreCase = parseFlagQuery(values.ignoreCase, "ignoreCase");
      if (!ignoreCase.ok) return badRequest(ignoreCase.error);
      const scope = parsePathQuery(values.path);
      if (!scope.ok) return badRequest(scope.error);
      const limit = parseLimitQuery(values.limit || undefined, CODE_SEARCH_DEFAULT_LIMIT, CODE_SEARCH_MAX_LIMIT);
      if (!limit.ok) return badRequest(limit.error);
      const commit = await checkCommitObject(repo, values.commit, config.gitTimeoutMs);
      if (!commit.ok) return commit.result;

      let stdout = "";
      let byteTruncated = false;
      try {
        ({ stdout, truncated: byteTruncated } = await runGit(
          repo,
          codeSearchArgs({
            commit: commit.hash,
            pattern: pattern.value,
            mode,
            ignoreCase: ignoreCase.value,
            pathspec: scope.value ? `:(literal,top)${scope.value}` : null,
          }),
          { timeoutMs: config.gitTimeoutMs, maxBytes: CODE_SEARCH_MAX_BYTES, allowTruncatedStdout: true },
        ));
      } catch (error) {
        if (error instanceof GitCommandError && error.timedOut) {
          return { status: 504, body: { error: "Code search timed out; narrow the path or pattern" } };
        }
        // Exit 1 is "no match"; 128 with an empty result is a bad regex.
        if (error instanceof GitCommandError && error.exitCode === 1) {
          stdout = "";
        } else if (error instanceof GitCommandError && mode === "regex" && error.exitCode === 128 && /-e option/.test(error.stderr)) {
          // "fatal: -e option, '<pattern>': <reason>" — keep only the reason.
          const reason = /': ([^\n]+)$/.exec(error.stderr.trim())?.[1];
          return badRequest(reason ? `Invalid regular expression: ${reason.slice(0, 120)}` : "Invalid regular expression");
        } else {
          throw error;
        }
      }
      const { matches, limited } = parseCodeSearchOutput(stdout, commit.hash, limit.value);
      return {
        status: 200,
        body: {
          commit: commit.hash,
          query: pattern.value,
          mode,
          ignoreCase: ignoreCase.value,
          path: scope.value,
          matches,
          fileCount: new Set(matches.map((match) => match.path)).size,
          truncated: limited || byteTruncated,
          perFileLimit: CODE_SEARCH_PER_FILE,
        },
      };
    },

    /**
     * GET /api/repos/:id/reflog?ref=HEAD|refs/heads/<b>|refs/remotes/<r>[&limit][&skip]
     *
     * The ref's reflog, newest first. Each entry carries the operation that
     * moved the ref, the tip it moved to, the tip it moved from (the next
     * older entry), and whether that tip is still reachable from any branch,
     * tag, remote-tracking ref, or HEAD — `reachable: false` is a commit the
     * user can only get back through this reflog.
     */
    async getReflog(repo, query) {
      const params = readSingleParams(query, ["ref", "limit", "skip"]);
      if (!params.ok) return badRequest(params.error);
      const ref = params.value.ref || "HEAD";
      if (
        ref !== "HEAD" &&
        !(isValidGitRef(ref) && isPublicFullRefName(ref) && !ref.startsWith("refs/tags/"))
      ) {
        return badRequest("Invalid ref parameter (use HEAD, refs/heads/<name>, or refs/remotes/<name>)");
      }
      const limit = parseLimitQuery(params.value.limit || undefined, REFLOG_DEFAULT_LIMIT, REFLOG_MAX_LIMIT);
      if (!limit.ok) return badRequest(limit.error);
      const skip = parseSkipQuery(params.value.skip);
      if (!skip.ok) return badRequest(skip.error);

      // A symref would walk another ref's log; only the ref itself is public.
      if (ref !== "HEAD") {
        let fullName = "";
        try {
          ({ stdout: fullName } = await runGit(
            repo,
            ["rev-parse", "--verify", "--quiet", "--symbolic-full-name", "--end-of-options", ref],
            { timeoutMs: config.gitTimeoutMs, maxBytes: 1024 },
          ));
        } catch (error) {
          if (!(error instanceof GitCommandError) || error.timedOut) throw error;
        }
        if (fullName.trim() !== ref) {
          return { status: 404, body: { error: "Ref not found" } };
        }
      }

      let stdout = "";
      try {
        // One extra entry supplies the previous tip of the last row on the page.
        ({ stdout } = await runGit(repo, reflogArgs({ ref, maxCount: limit.value + 1, skip: skip.value }), {
          timeoutMs: config.gitTimeoutMs,
          maxBytes: 4 * 1024 * 1024,
        }));
      } catch (error) {
        // An unborn HEAD or a ref without a log has nothing to walk.
        if (error instanceof GitCommandError && !error.timedOut && !error.truncated && error.exitCode === 128) {
          stdout = "";
        } else {
          throw error;
        }
      }
      const records = parseReflogRecords(stdout);
      const hasMore = records.length > limit.value;
      const page = records.slice(0, limit.value);

      const reachability = await readReachability(
        repo,
        [...new Set(records.map((record) => record.hash))],
        config.gitTimeoutMs,
      );
      const short = shortReflogRef(ref);
      const entries = page.map((record, i) => {
        const index = skip.value + i;
        const { action, rewrites } = classifyReflogMessage(record.message);
        const previous = records[i + 1];
        return {
          index,
          selector: `${short}@{${index}}`,
          hash: record.hash,
          previousHash: previous ? previous.hash : null,
          parents: record.parents,
          author: record.author,
          authorDate: record.authorDate,
          subject: record.subject,
          message: record.message,
          action,
          rewrites,
          actor: record.actor,
          movedAt: record.movedAt,
          reachable: reachability.get(record.hash) ?? null,
          previousReachable: previous ? reachability.get(previous.hash) ?? null : null,
        };
      });
      return {
        status: 200,
        body: {
          ref,
          entries,
          hasMore,
          skip: skip.value,
          limit: limit.value,
          lostCount: new Set(entries.filter((entry) => entry.reachable === false).map((entry) => entry.hash)).size,
        },
      };
    },
  };
}

/**
 * Map each hash to true (reachable from a branch/tag/remote/HEAD), false
 * (lost), or leave it out when that could not be decided (rev-list failed,
 * e.g. an unborn HEAD, or its output was cut short).
 */
async function readReachability(repo, hashes, timeoutMs) {
  const result = new Map();
  if (hashes.length === 0) return result;
  try {
    const { stdout, truncated } = await runGit(repo, unreachableArgs(hashes), {
      timeoutMs,
      maxBytes: REACHABILITY_MAX_BYTES,
      allowTruncatedStdout: true,
    });
    const lost = new Set(stdout.split("\n").filter((line) => HASH_PATTERN.test(line)));
    for (const hash of hashes) {
      if (lost.has(hash)) result.set(hash, false);
      else if (!truncated) result.set(hash, true);
    }
  } catch (error) {
    if (!(error instanceof GitCommandError)) throw error;
  }
  return result;
}
