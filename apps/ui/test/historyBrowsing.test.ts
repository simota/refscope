import assert from "node:assert/strict";
import test from "node:test";

import {
  appendOlderPage,
  buildDeepLinkSearch,
  localDateToIsoBound,
  mergeLiveFirstPage,
  pageMayHaveMore,
  parseDeepLink,
} from "../src/app/lib/historyBrowsing.ts";

const c = (hash: string) => ({ hash });
const hashes = (list: Array<{ hash: string }>) => list.map((item) => item.hash);

test("appendOlderPage drops rows a shifted offset repeated", () => {
  const current = [c("e"), c("d"), c("c")];
  assert.deepEqual(hashes(appendOlderPage(current, [c("c"), c("b"), c("a")])), ["e", "d", "c", "b", "a"]);
  assert.deepEqual(hashes(appendOlderPage(current, [])), ["e", "d", "c"]);
  assert.deepEqual(hashes(appendOlderPage([], [c("x"), c("x")])), ["x"]);
});

test("mergeLiveFirstPage keeps loaded older pages when the new first page connects", () => {
  // 3-row pages; user loaded 6 rows, then one commit landed on top.
  const loaded = [c("f"), c("e"), c("d"), c("c"), c("b"), c("a")];
  const fresh = [c("g"), c("f"), c("e")];
  const merged = mergeLiveFirstPage(fresh, loaded, 3);
  assert.equal(merged.reset, false);
  assert.deepEqual(hashes(merged.commits), ["g", "f", "e", "d", "c", "b", "a"]);
});

test("mergeLiveFirstPage resets when there is no overlap or nothing older was loaded", () => {
  const loaded = [c("f"), c("e"), c("d"), c("c")];
  // Rewritten history: fresh page shares nothing with the loaded rows.
  assert.deepEqual(mergeLiveFirstPage([c("x"), c("y"), c("z")], loaded, 3), {
    commits: [c("x"), c("y"), c("z")],
    reset: true,
  });
  // Only one page was loaded: the fresh page simply replaces it.
  assert.equal(mergeLiveFirstPage([c("g"), c("f"), c("e")], [c("f"), c("e"), c("d")], 3).reset, true);
  // A short page is the whole history.
  assert.deepEqual(hashes(mergeLiveFirstPage([c("g")], loaded, 3).commits), ["g"]);
});

test("pageMayHaveMore is true only for a full page", () => {
  assert.equal(pageMayHaveMore(100, 100), true);
  assert.equal(pageMayHaveMore(99, 100), false);
  assert.equal(pageMayHaveMore(0, 100), false);
});

test("localDateToIsoBound spans the whole local day and rejects bad input", () => {
  const start = localDateToIsoBound("2024-03-10", "start");
  const end = localDateToIsoBound("2024-03-10", "end");
  assert.match(start, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(new Date(start).getTime(), new Date(2024, 2, 10, 0, 0, 0, 0).getTime());
  assert.equal(new Date(end).getTime(), new Date(2024, 2, 10, 23, 59, 59, 999).getTime());
  for (const bad of ["", "2024-02-30", "2024-13-01", "24-01-01", "yesterday", "1800-01-01"]) {
    assert.equal(localDateToIsoBound(bad, "start"), "", bad);
  }
});

test("deep links round-trip and keep unrelated parameters", () => {
  const hash = "a".repeat(40);
  const search = buildDeepLinkSearch("?fleet=1", { repo: "viewer", ref: "refs/heads/main", commit: hash, path: "src/app" });
  const params = new URLSearchParams(search);
  assert.equal(params.get("fleet"), "1");
  assert.deepEqual(parseDeepLink(search), { repo: "viewer", ref: "refs/heads/main", commit: hash, path: "src/app" });

  // HEAD and empty values are omitted; clearing removes stale params.
  assert.equal(buildDeepLinkSearch(search, { repo: "viewer", ref: "HEAD", commit: "", path: "" }), "?fleet=1&repo=viewer");
  assert.equal(buildDeepLinkSearch("?commit=" + hash, { repo: "", ref: "HEAD", commit: "", path: "" }), "");
});

test("parseDeepLink drops malformed values", () => {
  assert.equal(parseDeepLink("?commit=HEAD").commit, "");
  assert.equal(parseDeepLink("?commit=abc123").commit, "");
  assert.equal(parseDeepLink(`?commit=${"B".repeat(40)}`).commit, "b".repeat(40));
  assert.equal(parseDeepLink("?repo=a%0Ab").repo, "");
  assert.equal(parseDeepLink(`?path=${"x".repeat(300)}`).path, "");
  assert.deepEqual(parseDeepLink(""), { repo: "", ref: "", commit: "", path: "" });
});
