/**
 * fleet-snapshot.test.js
 *
 * Integration-level tests for:
 *   - GET /api/fleet/snapshot (http.js route)
 *   - createFleetService (fleetService.js orchestrator)
 *   - per-repo 5s timeout + Promise.allSettled partial response
 *   - estimatedCost 6N formula (Option A subset, proposal §4.1.6)
 *   - notes.untrackedExcluded + notes.sseAvailable assertions
 *   - fleet-response.schema.json structural validation (reuses fleet-schema.test.js validator)
 *
 * Test structure follows fileHistory.test.js / http.test.js conventions:
 *   - node:test + node:assert/strict
 *   - createMockRequest / createMockResponse for HTTP-layer tests
 *   - real temp-git-repos for integration tests
 */

import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { createFleetService } from "../src/fleetService.js";
import { createRequestHandler } from "../src/http.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ─── Schema validator (reused from fleet-schema.test.js) ─────────────────────

const SCHEMA_PATH = path.resolve(__dirname, "../schemas/fleet-response.schema.json");
const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, "utf-8"));

/**
 * Lightweight structural JSON Schema checker (same implementation as
 * fleet-schema.test.js — kept inline so this test file is self-contained).
 *
 * @param {unknown} data
 * @param {object} nodeSchema
 * @param {string} [pointer]
 * @returns {string|null}
 */
function validate(data, nodeSchema, pointer = "") {
  if (nodeSchema.const !== undefined) {
    return data !== nodeSchema.const
      ? `${pointer}: expected const ${JSON.stringify(nodeSchema.const)}, got ${JSON.stringify(data)}`
      : null;
  }
  if (nodeSchema.enum !== undefined) {
    return !nodeSchema.enum.includes(data)
      ? `${pointer}: ${JSON.stringify(data)} not in enum ${JSON.stringify(nodeSchema.enum)}`
      : null;
  }
  if (nodeSchema.type !== undefined) {
    const types = Array.isArray(nodeSchema.type) ? nodeSchema.type : [nodeSchema.type];
    let typeMatch = false;
    if (data === null && types.includes("null")) typeMatch = true;
    else if (Array.isArray(data) && types.includes("array")) typeMatch = true;
    else if (typeof data === "number" && Number.isInteger(data) && types.includes("integer")) typeMatch = true;
    else if (typeof data === "number" && types.includes("number")) typeMatch = true;
    else if (!Array.isArray(data) && data !== null && types.includes(typeof data)) typeMatch = true;
    if (!typeMatch) {
      const jsType = data === null ? "null" : Array.isArray(data) ? "array" : typeof data;
      return `${pointer}: expected type ${JSON.stringify(nodeSchema.type)}, got ${jsType}`;
    }
  }
  if (Array.isArray(data)) {
    if (nodeSchema.items) {
      for (let i = 0; i < data.length; i++) {
        const err = validate(data[i], nodeSchema.items, `${pointer}/${i}`);
        if (err) return err;
      }
    }
    return null;
  }
  if (typeof data === "object" && data !== null) {
    if (nodeSchema.required) {
      for (const key of nodeSchema.required) {
        if (!(key in data)) return `${pointer}: missing required field '${key}'`;
      }
    }
    if (nodeSchema.additionalProperties === false && nodeSchema.properties) {
      const allowed = new Set(Object.keys(nodeSchema.properties));
      for (const key of Object.keys(data)) {
        if (!allowed.has(key)) return `${pointer}: additional property '${key}' is not allowed`;
      }
    }
    if (nodeSchema.properties) {
      for (const [key, subSchema] of Object.entries(nodeSchema.properties)) {
        if (key in data) {
          const err = validate(data[key], subSchema, `${pointer}/${key}`);
          if (err) return err;
        }
      }
    }
  }
  return null;
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

function createMockRequest({ method, url }) {
  const request = new EventEmitter();
  request.method = method;
  request.url = url;
  request.headers = { host: "localhost" };
  return request;
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

function git(cwd, ...args) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, `git ${args.join(" ")} failed: ${result.stderr || result.stdout}`);
  return result.stdout;
}

