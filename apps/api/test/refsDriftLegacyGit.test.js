// Runs in its own file: a Git without the `ahead-behind` for-each-ref atom
// (before 2.41) flips a process-wide switch in gitService.js, and every later
// drift read in the same process takes the per-ref path.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitService } from "../src/gitService.js";

test("getRefDrift and branch groups fall back to per-ref reads on a Git without ahead-behind", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-legacy-");
  const binDir = createTempPath("rtgv-legacy-git-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Alice");
    git(repoPath, "config", "user.email", "alice@example.test");
    commit(repoPath, "seed.txt", "chore: seed");
    git(repoPath, "checkout", "-b", "feat/a");
    commit(repoPath, "a.txt", "feat: a");
    git(repoPath, "checkout", "main");
    commit(repoPath, "m.txt", "fix: m");
    git(repoPath, "branch", "feat/old", "HEAD~1");

    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 65_536 });
    const repo = { id: "demo", name: "demo", path: repoPath };
    const expected = await service.getRefDrift(repo, new URLSearchParams());
    const expectedGroups = await service.getBranchGroupHealth(repo, new URLSearchParams({ prefix: "feat/" }));
    assert.equal(expected.status, 200);
    assert.equal(expectedGroups.status, 200);

    // Answers like Git 2.40 for the atom, and logs every for-each-ref format
    // so the test can see the batch was tried once and then skipped.
    const realGit = spawnSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).stdout.trim();
    const logPath = path.join(binDir, "calls.log");
    fs.writeFileSync(
      path.join(binDir, "git"),
      `#!/bin/sh
for arg in "$@"; do
  case "$arg" in
    *ahead-behind*)
      echo batch >> "${logPath}"
      echo "fatal: unknown field name: ahead-behind:x" >&2
      exit 128 ;;
  esac
done
exec "${realGit}" "$@"
`,
      { mode: 0o755 },
    );
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
    try {
      const legacy = await service.getRefDrift(repo, new URLSearchParams());
      const legacyGroups = await service.getBranchGroupHealth(repo, new URLSearchParams({ prefix: "feat/" }));
      assert.deepEqual(legacy, expected);
      assert.deepEqual(stripVolatile(legacyGroups), stripVolatile(expectedGroups));
      const again = await service.getRefDrift(repo, new URLSearchParams());
      assert.deepEqual(again, expected);
    } finally {
      process.env.PATH = originalPath;
    }
    assert.equal(fs.readFileSync(logPath, "utf8"), "batch\n");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
    fs.rmSync(binDir, { recursive: true, force: true, maxRetries: 10 });
  }
});

function stripVolatile(result) {
  return {
    ...result,
    body: { ...result.body, branches: result.body.branches.map(({ daysSinceLast: _d, rotScore: _r, ...rest }) => rest) },
  };
}

function commit(repoPath, file, message) {
  fs.writeFileSync(path.join(repoPath, file), `${message}\n`);
  git(repoPath, "add", file);
  git(repoPath, "commit", "-q", "-m", message);
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function createTempPath(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}
