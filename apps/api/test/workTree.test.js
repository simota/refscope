import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGitService,
  workTreeNumstatArgs,
  workTreePatchArgs,
} from "../src/gitService.js";

test("workTreeNumstatArgs uses --cached only when staged, with hardening flags", () => {
  const staged = workTreeNumstatArgs({ staged: true });
  assert.equal(staged[0], "diff");
  assert.ok(staged.includes("--cached"));
  assert.ok(staged.includes("--numstat"));
  assert.ok(staged.includes("--no-renames"));
  assert.ok(staged.includes("--no-ext-diff"));
  assert.ok(staged.includes("--no-textconv"));
  assert.ok(staged.includes("--no-color"));
  // Option parsing must terminate even though no revision follows — keeps
  // the runner's safety surface uniform with every other call site.
  assert.equal(staged[staged.length - 1], "--end-of-options");

  const unstaged = workTreeNumstatArgs({ staged: false });
  assert.equal(unstaged[0], "diff");
  assert.ok(!unstaged.includes("--cached"));
  assert.ok(unstaged.includes("--numstat"));
});

test("workTreePatchArgs requests rename detection in the patch lane only", () => {
  const staged = workTreePatchArgs({ staged: true });
  assert.equal(staged[0], "diff");
  assert.ok(staged.includes("--cached"));
  assert.ok(staged.includes("--patch"));
  assert.ok(staged.includes("--find-renames"));
  assert.ok(staged.includes("--no-color"));
  assert.ok(staged.includes("--no-ext-diff"));
  assert.ok(staged.includes("--no-textconv"));
  assert.equal(staged[staged.length - 1], "--end-of-options");

  const unstaged = workTreePatchArgs({ staged: false });
  assert.ok(!unstaged.includes("--cached"));
  assert.ok(unstaged.includes("--patch"));
});

test("getWorkTreeChanges returns zero summaries on a clean working tree", async () => {
  const repoPath = createTempPath("rtgv-worktree-clean-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.staged.diff, "");
    assert.equal(result.body.unstaged.diff, "");
    assert.deepEqual(result.body.staged.summary, {
      added: 0,
      deleted: 0,
      fileCount: 0,
    });
    assert.deepEqual(result.body.unstaged.summary, {
      added: 0,
      deleted: 0,
      fileCount: 0,
    });
    assert.equal(result.body.staged.truncated, false);
    assert.equal(result.body.unstaged.truncated, false);
    assert.equal(result.body.notes.untrackedExcluded, true);
    assert.match(result.body.snapshotAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getWorkTreeChanges separates unstaged-only changes into the unstaged side", async () => {
  const repoPath = createTempPath("rtgv-worktree-unstaged-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.txt", "v1\n", "feat: seed foo");
    // Modify without staging — should land in unstaged.diff only.
    fs.writeFileSync(path.join(repoPath, "src/foo.txt"), "v1\nadded line\n");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    // Staged side is empty.
    assert.equal(result.body.staged.diff, "");
    assert.equal(result.body.staged.summary.fileCount, 0);
    // Unstaged side surfaces the literal diff.
    assert.ok(result.body.unstaged.diff.includes("diff --git"));
    assert.ok(result.body.unstaged.diff.includes("src/foo.txt"));
    assert.ok(result.body.unstaged.diff.includes("+added line"));
    assert.equal(result.body.unstaged.summary.fileCount, 1);
    assert.equal(result.body.unstaged.summary.added, 1);
    assert.equal(result.body.unstaged.summary.deleted, 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getWorkTreeChanges separates staged-only changes into the staged side", async () => {
  const repoPath = createTempPath("rtgv-worktree-staged-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.txt", "v1\n", "feat: seed foo");
    // Modify and stage — should land only in staged.diff.
    fs.writeFileSync(path.join(repoPath, "src/foo.txt"), "v2\n");
    git(repoPath, "add", "src/foo.txt");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.unstaged.diff, "");
    assert.equal(result.body.unstaged.summary.fileCount, 0);
    assert.ok(result.body.staged.diff.includes("diff --git"));
    assert.ok(result.body.staged.diff.includes("src/foo.txt"));
    assert.ok(result.body.staged.diff.includes("-v1"));
    assert.ok(result.body.staged.diff.includes("+v2"));
    assert.equal(result.body.staged.summary.fileCount, 1);
    assert.equal(result.body.staged.summary.added, 1);
    assert.equal(result.body.staged.summary.deleted, 1);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getWorkTreeChanges returns both sides when staged and unstaged changes coexist", async () => {
  const repoPath = createTempPath("rtgv-worktree-both-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/staged.txt", "s0\n", "feat: seed staged");
    writeAndCommit(repoPath, "src/unstaged.txt", "u0\n", "feat: seed unstaged");
    // Stage one file's modification.
    fs.writeFileSync(path.join(repoPath, "src/staged.txt"), "s1\n");
    git(repoPath, "add", "src/staged.txt");
    // Modify the other without staging.
    fs.writeFileSync(path.join(repoPath, "src/unstaged.txt"), "u0\nfresh\n");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.staged.summary.fileCount, 1);
    assert.equal(result.body.unstaged.summary.fileCount, 1);
    assert.ok(result.body.staged.diff.includes("src/staged.txt"));
    assert.ok(!result.body.staged.diff.includes("src/unstaged.txt"));
    assert.ok(result.body.unstaged.diff.includes("src/unstaged.txt"));
    assert.ok(!result.body.unstaged.diff.includes("src/staged.txt"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getWorkTreeChanges surfaces Git's literal rename similarity in the staged patch", async () => {
  const repoPath = createTempPath("rtgv-worktree-rename-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/old-name.txt", "console.log(1);\n".repeat(8), "feat: add old-name");
    // Stage a rename — Git's diff --cached --find-renames should emit the
    // "rename from / rename to" markers verbatim.
    git(repoPath, "mv", "src/old-name.txt", "src/new-name.txt");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    // Patch text carries Git's similarity index — refscope never re-judges
    // renames, it transcribes them.
    assert.match(result.body.staged.diff, /similarity index \d+%/);
    assert.match(result.body.staged.diff, /rename from src\/old-name\.txt/);
    assert.match(result.body.staged.diff, /rename to src\/new-name\.txt/);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getWorkTreeChanges does not surface untracked files in either patch", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    // Drop a brand-new untracked file — Git's `diff` (without --cached and
    // without `--no-index`, which the runner blocks) does not report new
    // untracked content. This locks in the MVP boundary: refscope only
    // observes tracked changes.
    fs.writeFileSync(path.join(repoPath, "untracked.txt"), "this should not appear\n");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.staged.summary.fileCount, 0);
    assert.equal(result.body.unstaged.summary.fileCount, 0);
    assert.ok(!result.body.staged.diff.includes("untracked.txt"));
    assert.ok(!result.body.unstaged.diff.includes("untracked.txt"));
    assert.equal(result.body.notes.untrackedExcluded, true);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(
    result.status,
    0,
    `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`,
  );
  return result.stdout;
}

function createTempPath(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function initRepo(repoPath, userName, userEmail) {
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", userName);
  git(repoPath, "config", "user.email", userEmail);
}

function writeAndCommit(repoPath, relPath, content, message) {
  const target = path.join(repoPath, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  git(repoPath, "add", relPath);
  git(repoPath, "commit", "-m", message);
}
