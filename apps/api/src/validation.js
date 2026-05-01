const REPO_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
const OBJECT_ID_PATTERN = /^[A-Fa-f0-9]{40}$/;
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,199}$/;
const POSITIVE_INTEGER_PATTERN = /^[0-9]+$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/;
const DISALLOWED_PSEUDO_REFS = new Set([
  "AUTO_MERGE",
  "BISECT_HEAD",
  "BISECT_EXPECTED_REV",
  "CHERRY_PICK_HEAD",
  "FETCH_HEAD",
  "MERGE_AUTOSTASH",
  "MERGE_HEAD",
  "ORIG_HEAD",
  "REBASE_HEAD",
  "REVERT_HEAD",
  "stash",
  "refs/stash",
]);
const DISALLOWED_INTERNAL_REF_PREFIXES = [
  "refs/bisect/",
  "refs/notes/",
  "refs/original/",
  "refs/prefetch/",
  "refs/replace/",
  "refs/rewritten/",
  "refs/worktree/",
];
const ALLOWED_PUBLIC_REF_PREFIXES = ["refs/heads/", "refs/remotes/", "refs/tags/"];

export function isValidRepoId(value) {
  return typeof value === "string" && REPO_ID_PATTERN.test(value);
}

export function isValidObjectId(value) {
  return typeof value === "string" && OBJECT_ID_PATTERN.test(value);
}

export function isValidGitRef(value) {
  if (
    typeof value !== "string" ||
    !REF_PATTERN.test(value) ||
    value === "@" ||
    DISALLOWED_PSEUDO_REFS.has(value) ||
    (value.startsWith("refs/") && !ALLOWED_PUBLIC_REF_PREFIXES.some((prefix) => value.startsWith(prefix))) ||
    DISALLOWED_INTERNAL_REF_PREFIXES.some((prefix) => value.startsWith(prefix)) ||
    value.includes("..") ||
    value.includes("@{") ||
    value.endsWith("/") ||
    value.startsWith("-")
  ) {
    return false;
  }

  return value.split("/").every((component) => {
    return (
      component.length > 0 &&
      !component.startsWith(".") &&
      !component.endsWith(".") &&
      !component.endsWith(".lock")
    );
  });
}

export function parseLimitQuery(value, fallback, max) {
  if (value == null || value === "") {
    return { ok: true, value: fallback };
  }

  const normalized = value.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(normalized)) {
    return { ok: false, error: "Invalid limit parameter" };
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, error: "Invalid limit parameter" };
  }

  return { ok: true, value: Math.min(parsed, max) };
}

export function parseSearchQuery(value) {
  return parseBoundedTextQuery(value, "Invalid search parameter");
}

export function parseAuthorQuery(value) {
  return parseBoundedTextQuery(value, "Invalid author parameter");
}

export function parsePathQuery(value) {
  if (value == null || value === "") {
    return { ok: true, value: "" };
  }

  const parsed = value.trim();
  if (!parsed) {
    return { ok: true, value: "" };
  }
  if (
    parsed.length > 200 ||
    CONTROL_CHARACTER_PATTERN.test(parsed) ||
    parsed.startsWith("/") ||
    parsed.startsWith("-") ||
    parsed.split("/").some((component) => component === "" || component === "." || component === "..")
  ) {
    return { ok: false, error: "Invalid path parameter" };
  }

  return { ok: true, value: parsed };
}

function parseBoundedTextQuery(value, error) {
  if (value == null || value === "") {
    return { ok: true, value: "" };
  }

  const parsed = value.trim();
  if (!parsed) {
    return { ok: true, value: "" };
  }
  if (parsed.length > 100 || CONTROL_CHARACTER_PATTERN.test(parsed)) {
    return { ok: false, error };
  }

  return { ok: true, value: parsed };
}

// Strict ISO 8601 patterns for `--since` / `--until`. We deliberately reject
// `Date.parse`'s loose interpretations (e.g. "2024" alone, two-digit years,
// timezone offsets) so only canonical decimal forms reach Git's date parser.
const DATE_ONLY_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
const DATE_TIME_UTC_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z$/;
const DATE_QUERY_RANGE_MIN_YEAR = 1900;
const DATE_QUERY_RANGE_MAX_YEAR = 2099;
const DATE_QUERY_MAX_LENGTH = 32;
const ALLOWED_GROUP_BY_VALUES = new Set(["prefix", "path", "author"]);
const GROUP_BY_MAX_LENGTH = 16;

/**
 * Parse an ISO 8601 date or date-time query parameter for `git log --since` /
 * `--until`. Returns `{ ok, value }` where `value` is `null` for
 * empty / undefined input (caller decides default behaviour) and the trimmed
 * literal string otherwise. Returns `{ ok: false, error }` for any malformed
 * value: control characters, oversized text, non-decimal digits, regex
 * mismatch, or year outside [1900, 2099].
 *
 * @param {string|null|undefined} rawValue
 * @param {string} paramName  Name used in the public error message.
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
export function parseDateQuery(rawValue, paramName) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: null };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: `Invalid ${paramName} parameter` };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }
  if (
    trimmed.length > DATE_QUERY_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(trimmed)
  ) {
    return { ok: false, error: `Invalid ${paramName} parameter` };
  }
  if (!DATE_ONLY_PATTERN.test(trimmed) && !DATE_TIME_UTC_PATTERN.test(trimmed)) {
    return { ok: false, error: `Invalid ${paramName} parameter` };
  }

  const year = Number(trimmed.slice(0, 4));
  if (
    !Number.isInteger(year) ||
    year < DATE_QUERY_RANGE_MIN_YEAR ||
    year > DATE_QUERY_RANGE_MAX_YEAR
  ) {
    return { ok: false, error: `Invalid ${paramName} parameter` };
  }

  return { ok: true, value: trimmed };
}

/**
 * Parse the `groupBy` query parameter for the period-summary endpoint.
 * Accepts only the literal allowlist (`prefix`, `path`, `author`). Empty /
 * undefined / blank-only input returns `{ ok: true, value: null }` so callers
 * can apply their own default. Anything else returns a public 400 error.
 *
 * @param {string|null|undefined} rawValue
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
export function parseGroupByQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: null };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Invalid groupBy parameter" };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }
  if (
    trimmed.length > GROUP_BY_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(trimmed) ||
    !ALLOWED_GROUP_BY_VALUES.has(trimmed)
  ) {
    return { ok: false, error: "Invalid groupBy parameter" };
  }

  return { ok: true, value: trimmed };
}
