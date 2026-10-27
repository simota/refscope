import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { loadConfig } from "../src/config.js";
import { GitCommandError } from "../src/gitRunner.js";
import {
  ancestorMergeBaseArgs,
  buildSearchModeArgs,
  commitListLogArgs,
  commitDiffShowArgs,
  commitMetadataShowArgs,
  commitNameStatusShowArgs,
  commitNumstatShowArgs,
  commitObjectTypeArgs,
  commitRangeLogArgs,
  commitishRevParseArgs,
  compareMergeBaseArgs,
  compareNumstatArgs,
  compareRefSnapshots,
  compareRevListArgs,
  appendRefFlightEvent,
  cherryPatchArgs,
  comparePatchChanges,
  createGitService,
  createRefFlightEvent,
  escapeGitRegexLiteral,
  formatLiteralPathspec,
  parseChangedFiles,
  parseNumstatSummary,
  parseSignatureStatus,
  resolveCommitishRevision,
} from "../src/gitService.js";

test("rejects invalid commit list limit before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ limit: "bad" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid limit parameter" },
  });
});

test("rejects non-decimal commit list limit before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ limit: "1e2" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid limit parameter" },
  });
});

test("rejects duplicate commit list query parameters before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams([
      ["search", "first"],
      ["search", "second"],
    ]),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Duplicate search parameter" },
  });
});

test("rejects malformed commit list ref before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ ref: "refs/heads/main." }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid ref parameter" },
  });
});

test("rejects transient pseudo refs in commit list input before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  for (const ref of [
    "AUTO_MERGE",
    "BISECT_HEAD",
    "CHERRY_PICK_HEAD",
    "FETCH_HEAD",
    "MERGE_AUTOSTASH",
    "REBASE_HEAD",
    "BISECT_EXPECTED_REV",
    "REVERT_HEAD",
    "stash",
    "refs/stash",
    "refs/bisect/bad",
    "refs/notes/commits",
    "refs/original/refs/heads/main",
    "refs/prefetch/remotes/origin/main",
    "refs/changes/01/1/1",
    "refs/keep-around/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "refs/pull/1/head",
    "refs/replace/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "refs/rewritten/main",
    "refs/worktree/linked/HEAD",
  ]) {
    const result = await service.listCommits(
      { id: "demo", name: "demo", path: "/tmp/not-needed" },
      new URLSearchParams({ ref }),
    );

    assert.deepEqual(result, {
      status: 400,
      body: { error: "Invalid ref parameter" },
    });
  }
});

test("rejects commit list refs that do not resolve to commits", async () => {
  const repoPath = createTempPath("rtgv-list-ref-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "blob content should not be logged\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");
    const blobHash = git(repoPath, "hash-object", "README.md").trim();

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });

    const result = await service.listCommits(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ ref: blobHash }),
    );

    assert.deepEqual(result, {
      status: 404,
      body: { error: "Ref not found or not a commit" },
    });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("rejects malformed commit list path before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ path: "src//secret" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid path parameter" },
  });
});

test("applies commit search and author filters as independent literals", async () => {
  const repoPath = createTempPath("rtgv-list-filters-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Alice.Example+Bot");
    git(repoPath, "config", "user.email", "alice@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "Fix a.b");
    git(repoPath, "config", "user.name", "AliceXExample+Bot");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\nsecond\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "Fix axb");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });

    const result = await service.listCommits(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ search: "Fix a.b", author: "Alice.Example+Bot" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.length, 1);
    assert.equal(result.body[0].subject, "Fix a.b");
    assert.equal(result.body[0].author, "Alice.Example+Bot");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("rejects abbreviated commit detail hashes before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.getCommit(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    "a1b2c3d",
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid commit hash" },
  });
});

test("rejects abbreviated commit diff hashes before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.getDiff(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    "a1b2c3d",
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid commit hash" },
  });
});

test("rejects non-commit object ids for commit detail and diff endpoints", async () => {
  const repoPath = createTempPath("rtgv-non-commit-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "blob content should not be returned\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");
    const blobHash = git(repoPath, "hash-object", "README.md").trim();

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    assert.deepEqual(await service.getCommit(repo, blobHash), {
      status: 400,
      body: { error: "Hash does not identify a commit" },
    });
    assert.deepEqual(await service.getDiff(repo, blobHash), {
      status: 400,
      body: { error: "Hash does not identify a commit" },
    });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("does not execute repository textconv filters for API diff reads", async () => {
  const repoPath = createTempPath("rtgv-textconv-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    git(repoPath, "config", "diff.rtgv-textconv.textconv", "sh -c 'echo textconv should not run >&2; exit 42'");
    fs.writeFileSync(path.join(repoPath, ".gitattributes"), "*.bin diff=rtgv-textconv\n");
    fs.writeFileSync(path.join(repoPath, "sample.bin"), "before\n");
    git(repoPath, "add", ".gitattributes", "sample.bin");
    git(repoPath, "commit", "-m", "add binary sample");
    const baseHash = git(repoPath, "rev-parse", "HEAD").trim();
    fs.writeFileSync(path.join(repoPath, "sample.bin"), "after\n");
    git(repoPath, "add", "sample.bin");
    git(repoPath, "commit", "-m", "update binary sample");
    const commitHash = git(repoPath, "rev-parse", "HEAD").trim();

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 4096,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    const [detail, diff, compare] = await Promise.all([
      service.getCommit(repo, commitHash),
      service.getDiff(repo, commitHash),
      service.compareRefs(repo, new URLSearchParams({ base: baseHash, target: commitHash })),
    ]);

    assert.equal(detail.status, 200);
    assert.equal(diff.status, 200);
    assert.equal(compare.status, 200);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("does not execute repository gpg program while reading signature metadata", async () => {
  const repoPath = createTempPath("rtgv-gpg-program-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");

    const markerPath = path.join(repoPath, "gpg-ran");
    const gpgProgramPath = path.join(repoPath, "fake-gpg.sh");
    fs.writeFileSync(
      gpgProgramPath,
      `#!/bin/sh\necho ran > ${JSON.stringify(markerPath)}\nexit 1\n`,
      { mode: 0o755 },
    );
    git(repoPath, "config", "gpg.program", gpgProgramPath);
    git(repoPath, "config", "log.showSignature", "true");

    const treeHash = git(repoPath, "write-tree").trim();
    const parentHash = git(repoPath, "rev-parse", "HEAD").trim();
    const signedCommitHash = writeFakeSignedCommit(repoPath, treeHash, parentHash);
    git(repoPath, "update-ref", "refs/heads/main", signedCommitHash);

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 4096,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    const [commits, detail] = await Promise.all([
      service.listCommits(repo, new URLSearchParams({ ref: "HEAD" })),
      service.getCommit(repo, signedCommitHash),
    ]);

    assert.equal(commits.status, 200);
    assert.equal(detail.status, 200);
    assert.equal(fs.existsSync(markerPath), false);
    assert.equal(commits.body[0].signed, false);
    assert.equal(commits.body[0].signatureStatus, "unknown");
    assert.equal(detail.body.signed, false);
    assert.equal(detail.body.signatureStatus, "unknown");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("rejects malformed compare base before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.compareRefs(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ base: "refs/heads/main.", target: "HEAD" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid base parameter" },
  });
});

test("rejects transient pseudo refs in compare input before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  for (const base of [
    "AUTO_MERGE",
    "BISECT_HEAD",
    "CHERRY_PICK_HEAD",
    "FETCH_HEAD",
    "MERGE_AUTOSTASH",
    "REBASE_HEAD",
    "BISECT_EXPECTED_REV",
    "REVERT_HEAD",
    "stash",
    "refs/stash",
    "refs/bisect/bad",
    "refs/notes/commits",
    "refs/original/refs/heads/main",
    "refs/prefetch/remotes/origin/main",
    "refs/changes/01/1/1",
    "refs/keep-around/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "refs/pull/1/head",
    "refs/replace/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    "refs/rewritten/main",
    "refs/worktree/linked/HEAD",
  ]) {
    const result = await service.compareRefs(
      { id: "demo", name: "demo", path: "/tmp/not-needed" },
      new URLSearchParams({ base, target: "HEAD" }),
    );

    assert.deepEqual(result, {
      status: 400,
      body: { error: "Invalid base parameter" },
    });
  }
});

test("rejects duplicate compare target before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.compareRefs(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams([
      ["base", "HEAD"],
      ["target", "main"],
      ["target", "develop"],
    ]),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Duplicate target parameter" },
  });
});

