import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { runGit } from "../src/gitRunner.js";
import {
  compareCommitLogArgs,
  compareFileListArgs,
  comparePatchArgs,
  createGitService,
  fileBlameArgs,
  parseBlamePorcelain,
  parseCompareFiles,
} from "../src/gitService.js";
import { parseCompareModeQuery } from "../src/validation.js";

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function createTempPath(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function commitFile(repoPath, file, content, message) {
  fs.mkdirSync(path.dirname(path.join(repoPath, file)), { recursive: true });
  fs.writeFileSync(path.join(repoPath, file), content);
  git(repoPath, "add", "--", file);
  git(repoPath, "commit", "-q", "-m", message);
  return git(repoPath, "rev-parse", "HEAD").trim();
}

function service(diffMaxBytes = 1_000_000) {
  return createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes });
}

/**
 * main:    A ── B(main-only)
 *           \
 * feature:   C(feature.txt) ── D(rename notes.md → docs/notes.md, edit README)
 */
function createDivergedRepo() {
  const repoPath = createTempPath("rtgv-compare-review-");
  git(repoPath, "init", "-q", "-b", "main");
  git(repoPath, "config", "user.name", "Realtime Test");
  git(repoPath, "config", "user.email", "realtime@example.test");
  const base = commitFile(repoPath, "README.md", "one\ntwo\n", "init");
  fs.writeFileSync(path.join(repoPath, "notes.md"), "a\nb\nc\nd\ne\nf\n");
  git(repoPath, "add", "notes.md");
  git(repoPath, "commit", "-q", "-m", "add notes");
  git(repoPath, "checkout", "-q", "-b", "feature");
  const c = commitFile(repoPath, "feature.txt", "feature\n", "feat: feature file");
  fs.mkdirSync(path.join(repoPath, "docs"));
  git(repoPath, "mv", "notes.md", "docs/notes.md");
  fs.writeFileSync(path.join(repoPath, "README.md"), "one\ntwo\nthree\n");
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-q", "-m", "docs: move notes");
  const d = git(repoPath, "rev-parse", "HEAD").trim();
  git(repoPath, "checkout", "-q", "main");
  const b = commitFile(repoPath, "main-only.txt", "main\n", "chore: main only");
  return { repoPath, base, b, c, d };
}

test("compare argument builders keep revisions as separate tokens", () => {
  const from = "a".repeat(40);
  const to = "b".repeat(40);
  const logArgs = compareCommitLogArgs(from, to, 11);
  assert.equal(logArgs[0], "log");
  assert.ok(logArgs.includes("--max-count=11"));
  assert.deepEqual(logArgs.slice(-6), ["--not", from, "--not", "--end-of-options", to, "--"]);
  assert.ok(!logArgs.some((arg) => arg.includes("..")));
  for (const flag of ["--numstat", "--name-status"]) {
    const args = compareFileListArgs(from, to, flag);
    assert.deepEqual(args.slice(-4), ["--end-of-options", from, to, "--"]);
    assert.ok(args.includes("--no-ext-diff") && args.includes("--no-textconv"));
  }
  assert.throws(() => compareFileListArgs(from, to, "--output=x"), /Unsupported/);
  const patchArgs = comparePatchArgs(from, to);
  assert.deepEqual(patchArgs.slice(-4), ["--end-of-options", from, to, "--"]);
  assert.ok(patchArgs.includes("--no-ext-diff") && patchArgs.includes("--no-textconv"));
});

test("parseCompareModeQuery defaults to three-dot and rejects unknown modes", () => {
  assert.deepEqual(parseCompareModeQuery(null), { ok: true, value: "three-dot" });
  assert.deepEqual(parseCompareModeQuery(""), { ok: true, value: "three-dot" });
  assert.deepEqual(parseCompareModeQuery("two-dot"), { ok: true, value: "two-dot" });
  for (const bad of ["three", "..", " two-dot", "--output=x"]) {
    assert.equal(parseCompareModeQuery(bad).ok, false, bad);
  }
});

test("parseCompareFiles pairs numstat with name-status, keeps renames and binaries", () => {
  const numstat = ["3\t1\tsrc/a.js", "-\t-\timg.png", "0\t0\t", "old/name.md", "new/name.md", ""].join("\0");
  const nameStatus = ["M", "src/a.js", "A", "img.png", "R100", "old/name.md", "new/name.md", ""].join("\0");
  assert.deepEqual(parseCompareFiles(numstat, nameStatus), [
    { status: "M", path: "src/a.js", added: 3, deleted: 1, binary: false },
    { status: "A", path: "img.png", added: 0, deleted: 0, binary: true },
    { status: "R", path: "new/name.md", oldPath: "old/name.md", added: 0, deleted: 0, binary: false },
  ]);
});

