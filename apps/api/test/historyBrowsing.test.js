// History browsing: commit-list pagination / date window, and the
// file-at-revision content endpoint.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  FILE_CONTENT_MAX_BYTES,
  commitListLogArgs,
  createGitService,
} from "../src/gitService.js";
import { SKIP_QUERY_MAX, parseSkipQuery } from "../src/validation.js";
import { createRequestHandler } from "../src/http.js";

const REV = "1111111111111111111111111111111111111111";

test("parseSkipQuery accepts canonical non-negative integers only", () => {
  assert.deepEqual(parseSkipQuery(undefined), { ok: true, value: 0 });
  assert.deepEqual(parseSkipQuery(""), { ok: true, value: 0 });
  assert.deepEqual(parseSkipQuery("0"), { ok: true, value: 0 });
  assert.deepEqual(parseSkipQuery("150"), { ok: true, value: 150 });
  assert.deepEqual(parseSkipQuery(String(SKIP_QUERY_MAX)), { ok: true, value: SKIP_QUERY_MAX });
  for (const bad of ["01", "-1", "+1", "1e3", "1.5", " 1", "abc", String(SKIP_QUERY_MAX + 1), "99999999"]) {
    assert.equal(parseSkipQuery(bad).ok, false, `expected ${JSON.stringify(bad)} to be rejected`);
  }
});

test("commitListLogArgs places skip/since/until before the option terminator", () => {
  const args = commitListLogArgs(50, [], [], REV, [], {
    skip: 100,
    since: "2024-01-01",
    until: "2024-02-01T00:00:00Z",
  });
  const end = args.indexOf("--end-of-options");
  for (const flag of ["--skip=100", "--since=2024-01-01", "--until=2024-02-01T00:00:00Z"]) {
    const at = args.indexOf(flag);
    assert.ok(at > 0 && at < end, `${flag} must precede --end-of-options`);
  }
  assert.equal(args[end + 1], REV);

  // Backwards compatible: no window → no extra flags.
  const plain = commitListLogArgs(50, [], [], REV, []);
  assert.ok(!plain.some((arg) => /^--(skip|since|until)=/.test(arg)));
  assert.ok(!commitListLogArgs(50, [], [], REV, [], { skip: 0 }).some((a) => a.startsWith("--skip")));
});

