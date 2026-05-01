import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig, parseRepositoryAllowlist } from "../src/config.js";
import {
  isValidGitRef,
  isValidObjectId,
  isValidRepoId,
  parseAuthorQuery,
  parseLimitQuery,
  parsePathQuery,
  parseSearchQuery,
} from "../src/validation.js";

test("validates public identifiers conservatively", () => {
  assert.equal(isValidRepoId("frontend-app_1"), true);
  assert.equal(isValidRepoId("../secret"), false);
  assert.equal(isValidObjectId("a".repeat(40)), true);
  assert.equal(isValidObjectId("a1b2c3d"), false);
  assert.equal(isValidObjectId("main"), false);
  assert.equal(isValidGitRef("refs/heads/main"), true);
  assert.equal(isValidGitRef("HEAD"), true);
  assert.equal(isValidGitRef("refs/remotes/origin/HEAD"), true);
  assert.equal(isValidGitRef("AUTO_MERGE"), false);
  assert.equal(isValidGitRef("BISECT_HEAD"), false);
  assert.equal(isValidGitRef("CHERRY_PICK_HEAD"), false);
  assert.equal(isValidGitRef("FETCH_HEAD"), false);
  assert.equal(isValidGitRef("ORIG_HEAD"), false);
  assert.equal(isValidGitRef("MERGE_AUTOSTASH"), false);
  assert.equal(isValidGitRef("REBASE_HEAD"), false);
  assert.equal(isValidGitRef("BISECT_EXPECTED_REV"), false);
  assert.equal(isValidGitRef("REVERT_HEAD"), false);
  assert.equal(isValidGitRef("stash"), false);
  assert.equal(isValidGitRef("refs/stash"), false);
  assert.equal(isValidGitRef("refs/bisect/bad"), false);
  assert.equal(isValidGitRef("refs/notes/commits"), false);
  assert.equal(isValidGitRef("refs/original/refs/heads/main"), false);
  assert.equal(isValidGitRef("refs/prefetch/remotes/origin/main"), false);
  assert.equal(isValidGitRef("refs/changes/01/1/1"), false);
  assert.equal(isValidGitRef("refs/keep-around/" + "a".repeat(40)), false);
  assert.equal(isValidGitRef("refs/pull/1/head"), false);
  assert.equal(isValidGitRef("refs/replace/" + "a".repeat(40)), false);
  assert.equal(isValidGitRef("refs/rewritten/main"), false);
  assert.equal(isValidGitRef("refs/worktree/linked/HEAD"), false);
  assert.equal(isValidGitRef("refs/heads/AUTO_MERGE"), true);
  assert.equal(isValidGitRef("refs/heads/BISECT_HEAD"), true);
  assert.equal(isValidGitRef("refs/heads/CHERRY_PICK_HEAD"), true);
  assert.equal(isValidGitRef("refs/heads/FETCH_HEAD"), true);
  assert.equal(isValidGitRef("refs/heads/MERGE_AUTOSTASH"), true);
  assert.equal(isValidGitRef("refs/heads/REBASE_HEAD"), true);
  assert.equal(isValidGitRef("refs/heads/REVERT_HEAD"), true);
  assert.equal(isValidGitRef("refs/heads/stash"), true);
  assert.equal(isValidGitRef("refs/heads/notes/commits"), true);
  assert.equal(isValidGitRef("refs/heads/original"), true);
  assert.equal(isValidGitRef("refs/heads/prefetch/origin/main"), true);
  assert.equal(isValidGitRef("refs/heads/changes/01/1/1"), true);
  assert.equal(isValidGitRef("refs/heads/keep-around/main"), true);
  assert.equal(isValidGitRef("refs/heads/pull/1/head"), true);
  assert.equal(isValidGitRef("refs/heads/replace/main"), true);
  assert.equal(isValidGitRef("refs/heads/rewritten/main"), true);
  assert.equal(isValidGitRef("refs/heads/worktree/linked"), true);
  assert.equal(isValidGitRef("--upload-pack=sh"), false);
  assert.equal(isValidGitRef("main..secret"), false);
  assert.equal(isValidGitRef("main//secret"), false);
  assert.equal(isValidGitRef("refs/heads/main."), false);
  assert.equal(isValidGitRef("refs/heads/.hidden"), false);
  assert.equal(isValidGitRef("refs/heads/main.lock"), false);
  assert.equal(isValidGitRef("@"), false);
});

