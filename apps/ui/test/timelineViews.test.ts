import assert from "node:assert/strict";
import test from "node:test";

import {
  SAVED_VIEWS_MAX,
  buildFilterLinkSearch,
  csvCell,
  describeFilters,
  exportFileStem,
  findMatchingView,
  parseFilterLink,
  parseHistoryShape,
  removeSavedView,
  sameFilters,
  sanitizeFilters,
  sanitizeSavedViews,
  timelineToCsv,
  timelineToMarkdown,
  upsertSavedView,
  type TimelineFilters,
} from "../src/app/lib/timelineViews.ts";

const base: TimelineFilters = {
  ref: "refs/heads/main",
  searchMode: "subject",
  search: "",
  searchPattern: "",
  author: "",
  path: "",
  since: "",
  until: "",
  history: "all",
};

let counter = 0;
const makeId = () => `id-${++counter}`;

test("parseHistoryShape falls back to all", () => {
  assert.equal(parseHistoryShape("merges"), "merges");
  assert.equal(parseHistoryShape("first-parent"), "first-parent");
  assert.equal(parseHistoryShape("MERGES"), "all");
  assert.equal(parseHistoryShape(undefined), "all");
});

test("sanitizeFilters drops malformed values", () => {
  const clean = sanitizeFilters({
    ref: "a\nb",
    searchMode: "eval",
    search: 42,
    author: "alice",
    since: "2024-1-1",
    until: "2024-02-03",
    history: "no-merges",
  });
  assert.equal(clean.ref, "HEAD");
  assert.equal(clean.searchMode, "subject");
  assert.equal(clean.search, "");
  assert.equal(clean.author, "alice");
  assert.equal(clean.since, "");
  assert.equal(clean.until, "2024-02-03");
  assert.equal(clean.history, "no-merges");
  assert.deepEqual(sanitizeFilters(null), { ...base, ref: "HEAD" });
});

test("sameFilters ignores the inactive search field and whitespace", () => {
  assert.ok(sameFilters(base, { ...base, searchPattern: "stale pattern" }));
  assert.ok(sameFilters(base, { ...base, author: "  " }));
  assert.ok(sameFilters({ ...base, searchMode: "regex" }, base), "an empty pattern lists the same commits");
  assert.ok(!sameFilters(base, { ...base, history: "merges" }));
  assert.ok(!sameFilters(base, { ...base, ref: "HEAD" }));
  assert.ok(!sameFilters({ ...base, searchMode: "regex", searchPattern: "x" }, { ...base, searchMode: "message", searchPattern: "x" }));
});

test("describeFilters lists the narrowing filters", () => {
  assert.deepEqual(describeFilters(base), []);
  assert.deepEqual(
    describeFilters({ ...base, searchMode: "pickaxe", searchPattern: "TODO", path: "src", since: "2024-01-01", history: "merges" }),
    ['Pickaxe -S: "TODO"', 'path "src"', "date 2024-01-01 → …", "merges only"],
  );
});

test("upsertSavedView adds first, overwrites by name, and caps the list", () => {
  const first = upsertSavedView([], "  Weekly   merges ", { ...base, history: "merges" }, "t1", makeId);
  assert.equal(first.view?.name, "Weekly merges");
  assert.equal(first.views.length, 1);

  const second = upsertSavedView(first.views, "Mine", { ...base, author: "me" }, "t2", makeId);
  assert.deepEqual(second.views.map((v) => v.name), ["Mine", "Weekly merges"]);

  const overwritten = upsertSavedView(second.views, "weekly MERGES", { ...base, history: "first-parent" }, "t3", makeId);
  assert.equal(overwritten.views.length, 2);
  assert.equal(overwritten.view?.id, first.view?.id, "same id is kept");
  assert.equal(overwritten.views[1].filters.history, "first-parent");
  assert.equal(overwritten.views[1].savedAt, "t3");

  assert.equal(upsertSavedView(second.views, "   ", base, "t", makeId).view, null);

  let many = { views: [] as ReturnType<typeof sanitizeSavedViews>, view: null as unknown };
  for (let i = 0; i < SAVED_VIEWS_MAX + 5; i += 1) {
    many = upsertSavedView(many.views, `v${i}`, base, "t", makeId);
  }
  assert.equal(many.views.length, SAVED_VIEWS_MAX);
  assert.equal(many.views[0].name, `v${SAVED_VIEWS_MAX + 4}`, "newest first, oldest dropped");
});

test("remove and match saved views", () => {
  const a = upsertSavedView([], "A", { ...base, author: "a" }, "t", makeId);
  const b = upsertSavedView(a.views, "B", { ...base, author: "b" }, "t", makeId);
  const idA = a.view!.id;
  assert.equal(findMatchingView(b.views, { ...base, author: "a" })?.id, idA);
  assert.equal(findMatchingView(b.views, base), null);
  assert.deepEqual(removeSavedView(b.views, idA).map((v) => v.name), ["B"]);
});

