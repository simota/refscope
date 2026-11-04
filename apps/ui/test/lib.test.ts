// Unit tests for the UI's pure helpers. They run on plain `node --test`
// (Node 22 strips TypeScript types natively), so the UI gains regression
// coverage without a test framework dependency. Only modules whose runtime
// imports are type-only can be loaded this way.
import assert from "node:assert/strict";
import test from "node:test";

import { parseConventionalCommit } from "../src/app/lib/conventionalCommit.ts";
import {
  countTotalChanges,
  fileToDiffText,
  parseHunkHeader,
  parseUnifiedDiff,
} from "../src/app/lib/parseUnifiedDiff.ts";
import { percentile } from "../src/app/components/refscope/percentile.ts";
import { dayKey } from "../src/app/components/refscope/dateKey.ts";
import { estimateBase, shortRefName } from "../src/app/components/refscope/refUtil.ts";
import {
  buildFileTree,
  defaultExpandedDirs,
} from "../src/app/components/refscope/fileTreeBuilder.ts";

test("parseConventionalCommit: type, scope, breaking and non-matches", () => {
  assert.deepEqual(parseConventionalCommit("feat(api): add fleet probes"), {
    type: "feat",
    scope: "api",
    breaking: false,
    description: "add fleet probes",
  });
  assert.deepEqual(parseConventionalCommit("fix!: drop legacy flag"), {
    type: "fix",
    scope: null,
    breaking: true,
    description: "drop legacy flag",
  });
  // Free-form subjects must stay untouched (the timeline renders them raw).
  assert.equal(parseConventionalCommit("Optimize ref polling (#59)"), null);
  assert.equal(parseConventionalCommit("Fix: capitalised type"), null);
  assert.equal(parseConventionalCommit("feat:no-space"), null);
  assert.equal(parseConventionalCommit(""), null);
});

const SAMPLE_DIFF = `diff --git a/src/a.ts b/src/a.ts
index 111..222 100644
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 keep
-old
+new
+added
 tail
diff --git a/old name.txt b/new name.txt
similarity index 90%
rename from old name.txt
rename to new name.txt
diff --git a/bin.png b/bin.png
new file mode 100644
index 0000000..333
Binary files /dev/null and b/bin.png differ
`;

test("parseUnifiedDiff: modified, renamed (with spaces) and binary files", () => {
  const parsed = parseUnifiedDiff(SAMPLE_DIFF);
  assert.equal(parsed.files.length, 3);

  const [modified, renamed, binary] = parsed.files;
  assert.equal(modified.changeKind, "modified");
  assert.equal(modified.displayPath, "src/a.ts");
  assert.equal(modified.hunks.length, 1);
  assert.equal(modified.hunks[0].lines.length, 5);

  assert.equal(renamed.changeKind, "renamed");
  assert.equal(renamed.oldPath, "old name.txt");
  assert.equal(renamed.newPath, "new name.txt");
  assert.equal(renamed.similarity, 90);

  assert.equal(binary.changeKind, "added");
  assert.equal(binary.isBinary, true);
  assert.equal(binary.displayPath, "bin.png");

  assert.deepEqual(countTotalChanges(parsed), { added: 2, deleted: 1 });
});

test("fileToDiffText round-trips a parsed file's header and hunks", () => {
  const [modified] = parseUnifiedDiff(SAMPLE_DIFF).files;
  assert.equal(
    fileToDiffText(modified),
    [
      "diff --git a/src/a.ts b/src/a.ts",
      "index 111..222 100644",
      "--- a/src/a.ts",
      "+++ b/src/a.ts",
      "@@ -1,3 +1,4 @@",
      " keep",
      "-old",
      "+new",
      "+added",
      " tail",
    ].join("\n"),
  );
});

test("parseHunkHeader: counts default to 1 and section headings are kept", () => {
  const hunk = parseHunkHeader("@@ -10 +12,3 @@ function main() {");
  assert.ok(hunk);
  assert.equal(hunk.oldStart, 10);
  assert.equal(hunk.oldLines, 1);
  assert.equal(hunk.newStart, 12);
  assert.equal(hunk.newLines, 3);
  assert.equal(hunk.sectionHeading.trim(), "function main() {");
  assert.equal(parseHunkHeader("not a hunk"), null);
});

test("percentile: linear interpolation, clamping and empty input", () => {
  assert.equal(percentile([], 50), 0);
  assert.equal(percentile([7], 90), 7);
  assert.equal(percentile([4, 1, 3, 2], 50), 2.5);
  assert.equal(percentile([1, 2, 3, 4, 5], 100), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], 150), 5);
  assert.equal(percentile([1, 2, 3, 4, 5], -10), 1);
});

test("dayKey formats the local calendar date with zero padding", () => {
  assert.equal(dayKey(new Date(2026, 0, 5, 23, 59)), "2026-01-05");
  assert.equal(dayKey(new Date(2026, 10, 30, 0, 0)), "2026-11-30");
});

test("estimateBase prefers local main/master/trunk, then a remote, then the first ref", () => {
  assert.equal(estimateBase([{ name: "feature/x" }, { name: "refs/heads/master" }]), "master");
  assert.equal(estimateBase([{ name: "feature/x" }, { name: "origin/main" }]), "origin/main");
  assert.equal(estimateBase([{ name: "feature/x" }]), "feature/x");
  assert.equal(estimateBase([]), null);
  assert.equal(shortRefName("refs/heads/main"), "main");
  assert.equal(shortRefName("refs/remotes/origin/main"), "origin/main");
  assert.equal(shortRefName("refs/tags/v1.0.0"), "v1.0.0");
  assert.equal(shortRefName("HEAD"), "HEAD");
});

test("buildFileTree collapses single-child directory chains and sums stats", () => {
  const files = [
    { path: "src/app/a.ts", status: "M", added: 3, deleted: 1 },
    { path: "src/app/b.ts", status: "A", added: 5, deleted: 0 },
    { path: "README.md", status: "M", added: 1, deleted: 1 },
  ];
  // ChangedFile has more optional fields; the tree only reads these.
  const tree = buildFileTree(files as Parameters<typeof buildFileTree>[0]);
  assert.equal(tree.length, 2);
  const [dir, readme] = tree;
  assert.equal(dir.kind, "dir");
  if (dir.kind !== "dir") return;
  assert.equal(dir.displayName, "src/app");
  assert.equal(dir.fileCount, 2);
  assert.equal(dir.added, 8);
  assert.equal(dir.deleted, 1);
  assert.deepEqual(
    dir.children.map((c) => c.fullPath),
    ["src/app/a.ts", "src/app/b.ts"],
  );
  assert.equal(readme.kind, "file");
  assert.deepEqual([...defaultExpandedDirs(tree, files.length)], ["src/app"]);
});
