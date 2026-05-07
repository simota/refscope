import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  SYMBOL_HISTORY_DEFAULT_LIMIT,
  SYMBOL_HISTORY_MAX_LIMIT,
  createGitService,
  extractSymbolRenameFromDiff,
  parseSymbolHistoryRecords,
  symbolHistoryLogArgs,
} from "../src/gitService.js";
import { parseFuncNameQuery } from "../src/validation.js";

// ---------------------------------------------------------------------------
// parseFuncNameQuery — unit tests (Architecture Review flag: injection safety)
// ---------------------------------------------------------------------------

test("parseFuncNameQuery accepts valid identifiers", () => {
  assert.deepEqual(parseFuncNameQuery("parseRefScope"), { ok: true, value: "parseRefScope" });
  assert.deepEqual(parseFuncNameQuery("_helper"), { ok: true, value: "_helper" });
  assert.deepEqual(parseFuncNameQuery("MyClass.myMethod"), { ok: true, value: "MyClass.myMethod" });
  assert.deepEqual(parseFuncNameQuery("func:type~variant"), { ok: true, value: "func:type~variant" });
  assert.deepEqual(parseFuncNameQuery("a123_B"), { ok: true, value: "a123_B" });
});

test("parseFuncNameQuery trims whitespace", () => {
  assert.deepEqual(parseFuncNameQuery("  myFunc  "), { ok: true, value: "myFunc" });
});

test("parseFuncNameQuery rejects missing / empty input", () => {
  assert.equal(parseFuncNameQuery(null).ok, false);
  assert.equal(parseFuncNameQuery(undefined).ok, false);
  assert.equal(parseFuncNameQuery("").ok, false);
  assert.equal(parseFuncNameQuery("   ").ok, false);
});

test("parseFuncNameQuery rejects leading dash (flag injection)", () => {
  assert.equal(parseFuncNameQuery("-L:foo:bar").ok, false);
  assert.equal(parseFuncNameQuery("-C").ok, false);
  assert.equal(parseFuncNameQuery("--no-pager").ok, false);
});

test("parseFuncNameQuery rejects shell metacharacters (injection prevention)", () => {
  // All of these should be rejected as they are not in [A-Za-z0-9_:.~]
  const dangerous = [
    "foo/bar",
    "foo\\bar",
    "foo;bar",
    "foo&bar",
    "foo|bar",
    "foo<bar",
    "foo>bar",
    "foo`bar",
    "foo$bar",
    "foo(bar",
    "foo)bar",
    "foo bar",
    "foo\nbar",
    "foo\tbar",
  ];
  for (const value of dangerous) {
    const result = parseFuncNameQuery(value);
    assert.equal(
      result.ok,
      false,
      `Expected '${value.replace(/\n/g, "\\n").replace(/\t/g, "\\t")}' to be rejected`,
    );
  }
});

test("parseFuncNameQuery rejects identifiers starting with a digit", () => {
  assert.equal(parseFuncNameQuery("123func").ok, false);
  assert.equal(parseFuncNameQuery("9badStart").ok, false);
});

test("parseFuncNameQuery rejects identifiers exceeding 128 characters", () => {
  const long = "a".repeat(129);
  assert.equal(parseFuncNameQuery(long).ok, false);
});

test("parseFuncNameQuery accepts identifiers at exactly 128 characters", () => {
  // 1 leading letter + 127 subsequent chars = 128 total
  const maxLength = "a" + "b".repeat(127);
  assert.equal(maxLength.length, 128);
  assert.equal(parseFuncNameQuery(maxLength).ok, true);
});

// ---------------------------------------------------------------------------
// symbolHistoryLogArgs — structural / hardening tests
// ---------------------------------------------------------------------------

test("symbolHistoryLogArgs first arg is 'log' (allowlist)", () => {
  const args = symbolHistoryLogArgs({
    funcname: "myFunc",
    path: "src/foo.js",
    revision: "a".repeat(40),
    maxCount: 21,
  });
  assert.equal(args[0], "log");
});

