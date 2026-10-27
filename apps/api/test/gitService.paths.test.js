import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitService } from "../src/gitService.js";

test("literal Git paths stay distinct across commit observations", async (t) => {
  const { repo, service } = createFixture(t);
  git(repo.path, "commit", "--allow-empty", "-qm", "base");
  const base = git(repo.path, "rev-parse", "HEAD").trim();
  const snapshot = await service.getRefSnapshot(repo);
  const files = new Map([
    ["a => b", 2],
    ["b", 1],
    ["tail ", 3],
    ["tail", 4],
    ["src/{old => new}/file.txt", 5],
    ["ü\tline\n.txt", 6],
    ['"quote"\\slash.txt', 1],
    ["binary => blob.bin", -1],
    // With -z this name ends in the old record header plus its NUL delimiter.
    [`\n\x1e${"a".repeat(40)}`, 1],
    ["f".repeat(40), 1],
  ]);
  for (const [filePath, added] of files) {
    write(repo.path, filePath, added < 0 ? Buffer.from([0, 1, 255]) : "line\n".repeat(added));
  }
  git(repo.path, "add", "-A");
  git(repo.path, "commit", "-qm", "feat: literal paths \x1e are not records");
  const hash = git(repo.path, "rev-parse", "HEAD").trim();
  const added = [...files.values()].reduce((sum, count) => sum + Math.max(0, count), 0);

  await t.test("commit list counts every literal path", async () => {
    const result = await service.listCommits(repo, new URLSearchParams());
    assert.equal(result.status, 200);
    assert.deepEqual(result.body.map((commit) => commit.hash), [hash, base]);
    assert.equal(result.body[0].fileCount, files.size);
    assert.equal(result.body[0].added, added);
    assert.equal(result.body[0].deleted, 0);
  });

  await t.test("commit detail preserves paths, counts, and binary classification", async () => {
    const result = await service.getCommit(repo, hash);
    assert.equal(result.status, 200);
    assert.equal(result.body.files.length, files.size);
    assert.deepEqual(
      new Map(result.body.files.map((file) => [file.path, [file.status, file.added, file.deleted]])),
      new Map([...files].map(([filePath, count]) => [filePath, ["A", Math.max(0, count), 0]])),
    );
    const binary = result.body.files.find((file) => file.path === "binary => blob.bin");
    assert.notEqual(binary.structuralKind, "whitespace_only");
  });

  await t.test("risk breakdown uses the actual paths for hotspot lookup", async () => {
    const result = await service.getCommitRisk(repo, hash);
    assert.equal(result.status, 200);
    assert.deepEqual(
      new Map(result.body.breakdown.map((file) => [file.path, file.contribution])),
      new Map([...files].map(([filePath, count]) => [filePath, count < 0 ? 20 : count])),
    );
    assert.equal(result.body.riskScore, added + 20);
  });

  await t.test("compare counts distinct paths without interpreting arrows", async () => {
    const result = await service.compareRefs(repo, new URLSearchParams({ base, target: hash }));
    assert.equal(result.status, 200);
    assert.equal(result.body.files, files.size);
    assert.equal(result.body.added, added);
    assert.equal(result.body.deleted, 0);
  });

  await t.test("summary groups by literal path segments", async () => {
    const result = await service.summarizeCommits(repo, new URLSearchParams({ groupBy: "path" }));
    assert.equal(result.status, 200);
    assert.equal(result.body.observed.totalCommits, 2);
    assert.equal(result.body.observed.totalAdded, added);
    assert.equal(result.body.observed.totalDeleted, 0);
    assert.deepEqual(
      new Set(result.body.groups.map((group) => group.key)),
      new Set([...files.keys()].map((filePath) => filePath.split("/")[0])),
    );
    for (const group of result.body.groups) assert.deepEqual(group.commitHashes, [hash]);
  });

  await t.test("SSE commit additions carry the same file totals and risk", async () => {
    // Warm the same snapshot cache used by the list before the non-blocking SSE read.
    await service.getCommitRisk(repo, hash);
    const result = await service.collectRefEvents(repo, snapshot);
    const events = result.events.filter((event) => event.type === "commit_added");
    assert.deepEqual(events.map((event) => event.commit.hash), [hash]);
    assert.equal(events[0].commit.fileCount, files.size);
    assert.equal(events[0].commit.added, added);
    assert.equal(events[0].commit.deleted, 0);
    assert.equal(events[0].commit.riskScore, added + 20);
  });
});

