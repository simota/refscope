import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitService } from "../src/gitService.js";
import { runGit } from "../src/gitRunner.js";

test("listStashes returns an empty list when no stash entries exist", async () => {
  const repoPath = createTempPath("rtgv-stashes-empty-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");

    const service = createGitService(makeConfig());
    const result = await service.listStashes(makeRepo(repoPath));

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.stashes, []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("listStashes surfaces stash@{0} with hash, subject, and ISO timestamp", async () => {
  const repoPath = createTempPath("rtgv-stashes-one-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");
    fs.writeFileSync(path.join(repoPath, "README.md"), "v1\nWIP line\n");
    git(repoPath, "stash", "push", "-m", "wip readme tweak");

    const service = createGitService(makeConfig());
    const result = await service.listStashes(makeRepo(repoPath));

    assert.equal(result.status, 200);
    assert.equal(result.body.stashes.length, 1);
    const [entry] = result.body.stashes;
    assert.equal(entry.name, "stash@{0}");
    assert.match(entry.hash, /^[0-9a-f]{40}$/);
    assert.equal(entry.shortHash, entry.hash.slice(0, 7));
    assert.match(entry.committedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.match(entry.subject, /wip readme tweak/);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("listWorktrees marks the primary worktree and includes linked worktrees", async () => {
  const repoPath = createTempPath("rtgv-worktrees-");
  const linkedPath = createTempPath("rtgv-worktrees-linked-");
  // We immediately remove the empty linked dir because `git worktree add`
  // requires the target not to exist.
  fs.rmSync(linkedPath, { recursive: true, force: true });
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");
    git(repoPath, "branch", "feature");
    git(repoPath, "worktree", "add", linkedPath, "feature");

    const service = createGitService(makeConfig());
    const result = await service.listWorktrees(makeRepo(repoPath));

    assert.equal(result.status, 200);
    assert.equal(result.body.worktrees.length, 2);
    const primary = result.body.worktrees.find((w) => w.path === repoPath);
    assert.ok(primary, "primary worktree should be present");
    assert.equal(primary.isPrimary, true);
    assert.equal(primary.branchShortName, "main");

    const linked = result.body.worktrees.find(
      (w) => w.path === fs.realpathSync(linkedPath),
    );
    assert.ok(linked, "linked worktree should be present");
    assert.equal(linked.isPrimary, false);
    assert.equal(linked.branchShortName, "feature");
    assert.match(linked.head, /^[0-9a-f]{40}$/);
  } finally {
    fs.rmSync(linkedPath, { recursive: true, force: true });
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("runGit rejects mutating stash subcommands even when stash is allowlisted", async () => {
  const repoPath = createTempPath("rtgv-stash-guard-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");
    // `runGit` throws synchronously on validation failure (the Promise body
    // never runs). Wrapping in `async` converts that to a rejection so
    // `assert.rejects` can match against it.
    await assert.rejects(
      async () => runGit(makeRepo(repoPath), ["stash", "drop"]),
      /Git subcommand is not allowed/,
    );
    await assert.rejects(
      async () => runGit(makeRepo(repoPath), ["stash", "clear"]),
      /Git subcommand is not allowed/,
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("runGit rejects mutating worktree subcommands", async () => {
  const repoPath = createTempPath("rtgv-worktree-guard-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");
    await assert.rejects(
      async () => runGit(makeRepo(repoPath), ["worktree", "remove", "any"]),
      /Git subcommand is not allowed/,
    );
    await assert.rejects(
      async () => runGit(makeRepo(repoPath), ["worktree", "add", "any"]),
      /Git subcommand is not allowed/,
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

function makeConfig() {
  return {
    repositories: new Map(),
    gitTimeoutMs: 5000,
    diffMaxBytes: 65_536,
  };
}

function makeRepo(repoPath) {
  return { id: "demo", name: "demo", path: repoPath };
}

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

function initRepo(repoPath) {
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Alice");
  git(repoPath, "config", "user.email", "alice@example.test");
}

function writeAndCommit(repoPath, relPath, content, message) {
  const target = path.join(repoPath, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  git(repoPath, "add", relPath);
  git(repoPath, "commit", "-m", message);
}