test("sanitizeSavedViews drops malformed and duplicate entries", () => {
  const views = sanitizeSavedViews([
    { id: "1", name: "Good", filters: { ref: "HEAD", history: "merges" }, savedAt: "t" },
    { id: "1", name: "Dup id", filters: {} },
    { id: "2", name: "good", filters: {} },
    { id: "3", name: "", filters: {} },
    { name: "No id" },
    "junk",
    null,
  ]);
  assert.equal(views.length, 1);
  assert.equal(views[0].filters.history, "merges");
  assert.deepEqual(sanitizeSavedViews({}), []);
});

test("filter links round-trip and keep unrelated params", () => {
  const state = {
    searchMode: "regex" as const,
    search: "ignored",
    searchPattern: "fix(auth)",
    author: "alice@example.test",
    since: "2024-01-01",
    until: "2024-01-31",
    history: "first-parent" as const,
  };
  const search = buildFilterLinkSearch("?repo=demo&fleet=1", state, { includeAuthor: true });
  const params = new URLSearchParams(search);
  assert.equal(params.get("repo"), "demo");
  assert.equal(params.get("fleet"), "1");
  assert.equal(params.get("q"), "fix(auth)");
  assert.equal(params.get("mode"), "regex");
  assert.deepEqual(parseFilterLink(search), { ...state, search: "" });

  const redacted = buildFilterLinkSearch(search, state, { includeAuthor: false });
  assert.equal(new URLSearchParams(redacted).get("author"), null, "redact mode keeps the author out of the URL");

  const cleared = buildFilterLinkSearch(search, { ...state, searchPattern: "", author: "", since: "", until: "", history: "all" }, { includeAuthor: true });
  assert.equal(cleared, "?repo=demo&fleet=1");

  const subject = parseFilterLink("?q=release&history=bogus&since=yesterday");
  assert.equal(subject.search, "release");
  assert.equal(subject.searchPattern, "");
  assert.equal(subject.history, "all");
  assert.equal(subject.since, "");
});

const commit = (overrides: Record<string, unknown>) => ({
  hash: "a".repeat(40),
  subject: "feat: add",
  author: "Alice",
  authorDate: "2024-01-02T10:00:00+09:00",
  time: "",
  added: 3,
  deleted: 1,
  files: [],
  fileCount: 2,
  lane: 0,
  ...overrides,
});

test("timelineToMarkdown summarises and lists commits", () => {
  const md = timelineToMarkdown(
    [commit({}), commit({ hash: "b".repeat(40), subject: "Merge `x` | *y*", author: "Bob", isMerge: true, added: 10, deleted: 0 })],
    { repo: "demo", filters: { ...base, history: "first-parent" }, generatedAt: "2024-01-03T00:00:00Z", hasMore: true, extraFilters: ["kind: logic"] },
  );
  assert.match(md, /^# demo — main history/);
  assert.match(md, /Filters: first-parent, kind: logic/);
  assert.match(md, /Commits: 2 \(more exist past the loaded rows\)/);
  assert.match(md, /2 commits by 2 authors, \+13 −1, 1 merge\./);
  assert.match(md, /- `aaaaaaa` feat: add — Alice, 2024-01-02, \+3 −1/);
  assert.ok(md.includes("Merge \\`x\\` \\| \\*y\\*"), "markdown in subjects is escaped");
  assert.match(timelineToMarkdown([], { repo: "demo", filters: base, generatedAt: "t", hasMore: false }), /No commits match/);
});

test("timelineToCsv quotes cells and neutralises formulas", () => {
  assert.equal(csvCell("plain"), "plain");
  assert.equal(csvCell('a "b", c'), '"a ""b"", c"');
  assert.equal(csvCell("=HYPERLINK(1)"), "'=HYPERLINK(1)");
  assert.equal(csvCell("-1"), "'-1");
  assert.equal(csvCell(-1), "-1");
  const csv = timelineToCsv([commit({ subject: "=cmd()", refs: ["main", "v1"] })]);
  const [header, row] = csv.trimEnd().split("\r\n");
  assert.equal(header, "hash,date,author,subject,added,deleted,files,merge,refs");
  assert.equal(row, `${"a".repeat(40)},2024-01-02T10:00:00+09:00,Alice,'=cmd(),3,1,2,false,main v1`);
});

test("exportFileStem is filesystem-safe", () => {
  assert.equal(exportFileStem("my repo", "refs/heads/feat/x", "2024-01-03T00:00:00Z"), "refscope-my-repo-feat-x-2024-01-03");
});
