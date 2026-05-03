/**
 * repos-mutation.test.js
 *
 * HTTP-layer tests for:
 *   - POST /api/repos  (add a repository at runtime)
 *   - DELETE /api/repos/:id  (remove a user-managed repository)
 *   - CORS preflight for the mutation paths
 *   - GET /api/repos   (verify origin field is present in list)
 *
 * Uses createMockRequest / createMockResponse (same pattern as http.test.js) so
 * no real HTTP server is needed. Temp git repos are created via spawnSync git init.
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createRequestHandler } from "../src/http.js";

// ─── Test helpers ────────────────────────────────────────────────────────────

function createMockRequest({ method, url, origin, body }) {
  const emitter = new EventEmitter();
  emitter.method = method;
  emitter.url = url;
  emitter.headers = { host: "localhost" };
  if (origin !== undefined) {
    emitter.headers.origin = origin;
  }
  emitter._body = body ?? "";
  return emitter;
}

function createMockResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    setHeader(name, value) {
      this.headers[name.toLowerCase()] = value;
    },
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      for (const [name, value] of Object.entries(headers)) {
        this.setHeader(name, value);
      }
    },
    write(chunk) {
      this.body += chunk;
    },
    end(chunk = "") {
      this.body += chunk;
    },
  };
}

/**
 * Issue a mock request and drive its data/end events so readRequestBody resolves.
 * Returns the response object after the handler completes.
 */
async function sendRequest(handler, { method, url, origin, body = "" }) {
  const req = createMockRequest({ method, url, origin, body });
  const res = createMockResponse();
  const pending = handler(req, res);
  // Drive the readable stream so readRequestBody resolves
  process.nextTick(() => {
    if (body) req.emit("data", Buffer.from(body));
    req.emit("end");
  });
  await pending;
  return res;
}

/**
 * Create a temp directory containing a real git repository.
 * Returns { repoPath, cleanup }.
 */
