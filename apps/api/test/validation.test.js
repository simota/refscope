import assert from "node:assert/strict";
import test from "node:test";

import { parseDateQuery, parseGroupByQuery } from "../src/validation.js";

test("parseDateQuery treats null and empty as unspecified", () => {
  assert.deepEqual(parseDateQuery(null, "since"), { ok: true, value: null });
  assert.deepEqual(parseDateQuery(undefined, "since"), { ok: true, value: null });
  assert.deepEqual(parseDateQuery("", "since"), { ok: true, value: null });
  assert.deepEqual(parseDateQuery("   ", "since"), { ok: true, value: null });
});

test("parseDateQuery accepts canonical date-only ISO 8601", () => {
  assert.deepEqual(parseDateQuery("2024-01-15", "since"), {
    ok: true,
    value: "2024-01-15",
  });
  assert.deepEqual(parseDateQuery("  2024-12-31  ", "until"), {
    ok: true,
    value: "2024-12-31",
  });
});

test("parseDateQuery accepts canonical date-time ISO 8601 with explicit Z", () => {
  assert.deepEqual(parseDateQuery("2024-01-15T00:00:00Z", "since"), {
    ok: true,
    value: "2024-01-15T00:00:00Z",
  });
});

test("parseDateQuery accepts year boundary values 1900 and 2099", () => {
  assert.deepEqual(parseDateQuery("1900-01-01", "since"), {
    ok: true,
    value: "1900-01-01",
  });
  assert.deepEqual(parseDateQuery("2099-12-31", "until"), {
    ok: true,
    value: "2099-12-31",
  });
});

test("parseDateQuery rejects out-of-range years", () => {
  assert.deepEqual(parseDateQuery("1899-12-31", "since"), {
    ok: false,
    error: "Invalid since parameter",
  });
  assert.deepEqual(parseDateQuery("2100-01-01", "until"), {
    ok: false,
    error: "Invalid until parameter",
  });
});

test("parseDateQuery rejects loose Date.parse inputs Git would otherwise accept", () => {
  // Bare year, two-digit year, slash separators, and timezone offsets are all
  // forms `Date.parse` may interpret loosely. We only let canonical decimal
  // dates through so Git's date parser stays deterministic.
  for (const raw of [
    "2024",
    "24-01-15",
    "2024/01/15",
    "2024-01-15T00:00:00+09:00",
    "next monday",
    "yesterday",
  ]) {
    const result = parseDateQuery(raw, "since");
    assert.equal(result.ok, false, `expected ${raw} to be rejected`);
    assert.equal(result.error, "Invalid since parameter");
  }
});

test("parseDateQuery rejects embedded control characters and oversized input", () => {
  // After trim(), embedded control characters must still cause rejection.
  assert.deepEqual(parseDateQuery("2024-01\t-15", "since"), {
    ok: false,
    error: "Invalid since parameter",
  });
  assert.deepEqual(parseDateQuery("2024-01-15".padEnd(40, "0"), "since"), {
    ok: false,
    error: "Invalid since parameter",
  });
});

test("parseDateQuery rejects non-decimal digits and missing components", () => {
  assert.deepEqual(parseDateQuery("2024-01", "since"), {
    ok: false,
    error: "Invalid since parameter",
  });
  // Full-width digit must not be accepted in place of an ASCII digit.
  assert.deepEqual(parseDateQuery("2024-Ｏ1-15", "since"), {
    ok: false,
    error: "Invalid since parameter",
  });
});

test("parseDateQuery rejects non-string input", () => {
  assert.deepEqual(parseDateQuery(20240115, "since"), {
    ok: false,
    error: "Invalid since parameter",
  });
  assert.deepEqual(parseDateQuery({}, "since"), {
    ok: false,
    error: "Invalid since parameter",
  });
});

test("parseGroupByQuery accepts the literal allowlist values", () => {
  assert.deepEqual(parseGroupByQuery("prefix"), { ok: true, value: "prefix" });
  assert.deepEqual(parseGroupByQuery("path"), { ok: true, value: "path" });
  assert.deepEqual(parseGroupByQuery("author"), { ok: true, value: "author" });
  assert.deepEqual(parseGroupByQuery("  prefix  "), { ok: true, value: "prefix" });
});

test("parseGroupByQuery returns null for empty / null / blank input", () => {
  assert.deepEqual(parseGroupByQuery(null), { ok: true, value: null });
  assert.deepEqual(parseGroupByQuery(""), { ok: true, value: null });
  assert.deepEqual(parseGroupByQuery("   "), { ok: true, value: null });
});

test("parseGroupByQuery rejects values outside the allowlist", () => {
  for (const raw of ["PREFIX", "Author", "tags", "scope", "uncategorized", "x"]) {
    const result = parseGroupByQuery(raw);
    assert.equal(result.ok, false, `expected ${raw} to be rejected`);
    assert.equal(result.error, "Invalid groupBy parameter");
  }
});

test("parseGroupByQuery rejects oversized input even when it would shadow an allowed prefix", () => {
  assert.deepEqual(parseGroupByQuery("p".repeat(32)), {
    ok: false,
    error: "Invalid groupBy parameter",
  });
});
