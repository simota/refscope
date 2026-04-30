import { GitCommandError, runGit } from "./gitRunner.js";
import {
  isValidGitRef,
  isValidObjectId,
  parseAuthorQuery,
  parseLimitQuery,
  parsePathQuery,
  parseSearchQuery,
} from "./validation.js";

const COMMIT_FIELD_SEPARATOR = "\u0000";
const COMMIT_RECORD_SEPARATOR = "\u001e";

export function createGitService(config) {
  async function listRefs(repo) {
    const { stdout } = await runGit(
      repo,
      [
        "for-each-ref",
        "--format=%(refname)%00%(objectname)%00%(committerdate:iso-strict)",
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
        const [name, hash, updatedAt] = line.split(COMMIT_FIELD_SEPARATOR);
        return {
          name,
          shortName: shortRefName(name),
          hash,
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
        `--format=${COMMIT_RECORD_SEPARATOR}%H%x00%P%x00%an%x00%aI%x00%s%x00%D%x00%G?`,
        "--numstat",
        `${fromHash}..${toHash}`,
        "--",
      ],
      { timeoutMs: config.gitTimeoutMs },
    );

    return parseCommitRecords(stdout).reverse();
  }

  async function isAncestor(repo, oldHash, newHash) {
    try {
      await runGit(repo, ["merge-base", "--is-ancestor", oldHash, newHash], {
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

      const searchArgs = search.value
        ? ["--regexp-ignore-case", "--fixed-strings", `--grep=${search.value}`]
        : [];
      const authorArgs = author.value
        ? ["--regexp-ignore-case", `--author=${escapeGitRegexLiteral(author.value)}`]
        : [];
      const pathArgs = path.value ? [formatLiteralPathspec(path.value)] : [];

      const { stdout } = await runGit(
        repo,
        [
          "log",
          `--max-count=${limit.value}`,
          "--date=iso-strict",
          ...searchArgs,
          ...authorArgs,
          `--format=${COMMIT_RECORD_SEPARATOR}%H%x00%P%x00%an%x00%aI%x00%s%x00%D%x00%G?`,
          "--numstat",
          ref,
          "--",
          ...pathArgs,
        ],
        { timeoutMs: config.gitTimeoutMs },
      );

      return { status: 200, body: parseCommitRecords(stdout) };
    },

    async getCommit(repo, hash) {
      if (!isValidObjectId(hash)) {
        return { status: 400, body: { error: "Invalid commit hash" } };
      }

      const [metadata, numstat, nameStatus] = await Promise.all([
        runGit(
          repo,
          [
            "show",
            "-s",
            "--date=iso-strict",
            "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D%x00%G?",
            hash,
          ],
          { timeoutMs: config.gitTimeoutMs },
        ),
        runGit(
          repo,
          ["show", "--format=", "--numstat", "--find-renames", "--no-color", hash, "--"],
          { timeoutMs: config.gitTimeoutMs, maxBytes: config.diffMaxBytes },
        ),
        runGit(
          repo,
          ["show", "--format=", "--name-status", "--find-renames", "--no-color", hash, "--"],
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

      const { stdout } = await runGit(
        repo,
        [
          "show",
          "--format=",
          "--no-ext-diff",
          "--patch",
          "--find-renames",
          "--stat",
          "--no-color",
          hash,
        ],
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

    async compareRefs(repo, query) {
      const queryValues = readCompareQuery(query);
      if (!queryValues.ok) {
        return { status: 400, body: { error: queryValues.error } };
      }

      const { base, target } = queryValues.value;
      const [ahead, behind, numstat, mergeBase] = await Promise.all([
        runGit(repo, ["rev-list", "--count", `${base}..${target}`], {
          timeoutMs: config.gitTimeoutMs,
        }),
        runGit(repo, ["rev-list", "--count", `${target}..${base}`], {
          timeoutMs: config.gitTimeoutMs,
        }),
        runGit(repo, ["diff", "--numstat", "--no-ext-diff", "--no-color", `${base}..${target}`, "--"], {
          timeoutMs: config.gitTimeoutMs,
          maxBytes: config.diffMaxBytes,
        }),
        readMergeBase(repo, base, target, config.gitTimeoutMs),
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
            log: `git log --oneline ${base}..${target}`,
            stat: `git diff --stat ${base}..${target}`,
            diff: `git diff ${base}..${target}`,
          },
        },
      };
    },
  };
}

async function readMergeBase(repo, base, target, timeoutMs) {
  try {
    const { stdout } = await runGit(repo, ["merge-base", base, target], { timeoutMs });
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
  for (const name of ["limit", "ref", "search", "author", "path"]) {
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
  const path = parts.at(-1);
  return {
    path,
    added: parseStatCount(parts[0]),
    deleted: parseStatCount(parts[1]),
  };
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

function refType(refName) {
  if (refName.startsWith("refs/heads/")) return "branch";
  if (refName.startsWith("refs/tags/")) return "tag";
  if (refName.startsWith("refs/remotes/")) return "remote";
  return "other";
}

export function escapeGitRegexLiteral(value) {
  return value.replace(/[.[\](){}?*+^$|\\]/g, "\\$&");
}

export function formatLiteralPathspec(value) {
  return `:(literal,top)${value}`;
}
