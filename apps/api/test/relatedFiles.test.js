import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  RELATED_FILES_DEFAULT_LIMIT,
  RELATED_FILES_MAX_LIMIT,
  RELATED_FILES_TOP_K,
  createGitService,
  parseRelatedFilesRecords,
  relatedFilesHashLogArgs,
  relatedFilesNameLogArgs,
} from "../src/gitService.js";

test("relatedFilesHashLogArgs preserves hardening surface and option terminator", () => {
  const args = relatedFilesHashLogArgs({
    revision: "1111111111111111111111111111111111111111",
    pathspec: ":(literal,top)apps/api/src/foo.js",
    maxCount: 31,
  });

  assert.equal(args[0], "log");
  assert.ok(args.includes("--follow"));
  assert.ok(args.includes("--find-renames"));
  assert.ok(args.includes("--no-show-signature"));
  assert.ok(args.includes("--no-ext-diff"));
  assert.ok(args.includes("--no-textconv"));
  assert.ok(args.includes("--no-color"));
  assert.ok(args.includes("--max-count=31"));
  // Format must emit the hash and the target's names only — no patch.
  assert.ok(args.includes("--format=%x00%H"));
  assert.ok(args.includes("--name-status"));
  assert.ok(args.includes("-z"));
  assert.ok(!args.includes("--patch"));
  // Option parsing must terminate before the resolved revision; the pathspec
  // must come after `--`.
  const endIdx = args.indexOf("--end-of-options");
  const revIdx = args.indexOf("1111111111111111111111111111111111111111");
  const pathSeparatorIdx = args.indexOf("--");
  const pathspecIdx = args.indexOf(":(literal,top)apps/api/src/foo.js");
  assert.ok(endIdx > 0 && revIdx === endIdx + 1);
  assert.ok(pathSeparatorIdx > revIdx);
  assert.equal(pathspecIdx, pathSeparatorIdx + 1);
});

test("relatedFilesNameLogArgs uses --no-walk and emits name-only with metadata", () => {
  const hashes = ["a".repeat(40), "b".repeat(40), "c".repeat(40)];
  const args = relatedFilesNameLogArgs({ hashes });

  assert.equal(args[0], "log");
  assert.ok(args.includes("--no-walk"));
  assert.ok(args.includes("--name-only"));
  // NUL-terminated names: no C-quoting of non-ASCII or special characters.
  assert.ok(args.includes("-z"));
  assert.ok(args.includes("--no-renames"));
  assert.ok(args.includes("--no-show-signature"));
  assert.ok(args.includes("--no-ext-diff"));
  assert.ok(args.includes("--no-textconv"));
  assert.ok(args.includes("--no-color"));
  // The format must emit NUL + hash + NUL + authorDate so the parser can
  // frame records on the empty token and read the per-commit metadata.
  assert.ok(args.some((arg) => arg.startsWith("--format=") && arg.includes("%H") && arg.includes("%aI")));
  // Hashes follow `--end-of-options` so option parsing is fully terminated.
  const endIdx = args.indexOf("--end-of-options");
  assert.ok(endIdx > 0);
  for (const hash of hashes) {
    const idx = args.indexOf(hash);
    assert.ok(idx > endIdx, `hash ${hash} must appear after --end-of-options`);
  }
});

test("parseRelatedFilesRecords aggregates co-changes, excludes target, sorts by count desc", () => {
  // Three commits:
  //   c1 (newest, 2024-03-01): touches foo.js + bar.js + baz.js
  //   c2            (2024-02-15): touches foo.js + bar.js
  //   c3 (oldest,  2024-01-10): touches foo.js + qux.js
  const stdout = [
    nameLogRecord("a".repeat(40), "2024-03-01T00:00:00+00:00", ["src/foo.js", "src/bar.js", "src/baz.js"]),
    nameLogRecord("b".repeat(40), "2024-02-15T00:00:00+00:00", ["src/foo.js", "src/bar.js"]),
    nameLogRecord("c".repeat(40), "2024-01-10T00:00:00+00:00", ["src/foo.js", "src/qux.js"]),
  ].join("");

  const result = parseRelatedFilesRecords(stdout, "src/foo.js");
  assert.equal(result.scannedCommits, 3);
  // Target path must not appear in related list.
  for (const entry of result.related) {
    assert.notEqual(entry.path, "src/foo.js");
  }
  // bar.js touched in 2 commits, baz.js + qux.js each in 1.
  assert.equal(result.related.length, 3);
  assert.equal(result.related[0].path, "src/bar.js");
  assert.equal(result.related[0].coChangeCount, 2);
  assert.equal(result.related[0].lastCoChangeAt, "2024-03-01T00:00:00+00:00");
  // Tie-break: baz.js (2024-03-01) before qux.js (2024-01-10) on count tie.
  assert.equal(result.related[1].path, "src/baz.js");
  assert.equal(result.related[1].coChangeCount, 1);
  assert.equal(result.related[1].lastCoChangeAt, "2024-03-01T00:00:00+00:00");
  assert.equal(result.related[2].path, "src/qux.js");
  assert.equal(result.related[2].coChangeCount, 1);
  assert.equal(result.related[2].lastCoChangeAt, "2024-01-10T00:00:00+00:00");
});

