import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ALLOWED_GIT_COMMANDS = new Set([
  "cat-file",
  "cherry",
  "config",
  "diff",
  "for-each-ref",
  "log",
  "ls-files",
  "merge-base",
  "rev-list",
  "rev-parse",
  "show",
  "stash",
  "submodule",
  "worktree",
]);

// Some Git porcelain commands have both read and write subcommands. The
// runner allowlist gates the top-level command, but we layer a second
// allowlist here so a future caller can't accidentally invoke `stash drop`
// or `worktree remove` through this same gate. Commands not present in this
// map have no subcommand restriction (e.g. `log`, `diff`).
const ALLOWED_GIT_SUBCOMMANDS = new Map([
  ["stash", new Set(["list"])],
  ["submodule", new Set(["status"])],
  ["worktree", new Set(["list"])],
]);
const MAX_TIMEOUT_MS = 2_147_483_647;
export const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;
// Endpoints such as ref drift fan out several git reads per ref. Each child
// holds three pipes, so an unbounded burst exhausts file descriptors; extra
// calls wait for a slot instead. The timeout starts when the child spawns.
export const MAX_CONCURRENT_GIT_PROCESSES = 32;

let runningGitProcesses = 0;
const waitingGitProcesses = [];

function acquireGitSlot() {
  if (runningGitProcesses < MAX_CONCURRENT_GIT_PROCESSES) {
    runningGitProcesses += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => waitingGitProcesses.push(resolve));
}

function releaseGitSlot() {
  const next = waitingGitProcesses.shift();
  if (next) {
    next();
  } else {
    runningGitProcesses -= 1;
  }
}

export class GitCommandError extends Error {
  constructor(message, { exitCode, timedOut, truncated, stderr } = {}) {
    super(message);
    this.name = "GitCommandError";
    this.exitCode = exitCode;
    this.timedOut = Boolean(timedOut);
    this.truncated = Boolean(truncated);
    this.stderr = stderr ?? "";
  }
}

/**
 * @param {{ path: string }} repo
 * @param {string[]} args
 * @param {{ timeoutMs?: number, maxBytes?: number, disableFilterDrivers?: string[], allowTruncatedStdout?: boolean }} [options]
 *   `disableFilterDrivers` names `filter.<driver>` entries to neutralize for
 *   this call. Pass the names from `listFilterDriverNames` to any command that
 *   reads working-tree file content (index-vs-worktree `diff`).
 *   `allowTruncatedStdout` resolves with the first `maxBytes` bytes of stdout
 *   and `truncated: true` instead of rejecting when stdout overflows. Timeouts
 *   and stderr overflow still reject.
 */
export function runGit(repo, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxBytes = options.maxBytes ?? 256_000;
  const disableFilterDrivers = options.disableFilterDrivers ?? [];
  const allowTruncatedStdout = options.allowTruncatedStdout === true;

  validateGitLimits({ timeoutMs, maxBytes });
  validateGitRepo(repo);
  validateGitArgs(args);
  validateFilterDriverNames(disableFilterDrivers);

  return acquireGitSlot().then(() => {
    const run = spawnGit(
      repo,
      args,
      timeoutMs,
      maxBytes,
      filterDriverOverrides(disableFilterDrivers),
      allowTruncatedStdout,
    );
    run.then(releaseGitSlot, releaseGitSlot);
    return run;
  });
}

function spawnGit(repo, args, timeoutMs, maxBytes, configOverrides, allowTruncatedStdout) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-pager", ...args], {
      cwd: repo.path,
      env: buildGitEnv(process.env, configOverrides),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    // A failed spawn (EMFILE, ENOENT, ...) is reported as an 'error' event,
    // possibly without stdio streams. Listen first: an unhandled 'error'
    // event would crash the process.
    let timer;
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    if (!child.stdout || !child.stderr) {
      return;
    }

    // Buffer raw bytes and decode once on close: decoding each chunk on its
    // own corrupts multi-byte UTF-8 characters split across pipe reads.
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let stdoutTruncated = false;
    let stderrTruncated = false;

    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      if (stdoutTruncated) return;
      const room = maxBytes - stdoutBytes;
      stdoutBytes += chunk.length;
      if (chunk.length > room) {
        stdoutTruncated = true;
        // Keep the bytes that still fit so a caller that accepts partial
        // output gets exactly `maxBytes` of it.
        if (room > 0) stdoutChunks.push(chunk.subarray(0, room));
        child.kill("SIGTERM");
        return;
      }
      stdoutChunks.push(chunk);
    });

    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxBytes) {
        stderrTruncated = true;
        child.kill("SIGTERM");
        return;
      }
      stderrChunks.push(chunk);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      // The kill after an stdout overflow makes the exit code meaningless.
      if (stdoutTruncated && allowTruncatedStdout && !timedOut && !stderrTruncated) {
        resolve({ stdout, stderr, truncated: true });
        return;
      }
      const truncated = stdoutTruncated || stderrTruncated;
      if (timedOut || truncated || exitCode !== 0) {
        reject(
          new GitCommandError("Git command failed", {
            exitCode,
            timedOut,
            truncated,
            stderr: stderr.trim(),
          }),
        );
        return;
      }
      resolve({ stdout, stderr, truncated: false });
    });
  });
}

function validateGitRepo(repo) {
  if (!repo || typeof repo.path !== "string" || !path.isAbsolute(repo.path)) {
    throw new Error("Git repository path must be absolute");
  }
  if (!isGitWorkingTreeRoot(repo.path)) {
    throw new Error("Git repository path must be a Git working tree root");
  }
  if (fs.realpathSync(repo.path) !== repo.path) {
    throw new Error("Git repository path must be canonical");
  }
}

