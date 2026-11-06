import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  REF_DRIFT_DEFAULT_LIMIT,
  REF_DRIFT_MAX_LIMIT,
  createGitService,
  inferAncestorMergeBase,
  readAheadBehindBatch,
} from "../src/gitService.js";

test("getRefDrift returns ahead/behind for branches against the default HEAD base", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-basic-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    // Create feat off main, advance feat by 2 commits, then advance main by 1.
    git(repoPath, "checkout", "-b", "feat");
    writeAndCommit(repoPath, "feat-a.txt", "a\n", "feat: a");
    writeAndCommit(repoPath, "feat-b.txt", "b\n", "feat: b");
    git(repoPath, "checkout", "main");
    writeAndCommit(repoPath, "main-c.txt", "c\n", "fix: c");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRefDrift(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams(),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.base.input, "HEAD");
    assert.match(result.body.base.resolved, /^[a-f0-9]{40}$/);
    assert.equal(result.body.truncated, false);
    assert.equal(result.body.limit, REF_DRIFT_DEFAULT_LIMIT);

    const byShort = indexByShortName(result.body.refs);
    // main is HEAD itself: drift is observed-trivial (ref hash === base hash).
    assert.deepEqual(
      pickDriftFields(byShort.get("main")),
      { ahead: 0, behind: 0, type: "branch" },
    );
    // feat is 2 ahead of main, 1 behind main (the fix: c commit).
    assert.deepEqual(
      pickDriftFields(byShort.get("feat")),
      { ahead: 2, behind: 1, type: "branch" },
    );
    const featEntry = byShort.get("feat");
    assert.match(featEntry.mergeBase, /^[a-f0-9]{40}$/);
    // Merge-base must be the seed commit (the parent of both diverging commits).
    assert.notEqual(featEntry.mergeBase, result.body.base.resolved);
    assert.notEqual(featEntry.mergeBase, featEntry.hash);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRefDrift switches base when ?base= is provided", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-base-switch-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    git(repoPath, "checkout", "-b", "feat");
    writeAndCommit(repoPath, "feat.txt", "a\n", "feat: a");
    writeAndCommit(repoPath, "feat2.txt", "b\n", "feat: b");
    git(repoPath, "checkout", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRefDrift(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ base: "feat" }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.base.input, "feat");
    const byShort = indexByShortName(result.body.refs);
    // From feat's perspective, main is 0 ahead and 2 behind.
    assert.deepEqual(
      pickDriftFields(byShort.get("main")),
      { ahead: 0, behind: 2, type: "branch" },
    );
    // feat itself is the base — short-circuited.
    assert.deepEqual(
      pickDriftFields(byShort.get("feat")),
      { ahead: 0, behind: 0, type: "branch" },
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRefDrift excludes tags from the drift surface", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-tag-exclusion-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    writeAndCommit(repoPath, "next.txt", "n\n", "feat: next");
    git(repoPath, "tag", "v1.0.0");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRefDrift(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams(),
    );
    assert.equal(result.status, 200);
    // Tags are anchored — they would dilute the drift signal. Filter is part
    // of the wire contract, so the payload must not contain them.
    for (const entry of result.body.refs) {
      assert.notEqual(entry.type, "tag");
      assert.notEqual(entry.name, "refs/tags/v1.0.0");
    }
    // The branch is still surfaced.
    const byShort = indexByShortName(result.body.refs);
    assert.ok(byShort.has("main"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRefDrift and branch groups skip refs that do not name a commit", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-blob-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    git(repoPath, "branch", "feat/ok");
    const blob = git(repoPath, "rev-parse", "HEAD:README.md").trim();
    git(repoPath, "update-ref", "refs/remotes/origin/blobref", blob);
    // update-ref refuses a non-commit under refs/heads; write it directly.
    fs.writeFileSync(path.join(repoPath, ".git", "refs", "heads", "feat", "blob"), `${blob}\n`);

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });
    const repo = { id: "demo", name: "demo", path: repoPath };

    const drift = await service.getRefDrift(repo, new URLSearchParams());
    assert.equal(drift.status, 200);
    const names = drift.body.refs.map((entry) => entry.name).sort();
    assert.deepEqual(names, ["refs/heads/feat/ok", "refs/heads/main"]);

    const groups = await service.getBranchGroupHealth(repo, new URLSearchParams({ prefix: "feat/" }));
    assert.equal(groups.status, 200);
    assert.deepEqual(groups.body.branches.map((branch) => branch.shortName), ["feat/ok"]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRefDrift marks truncated:true when ref count exceeds the requested limit", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-truncated-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    // 5 extra branches → 6 total branches; limit=3 → truncated.
    for (let i = 0; i < 5; i += 1) {
      git(repoPath, "branch", `feat-${i}`);
    }

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRefDrift(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ limit: "3" }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, true);
    assert.equal(result.body.limit, 3);
    assert.equal(result.body.refs.length, 3);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRefDrift caps limit at REF_DRIFT_MAX_LIMIT (parseLimitQuery clamps, never errors)", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-cap-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRefDrift(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ limit: String(REF_DRIFT_MAX_LIMIT + 50) }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.limit, REF_DRIFT_MAX_LIMIT);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRefDrift rejects malformed query parameters before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };

  // Invalid base shape (trailing dot rejected by isValidGitRef).
  assert.deepEqual(
    await service.getRefDrift(repo, new URLSearchParams({ base: "refs/heads/main." })),
    { status: 400, body: { error: "Invalid base parameter" } },
  );
  // Hyphen-leading bases would look like Git options.
  assert.deepEqual(
    await service.getRefDrift(repo, new URLSearchParams({ base: "-foo" })),
    { status: 400, body: { error: "Invalid base parameter" } },
  );
  // Invalid limit.
  assert.deepEqual(
    await service.getRefDrift(repo, new URLSearchParams({ limit: "0" })),
    { status: 400, body: { error: "Invalid limit parameter" } },
  );
  assert.deepEqual(
    await service.getRefDrift(repo, new URLSearchParams({ limit: "abc" })),
    { status: 400, body: { error: "Invalid limit parameter" } },
  );
  // Duplicate base.
  assert.deepEqual(
    await service.getRefDrift(
      repo,
      new URLSearchParams([
        ["base", "main"],
        ["base", "feat"],
      ]),
    ),
    { status: 400, body: { error: "Duplicate base parameter" } },
  );
});