test("rejects compare revisions that do not resolve to commits", async () => {
  const repoPath = createTempPath("rtgv-compare-ref-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "blob content should not be compared\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");
    const blobHash = git(repoPath, "hash-object", "README.md").trim();

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });

    const result = await service.compareRefs(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ base: blobHash, target: "HEAD" }),
    );

    assert.deepEqual(result, {
      status: 404,
      body: { error: "Ref not found or not a commit" },
    });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("builds compare git arguments with option parsing ended for resolved revisions", () => {
  const baseHash = "1111111111111111111111111111111111111111";
  const targetHash = "2222222222222222222222222222222222222222";

  assert.deepEqual(compareRevListArgs(targetHash, baseHash), [
    "rev-list",
    "--count",
    "--not",
    baseHash,
    "--not",
    "--end-of-options",
    targetHash,
  ]);
  assert.deepEqual(compareNumstatArgs("main", "feature/refscope"), [
    "diff",
    "--numstat",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--end-of-options",
    "main",
    "feature/refscope",
    "--",
  ]);
  assert.deepEqual(compareMergeBaseArgs("main", "feature/refscope"), [
    "merge-base",
    "--end-of-options",
    "main",
    "feature/refscope",
  ]);
});

test("builds object validation git arguments with option parsing ended", () => {
  const oldHash = "1111111111111111111111111111111111111111";
  const newHash = "2222222222222222222222222222222222222222";

  assert.deepEqual(ancestorMergeBaseArgs(oldHash, newHash), [
    "merge-base",
    "--is-ancestor",
    "--end-of-options",
    oldHash,
    newHash,
  ]);
  assert.deepEqual(commitObjectTypeArgs(oldHash), [
    "cat-file",
    "-t",
    "--end-of-options",
    oldHash,
  ]);
});

test("builds commit range git log arguments without concatenating revisions", () => {
  assert.deepEqual(
    commitRangeLogArgs(
      "1111111111111111111111111111111111111111",
      "2222222222222222222222222222222222222222",
    ),
    [
      "--not",
      "1111111111111111111111111111111111111111",
      "--not",
      "--end-of-options",
      "2222222222222222222222222222222222222222",
    ],
  );
});

test("builds commit list git log arguments with option parsing ended before resolved revisions", () => {
  const hash = "1111111111111111111111111111111111111111";

  assert.deepEqual(
    commitListLogArgs(
      25,
      ["--regexp-ignore-case", "--extended-regexp", "--grep=fix"],
      ["--regexp-ignore-case", "--extended-regexp", "--author=Alice"],
      hash,
      [":(literal,top)src/App.tsx"],
    ),
    [
      "log",
      "--max-count=25",
      "--date=iso-strict",
      "--regexp-ignore-case",
      "--extended-regexp",
      "--grep=fix",
      "--regexp-ignore-case",
      "--extended-regexp",
      "--author=Alice",
      "--format=%x00%H%x00%P%x00%an%x00%aI%x00%s%x00%D",
      "--no-show-signature",
      "--numstat",
      "-z",
      "--full-diff",
      "--no-ext-diff",
      "--no-textconv",
      "--end-of-options",
      hash,
      "--",
      ":(literal,top)src/App.tsx",
    ],
  );
  // Without a path filter the stats are already whole-commit.
  assert.equal(commitListLogArgs(25, [], [], hash, []).includes("--full-diff"), false);
});

test("builds commit-ish validation arguments with option parsing ended", () => {
  assert.deepEqual(commitishRevParseArgs("refs/heads/main"), [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    "refs/heads/main^{commit}",
  ]);
});

test("builds commit show arguments with option parsing ended before hashes", () => {
  const hash = "1111111111111111111111111111111111111111";

  assert.deepEqual(commitMetadataShowArgs(hash), [
    "show",
    "-s",
    "--date=iso-strict",
    "--format=%H%x00%P%x00%an%x00%ae%x00%aI%x00%s%x00%b%x00%D",
    "--no-show-signature",
    "--end-of-options",
    hash,
  ]);
  assert.deepEqual(commitNumstatShowArgs(hash), [
    "show",
    "--format=",
    "--no-show-signature",
    "-m",
    "--first-parent",
    "--numstat",
    "-z",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--end-of-options",
    hash,
    "--",
  ]);
  assert.deepEqual(commitNameStatusShowArgs(hash), [
    "show",
    "--format=",
    "--no-show-signature",
    "-m",
    "--first-parent",
    "--name-status",
    "-z",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--end-of-options",
    hash,
    "--",
  ]);
  assert.deepEqual(commitDiffShowArgs(hash), [
    "show",
    "--format=",
    "--no-show-signature",
    "-m",
    "--first-parent",
    "--no-ext-diff",
    "--no-textconv",
    "--patch",
    "--find-renames",
    "--stat",
    "--no-color",
    "--end-of-options",
    hash,
  ]);
});

