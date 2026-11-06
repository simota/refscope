// Read paths that run independent Git reads concurrently (or precompute sort
// keys) must answer exactly as the sequential versions did: same status,
// same body, same precedence between failures, no unobserved rejections.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitService, resolveCommitishRevision } from "../src/gitService.js";

const unhandled = [];
process.on("unhandledRejection", (reason) => unhandled.push(reason));

test("resolveCommitishRevision keeps its results and checks order", async () => {
  const repoPath = createRepo();
  try {
    const head = commitFile(repoPath, "a.txt", "one\n", "2024-01-01T00:00:00Z");
    git(repoPath, "branch", "feature");
    // A short name that Git resolves into a hidden namespace.
    git(repoPath, "update-ref", "refs/notes/hidden", head);
    // A public symref whose target is hidden.
    git(repoPath, "symbolic-ref", "refs/heads/alias", "refs/notes/hidden");
    const repo = { id: "demo", path: repoPath };

    assert.deepEqual(await resolveCommitishRevision(repo, "feature", 5000), { ok: true, hash: head });
    assert.deepEqual(await resolveCommitishRevision(repo, "HEAD", 5000), { ok: true, hash: head });
    assert.deepEqual(await resolveCommitishRevision(repo, head.toUpperCase(), 5000), { ok: true, hash: head });
    const notFound = { ok: false, result: { status: 404, body: { error: "Ref not found or not a commit" } } };
    for (const hidden of ["notes/hidden", "refs/notes/hidden", "alias", "missing", "feature~5"]) {
      assert.deepEqual(await resolveCommitishRevision(repo, hidden, 5000), notFound, hidden);
    }
    // Let any stray rejection surface before checking.
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("file content and blame keep the commit check ahead of resolution", async () => {
  const repoPath = createRepo();
  try {
    const head = commitFile(repoPath, "src/f.txt", "x\ny\n", "2024-01-01T00:00:00Z");
    const blob = git(repoPath, "rev-parse", "HEAD:src/f.txt").trim();
    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 65_536 });
    const repo = { id: "demo", name: "demo", path: repoPath };

    for (const read of [service.getFileContent, service.getFileBlame]) {
      const call = (commit, filePath = "src/f.txt") =>
        read.call(service, repo, new URLSearchParams({ commit, path: filePath }));

      const upper = await call(head.toUpperCase());
      assert.equal(upper.status, 200);
      assert.equal(upper.body.commit, head, "the resolved (lowercase) object id is reported");

      assert.deepEqual(await call(blob), {
        status: 400,
        body: { error: "Hash does not identify a commit" },
      });
      assert.deepEqual(await call("f".repeat(40)), { status: 404, body: { error: "Commit not found" } });
      assert.deepEqual(await call(head, "missing.txt"), {
        status: 404,
        body: { error: "Path not found at this commit" },
      });
    }
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(unhandled, []);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getCommitContainingRefs sorts newest first and keeps ref order on ties", async () => {
  const repoPath = createRepo();
  try {
    const base = commitFile(repoPath, "a.txt", "1\n", "2024-01-01T00:00:00Z");
    // Same date on several refs: ties must keep for-each-ref (refname) order.
    for (const name of ["zeta", "alpha", "mid"]) git(repoPath, "branch", name);
    git(repoPath, "tag", "-a", "v1", "-m", "v1");
    git(repoPath, "tag", "light");
    commitFile(repoPath, "a.txt", "2\n", "2024-03-01T00:00:00Z");
    git(repoPath, "branch", "newer");
    git(repoPath, "checkout", "-q", "-b", "older", base);
    commitFile(repoPath, "b.txt", "3\n", "2024-02-01T00:00:00Z");
    git(repoPath, "checkout", "-q", "main");

    const service = createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 65_536 });
    const result = await service.getCommitContainingRefs({ id: "demo", path: repoPath }, base);
    assert.equal(result.status, 200);
    assert.deepEqual(
      result.body.refs.map((ref) => ref.name),
      [
        "refs/heads/main",
        "refs/heads/newer",
        "refs/heads/older",
        "refs/heads/alpha",
        "refs/heads/mid",
        "refs/heads/zeta",
        "refs/tags/light",
        "refs/tags/v1",
      ],
    );
    // An annotated tag sorts by the date of the commit it names.
    assert.equal(result.body.refs.at(-1).updatedAt, result.body.refs.at(-2).updatedAt);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

function createRepo() {
  const repoPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "refscope-concurrent-")));
  git(repoPath, "init", "-q", "-b", "main");
  git(repoPath, "config", "user.name", "Test");
  git(repoPath, "config", "user.email", "test@example.com");
  return repoPath;
}

function commitFile(repoPath, file, content, date) {
  fs.mkdirSync(path.dirname(path.join(repoPath, file)), { recursive: true });
  fs.writeFileSync(path.join(repoPath, file), content);
  git(repoPath, "add", file);
  spawnSync("git", ["commit", "-q", "-m", `change ${file}`], {
    cwd: repoPath,
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  return git(repoPath, "rev-parse", "HEAD").trim();
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}
