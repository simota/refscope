import { spawn } from "node:child_process";

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

  validateGitArgs(args);

  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd: repo.path,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
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

function validateGitArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    throw new Error("Git arguments must be a non-empty array");
  }
  for (const arg of args) {
    if (typeof arg !== "string" || arg.length === 0) {
      throw new Error("Git arguments must be non-empty strings");
    }
  }
}
