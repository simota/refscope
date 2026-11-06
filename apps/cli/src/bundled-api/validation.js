import fs from "node:fs";
import nodePath from "node:path";

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

/**
 * Whether a fully qualified ref name, as Git resolved it, is one the API may
 * expose: `HEAD` (detached) or a ref under refs/heads, refs/tags, refs/remotes.
 * Used to check what a short name or symref actually pointed at, since
 * `isValidGitRef` only sees the name the client sent.
 *
 * @param {string} value
 * @returns {boolean}
 */
export function isPublicFullRefName(value) {
  return value === "HEAD" || ALLOWED_PUBLIC_REF_PREFIXES.some((prefix) => value.startsWith(prefix));
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

export function parseLimitQuery(value, fallback, max, fieldName = "limit") {
  if (value == null || value === "") {
    return { ok: true, value: fallback };
  }

  const normalized = value.trim();
  if (!POSITIVE_INTEGER_PATTERN.test(normalized)) {
    return { ok: false, error: `Invalid ${fieldName} parameter` };
  }

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return { ok: false, error: `Invalid ${fieldName} parameter` };
  }

  return { ok: true, value: Math.min(parsed, max) };
}

// Upper bound for history pagination offsets (`git log --skip`). Generous
// enough for very deep histories, small enough that a typo cannot make Git
// walk an unbounded number of commits just to discard them.
export const SKIP_QUERY_MAX = 1_000_000;
const SKIP_PATTERN = /^(?:0|[1-9][0-9]{0,6})$/;

/**
 * Parse the `skip` pagination offset for commit lists. Empty / missing → 0.
 * Only canonical non-negative decimal integers up to SKIP_QUERY_MAX pass;
 * `+1`, `01`, `1e3`, `-1`, and `1.5` are rejected.
 *
 * @param {string|null|undefined} value
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function parseSkipQuery(value) {
  if (value == null || value === "") {
    return { ok: true, value: 0 };
  }
  if (typeof value !== "string" || !SKIP_PATTERN.test(value)) {
    return { ok: false, error: "Invalid skip parameter" };
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > SKIP_QUERY_MAX) {
    return { ok: false, error: "Invalid skip parameter" };
  }
  return { ok: true, value: parsed };
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
const DATE_TIME_UTC_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,3})?Z$/;
const DATE_QUERY_RANGE_MIN_YEAR = 1900;
const DATE_QUERY_RANGE_MAX_YEAR = 2099;
const DATE_QUERY_MAX_LENGTH = 32;
const ALLOWED_GROUP_BY_VALUES = new Set(["prefix", "path", "author"]);
const GROUP_BY_MAX_LENGTH = 16;
export const ALLOWED_SEARCH_MODES = new Set(["subject", "pickaxe", "regex", "message"]);
const SEARCH_MODE_MAX_LENGTH = 16;
export const PATTERN_MAX_LENGTH = 200;

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

/**
 * Parse the `mode` query parameter for advanced search mode selection.
 * Accepts only the literal allowlist (`subject`, `pickaxe`, `regex`, `message`).
 * Empty / undefined / blank returns `{ ok: true, value: "subject" }` (default,
 * preserving backward-compatible `search` parameter behaviour).
 *
 * @param {string|null|undefined} rawValue
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function parseSearchModeQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: "subject" };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Invalid mode parameter" };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: true, value: "subject" };
  }
  if (
    trimmed.length > SEARCH_MODE_MAX_LENGTH ||
    CONTROL_CHARACTER_PATTERN.test(trimmed) ||
    !ALLOWED_SEARCH_MODES.has(trimmed)
  ) {
    return { ok: false, error: "Invalid mode parameter" };
  }

  return { ok: true, value: trimmed };
}

/**
 * Parse the `pattern` query parameter for pickaxe / regex / message search
 * modes. Accepts any string up to `PATTERN_MAX_LENGTH` characters that
 * contains no control characters. Hyphen-leading patterns are intentionally
 * allowed here — callers pass them to Git via attached form (`-SPATTERN`,
 * `-GPATTERN`) so Git never misinterprets them as flags.
 *
 * JavaScript does not evaluate the pattern as a regex (ReDoS risk); Git's own
 * timeout (`RTGV_GIT_TIMEOUT_MS`) is the backstop for expensive patterns.
 *
 * @param {string|null|undefined} rawValue
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function parsePatternQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: "" };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Invalid pattern parameter" };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: true, value: "" };
  }
  if (trimmed.length > PATTERN_MAX_LENGTH || CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    return { ok: false, error: "Invalid pattern parameter" };
  }

  return { ok: true, value: trimmed };
}

// ─── Symbol-history funcname validator ──────────────────────────────────────

// Architecture Review flag: funcname is passed directly into a git -L :name:path
// argument. Shell injection is blocked by spawn+shell:false, but we still need
// to prevent git from misreading the argument as a flag (leading `-`) or from
// accepting patterns that embed path separators, shell metacharacters, or
// control bytes. The regex below enforces the tightest safe allowlist:
//   - Must start with a letter or underscore (Git funcname regex convention)
//   - Remaining chars: alphanumeric, underscore, colon (:), dot (.), tilde (~)
//   - Max 128 chars (identical to PATTERN_MAX_LENGTH for consistency)
//   - Leading `-` explicitly rejected (flag-injection prevention, belt-and-suspenders)
//
// Explicitly REJECTED (injection vectors or unsupported):
//   / \ ; & | < > ` $ ( ) space newline CR NUL
//   Any char not in [A-Za-z0-9_:.~]
const FUNCNAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_:.~]{0,127}$/;
const FUNCNAME_MAX_LENGTH = 128;

/**
 * Parse the `funcname` query parameter for the symbol-history endpoint.
 * Accepts identifiers matching Git's funcname convention: starts with a
 * letter or underscore, followed by alphanumeric / `_` / `:` / `.` / `~`.
 *
 * Empty / undefined input returns `{ ok: false }` — funcname is required.
 * Any character outside the allowlist, leading `-`, or length > 128 returns
 * `{ ok: false, error }`.
 *
 * @param {string|null|undefined} rawValue
 * @returns {{ ok: true, value: string } | { ok: false, error: string }}
 */