test("resolves commit-ish revisions to commit object ids", async () => {
  const repoPath = createTempPath("rtgv-resolve-ref-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");
    const commitHash = git(repoPath, "rev-parse", "HEAD").trim();

    const result = await resolveCommitishRevision(
      { id: "demo", name: "demo", path: repoPath },
      "refs/heads/main",
      5000,
    );

    assert.deepEqual(result, { ok: true, hash: commitHash });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("does not resolve short names or symrefs to non-public refs", async () => {
  const repoPath = createTempPath("rtgv-resolve-dwim-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    git(repoPath, "commit", "--allow-empty", "-m", "base commit");
    const commitHash = git(repoPath, "rev-parse", "HEAD").trim();
    git(repoPath, "notes", "add", "-m", "private note", "HEAD");
    git(repoPath, "update-ref", "refs/original/refs/heads/main", commitHash);
    git(repoPath, "update-ref", "refs/bisect/bad", commitHash);
    git(repoPath, "update-ref", "refs/pull/1/head", commitHash);
    git(repoPath, "symbolic-ref", "refs/heads/alias", "refs/notes/commits");
    // A branch whose short name shares a first component with an internal
    // namespace still resolves when no internal ref of that name exists.
    git(repoPath, "branch", "notes/topic");
    const repo = { id: "demo", name: "demo", path: repoPath };

    for (const revision of [
      "notes/commits",
      "original/refs/heads/main",
      "bisect/bad",
      "pull/1/head",
      "refs/heads/alias",
      "alias",
    ]) {
      const result = await resolveCommitishRevision(repo, revision, 5000);
      assert.equal(result.ok, false, revision);
      assert.equal(result.result.status, 404, revision);
    }

    for (const revision of ["main", "heads/main", "refs/heads/main", "HEAD", "notes/topic", commitHash]) {
      assert.deepEqual(
        await resolveCommitishRevision(repo, revision, 5000),
        { ok: true, hash: commitHash },
        revision,
      );
    }

    // An ambiguous short name makes --symbolic-full-name print nothing, while
    // Git still resolves it to refs/<name> first.
    git(repoPath, "commit", "--allow-empty", "-m", "second commit");
    const secondHash = git(repoPath, "rev-parse", "HEAD").trim();
    git(repoPath, "branch", "notes/commits", "HEAD");
    git(repoPath, "branch", "pull/1/head", "HEAD");
    for (const revision of ["notes/commits", "pull/1/head"]) {
      const result = await resolveCommitishRevision(repo, revision, 5000);
      assert.equal(result.ok, false, revision);
      assert.equal(result.result.status, 404, revision);
    }
    // A branch and a tag sharing a name stay resolvable (Git picks the tag).
    git(repoPath, "tag", "same", commitHash);
    git(repoPath, "branch", "same", "HEAD");
    assert.deepEqual(await resolveCommitishRevision(repo, "same", 5000), { ok: true, hash: commitHash });
    assert.deepEqual(
      await resolveCommitishRevision(repo, secondHash.slice(0, 12), 5000),
      { ok: true, hash: secondHash },
    );

    git(repoPath, "checkout", "--detach", "HEAD");
    assert.deepEqual(await resolveCommitishRevision(repo, "HEAD", 5000), { ok: true, hash: secondHash });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("rejects commit list refs that only resolve to non-public refs", async () => {
  const repoPath = createTempPath("rtgv-list-dwim-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    git(repoPath, "commit", "--allow-empty", "-m", "base commit");
    git(repoPath, "notes", "add", "-m", "private note", "HEAD");
    const service = createGitService({
      repositories: new Map([["demo", { id: "demo", name: "demo", path: repoPath }]]),
      gitTimeoutMs: 5000,
      diffMaxBytes: 100_000,
    });

    const result = await service.listCommits(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ ref: "notes/commits" }),
    );
    assert.equal(result.status, 404);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("reports compare ahead and behind counts from target relative to base", async () => {
  const repoPath = createTempPath("rtgv-compare-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");
    git(repoPath, "checkout", "-b", "feature");
    fs.writeFileSync(path.join(repoPath, "feature.txt"), "feature\n");
    git(repoPath, "add", "feature.txt");
    git(repoPath, "commit", "-m", "feature commit");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });

    const result = await service.compareRefs(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ base: "main", target: "feature" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.ahead, 1);
    assert.equal(result.body.behind, 0);
    assert.equal(result.body.files, 1);
    assert.deepEqual(result.body.commands, {
      log: "git log --oneline feature --not main",
      stat: "git diff --stat main feature",
      diff: "git diff main feature",
    });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("lists annotated tag refs with their peeled commit hash", async () => {
  const repoPath = createTempPath("rtgv-refs-tags-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");
    const commitHash = git(repoPath, "rev-parse", "HEAD").trim();
    git(repoPath, "tag", "-a", "v1.0.0", "-m", "release");
    const tagObjectHash = git(repoPath, "rev-parse", "refs/tags/v1.0.0").trim();

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });

    const refs = await service.listRefs({ id: "demo", name: "demo", path: repoPath });
    const tag = refs.find((ref) => ref.name === "refs/tags/v1.0.0");

    assert.equal(tag.hash, commitHash);
    assert.notEqual(tag.hash, tagObjectHash);
    assert.equal(tag.type, "tag");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("classifies created, updated, and deleted refs", () => {
  const previous = new Map([
    [
      "refs/heads/main",
      {
        name: "refs/heads/main",
        shortName: "main",
        hash: "1111111",
        type: "branch",
        updatedAt: null,
      },
    ],
    [
      "refs/tags/v1.0.0",
      {
        name: "refs/tags/v1.0.0",
        shortName: "v1.0.0",
        hash: "2222222",
        type: "tag",
        updatedAt: null,
      },
    ],
  ]);
  const current = new Map([
    [
      "refs/heads/main",
      {
        name: "refs/heads/main",
        shortName: "main",
        hash: "3333333",
        type: "branch",
        updatedAt: null,
      },
    ],
    [
      "refs/heads/feature/live",
      {
        name: "refs/heads/feature/live",
        shortName: "feature/live",
        hash: "4444444",
        type: "branch",
        updatedAt: null,
      },
    ],
  ]);

  assert.deepEqual(compareRefSnapshots(previous, current), [
    {
      type: "ref_updated",
      ref: current.get("refs/heads/main"),
      previousHash: "1111111",
    },
    {
      type: "ref_created",
      ref: current.get("refs/heads/feature/live"),
    },
    {
      type: "ref_deleted",
      ref: previous.get("refs/tags/v1.0.0"),
    },
  ]);
});

test("creates ref flight event from updated ref change", () => {
  const change = {
    type: "ref_updated",
    previousHash: "1111111111111111111111111111111111111111",
    ref: {
      name: "refs/heads/main",
      shortName: "main",
      hash: "2222222222222222222222222222222222222222",
      type: "branch",
      updatedAt: null,
    },
  };

  assert.deepEqual(
    createRefFlightEvent({
      repoId: "demo",
      change,
      observedAt: "2026-05-24T00:00:00.000Z",
      eventType: "history_rewritten",
      dangerous: true,
      explanation: "not descendant",
    }),
    {
      id: "demo:refs/heads/main:1111111111111111111111111111111111111111:2222222222222222222222222222222222222222:2026-05-24T00:00:00.000Z",
      repoId: "demo",
      type: "history_rewritten",
      ref: change.ref,
      previousHash: "1111111111111111111111111111111111111111",
      currentHash: "2222222222222222222222222222222222222222",
      observedAt: "2026-05-24T00:00:00.000Z",
      detectionSource: "polling",
      dangerous: true,
      explanation: "not descendant",
    },
  );
});

test("appends ref flight events newest-first and de-duplicates same movement", () => {
  const logs = new Map();
  const base = {
    repoId: "demo",
    type: "ref_deleted",
    ref: {
      name: "refs/heads/old",
      shortName: "old",
      hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      type: "branch",
      updatedAt: null,
    },
    previousHash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    currentHash: null,
    detectionSource: "polling",
    dangerous: true,
    explanation: "deleted",
  };

  appendRefFlightEvent(logs, "demo", { ...base, id: "1", observedAt: "t1" });
  appendRefFlightEvent(logs, "demo", { ...base, id: "2", observedAt: "t2" });

  assert.deepEqual(logs.get("demo").map((event) => event.id), ["2"]);
});

test("collectRefEvents classifies a missing old commit object as history_rewritten", async () => {
  // `git merge-base --is-ancestor` exits 128 (not 1) when the old commit
  // object no longer exists (e.g. pruned after a force-push). That must be
  // treated as "not a fast-forward" → history_rewritten, not rethrown —
  // otherwise the SSE poller throws on every poll and never advances.
  const repoPath = createTempPath("rtgv-missing-ancestor-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "hello\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "feat: hello");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    const currentSnapshot = await service.getRefSnapshot(repo);
    const mainRef = currentSnapshot.get("refs/heads/main");
    assert.ok(mainRef, "fixture repo must expose refs/heads/main");

    const missingHash = "0123456789abcdef0123456789abcdef01234567";
    const previousSnapshot = new Map(currentSnapshot);
    previousSnapshot.set("refs/heads/main", { ...mainRef, hash: missingHash });

    const result = await service.collectRefEvents(repo, previousSnapshot);

    const rewritten = result.events.filter((event) => event.type === "history_rewritten");
    assert.equal(rewritten.length, 1);
    assert.equal(rewritten[0].previousHash, missingHash);
    assert.equal(rewritten[0].currentHash, mainRef.hash);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
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

function writeFakeSignedCommit(repoPath, treeHash, parentHash) {
  const timestamp = "1700000000 +0000";
  const commitPath = path.join(repoPath, "fake-signed-commit.txt");
  fs.writeFileSync(
    commitPath,
    [
      `tree ${treeHash}`,
      `parent ${parentHash}`,
      `author Realtime Test <realtime@example.test> ${timestamp}`,
      `committer Realtime Test <realtime@example.test> ${timestamp}`,
      "gpgsig -----BEGIN PGP SIGNATURE-----",
      " fake-signature-body",
      " -----END PGP SIGNATURE-----",
      "",
      "signed commit",
      "",
    ].join("\n"),
  );
  return git(repoPath, "hash-object", "-t", "commit", "-w", commitPath).trim();
}

test("parses changed files from NUL-separated numstat and name-status output", () => {
  const files = parseChangedFiles(
    [
      "12\t3\tsrc/App.tsx",
      "-\t-\tassets/logo.png",
      "0\t8\tdocs/old.md",
      "4\t1\t\0src/old-name.ts\0src/new-name.ts",
      "1\t0\t\0src/old.txt\0src/renamed.txt",
      "2\t1\t\0old-dir/nested.ts\0new-dir/nested.ts",
      "",
    ].join("\0"),
    [
      "M\0src/App.tsx",
      "A\0assets/logo.png",
      "D\0docs/old.md",
      "R087\0src/old-name.ts\0src/new-name.ts",
      "R050\0src/old.txt\0src/renamed.txt",
      "R075\0old-dir/nested.ts\0new-dir/nested.ts",
      "",
    ].join("\0"),
  );

  assert.deepEqual(files, [
    { status: "M", path: "src/App.tsx", added: 12, deleted: 3 },
    { status: "A", path: "assets/logo.png", added: 0, deleted: 0 },
    { status: "D", path: "docs/old.md", added: 0, deleted: 8 },
    { status: "R", path: "src/new-name.ts", added: 4, deleted: 1 },
    { status: "R", path: "src/renamed.txt", added: 1, deleted: 0 },
    { status: "R", path: "new-dir/nested.ts", added: 2, deleted: 1 },
  ]);
});

test("summarizes NUL-separated numstat records for commit list metadata", () => {
  assert.deepEqual(
    parseNumstatSummary([
      "12\t3\tsrc/App.tsx",
      "-\t-\tassets/logo.png",
      "0\t8\tdocs/old.md",
      "1\t0\t\0src/old.txt\0src/renamed.txt",
      "",
    ].join("\0")),
    { added: 13, deleted: 11, fileCount: 4 },
  );
});

test("escapes author filters before passing them to git regex matching", () => {
  assert.equal(
    escapeGitRegexLiteral("Alice.Example+Bot (CI) [prod]"),
    "Alice\\.Example\\+Bot \\(CI\\) \\[prod\\]",
  );
});

test("formats path filters as literal top-level git pathspecs", () => {
  assert.equal(formatLiteralPathspec("src/app/App.tsx"), ":(literal,top)src/app/App.tsx");
});

test("normalizes git signature status codes for API responses", () => {
  assert.equal(parseSignatureStatus("G"), "valid");
  assert.equal(parseSignatureStatus("U"), "untrusted");
  assert.equal(parseSignatureStatus("B"), "bad");
  assert.equal(parseSignatureStatus("X"), "expired-signature");
  assert.equal(parseSignatureStatus("Y"), "expired-key");
  assert.equal(parseSignatureStatus("R"), "revoked-key");
  assert.equal(parseSignatureStatus("E"), "missing-key");
  assert.equal(parseSignatureStatus("N"), "unsigned");
  assert.equal(parseSignatureStatus("N\n"), "unsigned");
  assert.equal(parseSignatureStatus(""), "unknown");
});

// --- buildSearchModeArgs unit tests ---

test("buildSearchModeArgs pickaxe mode uses attached form -SPATTERN", () => {
  assert.deepEqual(buildSearchModeArgs("pickaxe", "OAUTH_SECRET", ""), ["-SOAUTH_SECRET"]);
});

test("buildSearchModeArgs pickaxe mode with hyphen-leading pattern stays safe via attached form", () => {
  // "-S-delete" is a single argument — Git interprets it as pickaxe for "-delete",
  // not as the -S flag followed by a separate -delete flag.
  assert.deepEqual(buildSearchModeArgs("pickaxe", "-delete", ""), ["-S-delete"]);
});

test("buildSearchModeArgs regex mode uses attached form -GPATTERN", () => {
  assert.deepEqual(buildSearchModeArgs("regex", "foo.*bar", ""), ["-Gfoo.*bar"]);
});

test("buildSearchModeArgs message mode uses --grep with raw regex (no escaping)", () => {
  assert.deepEqual(buildSearchModeArgs("message", "^feat", ""), [
    "--regexp-ignore-case",
    "--extended-regexp",
    "--grep=^feat",
  ]);
});

test("buildSearchModeArgs subject mode with search uses escaped --grep for backward compat", () => {
  assert.deepEqual(buildSearchModeArgs("subject", "", "hello"), [
    "--regexp-ignore-case",
    "--extended-regexp",
    "--grep=hello",
  ]);
  // Special regex chars are escaped when passed via legacy `search` param
  assert.deepEqual(buildSearchModeArgs("subject", "", "Fix a.b"), [
    "--regexp-ignore-case",
    "--extended-regexp",
    "--grep=Fix a\\.b",
  ]);
});

test("buildSearchModeArgs returns empty array when mode has no pattern and no search", () => {
  assert.deepEqual(buildSearchModeArgs("subject", "", ""), []);
  assert.deepEqual(buildSearchModeArgs("pickaxe", "", ""), []);
  assert.deepEqual(buildSearchModeArgs("regex", "", ""), []);
  assert.deepEqual(buildSearchModeArgs("message", "", ""), []);
});

// --- listCommits search mode integration tests ---

test("listCommits rejects invalid mode before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ mode: "invalid" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid mode parameter" },
  });
});

test("listCommits rejects pattern with control characters before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ mode: "pickaxe", pattern: "foo\x00bar" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid pattern parameter" },
  });
});