test("listCommits pages through history with skip and filters by date window", async () => {
  const repoPath = createTempPath("refscope-history-");
  try {
    initRepo(repoPath);
    for (let i = 1; i <= 7; i += 1) {
      commitAt(repoPath, "log.txt", `line ${i}\n`, `chore: commit ${i}`, `2024-01-0${i}T12:00:00Z`);
    }
    const service = makeService();
    const repo = { id: "demo", name: "demo", path: repoPath };

    const page1 = await service.listCommits(repo, new URLSearchParams({ limit: "3" }));
    const page2 = await service.listCommits(repo, new URLSearchParams({ limit: "3", skip: "3" }));
    const page3 = await service.listCommits(repo, new URLSearchParams({ limit: "3", skip: "6" }));
    assert.equal(page1.status, 200);
    assert.deepEqual(page1.body.map((c) => c.subject), ["chore: commit 7", "chore: commit 6", "chore: commit 5"]);
    assert.deepEqual(page2.body.map((c) => c.subject), ["chore: commit 4", "chore: commit 3", "chore: commit 2"]);
    assert.deepEqual(page3.body.map((c) => c.subject), ["chore: commit 1"]);

    const beyond = await service.listCommits(repo, new URLSearchParams({ skip: "50" }));
    assert.equal(beyond.status, 200);
    assert.deepEqual(beyond.body, []);

    const windowed = await service.listCommits(
      repo,
      new URLSearchParams({ since: "2024-01-03T00:00:00Z", until: "2024-01-05T23:59:59Z" }),
    );
    assert.equal(windowed.status, 200);
    assert.deepEqual(windowed.body.map((c) => c.subject), ["chore: commit 5", "chore: commit 4", "chore: commit 3"]);

    for (const [name, value] of [["skip", "-1"], ["since", "yesterday"], ["until", "2024-1-1"]]) {
      const bad = await service.listCommits(repo, new URLSearchParams({ [name]: value }));
      assert.equal(bad.status, 400, `${name}=${value}`);
      assert.equal(bad.body.error, `Invalid ${name} parameter`);
    }
    const dup = new URLSearchParams([["skip", "1"], ["skip", "2"]]);
    assert.equal((await service.listCommits(repo, dup)).status, 400);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getFileContent returns a file as it was at a commit", async () => {
  const repoPath = createTempPath("refscope-content-");
  try {
    initRepo(repoPath);
    const first = commitAt(repoPath, "src/app.js", "const a = 1;\nconst b = 2;\n", "feat: add app", "2024-01-01T00:00:00Z");
    const second = commitAt(repoPath, "src/app.js", "const a = 10;\n", "fix: tweak", "2024-01-02T00:00:00Z");
    fs.writeFileSync(path.join(repoPath, "bin.dat"), Buffer.from([0x89, 0x50, 0x00, 0x01]));
    fs.writeFileSync(path.join(repoPath, "no-eol.txt"), "one\ntwo");
    git(repoPath, "add", ".");
    git(repoPath, "commit", "-q", "-m", "chore: assets");
    const third = git(repoPath, "rev-parse", "HEAD").trim();

    const service = makeService();
    const repo = { id: "demo", name: "demo", path: repoPath };
    const read = (params) => service.getFileContent(repo, new URLSearchParams(params));

    const before = await read({ commit: first, path: "src/app.js" });
    assert.equal(before.status, 200);
    assert.equal(before.body.content, "const a = 1;\nconst b = 2;\n");
    assert.equal(before.body.lineCount, 2);
    assert.equal(before.body.binary, false);
    assert.equal(before.body.truncated, false);
    assert.equal(before.body.commit, first);
    assert.match(before.body.objectId, /^[0-9a-f]{40}$/);

    const after = await read({ commit: second, path: "src/app.js" });
    assert.equal(after.status, 200);
    assert.equal(after.body.content, "const a = 10;\n");
    assert.equal((await read({ commit: second.slice(0, 12), path: "src/app.js" })).status, 400, "abbreviated hashes are rejected");

    const noEol = await read({ commit: third, path: "no-eol.txt" });
    assert.equal(noEol.body.lineCount, 2);

    const binary = await read({ commit: third, path: "bin.dat" });
    assert.equal(binary.status, 200);
    assert.equal(binary.body.binary, true);
    assert.equal(binary.body.content, null);
    assert.equal(binary.body.size, 4);

    assert.equal((await read({ commit: first, path: "no-eol.txt" })).status, 404);
    assert.equal((await read({ commit: third, path: "src" })).status, 400);
    assert.equal((await read({ commit: third, path: "../etc/passwd" })).status, 400);
    assert.equal((await read({ commit: third, path: "-p" })).status, 400);
    assert.equal((await read({ commit: third })).status, 400);
    assert.equal((await read({ commit: "HEAD", path: "src/app.js" })).status, 400);
    assert.equal((await read({ commit: "f".repeat(40), path: "src/app.js" })).status, 404);
    const blobId = before.body.objectId;
    assert.equal((await read({ commit: blobId, path: "src/app.js" })).status, 400, "a non-commit object is rejected");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("getFileContent truncates oversized files at a line boundary", async () => {
  const repoPath = createTempPath("refscope-content-big-");
  try {
    initRepo(repoPath);
    const line = "x".repeat(99) + "\n";
    const lines = Math.ceil(FILE_CONTENT_MAX_BYTES / line.length) + 10;
    const head = commitAt(repoPath, "big.txt", line.repeat(lines), "feat: big", "2024-01-01T00:00:00Z");
    const result = await makeService().getFileContent(
      { id: "demo", name: "demo", path: repoPath },
      new URLSearchParams({ commit: head, path: "big.txt" }),
    );
    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, true);
    assert.equal(result.body.size, line.length * lines);
    assert.ok(result.body.content.length <= FILE_CONTENT_MAX_BYTES);
    assert.ok(result.body.content.endsWith("\n"));
    assert.equal(result.body.content.length % line.length, 0);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

test("GET /api/repos/:id/files/content is routed to getFileContent", async () => {
  const calls = [];
  const handler = createRequestHandler(
    { repositories: new Map([["demo", "/tmp/demo"]]), allowedOrigins: new Set(), host: "127.0.0.1", port: 4175 },
    {
      getRepository: (id) => (id === "demo" ? { id, name: id, path: "/tmp/demo" } : null),
      getFileContent: async (_repo, query) => {
        calls.push(query.get("path"));
        return { status: 200, body: { ok: true } };
      },
    },
  );
  const res = await invoke(handler, "/api/repos/demo/files/content?commit=" + REV + "&path=a.txt");
  assert.equal(res.status, 200, res.body);
  assert.deepEqual(calls, ["a.txt"]);
});

function makeService() {
  return createGitService({ repositories: new Map(), gitTimeoutMs: 5000, diffMaxBytes: 65_536 });
}

function invoke(handler, url) {
  return new Promise((resolve, reject) => {
    const headers = {};
    const req = { method: "GET", url, headers: { host: "127.0.0.1:4175" }, on() {}, socket: {} };
    const res = {
      statusCode: 200,
      setHeader(name, value) {
        headers[name.toLowerCase()] = value;
      },
      getHeader(name) {
        return headers[name.toLowerCase()];
      },
      writeHead(status, extra = {}) {
        this.statusCode = status;
        Object.assign(headers, extra);
        return this;
      },
      end(body = "") {
        resolve({ status: this.statusCode, headers, body: String(body) });
      },
      write() {
        return true;
      },
      on() {},
      once() {},
    };
    Promise.resolve(handler(req, res)).catch(reject);
  });
}

function git(cwd, ...args) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: process.env });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function gitWithDate(cwd, date, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date },
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function createTempPath(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function initRepo(repoPath) {
  git(repoPath, "init", "-q", "-b", "main");
  git(repoPath, "config", "user.name", "Alice");
  git(repoPath, "config", "user.email", "alice@example.test");
  git(repoPath, "config", "commit.gpgsign", "false");
}

function commitAt(repoPath, relPath, content, message, date) {
  const target = path.join(repoPath, relPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
  git(repoPath, "add", relPath);
  gitWithDate(repoPath, date, "commit", "-q", "-m", message);
  return git(repoPath, "rev-parse", "HEAD").trim();
}
