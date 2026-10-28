import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { displayHost, validateRepoPath } from "../src/cli.mjs";

test("displayHost turns the bind address into a host usable in a URL", () => {
  assert.equal(displayHost("127.0.0.1"), "127.0.0.1");
  assert.equal(displayHost("localhost"), "localhost");
  assert.equal(displayHost("0.0.0.0"), "127.0.0.1");
  assert.equal(displayHost("::1"), "[::1]");
  assert.equal(displayHost("::"), "[::1]");
  assert.equal(displayHost("[::1]"), "[::1]");
  for (const host of ["127.0.0.1", "::1", "::", "0.0.0.0"]) {
    assert.doesNotThrow(() => new URL(`http://${displayHost(host)}:4175`), host);
  }
});

test("validateRepoPath refuses paths RTGV_REPOS cannot carry", () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), "refscope-cli-"));
  try {
    for (const name of ["repo,x", "repo ", "repo\t"]) {
      const repoPath = path.join(parent, name);
      fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
      const result = validateRepoPath(repoPath);
      assert.equal(result.ok, false, JSON.stringify(name));
      assert.match(result.error, /comma or end with whitespace/);
    }
    // Inner whitespace survives the trim of the whole absolute path.
    for (const name of ["repo", " repo", "my repo"]) {
      const repoPath = path.join(parent, name);
      fs.mkdirSync(path.join(repoPath, ".git"), { recursive: true });
      assert.deepEqual(validateRepoPath(repoPath), { ok: true, canonicalPath: fs.realpathSync(repoPath) });
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true, maxRetries: 10 });
  }
});