test("symbolHistoryLogArgs places -L:<func>:<path> in arg list", () => {
  const rev = "b".repeat(40);
  const args = symbolHistoryLogArgs({
    funcname: "parseScope",
    path: "internal/scope.go",
    revision: rev,
    maxCount: 5,
  });
  const lArg = args.find((a) => a.startsWith("-L:"));
  assert.ok(lArg, "Expected a -L: argument");
  assert.equal(lArg, "-L:parseScope:internal/scope.go");
});

test("symbolHistoryLogArgs places revision after --end-of-options", () => {
  const rev = "c".repeat(40);
  const args = symbolHistoryLogArgs({
    funcname: "fn",
    path: "file.js",
    revision: rev,
    maxCount: 10,
  });
  const eoIdx = args.indexOf("--end-of-options");
  assert.ok(eoIdx !== -1, "--end-of-options must be present");
  assert.equal(args[eoIdx + 1], rev, "revision must immediately follow --end-of-options");
});

test("symbolHistoryLogArgs includes --no-show-signature", () => {
  const args = symbolHistoryLogArgs({
    funcname: "fn",
    path: "file.js",
    revision: "a".repeat(40),
    maxCount: 5,
  });
  assert.ok(args.includes("--no-show-signature"), "Must include --no-show-signature");
});

test("symbolHistoryLogArgs includes --no-merges", () => {
  const args = symbolHistoryLogArgs({
    funcname: "fn",
    path: "file.js",
    revision: "a".repeat(40),
    maxCount: 5,
  });
  assert.ok(args.includes("--no-merges"), "Must include --no-merges");
});

test("symbolHistoryLogArgs includes --find-renames", () => {
  const args = symbolHistoryLogArgs({
    funcname: "fn",
    path: "file.js",
    revision: "a".repeat(40),
    maxCount: 5,
  });
  assert.ok(args.includes("--find-renames"), "Must include --find-renames");
});

test("symbolHistoryLogArgs encodes maxCount", () => {
  const args = symbolHistoryLogArgs({
    funcname: "fn",
    path: "file.js",
    revision: "a".repeat(40),
    maxCount: 42,
  });
  assert.ok(args.includes("--max-count=42"), "Must encode maxCount as --max-count=N");
});

// ---------------------------------------------------------------------------
// parseSymbolHistoryRecords — unit tests
// ---------------------------------------------------------------------------

const RS = "\x1e";
const NUL = "\x00";

test("parseSymbolHistoryRecords parses well-formed output", () => {
  const hash1 = "a".repeat(40);
  const hash2 = "b".repeat(40);
  const stdout = [
    `${RS}${hash1}${NUL}Alice${NUL}2024-01-15T00:00:00Z${NUL}feat: add foo${NUL}Body text${NUL}`,
    `${RS}${hash2}${NUL}Bob${NUL}2024-01-10T00:00:00Z${NUL}chore: init${NUL}${NUL}`,
  ].join("\n");

  const records = parseSymbolHistoryRecords(stdout);
  assert.equal(records.length, 2);
  assert.equal(records[0].hash, hash1);
  assert.equal(records[0].author, "Alice");
  assert.equal(records[0].authorDate, "2024-01-15T00:00:00Z");
  assert.equal(records[0].subject, "feat: add foo");
  assert.equal(records[0].body, "Body text");
  assert.equal(records[0].renameInfo, null);
  assert.equal(records[1].hash, hash2);
  assert.equal(records[1].body, "");
  assert.equal(records[1].renameInfo, null);
});

test("parseSymbolHistoryRecords drops records without a valid 40-char hash", () => {
  const good = "a".repeat(40);
  const stdout = [
    `${RS}bad-hash${NUL}Alice${NUL}2024-01-15T00:00:00Z${NUL}feat: bad${NUL}${NUL}`,
    `${RS}${good}${NUL}Bob${NUL}2024-01-10T00:00:00Z${NUL}fix: ok${NUL}${NUL}`,
  ].join("\n");

  const records = parseSymbolHistoryRecords(stdout);
  assert.equal(records.length, 1);
  assert.equal(records[0].hash, good);
});

