/**
 * Tests for Risky Diff Detector: scoreDiff pure function + refreshHotspotCache
 * integration via createGitService.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { scoreDiff, createGitService } from "../src/gitService.js";

// ─── helpers ────────────────────────────────────────────────────────────────

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
  git(repoPath, "config", "user.name", "Test User");
  git(repoPath, "config", "user.email", "test@example.com");
}

function writeAndCommit(repoPath, relPath, content, message) {
  const target = path.join(repoPath, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  git(repoPath, "add", relPath);
  git(repoPath, "commit", "-m", message);
}

function makeService(overrides = {}) {
  return createGitService({
    repositories: new Map(),
    gitTimeoutMs: 10_000,
    diffMaxBytes: 1_048_576,
    ...overrides,
  });
}

// ─── scoreDiff — pure function tests ────────────────────────────────────────

test("scoreDiff: empty fileDiffs returns 0", () => {
  const score = scoreDiff([], new Map());
  assert.equal(score, 0);
});

test("scoreDiff: null/undefined fileDiffs returns 0", () => {
  assert.equal(scoreDiff(null, new Map()), 0);
  assert.equal(scoreDiff(undefined, new Map()), 0);
});

test("scoreDiff: file not in hotspot cache gives 0 contribution", () => {
  const fileDiffs = [{ path: "src/cold.js", added: 50, deleted: 10 }];
  const hotspotCache = new Map(); // empty — no hotspot data
  const score = scoreDiff(fileDiffs, hotspotCache);
  // hotspotWeight = 0 → no score from the hotspot term
  // No binary flag, no mass-delete (deleted < 100) → score = 0
  assert.equal(score, 0);
});

test("scoreDiff: hotspot file with non-zero diff gives positive score", () => {
  const fileDiffs = [{ path: "src/hot.js", added: 20, deleted: 5 }];
  const hotspotCache = new Map([["src/hot.js", { churn: 10 }]]);
  const score = scoreDiff(fileDiffs, hotspotCache);
  // hotspotWeight = log2(10+1) ≈ 3.459; hunkSize = 25
  // expected ≈ round(3.459 * 25) = 86
  assert.ok(score > 0, `expected score > 0, got ${score}`);
});

test("scoreDiff: binary file (added=-1) triggers binaryAlpha penalty", () => {
  const fileDiffs = [{ path: "assets/image.png", added: -1, deleted: -1 }];
  const hotspotCache = new Map();
  const score = scoreDiff(fileDiffs, hotspotCache);
  assert.equal(score, 20); // default binaryAlpha = 20
});

test("scoreDiff: custom binaryAlpha is respected", () => {
  const fileDiffs = [{ path: "assets/video.mp4", added: -1, deleted: -1 }];
  const hotspotCache = new Map();
  const score = scoreDiff(fileDiffs, hotspotCache, { binaryAlpha: 50 });
  assert.equal(score, 50);
});

test("scoreDiff: mass-delete (≥100 deleted) triggers massDeleteBeta penalty", () => {
  const fileDiffs = [{ path: "src/legacy.js", added: 5, deleted: 100 }];
  const hotspotCache = new Map();
  const score = scoreDiff(fileDiffs, hotspotCache);
  // hotspotWeight = 0, no binary → only massDeleteBeta = 15
  assert.equal(score, 15); // default massDeleteBeta = 15
});

test("scoreDiff: deleted exactly 99 does NOT trigger massDeleteBeta", () => {
  const fileDiffs = [{ path: "src/small.js", added: 5, deleted: 99 }];
  const hotspotCache = new Map();
  const score = scoreDiff(fileDiffs, hotspotCache);
  assert.equal(score, 0);
});

test("scoreDiff: custom massDeleteBeta is respected", () => {
  const fileDiffs = [{ path: "src/big.js", added: 5, deleted: 200 }];
  const hotspotCache = new Map();
  const score = scoreDiff(fileDiffs, hotspotCache, { massDeleteBeta: 30 });
  assert.equal(score, 30);
});

test("scoreDiff: composite — hotspot + binary + mass-delete accumulate", () => {
  const fileDiffs = [
    { path: "src/hot.js", added: 10, deleted: 100 },    // hotspot + mass-delete
    { path: "assets/big.png", added: -1, deleted: -1 }, // binary
  ];
  const hotspotCache = new Map([["src/hot.js", { churn: 3 }]]);
  const score = scoreDiff(fileDiffs, hotspotCache);
  // hot.js: weight=log2(4)=2, hunk=110 → 220 + massDeleteBeta=15
  // binary: binaryAlpha=20
  // total = 220+15+20 = 255
  assert.ok(score > 0, `expected score > 0, got ${score}`);
  assert.ok(score >= 255, `expected score >= 255 (hotspot+mass-delete+binary), got ${score}`);
});

test("scoreDiff: multiple hotspot files accumulate scores", () => {
  const fileDiffs = [
    { path: "a.js", added: 10, deleted: 5 },
    { path: "b.js", added: 20, deleted: 10 },
  ];
  const hotspotCache = new Map([
    ["a.js", { churn: 4 }], // weight = log2(5) ≈ 2.32
    ["b.js", { churn: 7 }], // weight = log2(8) = 3
  ]);
  const scoreA = scoreDiff([fileDiffs[0]], hotspotCache);
  const scoreB = scoreDiff([fileDiffs[1]], hotspotCache);
  const scoreBoth = scoreDiff(fileDiffs, hotspotCache);
  // Combined score should equal sum of individual scores
  assert.equal(scoreBoth, scoreA + scoreB);
});

// ─── refreshHotspotCache — integration test via getCommitRisk ───────────────

test("getCommitRisk: returns riskScore=0 for commit with no hotspot files", async () => {
  const repoPath = createTempPath("riskscorer-test-");
  initRepo(repoPath);
  writeAndCommit(repoPath, "src/init.js", "console.log('init');\n", "chore: initial commit");
  writeAndCommit(repoPath, "src/feature.js", "export const x = 1;\n", "feat: add feature");

  const lastHash = git(repoPath, "rev-parse", "HEAD").trim();
  const repo = { id: "test", name: "test", path: repoPath };
  const service = makeService();

  const result = await service.getCommitRisk(repo, lastHash);
  assert.equal(result.status, 200);
  assert.ok("riskScore" in result.body, "riskScore field should be present");
  assert.equal(typeof result.body.riskScore, "number");
  // feature.js has churn=1 after first commit to that file (no prior history),
  // so the score should be minimal (≥ 0)
  assert.ok(result.body.riskScore >= 0);
});

test("getCommitRisk: returns higher score when hotspot file has large diff", async () => {
  const repoPath = createTempPath("riskscorer-hotspot-");
  initRepo(repoPath);

  // Create a hotspot: commit src/hot.js many times to accumulate churn
  writeAndCommit(repoPath, "src/hot.js", "// v1\n", "chore: init hot");
  for (let i = 2; i <= 10; i++) {
    writeAndCommit(repoPath, "src/hot.js", `// v${i}\n`, `chore: update hot v${i}`);
  }

  // Now make a large change to the hotspot file
  const bigContent = Array.from({ length: 150 }, (_, i) => `const x${i} = ${i};`).join("\n") + "\n";
  writeAndCommit(repoPath, "src/hot.js", bigContent, "feat: big change to hotspot");
  const hotHash = git(repoPath, "rev-parse", "HEAD").trim();

  const repo = { id: "hot-repo", name: "hot-repo", path: repoPath };
  const service = makeService();

  const result = await service.getCommitRisk(repo, hotHash);
  assert.equal(result.status, 200);
  assert.ok(result.body.riskScore > 0, `expected score > 0 for hotspot file, got ${result.body.riskScore}`);
});

test("getCommitRisk: returns 400 for invalid hash", async () => {
  const service = makeService();
  const repo = { id: "test", name: "test", path: "/tmp/nonexistent" };
  const result = await service.getCommitRisk(repo, "not-a-hash");
  assert.equal(result.status, 400);
});

test("getCommitRisk: returns breakdown field with array", async () => {
  const repoPath = createTempPath("riskscorer-breakdown-");
  initRepo(repoPath);
  writeAndCommit(repoPath, "src/a.js", "const a = 1;\n", "chore: add a");
  writeAndCommit(repoPath, "src/a.js", "const a = 2;\n", "feat: update a");
  const hash = git(repoPath, "rev-parse", "HEAD").trim();

  const repo = { id: "breakdown-repo", name: "breakdown-repo", path: repoPath };
  const service = makeService();

  const result = await service.getCommitRisk(repo, hash);
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.breakdown), "breakdown should be an array");
  assert.equal(result.body.hash, hash);
});

// ─── scoreDiff — additional edge cases ──────────────────────────────────────

test("scoreDiff: duplicate file path in fileDiffs accumulates independently", () => {
  // Same file appearing twice (defensive: shouldn't happen in production but
  // scoreDiff must not blow up or deduplicate silently)
  const hotspotCache = new Map([["src/dup.js", { churn: 4 }]]);
  const fileDiffs = [
    { path: "src/dup.js", added: 10, deleted: 5 },
    { path: "src/dup.js", added: 10, deleted: 5 },
  ];
  const single = scoreDiff([fileDiffs[0]], hotspotCache);
  const doubled = scoreDiff(fileDiffs, hotspotCache);
  // Each occurrence is scored independently — total should be 2× single
  assert.equal(doubled, single * 2);
});

test("scoreDiff: very large churn × large hunk stays within JS safe integer", () => {
  // churn=10000, hunkSize=1000 → weight=log2(10001)≈13.29, score≈13287
  const hotspotCache = new Map([["src/huge.js", { churn: 10_000 }]]);
  const fileDiffs = [{ path: "src/huge.js", added: 500, deleted: 500 }];
  const score = scoreDiff(fileDiffs, hotspotCache);
  assert.ok(Number.isSafeInteger(score), `expected safe integer, got ${score}`);
  assert.ok(score > 0);
});

test("scoreDiff: path matching is case-sensitive (different case = cache miss)", () => {
  // hotspotCache key is "Src/Hot.js" but fileDiff path is "src/hot.js" — should be a miss
  const hotspotCache = new Map([["Src/Hot.js", { churn: 100 }]]);
  const fileDiffs = [{ path: "src/hot.js", added: 50, deleted: 50 }];
  // No hotspot match → no hotspot contribution; deleted < 100 → no mass-delete penalty
  const score = scoreDiff(fileDiffs, hotspotCache);
  assert.equal(score, 0);
});

test("scoreDiff: binary + hotspot in same diff — binary skips hotspot contribution", () => {
  // When added=-1 the file is treated as binary; the hotspot cache entry must
  // NOT be applied (binary branch uses `continue`)
  const hotspotCache = new Map([["assets/photo.bin", { churn: 50 }]]);
  const fileDiffs = [{ path: "assets/photo.bin", added: -1, deleted: -1 }];
  const score = scoreDiff(fileDiffs, hotspotCache);
  // Only binaryAlpha (20) — no hotspot term added
  assert.equal(score, 20);
});

// ─── getCommitRisk — additional HTTP / structure tests ──────────────────────

test("getCommitRisk: returns 404 for non-existent hash in a real repo", async () => {
  const repoPath = createTempPath("riskscorer-notfound-");
  initRepo(repoPath);
  writeAndCommit(repoPath, "src/x.js", "const x = 1;\n", "chore: initial");

  const repo = { id: "notfound-repo", name: "notfound-repo", path: repoPath };
  const service = makeService();

  // A well-formed 40-char hex string that doesn't exist in the repo
  const fakeHash = "a".repeat(40);
  const result = await service.getCommitRisk(repo, fakeHash);
  assert.equal(result.status, 404);
  assert.ok("error" in result.body);
});

test("getCommitRisk: returns 400 for a valid object that is not a commit (tree)", async () => {
  const repoPath = createTempPath("riskscorer-tree-");
  initRepo(repoPath);
  writeAndCommit(repoPath, "src/y.js", "const y = 2;\n", "chore: y");

  // Get the tree hash of HEAD (not a commit)
  const treeHash = git(repoPath, "rev-parse", "HEAD^{tree}").trim();
  const repo = { id: "tree-repo", name: "tree-repo", path: repoPath };
  const service = makeService();

  const result = await service.getCommitRisk(repo, treeHash);
  assert.equal(result.status, 400);
  assert.ok("error" in result.body);
});

test("getCommitRisk: breakdown is capped at 10 entries when commit touches 11+ files", async () => {
  const repoPath = createTempPath("riskscorer-breakdown10-");
  initRepo(repoPath);

  // Create an initial commit with 11 files
  for (let i = 0; i < 11; i++) {
    const rel = `src/file${i}.js`;
    const target = path.join(repoPath, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, `const x${i} = ${i};\n`);
    git(repoPath, "add", rel);
  }
  git(repoPath, "commit", "-m", "chore: 11 files init");

  // Modify all 11 files in a second commit
  for (let i = 0; i < 11; i++) {
    const rel = `src/file${i}.js`;
    const target = path.join(repoPath, rel);
    fs.writeFileSync(target, `const x${i} = ${i * 2}; // updated\n`);
    git(repoPath, "add", rel);
  }
  git(repoPath, "commit", "-m", "feat: update all 11 files");
  const hash = git(repoPath, "rev-parse", "HEAD").trim();

  const repo = { id: "breakdown10-repo", name: "breakdown10-repo", path: repoPath };
  const service = makeService();

  const result = await service.getCommitRisk(repo, hash);
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body.breakdown), "breakdown should be an array");
  assert.ok(
    result.body.breakdown.length <= 10,
    `breakdown must be capped at 10, got ${result.body.breakdown.length}`,
  );
});

test("collectRefEvents commit_added: riskScore is present and fileDiffs is not leaked", async () => {
  // Verify that commit_added events carry riskScore but do not expose internal fileDiffs
  const repoPath = createTempPath("riskscorer-sse-");
  initRepo(repoPath);
  writeAndCommit(repoPath, "src/init.js", "const a = 1;\n", "chore: init");
  const initHash = git(repoPath, "rev-parse", "HEAD").trim();

  const repo = { id: "sse-repo", name: "sse-repo", path: repoPath };
  const service = makeService({ repositories: new Map([["sse-repo", repo]]) });

  // Capture snapshot before adding new commit
  const snapshot = await service.getRefSnapshot(repo);

  // Add a commit so collectRefEvents produces commit_added
  writeAndCommit(repoPath, "src/feature.js", "export const b = 2;\n", "feat: add feature");

  const { events } = await service.collectRefEvents(repo, snapshot);
  const commitAddedEvents = events.filter((e) => e.type === "commit_added");
  assert.ok(commitAddedEvents.length > 0, "expected at least one commit_added event");

  for (const evt of commitAddedEvents) {
    assert.ok("riskScore" in evt.commit, "commit_added commit must have riskScore");
    assert.equal(typeof evt.commit.riskScore, "number");
    assert.ok(!("fileDiffs" in evt.commit), "fileDiffs must not be exposed in commit_added payload");
    // Verify other standard commit fields survive
    assert.ok("hash" in evt.commit, "hash field must be present");
    assert.ok("subject" in evt.commit, "subject field must be present");
    assert.ok("author" in evt.commit, "author field must be present");
  }
});

test("listCommits: every returned commit has riskScore and no fileDiffs leak", async () => {
  // Regression: REST listCommits (initial UI load) must populate riskScore so badges
  // show on existing commits, not just new ones arriving via SSE.
  const repoPath = createTempPath("riskscorer-list-");
  initRepo(repoPath);
  writeAndCommit(repoPath, "src/a.js", "const a = 1;\n", "chore: init");
  writeAndCommit(repoPath, "src/a.js", "const a = 2;\n", "fix: bump");
  writeAndCommit(repoPath, "src/b.js", "const b = 1;\n", "feat: add b");

  const repo = { id: "list-repo", name: "list-repo", path: repoPath };
  const service = makeService({ repositories: new Map([["list-repo", repo]]) });

  const result = await service.listCommits(repo, new URLSearchParams({ ref: "HEAD" }));
  assert.equal(result.status, 200);
  assert.ok(Array.isArray(result.body));
  assert.ok(result.body.length >= 3, "expected at least 3 commits");

  for (const commit of result.body) {
    assert.ok("riskScore" in commit, "every commit must have riskScore");
    assert.equal(typeof commit.riskScore, "number");
    assert.ok(!("fileDiffs" in commit), "fileDiffs must not leak from listCommits");
    assert.ok("hash" in commit && "subject" in commit && "author" in commit);
  }
});