test("validates and clamps commit list limit input", () => {
  assert.deepEqual(parseLimitQuery("10", 50, 200), { ok: true, value: 10 });
  assert.deepEqual(parseLimitQuery("1000", 50, 200), { ok: true, value: 200 });
  assert.deepEqual(parseLimitQuery("", 50, 200), { ok: true, value: 50 });
  assert.deepEqual(parseLimitQuery("bad", 50, 200), {
    ok: false,
    error: "Invalid limit parameter",
  });
  assert.deepEqual(parseLimitQuery("1e2", 50, 200), {
    ok: false,
    error: "Invalid limit parameter",
  });
  assert.deepEqual(parseLimitQuery("10.5", 50, 200), {
    ok: false,
    error: "Invalid limit parameter",
  });
  assert.deepEqual(parseLimitQuery("0", 50, 200), {
    ok: false,
    error: "Invalid limit parameter",
  });
});

test("normalizes and bounds commit search input", () => {
  assert.deepEqual(parseSearchQuery("  Add API  "), { ok: true, value: "Add API" });
  assert.deepEqual(parseSearchQuery(""), { ok: true, value: "" });
  assert.deepEqual(parseSearchQuery("bad\u0000query"), {
    ok: false,
    error: "Invalid search parameter",
  });
  assert.deepEqual(parseSearchQuery("x".repeat(101)), {
    ok: false,
    error: "Invalid search parameter",
  });
});

test("normalizes and bounds commit author input", () => {
  assert.deepEqual(parseAuthorQuery("  Alice Example  "), { ok: true, value: "Alice Example" });
  assert.deepEqual(parseAuthorQuery(""), { ok: true, value: "" });
  assert.deepEqual(parseAuthorQuery("bad\u001fuser"), {
    ok: false,
    error: "Invalid author parameter",
  });
  assert.deepEqual(parseAuthorQuery("x".repeat(101)), {
    ok: false,
    error: "Invalid author parameter",
  });
});

test("normalizes and bounds commit path input", () => {
  assert.deepEqual(parsePathQuery("  src/app/App.tsx  "), { ok: true, value: "src/app/App.tsx" });
  assert.deepEqual(parsePathQuery(""), { ok: true, value: "" });
  assert.deepEqual(parsePathQuery("/etc/passwd"), {
    ok: false,
    error: "Invalid path parameter",
  });
  assert.deepEqual(parsePathQuery("../secret"), {
    ok: false,
    error: "Invalid path parameter",
  });
  assert.deepEqual(parsePathQuery("src/../secret"), {
    ok: false,
    error: "Invalid path parameter",
  });
  assert.deepEqual(parsePathQuery("src//secret"), {
    ok: false,
    error: "Invalid path parameter",
  });
  assert.deepEqual(parsePathQuery("./secret"), {
    ok: false,
    error: "Invalid path parameter",
  });
  assert.deepEqual(parsePathQuery("-danger"), {
    ok: false,
    error: "Invalid path parameter",
  });
  assert.deepEqual(parsePathQuery("bad\u001fpath"), {
    ok: false,
    error: "Invalid path parameter",
  });
  assert.deepEqual(parsePathQuery("x".repeat(201)), {
    ok: false,
    error: "Invalid path parameter",
  });
});

test("requires absolute allowlisted repository paths", () => {
  assert.throws(
    () => parseRepositoryAllowlist("demo=relative/path"),
    /must be absolute/,
  );
});

test("rejects duplicate allowlisted repository ids", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtgv-duplicate-config-"));
  const repoRoot = path.join(tempDir, "repo");
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });

  assert.throws(
    () => parseRepositoryAllowlist(`demo=${repoRoot},demo=${repoRoot}`),
    /Duplicate repository id/,
  );
});

