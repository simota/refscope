import assert from "node:assert/strict";
import test from "node:test";

import {
  compareRefSnapshots,
  createGitService,
  escapeGitRegexLiteral,
  formatLiteralPathspec,
  parseChangedFiles,
  parseNumstatSummary,
  parseSignatureStatus,
} from "../src/gitService.js";

test("rejects invalid commit list limit before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ limit: "bad" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid limit parameter" },
  });
});

test("rejects non-decimal commit list limit before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ limit: "1e2" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid limit parameter" },
  });
});

test("rejects duplicate commit list query parameters before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams([
      ["search", "first"],
      ["search", "second"],
    ]),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Duplicate search parameter" },
  });
});

test("rejects malformed commit list ref before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ ref: "refs/heads/main." }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid ref parameter" },
  });
});

test("rejects malformed commit list path before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.listCommits(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    new URLSearchParams({ path: "src//secret" }),
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid path parameter" },
  });
});

test("rejects abbreviated commit detail hashes before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.getCommit(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    "a1b2c3d",
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid commit hash" },
  });
});

test("rejects abbreviated commit diff hashes before running git", async () => {
  const service = createGitService({
    repositories: new Map(),
    gitTimeoutMs: 1000,
    diffMaxBytes: 1024,
  });

  const result = await service.getDiff(
    { id: "demo", name: "demo", path: "/tmp/not-needed" },
    "a1b2c3d",
  );

  assert.deepEqual(result, {
    status: 400,
    body: { error: "Invalid commit hash" },
  });
});

test("classifies created, updated, and deleted refs", () => {
  const previous = new Map([
    [
      "refs/heads/main",
      {
        name: "refs/heads/main",
        shortName: "main",
        hash: "1111111",
        type: "branch",
        updatedAt: null,
      },
    ],
    [
      "refs/tags/v1.0.0",
      {
        name: "refs/tags/v1.0.0",
        shortName: "v1.0.0",
        hash: "2222222",
        type: "tag",
        updatedAt: null,
      },
    ],
  ]);
  const current = new Map([
    [
      "refs/heads/main",
      {
        name: "refs/heads/main",
        shortName: "main",
        hash: "3333333",
        type: "branch",
        updatedAt: null,
      },
    ],
    [
      "refs/heads/feature/live",
      {
        name: "refs/heads/feature/live",
        shortName: "feature/live",
        hash: "4444444",
        type: "branch",
        updatedAt: null,
      },
    ],
  ]);

  assert.deepEqual(compareRefSnapshots(previous, current), [
    {
      type: "ref_updated",
      ref: current.get("refs/heads/main"),
      previousHash: "1111111",
    },
    {
      type: "ref_created",
      ref: current.get("refs/heads/feature/live"),
    },
    {
      type: "ref_deleted",
      ref: previous.get("refs/tags/v1.0.0"),
    },
  ]);
});

test("parses changed files from numstat and name-status output", () => {
  const files = parseChangedFiles(
    [
      "12\t3\tsrc/App.tsx",
      "-\t-\tassets/logo.png",
      "0\t8\tdocs/old.md",
      "4\t1\tsrc/new-name.ts",
    ].join("\n"),
    [
      "M\tsrc/App.tsx",
      "A\tassets/logo.png",
      "D\tdocs/old.md",
      "R087\tsrc/old-name.ts\tsrc/new-name.ts",
    ].join("\n"),
  );

  assert.deepEqual(files, [
    { status: "M", path: "src/App.tsx", added: 12, deleted: 3 },
    { status: "A", path: "assets/logo.png", added: 0, deleted: 0 },
    { status: "D", path: "docs/old.md", added: 0, deleted: 8 },
    { status: "R", path: "src/new-name.ts", added: 4, deleted: 1 },
  ]);
});

test("summarizes numstat lines for commit list metadata", () => {
  assert.deepEqual(
    parseNumstatSummary([
      "12\t3\tsrc/App.tsx",
      "-\t-\tassets/logo.png",
      "0\t8\tdocs/old.md",
    ]),
    { added: 12, deleted: 11, fileCount: 3 },
  );
});

test("escapes author filters before passing them to git regex matching", () => {
  assert.equal(
    escapeGitRegexLiteral("Alice.Example+Bot (CI) [prod]"),
    "Alice\\.Example\\+Bot \\(CI\\) \\[prod\\]",
  );
});

test("formats path filters as literal top-level git pathspecs", () => {
  assert.equal(formatLiteralPathspec("src/app/App.tsx"), ":(literal,top)src/app/App.tsx");
});

test("normalizes git signature status codes for API responses", () => {
  assert.equal(parseSignatureStatus("G"), "valid");
  assert.equal(parseSignatureStatus("U"), "untrusted");
  assert.equal(parseSignatureStatus("B"), "bad");
  assert.equal(parseSignatureStatus("X"), "expired-signature");
  assert.equal(parseSignatureStatus("Y"), "expired-key");
  assert.equal(parseSignatureStatus("R"), "revoked-key");
  assert.equal(parseSignatureStatus("E"), "missing-key");
  assert.equal(parseSignatureStatus("N"), "unsigned");
  assert.equal(parseSignatureStatus("N\n"), "unsigned");
  assert.equal(parseSignatureStatus(""), "unknown");
});
