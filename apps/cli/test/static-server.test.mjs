import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

import { createStaticHandler } from "../src/static-server.mjs";

let root;
let server;
let baseUrl;

// A request the handler never answers must fail the test, not hang it.
const get = (target) => fetch(`${baseUrl}${target}`, { signal: AbortSignal.timeout(2000) });

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "refscope-static-"));
  fs.writeFileSync(path.join(root, "index.html"), "<!doctype html>index");
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "app.js"), "console.log(1)");
  server = http.createServer(createStaticHandler(root));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(root, { recursive: true, force: true });
});

test("serves files under the root and falls back to index.html", async () => {
  const asset = await get("/assets/app.js");
  assert.equal(asset.status, 200);
  assert.equal(await asset.text(), "console.log(1)");

  const spa = await get("/some/client/route");
  assert.equal(spa.status, 200);
  assert.equal(await spa.text(), "<!doctype html>index");
});

test("rejects a NUL byte in the path instead of crashing the process", async () => {
  for (const target of ["/%00", "/a%00b", "/assets/app.js%00.html"]) {
    const response = await get(target);
    assert.equal(response.status, 400, target);
  }
  // The server must still answer after the malformed requests.
  const response = await get("/");
  assert.equal(response.status, 200);
});

test("rejects traversal outside the root", async () => {
  const response = await new Promise((resolve, reject) => {
    // An encoded slash survives URL normalisation, so `..` only appears
    // after decoding.
    const req = http.request(`${baseUrl}/..%2F..%2F..%2Fetc%2Fpasswd`, resolve);
    req.on("error", reject);
    req.end();
  });
  response.resume();
  assert.equal(response.statusCode, 400);
});

test("forbids framing the UI from other origins", async () => {
  for (const target of ["/", "/assets/app.js"]) {
    const response = await get(target);
    assert.equal(response.headers.get("x-frame-options"), "DENY", target);
    assert.equal(response.headers.get("content-security-policy"), "frame-ancestors 'none'", target);
  }
});
