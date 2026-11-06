import assert from "node:assert/strict";
import test from "node:test";

import {
  filterLostEntries,
  formatBytes,
  groupMatchesByFile,
  highlightMatchRanges,
  parentDirectory,
  pathBreadcrumbs,
  rankPaths,
  reflogRescueBranchName,
  reflogRescueCommands,
  shellQuote,
} from "../src/app/lib/repoExplorer.ts";

const PATHS = [
  "apps/api/src/gitService.js",
  "apps/api/src/gitRunner.js",
  "apps/api/test/gitService.test.js",
  "apps/ui/src/app/App.tsx",
  "README.md",
  "docs/spec-v0.md",
];

test("rankPaths prefers file-name matches and exact names", () => {
  const ranked = rankPaths(PATHS, "gitservice");
  assert.equal(ranked[0].path, "apps/api/src/gitService.js");
  assert.ok(ranked.some((r) => r.path === "apps/api/test/gitService.test.js"));
  assert.equal(rankPaths(PATHS, "readme.md")[0].path, "README.md");
});

test("rankPaths supports subsequences and multi-term queries", () => {
  assert.equal(rankPaths(PATHS, "grun")[0].path, "apps/api/src/gitRunner.js");
  const both = rankPaths(PATHS, "test service");
  assert.deepEqual(both.map((r) => r.path), ["apps/api/test/gitService.test.js"]);
  assert.deepEqual(rankPaths(PATHS, "zzz"), []);
  assert.deepEqual(rankPaths(PATHS, "   "), []);
  assert.equal(rankPaths(PATHS, "s", 2).length, 2);
});

test("rankPaths reports matched character positions", () => {
  const [top] = rankPaths(["src/app.ts"], "app");
  assert.deepEqual(top.positions, [4, 5, 6]);
});

test("path helpers", () => {
  assert.deepEqual(pathBreadcrumbs(""), []);
  assert.deepEqual(pathBreadcrumbs("a/b"), [
    { name: "a", path: "a" },
    { name: "b", path: "a/b" },
  ]);
  assert.equal(parentDirectory("a/b/c.txt"), "a/b");
  assert.equal(parentDirectory("c.txt"), "");
  assert.equal(formatBytes(null), "");
  assert.equal(formatBytes(12), "12 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});

test("groupMatchesByFile keeps server order", () => {
  const groups = groupMatchesByFile([
    { path: "b", line: 1, text: "" },
    { path: "a", line: 2, text: "" },
    { path: "b", line: 9, text: "" },
  ]);
  assert.deepEqual(groups.map((g) => [g.path, g.matches.map((m) => m.line)]), [
    ["b", [1, 9]],
    ["a", [2]],
  ]);
});

test("highlightMatchRanges handles fixed, case-folded, regex, and invalid regex", () => {
  assert.deepEqual(highlightMatchRanges("foo Foo foo", "foo", "fixed", false), [[0, 3], [8, 11]]);
  assert.deepEqual(highlightMatchRanges("foo Foo", "foo", "fixed", true), [[0, 3], [4, 7]]);
  assert.deepEqual(highlightMatchRanges("a1 b22", "[0-9]+", "regex", false), [[1, 2], [4, 6]]);
  assert.deepEqual(highlightMatchRanges("abc", "x*", "regex", false), []);
  assert.deepEqual(highlightMatchRanges("abc", "(", "regex", false), []);
  assert.deepEqual(highlightMatchRanges("abc", "", "fixed", false), []);
});

test("reflog rescue commands are safe to paste", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567";
  assert.equal(reflogRescueBranchName("HEAD", hash), "rescue/head-0123456");
  assert.equal(reflogRescueBranchName("refs/heads/feat/Login", hash), "rescue/feat-login-0123456");
  assert.equal(reflogRescueBranchName("refs/remotes/origin/main", hash), "rescue/origin-main-0123456");
  const commands = reflogRescueCommands("refs/heads/main", hash);
  assert.equal(commands.branch, `git branch rescue/main-0123456 ${hash}`);
  assert.match(commands.inspect, /--not --branches --tags --remotes$/);
  assert.equal(shellQuote("it's"), `'it'\\''s'`);
  assert.equal(shellQuote("plain/name-1"), "plain/name-1");
});

test("filterLostEntries keeps rows whose new or previous tip is unreachable", () => {
  const rows = [
    { id: 1, reachable: true, previousReachable: true },
    { id: 2, reachable: true, previousReachable: false },
    { id: 3, reachable: false, previousReachable: true },
    { id: 4, reachable: null, previousReachable: null },
  ];
  assert.deepEqual(filterLostEntries(rows).map((r) => r.id), [2, 3]);
});