test("listCommits rejects combining search with non-subject mode", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ search: "foo", mode: "pickaxe", pattern: "bar" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Cannot combine search and mode parameters" },
  });
});

test("listCommits allows combining search with mode=subject (backward compatible)", async () => {
  // search + mode=subject must NOT be rejected with the "Cannot combine" 400.
  // Use a real temp repo so the request reaches the git layer without a hard error.
  const repoPath = createTempPath("rtgv-search-subject-compat-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "hello\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "feat: hello");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });

    const result = await service.listCommits(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ search: "hello", mode: "subject" }),
    );

    // Must succeed (not return the "Cannot combine" error)
    assert.equal(result.status, 200);
    assert.notEqual(result.body?.error, "Cannot combine search and mode parameters");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("listCommits pickaxe mode finds commits where a literal token appears or disappears", async () => {
  const repoPath = createTempPath("rtgv-pickaxe-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");

    // Commit 1: introduce the secret
    fs.writeFileSync(path.join(repoPath, "config.txt"), "SUPER_SECRET_TOKEN=abc123\n");
    git(repoPath, "add", "config.txt");
    git(repoPath, "commit", "-m", "add secret token");

    // Commit 2: unrelated change (should NOT be in pickaxe results)
    fs.writeFileSync(path.join(repoPath, "README.md"), "docs\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "add readme");

    // Commit 3: remove the secret
    fs.writeFileSync(path.join(repoPath, "config.txt"), "TOKEN_REMOVED=true\n");
    git(repoPath, "add", "config.txt");
    git(repoPath, "commit", "-m", "remove secret token");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 4096,
    });

    const result = await service.listCommits(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ mode: "pickaxe", pattern: "SUPER_SECRET_TOKEN" }),
    );

    assert.equal(result.status, 200);
    // Both the commit that added and the commit that removed the token should appear
    assert.equal(result.body.length, 2);
    const subjects = result.body.map((c) => c.subject).sort();
    assert.deepEqual(subjects, ["add secret token", "remove secret token"]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("listCommits regex mode finds commits whose diff matches a regex", async () => {
  const repoPath = createTempPath("rtgv-regex-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");

    // Commit 1: add a function with a specific pattern in the diff
    fs.writeFileSync(path.join(repoPath, "api.js"), "function fetchData() { return null; }\n");
    git(repoPath, "add", "api.js");
    git(repoPath, "commit", "-m", "add fetchData function");

    // Commit 2: unrelated change
    fs.writeFileSync(path.join(repoPath, "README.md"), "readme\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "add readme");

    // Commit 3: modify the function name (diff contains the old name in removal)
    fs.writeFileSync(path.join(repoPath, "api.js"), "function loadData() { return null; }\n");
    git(repoPath, "add", "api.js");
    git(repoPath, "commit", "-m", "rename fetchData to loadData");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 4096,
    });

    const result = await service.listCommits(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ mode: "regex", pattern: "fetch.*Data" }),
    );

    assert.equal(result.status, 200);
    // Both commits touching the function name should appear
    assert.ok(result.body.length >= 1, "expected at least one regex match");
    const subjects = result.body.map((c) => c.subject);
    assert.ok(subjects.some((s) => s.includes("fetchData") || s.includes("rename")));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("listCommits message mode finds commits by commit message regex", async () => {
  const repoPath = createTempPath("rtgv-message-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");

    fs.writeFileSync(path.join(repoPath, "a.txt"), "a\n");
    git(repoPath, "add", "a.txt");
    git(repoPath, "commit", "-m", "feat: add feature A");

    fs.writeFileSync(path.join(repoPath, "b.txt"), "b\n");
    git(repoPath, "add", "b.txt");
    git(repoPath, "commit", "-m", "fix: fix bug B");

    fs.writeFileSync(path.join(repoPath, "c.txt"), "c\n");
    git(repoPath, "add", "c.txt");
    git(repoPath, "commit", "-m", "feat: add feature C");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 4096,
    });

    const result = await service.listCommits(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ mode: "message", pattern: "^feat:" }),
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.length, 2, "should find exactly the two feat: commits");
    const subjects = result.body.map((c) => c.subject).sort();
    assert.deepEqual(subjects, ["feat: add feature A", "feat: add feature C"]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("listCommits returns 400 when a regex or message pattern does not compile", async () => {
  const repoPath = createTempPath("rtgv-bad-regex-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "a.txt"), "a\n");
    git(repoPath, "add", "a.txt");
    git(repoPath, "commit", "-m", "feat: add a");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 4096,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    for (const mode of ["regex", "message"]) {
      const result = await service.listCommits(repo, new URLSearchParams({ mode, pattern: "(" }));
      assert.equal(result.status, 400, mode);
      assert.deepEqual(result.body, { error: "Invalid pattern parameter" });
    }
    // pickaxe (-S) treats the pattern as a literal string, so "(" is valid.
    const pickaxe = await service.listCommits(repo, new URLSearchParams({ mode: "pickaxe", pattern: "(" }));
    assert.equal(pickaxe.status, 200);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("listCommits rejects duplicate mode parameter before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams([
      ["mode", "pickaxe"],
      ["mode", "regex"],
    ]),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Duplicate mode parameter" },
  });
});