export function parseFuncNameQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: false, error: "Missing funcname parameter" };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Invalid funcname parameter" };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: false, error: "Missing funcname parameter" };
  }
  if (trimmed.startsWith("-")) {
    return { ok: false, error: "Invalid funcname parameter: must not start with '-'" };
  }
  if (trimmed.length > FUNCNAME_MAX_LENGTH || CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    return { ok: false, error: "Invalid funcname parameter" };
  }
  if (!FUNCNAME_PATTERN.test(trimmed)) {
    return { ok: false, error: "Invalid funcname parameter: only [A-Za-z0-9_:.~] are allowed" };
  }

  return { ok: true, value: trimmed };
}

// ─── Range-history line range validators ────────────────────────────────────

const LINE_NUMBER_PATTERN = /^[0-9]+$/;
const LINE_NUMBER_MAX = 99_999;

/**
 * Parse `lineStart` / `lineEnd` query parameters for the range-history
 * endpoint. Both values must be positive integers in [1, LINE_NUMBER_MAX].
 * Empty / undefined input returns `{ ok: false }` — both are required fields.
 *
 * @param {string|null|undefined} rawValue
 * @param {string} paramName  Name used in the public error message.
 * @returns {{ ok: true, value: number } | { ok: false, error: string }}
 */
export function parseLineNumberQuery(rawValue, paramName) {
  if (rawValue == null || rawValue === "") {
    return { ok: false, error: `Missing ${paramName} parameter` };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: `Invalid ${paramName} parameter` };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "" || !LINE_NUMBER_PATTERN.test(trimmed)) {
    return { ok: false, error: `Invalid ${paramName} parameter` };
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > LINE_NUMBER_MAX) {
    return { ok: false, error: `Invalid ${paramName} parameter: must be integer in [1, ${LINE_NUMBER_MAX}]` };
  }

  return { ok: true, value: parsed };
}

// ─── Cherry-pick graded equivalence validators ──────────────────────────────

const CHERRY_THRESHOLD_PATTERN = /^[0-9]+$/;

/**
 * Parse the `nearIdenticalThreshold` query parameter for the graded
 * cherry-pick equivalence endpoint. Accepts a positive integer in [1, 50].
 * Empty / undefined input returns `{ ok: true, value: null }` so callers
 * can apply the module default (`CHERRY_THRESHOLD_DEFAULT`).
 *
 * @param {string|null|undefined} rawValue
 * @returns {{ ok: true, value: number|null } | { ok: false, error: string }}
 */
export function parseNearIdenticalThresholdQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: null };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Invalid nearIdenticalThreshold parameter" };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }
  if (!CHERRY_THRESHOLD_PATTERN.test(trimmed) || trimmed.length > 4) {
    return { ok: false, error: "Invalid nearIdenticalThreshold parameter" };
  }

  const parsed = Number(trimmed);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    return { ok: false, error: "nearIdenticalThreshold must be an integer in [1, 50]" };
  }

  return { ok: true, value: parsed };
}

// ─── Fleet observation surface validators ───────────────────────────────────

const FLEET_WINDOW_VALUES = new Set(["1h", "6h", "24h", "7d"]);
const FLEET_WINDOW_MAX_LENGTH = 3;
const FLEET_INCLUDE_MAX_TOKENS = 64;

/**
 * Parse the `include` query parameter for the fleet snapshot endpoint.
 * Accepts a comma-separated list of repo IDs, each validated with
 * `isValidRepoId`. Returns `{ ok: true, value: string[] }` on success,
 * `{ ok: true, value: null }` for empty / undefined / blank input (caller
 * defaults to all repos), or `{ ok: false, error }` for any malformed token
 * or list exceeding `FLEET_INCLUDE_MAX_TOKENS` (64) entries.
 *
 * @param {string|null|undefined} rawValue
 * @returns {{ ok: true, value: string[]|null } | { ok: false, error: string }}
 */
export function parseFleetIncludeQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: null };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Invalid include parameter" };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }

  const tokens = trimmed.split(",").map((t) => t.trim()).filter(Boolean);
  if (tokens.length === 0) {
    return { ok: true, value: null };
  }
  if (tokens.length > FLEET_INCLUDE_MAX_TOKENS) {
    return { ok: false, error: "Invalid include parameter: too many entries" };
  }

  for (const token of tokens) {
    if (!isValidRepoId(token)) {
      return { ok: false, error: `Invalid include parameter: invalid id '${token}'` };
    }
  }

  // A repeated id would be observed (and counted in estimatedCost) twice.
  return { ok: true, value: [...new Set(tokens)] };
}

/**
 * Parse the `window` query parameter for the fleet snapshot endpoint.
 * Accepts one of the literal values `1h`, `6h`, `24h`, `7d`. Returns
 * `{ ok: true, value: string }` for valid input, `{ ok: true, value: null }`
 * for empty / undefined / blank input (caller applies its own default, `24h`),
 * or `{ ok: false, error }` for any value outside the allowlist.
 *
 * @param {string|null|undefined} rawValue
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
export function parseFleetWindowQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: null };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Invalid window parameter" };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }
  if (trimmed.length > FLEET_WINDOW_MAX_LENGTH || !FLEET_WINDOW_VALUES.has(trimmed)) {
    return { ok: false, error: "Invalid window parameter" };
  }

  return { ok: true, value: trimmed };
}

/**
 * Validate a HOST bind address for the Refscope API server.
 * Accepts only localhost-class addresses: `127.0.0.1`, any address in the
 * `127.0.0.0/8` range, `::1`, and the hostname `localhost`. All other values
 * (including `0.0.0.0`, `::`, link-local addresses such as `fe80::`, and
 * public IP literals) are rejected by default.
 *
 * If `RTGV_BIND_PUBLIC=1` is present in the environment at call time, the
 * function sets `escapeHatchUsed: true` and accepts the value anyway — the
 * caller (config.js) is responsible for printing the warning.
 *
 * @param {string} value - The raw HOST value to validate.
 * @param {{ RTGV_BIND_PUBLIC?: string }} [env] - Environment overrides (defaults to process.env).
 * @returns {{ accepted: boolean, escapeHatchUsed: boolean, reason?: string }}
 */
export function parseHost(value, env = process.env) {
  if (typeof value !== "string" || value.trim() === "") {
    return { accepted: false, escapeHatchUsed: false, reason: "HOST must not be empty" };
  }

  const host = value.trim();
  const escapeHatchActive = env.RTGV_BIND_PUBLIC === "1";

  if (isLocalhostAddress(host)) {
    return { accepted: true, escapeHatchUsed: false };
  }

  // Reject all non-localhost addresses; honor escape hatch if set.
  if (escapeHatchActive) {
    return { accepted: true, escapeHatchUsed: true };
  }

  return {
    accepted: false,
    escapeHatchUsed: false,
    reason: `HOST must be 127.0.0.1 / ::1 / localhost. Got: ${host}. Set RTGV_BIND_PUBLIC=1 to override (not recommended).`,
  };
}