function isGitWorkingTreeRoot(repoPath) {
  try {
    const gitDir = fs.statSync(path.join(repoPath, ".git"));
    return gitDir.isDirectory() || gitDir.isFile();
  } catch {
    return false;
  }
}

function validateGitLimits({ timeoutMs, maxBytes }) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error("Git timeoutMs must be a positive safe integer within timer bounds");
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > MAX_GIT_OUTPUT_BYTES) {
    throw new Error("Git maxBytes must be a positive safe integer within output bounds");
  }
}

/**
 * Settings in the repository's own config that make read-only commands run a
 * program. Diff drivers are disabled per call (`--no-ext-diff`,
 * `--no-textconv`); these have no such flag, so they are overridden through
 * GIT_CONFIG_COUNT, which outranks every config file (Git 2.31+). The values
 * are inherited by the child processes Git starts (e.g. inside submodules).
 */
const FORCED_GIT_CONFIG = [
  // Any command that reads the index runs the fsmonitor hook.
  ["core.fsmonitor", "false"],
];

export function buildGitEnv(sourceEnv, configOverrides = []) {
  const env = {};
  for (const [name, value] of Object.entries(sourceEnv)) {
    if (!name.startsWith("GIT_") && !isBlockedSensitiveEnv(name)) {
      env[name] = value;
    }
  }
  env.GIT_NO_REPLACE_OBJECTS = "1";
  env.GIT_NO_LAZY_FETCH = "1";
  env.GIT_TERMINAL_PROMPT = "0";
  env.GIT_PAGER = "cat";
  env.PAGER = "cat";
  env.GIT_OPTIONAL_LOCKS = "0";
  env.GIT_ATTR_NOSYSTEM = "1";
  env.GIT_CONFIG_NOSYSTEM = "1";
  env.GIT_CONFIG_GLOBAL = osNullDevice();
  const forced = [...FORCED_GIT_CONFIG, ...configOverrides];
  env.GIT_CONFIG_COUNT = String(forced.length);
  forced.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}

// A clean/process filter runs whenever Git hashes a working-tree file whose
// stat data changed, and Git has no switch to turn filters off wholesale, so
// each configured driver is blanked by name. An empty command means "no
// filter"; `required=false` keeps Git from failing on the missing one.
function filterDriverOverrides(names) {
  return names.flatMap((name) => [
    [`filter.${name}.clean`, ""],
    [`filter.${name}.smudge`, ""],
    [`filter.${name}.process`, ""],
    [`filter.${name}.required`, "false"],
  ]);
}

function validateFilterDriverNames(names) {
  if (!Array.isArray(names)) {
    throw new Error("Git filter driver names must be an array");
  }
  for (const name of names) {
    // Config subsections cannot contain newlines or NUL; env values cannot
    // carry NUL either.
    if (typeof name !== "string" || name.length === 0 || /[\0\n]/.test(name)) {
      throw new Error("Git filter driver names must be non-empty single-line strings");
    }
  }
}

function isBlockedSensitiveEnv(name) {
  const normalizedName = name.toUpperCase();
  return (
    normalizedName.startsWith("GCM_") ||
    normalizedName === "SSH_AUTH_SOCK" ||
    normalizedName === "SSH_AGENT_PID" ||
    normalizedName === "SSH_ASKPASS" ||
    normalizedName === "SSH_ASKPASS_REQUIRE" ||
    normalizedName === "HTTP_PROXY" ||
    normalizedName === "HTTPS_PROXY" ||
    normalizedName === "ALL_PROXY" ||
    normalizedName === "NO_PROXY"
  );
}

function osNullDevice() {
  return process.platform === "win32" ? "NUL" : "/dev/null";
}

function validateGitArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("Git arguments must be a non-empty array");
  }
  for (const arg of args) {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new Error("Git arguments must be non-empty strings");
    }
  }
  if (args[0] === "-p" || args.includes("--paginate")) {
    throw new Error("Git pager options are not allowed");
  }
  if (args.some((arg) => arg === "--output" || arg.startsWith("--output="))) {
    throw new Error("Git output file options are not allowed");
  }
  if (args.includes("--no-index")) {
    throw new Error("Git no-index diff is not allowed");
  }
  if (args[0].startsWith("-")) {
    throw new Error("Git global options are not allowed");
  }
  if (!ALLOWED_GIT_COMMANDS.has(args[0])) {
    throw new Error("Git command is not allowed");
  }
  const subcommandAllowlist = ALLOWED_GIT_SUBCOMMANDS.get(args[0]);
  if (subcommandAllowlist && !subcommandAllowlist.has(args[1])) {
    throw new Error("Git subcommand is not allowed");
  }
  if (args[0] === "config" && !isReadOnlyConfigLookup(args)) {
    throw new Error("Git config is allowed only as a read-only lookup");
  }
}

// `git config` both reads and writes depending on its arguments. Only the
// exact lookup shape `config [-z] [--name-only] --get-regexp <pattern>` is
// accepted: one positional (the name pattern) can never form a write, and a
// pattern that starts with `-` would be parsed as another option.
function isReadOnlyConfigLookup(args) {
  const rest = args.slice(1);
  const getIndex = rest.indexOf("--get-regexp");
  if (getIndex === -1 || getIndex !== rest.length - 2) return false;
  if (rest[getIndex + 1].startsWith("-")) return false;
  return rest.slice(0, getIndex).every((arg) => arg === "-z" || arg === "--name-only");
}