test("parseSymbolHistoryRecords returns empty array for empty stdout", () => {
  assert.deepEqual(parseSymbolHistoryRecords(""), []);
  assert.deepEqual(parseSymbolHistoryRecords("\n"), []);
});

// ---------------------------------------------------------------------------
// extractSymbolRenameFromDiff — unit tests
// ---------------------------------------------------------------------------

test("extractSymbolRenameFromDiff returns null for no rename markers", () => {
  const diff = "diff --git a/file.js b/file.js\n--- a/file.js\n+++ b/file.js\n@@ -1,3 +1,3 @@\n";
  assert.equal(extractSymbolRenameFromDiff(diff), null);
});

test("extractSymbolRenameFromDiff returns null for null/empty input", () => {
  assert.equal(extractSymbolRenameFromDiff(null), null);
  assert.equal(extractSymbolRenameFromDiff(""), null);
});

test("extractSymbolRenameFromDiff detects rename with similarity", () => {
  const diff = [
    "diff --git a/old/path.js b/new/path.js",
    "similarity index 85%",
    "rename from old/path.js",
    "rename to new/path.js",
    "--- a/old/path.js",
    "+++ b/new/path.js",
    "@@ -1,3 +1,3 @@",
  ].join("\n");

  const result = extractSymbolRenameFromDiff(diff);
  assert.ok(result !== null, "Expected rename info");
  assert.equal(result.from, "old/path.js");
  assert.equal(result.to, "new/path.js");
  assert.equal(result.similarity, 85);
});

test("extractSymbolRenameFromDiff detects rename without similarity line", () => {
  const diff = [
    "diff --git a/old.js b/new.js",
    "rename from old.js",
    "rename to new.js",
    "--- a/old.js",
    "+++ b/new.js",
  ].join("\n");

  const result = extractSymbolRenameFromDiff(diff);
  assert.ok(result !== null);
  assert.equal(result.from, "old.js");
  assert.equal(result.to, "new.js");
  assert.equal(result.similarity, null);
});

test("extractSymbolRenameFromDiff returns null when from === to", () => {
  const diff = [
    "similarity index 100%",
    "rename from same.js",
    "rename to same.js",
  ].join("\n");

  const result = extractSymbolRenameFromDiff(diff);
  assert.equal(result, null);
});

// ---------------------------------------------------------------------------
// getSymbolHistory — validation-only unit tests (no git calls)
// ---------------------------------------------------------------------------

test("getSymbolHistory rejects missing funcname", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  const result = await service.getSymbolHistory(
    repo,
    new URLSearchParams({ path: "src/foo.js" }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /funcname/);
});

test("getSymbolHistory rejects funcname with shell metacharacters", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  // Semicolon injection attempt
  const result = await service.getSymbolHistory(
    repo,
    new URLSearchParams({ path: "src/foo.js", funcname: "fn;rm -rf /" }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /funcname/);
});

test("getSymbolHistory rejects funcname starting with dash", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  const result = await service.getSymbolHistory(
    repo,
    new URLSearchParams({ path: "src/foo.js", funcname: "-c user.email=x" }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /funcname/);
});

test("getSymbolHistory rejects missing path", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  const result = await service.getSymbolHistory(
    repo,
    new URLSearchParams({ funcname: "myFunc" }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /path/i);
});

test("getSymbolHistory rejects absolute path", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  const result = await service.getSymbolHistory(
    repo,
    new URLSearchParams({ funcname: "myFunc", path: "/etc/passwd" }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /path/i);
});

test("getSymbolHistory rejects invalid ref", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  const result = await service.getSymbolHistory(
    repo,
    new URLSearchParams({ funcname: "myFunc", path: "src/foo.js", ref: "@{bad}" }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /ref/i);
});

// ---------------------------------------------------------------------------
// getSymbolHistory — integration tests against a real git repo
// ---------------------------------------------------------------------------