test("getRefDrift returns 404 for an unknown base ref", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-404-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getRefDrift(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ base: "refs/heads/does-not-exist" }),
    );
    assert.equal(result.status, 404);
    assert.deepEqual(result.body, { error: "Ref not found or not a commit" });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getRefDrift mergeBase matches git merge-base for ancestor, descendant, diverged and unrelated refs", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-mergebase-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    writeAndCommit(repoPath, "a.txt", "a\n", "feat: a");
    git(repoPath, "branch", "behind-only");
    git(repoPath, "checkout", "-b", "diverged");
    writeAndCommit(repoPath, "d.txt", "d\n", "feat: d");
    git(repoPath, "checkout", "main");
    writeAndCommit(repoPath, "b.txt", "b\n", "feat: b");
    git(repoPath, "branch", "ahead-only");
    git(repoPath, "checkout", "ahead-only");
    writeAndCommit(repoPath, "c.txt", "c\n", "feat: c");
    git(repoPath, "checkout", "--orphan", "unrelated");
    git(repoPath, "rm", "-rf", "--quiet", ".");
    writeAndCommit(repoPath, "u.txt", "u\n", "chore: unrelated root");
    git(repoPath, "checkout", "main");
    // A criss-cross merge leaves two best merge-bases: Git picks one, and the
    // drift payload must report the same one.
    git(repoPath, "checkout", "-b", "cross-x", "diverged");
    git(repoPath, "merge", "--no-edit", "-q", "main");
    git(repoPath, "checkout", "main");
    git(repoPath, "merge", "--no-edit", "-q", "diverged");
    git(repoPath, "checkout", "-q", "main");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });
    const result = await service.getRefDrift(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams(),
    );
    assert.equal(result.status, 200);
    const base = result.body.base.resolved;
    const byShort = indexByShortName(result.body.refs);
    for (const name of ["behind-only", "ahead-only", "diverged", "unrelated", "cross-x"]) {
      const entry = byShort.get(name);
      assert.ok(entry, `missing drift entry for ${name}`);
      const mergeBase = spawnSync("git", ["merge-base", base, entry.hash], {
        cwd: repoPath,
        encoding: "utf8",
      });
      const expected = mergeBase.status === 0 ? mergeBase.stdout.trim() : null;
      assert.equal(entry.mergeBase, expected, `mergeBase for ${name}`);
      const counts = git(repoPath, "rev-list", "--left-right", "--count", `${base}...${entry.hash}`)
        .trim()
        .split("\t")
        .map(Number);
      assert.deepEqual([entry.behind, entry.ahead], counts, `counts for ${name}`);
    }
    assert.equal(byShort.get("behind-only").ahead, 0);
    assert.equal(byShort.get("behind-only").mergeBase, byShort.get("behind-only").hash);
    assert.equal(byShort.get("cross-x").behind > 0, true);
    assert.equal(byShort.get("unrelated").mergeBase, null);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("inferAncestorMergeBase only answers when one side of the counts is zero", () => {
  const base = "b".repeat(40);
  const ref = { hash: "r".repeat(40) };
  assert.deepEqual(inferAncestorMergeBase(base, ref, { ahead: 0, behind: 3 }), { known: true, mergeBase: ref.hash });
  assert.deepEqual(inferAncestorMergeBase(base, ref, { ahead: 2, behind: 0 }), { known: true, mergeBase: base });
  assert.deepEqual(inferAncestorMergeBase(base, ref, { ahead: 1, behind: 1 }), { known: false });
  // A ref whose tag chain may not have peeled keeps the real merge-base read.
  const nested = { hash: ref.hash };
  Object.defineProperty(nested, "nestedTag", { value: true, enumerable: false });
  assert.deepEqual(inferAncestorMergeBase(base, nested, { ahead: 0, behind: 3 }), { known: false });
});