test("parseRelatedFilesRecords deduplicates the same path within one commit", () => {
  // Even if --name-only somehow lists the same path twice, we must not inflate
  // the count for a single commit.
  const stdout = nameLogRecord("a".repeat(40), "2024-03-01T00:00:00+00:00", [
    "src/bar.js",
    "src/bar.js",
  ]);

  const result = parseRelatedFilesRecords(stdout, "src/foo.js");
  assert.equal(result.scannedCommits, 1);
  assert.equal(result.related.length, 1);
  assert.equal(result.related[0].path, "src/bar.js");
  assert.equal(result.related[0].coChangeCount, 1);
});

test("parseRelatedFilesRecords caps to RELATED_FILES_TOP_K", () => {
  // Single commit touching the target plus 25 sibling paths — only the first
  // RELATED_FILES_TOP_K must be surfaced.
  const paths = [];
  for (let i = 0; i < 25; i++) {
    paths.push(`src/sibling-${String(i).padStart(2, "0")}.js`);
  }
  const stdout = nameLogRecord("a".repeat(40), "2024-03-01T00:00:00+00:00", paths);

  const result = parseRelatedFilesRecords(stdout, "src/foo.js");
  assert.equal(result.related.length, RELATED_FILES_TOP_K);
});

test("parseRelatedFilesRecords keeps unusual file names verbatim", () => {
  const stdout = nameLogRecord("a".repeat(40), "2024-03-01T00:00:00+00:00", [
    "docs/日本語.md",
    " leading space.txt",
    "x => y.txt",
    "src/foo.js",
  ]);

  const result = parseRelatedFilesRecords(stdout, "docs/日本語.md");
  assert.deepEqual(
    result.related.map((entry) => entry.path).sort(),
    [" leading space.txt", "src/foo.js", "x => y.txt"],
  );
});

test("parseRelatedFilesRecords does not split records on bytes that are valid in file names", () => {
  // \x1e (the old record separator) and a commit with no names must not
  // shift the framing: only the empty token between two NULs starts a record.
  const stdout = [
    nameLogRecord("a".repeat(40), "2024-03-01T00:00:00+00:00", ["src/foo.js", "sib\u001ename.txt"]),
    nameLogRecord("b".repeat(40), "2024-02-01T00:00:00+00:00", []),
    nameLogRecord("c".repeat(40), "2024-01-01T00:00:00+00:00", ["src/foo.js", "src/bar.js"]),
  ].join("");

  const result = parseRelatedFilesRecords(stdout, "src/foo.js");
  assert.equal(result.scannedCommits, 3);
  assert.deepEqual(
    result.related.map((entry) => entry.path).sort(),
    ["sib\u001ename.txt", "src/bar.js"],
  );
});