test("getSymbolHistory returns commits that touched a JavaScript function", async () => {
  const repoPath = createTempPath("rtgv-symbol-history-basic-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");

    // Commit 1: create JS file with a function
    writeAndCommit(
      repoPath,
      "src/parser.js",
      "function parseScope(input) {\n  return input;\n}\n",
      "feat: add parseScope",
    );

    // Commit 2: modify the function
    writeAndCommit(
      repoPath,
      "src/parser.js",
      "function parseScope(input) {\n  if (!input) return null;\n  return input.trim();\n}\n",
      "fix: handle null input in parseScope",
    );

    // Commit 3: add an unrelated file (should not appear in symbol history)
    writeAndCommit(repoPath, "README.md", "# Docs\n", "docs: add readme");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getSymbolHistory(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ funcname: "parseScope", path: "src/parser.js" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.funcname, "parseScope");
    assert.equal(result.body.path, "src/parser.js");
    assert.equal(result.body.ref.input, "HEAD");
    assert.ok(/^[a-f0-9]{40}$/.test(result.body.ref.resolved));
    assert.equal(result.body.truncated, false);
    assert.equal(result.body.limit, SYMBOL_HISTORY_DEFAULT_LIMIT);

    // Both commits touching parseScope should appear
    assert.ok(result.body.entries.length >= 2, "Expected at least 2 entries");
    const subjects = result.body.entries.map((e) => e.subject);
    assert.ok(subjects.some((s) => s.includes("parseScope")));

    // Each entry must have the expected shape
    for (const entry of result.body.entries) {
      assert.match(entry.hash, /^[a-f0-9]{40}$/);
      assert.equal(entry.shortHash, entry.hash.slice(0, 7));
      assert.equal(typeof entry.author, "string");
      assert.equal(typeof entry.authorDate, "string");
      assert.equal(typeof entry.subject, "string");
      assert.equal(typeof entry.body, "string");
      // renameInfo is either null or a valid object
      if (entry.renameInfo !== null) {
        assert.equal(typeof entry.renameInfo.from, "string");
        assert.equal(typeof entry.renameInfo.to, "string");
      }
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getSymbolHistory returns 404 when symbol is not found in the file", async () => {
  const repoPath = createTempPath("rtgv-symbol-history-notfound-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(
      repoPath,
      "src/foo.js",
      "function existingFunc() { return 1; }\n",
      "feat: add existingFunc",
    );

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getSymbolHistory(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ funcname: "nonExistentSymbolXYZ", path: "src/foo.js" }),
    );

    assert.equal(result.status, 404);
    assert.equal(result.body.funcname, "nonExistentSymbolXYZ");
    assert.match(result.body.error, /Symbol not found/);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getSymbolHistory marks truncated:true when entries exceed the requested limit", async () => {
  const repoPath = createTempPath("rtgv-symbol-history-truncated-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");

    // Create 3 commits all touching a function
    writeAndCommit(
      repoPath,
      "f.js",
      "function fn() { return 1; }\n",
      "chore: v1",
    );
    writeAndCommit(
      repoPath,
      "f.js",
      "function fn() { return 2; }\n",
      "chore: v2",
    );
    writeAndCommit(
      repoPath,
      "f.js",
      "function fn() { return 3; }\n",
      "chore: v3",
    );

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getSymbolHistory(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ funcname: "fn", path: "f.js", limit: "2" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, true);
    assert.equal(result.body.limit, 2);
    assert.equal(result.body.entries.length, 2);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getSymbolHistory caps limit at SYMBOL_HISTORY_MAX_LIMIT", async () => {
  const repoPath = createTempPath("rtgv-symbol-history-cap-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(
      repoPath,
      "f.js",
      "function fn() { return 1; }\n",
      "feat: initial",
    );

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getSymbolHistory(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({
        funcname: "fn",
        path: "f.js",
        limit: String(SYMBOL_HISTORY_MAX_LIMIT + 100),
      }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.limit, SYMBOL_HISTORY_MAX_LIMIT);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// Test helpers
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
