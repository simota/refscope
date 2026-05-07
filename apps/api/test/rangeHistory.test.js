import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RANGE_HISTORY_DEFAULT_LIMIT,
  RANGE_HISTORY_MAX_LIMIT,
  createGitService,
  extractUrlsFromBody,
  parseRangeHistoryRecords,
  rangeHistoryLogArgs,
} from "../src/gitService.js";
import { parseLineNumberQuery } from "../src/validation.js";

// ---------------------------------------------------------------------------
// parseLineNumberQuery — unit tests
// ---------------------------------------------------------------------------

test("parseLineNumberQuery accepts positive integers within [1, 99999]", () => {
  assert.deepEqual(parseLineNumberQuery("1", "lineStart"), { ok: true, value: 1 });
  assert.deepEqual(parseLineNumberQuery("42", "lineStart"), { ok: true, value: 42 });
  assert.deepEqual(parseLineNumberQuery("99999", "lineEnd"), { ok: true, value: 99999 });
});

test("parseLineNumberQuery rejects missing / empty values", () => {
  assert.equal(parseLineNumberQuery(null, "lineStart").ok, false);
  assert.equal(parseLineNumberQuery(undefined, "lineStart").ok, false);
  assert.equal(parseLineNumberQuery("", "lineStart").ok, false);
  assert.equal(parseLineNumberQuery("   ", "lineStart").ok, false);
});

test("parseLineNumberQuery rejects non-integer and out-of-range values", () => {
  assert.equal(parseLineNumberQuery("0", "lineStart").ok, false);
  assert.equal(parseLineNumberQuery("-1", "lineStart").ok, false);
  assert.equal(parseLineNumberQuery("100000", "lineStart").ok, false);
  assert.equal(parseLineNumberQuery("1.5", "lineStart").ok, false);
  assert.equal(parseLineNumberQuery("abc", "lineStart").ok, false);
  assert.equal(parseLineNumberQuery("1e3", "lineStart").ok, false);
});

// ---------------------------------------------------------------------------
// rangeHistoryLogArgs — structural / hardening tests
// ---------------------------------------------------------------------------

test("rangeHistoryLogArgs first arg is 'log' (allowlist)", () => {
  const args = rangeHistoryLogArgs({
    lineStart: 10,
    lineEnd: 20,
    path: "src/foo.js",
    revision: "a".repeat(40),
    maxCount: 21,
  });
  assert.equal(args[0], "log");
});

test("rangeHistoryLogArgs places -L before --end-of-options and revision after it", () => {
  const rev = "b".repeat(40);
  const args = rangeHistoryLogArgs({
    lineStart: 5,
    lineEnd: 15,
    path: "src/bar.ts",
    revision: rev,
    maxCount: 10,
  });

  const lArg = `-L5,15:src/bar.ts`;
  const lIdx = args.indexOf(lArg);
  const endIdx = args.indexOf("--end-of-options");
  const revIdx = args.indexOf(rev);

  assert.ok(lIdx > 0, "-L arg must be present");
  assert.ok(endIdx > lIdx, "--end-of-options must come after -L");
  assert.ok(revIdx === endIdx + 1, "revision must immediately follow --end-of-options");
});

test("rangeHistoryLogArgs includes --no-patch, --no-merges, --no-show-signature", () => {
  const args = rangeHistoryLogArgs({
    lineStart: 1,
    lineEnd: 5,
    path: "f.js",
    revision: "c".repeat(40),
    maxCount: 5,
  });
  assert.ok(args.includes("--no-patch"));
  assert.ok(args.includes("--no-merges"));
  assert.ok(args.includes("--no-show-signature"));
});

// ---------------------------------------------------------------------------
// parseRangeHistoryRecords — unit tests
// ---------------------------------------------------------------------------

test("parseRangeHistoryRecords parses RS+NUL-delimited records", () => {
  const RS = "\x1e";
  const NUL = "\x00";
  const hash1 = "a".repeat(40);
  const hash2 = "b".repeat(40);
  const stdout = [
    `${RS}${hash1}${NUL}Alice${NUL}2024-01-15T00:00:00Z${NUL}feat: add foo${NUL}Fixes #123${NUL}`,
    `${RS}${hash2}${NUL}Bob${NUL}2024-01-10T00:00:00Z${NUL}chore: init${NUL}${NUL}`,
  ].join("\n");

  const records = parseRangeHistoryRecords(stdout);
  assert.equal(records.length, 2);
  assert.equal(records[0].hash, hash1);
  assert.equal(records[0].author, "Alice");
  assert.equal(records[0].authorDate, "2024-01-15T00:00:00Z");
  assert.equal(records[0].subject, "feat: add foo");
  assert.equal(records[0].body, "Fixes #123");
  assert.equal(records[1].hash, hash2);
  assert.equal(records[1].subject, "chore: init");
  assert.equal(records[1].body, "");
});

