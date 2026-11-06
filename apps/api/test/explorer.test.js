// Repository explorer: tree listing, path index, code search, and reflog.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createGitService } from "../src/gitService.js";
import { createRequestHandler } from "../src/http.js";
import { runGit } from "../src/gitRunner.js";
import {
  CODE_SEARCH_LINE_MAX_CHARS,
  classifyReflogMessage,
  codeSearchArgs,
  parseCodeSearchOutput,
  parseReflogRecords,
  parseTreeEntries,
  unreachableArgs,
} from "../src/explorerService.js";

const H1 = "1111111111111111111111111111111111111111";
const H2 = "2222222222222222222222222222222222222222";

// ─── Pure helpers ───────────────────────────────────────────────────────────

test("parseTreeEntries classifies entries and sorts directories first", () => {
  const out = [
    `100644 blob ${H1}      12\tb.txt`,
    `040000 tree ${H2}       -\tsrc`,
    `120000 blob ${H1}       5\tlink`,
    `160000 commit ${H2}       -\tvendor`,
    `100644 blob ${H1}       3\tA.md`,
    `100644 blob ${H1}       3\twith\nnewline`,
    `100644 blob ${H1}       3\tcut-by-cap`.slice(0, 20),
  ].join("\0");
  const entries = parseTreeEntries(out, "pkg");
  assert.deepEqual(
    entries.map((e) => [e.name, e.type]),
    [
      ["src", "dir"],
      ["A.md", "file"],
      ["b.txt", "file"],
      ["link", "symlink"],
      ["vendor", "submodule"],
      ["with\nnewline", "file"],
    ],
  );
  assert.equal(entries.find((e) => e.name === "b.txt").size, 12);
  assert.equal(entries.find((e) => e.name === "src").size, null);
  assert.equal(entries.find((e) => e.name === "src").path, "pkg/src");
});

test("codeSearchArgs attaches the pattern to -e and never lets it act as an option", () => {
  const args = codeSearchArgs({ commit: H1, pattern: "--no-index", mode: "fixed", ignoreCase: true, pathspec: null });
  assert.equal(args[0], "grep");
  assert.ok(args.includes("-e--no-index"));
  assert.ok(!args.includes("--no-index"));
  assert.ok(args.includes("--fixed-strings") && args.includes("--ignore-case"));
  assert.ok(args.includes("--no-column") && args.includes("--no-heading"));
  assert.deepEqual(args.slice(-2), [H1, "--"]);
  const scoped = codeSearchArgs({ commit: H1, pattern: "x", mode: "regex", ignoreCase: false, pathspec: ":(literal,top)src" });
  assert.ok(scoped.includes("--extended-regexp") && !scoped.includes("--ignore-case"));
  assert.equal(scoped.at(-1), ":(literal,top)src");
});

test("runner rejects grep options that run programs or read files and the worktree", async () => {
  const repoPath = tempRepo();
  const repo = { path: repoPath };
  for (const bad of [["grep", "-Ovim", "-e", "x"], ["grep", "--open-files-in-pager", "-e", "x"], ["grep", "-f", "/etc/passwd"], ["grep", "--untracked", "-e", "x"], ["grep", "--no-index", "-e", "x"]]) {
    assert.throws(() => runGit(repo, bad), /not allowed/, bad.join(" "));
  }
  fs.rmSync(repoPath, { recursive: true, force: true });
});

test("parseCodeSearchOutput frames records sequentially and clips long lines", () => {
  const long = "y".repeat(CODE_SEARCH_LINE_MAX_CHARS + 10);
  const out =
    `${H1}:src/a.js\x001\x00const a = 1;\n` +
    `${H1}:odd\nname.txt\x007\x00${long}\n` +
    `${H1}:fake.txt\x002\x00text with ${H1}:x\x009\x00 inside\n` +
    `${H1}:cut\x003\x00partial`;
  const { matches, limited } = parseCodeSearchOutput(out, H1, 10);
  assert.equal(limited, false);
  assert.deepEqual(matches.map((m) => [m.path, m.line]), [
    ["src/a.js", 1],
    ["odd\nname.txt", 7],
    ["fake.txt", 2],
  ]);
  assert.equal(matches[1].clipped, true);
  assert.equal(matches[1].text.length, CODE_SEARCH_LINE_MAX_CHARS);
  assert.equal(parseCodeSearchOutput(out, H1, 1).limited, true);
});

