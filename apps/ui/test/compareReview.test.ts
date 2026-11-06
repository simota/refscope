import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCompareLinkSearch,
  buildCompareReport,
  compareCommands,
  groupCommitsByType,
  parseCompareLink,
} from "../src/app/lib/compareReview.ts";
import { blameAgeBuckets, groupBlameRuns, shortAge } from "../src/app/lib/blame.ts";

const H = (n: number) => String(n).repeat(40).slice(0, 40);

test("groupCommitsByType orders sections and isolates merges", () => {
  const groups = groupCommitsByType([
    { hash: H(1), subject: "chore: bump", author: "a" },
    { hash: H(2), subject: "feat(api)!: new endpoint", author: "a" },
    { hash: H(3), subject: "Merge branch 'x'", author: "a", isMerge: true },
    { hash: H(4), subject: "fix: crash", author: "b" },
    { hash: H(5), subject: "random words", author: "b" },
    { hash: H(6), subject: "feat: second", author: "c" },
  ]);
  assert.deepEqual(groups.map((g) => g.title), ["Features", "Fixes", "Maintenance", "Other changes", "Merges"]);
  assert.deepEqual(groups[0].commits.map((c) => c.hash), [H(2), H(6)]);
  assert.equal(groups[0].commits[0].breaking, true);
  assert.equal(groups[0].commits[0].display, "**api:** new endpoint");
});

test("compareCommands spells three-dot and two-dot as separate words", () => {
  assert.deepEqual(compareCommands("main", "feature", "three-dot"), {
    log: "git log --oneline main..feature",
    stat: "git diff --stat main...feature",
    diff: "git diff main...feature",
  });
  assert.equal(compareCommands("main", "feature", "two-dot").diff, "git diff main feature");
});

test("buildCompareReport renders summary, grouped changes, behind and files", () => {
  const report = buildCompareReport({
    base: "main",
    target: "feature",
    mode: "three-dot",
    mergeBase: "a".repeat(40),
    ahead: [
      { hash: "b".repeat(40), subject: "feat: add | pipe", author: "Ada" },
      { hash: "c".repeat(40), subject: "fix: bug", author: "Bob" },
    ],
    behind: [{ hash: "d".repeat(40), subject: "chore: main only", author: "Cy" }],
    aheadTruncated: true,
    behindTruncated: false,
    files: [
      { status: "R", path: "docs/n.md", oldPath: "n.md", added: 0, deleted: 0, binary: false },
      { status: "A", path: "img.png", added: 0, deleted: 0, binary: true },
    ],
    added: 3,
    deleted: 1,
  });
  assert.match(report, /^## feature vs main\n/);
  assert.match(report, /\*\*2\+\*\* commits ahead, \*\*1\*\* behind · 2 files \(\+3 −1\)/);
  assert.match(report, /changes since merge base `aaaaaaa`/);
  assert.match(report, /Reproduce: `git diff main\.\.\.feature`/);
  assert.match(report, /#### Features\n\n- add \| pipe \(`bbbbbbb`, Ada\)/);
  assert.match(report, /#### Fixes\n\n- bug/);
  assert.match(report, /_List truncated to the newest 2 commits\._/);
  assert.match(report, /### Only in main\n\n- chore: main only/);
  assert.match(report, /\| renamed \| `n\.md` → `docs\/n\.md` \| 0 \| 0 \|/);
  assert.match(report, /\| added \| `img\.png` \| bin \| bin \|/);
  assert.ok(report.endsWith("\n") && !report.endsWith("\n\n"));
});

test("buildCompareReport handles an empty ahead side and unloaded files", () => {
  const report = buildCompareReport({
    base: "main",
    target: "e".repeat(40),
    mode: "two-dot",
    mergeBase: null,
    ahead: [],
    behind: [],
    aheadTruncated: false,
    behindTruncated: false,
    files: null,
  });
  assert.match(report, /^## eeeeeee vs main/);
  assert.match(report, /direct tree difference/);
  assert.match(report, /has no commits that main lacks/);
  assert.ok(!report.includes("### Files"));
});

test("compare deep link round-trips and preserves unrelated params", () => {
  const search = buildCompareLinkSearch("?repo=r&fleet=1", { base: "main", target: "v1.0", mode: "two-dot" });
  assert.equal(search, "?repo=r&fleet=1&cbase=main&ctarget=v1.0&cmode=two-dot");
  assert.deepEqual(parseCompareLink(search), { base: "main", target: "v1.0", mode: "two-dot" });
  assert.equal(buildCompareLinkSearch(search, { base: "", target: "", mode: "three-dot" }), "?repo=r&fleet=1");
  assert.equal(
    buildCompareLinkSearch("", { base: "main", target: "dev", mode: "three-dot" }),
    "?cbase=main&ctarget=dev",
  );
  // A half link or a control character never applies.
  assert.deepEqual(parseCompareLink("?cbase=main"), { base: "", target: "", mode: "three-dot" });
  assert.deepEqual(parseCompareLink("?cbase=ma%0Ain&ctarget=dev"), { base: "", target: "", mode: "three-dot" });
});

test("groupBlameRuns collapses consecutive lines from one commit", () => {
  const runs = groupBlameRuns([
    { line: 1, hash: "a" },
    { line: 2, hash: "a" },
    { line: 3, hash: "b" },
    { line: 4, hash: "a" },
    { line: 5, hash: "a" },
  ]);
  assert.deepEqual(runs, [
    { hash: "a", startLine: 1, endLine: 2 },
    { hash: "b", startLine: 3, endLine: 3 },
    { hash: "a", startLine: 4, endLine: 5 },
  ]);
  assert.deepEqual(groupBlameRuns([]), []);
});

test("blameAgeBuckets ranks commits oldest to newest", () => {
  const buckets = blameAgeBuckets([
    { hash: "new", authorTime: "2024-05-01T00:00:00Z" },
    { hash: "old", authorTime: "2010-01-01T00:00:00Z" },
    { hash: "mid", authorTime: "2024-04-01T00:00:00Z" },
    { hash: "unknown", authorTime: null },
  ]);
  assert.equal(buckets.get("old"), 0);
  assert.equal(buckets.get("mid"), 2);
  assert.equal(buckets.get("new"), 4);
  assert.equal(buckets.get("unknown"), 0);
  assert.equal(blameAgeBuckets([{ hash: "only", authorTime: "2024-01-01T00:00:00Z" }]).get("only"), 4);
});

test("shortAge formats compact relative ages", () => {
  const now = Date.parse("2024-06-01T00:00:00Z");
  assert.equal(shortAge("2024-05-31T23:30:00Z", now), "30m");
  assert.equal(shortAge("2024-05-31T18:00:00Z", now), "6h");
  assert.equal(shortAge("2024-05-25T00:00:00Z", now), "7d");
  assert.equal(shortAge("2024-01-01T00:00:00Z", now), "5mo");
  assert.equal(shortAge("2020-06-01T00:00:00Z", now), "4y");
  assert.equal(shortAge(null, now), "");
});
