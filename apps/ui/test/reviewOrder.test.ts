import assert from "node:assert/strict";
import test from "node:test";

import {
  buildReviewPlan,
  categorize,
  formatReviewPlanMarkdown,
  isTestPath,
  moduleStem,
  type ReviewFile,
} from "../src/app/lib/reviewOrder.ts";

const file = (path: string, added = 10, deleted = 2, status = "M", binary = false): ReviewFile => ({
  status,
  path,
  added,
  deleted,
  binary,
});

test("categorize: path kinds", () => {
  assert.equal(categorize("db/migrations/2026_add_users.sql"), "migration");
  assert.equal(categorize("apps/api/src/auth/session.js"), "security");
  assert.equal(categorize("proto/service.proto"), "contract");
  assert.equal(categorize("package.json"), "dependency");
  assert.equal(categorize("pnpm-lock.yaml"), "lockfile");
  assert.equal(categorize(".github/workflows/ci.yml"), "build");
  assert.equal(categorize("src/lib/format.ts"), "shared");
  assert.equal(categorize("src/components/Button.tsx"), "source");
  assert.equal(categorize("docs/guide.md"), "docs");
  assert.equal(categorize("dist/bundle.min.js"), "generated");
  assert.equal(categorize("src/__snapshots__/a.snap"), "generated");
  assert.equal(categorize("public/logo.png"), "asset");
  assert.equal(categorize("apps/ui/test/lib.test.ts"), "test");
});

test("isTestPath / moduleStem pair code with its tests", () => {
  assert.ok(isTestPath("src/foo.test.ts"));
  assert.ok(isTestPath("pkg/foo_test.go"));
  assert.ok(isTestPath("tests/test_foo.py"));
  assert.ok(!isTestPath("src/testing-utils.ts"));
  assert.equal(moduleStem("src/foo.ts"), moduleStem("test/foo.test.ts"));
  assert.equal(moduleStem("pkg/foo.go"), moduleStem("pkg/foo_test.go"));
  assert.equal(moduleStem("app/foo.py"), moduleStem("tests/test_foo.py"));
});

test("buildReviewPlan: risky kinds first, low-risk last, evidence on every row", () => {
  const plan = buildReviewPlan([
    file("README.md", 40, 0),
    file("pnpm-lock.yaml", 900, 300),
    file("src/components/Button.tsx", 12, 3),
    file("src/components/Button.test.tsx", 20, 0),
    file("src/components/Huge.tsx", 250, 40),
    file("db/migrations/001_init.sql", 30, 0, "A"),
    file("src/lib/format.ts", 5, 5),
    file("src/old.ts", 0, 80, "D"),
    file("src/moved.ts", 0, 0, "R100"),
  ]);
  const order = plan.items.map((item) => [item.file.path, item.group]);
  assert.deepEqual(order, [
    ["db/migrations/001_init.sql", "first"],
    ["src/lib/format.ts", "first"],
    ["src/old.ts", "first"],
    ["src/components/Huge.tsx", "first"],
    ["src/components/Button.tsx", "next"],
    ["src/components/Button.test.tsx", "next"],
    ["pnpm-lock.yaml", "skim"],
    ["README.md", "skim"],
    ["src/moved.ts", "skim"],
  ]);
  const reasons = Object.fromEntries(plan.items.map((item) => [item.file.path, item.reasons]));
  assert.ok(reasons["db/migrations/001_init.sql"].includes("schema / migration"));
  assert.ok(reasons["src/old.ts"].includes("deletes code"));
  assert.ok(reasons["src/components/Huge.tsx"].includes("large change (290 lines)"));
  assert.ok(reasons["src/components/Huge.tsx"].includes("no matching test changed"));
  assert.ok(reasons["src/components/Button.tsx"].includes("matching test changed"));
  assert.ok(reasons["src/moved.ts"].includes("pure rename"));
  assert.ok(reasons["pnpm-lock.yaml"].includes("lockfile (usually generated)"));
  assert.deepEqual(plan.counts, { first: 4, next: 2, skim: 3 });
  assert.equal(plan.testsChanged, 1);
  // format.ts and Huge.tsx; a pure rename is not new untested code.
  assert.equal(plan.untestedSources, 2);
  assert.ok(!reasons["src/moved.ts"].includes("no matching test changed"));
});

test("buildReviewPlan: no tests in range is called out; markdown lists groups", () => {
  const plan = buildReviewPlan([file("src/a.ts"), file("CHANGELOG.md")]);
  assert.ok(plan.items[0].reasons.includes("no test changed in range"));
  const md = formatReviewPlanMarkdown(plan);
  assert.match(md, /^## Suggested reading order \(derived\)/);
  assert.ok(md.includes("### Then read"));
  assert.ok(md.includes("- `src/a.ts` (+10 −2) — no test changed in range"));
  assert.ok(md.includes("### Skim — likely low risk"));
  assert.ok(!md.includes("### Read first"), "empty groups are omitted");
  assert.deepEqual(buildReviewPlan([]).items, []);
});