test("getCommitContainingRefs rejects malformed hash before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.getCommitContainingRefs(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    "not-a-hash",
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid commit hash" },
  });
});

test("getCommitContainingRefs returns refs whose history reaches the commit", async () => {
  const repoPath = createTempPath("rtgv-contains-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");
    const baseHash = git(repoPath, "rev-parse", "HEAD").trim();

    // main advances; release/2026.05 forks from base; feature/x is unrelated.
    git(repoPath, "checkout", "-b", "release/2026.05");
    git(repoPath, "checkout", "main");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\nmain advance\n");
    git(repoPath, "commit", "-am", "advance main");
    const mainTipHash = git(repoPath, "rev-parse", "HEAD").trim();
    git(repoPath, "tag", "v0.1.0");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    // Base commit reaches main, release/2026.05, and tag v0.1.0 only via main.
    const baseResult = await service.getCommitContainingRefs(repo, baseHash);
    assert.equal(baseResult.status, 200);
    const baseShortNames = baseResult.body.refs.map((r) => r.shortName).sort();
    assert.deepEqual(baseShortNames, ["main", "release/2026.05", "v0.1.0"]);

    // Tip commit on main is not on release/2026.05 (which forked at base).
    const tipResult = await service.getCommitContainingRefs(repo, mainTipHash);
    assert.equal(tipResult.status, 200);
    const tipShortNames = tipResult.body.refs.map((r) => r.shortName).sort();
    assert.deepEqual(tipShortNames, ["main", "v0.1.0"]);

    // Refs carry type metadata so the UI can group branches vs tags.
    const types = new Map(tipResult.body.refs.map((r) => [r.shortName, r.type]));
    assert.equal(types.get("main"), "branch");
    assert.equal(types.get("v0.1.0"), "tag");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareCherry separates patch-id equivalent commits from missing ones", async () => {
  const repoPath = createTempPath("rtgv-cherry-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");

    // Branch off `release`, give it a release-only commit, then back to
    // main. This is critical for the cherry-pick test: if release stays at
    // base when we cherry-pick, the cherry-picked commit ends up with the
    // *same* hash as on main (same tree + same parent), and `git cherry`
    // only flags commits that are in head-not-upstream *by hash*. The
    // release-only commit makes the cherry-pick produce a distinct SHA so
    // patch-id correlation has work to do.
    git(repoPath, "checkout", "-b", "release");
    fs.writeFileSync(path.join(repoPath, "release-only.txt"), "release-only\n");
    git(repoPath, "add", "release-only.txt");
    git(repoPath, "commit", "-m", "chore(release): branch off");
    git(repoPath, "checkout", "main");

    fs.writeFileSync(path.join(repoPath, "fix.txt"), "fix\n");
    git(repoPath, "add", "fix.txt");
    git(repoPath, "commit", "-m", "fix: critical bug");

    fs.writeFileSync(path.join(repoPath, "feature.txt"), "feature\n");
    git(repoPath, "add", "feature.txt");
    git(repoPath, "commit", "-m", "feat: new thing");

    const fixHash = git(repoPath, "rev-parse", "HEAD~1").trim();
    const featureHash = git(repoPath, "rev-parse", "HEAD").trim();

    git(repoPath, "checkout", "release");
    git(repoPath, "cherry-pick", fixHash);
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    const result = await service.getCompareCherry(
      repo,
      new URLSearchParams({ base: "main", target: "release" }),
    );
    assert.equal(result.status, 200);

    const equivalentHashes = result.body.equivalent.map((c) => c.hash).sort();
    const missingHashes = result.body.missing.map((c) => c.hash).sort();

    // The fix commit was cherry-picked → equivalent. The feature commit
    // was not → missing.
    assert.deepEqual(equivalentHashes, [fixHash].sort());
    assert.deepEqual(missingHashes, [featureHash].sort());
    // Subjects flow through so the UI can render them without an extra
    // round-trip per row.
    const fixEntry = result.body.equivalent.find((c) => c.hash === fixHash);
    assert.equal(fixEntry?.subject, "fix: critical bug");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareCherry returns 400 for invalid base/target", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const result = await service.getCompareCherry(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ base: "refs/heads/x.", target: "main" }),
  );
  assert.equal(result.status, 400);
});

test("getCompareCherry returns 400 for invalid nearIdenticalThreshold", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const result = await service.getCompareCherry(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ base: "main", target: "release", nearIdenticalThreshold: "999" }),
  );
  assert.equal(result.status, 400);
  assert.match(result.body.error, /nearIdenticalThreshold/);
});