function makeTempGitRepo(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `refscope-test-${name}-`));
  const result = spawnSync("git", ["init", dir], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git init failed: ${result.stderr}`);
  }
  return {
    repoPath: fs.realpathSync(dir),
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/**
 * Create a temp directory that is NOT a git repo.
 */
function makeTempPlainDir(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `refscope-test-${name}-`));
  return {
    dirPath: dir,
    cleanup() {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

const ALLOWED_ORIGIN = "http://localhost:5173";
const DISALLOWED_ORIGIN = "http://evil.example.com";

// ─── POST /api/repos — happy path ────────────────────────────────────────────

test("POST /api/repos returns 200 with repository schema on happy path", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-happy");
  try {
    let addCalled = false;
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      {
        addRepository(id, normalizedPath) {
          addCalled = true;
          assert.equal(id, "svc1");
          assert.equal(normalizedPath, repoPath);
          return { id: "svc1", name: path.basename(repoPath), path: normalizedPath, origin: "ui", addedAt: new Date().toISOString() };
        },
      },
    );

    const body = JSON.stringify({ id: "svc1", path: repoPath });
    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: ALLOWED_ORIGIN,
      body,
    });

    assert.equal(res.statusCode, 200);
    assert.equal(res.headers["content-type"], "application/json; charset=utf-8");
    const parsed = JSON.parse(res.body);
    assert.ok("repository" in parsed, "response must contain repository field");
    assert.equal(parsed.repository.id, "svc1");
    assert.equal(parsed.repository.origin, "ui");
    assert.ok(typeof parsed.repository.addedAt === "string", "addedAt must be string");
    assert.ok(addCalled, "gitService.addRepository must have been called");
  } finally {
    cleanup();
  }
});

// ─── POST /api/repos — id duplicate (409) ────────────────────────────────────

test("POST /api/repos returns 409 when id already exists", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-dup-id");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      {
        addRepository() {
          throw new Error("Repository id already exists: svc1");
        },
      },
    );

    const body = JSON.stringify({ id: "svc1", path: repoPath });
    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: ALLOWED_ORIGIN,
      body,
    });

    assert.equal(res.statusCode, 409);
    assert.deepEqual(JSON.parse(res.body), { error: "Repository id already exists" });
  } finally {
    cleanup();
  }
});

// ─── POST /api/repos — realPath duplicate (409) ──────────────────────────────

test("POST /api/repos returns 409 when path is already registered", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-dup-path");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      {
        addRepository() {
          throw new Error(`Repository path already registered as existing-id: ${repoPath}`);
        },
      },
    );

    const body = JSON.stringify({ id: "svc2", path: repoPath });
    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: ALLOWED_ORIGIN,
      body,
    });

    assert.equal(res.statusCode, 409);
    const parsed = JSON.parse(res.body);
    assert.ok(
      parsed.error.includes("already registered"),
      `expected 'already registered' in error: ${parsed.error}`,
    );
  } finally {
    cleanup();
  }
});

// ─── POST /api/repos — relative path (400) ────────────────────────────────────

test("POST /api/repos returns 400 for relative path", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    { addRepository() { throw new Error("should not reach"); } },
  );

  const res = await sendRequest(handler, {
    method: "POST",
    url: "/api/repos",
    origin: ALLOWED_ORIGIN,
    body: JSON.stringify({ id: "svc1", path: "relative/path" }),
  });

  assert.equal(res.statusCode, 400);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.error, "must have error field");
});

// ─── POST /api/repos — non-existent path (400) ───────────────────────────────

test("POST /api/repos returns 400 for non-existent path", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    { addRepository() { throw new Error("should not reach"); } },
  );

  const res = await sendRequest(handler, {
    method: "POST",
    url: "/api/repos",
    origin: ALLOWED_ORIGIN,
    body: JSON.stringify({ id: "svc1", path: "/this/path/does/not/exist" }),
  });

  assert.equal(res.statusCode, 400);
});

// ─── POST /api/repos — non-git directory (400) ───────────────────────────────

test("POST /api/repos returns 400 for path that is not a git working tree", async () => {
  const { dirPath, cleanup } = makeTempPlainDir("post-nogit");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      { addRepository() { throw new Error("should not reach"); } },
    );

    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: ALLOWED_ORIGIN,
      body: JSON.stringify({ id: "svc1", path: dirPath }),
    });

    assert.equal(res.statusCode, 400);
    const parsed = JSON.parse(res.body);
    assert.ok(
      parsed.error.includes("Git working tree"),
      `expected 'Git working tree' in error: ${parsed.error}`,
    );
  } finally {
    cleanup();
  }
});

// ─── POST /api/repos — allowlist at capacity (400) ───────────────────────────

test("POST /api/repos returns 400 when allowlist is at maximum capacity", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-maxcap");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      {
        addRepository() {
          throw new Error("Cannot add repository: allowlist is at the maximum of 32 entries");
        },
      },
    );

    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: ALLOWED_ORIGIN,
      body: JSON.stringify({ id: "svc1", path: repoPath }),
    });

    assert.equal(res.statusCode, 400);
    const parsed = JSON.parse(res.body);
    assert.ok(
      parsed.error.includes("max 32") || parsed.error.includes("full"),
      `expected capacity error: ${parsed.error}`,
    );
  } finally {
    cleanup();
  }
});

// ─── POST /api/repos — body too large (400) ──────────────────────────────────

test("POST /api/repos returns 400 when body exceeds 4 KB", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    { addRepository() { throw new Error("should not reach"); } },
  );

  // Build a body > 4096 bytes by padding the id value
  const largeBody = JSON.stringify({ id: "a".repeat(5000), path: "/tmp" });

  const req = createMockRequest({ method: "POST", url: "/api/repos", origin: ALLOWED_ORIGIN });
  const res = createMockResponse();
  const pending = handler(req, res);
  // Send data in a single chunk that exceeds the limit
  process.nextTick(() => {
    req.emit("data", Buffer.from(largeBody));
    req.emit("end");
  });
  await pending;

  assert.equal(res.statusCode, 400);
  const parsed = JSON.parse(res.body);
  assert.ok(
    parsed.error.includes("too large") || parsed.error.includes("Invalid"),
    `expected too-large error: ${parsed.error}`,
  );
});

// ─── POST /api/repos — unknown field in body (400) ───────────────────────────

test("POST /api/repos returns 400 for body with unknown field", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-unknownfield");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      { addRepository() { throw new Error("should not reach"); } },
    );

    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: ALLOWED_ORIGIN,
      body: JSON.stringify({ id: "svc1", path: repoPath, extra: "bad" }),
    });

    assert.equal(res.statusCode, 400);
    const parsed = JSON.parse(res.body);
    assert.ok(
      parsed.error.toLowerCase().includes("unexpected") ||
        parsed.error.toLowerCase().includes("field"),
      `expected unexpected-field error: ${parsed.error}`,
    );
  } finally {
    cleanup();
  }
});

// ─── POST /api/repos — missing required fields (400) ─────────────────────────

test("POST /api/repos returns 400 when path field is missing", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    { addRepository() { throw new Error("should not reach"); } },
  );

  const res = await sendRequest(handler, {
    method: "POST",
    url: "/api/repos",
    origin: ALLOWED_ORIGIN,
    body: JSON.stringify({ id: "svc1" }),
  });

  assert.equal(res.statusCode, 400);
});

test("POST /api/repos returns 400 when id field is missing", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-missing-id");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      { addRepository() { throw new Error("should not reach"); } },
    );

    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: ALLOWED_ORIGIN,
      body: JSON.stringify({ path: repoPath }),
    });

    assert.equal(res.statusCode, 400);
  } finally {
    cleanup();
  }
});

// ─── POST /api/repos — type mismatch (400) ───────────────────────────────────

test("POST /api/repos returns 400 when id is not a string", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    { addRepository() { throw new Error("should not reach"); } },
  );

  const res = await sendRequest(handler, {
    method: "POST",
    url: "/api/repos",
    origin: ALLOWED_ORIGIN,
    body: JSON.stringify({ id: 123, path: "/tmp/some-repo" }),
  });

  assert.equal(res.statusCode, 400);
  const parsed = JSON.parse(res.body);
  assert.ok(parsed.error.includes("id"), `expected field error about id: ${parsed.error}`);
});

// ─── POST /api/repos — CSRF checks ───────────────────────────────────────────

test("POST /api/repos returns 403 when Origin header is absent", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-csrf-noorigin");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      { addRepository() { throw new Error("should not reach"); } },
    );

    // No origin field → omit it
    const req = createMockRequest({ method: "POST", url: "/api/repos" });
    const res = createMockResponse();
    const pending = handler(req, res);
    process.nextTick(() => {
      req.emit("data", Buffer.from(JSON.stringify({ id: "svc1", path: repoPath })));
      req.emit("end");
    });
    await pending;

    assert.equal(res.statusCode, 403);
    assert.deepEqual(JSON.parse(res.body), { error: "Missing Origin header" });
  } finally {
    cleanup();
  }
});

test("POST /api/repos returns 403 when Origin is not in allowlist", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-csrf-bad");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
      { addRepository() { throw new Error("should not reach"); } },
    );

    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: DISALLOWED_ORIGIN,
      body: JSON.stringify({ id: "svc1", path: repoPath }),
    });

    assert.equal(res.statusCode, 403);
    assert.deepEqual(JSON.parse(res.body), { error: "Origin not allowed" });
  } finally {
    cleanup();
  }
});

test("POST /api/repos proceeds when allowedOrigins is wildcard *", async () => {
  const { repoPath, cleanup } = makeTempGitRepo("post-csrf-wildcard");
  try {
    const handler = createRequestHandler(
      { allowedOrigins: "*", refPollMs: 2000 },
      {
        addRepository(id, normalizedPath) {
          return { id, name: "repo", path: normalizedPath, origin: "ui", addedAt: new Date().toISOString() };
        },
      },
    );

    const res = await sendRequest(handler, {
      method: "POST",
      url: "/api/repos",
      origin: DISALLOWED_ORIGIN,
      body: JSON.stringify({ id: "svc1", path: repoPath }),
    });

    assert.equal(res.statusCode, 200);
  } finally {
    cleanup();
  }
});

// ─── DELETE /api/repos/:id — happy path (204) ────────────────────────────────

test("DELETE /api/repos/:id returns 204 on successful removal", async () => {
  let removeCalled = false;
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    {
      removeRepository(id) {
        removeCalled = true;
        assert.equal(id, "svc1");
      },
    },
  );

  const req = createMockRequest({ method: "DELETE", url: "/api/repos/svc1", origin: ALLOWED_ORIGIN });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 204);
  assert.equal(res.body, "");
  assert.ok(removeCalled, "removeRepository must have been called");
});

// ─── DELETE /api/repos/:id — not found (404) ─────────────────────────────────

test("DELETE /api/repos/:id returns 404 when repository does not exist", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    {
      removeRepository() {
        throw new Error("Repository not found: unknown-repo");
      },
    },
  );

  const req = createMockRequest({ method: "DELETE", url: "/api/repos/unknown-repo", origin: ALLOWED_ORIGIN });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 404);
  assert.deepEqual(JSON.parse(res.body), { error: "Repository not found" });
});

// ─── DELETE /api/repos/:id — env-origin reject (400) ─────────────────────────

test("DELETE /api/repos/:id returns 400 for env-origin repository", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    {
      removeRepository() {
        throw new Error("Cannot remove env-origin repository: env-repo");
      },
    },
  );

  const req = createMockRequest({ method: "DELETE", url: "/api/repos/env-repo", origin: ALLOWED_ORIGIN });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 400);
  const parsed = JSON.parse(res.body);
  assert.ok(
    parsed.error.includes("RTGV_REPOS"),
    `expected RTGV_REPOS in error: ${parsed.error}`,
  );
});

// ─── DELETE /api/repos/:id — invalid id (400) ────────────────────────────────

test("DELETE /api/repos/:id returns 400 for invalid repository id format", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    {
      removeRepository() {
        throw new Error("should not reach");
      },
    },
  );

  // URL-encoded space in id — decodePathParts will decode to "with spaces"
  const req = createMockRequest({
    method: "DELETE",
    url: "/api/repos/with%20spaces",
    origin: ALLOWED_ORIGIN,
  });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(JSON.parse(res.body), { error: "Invalid repository id" });
});

// ─── DELETE /api/repos/:id — CSRF checks ─────────────────────────────────────

test("DELETE /api/repos/:id returns 403 when Origin header is absent", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    { removeRepository() { throw new Error("should not reach"); } },
  );

  // No origin
  const req = createMockRequest({ method: "DELETE", url: "/api/repos/svc1" });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(JSON.parse(res.body), { error: "Missing Origin header" });
});

test("DELETE /api/repos/:id returns 403 when Origin is not in allowlist", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    { removeRepository() { throw new Error("should not reach"); } },
  );

  const req = createMockRequest({
    method: "DELETE",
    url: "/api/repos/svc1",
    origin: DISALLOWED_ORIGIN,
  });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 403);
  assert.deepEqual(JSON.parse(res.body), { error: "Origin not allowed" });
});

// ─── CORS preflight ───────────────────────────────────────────────────────────

test("OPTIONS /api/repos returns 204 with CORS headers", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    {},
  );

  const req = createMockRequest({ method: "OPTIONS", url: "/api/repos", origin: ALLOWED_ORIGIN });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 204);
  assert.ok(
    res.headers["access-control-allow-methods"]?.includes("POST"),
    "preflight must include POST in allowed methods",
  );
  assert.ok(
    res.headers["access-control-allow-methods"]?.includes("DELETE"),
    "preflight must include DELETE in allowed methods",
  );
});

test("OPTIONS /api/repos/:id returns 204 with CORS headers", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set([ALLOWED_ORIGIN]), refPollMs: 2000 },
    {},
  );

  const req = createMockRequest({ method: "OPTIONS", url: "/api/repos/svc1", origin: ALLOWED_ORIGIN });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 204);
  assert.ok(
    res.headers["access-control-allow-methods"]?.includes("DELETE"),
    "preflight for /:id must include DELETE",
  );
});

// ─── GET /api/repos — origin field in list ───────────────────────────────────

test("GET /api/repos includes origin field set to env for env-origin entries", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set(), refPollMs: 2000 },
    {
      listRepositories() {
        return [{ id: "env-repo", name: "env-repo", origin: "env" }];
      },
    },
  );

  const req = createMockRequest({ method: "GET", url: "/api/repos" });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  assert.ok(Array.isArray(parsed.repositories), "must have repositories array");
  const repo = parsed.repositories[0];
  assert.equal(repo.origin, "env");
});

test("GET /api/repos includes origin field set to ui for ui-origin entries", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set(), refPollMs: 2000 },
    {
      listRepositories() {
        return [{ id: "ui-repo", name: "ui-repo", origin: "ui" }];
      },
    },
  );

  const req = createMockRequest({ method: "GET", url: "/api/repos" });
  const res = createMockResponse();
  await handler(req, res);

  assert.equal(res.statusCode, 200);
  const parsed = JSON.parse(res.body);
  const repo = parsed.repositories[0];
  assert.equal(repo.origin, "ui");
});
