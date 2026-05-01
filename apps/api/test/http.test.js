import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import { createRequestHandler } from "../src/http.js";

test("returns a public 400 error for malformed percent-encoded paths", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      listRepositories() {
        throw new Error("repository lookup should not run");
      },
    },
  );
  const response = createMockResponse();

  await handler(
    createMockRequest({
      method: "GET",
      url: "/api/repos/%E0%A4%A/refs",
    }),
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.equal(response.headers["content-type"], "application/json; charset=utf-8");
  assert.deepEqual(JSON.parse(response.body), { error: "Invalid request path" });
});

test("routes commits summary to the git service before generic /commits/:hash", async () => {
  let summarizeCalls = 0;
  let getCommitCalls = 0;
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      getRepository(repoId) {
        return { id: repoId, name: repoId, path: "/tmp/repo" };
      },
      async summarizeCommits(repo, query) {
        summarizeCalls += 1;
        assert.equal(repo.id, "demo");
        assert.equal(query.get("groupBy"), "prefix");
        assert.equal(query.get("since"), "2024-01-01");
        return {
          status: 200,
          body: {
            period: { since: "2024-01-01", until: null, tz: "UTC" },
            ref: { input: "HEAD", resolved: "a".repeat(40) },
            observed: { totalCommits: 0, totalAdded: 0, totalDeleted: 0, authorsCount: 0 },
            groups: [],
            uncategorized: { kind: "prefix", commitHashes: [], commitCount: 0 },
            truncated: false,
          },
        };
      },
      async getCommit() {
        getCommitCalls += 1;
        return { status: 200, body: {} };
      },
    },
  );
  const response = createMockResponse();

  await handler(
    createMockRequest({
      method: "GET",
      url: "/api/repos/demo/commits/summary?since=2024-01-01&groupBy=prefix",
    }),
    response,
  );

  assert.equal(summarizeCalls, 1);
  assert.equal(getCommitCalls, 0, "summary path must not be matched as /commits/:hash");
  assert.equal(response.statusCode, 200);
  const body = JSON.parse(response.body);
  assert.equal(body.period.tz, "UTC");
});

test("returns 400 when the summary git service rejects a query parameter", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      getRepository(repoId) {
        return { id: repoId, name: repoId, path: "/tmp/repo" };
      },
      async summarizeCommits() {
        return { status: 400, body: { error: "Invalid groupBy parameter" } };
      },
    },
  );
  const response = createMockResponse();

  await handler(
    createMockRequest({
      method: "GET",
      url: "/api/repos/demo/commits/summary?groupBy=scope",
    }),
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "Invalid groupBy parameter" });
});

test("returns 404 when the repo allowlist does not contain the requested id", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      getRepository() {
        return undefined;
      },
      async summarizeCommits() {
        throw new Error("summarizeCommits should not be invoked for unknown repos");
      },
    },
  );
  const response = createMockResponse();

  await handler(
    createMockRequest({
      method: "GET",
      url: "/api/repos/unknown/commits/summary",
    }),
    response,
  );

  assert.equal(response.statusCode, 404);
  assert.deepEqual(JSON.parse(response.body), { error: "Repository is not allowlisted" });
});

test("rejects an invalid repo id before reaching the summary git service", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      getRepository() {
        throw new Error("invalid repo id should be rejected upstream");
      },
      async summarizeCommits() {
        throw new Error("summarizeCommits should not be invoked for invalid ids");
      },
    },
  );
  const response = createMockResponse();

  await handler(
    createMockRequest({
      method: "GET",
      url: "/api/repos/inv@lid/commits/summary",
    }),
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "Invalid repository id" });
});

test("routes compare requests to the git service", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      getRepository(repoId) {
        return { id: repoId, name: repoId, path: "/tmp/repo" };
      },
      async compareRefs(repo, query) {
        assert.equal(repo.id, "demo");
        assert.equal(query.get("base"), "main");
        assert.equal(query.get("target"), "feature");
        return { status: 200, body: { base: "main", target: "feature", ahead: 1, behind: 0 } };
      },
    },
  );
  const response = createMockResponse();

  await handler(
    createMockRequest({
      method: "GET",
      url: "/api/repos/demo/compare?base=main&target=feature",
    }),
    response,
  );

  assert.equal(response.statusCode, 200);
  assert.deepEqual(JSON.parse(response.body), {
    base: "main",
    target: "feature",
    ahead: 1,
    behind: 0,
  });
});

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
