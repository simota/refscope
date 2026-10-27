import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createGitService,
  getWorktreeDirtyBoolean,
  workTreeNumstatArgs,
  workTreePatchArgs,
} from "../src/gitService.js";

test("workTreeNumstatArgs uses --cached only when staged, with hardening flags", () => {
  const staged = workTreeNumstatArgs({ staged: true });
  assert.equal(staged[0], "diff");
  assert.ok(staged.includes("--cached"));
  assert.ok(staged.includes("--numstat"));
  assert.ok(staged.includes("-z"));
  assert.ok(staged.includes("--no-renames"));
  assert.ok(staged.includes("--no-ext-diff"));
  assert.ok(staged.includes("--no-textconv"));
  assert.ok(staged.includes("--no-color"));
  // Option parsing must terminate even though no revision follows — keeps
  // the runner's safety surface uniform with every other call site.
  assert.equal(staged[staged.length - 1], "--end-of-options");

  const unstaged = workTreeNumstatArgs({ staged: false });
  assert.equal(unstaged[0], "diff");
  assert.ok(!unstaged.includes("--cached"));
  assert.ok(unstaged.includes("--numstat"));
  assert.ok(unstaged.includes("-z"));
});

test("workTreePatchArgs requests rename detection in the patch lane only", () => {
  const staged = workTreePatchArgs({ staged: true });
  assert.equal(staged[0], "diff");
  assert.ok(staged.includes("--cached"));
  assert.ok(staged.includes("--patch"));
  assert.ok(staged.includes("--find-renames"));
  assert.ok(staged.includes("--no-color"));
  assert.ok(staged.includes("--no-ext-diff"));
  assert.ok(staged.includes("--no-textconv"));
  assert.equal(staged[staged.length - 1], "--end-of-options");

  const unstaged = workTreePatchArgs({ staged: false });
  assert.ok(!unstaged.includes("--cached"));
  assert.ok(unstaged.includes("--patch"));
});

