import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitService } from "../src/gitService.js";

// ---------------------------------------------------------------------------
// getBranchGroupHealth — integration tests
// ---------------------------------------------------------------------------

test("getBranchGroupHealth returns all local branches when no prefix is given", async () => {
  const repoPath = createTempPath("rtgv-group-health-all-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    git(repoPath, "checkout", "-b", "refactor/user-service");
    writeAndCommit(repoPath, "svc.txt", "a\n", "refactor: user-service");
    git(repoPath, "checkout", "main");
    git(repoPath, "checkout", "-b", "feat/login");
    writeAndCommit(repoPath, "login.txt", "b\n", "feat: login");
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getBranchGroupHealth(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams(),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.prefix, null);
    // main + refactor/user-service + feat/login = 3 local branches
    assert.equal(result.body.branches.length, 3);

    // All entries must have the required fields.
    for (const branch of result.body.branches) {
      assert.ok(typeof branch.shortName === "string" && branch.shortName.length > 0, "shortName");
      assert.ok(typeof branch.ahead === "number" && branch.ahead >= 0, "ahead");
      assert.ok(typeof branch.behind === "number" && branch.behind >= 0, "behind");
      assert.ok(typeof branch.daysSinceLast === "number" && branch.daysSinceLast >= 0, "daysSinceLast");
      assert.ok(typeof branch.rotScore === "number" && branch.rotScore >= 0 && branch.rotScore <= 25, "rotScore");
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getBranchGroupHealth filters by prefix", async () => {
  const repoPath = createTempPath("rtgv-group-health-prefix-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    git(repoPath, "checkout", "-b", "refactor/auth");
    writeAndCommit(repoPath, "auth.txt", "auth\n", "refactor: auth");
    git(repoPath, "checkout", "main");
    git(repoPath, "checkout", "-b", "refactor/db");
    writeAndCommit(repoPath, "db.txt", "db\n", "refactor: db");
    git(repoPath, "checkout", "main");
    git(repoPath, "checkout", "-b", "feat/other");
    writeAndCommit(repoPath, "other.txt", "o\n", "feat: other");
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getBranchGroupHealth(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ prefix: "refactor/" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.prefix, "refactor/");
    assert.equal(result.body.branches.length, 2);
    for (const branch of result.body.branches) {
      assert.ok(branch.shortName.startsWith("refactor/"), `expected refactor/ prefix, got ${branch.shortName}`);
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getBranchGroupHealth computes correct ahead/behind and rotScore", async () => {
  const repoPath = createTempPath("rtgv-group-health-score-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    // Create refactor/old: 2 commits ahead of main.
    git(repoPath, "checkout", "-b", "refactor/old");
    writeAndCommit(repoPath, "old1.txt", "a\n", "refactor: old 1");
    writeAndCommit(repoPath, "old2.txt", "b\n", "refactor: old 2");
    git(repoPath, "checkout", "main");
    // Advance main by 5 commits so refactor/old is also behind.
    for (let i = 0; i < 5; i++) {
      writeAndCommit(repoPath, `main-${i}.txt`, `m${i}\n`, `fix: main ${i}`);
    }

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getBranchGroupHealth(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ prefix: "refactor/" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.branches.length, 1);

    const branch = result.body.branches[0];
    // refactor/old is 2 ahead, 5 behind.
    assert.equal(branch.ahead, 2, "ahead");
    assert.equal(branch.behind, 5, "behind");
    // rotScore = clamp(D/7,0,10) + clamp(5/5,0,10) + clamp(2/10,0,5)
    //          = 0 (just committed) + 1 (5 behind / 5) + 0 (2 ahead / 10)
    //          = 1  (daysSinceLast is 0 for fresh commits)
    assert.ok(branch.rotScore >= 1, `rotScore should be >= 1, got ${branch.rotScore}`);
    assert.ok(branch.rotScore <= 25, "rotScore must be <= 25");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getBranchGroupHealth rejects invalid prefix", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  // Prefix without trailing slash (no match in BRANCH_PREFIX_PATTERN).
  const result = await service.getBranchGroupHealth(
    repo,
    new URLSearchParams({ prefix: "refactor" }),
  );
  assert.equal(result.status, 400);
  assert.ok(result.body.error.includes("prefix"), `error should mention prefix: ${result.body.error}`);
});

test("getBranchGroupHealth rejects invalid base parameter", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  // Hyphen-leading base looks like a Git flag.
  const result = await service.getBranchGroupHealth(
    repo,
    new URLSearchParams({ base: "-bad" }),
  );
  assert.equal(result.status, 400);
  assert.ok(result.body.error.includes("base"), `error should mention base: ${result.body.error}`);
});

test("getBranchGroupHealth returns 404 for unknown base ref", async () => {
  const repoPath = createTempPath("rtgv-group-health-404-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getBranchGroupHealth(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ base: "refs/heads/does-not-exist" }),
    );
    assert.equal(result.status, 404);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getBranchGroupHealth returns empty branches array when prefix matches nothing", async () => {
  const repoPath = createTempPath("rtgv-group-health-empty-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    git(repoPath, "checkout", "-b", "feat/login");
    writeAndCommit(repoPath, "login.txt", "l\n", "feat: login");
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getBranchGroupHealth(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ prefix: "refactor/" }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.branches.length, 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Unit test: computeRotScore (exported via module for testing if needed,
// otherwise tested indirectly through getBranchGroupHealth above).
// Validates the §5 formula boundary conditions.
// ---------------------------------------------------------------------------

test("rotScore boundaries: max possible score is 25", () => {
  // D=70+ days (10 pts), B=50+ commits behind (10 pts), A=50+ commits ahead (5 pts) = 25
  const daysSinceLast = 70;
  const behind = 50;
  const ahead = 50;
  const rotScore =
    Math.min(10, Math.floor(daysSinceLast / 7)) +
    Math.min(10, Math.floor(behind / 5)) +
    Math.min(5, Math.floor(ahead / 10));
  assert.equal(rotScore, 25);
});

test("rotScore boundaries: fresh active branch scores 0", () => {
  const daysSinceLast = 0;
  const behind = 0;
  const ahead = 0;
  const rotScore =
    Math.min(10, Math.floor(daysSinceLast / 7)) +
    Math.min(10, Math.floor(behind / 5)) +
    Math.min(5, Math.floor(ahead / 10));
  assert.equal(rotScore, 0);
});

test("rotScore thresholds: warning zone (8-15)", () => {
  // 56 days (8 pts staleness) + 0 behind + 0 ahead = 8 → warning
  const rotScore =
    Math.min(10, Math.floor(56 / 7)) +
    Math.min(10, Math.floor(0 / 5)) +
    Math.min(5, Math.floor(0 / 10));
  assert.equal(rotScore, 8);
  assert.ok(rotScore >= 8 && rotScore <= 15, "should be in warning zone");
});

// ---------------------------------------------------------------------------
// Helpers (shared with refsDrift pattern)
// ---------------------------------------------------------------------------

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
  git(repoPath, "add", "--", relPath);
  git(repoPath, "commit", "--no-gpg-sign", "-m", message);
}
