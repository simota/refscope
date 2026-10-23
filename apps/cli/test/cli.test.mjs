import assert from "node:assert/strict";
import { test } from "node:test";

import { displayHost } from "../src/cli.mjs";

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