test("getWorkTreeChanges returns zero summaries on a clean working tree", async () => {
  const repoPath = createTempPath("rtgv-worktree-clean-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.staged.diff, "");
    assert.equal(result.body.unstaged.diff, "");
    assert.deepEqual(result.body.staged.summary, {
      added: 0,
      deleted: 0,
      fileCount: 0,
    });
    assert.deepEqual(result.body.unstaged.summary, {
      added: 0,
      deleted: 0,
      fileCount: 0,
    });
    assert.equal(result.body.staged.truncated, false);
    assert.equal(result.body.unstaged.truncated, false);
    assert.deepEqual(result.body.untracked.files, []);
    assert.deepEqual(result.body.untracked.summary, {
      fileCount: 0,
      added: 0,
      deleted: 0,
    });
    assert.equal(result.body.notes.untrackedExcluded, false);
    assert.match(result.body.snapshotAt, /^\d{4}-\d{2}-\d{2}T/);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges separates unstaged-only changes into the unstaged side", async () => {
  const repoPath = createTempPath("rtgv-worktree-unstaged-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.txt", "v1\n", "feat: seed foo");
    // Modify without staging — should land in unstaged.diff only.
    fs.writeFileSync(path.join(repoPath, "src/foo.txt"), "v1\nadded line\n");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    // Staged side is empty.
    assert.equal(result.body.staged.diff, "");
    assert.equal(result.body.staged.summary.fileCount, 0);
    // Unstaged side surfaces the literal diff.
    assert.ok(result.body.unstaged.diff.includes("diff --git"));
    assert.ok(result.body.unstaged.diff.includes("src/foo.txt"));
    assert.ok(result.body.unstaged.diff.includes("+added line"));
    assert.equal(result.body.unstaged.summary.fileCount, 1);
    assert.equal(result.body.unstaged.summary.added, 1);
    assert.equal(result.body.unstaged.summary.deleted, 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges separates staged-only changes into the staged side", async () => {
  const repoPath = createTempPath("rtgv-worktree-staged-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.txt", "v1\n", "feat: seed foo");
    // Modify and stage — should land only in staged.diff.
    fs.writeFileSync(path.join(repoPath, "src/foo.txt"), "v2\n");
    git(repoPath, "add", "src/foo.txt");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.unstaged.diff, "");
    assert.equal(result.body.unstaged.summary.fileCount, 0);
    assert.ok(result.body.staged.diff.includes("diff --git"));
    assert.ok(result.body.staged.diff.includes("src/foo.txt"));
    assert.ok(result.body.staged.diff.includes("-v1"));
    assert.ok(result.body.staged.diff.includes("+v2"));
    assert.equal(result.body.staged.summary.fileCount, 1);
    assert.equal(result.body.staged.summary.added, 1);
    assert.equal(result.body.staged.summary.deleted, 1);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges returns both sides when staged and unstaged changes coexist", async () => {
  const repoPath = createTempPath("rtgv-worktree-both-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/staged.txt", "s0\n", "feat: seed staged");
    writeAndCommit(repoPath, "src/unstaged.txt", "u0\n", "feat: seed unstaged");
    // Stage one file's modification.
    fs.writeFileSync(path.join(repoPath, "src/staged.txt"), "s1\n");
    git(repoPath, "add", "src/staged.txt");
    // Modify the other without staging.
    fs.writeFileSync(path.join(repoPath, "src/unstaged.txt"), "u0\nfresh\n");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.staged.summary.fileCount, 1);
    assert.equal(result.body.unstaged.summary.fileCount, 1);
    assert.ok(result.body.staged.diff.includes("src/staged.txt"));
    assert.ok(!result.body.staged.diff.includes("src/unstaged.txt"));
    assert.ok(result.body.unstaged.diff.includes("src/unstaged.txt"));
    assert.ok(!result.body.unstaged.diff.includes("src/staged.txt"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges surfaces Git's literal rename similarity in the staged patch", async () => {
  const repoPath = createTempPath("rtgv-worktree-rename-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/old-name.txt", "console.log(1);\n".repeat(8), "feat: add old-name");
    // Stage a rename — Git's diff --cached --find-renames should emit the
    // "rename from / rename to" markers verbatim.
    git(repoPath, "mv", "src/old-name.txt", "src/new-name.txt");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    // Patch text carries Git's similarity index — refscope never re-judges
    // renames, it transcribes them.
    assert.match(result.body.staged.diff, /similarity index \d+%/);
    assert.match(result.body.staged.diff, /rename from src\/old-name\.txt/);
    assert.match(result.body.staged.diff, /rename to src\/new-name\.txt/);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges surfaces untracked files in a dedicated section", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    // Drop two untracked files — `git diff` (with or without `--cached`)
    // does not see them, so they ride a separate `body.untracked.files`
    // list sourced from `git ls-files --others --exclude-standard`. The
    // line count for each file mirrors what Git would emit as `+N` once
    // the file was eventually committed.
    fs.writeFileSync(path.join(repoPath, "untracked.txt"), "alpha\nbeta\ngamma\n");
    fs.mkdirSync(path.join(repoPath, "src"), { recursive: true });
    fs.writeFileSync(path.join(repoPath, "src/new.js"), "console.log('hi');\n");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    // Tracked sides are still empty — untracked is its own lane.
    assert.equal(result.body.staged.summary.fileCount, 0);
    assert.equal(result.body.unstaged.summary.fileCount, 0);
    assert.ok(!result.body.staged.diff.includes("untracked.txt"));
    assert.ok(!result.body.unstaged.diff.includes("untracked.txt"));
    // Untracked lane reports both files with their line counts.
    const byPath = new Map(
      result.body.untracked.files.map((file) => [file.path, file]),
    );
    assert.deepEqual(byPath.get("untracked.txt"), {
      path: "untracked.txt",
      status: "A",
      added: 3,
      deleted: 0,
    });
    assert.deepEqual(byPath.get("src/new.js"), {
      path: "src/new.js",
      status: "A",
      added: 1,
      deleted: 0,
    });
    assert.deepEqual(result.body.untracked.summary, {
      fileCount: 2,
      added: 4,
      deleted: 0,
    });
    assert.equal(result.body.notes.untrackedExcluded, false);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges respects .gitignore for untracked listing", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-ignore-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, ".gitignore", "ignored.log\n", "chore: ignore");
    fs.writeFileSync(path.join(repoPath, "ignored.log"), "noise\n");
    fs.writeFileSync(path.join(repoPath, "kept.txt"), "value\n");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    const paths = result.body.untracked.files.map((file) => file.path);
    assert.deepEqual(paths, ["kept.txt"]);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges reports added: 0 for binary untracked files", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-binary-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    fs.writeFileSync(path.join(repoPath, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00]));

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    const file = result.body.untracked.files.find((f) => f.path === "blob.bin");
    assert.equal(file.added, 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges synthesizes a unified diff for untracked text files", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-diff-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    fs.writeFileSync(path.join(repoPath, "hello.txt"), "alpha\nbeta\n");
    fs.writeFileSync(path.join(repoPath, "no-newline.txt"), "tail");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    assert.equal(result.status, 200);
    const diff = result.body.untracked.diff;
    // Each file gets `diff --git` + `new file mode` + `--- /dev/null` + body.
    // We assert the literal pieces so a parser regression in the UI's
    // parseUnifiedDiff would still pass a smoke test against this output.
    assert.ok(diff.includes("diff --git a/hello.txt b/hello.txt"));
    assert.ok(diff.includes("new file mode 100644"));
    assert.ok(diff.includes("--- /dev/null"));
    assert.ok(diff.includes("+++ b/hello.txt"));
    assert.ok(diff.includes("@@ -0,0 +1,2 @@"));
    assert.ok(diff.includes("+alpha"));
    assert.ok(diff.includes("+beta"));
    // Files without a trailing newline must surface Git's conventional marker
    // so parseUnifiedDiff matches the standard hunk shape.
    assert.ok(diff.includes("+++ b/no-newline.txt"));
    assert.ok(diff.includes("+tail"));
    assert.ok(diff.includes("\\ No newline at end of file"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges emits binary marker for binary untracked files in diff", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-binary-diff-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    fs.writeFileSync(path.join(repoPath, "blob.bin"), Buffer.from([0x00, 0x01, 0x02, 0x00]));

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    const diff = result.body.untracked.diff;
    assert.ok(diff.includes("diff --git a/blob.bin b/blob.bin"));
    assert.ok(diff.includes("Binary files /dev/null and b/blob.bin differ"));
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges bounds the synthesized untracked diff by diffMaxBytes", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-budget-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    for (const name of ["a.txt", "b.txt", "c.txt"]) {
      fs.writeFileSync(path.join(repoPath, name), `${name}\n`.repeat(20));
    }

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      // Fits a.txt's patch (~210 bytes) but not a second one.
      diffMaxBytes: 300,
    });
    const result = await service.getWorkTreeChanges({ id: "demo", name: "demo", path: repoPath });

    assert.equal(result.status, 200);
    const { files, diff, truncated } = result.body.untracked;
    assert.equal(truncated, true);
    assert.deepEqual(
      files.map((file) => [file.path, file.added]),
      [["a.txt", 20], ["b.txt", 0], ["c.txt", 0]],
    );
    // Fallback headers count against the same budget, so the payload never
    // exceeds diffMaxBytes even though every path stays in `files`.
    assert.ok(Buffer.byteLength(diff) <= 300, `diff is ${Buffer.byteLength(diff)} bytes`);
    assert.equal(diff.includes("+b.txt"), false);
    assert.equal(diff.includes("+c.txt"), false);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges keeps headers-only fallbacks within diffMaxBytes", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-headers-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    for (let i = 0; i < 200; i += 1) {
      fs.writeFileSync(path.join(repoPath, `file-${String(i).padStart(3, "0")}.txt`), "x\n".repeat(50));
    }

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 10_000,
    });
    const result = await service.getWorkTreeChanges({ id: "demo", name: "demo", path: repoPath });

    assert.equal(result.status, 200);
    const { files, diff, truncated } = result.body.untracked;
    assert.equal(truncated, true);
    assert.equal(files.length, 200);
    assert.ok(Buffer.byteLength(diff) <= 10_000, `diff is ${Buffer.byteLength(diff)} bytes`);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges lists untracked names even when they exceed a small diff budget", async () => {
  // diffMaxBytes bounds synthesized patch content only; the name listing
  // must not be killed by it (that turned the whole request into a 504).
  const repoPath = createTempPath("rtgv-worktree-untracked-small-budget-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    for (let i = 0; i < 20; i += 1) {
      fs.writeFileSync(path.join(repoPath, `untracked-${String(i).padStart(2, "0")}.txt`), "x\n");
    }

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 100,
    });
    const result = await service.getWorkTreeChanges({ id: "demo", name: "demo", path: repoPath });

    assert.equal(result.status, 200);
    assert.equal(result.body.untracked.files.length, 20);
    assert.equal(result.body.untracked.truncated, true);
    assert.ok(Buffer.byteLength(result.body.untracked.diff) <= 100);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges lists untracked names beyond the runner's default output cap", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-many-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    // ~3 000 × 100-byte names ≈ 300 KB of ls-files output, above the
    // runner's 256 KB default that previously turned this into a 504.
    const dir = path.join(repoPath, "generated");
    fs.mkdirSync(dir);
    const stem = "x".repeat(90);
    for (let i = 0; i < 3000; i += 1) {
      fs.writeFileSync(path.join(dir, `${stem}${String(i).padStart(4, "0")}`), "");
    }

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 20_000,
      diffMaxBytes: 4_000_000,
    });
    const result = await service.getWorkTreeChanges({ id: "demo", name: "demo", path: repoPath });

    assert.equal(result.status, 200);
    assert.equal(result.body.untracked.files.length, 3000);
    assert.equal(result.body.untracked.truncated, false);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges does not read through untracked symlinks", async () => {
  const repoPath = createTempPath("rtgv-worktree-untracked-symlink-");
  const outsidePath = createTempPath("rtgv-worktree-outside-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    fs.writeFileSync(path.join(outsidePath, "secret.txt"), "SECRET-OUTSIDE\n");
    fs.symlinkSync(path.join(outsidePath, "secret.txt"), path.join(repoPath, "link.txt"));

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });

    const result = await service.getWorkTreeChanges({
      id: "demo",
      name: "demo",
      path: repoPath,
    });

    const { files, diff } = result.body.untracked;
    assert.deepEqual(
      files.map((file) => [file.path, file.added]),
      [["link.txt", 0]],
    );
    assert.ok(diff.includes("diff --git a/link.txt b/link.txt"));
    assert.equal(diff.includes("SECRET-OUTSIDE"), false);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
    fs.rmSync(outsidePath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getWorkTreeChanges does not run fsmonitor or filter commands from the repo config", async () => {
  const repoPath = createTempPath("rtgv-worktree-hooks-");
  const markerDir = createTempPath("rtgv-worktree-markers-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, ".gitattributes", "*.txt filter=evil\n*.md filter=dotted.name\n", "chore: attrs");
    writeAndCommit(repoPath, "a.txt", "one\n", "chore: seed txt");
    writeAndCommit(repoPath, "b.md", "one\n", "chore: seed md");
    const marker = (name) => path.join(markerDir, name);
    // A repository handed to the user (archive, shared disk) carries its own
    // .git/config; viewing it must not execute anything it names.
    git(repoPath, "config", "core.fsmonitor", `touch ${marker("fsmonitor")}; false`);
    git(repoPath, "config", "filter.evil.clean", `touch ${marker("clean")}; cat`);
    git(repoPath, "config", "filter.evil.process", `touch ${marker("process")}`);
    git(repoPath, "config", "filter.evil.required", "true");
    git(repoPath, "config", "filter.dotted.name.clean", `touch ${marker("dotted")}; cat`);
    // Modify both files and back-date them so Git cannot trust the stat
    // data and has to hash the working-tree content.
    fs.writeFileSync(path.join(repoPath, "a.txt"), "two\n");
    fs.writeFileSync(path.join(repoPath, "b.md"), "two\n");
    const old = new Date("2001-01-01T00:00:00Z");
    fs.utimesSync(path.join(repoPath, "a.txt"), old, old);
    fs.utimesSync(path.join(repoPath, "b.md"), old, old);

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
    });
    const result = await service.getWorkTreeChanges({ id: "demo", name: "demo", path: repoPath });

    assert.equal(result.status, 200);
    assert.deepEqual(fs.readdirSync(markerDir), []);
    assert.match(result.body.unstaged.diff, /^\+two$/m);
    assert.deepEqual(result.body.unstaged.summary, { added: 2, deleted: 2, fileCount: 2 });
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(markerDir, { recursive: true, force: true });
  }
});