test("getCompareCherry grades equivalent commits as identical on clean cherry-pick", async () => {
  const repoPath = createTempPath("rtgv-cherry-grade-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");

    // Create release branch with a diverging commit so cherry-pick produces
    // a distinct SHA (required for patch-id correlation to have work to do).
    git(repoPath, "checkout", "-b", "release");
    fs.writeFileSync(path.join(repoPath, "release-only.txt"), "release-only\n");
    git(repoPath, "add", "release-only.txt");
    git(repoPath, "commit", "-m", "chore(release): branch off");
    git(repoPath, "checkout", "main");

    fs.writeFileSync(path.join(repoPath, "fix.txt"), "fix\n");
    git(repoPath, "add", "fix.txt");
    git(repoPath, "commit", "-m", "fix: critical bug");
    const fixHash = git(repoPath, "rev-parse", "HEAD").trim();

    git(repoPath, "checkout", "release");
    git(repoPath, "cherry-pick", fixHash);
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024 * 1024,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    const result = await service.getCompareCherry(
      repo,
      new URLSearchParams({ base: "main", target: "release" }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.threshold, 10, "default threshold echoed");

    // The fix was cleanly cherry-picked — no diff — so grade must be identical.
    const fixEntry = result.body.equivalent.find((c) => c.hash === fixHash);
    assert.ok(fixEntry, "fix commit should be in equivalent list");
    assert.equal(fixEntry.grade, "identical", "clean cherry-pick should grade as identical");
    assert.deepEqual(fixEntry.diffLines, { added: 0, deleted: 0 });
    assert.equal(fixEntry.diffHunks, undefined, "identical entries carry no diffHunks");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("cherryPatchArgs reads one commit's own patch with options terminated", () => {
  const hash = "a".repeat(40);
  assert.deepEqual(cherryPatchArgs(hash, [":(literal,top)-x"]), [
    "diff",
    "--no-color",
    "--no-ext-diff",
    "--no-textconv",
    "-U0",
    "--find-renames",
    "--end-of-options",
    `${hash}^`,
    hash,
    "--",
    ":(literal,top)-x",
  ]);
});

test("comparePatchChanges ignores hunk positions and reports an interdiff", () => {
  const header = "diff --git a/f b/f";
  const base = [header, "--- a/f", "+++ b/f", "@@ -5 +5 @@", "-old", "+new", "+same"].join("\n");
  const moved = [header, "--- a/f", "+++ b/f", "@@ -50 +50 @@", "-old", "+new", "+same"].join("\n");
  assert.deepEqual(comparePatchChanges(base, moved), { added: 0, deleted: 0, hunks: "" });

  const spaced = [header, "--- a/f", "+++ b/f", "@@ -5 +5 @@", "-old", "+  new", "+same"].join("\n");
  assert.deepEqual(comparePatchChanges(base, spaced), {
    added: 1,
    deleted: 1,
    hunks: [header, "-+new", "++  new"].join("\n"),
  });

  // Edits swapped between two identical lines cancel out as a multiset but
  // are a real difference: order is kept even though positions are not.
  const swappedBase = [header, "@@ -1 +1 @@", "-a", "+ a", "@@ -3 +3 @@", "-a", "+  a"].join("\n");
  const swappedTarget = [header, "@@ -1 +1 @@", "-a", "+  a", "@@ -3 +3 @@", "-a", "+ a"].join("\n");
  const swapped = comparePatchChanges(swappedBase, swappedTarget);
  assert.deepEqual([swapped.added, swapped.deleted], [2, 2]);
});

test("getCompareCherry grades a clean cherry-pick identical when the branches already differ in that file", async () => {
  // Comparing B and T file states counted the release branch's own edits to
  // f.txt as cherry-pick divergence; only the two patches may be compared.
  const repoPath = createTempPath("rtgv-cherry-drift-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    fs.writeFileSync(path.join(repoPath, "f.txt"), `${lines.join("\n")}\n`);
    git(repoPath, "add", "f.txt");
    git(repoPath, "commit", "-m", "base commit");

    git(repoPath, "checkout", "-b", "release");
    const releaseLines = lines.map((line, i) => (i >= 40 && i < 90 ? `${line} (release)` : line));
    fs.writeFileSync(path.join(repoPath, "f.txt"), `${releaseLines.join("\n")}\n`);
    git(repoPath, "commit", "-am", "chore(release): release-only edits");
    git(repoPath, "checkout", "main");

    const fixedLines = [...lines];
    fixedLines[4] = "line 5 fixed";
    fs.writeFileSync(path.join(repoPath, "f.txt"), `${fixedLines.join("\n")}\n`);
    git(repoPath, "commit", "-am", "fix: line 5");
    const fixHash = git(repoPath, "rev-parse", "HEAD").trim();

    git(repoPath, "checkout", "release");
    git(repoPath, "cherry-pick", fixHash);
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024 * 1024,
    });
    const result = await service.getCompareCherry(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ base: "main", target: "release" }),
    );
    assert.equal(result.status, 200);
    const fixEntry = result.body.equivalent.find((c) => c.hash === fixHash);
    assert.ok(fixEntry, "fix commit should be patch-id equivalent");
    assert.equal(fixEntry.grade, "identical");
    assert.deepEqual(fixEntry.diffLines, { added: 0, deleted: 0 });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareCherry grades a cherry-picked rename of a large file as identical", async () => {
  // With only the new path in the pathspec, each side's patch was an add of
  // the whole file, overflowed the per-entry byte cap and became "ungraded".
  const repoPath = createTempPath("rtgv-cherry-rename-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    const body = Array.from({ length: 4000 }, (_, i) => `line ${i} of a large file`).join("\n");
    fs.writeFileSync(path.join(repoPath, "old.txt"), `${body}\n`);
    git(repoPath, "add", "old.txt");
    git(repoPath, "commit", "-m", "base commit");
    git(repoPath, "checkout", "-b", "release");
    fs.writeFileSync(path.join(repoPath, "release-only.txt"), "release\n");
    git(repoPath, "add", "release-only.txt");
    git(repoPath, "commit", "-m", "chore(release): branch off");
    git(repoPath, "checkout", "main");

    git(repoPath, "mv", "old.txt", "new.txt");
    git(repoPath, "commit", "-m", "refactor: rename");
    const renameHash = git(repoPath, "rev-parse", "HEAD").trim();
    git(repoPath, "checkout", "release");
    git(repoPath, "cherry-pick", renameHash);
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024 * 1024,
    });
    const result = await service.getCompareCherry(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ base: "main", target: "release" }),
    );
    const entry = result.body.equivalent.find((c) => c.hash === renameHash);
    assert.ok(entry, "rename commit should be patch-id equivalent");
    assert.equal(entry.grade, "identical");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareCherry grades near-identical when only whitespace differs", async () => {
  // `git patch-id` is whitespace-insensitive; a cherry-pick that adds or removes
  // only leading spaces will still report `-` (equivalent) but `git diff B T --
  // paths` will show the whitespace change. This is the primary real-world case
  // for near-identical: conflict resolution changed indentation without altering
  // logic, and git cherry still considers the commit equivalent.
  const repoPath = createTempPath("rtgv-cherry-near-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");

    git(repoPath, "checkout", "-b", "release");
    fs.writeFileSync(path.join(repoPath, "release-only.txt"), "release-only\n");
    git(repoPath, "add", "release-only.txt");
    git(repoPath, "commit", "-m", "chore(release): branch off");
    git(repoPath, "checkout", "main");

    // Commit on main: add fix.txt with no leading whitespace.
    fs.writeFileSync(path.join(repoPath, "fix.txt"), "return 1\n");
    git(repoPath, "add", "fix.txt");
    git(repoPath, "commit", "-m", "fix: add function");
    const fixHash = git(repoPath, "rev-parse", "HEAD").trim();

    // Cherry-pick to release, then amend with extra leading spaces only.
    // `git patch-id` ignores whitespace so git cherry still marks it as `-`
    // (equivalent). `git diff B T -- fix.txt` will show 1 deleted + 1 added
    // line (the whitespace change).
    git(repoPath, "checkout", "release");
    git(repoPath, "cherry-pick", fixHash);
    fs.writeFileSync(path.join(repoPath, "fix.txt"), "  return 1\n");
    git(repoPath, "add", "fix.txt");
    git(repoPath, "commit", "--amend", "--no-edit");
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024 * 1024,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    // Use threshold=5 so 2 diff lines (1 deleted + 1 added) falls within it.
    const result = await service.getCompareCherry(
      repo,
      new URLSearchParams({ base: "main", target: "release", nearIdenticalThreshold: "5" }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.threshold, 5, "custom threshold echoed");

    const fixEntry = result.body.equivalent.find((c) => c.hash === fixHash);
    assert.ok(fixEntry, "fix commit should be in equivalent list (patch-id matches despite whitespace)");
    // Whitespace-only change: 1 deleted + 1 added = 2 total diff lines ≤ threshold 5.
    assert.equal(fixEntry.grade, "near-identical");
    assert.ok(fixEntry.diffLines, "diffLines should be present for near-identical");
    assert.ok((fixEntry.diffLines.added + fixEntry.diffLines.deleted) > 0, "non-zero diff lines");
    assert.ok(fixEntry.diffHunks, "diffHunks should be present for near-identical");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCommit keeps line counts for a rename into the parent directory", async () => {
  // numstat abbreviates this rename as `a/{b => }/f`; expanding it naively
  // produced `a//f`, which no longer matched the name-status path, so the
  // file reported 0 added lines.
  const repoPath = createTempPath("rtgv-rename-parent-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.mkdirSync(path.join(repoPath, "a", "b"), { recursive: true });
    const body = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
    fs.writeFileSync(path.join(repoPath, "a", "b", "f"), body);
    fs.mkdirSync(path.join(repoPath, "c"), { recursive: true });
    fs.writeFileSync(path.join(repoPath, "c", "g"), body);
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "seed");
    git(repoPath, "mv", "a/b/f", "a/f");
    fs.appendFileSync(path.join(repoPath, "a", "f"), "line 21\n");
    git(repoPath, "mv", "c/g", "g");
    fs.appendFileSync(path.join(repoPath, "g"), "line 21\n");
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-m", "flatten");
    const hash = git(repoPath, "rev-parse", "HEAD").trim();

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });
    const result = await service.getCommit({ id: "demo", name: "demo", path: repoPath }, hash);

    assert.equal(result.status, 200);
    const files = Object.fromEntries(
      result.body.files.map((file) => [file.path, [file.added, file.deleted]]),
    );
    assert.deepEqual(files, { "a/f": [1, 0], g: [1, 0] });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareCherry grades commits touching non-ASCII paths instead of calling them identical", async () => {
  // `diff --name-only` without -z C-quotes non-ASCII names; used as a
  // pathspec, the quoted form matches nothing and the empty diff was graded
  // "identical" even though the cherry-picked file differs.
  const repoPath = createTempPath("rtgv-cherry-nonascii-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");
    git(repoPath, "checkout", "-b", "release");
    git(repoPath, "checkout", "main");

    fs.writeFileSync(path.join(repoPath, "修正 file.txt"), "return 1\n");
    git(repoPath, "add", "修正 file.txt");
    git(repoPath, "commit", "-m", "fix: add function");
    const fixHash = git(repoPath, "rev-parse", "HEAD").trim();

    git(repoPath, "checkout", "release");
    git(repoPath, "cherry-pick", fixHash);
    fs.writeFileSync(path.join(repoPath, "修正 file.txt"), "  return 1\n");
    git(repoPath, "add", "修正 file.txt");
    git(repoPath, "commit", "--amend", "--no-edit");
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024 * 1024,
    });
    const result = await service.getCompareCherry(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ base: "main", target: "release", nearIdenticalThreshold: "5" }),
    );
    assert.equal(result.status, 200);
    const fixEntry = result.body.equivalent.find((c) => c.hash === fixHash);
    assert.ok(fixEntry, "fix commit should be patch-id equivalent");
    assert.equal(fixEntry.grade, "near-identical");
    assert.deepEqual(fixEntry.diffLines, { added: 1, deleted: 1 });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareCherry grades divergent when whitespace diff exceeds threshold", async () => {
  // Same whitespace-insensitive patch-id scenario as near-identical, but with
  // enough lines changed (> threshold) to push the entry into "divergent".
  const repoPath = createTempPath("rtgv-cherry-div-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "base\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "base commit");

    git(repoPath, "checkout", "-b", "release");
    fs.writeFileSync(path.join(repoPath, "release-only.txt"), "release-only\n");
    git(repoPath, "add", "release-only.txt");
    git(repoPath, "commit", "-m", "chore(release): branch off");
    git(repoPath, "checkout", "main");

    // Add a 20-line file on main (no leading whitespace).
    const originalLines = Array.from({ length: 20 }, (_, i) => `line${i}`).join("\n") + "\n";
    fs.writeFileSync(path.join(repoPath, "fix.txt"), originalLines);
    git(repoPath, "add", "fix.txt");
    git(repoPath, "commit", "-m", "fix: add file");
    const fixHash = git(repoPath, "rev-parse", "HEAD").trim();

    // Cherry-pick to release, then amend by adding 2-space indent to every
    // line. `git patch-id` is whitespace-insensitive so git cherry still sees
    // `-` (equivalent). The diff will show 20 deleted + 20 added = 40 lines,
    // well above threshold=5 → divergent.
    git(repoPath, "checkout", "release");
    git(repoPath, "cherry-pick", fixHash);
    const indentedLines = Array.from({ length: 20 }, (_, i) => `  line${i}`).join("\n") + "\n";
    fs.writeFileSync(path.join(repoPath, "fix.txt"), indentedLines);
    git(repoPath, "add", "fix.txt");
    git(repoPath, "commit", "--amend", "--no-edit");
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024 * 1024,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    const result = await service.getCompareCherry(
      repo,
      new URLSearchParams({ base: "main", target: "release", nearIdenticalThreshold: "5" }),
    );
    assert.equal(result.status, 200);

    const fixEntry = result.body.equivalent.find((c) => c.hash === fixHash);
    assert.ok(fixEntry, "fix commit should be in equivalent list (patch-id matches despite whitespace)");
    // 40 diff lines (20 deleted + 20 added) > threshold 5 → divergent.
    assert.equal(fixEntry.grade, "divergent");
    assert.ok(fixEntry.diffLines, "diffLines should be present for divergent");
    assert.ok((fixEntry.diffLines.added + fixEntry.diffLines.deleted) > 5, "diff lines exceed threshold");
    assert.ok(fixEntry.diffHunks, "diffHunks should be present for divergent");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCommitContainingRefs returns empty list for unreachable commit", async () => {
  const repoPath = createTempPath("rtgv-contains-empty-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    fs.writeFileSync(path.join(repoPath, "README.md"), "first\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "first");
    const reachableHash = git(repoPath, "rev-parse", "HEAD").trim();

    // Make a dangling commit (no ref points to it / no ref reaches it).
    fs.writeFileSync(path.join(repoPath, "README.md"), "second\n");
    git(repoPath, "add", "README.md");
    const danglingTreeHash = git(repoPath, "write-tree").trim();
    const danglingHash = git(
      repoPath,
      "commit-tree",
      danglingTreeHash,
      "-p",
      reachableHash,
      "-m",
      "dangling",
    ).trim();

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 1024,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    const result = await service.getCommitContainingRefs(repo, danglingHash);
    assert.deepEqual(result, { status: 200, body: { refs: [] } });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

