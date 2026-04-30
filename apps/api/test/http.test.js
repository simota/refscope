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