test("getRelatedFiles excludes a non-ASCII target and returns sibling names unquoted", async () => {
  const repoPath = createTempPath("rtgv-related-files-nonascii-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeFiles(repoPath, { "日本.txt": "v1\n", "相棒.txt": "v1\n" });
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-m", "feat: seed");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });
    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "日本.txt" }),
    );

    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.related.map((entry) => entry.path),
      ["相棒.txt"],
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles aggregates co-changes from a real repo", async () => {
  const repoPath = createTempPath("rtgv-related-files-basic-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // Three target-touching commits with different siblings.
    writeFiles(repoPath, {
      "src/target.js": "v1\n",
      "src/sibling-a.js": "a1\n",
    });
    git(repoPath, "add", "src/target.js", "src/sibling-a.js");
    git(repoPath, "commit", "-m", "feat: target + sibling-a");
    writeFiles(repoPath, {
      "src/target.js": "v2\n",
      "src/sibling-a.js": "a2\n",
      "src/sibling-b.js": "b1\n",
    });
    git(repoPath, "add", "src/target.js", "src/sibling-a.js", "src/sibling-b.js");
    git(repoPath, "commit", "-m", "feat: target + sibling-a + sibling-b");
    writeFiles(repoPath, {
      "src/target.js": "v3\n",
      "src/sibling-c.js": "c1\n",
    });
    git(repoPath, "add", "src/target.js", "src/sibling-c.js");
    git(repoPath, "commit", "-m", "feat: target + sibling-c");
    // A commit that does NOT touch target should be ignored.
    writeFiles(repoPath, { "src/unrelated.js": "u1\n" });
    git(repoPath, "add", "src/unrelated.js");
    git(repoPath, "commit", "-m", "chore: unrelated");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "src/target.js" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.path, "src/target.js");
    assert.equal(result.body.ref.input, "HEAD");
    assert.equal(result.body.ref.resolved.length, 40);
    assert.equal(result.body.truncated, false);
    assert.equal(result.body.scannedCommits, 3);
    // Target itself must not appear.
    for (const entry of result.body.related) {
      assert.notEqual(entry.path, "src/target.js");
      assert.notEqual(entry.path, "src/unrelated.js");
    }
    const byPath = new Map(result.body.related.map((entry) => [entry.path, entry]));
    assert.equal(byPath.get("src/sibling-a.js")?.coChangeCount, 2);
    assert.equal(byPath.get("src/sibling-b.js")?.coChangeCount, 1);
    assert.equal(byPath.get("src/sibling-c.js")?.coChangeCount, 1);
    // sibling-a should be sorted ahead of sibling-b/c (count desc).
    assert.equal(result.body.related[0].path, "src/sibling-a.js");
    // lastCoChangeAt must be a real ISO-8601 string from Git.
    for (const entry of result.body.related) {
      assert.match(entry.lastCoChangeAt, /^\d{4}-\d{2}-\d{2}T/);
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles excludes target even after a rename (--follow)", async () => {
  const repoPath = createTempPath("rtgv-related-files-rename-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeFiles(repoPath, {
      "src/old-name.js": "v1\n",
      "src/sibling-a.js": "a1\n",
    });
    git(repoPath, "add", "src/old-name.js", "src/sibling-a.js");
    git(repoPath, "commit", "-m", "feat: old-name + sibling-a");
    // Rename the target file — `--follow` must still pull this commit, and
    // the old-name path must NOT show up in related (it is the target, just
    // under its earlier identity).
    git(repoPath, "mv", "src/old-name.js", "src/new-name.js");
    git(repoPath, "commit", "-m", "refactor: rename to new-name");
    writeFiles(repoPath, {
      "src/new-name.js": "v2\n",
      "src/sibling-b.js": "b1\n",
    });
    git(repoPath, "add", "src/new-name.js", "src/sibling-b.js");
    git(repoPath, "commit", "-m", "feat: new-name + sibling-b");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "src/new-name.js" }),
    );

    assert.equal(result.status, 200);
    // We expect 3 commits scanned via --follow (initial add, rename, post-rename edit).
    assert.equal(result.body.scannedCommits, 3);
    const paths = result.body.related.map((entry) => entry.path);
    assert.ok(!paths.includes("src/new-name.js"), "target itself must not appear");
    assert.ok(paths.includes("src/sibling-a.js"));
    assert.ok(paths.includes("src/sibling-b.js"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles returns empty list when only the target is touched", async () => {
  const repoPath = createTempPath("rtgv-related-files-empty-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/lonely.js", "v1\n", "feat: add lonely");
    writeAndCommit(repoPath, "src/lonely.js", "v2\n", "fix: lonely v2");
    // An unrelated commit that does not touch lonely.js.
    writeAndCommit(repoPath, "src/other.js", "x\n", "feat: add other");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "src/lonely.js" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.related.length, 0);
    assert.equal(result.body.truncated, false);
    assert.equal(result.body.scannedCommits, 2);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles flags truncated:true when commits exceed the requested limit", async () => {
  const repoPath = createTempPath("rtgv-related-files-truncated-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // 4 target-touching commits but limit=2 → reads 3, slices to 2, truncated.
    for (let i = 0; i < 4; i++) {
      writeFiles(repoPath, {
        "src/target.js": `v${i}\n`,
        [`src/sib-${i}.js`]: "x\n",
      });
      git(repoPath, "add", "src/target.js", `src/sib-${i}.js`);
      git(repoPath, "commit", "-m", `feat: tick ${i}`);
    }

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "src/target.js", limit: "2" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, true);
    assert.equal(result.body.scannedCommits, 2);
    // Only the two newest target-touching commits were scanned, so we should
    // see sib-3 and sib-2 only (newest two).
    const paths = result.body.related.map((entry) => entry.path).sort();
    assert.deepEqual(paths, ["src/sib-2.js", "src/sib-3.js"]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles honours an explicit branch ref", async () => {
  const repoPath = createTempPath("rtgv-related-files-branch-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeFiles(repoPath, { "src/target.js": "v1\n", "src/main-only.js": "m\n" });
    git(repoPath, "add", "src/target.js", "src/main-only.js");
    git(repoPath, "commit", "-m", "feat: main-only");
    git(repoPath, "checkout", "-b", "feature");
    writeFiles(repoPath, { "src/target.js": "v2\n", "src/feature-only.js": "f\n" });
    git(repoPath, "add", "src/target.js", "src/feature-only.js");
    git(repoPath, "commit", "-m", "feat: feature-only");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const featureResult = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "src/target.js", ref: "refs/heads/feature" }),
    );
    assert.equal(featureResult.status, 200);
    const featurePaths = featureResult.body.related.map((entry) => entry.path).sort();
    assert.deepEqual(featurePaths, ["src/feature-only.js", "src/main-only.js"]);

    const mainResult = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "src/target.js", ref: "refs/heads/main" }),
    );
    assert.equal(mainResult.status, 200);
    const mainPaths = mainResult.body.related.map((entry) => entry.path);
    assert.deepEqual(mainPaths, ["src/main-only.js"]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles rejects malformed query parameters before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  // Missing path
  assert.deepEqual(
    await service.getRelatedFiles(repo, new URLSearchParams()),
    { status: 400, body: { error: "Missing path parameter" } },
  );
  // Empty / whitespace-only path
  assert.deepEqual(
    await service.getRelatedFiles(repo, new URLSearchParams({ path: "   " })),
    { status: 400, body: { error: "Missing path parameter" } },
  );
  // Absolute paths blocked by parsePathQuery
  assert.deepEqual(
    await service.getRelatedFiles(repo, new URLSearchParams({ path: "/etc/passwd" })),
    { status: 400, body: { error: "Invalid path parameter" } },
  );
  // Hyphen-leading paths blocked (would look like a Git option)
  assert.deepEqual(
    await service.getRelatedFiles(repo, new URLSearchParams({ path: "-foo.js" })),
    { status: 400, body: { error: "Invalid path parameter" } },
  );
  // .. traversal blocked
  assert.deepEqual(
    await service.getRelatedFiles(repo, new URLSearchParams({ path: "../etc/passwd" })),
    { status: 400, body: { error: "Invalid path parameter" } },
  );
  // Invalid ref
  assert.deepEqual(
    await service.getRelatedFiles(
      repo,
      new URLSearchParams({ path: "src/foo.js", ref: "refs/heads/main." }),
    ),
    { status: 400, body: { error: "Invalid ref parameter" } },
  );
  // Invalid limit
  assert.deepEqual(
    await service.getRelatedFiles(
      repo,
      new URLSearchParams({ path: "src/foo.js", limit: "0" }),
    ),
    { status: 400, body: { error: "Invalid limit parameter" } },
  );
  assert.deepEqual(
    await service.getRelatedFiles(
      repo,
      new URLSearchParams({ path: "src/foo.js", limit: "abc" }),
    ),
    { status: 400, body: { error: "Invalid limit parameter" } },
  );
  // Duplicate path
  assert.deepEqual(
    await service.getRelatedFiles(
      repo,
      new URLSearchParams([
        ["path", "a.js"],
        ["path", "b.js"],
      ]),
    ),
    { status: 400, body: { error: "Duplicate path parameter" } },
  );
});