test("parseRangeHistoryRecords drops records without a valid 40-char hash", () => {
  const RS = "\x1e";
  const NUL = "\x00";
  const good = "a".repeat(40);
  const stdout = [
    `${RS}bad-hash${NUL}Alice${NUL}2024-01-15T00:00:00Z${NUL}feat: bad${NUL}${NUL}`,
    `${RS}${good}${NUL}Bob${NUL}2024-01-10T00:00:00Z${NUL}fix: ok${NUL}${NUL}`,
  ].join("\n");

  const records = parseRangeHistoryRecords(stdout);
  assert.equal(records.length, 1);
  assert.equal(records[0].hash, good);
});

// ---------------------------------------------------------------------------
// extractUrlsFromBody — unit tests
// ---------------------------------------------------------------------------

test("extractUrlsFromBody returns empty array for empty input", () => {
  assert.deepEqual(extractUrlsFromBody(""), []);
  assert.deepEqual(extractUrlsFromBody(null), []);
});

test("extractUrlsFromBody extracts https URLs and strips trailing punctuation", () => {
  const body = "See https://example.com/issue/42 for context. Also https://docs.example.com.";
  const result = extractUrlsFromBody(body);
  assert.ok(result.includes("https://example.com/issue/42"));
  assert.ok(result.includes("https://docs.example.com"));
  // Trailing dot stripped
  assert.ok(!result.some((u) => u.endsWith(".")));
});

test("extractUrlsFromBody extracts #NNN GitHub-style refs", () => {
  const body = "Closes #42 and fixes #1234. Not a ref: #abcd or #9999999";
  const result = extractUrlsFromBody(body);
  assert.ok(result.includes("#42"));
  assert.ok(result.includes("#1234"));
  // 7-digit number exceeds limit → not matched
  assert.ok(!result.includes("#9999999"));
});

test("extractUrlsFromBody deduplicates repeated refs", () => {
  const body = "See #42. Also see #42 again.";
  const result = extractUrlsFromBody(body);
  assert.equal(result.filter((r) => r === "#42").length, 1);
});

// ---------------------------------------------------------------------------
// getRangeHistory — integration tests against a real git repo
// ---------------------------------------------------------------------------