test("getCompareCommits lists ahead and behind commits newest first", async () => {
  const { repoPath, b, c, d } = createDivergedRepo();
  try {
    const repo = { id: "demo", name: "demo", path: repoPath };
    const result = await service().getCompareCommits(repo, new URLSearchParams({ base: "main", target: "feature" }));
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.ahead.map((commit) => commit.hash), [d, c]);
    assert.deepEqual(result.body.behind.map((commit) => commit.hash), [b]);
    assert.equal(result.body.aheadTruncated, false);
    assert.equal(result.body.ahead[0].subject, "docs: move notes");
    assert.equal(typeof result.body.ahead[0].riskScore, "number");
    assert.ok(!("fileDiffs" in result.body.ahead[0]));

    const limited = await service().getCompareCommits(
      repo,
      new URLSearchParams({ base: "main", target: "feature", limit: "1" }),
    );
    assert.deepEqual(limited.body.ahead.map((commit) => commit.hash), [d]);
    assert.equal(limited.body.aheadTruncated, true);
    assert.equal(limited.body.behindTruncated, false);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareCommits validates input before running git", async () => {
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };
  const svc = service();
  assert.equal((await svc.getCompareCommits(repo, new URLSearchParams({ base: "--all", target: "x" }))).status, 400);
  assert.equal(
    (await svc.getCompareCommits(repo, new URLSearchParams({ base: "main", target: "dev", limit: "1e2" }))).status,
    400,
  );
  const dup = new URLSearchParams("base=main&target=dev&limit=1&limit=2");
  assert.deepEqual(await svc.getCompareCommits(repo, dup), {
    status: 400,
    body: { error: "Duplicate limit parameter" },
  });
});

