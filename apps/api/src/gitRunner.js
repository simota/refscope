import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ALLOWED_GIT_COMMANDS = new Set([
  "cat-file",
  "diff",
  "for-each-ref",
  "log",
  "merge-base",
  "rev-list",
  "rev-parse",
  "show",
  "stash",
  "worktree",
]);

// Some Git porcelain commands have both read and write subcommands. The
// runner allowlist gates the top-level command, but we layer a second
// allowlist here so a future caller can't accidentally invoke `stash drop`
// or `worktree remove` through this same gate. Commands not present in this
// map have no subcommand restriction (e.g. `log`, `diff`).
const ALLOWED_GIT_SUBCOMMANDS = new Map([
  ["stash", new Set(["list"])],
  ["worktree", new Set(["list"])],
]);
const MAX_TIMEOUT_MS = 2_147_483_647;
export const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

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

export function runGit(repo, args, options = {}) {
  const timeoutMs = options.timeoutMs ?? 5000;
  const maxBytes = options.maxBytes ?? 256_000;

  validateGitLimits({ timeoutMs, maxBytes });
  validateGitRepo(repo);
  validateGitArgs(args);

  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-pager", ...args], {
      cwd: repo.path,
      env: buildGitEnv(process.env),
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let timedOut = false;
    let truncated = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > maxBytes) {
        truncated = true;
        child.kill("SIGTERM");
        return;
      }
      stdout += chunk.toString("utf8");
    });

    child.stderr.on("data", (chunk) => {
      stderrBytes += chunk.length;
      if (stderrBytes > maxBytes) {
        truncated = true;
        child.kill("SIGTERM");
        return;
      }
      stderr += chunk.toString("utf8");
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);
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
      resolve({ stdout, stderr });
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

export function buildGitEnv(sourceEnv) {
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
  return env;
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
}