test("requires decimal positive integer runtime configuration", () => {
  assert.equal(loadConfig({ PORT: "4176", RTGV_REPOS: "" }).port, 4176);
  assert.equal(loadConfig({ RTGV_GIT_TIMEOUT_MS: "1000", RTGV_REPOS: "" }).gitTimeoutMs, 1000);
  assert.equal(loadConfig({ RTGV_DIFF_MAX_BYTES: "2048", RTGV_REPOS: "" }).diffMaxBytes, 2048);
  assert.equal(loadConfig({ RTGV_REF_POLL_MS: "500", RTGV_REPOS: "" }).refPollMs, 500);

  assert.throws(
    () => loadConfig({ PORT: "1e2", RTGV_REPOS: "" }),
    /positive decimal integer/,
  );
  assert.throws(
    () => loadConfig({ RTGV_GIT_TIMEOUT_MS: "10.5", RTGV_REPOS: "" }),
    /positive decimal integer/,
  );
  assert.throws(
    () => loadConfig({ RTGV_DIFF_MAX_BYTES: "0", RTGV_REPOS: "" }),
    /positive decimal integer/,
  );
  assert.throws(
    () => loadConfig({ RTGV_DIFF_MAX_BYTES: "16777217", RTGV_REPOS: "" }),
    /RTGV_DIFF_MAX_BYTES must be between 1 and 16777216/,
  );
  assert.throws(
    () => loadConfig({ RTGV_GIT_TIMEOUT_MS: "2147483648", RTGV_REPOS: "" }),
    /RTGV_GIT_TIMEOUT_MS must be between 1 and 2147483647/,
  );
  assert.throws(
    () => loadConfig({ RTGV_REF_POLL_MS: "-1", RTGV_REPOS: "" }),
    /positive decimal integer/,
  );
});

test("validates CORS allowed origins as HTTP origins", () => {
  assert.deepEqual(
    loadConfig({ RTGV_REPOS: "" }).allowedOrigins,
    new Set(["http://localhost:5173", "http://127.0.0.1:5173"]),
  );
  assert.equal(loadConfig({ RTGV_ALLOWED_ORIGINS: " * ", RTGV_REPOS: "" }).allowedOrigins, "*");
  assert.deepEqual(
    loadConfig({
      RTGV_ALLOWED_ORIGINS: " https://viewer.example.test , http://localhost:5173/ ",
      RTGV_REPOS: "",
    }).allowedOrigins,
    new Set(["https://viewer.example.test", "http://localhost:5173"]),
  );

  assert.throws(
    () => loadConfig({ RTGV_ALLOWED_ORIGINS: "https://viewer.example.test/app", RTGV_REPOS: "" }),
    /Invalid origin/,
  );
  assert.throws(
    () => loadConfig({ RTGV_ALLOWED_ORIGINS: "file:///tmp/viewer.html", RTGV_REPOS: "" }),
    /Invalid origin/,
  );
  assert.throws(
    () => loadConfig({ RTGV_ALLOWED_ORIGINS: "null", RTGV_REPOS: "" }),
    /Invalid origin/,
  );
});

test("requires allowlisted repository paths to be Git working tree roots", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "rtgv-config-"));
  const repoRoot = path.join(tempDir, "repo");
  const subdir = path.join(repoRoot, "src");
  fs.mkdirSync(path.join(repoRoot, ".git"), { recursive: true });
  fs.mkdirSync(subdir, { recursive: true });

  assert.equal(parseRepositoryAllowlist(`demo=${repoRoot}`).get("demo").path, fs.realpathSync(repoRoot));
  assert.throws(
    () => parseRepositoryAllowlist(`subdir=${subdir}`),
    /must be a Git working tree root/,
  );
  assert.throws(
    () => parseRepositoryAllowlist(`plain=${tempDir}`),
    /must be a Git working tree root/,
  );
});
