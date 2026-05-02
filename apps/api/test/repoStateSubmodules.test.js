import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitService } from "../src/gitService.js";
import { runGit } from "../src/gitRunner.js";

test("getRepoState returns no operations on a clean repo", async () => {
  const repoPath = createTempPath("rtgv-state-clean-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");

    const service = createGitService(makeConfig());
    const result = await service.getRepoState(makeRepo(repoPath));

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.operations, []);
    assert.match(result.body.gitDir, /\.git$/);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getRepoState detects MERGE_HEAD with target hash and message", async () => {
  const repoPath = createTempPath("rtgv-state-merge-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");
    const dummyHash = "0".repeat(40);
    fs.writeFileSync(path.join(repoPath, ".git/MERGE_HEAD"), `${dummyHash}\n`);
    fs.writeFileSync(path.join(repoPath, ".git/MERGE_MSG"), "Merge branch 'feature'\n");

    const service = createGitService(makeConfig());
    const result = await service.getRepoState(makeRepo(repoPath));

    assert.equal(result.status, 200);
    assert.equal(result.body.operations.length, 1);
    const [op] = result.body.operations;
    assert.equal(op.kind, "merge");
    assert.equal(op.targetHash, dummyHash);
    assert.match(op.message, /Merge branch 'feature'/);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getRepoState detects rebase via rebase-merge directory", async () => {
  const repoPath = createTempPath("rtgv-state-rebase-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");
    const rebaseDir = path.join(repoPath, ".git/rebase-merge");
    fs.mkdirSync(rebaseDir);
    fs.writeFileSync(path.join(rebaseDir, "head-name"), "refs/heads/feature\n");
    fs.writeFileSync(path.join(rebaseDir, "onto"), "abcdef0\n");

    const service = createGitService(makeConfig());
    const result = await service.getRepoState(makeRepo(repoPath));

    const rebase = result.body.operations.find((op) => op.kind === "rebase");
    assert.ok(rebase, "rebase operation should be detected");
    assert.equal(rebase.backend, "merge");
    assert.equal(rebase.headName, "refs/heads/feature");
    assert.equal(rebase.onto, "abcdef0");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getRepoState detects bisect via BISECT_LOG presence", async () => {
  const repoPath = createTempPath("rtgv-state-bisect-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");
    fs.writeFileSync(path.join(repoPath, ".git/BISECT_LOG"), "git bisect start\n");
    fs.writeFileSync(path.join(repoPath, ".git/BISECT_START"), "main\n");

    const service = createGitService(makeConfig());
    const result = await service.getRepoState(makeRepo(repoPath));

    const bisect = result.body.operations.find((op) => op.kind === "bisect");
    assert.ok(bisect, "bisect operation should be detected");
    assert.equal(bisect.start, "main");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("listSubmodules returns empty list when no submodules are configured", async () => {
  const repoPath = createTempPath("rtgv-submod-empty-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");

    const service = createGitService(makeConfig());
    const result = await service.listSubmodules(makeRepo(repoPath));

    assert.equal(result.status, 200);
    assert.deepEqual(result.body.submodules, []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("listSubmodules surfaces hash, path, and initialized flag for an added submodule", async () => {
  const upstreamPath = createTempPath("rtgv-submod-upstream-");
  const repoPath = createTempPath("rtgv-submod-host-");
  try {
    initRepo(upstreamPath);
    writeAndCommit(upstreamPath, "lib.txt", "v1\n", "chore: lib v1");
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "host\n", "chore: seed");
    // Allow file:// submodule sources for the test (Git 2.38+ defaults to deny).
    git(repoPath, "-c", "protocol.file.allow=always", "submodule", "add", upstreamPath, "vendor/lib");
    git(repoPath, "commit", "-m", "feat: add submodule");

    const service = createGitService(makeConfig());
    const result = await service.listSubmodules(makeRepo(repoPath));

    assert.equal(result.status, 200);
    assert.equal(result.body.submodules.length, 1);
    const [sub] = result.body.submodules;
    assert.equal(sub.path, "vendor/lib");
    assert.match(sub.hash, /^[0-9a-f]{40}$/);
    assert.equal(sub.shortHash, sub.hash.slice(0, 7));
    assert.equal(sub.initialized, true);
    assert.equal(sub.uninitialized, false);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
    fs.rmSync(upstreamPath, { recursive: true, force: true });
  }
});

test("runGit rejects mutating submodule subcommands", async () => {
  const repoPath = createTempPath("rtgv-submod-guard-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "v1\n", "chore: seed");
    await assert.rejects(
      async () => runGit(makeRepo(repoPath), ["submodule", "deinit", "any"]),
      /Git subcommand is not allowed/,
    );
    await assert.rejects(
      async () => runGit(makeRepo(repoPath), ["submodule", "update"]),
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
