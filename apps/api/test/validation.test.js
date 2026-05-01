import assert from "node:assert/strict";
import test from "node:test";

import {
  ALLOWED_SEARCH_MODES,
  PATTERN_MAX_LENGTH,
  parseDateQuery,
  parseGroupByQuery,
  parsePatternQuery,
  parseSearchModeQuery,
} from "../src/validation.js";

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

// --- parseSearchModeQuery ---

test("parseSearchModeQuery returns subject for empty / null / undefined / blank input", () => {
  assert.deepEqual(parseSearchModeQuery(null), { ok: true, value: "subject" });
  assert.deepEqual(parseSearchModeQuery(undefined), { ok: true, value: "subject" });
  assert.deepEqual(parseSearchModeQuery(""), { ok: true, value: "subject" });
  assert.deepEqual(parseSearchModeQuery("   "), { ok: true, value: "subject" });
});

test("parseSearchModeQuery accepts all allowed mode values", () => {
  for (const mode of ALLOWED_SEARCH_MODES) {
    assert.deepEqual(parseSearchModeQuery(mode), { ok: true, value: mode });
  }
  // leading/trailing whitespace is trimmed
  assert.deepEqual(parseSearchModeQuery("  pickaxe  "), { ok: true, value: "pickaxe" });
});

test("parseSearchModeQuery rejects values outside the allowlist", () => {
  for (const raw of ["Pickaxe", "PICKAXE", "grep", "diff", "path", "author", "s"]) {
    const result = parseSearchModeQuery(raw);
    assert.equal(result.ok, false, `expected "${raw}" to be rejected`);
    assert.equal(result.error, "Invalid mode parameter");
  }
});

test("parseSearchModeQuery rejects values with embedded whitespace or injection attempts", () => {
  for (const raw of ["pickaxe regex", "pickaxe; rm -rf", "pick axe"]) {
    const result = parseSearchModeQuery(raw);
    assert.equal(result.ok, false, `expected "${raw}" to be rejected`);
    assert.equal(result.error, "Invalid mode parameter");
  }
});

test("parseSearchModeQuery rejects non-string input", () => {
  assert.deepEqual(parseSearchModeQuery(123), { ok: false, error: "Invalid mode parameter" });
  assert.deepEqual(parseSearchModeQuery({}), { ok: false, error: "Invalid mode parameter" });
  assert.deepEqual(parseSearchModeQuery([]), { ok: false, error: "Invalid mode parameter" });
  assert.deepEqual(parseSearchModeQuery(true), { ok: false, error: "Invalid mode parameter" });
});

// --- parsePatternQuery ---

test("parsePatternQuery returns empty string for null / undefined / empty / blank", () => {
  assert.deepEqual(parsePatternQuery(null), { ok: true, value: "" });
  assert.deepEqual(parsePatternQuery(undefined), { ok: true, value: "" });
  assert.deepEqual(parsePatternQuery(""), { ok: true, value: "" });
  assert.deepEqual(parsePatternQuery("   "), { ok: true, value: "" });
});

test("parsePatternQuery accepts a normal search string", () => {
  assert.deepEqual(parsePatternQuery("OAUTH_SECRET"), { ok: true, value: "OAUTH_SECRET" });
  assert.deepEqual(parsePatternQuery("  hello world  "), { ok: true, value: "hello world" });
});

test("parsePatternQuery accepts hyphen-leading patterns (attached form safety)", () => {
  // Hyphen-leading patterns are valid at the validation layer; callers use
  // attached form (-S-delete) so Git never sees them as flags.
  assert.deepEqual(parsePatternQuery("-delete"), { ok: true, value: "-delete" });
  assert.deepEqual(parsePatternQuery("--force"), { ok: true, value: "--force" });
});

test("parsePatternQuery accepts exactly PATTERN_MAX_LENGTH characters", () => {
  const maxPattern = "a".repeat(PATTERN_MAX_LENGTH);
  assert.deepEqual(parsePatternQuery(maxPattern), { ok: true, value: maxPattern });
});

test("parsePatternQuery rejects strings exceeding PATTERN_MAX_LENGTH", () => {
  const tooLong = "a".repeat(PATTERN_MAX_LENGTH + 1);
  assert.deepEqual(parsePatternQuery(tooLong), {
    ok: false,
    error: "Invalid pattern parameter",
  });
});

test("parsePatternQuery rejects embedded control characters", () => {
  // NUL byte
  assert.deepEqual(parsePatternQuery("foo bar"), {
    ok: false,
    error: "Invalid pattern parameter",
  });
  // TAB
  assert.deepEqual(parsePatternQuery("foo\tbar"), {
    ok: false,
    error: "Invalid pattern parameter",
  });
  // newline
  assert.deepEqual(parsePatternQuery("foo\nbar"), {
    ok: false,
    error: "Invalid pattern parameter",
  });
  // DEL (0x7f)
  assert.deepEqual(parsePatternQuery("foobar"), {
    ok: false,
    error: "Invalid pattern parameter",
  });
});

test("parsePatternQuery rejects non-string input", () => {
  assert.deepEqual(parsePatternQuery(123), { ok: false, error: "Invalid pattern parameter" });
  assert.deepEqual(parsePatternQuery({}), { ok: false, error: "Invalid pattern parameter" });
  assert.deepEqual(parsePatternQuery(true), { ok: false, error: "Invalid pattern parameter" });
});
