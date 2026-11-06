import assert from "node:assert/strict";
import test from "node:test";

import {
  REDACTED_EMAIL,
  createRedactor,
  isPseudonym,
  pseudonymizeName,
  redactText,
} from "../src/app/lib/redaction.ts";

test("pseudonymizeName: stable, initials-only, distinct per person", () => {
  const first = pseudonymizeName("Taro Tanaka");
  assert.match(first, /^TT·[0-9a-f]{4}$/);
  assert.equal(pseudonymizeName("Taro Tanaka"), first, "same input, same pseudonym");
  assert.equal(pseudonymizeName("taro tanaka"), first, "case-insensitive identity");
  assert.notEqual(pseudonymizeName("Tom Thumb"), first, "shared initials stay distinct");
  // A kanji initial can identify someone; non-Latin names get no initials.
  assert.match(pseudonymizeName("田中 太郎"), /^Author·[0-9a-f]{4}$/);
  // Idempotent: masking a mask is a no-op.
  assert.equal(pseudonymizeName(first), first);
  assert.ok(isPseudonym(first));
  assert.equal(pseudonymizeName(""), "");
});

test("redactText: masks e-mails and attribution trailer values only", () => {
  const body = [
    "Fix race in poller",
    "",
    "Reported by ops@example.com during the incident.",
    "Signed-off-by: Taro Tanaka <taro@client-corp.co.jp>",
    "  reviewed-by: Someone Else <s@e.io>",
    "Refs: #42",
  ].join("\n");
  const out = redactText(body);
  assert.ok(!out.includes("@"), out);
  assert.ok(!out.includes("Taro"), out);
  assert.ok(out.includes("Signed-off-by: [redacted]"));
  assert.ok(out.includes("  reviewed-by: [redacted]"));
  assert.ok(out.includes("Reported by [email] during"));
  assert.ok(out.includes("Refs: #42"), "unrelated trailers are kept");
  assert.equal(redactText(""), "");
});

test("createRedactor: masks identities in nested API payloads without touching facts", () => {
  const redactor = createRedactor();
  const payload = {
    hash: "a".repeat(40),
    subject: "feat: thanks dev@example.com",
    body: "Co-authored-by: Ann Lee <ann@example.com>",
    author: { name: "Ann Lee", email: "ann@example.com" },
    authorDate: "2026-01-01T00:00:00Z",
    refs: [{ name: "refs/heads/main", shortName: "main" }],
    commits: [{ author: "Bob Stone", authorEmail: "bob@example.com", files: [{ path: "src/a.ts" }] }],
    entries: [{ actor: "Bob Stone", actorEmail: "bob@example.com", message: "reset: moving to HEAD~1" }],
    groups: [
      { kind: "author", key: "Bob Stone", authors: ["Bob Stone"], sampleSubjects: ["mail me@x.io"] },
      { kind: "path", key: "src", authors: ["Ann Lee"], sampleSubjects: [] },
    ],
    hotspot: { authors: 0 },
  };
  const out = redactor.redact(payload);
  const text = JSON.stringify(out);
  assert.ok(!text.includes("Ann Lee"), text);
  assert.ok(!text.includes("Bob Stone"), text);
  assert.ok(!text.includes("@example.com"), text);
  assert.equal(out.author.email, REDACTED_EMAIL);
  assert.equal(out.commits[0].authorEmail, REDACTED_EMAIL);
  assert.equal(out.entries[0].actorEmail, REDACTED_EMAIL);
  // Facts the UI addresses things by stay intact.
  assert.equal(out.hash, payload.hash);
  assert.equal(out.refs[0].name, "refs/heads/main");
  assert.equal(out.commits[0].files[0].path, "src/a.ts");
  assert.equal(out.groups[1].key, "src", "non-author group keys untouched");
  assert.equal(out.hotspot.authors, 0, "numeric fields untouched");
  assert.equal(out.entries[0].message, "reset: moving to HEAD~1");
  // One person → one pseudonym across shapes, so lenses still group correctly.
  assert.equal(out.commits[0].author, out.groups[0].key);
  assert.equal(out.groups[0].authors[0], out.entries[0].actor);
  // The input object is not mutated.
  assert.equal(payload.author.name, "Ann Lee");
});

test("createRedactor.resolveName: a clicked pseudonym filters by the real author", () => {
  const redactor = createRedactor();
  const out = redactor.redact({ author: "Carol King" });
  assert.equal(redactor.resolveName(out.author), "Carol King");
  assert.equal(redactor.resolveName("someone typed"), "someone typed");
});
