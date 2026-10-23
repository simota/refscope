import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  buildAuthorFilterArgs,
  createGitService,
  parseNameOnlyLogRecords,
  quoteDiffSidePath,
} from "../src/gitService.js";

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function createRepo(prefix) {
  const repoPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  git(repoPath, "init", "-b", "main");
  git(repoPath, "config", "user.name", "Realtime Test");
  git(repoPath, "config", "user.email", "realtime@example.test");
  return repoPath;
}

function commitFile(repoPath, name, content, message) {
  fs.mkdirSync(path.dirname(path.join(repoPath, name)), { recursive: true });
  fs.writeFileSync(path.join(repoPath, name), content);
  git(repoPath, "add", "--", name);
  git(repoPath, "commit", "-m", message);
  return git(repoPath, "rev-parse", "HEAD").trim();
}

function createService(overrides = {}) {
  return createGitService({
    repositories: new Map(),
    gitTimeoutMs: 10_000,
    diffMaxBytes: 4_000_000,
    ...overrides,
  });
}

function withRepo(prefix, fn) {
  return async () => {
    const repoPath = createRepo(prefix);
    try {
      await fn(repoPath, { id: "demo", name: "demo", path: repoPath });
    } finally {
      fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
    }
  };
}

test(
  "listRefs drops public symrefs that point into hidden namespaces",
  withRepo("rtgv-symref-leak-", async (repoPath, repo) => {
    commitFile(repoPath, "a.txt", "a\n", "base");
    git(repoPath, "notes", "add", "-m", "secret note");
    git(repoPath, "symbolic-ref", "refs/heads/leak", "refs/notes/commits");
    git(repoPath, "update-ref", "refs/remotes/origin/main", "HEAD");
    git(repoPath, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
    const notesHash = git(repoPath, "rev-parse", "refs/notes/commits").trim();

    const service = createService();
    const names = (await service.listRefs(repo)).map((ref) => ref.name);
    assert.ok(!names.includes("refs/heads/leak"), "symref to refs/notes must not be listed");
    assert.ok(names.includes("refs/remotes/origin/HEAD"), "public symref target stays listed");

    const head = git(repoPath, "rev-parse", "HEAD").trim();
    const containing = await service.getCommitContainingRefs(repo, head);
    assert.ok(!containing.body.refs.some((ref) => ref.hash === notesHash));
  }),
);

test(
  "listRefs reports the commit behind a tag of a tag",
  withRepo("rtgv-nested-tag-", async (repoPath, repo) => {
    const head = commitFile(repoPath, "a.txt", "a\n", "base");
    git(repoPath, "tag", "-a", "inner", "-m", "inner");
    git(repoPath, "-c", "advice.nestedTag=false", "tag", "-a", "outer", "-m", "outer", "inner");

    const service = createService();
    const refs = await service.listRefs(repo);
    const outer = refs.find((ref) => ref.name === "refs/tags/outer");
    assert.equal(outer.hash, head);
    assert.equal(Object.keys(outer).includes("nestedTag"), false, "internal flag stays off the payload");

    const containing = await service.getCommitContainingRefs(repo, head);
    assert.equal(containing.body.refs.find((ref) => ref.name === "refs/tags/outer").hash, head);
  }),
);

test(
  "rejects an ambiguous name that Git would resolve under $GIT_DIR",
  withRepo("rtgv-pseudoref-", async (repoPath, repo) => {
    commitFile(repoPath, "a.txt", "a\n", "base");
    git(repoPath, "checkout", "-b", "private-work");
    const secret = commitFile(repoPath, "secret.txt", "s\n", "private secret commit");
    git(repoPath, "update-ref", "refs/private/secret", secret);
    git(repoPath, "checkout", "main");
    git(repoPath, "branch", "-D", "private-work");
    // Git checks $GIT_DIR/NOTES_MERGE_PARTIAL before refs/heads/.
    fs.writeFileSync(path.join(repoPath, ".git", "NOTES_MERGE_PARTIAL"), `${secret}\n`);
    git(repoPath, "branch", "NOTES_MERGE_PARTIAL");

    const service = createService();
    const ambiguous = await service.listCommits(repo, new URLSearchParams({ ref: "NOTES_MERGE_PARTIAL" }));
    assert.equal(ambiguous.status, 404);

    const qualified = await service.listCommits(
      repo,
      new URLSearchParams({ ref: "refs/heads/NOTES_MERGE_PARTIAL" }),
    );
    assert.equal(qualified.status, 200);
    assert.deepEqual(qualified.body.map((commit) => commit.subject), ["base"]);
  }),
);

test(
  "a commit with thousands of files neither fails the list nor stalls live updates",
  withRepo("rtgv-large-commit-", async (repoPath, repo) => {
    const base = commitFile(repoPath, "README.md", "hello\n", "base");
    const dir = path.join(repoPath, "vendor", "some-package", "nested", "module");
    fs.mkdirSync(dir, { recursive: true });
    const fileCount = 7000;
    for (let i = 0; i < fileCount; i += 1) {
      fs.writeFileSync(path.join(dir, `generated-module-file-${String(i).padStart(5, "0")}.js`), "x\n");
    }
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-q", "-m", "vendor everything");

    const service = createService();
    const list = await service.listCommits(repo, new URLSearchParams({ limit: "1" }));
    assert.equal(list.status, 200);
    assert.equal(list.body[0].fileCount, fileCount);

    const snapshot = await service.getRefSnapshot(repo);
    const previous = new Map(snapshot);
    previous.set("refs/heads/main", { ...snapshot.get("refs/heads/main"), hash: base });
    const result = await service.collectRefEvents(repo, previous);
    const added = result.events.filter((event) => event.type === "commit_added");
    assert.equal(added.length, 1);
    assert.equal(added[0].commit.fileCount, fileCount);
  }),
);

test(
  "getCommit and getDiff describe a merge against its first parent",
  withRepo("rtgv-merge-diff-", async (repoPath, repo) => {
    commitFile(repoPath, "f", "1\n2\n", "base");
    git(repoPath, "checkout", "-q", "-b", "side");
    fs.writeFileSync(path.join(repoPath, "s.txt"), "side\n");
    fs.writeFileSync(path.join(repoPath, "f"), "1\nS\n");
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-q", "-m", "side");
    git(repoPath, "checkout", "-q", "main");
    fs.writeFileSync(path.join(repoPath, "f"), "M\n2\n");
    git(repoPath, "commit", "-q", "-am", "main");
    spawnSync("git", ["merge", "-q", "side", "-m", "merge"], { cwd: repoPath });
    fs.writeFileSync(path.join(repoPath, "f"), "res\n");
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-q", "-m", "merge");
    const merge = git(repoPath, "rev-parse", "HEAD").trim();

    const service = createService();
    const commit = await service.getCommit(repo, merge);
    assert.equal(commit.status, 200);
    const files = Object.fromEntries(commit.body.files.map((file) => [file.path, file]));
    assert.deepEqual(Object.keys(files).sort(), ["f", "s.txt"]);
    assert.equal(files["s.txt"].status, "A");
    assert.equal(files["s.txt"].added, 1);
    assert.equal(files.f.status, "M");

    const diff = await service.getDiff(repo, merge);
    assert.equal(diff.status, 200);
    assert.match(diff.body.diff, /^diff --git a\/s\.txt b\/s\.txt$/m);
    assert.doesNotMatch(diff.body.diff, /^diff --cc /m);
  }),
);

test(
  "an author filter keeps pickaxe and regex searches case-sensitive",
  withRepo("rtgv-author-pickaxe-", async (repoPath, repo) => {
    commitFile(repoPath, "a.txt", "FOO\n", "add upper");
    commitFile(repoPath, "a.txt", "FOO\nfoo\n", "add lower");

    const service = createService();
    for (const mode of ["pickaxe", "regex"]) {
      const plain = await service.listCommits(repo, new URLSearchParams({ mode, pattern: "foo" }));
      const withAuthor = await service.listCommits(
        repo,
        new URLSearchParams({ mode, pattern: "foo", author: "realtime TEST" }),
      );
      assert.deepEqual(plain.body.map((c) => c.subject), ["add lower"], mode);
      assert.deepEqual(withAuthor.body.map((c) => c.subject), ["add lower"], mode);
    }
    const otherAuthor = await service.listCommits(
      repo,
      new URLSearchParams({ mode: "pickaxe", pattern: "foo", author: "someone.else" }),
    );
    assert.deepEqual(otherAuthor.body, []);
  }),
);

test("buildAuthorFilterArgs matches the author literally in every mode", () => {
  assert.deepEqual(buildAuthorFilterArgs("", "pickaxe"), []);
  assert.deepEqual(buildAuthorFilterArgs("a.b", "subject"), [
    "--regexp-ignore-case",
    "--extended-regexp",
    "--author=a\\.b",
  ]);
  // Basic regex: no --extended-regexp, which would also change -G.
  assert.deepEqual(buildAuthorFilterArgs("A.b*(c)", "regex"), ["--author=[aA]\\.[bB]\\*([cC])"]);
});

test(
  "branch group head names the branch even when a tag shares its name",
  withRepo("rtgv-head-ambiguous-", async (repoPath, repo) => {
    commitFile(repoPath, "a.txt", "a\n", "base");
    git(repoPath, "branch", "feat/x");
    git(repoPath, "tag", "main");

    const service = createService();
    const result = await service.getBranchGroupHealth(repo, new URLSearchParams({ prefix: "feat/" }));
    assert.equal(result.status, 200);
    assert.equal(result.body.head.name, "main");
  }),
);

test(
  "hotspot is not misled by a file name that looks like a record header",
  withRepo("rtgv-hotspot-forge-", async (repoPath, repo) => {
    commitFile(repoPath, "z.txt", "z\n", "first");
    fs.writeFileSync(path.join(repoPath, "a.txt"), "a\n");
    fs.writeFileSync(path.join(repoPath, `${"0123456789abcdef".repeat(2)}01234567\u001fevil`), "x\n");
    git(repoPath, "add", "-A");
    git(repoPath, "commit", "-m", "second");

    const service = createService();
    const result = await service.getFileHotspot(repo, { ref: "HEAD", limit: 50, commitCap: 50, since: null });
    assert.equal(result.status, 200);
    assert.equal(result.body.scope.commitsAnalyzed, 2);
    for (const file of result.body.files) {
      assert.match(file.lastChangedAt, /^\d{4}-\d{2}-\d{2}T/, file.path);
    }
    assert.equal(result.body.files.length, 3);
  }),
);

test("parseNameOnlyLogRecords keeps empty commits and header-like paths apart", () => {
  const h1 = "a".repeat(40);
  const h2 = "b".repeat(40);
  const forged = `${"c".repeat(40)}\u001fevil`;
  const stdout = `\0${h1}\0d1\0\n${forged}\0x\0x\0\0${h2}\0d2\0`;
  assert.deepEqual(parseNameOnlyLogRecords(stdout), [
    { hash: h1, authorDate: "d1", paths: new Set([forged, "x"]) },
    { hash: h2, authorDate: "d2", paths: new Set() },
  ]);
});

test(
  "hotspot stops at the request deadline instead of probing every path",
  withRepo("rtgv-hotspot-deadline-", async (repoPath, repo, t) => {
    commitFile(repoPath, "a.txt", "a\n", "first");
    const service = createService({ hotspotTimeoutMs: 20_000 });
    const realNow = Date.now;
    let calls = 0;
    // The first reading sets the deadline; every later one is past it.
    Date.now = () => (calls++ === 0 ? realNow() : realNow() + 60_000);
    try {
      const result = await service.getFileHotspot(repo, { ref: "HEAD", limit: 50, commitCap: 50, since: null });
      assert.equal(result.status, 504);
      assert.deepEqual(result.body, { error: "timeout", truncated: true, truncationReason: "timeout" });
    } finally {
      Date.now = realNow;
    }
  }),
);

test(
  "untracked file names cannot inject lines into the synthesized patch",
  withRepo("rtgv-untracked-quote-", async (repoPath, repo) => {
    commitFile(repoPath, "a.txt", "a\n", "base");
    const name = 'evil\n@@ -0,0 +1 @@\n+INJECTED"\\';
    fs.writeFileSync(path.join(repoPath, name), "real\n");

    const service = createService();
    const result = await service.getWorkTreeChanges(repo);
    assert.equal(result.status, 200);
    const diff = result.body.untracked.diff;
    assert.doesNotMatch(diff, /^\+INJECTED/m);
    assert.equal(diff.split("\n").filter((line) => line.startsWith("@@")).length, 1);
    assert.ok(diff.includes(`+++ ${quoteDiffSidePath("b/", name)}\n`));
    assert.deepEqual(result.body.untracked.files.map((file) => file.path), [name]);
  }),
);

test("quoteDiffSidePath matches Git's C-style quoting", () => {
  assert.equal(quoteDiffSidePath("b/", "plain name.txt"), "b/plain name.txt");
  assert.equal(quoteDiffSidePath("a/", 'x\n"\\\u0001\t'), '"a/x\\n\\"\\\\\\001\\t"');
});
