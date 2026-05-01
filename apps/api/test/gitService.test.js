import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

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
  createGitService,
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
      "--format=\u001e%H%x00%P%x00%an%x00%aI%x00%s%x00%D",
      "--no-show-signature",
      "--numstat",
      "--no-ext-diff",
      "--no-textconv",
      "--end-of-options",
      hash,
      "--",
      ":(literal,top)src/App.tsx",
    ],
  );
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
    "--numstat",
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
    "--name-status",
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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

test("parses changed files from numstat and name-status output", () => {
  const files = parseChangedFiles(
    [
      "12\t3\tsrc/App.tsx",
      "-\t-\tassets/logo.png",
      "0\t8\tdocs/old.md",
      "4\t1\tsrc/new-name.ts",
      "1\t0\tsrc/{old.txt => renamed.txt}",
      "2\t1\t{old-dir => new-dir}/nested.ts",
    ].join("\n"),
    [
      "M\tsrc/App.tsx",
      "A\tassets/logo.png",
      "D\tdocs/old.md",
      "R087\tsrc/old-name.ts\tsrc/new-name.ts",
      "R050\tsrc/old.txt\tsrc/renamed.txt",
      "R075\told-dir/nested.ts\tnew-dir/nested.ts",
    ].join("\n"),
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

test("summarizes numstat lines for commit list metadata", () => {
  assert.deepEqual(
    parseNumstatSummary([
      "12\t3\tsrc/App.tsx",
      "-\t-\tassets/logo.png",
      "0\t8\tdocs/old.md",
      "1\t0\tsrc/{old.txt => renamed.txt}",
    ]),
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
    fs.rmSync(repoPath, { recursive: true, force: true });
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