test("classifyReflogMessage marks history-rewriting operations", () => {
  assert.deepEqual(classifyReflogMessage("commit (amend): fix"), { action: "amend", rewrites: true });
  assert.deepEqual(classifyReflogMessage("reset: moving to HEAD~2"), { action: "reset", rewrites: true });
  assert.deepEqual(classifyReflogMessage("rebase (finish): returning to refs/heads/x"), { action: "rebase", rewrites: true });
  assert.deepEqual(classifyReflogMessage("rebase -i (pick): msg"), { action: "rebase", rewrites: true });
  assert.deepEqual(classifyReflogMessage("commit: add"), { action: "commit", rewrites: false });
  assert.deepEqual(classifyReflogMessage("commit (initial): root"), { action: "commit", rewrites: false });
  assert.deepEqual(classifyReflogMessage("commit (merge): Merge x"), { action: "merge", rewrites: false });
  assert.deepEqual(classifyReflogMessage("checkout: moving from a to b"), { action: "checkout", rewrites: false });
  assert.deepEqual(classifyReflogMessage("pull: Fast-forward"), { action: "pull", rewrites: false });
  assert.deepEqual(classifyReflogMessage("update by push"), { action: "push", rewrites: false });
  assert.deepEqual(classifyReflogMessage("something new"), { action: "other", rewrites: false });
});

test("parseReflogRecords stops at a misaligned record instead of guessing", () => {
  const rec = (hash) => [hash, "", "A", "2024-01-01T00:00:00Z", "s", "HEAD@{1704067200}", "commit: s", "A", "a@b"].join("\0");
  const ok = parseReflogRecords(`${rec(H1)}\0${rec(H2)}\0`);
  assert.equal(ok.length, 2);
  assert.equal(ok[0].movedAt, "2024-01-01T00:00:00.000Z");
  assert.equal(parseReflogRecords(`${rec(H1)}\0${rec("nothash")}\0`).length, 1);
});

test("unreachableArgs negates every public ref namespace and HEAD", () => {
  assert.deepEqual(unreachableArgs([H1]), ["rev-list", "--not", "--branches", "--tags", "--remotes", "HEAD", "--not", H1]);
});

// ─── Service against real repositories ──────────────────────────────────────