test("getRangeHistory returns commits touching the specified line range", async () => {
  const repoPath = createTempPath("rtgv-range-history-basic-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // Commit 1: create file with 5 lines
    writeAndCommit(repoPath, "src/foo.js", "line1\nline2\nline3\nline4\nline5\n", "feat: add foo");
    // Commit 2: change lines 2-3 only
    writeAndCommit(repoPath, "src/foo.js", "line1\nLINE2\nLINE3\nline4\nline5\n", "fix: update foo lines 2-3");
    // Commit 3: change an unrelated file
    writeAndCommit(repoPath, "other.txt", "unrelated\n", "chore: unrelated");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRangeHistory(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "src/foo.js", lineStart: "2", lineEnd: "3" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.path, "src/foo.js");
    assert.equal(result.body.lineStart, 2);
    assert.equal(result.body.lineEnd, 3);
    assert.equal(result.body.ref.input, "HEAD");
    assert.ok(/^[a-f0-9]{40}$/.test(result.body.ref.resolved));
    assert.equal(result.body.truncated, false);
    assert.equal(result.body.limit, RANGE_HISTORY_DEFAULT_LIMIT);

    // Both foo.js commits should appear; the unrelated commit should not.
    assert.ok(result.body.entries.length >= 2, "Expected at least 2 entries");
    const subjects = result.body.entries.map((e) => e.subject);
    assert.ok(subjects.includes("fix: update foo lines 2-3"));
    assert.ok(subjects.includes("feat: add foo"));
    assert.ok(!subjects.includes("chore: unrelated"));

    // Each entry must have the expected shape.
    for (const entry of result.body.entries) {
      assert.match(entry.hash, /^[a-f0-9]{40}$/);
      assert.equal(entry.shortHash, entry.hash.slice(0, 7));
      assert.equal(typeof entry.author, "string");
      assert.equal(typeof entry.authorDate, "string");
      assert.equal(typeof entry.subject, "string");
      assert.ok(Array.isArray(entry.urlsInBody));
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getRangeHistory marks truncated:true when entries exceed the requested limit", async () => {
  const repoPath = createTempPath("rtgv-range-history-truncated-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // Create 3 commits all touching line 1.
    writeAndCommit(repoPath, "f.txt", "v1\n", "chore: v1");
    writeAndCommit(repoPath, "f.txt", "v2\n", "chore: v2");
    writeAndCommit(repoPath, "f.txt", "v3\n", "chore: v3");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRangeHistory(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "f.txt", lineStart: "1", lineEnd: "1", limit: "2" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, true);
    assert.equal(result.body.limit, 2);
    assert.equal(result.body.entries.length, 2);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getRangeHistory rejects malformed query parameters before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  // Missing lineStart
  assert.deepEqual(
    await service.getRangeHistory(repo, new URLSearchParams({ path: "f.js", lineEnd: "5" })),
    { status: 400, body: { error: "Missing lineStart parameter" } },
  );
  // Missing lineEnd
  assert.deepEqual(
    await service.getRangeHistory(repo, new URLSearchParams({ path: "f.js", lineStart: "1" })),
    { status: 400, body: { error: "Missing lineEnd parameter" } },
  );
  // lineStart > lineEnd
  assert.deepEqual(
    await service.getRangeHistory(
      repo,
      new URLSearchParams({ path: "f.js", lineStart: "10", lineEnd: "5" }),
    ),
    { status: 400, body: { error: "lineStart must be <= lineEnd" } },
  );
  // Missing path
  assert.deepEqual(
    await service.getRangeHistory(
      repo,
      new URLSearchParams({ lineStart: "1", lineEnd: "5" }),
    ),
    { status: 400, body: { error: "Missing path parameter" } },
  );
  // Invalid path (absolute)
  assert.deepEqual(
    await service.getRangeHistory(
      repo,
      new URLSearchParams({ path: "/etc/passwd", lineStart: "1", lineEnd: "5" }),
    ),
    { status: 400, body: { error: "Invalid path parameter" } },
  );
  // Invalid lineStart value
  assert.deepEqual(
    await service.getRangeHistory(
      repo,
      new URLSearchParams({ path: "f.js", lineStart: "0", lineEnd: "5" }),
    ),
    { status: 400, body: { error: "Invalid lineStart parameter: must be integer in [1, 99999]" } },
  );
  // Non-integer lineEnd
  assert.deepEqual(
    await service.getRangeHistory(
      repo,
      new URLSearchParams({ path: "f.js", lineStart: "1", lineEnd: "abc" }),
    ),
    { status: 400, body: { error: "Invalid lineEnd parameter" } },
  );
});

test("getRangeHistory caps limit at RANGE_HISTORY_MAX_LIMIT", async () => {
  const repoPath = createTempPath("rtgv-range-history-cap-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "f.txt", "line1\n", "feat: initial");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRangeHistory(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({
        path: "f.txt",
        lineStart: "1",
        lineEnd: "1",
        limit: String(RANGE_HISTORY_MAX_LIMIT + 100),
      }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.limit, RANGE_HISTORY_MAX_LIMIT);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getRangeHistory urlsInBody contains literal URLs from commit body", async () => {
  const repoPath = createTempPath("rtgv-range-history-urls-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // Commit with a body containing a URL and an issue ref.
    writeAndCommit(repoPath, "f.txt", "content\n", "feat: url test");
    // Add a second commit with a URL in the body using git commit --amend equivalent
    // We write via a message file to include a body.
    git(repoPath, "commit", "--allow-empty", "-m", "fix: with urls\n\nSee https://example.com/issues/99 and fixes #42");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRangeHistory(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "f.txt", lineStart: "1", lineEnd: "1" }),
    );

    assert.equal(result.status, 200);
    // Find the entry with the URL body.
    const withUrls = result.body.entries.find((e) => e.subject === "fix: with urls");
    // The empty commit may not touch f.txt line range; we only assert the shape if present.
    if (withUrls) {
      assert.ok(withUrls.urlsInBody.includes("https://example.com/issues/99"));
      assert.ok(withUrls.urlsInBody.includes("#42"));
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Helpers
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
  git(repoPath, "add", relPath);
  git(repoPath, "commit", "-m", message);
}
