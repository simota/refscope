import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyMove,
  diffRefSnapshot,
  formatElapsed,
  hasReflog,
  parseSnapshotStore,
  reflogMovesSince,
  rescueCommand,
  sameSnapshot,
  serializeSnapshotStore,
  snapshotFromRefs,
  type BriefingRef,
} from "../src/app/lib/refBriefing.ts";

const A = "a".repeat(40);
const B = "b".repeat(40);
const C = "c".repeat(40);

const ref = (name: string, hash: string, type: BriefingRef["type"]): BriefingRef => ({
  name,
  shortName: name.replace(/^refs\/(?:heads|tags|remotes)\//, ""),
  hash,
  type,
});

test("diffRefSnapshot: moved / created / deleted, watched refs first", () => {
  const previous = {
    "refs/heads/main": A,
    "refs/heads/old": B,
    "refs/tags/v1": C,
    "refs/heads/production": A,
  };
  const current = [
    ref("refs/heads/main", B, "branch"),
    ref("refs/tags/v1", C, "tag"),
    ref("refs/heads/feature", C, "branch"),
    ref("refs/heads/production", C, "branch"),
  ];
  const changes = diffRefSnapshot(previous, current, new Set(["refs/heads/production"]));
  assert.deepEqual(
    changes.map((change) => [change.name, change.kind, change.from, change.to, change.watched]),
    [
      ["refs/heads/production", "moved", A, C, true],
      ["refs/heads/main", "moved", A, B, false],
      ["refs/heads/old", "deleted", B, null, false],
      ["refs/heads/feature", "created", null, C, false],
    ],
  );
  assert.equal(changes.find((change) => change.kind === "deleted")?.shortName, "old");
  assert.deepEqual(diffRefSnapshot({ "refs/heads/main": A }, [ref("refs/heads/main", A, "branch")], new Set()), []);
});

test("classifyMove: ahead/behind against the previous tip", () => {
  assert.equal(classifyMove({ ahead: 3, behind: 0 }), "fast-forward");
  assert.equal(classifyMove({ ahead: 0, behind: 2 }), "rewound");
  assert.equal(classifyMove({ ahead: 1, behind: 1 }), "rewritten");
  assert.equal(classifyMove({ ahead: 0, behind: 0 }), "unchanged");
});

test("snapshot store: round-trips and drops malformed entries", () => {
  const refs = snapshotFromRefs([ref("refs/heads/main", A, "branch"), ref("refs/tags/v1", B, "tag")]);
  assert.ok(sameSnapshot(refs, { "refs/tags/v1": B, "refs/heads/main": A }));
  assert.ok(!sameSnapshot(refs, { "refs/heads/main": A }));
  const raw = serializeSnapshotStore({ viewer: { savedAt: "2026-11-06T00:00:00.000Z", refs } });
  assert.deepEqual(parseSnapshotStore(raw), { viewer: { savedAt: "2026-11-06T00:00:00.000Z", refs } });

  const hostile = JSON.stringify({
    v: 1,
    repos: {
      ok: { savedAt: "2026-11-06T00:00:00.000Z", refs: { "refs/heads/x": A, "refs/heads/bad": "zz", HEAD: A } },
      noDate: { savedAt: "not a date", refs: {} },
      junk: 42,
    },
  });
  assert.deepEqual(parseSnapshotStore(hostile), {
    ok: { savedAt: "2026-11-06T00:00:00.000Z", refs: { "refs/heads/x": A } },
  });
  assert.deepEqual(parseSnapshotStore("{"), {});
  assert.deepEqual(parseSnapshotStore(JSON.stringify({ v: 2, repos: {} })), {});
  assert.deepEqual(parseSnapshotStore(null), {});
});

test("reflogMovesSince / hasReflog / rescueCommand / formatElapsed", () => {
  const entries = [
    { movedAt: "2026-11-06T03:00:00Z", id: 1 },
    { movedAt: "2026-11-06T01:00:00Z", id: 2 },
    { movedAt: null, id: 3 },
  ];
  assert.deepEqual(
    reflogMovesSince(entries, "2026-11-06T02:00:00Z").map((entry) => entry.id),
    [1],
  );
  assert.deepEqual(reflogMovesSince(entries, "garbage"), []);

  assert.ok(hasReflog({ name: "refs/heads/main", kind: "moved" }));
  assert.ok(hasReflog({ name: "refs/remotes/origin/main", kind: "created" }));
  assert.ok(!hasReflog({ name: "refs/tags/v1", kind: "moved" }));
  assert.ok(!hasReflog({ name: "refs/heads/gone", kind: "deleted" }));

  assert.equal(rescueCommand({ shortName: "feat/x", from: A }), `git branch rescue/feat/x-aaaaaaa ${A}`);
  assert.equal(rescueCommand({ shortName: "a b;rm", from: A }), `git branch rescue/a-b-rm-aaaaaaa ${A}`);
  assert.equal(rescueCommand({ shortName: "x", from: null }), null);

  const now = Date.parse("2026-11-06T12:00:00Z");
  assert.equal(formatElapsed("2026-11-06T11:59:30Z", now), "just now");
  assert.equal(formatElapsed("2026-11-06T11:30:00Z", now), "30m ago");
  assert.equal(formatElapsed("2026-11-06T09:00:00Z", now), "3h ago");
  assert.equal(formatElapsed("2026-11-01T12:00:00Z", now), "5d ago");
  assert.equal(formatElapsed("nope", now), "");
});