test("getCompareDiff three-dot shows only what target introduced; two-dot includes base-only changes", async () => {
  const { repoPath, d } = createDivergedRepo();
  try {
    const repo = { id: "demo", name: "demo", path: repoPath };
    const three = await service().getCompareDiff(repo, new URLSearchParams({ base: "main", target: "feature" }));
    assert.equal(three.status, 200);
    assert.equal(three.body.mode, "three-dot");
    assert.equal(three.body.fallback, false);
    assert.equal(three.body.toHash, d);
    assert.equal(three.body.fromHash, three.body.mergeBase);
    const paths = three.body.files.map((file) => file.path).sort();
    assert.deepEqual(paths, ["README.md", "docs/notes.md", "feature.txt"]);
    const renamed = three.body.files.find((file) => file.path === "docs/notes.md");
    assert.equal(renamed.status, "R");
    assert.equal(renamed.oldPath, "notes.md");
    assert.match(three.body.diff, /diff --git a\/feature\.txt b\/feature\.txt/);
    assert.ok(!three.body.diff.includes("main-only.txt"));
    assert.equal(three.body.added, 2);
    assert.equal(three.body.truncated, false);

    const two = await service().getCompareDiff(
      repo,
      new URLSearchParams({ base: "main", target: "feature", mode: "two-dot" }),
    );
    assert.equal(two.body.mode, "two-dot");
    const main = two.body.files.find((file) => file.path === "main-only.txt");
    assert.equal(main?.status, "D");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareDiff bounds the patch but keeps the full file list", async () => {
  const { repoPath } = createDivergedRepo();
  try {
    const repo = { id: "demo", name: "demo", path: repoPath };
    const result = await service(120).getCompareDiff(repo, new URLSearchParams({ base: "main", target: "feature" }));
    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, true);
    assert.ok(result.body.diff.length <= 120);
    assert.ok(result.body.diff === "" || result.body.diff.endsWith("\n"));
    assert.equal(result.body.files.length, 3);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareDiff falls back to two-dot for unrelated histories", async () => {
  const repoPath = createTempPath("rtgv-compare-orphan-");
  try {
    git(repoPath, "init", "-q", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    commitFile(repoPath, "a.txt", "a\n", "main root");
    git(repoPath, "checkout", "-q", "--orphan", "other");
    git(repoPath, "rm", "-q", "-rf", ".");
    commitFile(repoPath, "b.txt", "b\n", "other root");
    const repo = { id: "demo", name: "demo", path: repoPath };
    const result = await service().getCompareDiff(repo, new URLSearchParams({ base: "main", target: "other" }));
    assert.equal(result.status, 200);
    assert.equal(result.body.fallback, true);
    assert.equal(result.body.mode, "two-dot");
    assert.equal(result.body.requestedMode, "three-dot");
    assert.equal(result.body.mergeBase, null);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getCompareDiff rejects invalid and duplicate modes", async () => {
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };
  assert.deepEqual(
    await service().getCompareDiff(repo, new URLSearchParams({ base: "main", target: "dev", mode: "triple" })),
    { status: 400, body: { error: "Invalid mode parameter" } },
  );
  assert.deepEqual(
    await service().getCompareDiff(repo, new URLSearchParams("base=main&target=dev&mode=two-dot&mode=three-dot")),
    { status: 400, body: { error: "Duplicate mode parameter" } },
  );
});

test("fileBlameArgs reads committed objects only and parseBlamePorcelain groups metadata", () => {
  const oid = "c".repeat(40);
  assert.deepEqual(fileBlameArgs(oid, "-weird.txt"), [
    "blame",
    "--porcelain",
    "--no-textconv",
    "--no-ignore-revs-file",
    oid,
    "--",
    "-weird.txt",
  ]);
  const a = "1".repeat(40);
  const b = "2".repeat(40);
  const stdout = [
    `${a} 1 1 1`,
    "author Ada",
    "author-mail <ada@example.test>",
    "author-time 1700000000",
    "summary first",
    "boundary",
    "filename f.txt",
    "\talpha",
    `${b} 2 2 2`,
    "author Bob",
    "author-mail <bob@example.test>",
    "author-time 1700000100",
    `previous ${a} old name.txt`,
    "summary second",
    "filename f.txt",
    "\tbeta",
    `${b} 3 3`,
    "\t\tgamma",
    "",
  ].join("\n");
  const parsed = parseBlamePorcelain(stdout);
  assert.equal(parsed.binary, false);
  assert.deepEqual(
    parsed.lines.map((line) => [line.line, line.hash, line.content]),
    [
      [1, a, "alpha"],
      [2, b, "beta"],
      [3, b, "\tgamma"],
    ],
  );
  assert.equal(parsed.commits.length, 2);
  const first = parsed.commits.find((entry) => entry.hash === a);
  assert.equal(first.boundary, true);
  assert.equal(first.authorEmail, "ada@example.test");
  assert.equal(first.authorTime, new Date(1700000000 * 1000).toISOString());
  const second = parsed.commits.find((entry) => entry.hash === b);
  assert.equal(second.previousHash, a);
  assert.equal(second.previousPath, "old name.txt");
});

test("getFileBlame attributes each line to the commit that last changed it", async () => {
  const repoPath = createTempPath("rtgv-blame-");
  try {
    git(repoPath, "init", "-q", "-b", "main");
    git(repoPath, "config", "user.name", "Realtime Test");
    git(repoPath, "config", "user.email", "realtime@example.test");
    const first = commitFile(repoPath, "src/f.txt", "a\nb\n", "first");
    const second = commitFile(repoPath, "src/f.txt", "a\nB\nc\n", "second");
    // A missing ignore-revs file must not break blame.
    git(repoPath, "config", "blame.ignoreRevsFile", "does-not-exist");
    const repo = { id: "demo", name: "demo", path: repoPath };
    const result = await service().getFileBlame(repo, new URLSearchParams({ commit: second, path: "src/f.txt" }));
    assert.equal(result.status, 200);
    assert.equal(result.body.lineCount, 3);
    assert.deepEqual(
      result.body.lines.map((line) => [line.content, line.hash]),
      [
        ["a", first],
        ["B", second],
        ["c", second],
      ],
    );
    const secondMeta = result.body.commits.find((entry) => entry.hash === second);
    assert.equal(secondMeta.summary, "second");
    assert.equal(secondMeta.previousHash, first);

    const atFirst = await service().getFileBlame(repo, new URLSearchParams({ commit: first, path: "src/f.txt" }));
    assert.deepEqual(atFirst.body.lines.map((line) => line.hash), [first, first]);

    assert.equal(
      (await service().getFileBlame(repo, new URLSearchParams({ commit: second, path: "missing.txt" }))).status,
      404,
    );
    assert.equal(
      (await service().getFileBlame(repo, new URLSearchParams({ commit: second, path: "src" }))).status,
      400,
    );
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
  }
});

test("getFileBlame validates commit and path before running git", async () => {
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };
  assert.deepEqual(await service().getFileBlame(repo, new URLSearchParams({ commit: "HEAD", path: "a" })), {
    status: 400,
    body: { error: "Invalid commit parameter" },
  });
  assert.deepEqual(await service().getFileBlame(repo, new URLSearchParams({ commit: "a".repeat(40) })), {
    status: 400,
    body: { error: "Missing path parameter" },
  });
});

test("runGit rejects blame options that read files", () => {
  const repoPath = createTempPath("rtgv-blame-guard-");
  git(repoPath, "init", "-q");
  const repo = { path: repoPath };
  for (const arg of ["--contents", "--contents=/etc/passwd", "-Srevs", "--ignore-revs-file=x", "--ignore-revs-file"]) {
    assert.throws(() => runGit(repo, ["blame", arg, "HEAD", "--", "README.md"]), /blame file input/, arg);
  }
  fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 });
});