test("getWorkTreeChanges counts a conflicted path once on the unstaged side", async () => {
  const repoPath = createTempPath("rtgv-worktree-conflict-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "f.txt", "base\n", "chore: seed");
    git(repoPath, "checkout", "-b", "ours");
    writeAndCommit(repoPath, "f.txt", "ours\n", "feat: ours");
    git(repoPath, "checkout", "main");
    writeAndCommit(repoPath, "f.txt", "theirs\n", "feat: theirs");
    // Leaves f.txt unmerged with conflict markers in the working tree.
    spawnSync("git", ["merge", "ours"], { cwd: repoPath, stdio: "ignore" });

    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 65_536 });
    const result = await service.getWorkTreeChanges({ id: "demo", name: "demo", path: repoPath });

    assert.equal(result.status, 200);
    assert.equal(result.body.unstaged.summary.fileCount, 1);
    assert.equal(result.body.staged.summary.fileCount, 1);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 3 });
  }
});

test("the fleet dirty probe does not run filter commands from the repo config", async () => {
  const repoPath = createTempPath("rtgv-dirty-hooks-");
  const markerDir = createTempPath("rtgv-dirty-markers-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "a.txt", "one\n", "chore: seed");
    // Attributes from .git/info/attributes, so the tracked tree stays clean
    // and a.txt is the only path the probe has to hash.
    fs.writeFileSync(path.join(repoPath, ".git", "info", "attributes"), "*.txt filter=evil\n");
    git(repoPath, "config", "filter.evil.process", `touch ${path.join(markerDir, "process")}`);
    git(repoPath, "config", "filter.evil.required", "true");
    fs.writeFileSync(path.join(repoPath, "a.txt"), "two\n");
    const old = new Date("2001-01-01T00:00:00Z");
    fs.utimesSync(path.join(repoPath, "a.txt"), old, old);

    assert.equal(await getWorktreeDirtyBoolean(repoPath), true);
    assert.deepEqual(fs.readdirSync(markerDir), []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(markerDir, { recursive: true, force: true });
  }
});

test("worktree reads do not run a submodule's own filter commands", async () => {
  const upstreamPath = createTempPath("rtgv-worktree-subup-");
  const repoPath = createTempPath("rtgv-worktree-subhost-");
  const markerDir = createTempPath("rtgv-worktree-submarkers-");
  try {
    initRepo(upstreamPath, "Alice", "alice@example.test");
    writeAndCommit(upstreamPath, ".gitattributes", "*.txt filter=sub\n", "chore: attrs");
    writeAndCommit(upstreamPath, "s.txt", "aaa\n", "chore: seed");
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "host\n", "chore: seed");
    git(repoPath, "-c", "protocol.file.allow=always", "submodule", "add", upstreamPath, "sub");
    git(repoPath, "commit", "-m", "feat: add submodule");
    // The submodule's config lives in .git/modules/sub/config, which the
    // superproject's filter lookup does not see.
    git(path.join(repoPath, "sub"), "config", "filter.sub.clean", `touch ${path.join(markerDir, "clean")}; cat`);
    fs.writeFileSync(path.join(repoPath, "sub", "s.txt"), "bbb\n");
    const old = new Date("2001-01-01T00:00:00Z");
    fs.utimesSync(path.join(repoPath, "sub", "s.txt"), old, old);

    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 65_536 });
    const result = await service.getWorkTreeChanges({ id: "demo", name: "demo", path: repoPath });
    assert.equal(result.status, 200);
    assert.equal(await getWorktreeDirtyBoolean(repoPath), false);
    assert.deepEqual(fs.readdirSync(markerDir), []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(upstreamPath, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(markerDir, { recursive: true, force: true });
  }
});

test("listSubmodules does not run the repo-config fsmonitor hook", async () => {
  const repoPath = createTempPath("rtgv-submodule-hooks-");
  const markerDir = createTempPath("rtgv-submodule-markers-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "README.md", "base\n", "chore: seed");
    git(repoPath, "config", "core.fsmonitor", `touch ${path.join(markerDir, "fsmonitor")}; false`);

    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 65_536 });
    const result = await service.listSubmodules({ id: "demo", name: "demo", path: repoPath });

    assert.equal(result.status, 200);
    assert.deepEqual(fs.readdirSync(markerDir), []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(markerDir, { recursive: true, force: true });
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
