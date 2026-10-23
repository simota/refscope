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

test("returns a public 400 error for a malformed request-target on GET", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      listRepositories() {
        throw new Error("repository lookup should not run");
      },
    },
  );
  const response = createMockResponse();

  // `//a:b` is a protocol-relative target with an invalid authority — the URL
  // constructor throws a TypeError synchronously. Must answer 400, not crash.
  await handler(
    createMockRequest({
      method: "GET",
      url: "//a:b",
    }),
    response,
  );

  assert.equal(response.statusCode, 400);
  assert.deepEqual(JSON.parse(response.body), { error: "Invalid request path" });
});

test("returns a public 400 error for a malformed request-target on POST and DELETE", async () => {
  for (const method of ["POST", "DELETE"]) {
    const handler = createRequestHandler(
      { allowedOrigins: new Set() },
      {
        addRepository() {
          throw new Error("addRepository should not run");
        },
        removeRepository() {
          throw new Error("removeRepository should not run");
        },
      },
    );
    const response = createMockResponse();

    await handler(
      createMockRequest({
        method,
        url: "//a:b",
      }),
      response,
    );

    assert.equal(response.statusCode, 400, `${method} //a:b must return 400`);
    assert.deepEqual(JSON.parse(response.body), { error: "Invalid request path" });
  }
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

test("rejects requests whose Host header is not loopback (DNS rebinding guard)", async () => {
  let called = false;
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      listRepositories() {
        called = true;
        return [];
      },
    },
  );

  for (const method of ["GET", "OPTIONS", "POST", "DELETE"]) {
    const response = createMockResponse();
    await handler(
      createMockRequest({
        method,
        url: method === "DELETE" ? "/api/repos/demo" : "/api/repos",
        headers: { host: "attacker.example:4175", origin: "http://attacker.example:4175" },
      }),
      response,
    );
    assert.equal(response.statusCode, 403, method);
    assert.deepEqual(JSON.parse(response.body), { error: "Host not allowed" });
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  }
  assert.equal(called, false);
});

test("accepts loopback Host headers", async () => {
  const handler = createRequestHandler({ allowedOrigins: new Set() }, {});
  for (const host of ["localhost", "127.0.0.1:4175", "localhost:4175", "[::1]:4175"]) {
    const response = createMockResponse();
    await handler(createMockRequest({ method: "GET", url: "/health", headers: { host } }), response);
    assert.equal(response.statusCode, 200, host);
  }
});

test("skips the Host guard when the server is deliberately bound publicly", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set(), enforceLoopbackHost: false },
    {},
  );
  const response = createMockResponse();
  await handler(
    createMockRequest({ method: "GET", url: "/health", headers: { host: "192.168.1.5:4175" } }),
    response,
  );
  assert.equal(response.statusCode, 200);
});

test("does not grant CORS to cross-origin readers outside the allowlist", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set() },
    {
      listRepositories() {
        return [];
      },
    },
  );
  const response = createMockResponse();
  await handler(
    createMockRequest({
      method: "GET",
      url: "/api/repos",
      headers: { host: "127.0.0.1:4175", origin: "https://evil.example" },
    }),
    response,
  );
  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["access-control-allow-origin"], undefined);
});

test("accepts same-origin mutations without an explicit origin allowlist entry", async () => {
  const handler = createRequestHandler({ allowedOrigins: new Set() }, {});

  const sameOriginRequest = createMockRequest({
    method: "POST",
    url: "/api/repos",
    headers: { host: "127.0.0.1:4175", origin: "http://127.0.0.1:4175" },
  });
  const sameOrigin = createMockResponse();
  const pending = handler(sameOriginRequest, sameOrigin);
  process.nextTick(() => sameOriginRequest.emit("end"));
  await pending;
  // Past the origin gate the handler parses the body; the empty body is
  // rejected as invalid JSON (400), proving the 403 gate was passed.
  assert.equal(sameOrigin.statusCode, 400);
  assert.deepEqual(JSON.parse(sameOrigin.body), { error: "Invalid JSON body" });

  // A different loopback origin (other port or hostname) is still cross-origin.
  const crossOrigin = createMockResponse();
  await handler(
    createMockRequest({
      method: "POST",
      url: "/api/repos",
      headers: { host: "127.0.0.1:4175", origin: "http://localhost:4175" },
    }),
    crossOrigin,
  );
  assert.equal(crossOrigin.statusCode, 403);
  assert.deepEqual(JSON.parse(crossOrigin.body), { error: "Origin not allowed" });
});

test("does not trust Host-derived same-origin when the Host guard is off", async () => {
  const handler = createRequestHandler(
    { allowedOrigins: new Set(), enforceLoopbackHost: false },
    {},
  );
  const response = createMockResponse();
  await handler(
    createMockRequest({
      method: "POST",
      url: "/api/repos",
      headers: { host: "rebound.example:4175", origin: "http://rebound.example:4175" },
    }),
    response,
  );
  assert.equal(response.statusCode, 403);
  assert.deepEqual(JSON.parse(response.body), { error: "Origin not allowed" });
});

test("event stream stops polling once its repository is removed from the allowlist", async (t) => {
  t.mock.timers.enable({ apis: ["setInterval"] });
  const repo = { id: "demo", name: "demo", path: "/tmp/not-needed" };
  const repositories = new Map([["demo", repo]]);
  let polls = 0;
  const handler = createRequestHandler(
    { allowedOrigins: new Set(), refPollMs: 1000 },
    {
      getRepository: (id) => repositories.get(id),
      getRefSnapshot: async () => new Map(),
      collectRefEvents: async (_repo, snapshot) => {
        polls += 1;
        return { snapshot, events: [] };
      },
    },
  );
  const response = createMockResponse();
  let ended = false;
  response.on = () => {};
  response.end = () => {
    ended = true;
  };

  await handler(createMockRequest({ method: "GET", url: "/api/repos/demo/events" }), response);
  assert.equal(response.statusCode, 200);
  t.mock.timers.tick(1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(polls, 1);

  repositories.delete("demo");
  t.mock.timers.tick(1000);
  t.mock.timers.tick(1000);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(polls, 1);
  assert.equal(ended, true);
});

function createMockRequest({ method, url, headers = { host: "localhost" } }) {
  const request = new EventEmitter();
  request.method = method;
  request.url = url;
  request.headers = headers;
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