test("getTree lists a directory at a commit and getTreePaths indexes every file", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "README.md", "# demo\n");
    write(repoPath, "src/app.js", "export const answer = 42;\n");
    write(repoPath, "src/lib/util.js", "export function helper() {}\n");
    write(repoPath, "space dir/file one.txt", "x\n");
    const first = commit(repoPath, "feat: initial");
    fs.rmSync(path.join(repoPath, "src/lib"), { recursive: true });
    const second = commit(repoPath, "chore: drop lib");
    const { service, repo } = setup(repoPath);
    const tree = (params) => service.getTree(repo, new URLSearchParams(params));

    const root = await tree({ commit: first });
    assert.equal(root.status, 200);
    assert.deepEqual(root.body.entries.map((e) => [e.name, e.type]), [
      ["space dir", "dir"],
      ["src", "dir"],
      ["README.md", "file"],
    ]);
    const src = await tree({ commit: first, path: "src" });
    assert.deepEqual(src.body.entries.map((e) => e.path), ["src/lib", "src/app.js"]);
    assert.equal(src.body.entries[1].size, "export const answer = 42;\n".length);
    assert.deepEqual((await tree({ commit: second, path: "src" })).body.entries.map((e) => e.path), ["src/app.js"]);

    assert.equal((await tree({ commit: second, path: "src/lib" })).status, 404);
    assert.equal((await tree({ commit: first, path: "README.md" })).status, 400);
    assert.equal((await tree({ commit: first, path: "../x" })).status, 400);
    assert.equal((await tree({ commit: "HEAD" })).status, 400);
    assert.equal((await tree({ commit: "f".repeat(40) })).status, 404);
    assert.equal((await service.getTree(repo, new URLSearchParams("commit=" + first + "&commit=" + second))).status, 400);

    const paths = await service.getTreePaths(repo, new URLSearchParams({ commit: first }));
    assert.equal(paths.status, 200);
    assert.deepEqual(paths.body.paths.sort(), ["README.md", "space dir/file one.txt", "src/app.js", "src/lib/util.js"]);
    assert.equal(paths.body.truncated, false);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("searchCode greps a commit's tree, not the working tree", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "src/app.js", "const Needle = 1;\nconst other = 2;\nneedle();\n");
    write(repoPath, "docs/notes.md", "a needle in docs\n");
    write(repoPath, "bin.dat", Buffer.from([0x6e, 0x65, 0x65, 0x64, 0x6c, 0x65, 0x00, 0x01]));
    write(repoPath, "flags.txt", "--no-index and -O are just text\n");
    const first = commit(repoPath, "feat: initial");
    write(repoPath, "src/app.js", "const renamed = 1;\n");
    const second = commit(repoPath, "refactor: rename");
    // Uncommitted content must never show up.
    write(repoPath, "src/dirty.js", "needle\n");
    const { service, repo } = setup(repoPath);
    const search = (params) => service.searchCode(repo, new URLSearchParams(params));

    const sensitive = await search({ commit: first, q: "needle" });
    assert.equal(sensitive.status, 200);
    assert.deepEqual(sensitive.body.matches.map((m) => [m.path, m.line]), [
      ["docs/notes.md", 1],
      ["src/app.js", 3],
    ]);
    assert.equal(sensitive.body.fileCount, 2);

    const insensitive = await search({ commit: first, q: "needle", ignoreCase: "1", path: "src" });
    assert.deepEqual(insensitive.body.matches.map((m) => [m.path, m.line, m.text]), [
      ["src/app.js", 1, "const Needle = 1;"],
      ["src/app.js", 3, "needle();"],
    ]);

    const regex = await search({ commit: first, q: "^const (Needle|other)", mode: "regex" });
    assert.deepEqual(regex.body.matches.map((m) => m.line), [1, 2]);

    const flagLike = await search({ commit: first, q: "--no-index" });
    assert.deepEqual(flagLike.body.matches.map((m) => m.path), ["flags.txt"]);

    const later = await search({ commit: second, q: "needle", ignoreCase: "1" });
    assert.deepEqual(later.body.matches.map((m) => m.path), ["docs/notes.md"], "searches the given commit only");

    const none = await search({ commit: first, q: "absent-token" });
    assert.equal(none.status, 200);
    assert.deepEqual(none.body.matches, []);

    const limited = await search({ commit: first, q: "e", limit: "2" });
    assert.equal(limited.body.matches.length, 2);
    assert.equal(limited.body.truncated, true);

    assert.equal((await search({ commit: first, q: "(" , mode: "regex" })).status, 400);
    assert.equal((await search({ commit: first })).status, 400);
    assert.equal((await search({ commit: first, q: "x", mode: "perl" })).status, 400);
    assert.equal((await search({ commit: first, q: "x", ignoreCase: "yes" })).status, 400);
    assert.equal((await search({ commit: first, q: "x", path: "/etc" })).status, 400);
    assert.equal((await search({ commit: "HEAD", q: "x" })).status, 400);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getReflog walks HEAD and branch reflogs and flags lost commits", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "f.txt", "1\n");
    const c1 = commit(repoPath, "c1");
    write(repoPath, "f.txt", "2\n");
    const c2 = commit(repoPath, "c2");
    write(repoPath, "f.txt", "3\n");
    const c3 = commit(repoPath, "c3");
    git(repoPath, "reset", "-q", "--hard", c1);
    const { service, repo } = setup(repoPath);
    const reflog = (params) => service.getReflog(repo, new URLSearchParams(params));

    const head = await reflog({});
    assert.equal(head.status, 200);
    assert.equal(head.body.ref, "HEAD");
    assert.deepEqual(head.body.entries.map((e) => [e.selector, e.hash, e.action]), [
      ["HEAD@{0}", c1, "reset"],
      ["HEAD@{1}", c3, "commit"],
      ["HEAD@{2}", c2, "commit"],
      ["HEAD@{3}", c1, "commit"],
    ]);
    const [reset, tip3, tip2] = head.body.entries;
    assert.equal(reset.rewrites, true);
    assert.equal(reset.previousHash, c3);
    assert.equal(reset.previousReachable, false, "the reset orphaned c3");
    assert.equal(tip3.reachable, false);
    assert.equal(tip2.reachable, false);
    assert.equal(reset.reachable, true);
    assert.equal(head.body.lostCount, 2);
    assert.match(reset.movedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(head.body.hasMore, false);

    const page = await reflog({ limit: "2", skip: "1" });
    assert.deepEqual(page.body.entries.map((e) => e.selector), ["HEAD@{1}", "HEAD@{2}"]);
    assert.equal(page.body.entries[1].previousHash, c1, "the extra row supplies the last row's previous tip");
    assert.equal(page.body.hasMore, true);

    const branch = await reflog({ ref: "refs/heads/main" });
    assert.equal(branch.status, 200);
    assert.equal(branch.body.entries[0].selector, "main@{0}");

    // A recovered commit stops being lost once a branch points at it.
    git(repoPath, "branch", "rescue", c3);
    const recovered = await reflog({});
    assert.equal(recovered.body.lostCount, 0);

    assert.equal((await reflog({ ref: "refs/heads/missing" })).status, 404);
    assert.equal((await reflog({ ref: "main" })).status, 400, "short names are rejected");
    assert.equal((await reflog({ ref: "refs/tags/v1" })).status, 400);
    assert.equal((await reflog({ ref: "refs/stash" })).status, 400);
    assert.equal((await reflog({ ref: "ORIG_HEAD" })).status, 400);
    assert.equal((await reflog({ limit: "0" })).status, 400);

    // A public symref must not walk the log of what it points at.
    git(repoPath, "symbolic-ref", "refs/heads/alias", "refs/heads/main");
    assert.equal((await reflog({ ref: "refs/heads/alias" })).status, 404);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("explorer routes are reachable over HTTP", async () => {
  const repoPath = tempRepo();
  try {
    write(repoPath, "a.txt", "hello\n");
    const head = commit(repoPath, "init");
    const config = makeConfig(repoPath);
    const handler = createRequestHandler(config, createGitService(config));
    const tree = await call(handler, `/api/repos/demo/tree?commit=${head}`);
    assert.equal(tree.status, 200);
    assert.equal(tree.body.entries[0].name, "a.txt");
    const paths = await call(handler, `/api/repos/demo/tree/paths?commit=${head}`);
    assert.deepEqual(paths.body.paths, ["a.txt"]);
    const search = await call(handler, `/api/repos/demo/code-search?commit=${head}&q=hello`);
    assert.equal(search.body.matches.length, 1);
    const reflog = await call(handler, "/api/repos/demo/reflog?ref=HEAD");
    assert.equal(reflog.body.entries.length, 1);
    assert.equal((await call(handler, "/api/repos/nope/reflog")).status, 404);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ─── Fixtures ───────────────────────────────────────────────────────────────

function tempRepo() {
  const repoPath = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "refscope-explorer-")));
  git(repoPath, "init", "-q", "-b", "main");
  git(repoPath, "config", "user.name", "Refscope Test");
  git(repoPath, "config", "user.email", "refscope@example.test");
  git(repoPath, "config", "core.logAllRefUpdates", "true");
  return repoPath;
}

function write(repoPath, rel, content) {
  const target = path.join(repoPath, rel);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

function commit(repoPath, message) {
  git(repoPath, "add", "-A");
  git(repoPath, "commit", "-q", "-m", message);
  return git(repoPath, "rev-parse", "HEAD").trim();
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  return result.stdout;
}

function makeConfig(repoPath) {
  return {
    repositories: new Map([["demo", { id: "demo", name: "demo", path: repoPath }]]),
    gitTimeoutMs: 10_000,
    diffMaxBytes: 4_000_000,
    refPollMs: 1000,
    allowedOrigins: new Set(),
    enforceLoopbackHost: false,
  };
}

function setup(repoPath) {
  const config = makeConfig(repoPath);
  return { service: createGitService(config), repo: config.repositories.get("demo") };
}

async function call(handler, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    let status = 0;
    let body = "";
    const res = {
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return headers[name.toLowerCase()];
      },
      writeHead(code, extra) {
        status = code;
        Object.assign(headers, extra ?? {});
      },
      end(chunk) {
        if (chunk) body += chunk;
        try {
          resolve({ status, body: body ? JSON.parse(body) : null });
        } catch (error) {
          reject(error);
        }
      },
      write(chunk) {
        body += chunk;
      },
    };
    const req = { method: "GET", url, headers: { host: "127.0.0.1:4175" }, on() {} };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}