test("getRelatedFiles returns 404 for unknown ref", async () => {
  const repoPath = createTempPath("rtgv-related-files-404-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.js", "v1\n", "feat: foo");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "src/foo.js", ref: "refs/heads/nope" }),
    );

    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "Ref not found or not a commit" });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles caps limit at RELATED_FILES_MAX_LIMIT", async () => {
  const repoPath = createTempPath("rtgv-related-files-cap-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.js", "v1\n", "feat: foo");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({
        path: "src/foo.js",
        limit: String(RELATED_FILES_MAX_LIMIT + 100),
      }),
    );

    assert.equal(result.status, 200);
    // parseLimitQuery clamps, never errors, on over-cap input.
    // We can't read the clamped value back from the body (no echo field for
    // limit), but the call must succeed without rejection. Default scan still
    // honours the natural commit count of the repo.
    assert.equal(result.body.scannedCommits, 1);
    assert.equal(result.body.related.length, 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles does not list the target's former names as related", async () => {
  const repoPath = createTempPath("rtgv-related-files-rename-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeFiles(repoPath, { "d/old name.txt": "x\n", "s.txt": "y\n" });
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "feat: add");
    writeFiles(repoPath, { "d/old name.txt": "x\nx2\n", "s.txt": "y\ny2\n" });
    git(repoPath, "commit", "-am", "fix: both");
    git(repoPath, "mv", "d/old name.txt", "d/new name.txt");
    git(repoPath, "commit", "-m", "refactor: rename");
    writeFiles(repoPath, { "d/new name.txt": "x\nx2\nx3\n", "s.txt": "y\ny2\ny3\n" });
    git(repoPath, "commit", "-am", "fix: both again");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });
    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "d/new name.txt" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.scannedCommits, 4);
    assert.equal(result.body.truncated, false);
    assert.deepEqual(
      result.body.related.map((entry) => [entry.path, entry.coChangeCount]),
      [["s.txt", 3]],
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles keeps the source of a copy as a co-changed file", async () => {
  const repoPath = createTempPath("rtgv-related-files-copy-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    const body = Array.from({ length: 20 }, (_, index) => `line ${index}\n`).join("");
    writeFiles(repoPath, { "Bar.txt": body });
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "feat: bar");
    // One commit edits Bar.txt and copies it to Copy.txt (detected as C).
    writeFiles(repoPath, { "Bar.txt": `${body}more\n`, "Copy.txt": body });
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "feat: copy");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });
    const followed = git(
      repoPath,
      "log",
      "--follow",
      "--find-renames",
      "--find-copies",
      "--format=",
      "--name-status",
      "--",
      "Copy.txt",
    );
    assert.match(followed, /^C\d+\tBar\.txt\tCopy\.txt$/m);

    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: "Copy.txt" }),
    );

    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.related.map((entry) => [entry.path, entry.coChangeCount]),
      [["Bar.txt", 1]],
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRelatedFiles reads long rename chains beyond the default git output cap", async () => {
  const repoPath = createTempPath("rtgv-related-files-long-renames-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // Built with fast-import so the long historical paths never touch the
    // filesystem (and its PATH_MAX). Each rename lists both names in the
    // follow pass: 50 renames x 2 x ~3 KB is well past 256 KB.
    const longDir = Array.from({ length: 15 }, (_, index) => `${"d".repeat(195)}${index}`).join("/");
    const name = (index) => `${longDir}/file-${index}.txt`;
    let stream = "";
    let mark = 0;
    const commit = (message, body) => {
      mark += 1;
      stream += `commit refs/heads/main\nmark :${mark}\n`;
      stream += `committer Alice <alice@example.test> ${1_700_000_000 + mark} +0000\n`;
      stream += `data ${Buffer.byteLength(message)}\n${message}\n`;
      if (mark > 1) stream += `from :${mark - 1}\n`;
      stream += body;
    };
    commit("add", `M 100644 inline ${name(0)}\ndata 2\nx\nM 100644 inline s.txt\ndata 2\ny\n`);
    for (let index = 1; index < RELATED_FILES_MAX_LIMIT; index += 1) {
      commit(`rename ${index}`, `R "${name(index - 1)}" "${name(index)}"\n`);
    }
    // The current name has to pass the 200-character path query limit.
    const target = "target.txt";
    commit("rename to target", `R "${name(RELATED_FILES_MAX_LIMIT - 1)}" "${target}"\n`);
    const imported = spawnSync("git", ["fast-import", "--quiet"], { cwd: repoPath, input: stream });
    assert.equal(imported.status, 0, String(imported.stderr));

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 10_000,
      diffMaxBytes: 4_000_000,
    });
    const result = await service.getRelatedFiles(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ path: target, limit: String(RELATED_FILES_MAX_LIMIT) }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, true);
    assert.deepEqual(result.body.related, []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("RELATED_FILES_DEFAULT_LIMIT is the wire default for the limit knob", () => {
  // Sanity: keeps the constants visible to consumers (UI / tests) honest.
  assert.equal(RELATED_FILES_DEFAULT_LIMIT, 30);
  assert.equal(RELATED_FILES_MAX_LIMIT, 50);
  assert.equal(RELATED_FILES_TOP_K, 20);
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

function writeFiles(repoPath, files) {
  for (const [relPath, content] of Object.entries(files)) {
    const target = path.join(repoPath, relPath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

// Mirrors `git log --no-walk --name-only -z --format=%x00%H%x00%aI`.
function nameLogRecord(hash, authorDate, paths) {
  const names = paths.length > 0 ? `\n${paths.map((p) => `${p}\u0000`).join("")}` : "";
  return `\u0000${hash}\u0000${authorDate}\u0000${names}`;
}