// ─── POST /api/repos input contract ─────────────────────────────────────────

const POST_BODY_MAX_BYTES = 4096;

/**
 * Parse and validate a raw POST request body against a literal type schema.
 * Enforces a 4 KB size cap (DoS prevention), strict JSON parsing,
 * additionalProperties:false semantics, required-field presence, and
 * per-field type checking. All validation failures return structured
 * `{ ok: false, error }` results that are safe to forward to the UI layer.
 *
 * @param {Buffer|string} buffer  Raw request body.
 * @param {{ [field: string]: "string" | "number" | "boolean" }} schema
 *   Literal type spec; every key is required and must match the declared type.
 *   No extra keys are permitted in the parsed object.
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parsePostBodyJson(buffer, schema) {
  // 4 KB cap — check byte length before any decode work.
  const byteLength =
    Buffer.isBuffer(buffer) ? buffer.length : Buffer.byteLength(buffer, "utf8");
  if (byteLength > POST_BODY_MAX_BYTES) {
    return { ok: false, error: "Request body too large" };
  }

  // Decode & parse.
  let parsed;
  try {
    const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : buffer;
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, error: "Invalid JSON body" };
  }

  // Must be a plain object (not array, null, primitive).
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: "Invalid JSON body" };
  }

  // additionalProperties: false — reject keys not declared in schema.
  for (const key of Object.keys(parsed)) {
    if (!Object.prototype.hasOwnProperty.call(schema, key)) {
      return { ok: false, error: `Unexpected field: ${key}` };
    }
  }

  // Required fields presence + type check.
  for (const [field, expectedType] of Object.entries(schema)) {
    if (!Object.prototype.hasOwnProperty.call(parsed, field)) {
      return { ok: false, error: `Missing field: ${field}` };
    }
    if (typeof parsed[field] !== expectedType) {
      return { ok: false, error: `Field ${field} must be ${expectedType}` };
    }
  }

  return { ok: true, value: parsed };
}

/**
 * Validate user-supplied `{ id, path }` for POST /api/repos.
 * Runs in declaration order; returns the first failure encountered.
 *
 * Validation steps:
 *  1. `isValidRepoId(id)` — allowlist of safe characters.
 *  2. `path.isAbsolute(rawPath)` — no relative paths.
 *  3. `fs.existsSync(rawPath)` — path must exist on disk.
 *  4. `fs.realpathSync(rawPath)` — resolve symlinks to canonical path.
 *  5. `.git` directory or file must exist at the canonical path root.
 *
 * @param {{ id: string, path: string }} input
 * @returns {{ ok: true, value: { id: string, normalizedPath: string } } | { ok: false, error: string }}
 */
export function validateRepoAddInput({ id, path: rawPath }) {
  // Step 1: repo id format.
  if (!isValidRepoId(id)) {
    return { ok: false, error: "Invalid repo id" };
  }

  // Step 2: path must be absolute.
  if (!nodePath.isAbsolute(rawPath)) {
    return { ok: false, error: "Path must be absolute" };
  }

  // Step 3: path must exist on disk.
  if (!fs.existsSync(rawPath)) {
    return { ok: false, error: "Path does not exist" };
  }

  // Step 4: resolve symlinks to canonical path (symlink attack prevention).
  let normalizedPath;
  try {
    normalizedPath = fs.realpathSync(rawPath);
  } catch {
    return { ok: false, error: "Path does not exist" };
  }

  // Step 5: must be a Git working tree root (.git directory or file present).
  if (!fs.existsSync(nodePath.join(normalizedPath, ".git"))) {
    return { ok: false, error: "Path is not a Git working tree root" };
  }

  return { ok: true, value: { id, normalizedPath } };
}

/**
 * Returns true if the given host string is a localhost-class address:
 * - The hostname `localhost`
 * - The IPv4 loopback block `127.0.0.0/8` (i.e. anything starting with `127.`)
 * - The IPv6 loopback `::1`
 *
 * Everything else (including `0.0.0.0`, `::`, `fe80::`, public IPs) is false.
 *
 * @param {string} host
 * @returns {boolean}
 */