test("actual renames retain destination counts and binary identity", async (t) => {
  const { repo, service } = createFixture(t);
  const oldText = "old => text.txt ";
  const newText = "new => text.txt ";
  const oldBinary = `\n\x1e${"b".repeat(40)}`;
  const newBinary = "binary => renamed\tfile ";
  const content = Array.from({ length: 30 }, (_, index) => `line ${index}\n`).join("");
  write(repo.path, oldText, content);
  write(repo.path, oldBinary, Buffer.from([0, 1, 2, 255]));
  git(repo.path, "add", "-A");
  git(repo.path, "commit", "-qm", "base");
  const base = git(repo.path, "rev-parse", "HEAD").trim();
  const snapshot = await service.getRefSnapshot(repo);
  git(repo.path, "mv", oldText, newText);
  git(repo.path, "mv", oldBinary, newBinary);
  write(repo.path, newText, `${content}one more\n`);
  git(repo.path, "add", "-A");
  git(repo.path, "commit", "-qm", "rename");
  const hash = git(repo.path, "rev-parse", "HEAD").trim();

  const detail = await service.getCommit(repo, hash);
  assert.equal(detail.status, 200);
  assert.deepEqual(
    new Map(detail.body.files.map((file) => [file.path, [file.status, file.added, file.deleted]])),
    new Map([[newText, ["R", 1, 0]], [newBinary, ["R", 0, 0]]]),
  );
  assert.notEqual(detail.body.files.find((file) => file.path === newBinary).structuralKind, "whitespace_only");
  const risk = await service.getCommitRisk(repo, hash);
  assert.deepEqual(new Set(risk.body.breakdown.map((file) => file.path)), new Set([newText, newBinary]));
  const list = await service.listCommits(repo, new URLSearchParams({ limit: "1" }));
  assert.equal(list.body[0].fileCount, 2);
  assert.equal(list.body[0].added, 1);
  assert.equal(list.body[0].deleted, 0);
  const compare = await service.compareRefs(repo, new URLSearchParams({ base, target: hash }));
  assert.equal(compare.body.files, 2);
  assert.equal(compare.body.added, 1);
  const events = (await service.collectRefEvents(repo, snapshot)).events.filter((event) => event.type === "commit_added");
  assert.equal(events.length, 1);
  assert.equal(events[0].commit.fileCount, 2);
  assert.equal(events[0].commit.added, 1);
});

test("staged and unstaged summaries distinguish arrow and trailing-space paths", async (t) => {
  const { repo, service } = createFixture(t);
  const paths = ["a => b", "b", "tail ", "tail", "tab\tand\nnewline"];
  for (const filePath of paths) write(repo.path, filePath, "base\n");
  git(repo.path, "add", "-A");
  git(repo.path, "commit", "-qm", "base");
  for (const filePath of paths) write(repo.path, filePath, "base\nstaged\n");
  git(repo.path, "add", "-A");
  for (const filePath of paths) write(repo.path, filePath, "base\nstaged\nunstaged\n");
  const result = await service.getWorkTreeChanges(repo);
  assert.equal(result.status, 200);
  for (const side of ["staged", "unstaged"]) {
    assert.deepEqual(result.body[side].summary, { fileCount: paths.length, added: paths.length, deleted: 0 }, side);
  }
});

test("numstat log framing handles root and empty commits beside record-like paths", async (t) => {
  const { repo, service } = createFixture(t);
  const fakeHash = "c".repeat(40);
  const paths = [`\n\x1e${fakeHash}`, fakeHash, " \t\n"];
  for (const filePath of paths) write(repo.path, filePath, "line\n");
  git(repo.path, "add", "-A");
  git(repo.path, "commit", "-qm", `root \x1e${fakeHash}`);
  const root = git(repo.path, "rev-parse", "HEAD").trim();
  git(repo.path, "commit", "--allow-empty", "-qm", "empty");
  const empty = git(repo.path, "rev-parse", "HEAD").trim();
  const list = await service.listCommits(repo, new URLSearchParams());
  assert.equal(list.status, 200);
  assert.deepEqual(list.body.map((commit) => [commit.hash, commit.fileCount, commit.added, commit.deleted]), [
    [empty, 0, 0, 0], [root, paths.length, paths.length, 0],
  ]);
  assert.deepEqual(list.body[1].parents, []);
  assert.equal(list.body[1].subject, `root \x1e${fakeHash}`);
  const summary = await service.summarizeCommits(repo, new URLSearchParams({ groupBy: "path" }));
  assert.equal(summary.body.observed.totalCommits, 2);
  assert.deepEqual(new Set(summary.body.groups.map((group) => group.key)), new Set(paths));
});

function createFixture(t) {
  const repoPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rtgv-path-identity-")));
  t.after(() => fs.rmSync(repoPath, { recursive: true, force: true, maxRetries: 10 }));
  git(repoPath, "init", "-q", "-b", "main");
  git(repoPath, "config", "user.name", "Path Test");
  git(repoPath, "config", "user.email", "path@example.test");
  git(repoPath, "config", "diff.renames", "true");
  return {
    repo: { id: "demo", name: "demo", path: repoPath },
    service: createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 1024 * 1024 }),
  };
}

function write(repoPath, filePath, content) {
  const fullPath = path.join(repoPath, filePath);
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, content);
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}