function initTestRepo(repoPath) {
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Realtime Test");
  git(repoPath, "config", "user.email", "realtime@example.test");
}

test("getCommit reports non-ASCII paths verbatim, including renames", async () => {
  const repoPath = createTempPath("rtgv-commit-nonascii-");
  try {
    initTestRepo(repoPath);
    fs.writeFileSync(path.join(repoPath, "ü.txt"), "one\n");
    fs.writeFileSync(path.join(repoPath, "日本.txt"), "two\n");
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-m", "add");
    git(repoPath, "mv", "ü.txt", "é.txt");
    git(repoPath, "mv", "日本.txt", "plain.txt");
    fs.writeFileSync(path.join(repoPath, "新規.txt"), "a\nb\n");
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-m", "rename");
    const hash = git(repoPath, "rev-parse", "HEAD").trim();

    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 1024 * 1024 });
    const result = await service.getCommit({ id: "demo", name: "demo", path: repoPath }, hash);
    assert.equal(result.status, 200);
    const files = Object.fromEntries(
      result.body.files.map((file) => [file.path, [file.status, file.added, file.deleted]]),
    );
    assert.deepEqual(files, {
      "é.txt": ["R", 0, 0],
      "plain.txt": ["R", 0, 0],
      "新規.txt": ["A", 2, 0],
    });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCommit does not classify a binary change as whitespace_only", async () => {
  const repoPath = createTempPath("rtgv-commit-binary-");
  try {
    initTestRepo(repoPath);
    fs.writeFileSync(path.join(repoPath, "blob.dat"), Buffer.from([0, 1, 2, 0, 255]));
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-m", "binary");
    const hash = git(repoPath, "rev-parse", "HEAD").trim();

    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 1024 * 1024 });
    const result = await service.getCommit({ id: "demo", name: "demo", path: repoPath }, hash);
    const [file] = result.body.files;
    assert.equal(file.path, "blob.dat");
    assert.equal(file.added, 0);
    assert.equal(file.deleted, 0);
    assert.notEqual(file.structuralKind, "whitespace_only");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("listCommits keeps whole-commit stats when filtered by path", async () => {
  const repoPath = createTempPath("rtgv-list-fulldiff-");
  try {
    initTestRepo(repoPath);
    fs.writeFileSync(path.join(repoPath, "a.txt"), "a\n");
    fs.writeFileSync(path.join(repoPath, "b.txt"), "b\nb\n");
    fs.writeFileSync(path.join(repoPath, "c.txt"), "c\nc\nc\n");
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-m", "three files");

    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 1024 * 1024 });
    const repo = { id: "demo", name: "demo", path: repoPath };
    const pick = ({ added, deleted, fileCount, riskScore }) => ({ added, deleted, fileCount, riskScore });
    const all = await service.listCommits(repo, new URLSearchParams());
    const filtered = await service.listCommits(repo, new URLSearchParams({ path: "a.txt" }));
    assert.equal(filtered.status, 200);
    assert.equal(filtered.body.length, 1);
    assert.deepEqual(pick(filtered.body[0]), pick(all.body[0]));
    assert.equal(filtered.body[0].fileCount, 3);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("removing a repository forgets its ref-flight log, so a re-added id starts clean", async () => {
  const tempDir = createTempPath("rtgv-cache-reset-");
  try {
    const repoPath = path.join(tempDir, "repo");
    fs.mkdirSync(repoPath);
    initTestRepo(repoPath);
    fs.writeFileSync(path.join(repoPath, "README.md"), "hello\n");
    git(repoPath, "add", "README.md");
    git(repoPath, "commit", "-m", "init");

    const config = loadConfig({ RTGV_REPOS: "", XDG_CONFIG_HOME: path.join(tempDir, "config") });
    const service = createGitService(config);
    const repo = service.addRepository("x", repoPath);

    const snapshot = await service.getRefSnapshot(repo);
    const previous = new Map(snapshot);
    previous.delete("refs/heads/main");
    await service.collectRefEvents(repo, previous);
    const before = await service.listRefFlightEvents(repo, new URLSearchParams());
    assert.ok(before.body.events.length > 0, "fixture must record a flight event");

    service.removeRepository("x");
    const readded = service.addRepository("x", repoPath);
    const after = await service.listRefFlightEvents(readded, new URLSearchParams());
    assert.deepEqual(after.body.events, []);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("commit text and file contents cannot forge commit records", async () => {
  const repoPath = createTempPath("rtgv-record-forge-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    const forgedHash = "deadbeef".repeat(5);
    fs.writeFileSync(path.join(repoPath, "a.txt"), "one\n");
    git(repoPath, "add", "a.txt");
    git(repoPath, "commit", "-m", "base");
    fs.writeFileSync(path.join(repoPath, "a.txt"), `one\n\x1e${forgedHash}\n`);
    git(repoPath, "add", "a.txt");
    git(repoPath, "commit", "-m", `subject\x1e${forgedHash}`, "-m", `body\n\x1e${forgedHash}`);
    const repo = { id: "demo", name: "demo", path: repoPath };
    const service = createGitService({
      repositories: new Map([["demo", repo]]),
      gitTimeoutMs: 5000,
      diffMaxBytes: 100_000,
    });

    const list = await service.listCommits(repo, new URLSearchParams({ ref: "HEAD", limit: "10" }));
    assert.equal(list.status, 200);
    assert.equal(list.body.length, 2);
    assert.equal(list.body[0].subject, `subject\x1e${forgedHash}`);
    assert.equal(list.body[0].fileCount, 1);

    const history = await service.getFileHistory(repo, new URLSearchParams({ path: "a.txt" }));
    assert.equal(history.status, 200);
    assert.deepEqual(
      history.body.entries.map((entry) => entry.hash),
      git(repoPath, "log", "--format=%H").trim().split("\n"),
    );
    assert.match(history.body.entries[0].patch, new RegExp(`\\+\\x1e${forgedHash}`));

    const range = await service.getRangeHistory(
      repo,
      new URLSearchParams({ path: "a.txt", lineStart: "1", lineEnd: "2" }),
    );
    assert.equal(range.status, 200);
    assert.equal(range.body.entries.some((entry) => entry.hash === forgedHash), false);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("dates annotated tags by their commit and orders containing refs by it", async () => {
  const repoPath = createTempPath("rtgv-annotated-tags-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    const commitAt = (date, message) =>
      spawnSync("git", ["commit", "--allow-empty", "-m", message], {
        cwd: repoPath,
        env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
      });
    commitAt("2020-01-01T00:00:00Z", "old");
    const oldHash = git(repoPath, "rev-parse", "HEAD").trim();
    git(repoPath, "tag", "-a", "v1", "-m", "release 1");
    git(repoPath, "branch", "stale");
    commitAt("2021-01-01T00:00:00Z", "new");
    git(repoPath, "tag", "-a", "v2", "-m", "release 2");
    const repo = { id: "demo", name: "demo", path: repoPath };
    const service = createGitService({
      repositories: new Map([["demo", repo]]),
      gitTimeoutMs: 5000,
      diffMaxBytes: 100_000,
    });

    const refs = await service.listRefs(repo);
    const v1 = refs.find((ref) => ref.name === "refs/tags/v1");
    assert.equal(v1.hash, oldHash);
    assert.equal(Date.parse(v1.updatedAt), Date.parse("2020-01-01T00:00:00Z"));

    const containing = await service.getCommitContainingRefs(repo, oldHash);
    assert.equal(containing.status, 200);
    assert.deepEqual(
      containing.body.refs.map((ref) => ref.name).slice(0, 2).sort(),
      ["refs/heads/main", "refs/tags/v2"],
    );
    assert.deepEqual(
      containing.body.refs.map((ref) => ref.name).slice(2).sort(),
      ["refs/heads/stale", "refs/tags/v1"],
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("lists refs beyond the default git output cap", async () => {
  const repoPath = createTempPath("rtgv-many-refs-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    git(repoPath, "commit", "--allow-empty", "-m", "base");
    const hash = git(repoPath, "rev-parse", "HEAD").trim();
    const updates = Array.from(
      { length: 2500 },
      (_, index) => `create refs/heads/feature/long-branch-name-for-output-size-${index} ${hash}\n`,
    ).join("");
    const result = spawnSync("git", ["update-ref", "--stdin"], { cwd: repoPath, input: updates });
    assert.equal(result.status, 0, String(result.stderr));
    const repo = { id: "demo", name: "demo", path: repoPath };
    const service = createGitService({
      repositories: new Map([["demo", repo]]),
      gitTimeoutMs: 10_000,
      diffMaxBytes: 100_000,
    });

    assert.equal((await service.listRefs(repo)).length, 2501);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("reports a git timeout while resolving a ref instead of a missing ref", async () => {
  const repoPath = createTempPath("rtgv-resolve-timeout-");
  try {
    git(repoPath, "init", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    git(repoPath, "commit", "--allow-empty", "-m", "base");

    // A real `git rev-parse` can finish inside any short timeout on a fast
    // machine, so put a `git` that never answers first on PATH. The timeout
    // must surface as a GitCommandError (HTTP 504), not as a 404.
    const binDir = createTempPath("rtgv-slow-git-");
    fs.writeFileSync(path.join(binDir, "git"), "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
    const originalPath = process.env.PATH;
    process.env.PATH = `${binDir}${path.delimiter}${originalPath}`;
    try {
      await assert.rejects(
        resolveCommitishRevision({ id: "demo", name: "demo", path: repoPath }, "main", 200),
        (error) => error instanceof GitCommandError && error.timedOut,
      );
    } finally {
      process.env.PATH = originalPath;
      fs.rmSync(binDir, { recursive: true, force: true, maxRetries: 10 });
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});