function createTempPath(prefix) {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function initRepo(repoPath, userName = "Tester", userEmail = "test@example.test") {
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

/**
 * Build a minimal gitService stub that delegates fleet helpers to real
 * implementations from gitService.js.
 */
async function realGitService(repoPath) {
  const { getHeadShortSha, getCommits24hCount, getWorktreeDirtyBoolean } =
    await import("../src/gitService.js");
  return { getHeadShortSha, getCommits24hCount, getWorktreeDirtyBoolean };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

// Test 1: happy path — 1 repo, response passes schema validation
test("happy path: 1 repo snapshot passes fleet-response schema", async () => {
  const repoPath = createTempPath("rtgv-fleet-happy-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "hello\n", "chore: seed");

    const svc = await realGitService(repoPath);
    const config = {
      repositories: new Map([["svc1", { id: "svc1", name: "svc1", path: repoPath }]]),
    };
    const fleetSvc = createFleetService(config, svc);
    const snapshot = await fleetSvc.getFleetSnapshot({});

    const schemaErr = validate(snapshot, schema);
    assert.equal(schemaErr, null, `schema validation failed: ${schemaErr}`);

    assert.equal(snapshot.version, 1);
    assert.equal(snapshot.window, "24h");
    assert.equal(snapshot.repos.length, 1);
    assert.equal(snapshot.repos[0].repoId, "svc1");
    assert.equal(snapshot.repos[0].status, "ok");
    assert.match(snapshot.repos[0].headShortSha, /^[a-f0-9]{7,40}$/);
    assert.equal(typeof snapshot.repos[0].commits24h, "number");
    assert.ok(snapshot.repos[0].commits24h >= 0);
    // refMove1h is null in Option A subset (no SSE)
    assert.equal(snapshot.repos[0].refMove1h, null);
    // lastEventAt is null in Option A subset (no in-memory SSE state)
    assert.equal(snapshot.repos[0].lastEventAt, null);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// Test 2: per-repo timeout — gitService mock sleeps 6s, status must be 'timeout'
test("per-repo timeout: slow git call yields status=timeout and null fields", async () => {
  const config = {
    repositories: new Map([["slow-repo", { id: "slow-repo", name: "slow-repo", path: "/tmp/fake-slow-repo" }]]),
  };

  // Mock gitService: getHeadShortSha takes 6s (exceeds 5s fleet timeout)
  const slowGitService = {
    getHeadShortSha: () => new Promise((resolve) => setTimeout(() => resolve("aabbccd"), 6000)),
    getCommits24hCount: () => new Promise((resolve) => setTimeout(() => resolve(0), 6000)),
    getWorktreeDirtyBoolean: () => new Promise((resolve) => setTimeout(() => resolve(false), 6000)),
  };

  // Patch statSync so the path appears to exist
  const origStatSync = fs.statSync;
  fs.statSync = (p) => {
    if (p === "/tmp/fake-slow-repo") return { isDirectory: () => true };
    return origStatSync(p);
  };

  try {
    const fleetSvc = createFleetService(config, slowGitService);
    const start = Date.now();
    const snapshot = await fleetSvc.getFleetSnapshot({});
    const elapsed = Date.now() - start;

    assert.equal(snapshot.repos.length, 1);
    assert.equal(snapshot.repos[0].status, "timeout");
    assert.equal(snapshot.repos[0].headShortSha, null);
    assert.equal(snapshot.repos[0].commits24h, null);
    assert.equal(snapshot.repos[0].worktreeDirty, null);
    assert.equal(snapshot.repos[0].refMove1h, null);
    assert.equal(snapshot.repos[0].lastEventAt, null);
    // Must not have waited 6s — per-repo timeout is 5s
    assert.ok(elapsed < 5800, `expected timeout before 6s, got ${elapsed}ms`);
  } finally {
    fs.statSync = origStatSync;
  }
});

// Test 3: partial response — 2 repos, 1 fails, both appear in repos[]
test("partial response: 2 repos, 1 success 1 failure, both in response", async () => {
  const repoPath = createTempPath("rtgv-fleet-partial-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "README.md", "x\n", "chore: seed");

    const config = {
      repositories: new Map([
        ["ok-repo", { id: "ok-repo", name: "ok-repo", path: repoPath }],
        ["bad-repo", { id: "bad-repo", name: "bad-repo", path: "/nonexistent-path-xyz" }],
      ]),
    };

    const svc = await realGitService(repoPath);
    const fleetSvc = createFleetService(config, svc);
    const snapshot = await fleetSvc.getFleetSnapshot({});

    assert.equal(snapshot.repos.length, 2);

    const okEntry = snapshot.repos.find((r) => r.repoId === "ok-repo");
    const badEntry = snapshot.repos.find((r) => r.repoId === "bad-repo");

    assert.ok(okEntry, "ok-repo must appear in response");
    assert.ok(badEntry, "bad-repo must appear in response");

    assert.equal(okEntry.status, "ok");
    assert.match(okEntry.headShortSha, /^[a-f0-9]{7,40}$/);

    // /nonexistent-path-xyz does not exist → 'missing'
    assert.equal(badEntry.status, "missing");
    assert.equal(badEntry.headShortSha, null);
    assert.equal(badEntry.commits24h, null);
    assert.equal(badEntry.worktreeDirty, null);
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// Test 4: include filter — ?include=svc1,svc2 restricts to 2 repos
test("include filter: ?include= restricts the repos observed", async () => {
  const repo1 = createTempPath("rtgv-fleet-inc1-");
  const repo2 = createTempPath("rtgv-fleet-inc2-");
  const repo3 = createTempPath("rtgv-fleet-inc3-");
  try {
    for (const rp of [repo1, repo2, repo3]) {
      initRepo(rp);
      writeAndCommit(rp, "a.txt", "x\n", "chore: seed");
    }

    const config = {
      repositories: new Map([
        ["svc1", { id: "svc1", name: "svc1", path: repo1 }],
        ["svc2", { id: "svc2", name: "svc2", path: repo2 }],
        ["svc3", { id: "svc3", name: "svc3", path: repo3 }],
      ]),
    };

    const svc = await realGitService(repo1);
    const fleetSvc = createFleetService(config, svc);
    const snapshot = await fleetSvc.getFleetSnapshot({ include: ["svc1", "svc2"] });

    assert.equal(snapshot.repos.length, 2);
    const ids = snapshot.repos.map((r) => r.repoId).sort();
    assert.deepEqual(ids, ["svc1", "svc2"]);
    assert.equal(snapshot.estimatedCost.subscribedRepoCount, 2);
  } finally {
    for (const rp of [repo1, repo2, repo3]) {
      fs.rmSync(rp, { recursive: true, force: true });
    }
  }
});

// Test 5: invalid query — ?window=12h returns 400 from HTTP route
test("invalid query: ?window=12h returns 400", async () => {
  const config = {
    allowedOrigins: new Set(),
    repositories: new Map(),
  };
  const fleetSvc = { getFleetSnapshot: async () => ({ never: true }) };
  const handler = createRequestHandler(config, { listRepositories: () => [] }, fleetSvc);
  const response = createMockResponse();

  await handler(
    createMockRequest({ method: "GET", url: "/api/fleet/snapshot?window=12h" }),
    response,
  );

  assert.equal(response.statusCode, 400);
  const body = JSON.parse(response.body);
  assert.ok(body.error, "error field must be present");
  assert.match(body.error, /window/i);
});

// Test 6: estimatedCost.gitCallsPerMin === 6 * subscribedRepoCount
test("estimatedCost: gitCallsPerMin equals 6 * subscribedRepoCount (Option A formula)", async () => {
  const repo1 = createTempPath("rtgv-fleet-cost1-");
  const repo2 = createTempPath("rtgv-fleet-cost2-");
  const repo3 = createTempPath("rtgv-fleet-cost3-");
  try {
    for (const rp of [repo1, repo2, repo3]) {
      initRepo(rp);
      writeAndCommit(rp, "a.txt", "y\n", "chore: seed");
    }

    const config = {
      repositories: new Map([
        ["r1", { id: "r1", name: "r1", path: repo1 }],
        ["r2", { id: "r2", name: "r2", path: repo2 }],
        ["r3", { id: "r3", name: "r3", path: repo3 }],
      ]),
    };

    const svc = await realGitService(repo1);
    const fleetSvc = createFleetService(config, svc);
    const snapshot = await fleetSvc.getFleetSnapshot({});

    const N = snapshot.estimatedCost.subscribedRepoCount;
    assert.equal(N, 3);
    assert.equal(snapshot.estimatedCost.gitCallsPerMin, 6 * N,
      `expected 6*N=${6 * N}, got ${snapshot.estimatedCost.gitCallsPerMin}`);
    assert.equal(snapshot.estimatedCost.snapshotIntervalMs, 30000);
  } finally {
    for (const rp of [repo1, repo2, repo3]) {
      fs.rmSync(rp, { recursive: true, force: true });
    }
  }
});

// Test 7: notes — untrackedExcluded: true, sseAvailable: false
test("notes: untrackedExcluded=true and sseAvailable=false in Option A subset", async () => {
  const repoPath = createTempPath("rtgv-fleet-notes-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "x.txt", "v\n", "chore: seed");

    const config = {
      repositories: new Map([["repo1", { id: "repo1", name: "repo1", path: repoPath }]]),
    };
    const svc = await realGitService(repoPath);
    const fleetSvc = createFleetService(config, svc);
    const snapshot = await fleetSvc.getFleetSnapshot({});

    assert.equal(snapshot.notes.untrackedExcluded, true,
      "Option A subset must report untrackedExcluded: true (diff-only, no ls-files)");
    assert.equal(snapshot.notes.sseAvailable, false,
      "Option A subset must report sseAvailable: false (SSE wired in v1)");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});

// Test 8: HTTP route happy path — 200 + JSON response structure
test("HTTP route: GET /api/fleet/snapshot returns 200 with correct structure", async () => {
  const repoPath = createTempPath("rtgv-fleet-http-");
  try {
    initRepo(repoPath);
    writeAndCommit(repoPath, "f.txt", "z\n", "chore: seed");

    const config = {
      allowedOrigins: new Set(),
      repositories: new Map([["demo", { id: "demo", name: "demo", path: repoPath }]]),
    };

    const svc = await realGitService(repoPath);
    const fleetSvc = createFleetService(config, svc);
    const handler = createRequestHandler(config, { listRepositories: () => [] }, fleetSvc);
    const response = createMockResponse();

    await handler(
      createMockRequest({ method: "GET", url: "/api/fleet/snapshot" }),
      response,
    );

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
    const body = JSON.parse(response.body);
    const schemaErr = validate(body, schema);
    assert.equal(schemaErr, null, `schema validation failed: ${schemaErr}`);
    assert.equal(body.repos.length, 1);
    assert.equal(body.repos[0].repoId, "demo");
    assert.equal(body.repos[0].status, "ok");
  } finally {
    fs.rmSync(repoPath, { recursive: true, force: true });
  }
});