test("readAheadBehindBatch answers only for refs that still name the listed commit", async () => {
  const repoPath = createTempPath("rtgv-ref-drift-batch-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "v0\n", "chore: seed");
    writeAndCommit(repoPath, "a.txt", "a\n", "feat: a");
    git(repoPath, "checkout", "-b", "feat", "HEAD~1");
    writeAndCommit(repoPath, "f.txt", "f\n", "feat: f");
    git(repoPath, "checkout", "main");
    git(repoPath, "tag", "-a", "-m", "annotated", "v1", "HEAD~1");
    // A remote ref may name an annotated tag; its counts are those of the
    // commit the tag points to, which is the hash the ref list reports.
    git(repoPath, "update-ref", "refs/remotes/origin/tagged", git(repoPath, "rev-parse", "v1").trim());
    const tree = git(repoPath, "rev-parse", "HEAD^{tree}").trim();
    git(repoPath, "update-ref", "refs/remotes/origin/tree", tree);

    const repo = { id: "demo", name: "demo", path: repoPath };
    const base = git(repoPath, "rev-parse", "main").trim();
    const featHash = git(repoPath, "rev-parse", "feat").trim();
    const seedHash = git(repoPath, "rev-parse", "main~1").trim();
    const feat = { name: "refs/heads/feat", hash: featHash };
    const tagged = { name: "refs/remotes/origin/tagged", hash: seedHash };
    const treeRef = { name: "refs/remotes/origin/tree", hash: tree };
    // Listed before the ref moved: the batch now sees another object.
    const stale = { name: "refs/heads/feat", hash: seedHash };
    const nested = { name: "refs/heads/feat", hash: featHash };
    Object.defineProperty(nested, "nestedTag", { value: true, enumerable: false });
    const missing = { name: "refs/heads/gone", hash: featHash };

    const counts = await readAheadBehindBatch(
      repo,
      base,
      [feat, tagged, treeRef, stale, nested, missing],
      5000,
    );
    assert.deepEqual(counts.get(feat), { ahead: 1, behind: 1 });
    assert.deepEqual(counts.get(tagged), { ahead: 0, behind: 1 });
    for (const ref of [treeRef, stale, nested, missing]) {
      assert.equal(counts.has(ref), false, ref.name);
    }
    // The counts are exactly what the per-ref rev-list walk reports.
    const [behind, ahead] = git(repoPath, "rev-list", "--left-right", "--count", `${base}...${featHash}`)
      .trim()
      .split("\t")
      .map(Number);
    assert.deepEqual(counts.get(feat), { ahead, behind });
    // A base that is not a full object id is never spliced into the format.
    assert.equal((await readAheadBehindBatch(repo, "main", [feat], 5000)).size, 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

function indexByShortName(refs) {
  return new Map(
    refs.map((entry) => [entry.name.replace(/^refs\/heads\//, "").replace(/^refs\/remotes\//, ""), entry]),
  );
}

function pickDriftFields(entry) {
  if (!entry) return null;
  return { ahead: entry.ahead, behind: entry.behind, type: entry.type };
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
