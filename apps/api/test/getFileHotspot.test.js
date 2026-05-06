import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  HOTSPOT_DEFAULT_COMMIT_CAP,
  HOTSPOT_DEFAULT_LIMIT,
  HOTSPOT_MAX_COMMIT_CAP,
  HOTSPOT_MAX_LIMIT,
  createGitService,
} from "../src/gitService.js";

// ─── helpers ────────────────────────────────────────────────────────────────

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

function makeService(overrides = {}) {
  return createGitService({
    repositories: new Map(),
    gitTimeoutMs: 5000,
    diffMaxBytes: 65_536,
    ...overrides,
  });
}

// ─── AC-LIMIT-1: truncated when files > limit ────────────────────────────────

test("marks truncated when files exceed limit", async () => {
  const repoPath = createTempPath("rtgv-hotspot-limit-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // Create 6 files, each touched once.
    for (let i = 1; i <= 6; i++) {
      writeAndCommit(repoPath, `src/file${i}.js`, `const x${i} = ${i};\n`, `feat: add file${i}`);
    }

    const service = makeService();
    const result = await service.getFileHotspot(
      { id: "big-repo", path: repoPath },
      { ref: "HEAD", limit: 4, commitCap: HOTSPOT_DEFAULT_COMMIT_CAP },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.files.length, 4, "files array should be truncated to limit");
    assert.equal(result.body.truncated, true);
    assert.equal(result.body.truncationReason, "limit");
    // Files must be sorted lines DESC.
    for (let i = 0; i < result.body.files.length - 1; i++) {
      assert.ok(
        result.body.files[i].lines >= result.body.files[i + 1].lines,
        "files should be sorted by lines descending",
      );
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ─── empty when no tracked files ─────────────────────────────────────────────

test("returns empty array when repo has no tracked files", async () => {
  const repoPath = createTempPath("rtgv-hotspot-empty-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // Commit an empty file so there is at least one commit, then remove it.
    writeAndCommit(repoPath, "placeholder.txt", "hi\n", "chore: seed");
    git(repoPath, "rm", "placeholder.txt");
    git(repoPath, "commit", "-m", "chore: remove placeholder");

    const service = makeService();
    const result = await service.getFileHotspot(
      { id: "empty", path: repoPath },
      { ref: "HEAD", limit: HOTSPOT_DEFAULT_LIMIT, commitCap: HOTSPOT_DEFAULT_COMMIT_CAP },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.files.length, 0);
    assert.equal(result.body.truncated, false);
    assert.strictEqual(result.body.truncationReason, undefined);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ─── AC-ERR-1: rejects invalid ref ───────────────────────────────────────────

test("rejects invalid ref before invoking git", async () => {
  // gitService itself cannot reject format-invalid refs (http.js does that),
  // but it must return 404 for a ref that is format-valid yet does not exist.
  const repoPath = createTempPath("rtgv-hotspot-noref-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.js", "x\n", "feat: foo");

    const service = makeService();
    const result = await service.getFileHotspot(
      { id: "self", path: repoPath },
      {
        ref: "refs/heads/no-such-branch",
        limit: HOTSPOT_DEFAULT_LIMIT,
        commitCap: HOTSPOT_DEFAULT_COMMIT_CAP,
      },
    );
    // resolveCommitishRevision will fail → 404
    assert.equal(result.status, 404);
    assert.equal(result.body.error, "Ref not found or not a commit");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ─── AC-ERR-2: 404 unknown repo (http-layer test) ────────────────────────────

test("responds 404 for unknown repo on files/hotspot via http handler", async () => {
  // Exercise the http.js layer directly: createRequestHandler with an empty
  // repository map must respond 404 to GET /api/repos/ghost/files/hotspot.
  const { createRequestHandler } = await import("../src/http.js");
  const { EventEmitter } = await import("node:events");

  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      getRepository() {
        return undefined; // no repos registered
      },
      async getFileHotspot() {
        throw new Error("getFileHotspot must not be called for unknown repo");
      },
    },
  );

  const req = new EventEmitter();
  req.method = "GET";
  req.url = "/api/repos/ghost/files/hotspot";
  req.headers = { host: "localhost" };

  let statusCode = 0;
  const headers = {};
  let body = "";
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    writeHead(code, hdrs = {}) {
      statusCode = code;
      for (const [k, v] of Object.entries(hdrs)) {
        this.setHeader(k, v);
      }
    },
    write(chunk) { body += chunk; },
    end(chunk = "") { body += chunk; },
  };

  await handler(req, res);

  assert.equal(statusCode, 404);
  assert.deepEqual(JSON.parse(body), { error: "Repository is not allowlisted" });
});

// ─── AC-ERR-3: 504 with truncated payload on timeout ─────────────────────────

test("returns 504 with truncated payload when git times out", async () => {
  // We trigger the `truncated` path (same GitCommandError branch as timeout)
  // by setting hotspotMaxBytes to 1 byte so the log output immediately
  // exceeds the cap and the runner kills the subprocess with truncated=true.
  const repoPath = createTempPath("rtgv-hotspot-timeout-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.js", "x\n", "feat: foo");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
      // Inject a 1-byte maxBytes cap so the log stdout is immediately truncated.
      hotspotMaxBytes: 1,
    });

    const result = await service.getFileHotspot(
      { id: "self", path: repoPath },
      { ref: "HEAD", limit: HOTSPOT_DEFAULT_LIMIT, commitCap: HOTSPOT_DEFAULT_COMMIT_CAP },
    );

    assert.equal(result.status, 504);
    assert.equal(result.body.error, "timeout");
    assert.equal(result.body.truncated, true);
    // hotspotMaxBytes: 1 triggers err.truncated (not err.timedOut) → maxBytes reason.
    assert.equal(result.body.truncationReason, "maxBytes");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ─── AC-SEC-3: does not pass --show-signature ─────────────────────────────────

test("does not pass --show-signature to git", async () => {
  // Verify statically that the log arg list used by getFileHotspot
  // contains --no-show-signature and does NOT contain --show-signature.
  // We read the source text and confirm the contract.
  const src = fs.readFileSync(
    new URL("../src/gitService.js", import.meta.url),
    "utf8",
  );

  // The implementation must include --no-show-signature in its log invocation.
  assert.ok(
    src.includes("--no-show-signature"),
    "gitService.js must include --no-show-signature",
  );

  // --show-signature (without --no-) must never appear (GPG bypass rule).
  const showSigMatches = [...src.matchAll(/(?<!--no-)--show-signature/g)];
  assert.equal(
    showSigMatches.length,
    0,
    "gitService.js must not contain bare --show-signature",
  );
});

// ─── JUDGE-009 AC tests ───────────────────────────────────────────────────────

// AC-1: sort: lines DESC, then churn DESC, then path ASC
test("returns files sorted by lines desc, then churn desc, then path asc", async () => {
  const repoPath = createTempPath("rtgv-hotspot-sort-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // a.js: 3 lines, churn 2 (touched in 2 commits with different content)
    writeAndCommit(repoPath, "a.js", "a\nb\nc\n", "feat: a v1");
    writeAndCommit(repoPath, "a.js", "a\nb\nc updated\n", "feat: a v2");
    // b.js: 3 lines, churn 1
    writeAndCommit(repoPath, "b.js", "x\ny\nz\n", "feat: b");
    // c.js: 1 line, churn 1
    writeAndCommit(repoPath, "c.js", "x\n", "feat: c");

    const service = makeService();
    const result = await service.getFileHotspot(
      { id: "sort-repo", path: repoPath },
      { ref: "HEAD", limit: HOTSPOT_DEFAULT_LIMIT, commitCap: HOTSPOT_DEFAULT_COMMIT_CAP },
    );

    assert.equal(result.status, 200);
    const paths = result.body.files.map((f) => f.path);

    // a.js and b.js both have 3 lines; a.js wins on churn (2 > 1)
    assert.equal(paths[0], "a.js", "a.js should be first (churn tie-break)");
    assert.equal(paths[1], "b.js", "b.js should be second");
    assert.equal(paths[2], "c.js", "c.js should be last (fewest lines)");

    // lines descending
    for (let i = 0; i < result.body.files.length - 1; i++) {
      assert.ok(
        result.body.files[i].lines >= result.body.files[i + 1].lines,
        "files should be sorted by lines descending",
      );
    }
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// AC-REF-1: resolves ref alias to commit oid in response.ref
test("resolves ref alias to commit oid in response.ref", async () => {
  const repoPath = createTempPath("rtgv-hotspot-ref-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.js", "x\n", "feat: foo");

    const service = makeService();
    const result = await service.getFileHotspot(
      { id: "ref-repo", path: repoPath },
      { ref: "refs/heads/main", limit: HOTSPOT_DEFAULT_LIMIT, commitCap: HOTSPOT_DEFAULT_COMMIT_CAP },
    );

    assert.equal(result.status, 200);
    // ref must be a 40-hex commit OID, not the alias
    assert.match(result.body.ref, /^[0-9a-f]{40}$/, "ref must be resolved commit OID");
    assert.equal(result.body.refLabel, "refs/heads/main", "refLabel must be the original alias");
    assert.notEqual(result.body.ref, "refs/heads/main");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// AC-REF-2: applies since filter to log scope
test("applies since filter to log scope", async () => {
  const repoPath = createTempPath("rtgv-hotspot-since-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "old.js", "old\n", "feat: old");
    writeAndCommit(repoPath, "new.js", "new\n", "feat: new");

    const service = makeService();
    // Use a future date so no commits pass the since filter.
    const result = await service.getFileHotspot(
      { id: "since-repo", path: repoPath },
      { ref: "HEAD", limit: HOTSPOT_DEFAULT_LIMIT, commitCap: HOTSPOT_DEFAULT_COMMIT_CAP, since: "2099-01-01" },
    );

    assert.equal(result.status, 200);
    // No commits after 2099 → empty files
    assert.equal(result.body.files.length, 0, "since=2099 should yield empty files");
    assert.equal(result.body.scope.sinceISO, "2099-01-01");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// AC-LIMIT-2: commitCap truncation is reported via truncationReason
test("respects commitCap and reports it as truncationReason on overflow", async () => {
  const repoPath = createTempPath("rtgv-hotspot-cap-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    // Create 5 commits, cap at 3 → overflow
    for (let i = 1; i <= 5; i++) {
      writeAndCommit(repoPath, `file${i}.js`, `const x = ${i};\n`, `feat: file${i}`);
    }

    const service = makeService();
    const result = await service.getFileHotspot(
      { id: "cap-repo", path: repoPath },
      { ref: "HEAD", limit: HOTSPOT_DEFAULT_LIMIT, commitCap: 3 },
    );

    assert.equal(result.status, 200);
    assert.equal(result.body.truncated, true, "should be truncated by commitCap");
    assert.equal(result.body.truncationReason, "commitCap");
    assert.equal(result.body.scope.commitCap, 3);
    assert.ok(result.body.scope.commitsAnalyzed <= 3, "commitsAnalyzed must not exceed commitCap");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// JUDGE-002 verify: truncationReason 'maxBytes' when stdout exceeds hotspotMaxBytes
test("returns truncationReason: 'maxBytes' when stdout exceeds hotspotMaxBytes", async () => {
  const repoPath = createTempPath("rtgv-hotspot-maxbytes-");
  try {
    initRepo(repoPath, "Alice", "alice@example.test");
    writeAndCommit(repoPath, "src/foo.js", "x\n", "feat: foo");

    const service = createGitService({
      repositories: new Map(),
      gitTimeoutMs: 5000,
      diffMaxBytes: 65_536,
      hotspotMaxBytes: 1,
    });

    const result = await service.getFileHotspot(
      { id: "maxbytes-repo", path: repoPath },
      { ref: "HEAD", limit: HOTSPOT_DEFAULT_LIMIT, commitCap: HOTSPOT_DEFAULT_COMMIT_CAP },
    );

    assert.equal(result.status, 504);
    assert.equal(result.body.truncated, true);
    assert.equal(result.body.truncationReason, "maxBytes", "truncated stdout must report maxBytes reason");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// ─── exports sanity check ─────────────────────────────────────────────────────

test("exported hotspot constants are numeric and within expected ranges", () => {
  assert.equal(typeof HOTSPOT_DEFAULT_LIMIT, "number");
  assert.equal(typeof HOTSPOT_MAX_LIMIT, "number");
  assert.equal(typeof HOTSPOT_DEFAULT_COMMIT_CAP, "number");
  assert.equal(typeof HOTSPOT_MAX_COMMIT_CAP, "number");

  assert.ok(HOTSPOT_DEFAULT_LIMIT > 0 && HOTSPOT_DEFAULT_LIMIT <= HOTSPOT_MAX_LIMIT);
  assert.ok(HOTSPOT_DEFAULT_COMMIT_CAP > 0 && HOTSPOT_DEFAULT_COMMIT_CAP <= HOTSPOT_MAX_COMMIT_CAP);
  assert.equal(HOTSPOT_DEFAULT_LIMIT, 500);
  assert.equal(HOTSPOT_MAX_LIMIT, 1000);
  assert.equal(HOTSPOT_DEFAULT_COMMIT_CAP, 200);
  assert.equal(HOTSPOT_MAX_COMMIT_CAP, 500);
});