// Branch group prefix constants. Prefix string is matched against the short
// ref name (e.g. `refactor/`, `feat/`). Max length matches REF_PATTERN to
// avoid unbounded input but is shorter in practice — typical prefixes are
// under 20 characters.
const BRANCH_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._/@+-]{0,49}\/$/;
const BRANCH_PREFIX_MAX_LENGTH = 51; // up to 50 chars + trailing slash
export const BRANCH_GROUP_MAX_BRANCHES = 500;

/**
 * Parse the `prefix` query parameter for the branch group health endpoint.
 * Accepts a conventional-commit-style prefix that ends with `/`
 * (e.g. `refactor/`, `feat/`). Empty / undefined returns
 * `{ ok: true, value: null }` so callers can apply a default.
 *
 * @param {string|null|undefined} rawValue
 * @returns {{ ok: true, value: string|null } | { ok: false, error: string }}
 */
export function parseBranchPrefixQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: null };
  }
  if (typeof rawValue !== "string") {
    return { ok: false, error: "Invalid prefix parameter" };
  }

  const trimmed = rawValue.trim();
  if (trimmed === "") {
    return { ok: true, value: null };
  }
  if (trimmed.length > BRANCH_PREFIX_MAX_LENGTH) {
    return { ok: false, error: "Invalid prefix parameter: too long" };
  }
  if (CONTROL_CHARACTER_PATTERN.test(trimmed)) {
    return { ok: false, error: "Invalid prefix parameter" };
  }
  // Must match safe branch prefix pattern: alphanumeric start, ends with /
  if (!BRANCH_PREFIX_PATTERN.test(trimmed)) {
    return { ok: false, error: "Invalid prefix parameter: must match pattern [A-Za-z0-9...]+/" };
  }

  return { ok: true, value: trimmed };
}

const HOST_HEADER_PORT_PATTERN = /^[0-9]{1,5}$/;

/**
 * Check that an HTTP `Host` header names a loopback interface
 * (`localhost`, `127.0.0.0/8`, or `[::1]`, with an optional port).
 *
 * A loopback-bound server must still check this header: with DNS rebinding a
 * hostile page can resolve its own hostname to 127.0.0.1, after which the
 * browser treats the API as same-origin with the attacker and sends
 * `Host: attacker.example`. Rejecting non-loopback Host values closes that path.
 *
 * @param {unknown} value - raw `Host` header value
 * @returns {boolean}
 */
export function isLoopbackHostHeader(value) {
  if (typeof value !== "string" || value === "") {
    return false;
  }

  let hostname;
  let port = null;
  if (value.startsWith("[")) {
    const closing = value.indexOf("]");
    if (closing === -1) {
      return false;
    }
    hostname = value.slice(1, closing);
    const rest = value.slice(closing + 1);
    if (rest !== "") {
      if (!rest.startsWith(":")) {
        return false;
      }
      port = rest.slice(1);
    }
    if (hostname !== "::1") {
      return false;
    }
  } else {
    const parts = value.split(":");
    if (parts.length > 2) {
      return false;
    }
    hostname = parts[0].toLowerCase();
    port = parts.length === 2 ? parts[1] : null;
    if (!isLocalhostAddress(hostname)) {
      return false;
    }
  }

  return port === null || (HOST_HEADER_PORT_PATTERN.test(port) && Number(port) <= 65535);
}

function isLocalhostAddress(host) {
  if (host === "localhost" || host === "::1") {
    return true;
  }
  // IPv4 loopback block: 127.0.0.0/8
  if (/^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)) {
    const parts = host.split(".").map(Number);
    return parts.every((p) => p >= 0 && p <= 255);
  }
  return false;
}

/**
 * Compare review mode for `/compare/commits`-adjacent diff reads.
 *
 * - `three-dot` (default): changes `target` introduced since its merge base
 *   with `base` — the pull-request view (`git diff base...target`).
 * - `two-dot`: the direct tree difference between `base` and `target`
 *   (`git diff base target`), matching the compare summary counts.
 *
 * Empty / missing → `three-dot`. Anything else is rejected.
 */
export const COMPARE_MODES = new Set(["three-dot", "two-dot"]);

export function parseCompareModeQuery(rawValue) {
  if (rawValue == null || rawValue === "") {
    return { ok: true, value: "three-dot" };
  }
  if (typeof rawValue !== "string" || !COMPARE_MODES.has(rawValue)) {
    return { ok: false, error: "Invalid mode parameter" };
  }
  return { ok: true, value: rawValue };
}
