/**
 * structuralDiff.js — Language-agnostic heuristic structural diff classifier.
 *
 * OBSERVATION vs DERIVATION boundary:
 *   Observation: Git-literal values (added lines, deleted lines, patch text).
 *   Derivation:  Refscope-computed labels (`structuralKind`). These are
 *                heuristic estimates, not semantic equivalence claims.
 *
 * This module contains only pure functions with no I/O. All exports are
 * testable in isolation with node:test.
 *
 * @module structuralDiff
 */

// ---------------------------------------------------------------------------
// Token extraction
// ---------------------------------------------------------------------------

/**
 * Extract identifier tokens from a line of source code.
 * Strips leading diff markers (+/-/ ) and normalises case + whitespace.
 *
 * Pure function — no side effects.
 *
 * @param {string} line
 * @returns {string[]}
 */
export function extractTokens(line) {
  // Strip leading diff marker (+/-/ ) if present
  const stripped = /^[+\- ]/.test(line) ? line.slice(1) : line;
  // Remove comment noise at the token level — extract identifier-like tokens
  // ([A-Za-z_]\w*) only; punctuation, numbers, and whitespace are ignored.
  return (stripped.match(/[A-Za-z_]\w*/g) ?? []).map((t) => t.toLowerCase());
}

// ---------------------------------------------------------------------------
// Token similarity (Jaccard)
// ---------------------------------------------------------------------------

/**
 * Compute Jaccard similarity between two token multisets.
 * Returns a value in [0.0, 1.0]. Empty inputs → 1.0 (no change = identical).
 *
 * Derivation: this is a Refscope-computed approximation, not a semantic claim.
 *
 * @param {string[]} addedTokens
 * @param {string[]} deletedTokens
 * @returns {number}
 */
export function jaccardSimilarity(addedTokens, deletedTokens) {
  if (addedTokens.length === 0 && deletedTokens.length === 0) return 1.0;

  const added = new Set(addedTokens);
  const deleted = new Set(deletedTokens);

  let intersection = 0;
  for (const token of added) {
    if (deleted.has(token)) intersection++;
  }

  const union = added.size + deleted.size - intersection;
  return union === 0 ? 1.0 : intersection / union;
}

// ---------------------------------------------------------------------------
// Comment-line detection
// ---------------------------------------------------------------------------

/** Patterns that identify comment-only lines (language-agnostic best-effort). */
const COMMENT_PATTERNS = [
  /^\s*\/\//,        // // …  (JavaScript, TypeScript, Go, Rust, Java, C)
  /^\s*#/,           // # …   (Python, Ruby, Shell, YAML)
  /^\s*\/\*/,        // /* …  (block comment open)
  /^\s*\*\//,        // */ …  (block comment close)
  /^\s*\*/           ,        // * …   (block comment body)
  /^\s*<!--/,        // <!-- … (HTML/XML open)
  /^\s*-->/,         // --> …  (HTML/XML close)
];

/**
 * Return true when a source line (without diff marker) is a comment or blank.
 *
 * @param {string} content
 * @returns {boolean}
 */
export function isCommentOrBlank(content) {
  const trimmed = content.trim();
  if (!trimmed) return true;
  return COMMENT_PATTERNS.some((re) => re.test(content));
}

// ---------------------------------------------------------------------------
// Whitespace normalisation
// ---------------------------------------------------------------------------

/**
 * Normalise a source line by collapsing all whitespace to single spaces and
 * trimming. Used to compare added vs deleted lines ignoring formatting.
 *
 * @param {string} line
 * @returns {string}
 */
export function normaliseWhitespace(line) {
  return line.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// Core classifier
// ---------------------------------------------------------------------------

/**
 * @typedef {'whitespace_only'|'comment_only'|'rename_only'|'symmetric'|'logic_change'|'mixed'} StructuralKind
 */

/**
 * Classify the structural kind of a unified-diff patch for a single file.
 *
 * Priority order (first matching rule wins):
 *   1. whitespace_only  — all changed lines differ only in whitespace
 *   2. comment_only     — all changed lines are comment or blank
 *   3. rename_only      — tokenSimilarity ≥ 0.95 AND added ≈ deleted
 *   4. symmetric        — tokenSimilarity ≥ 0.80 (structurally close)
 *   5. logic_change     — tokenSimilarity < 0.50 (significant change)
 *   6. mixed            — everything else
 *
 * This is a DERIVATION (heuristic). Refscope does NOT claim semantic
 * equivalence. "rename_only" means token-overlap is very high, not that
 * no behaviour changed.
 *
 * @param {{ added: number; deleted: number; patch?: string }} fileDiff
 *   - `added`   — numstat added lines (observation from Git)
 *   - `deleted` — numstat deleted lines (observation from Git)
 *   - `patch`   — unified diff text for this file (optional; improves accuracy)
 * @returns {{ kind: StructuralKind; signals: { tokenSimilarity: number; symmetry: number; whiteSpaceOnly: boolean; commentOnly: boolean } }}
 */
export function classifyFileDiff({ added, deleted, patch }) {
  // Binary files: numstat reports -1 for binary entries.
  if (added === -1 || deleted === -1) {
    return {
      kind: "mixed",
      signals: { tokenSimilarity: 0, symmetry: 0, whiteSpaceOnly: false, commentOnly: false },
    };
  }

  // No changes at all (e.g. mode-only change):
  if (added === 0 && deleted === 0) {
    return {
      kind: "whitespace_only",
      signals: { tokenSimilarity: 1, symmetry: 1, whiteSpaceOnly: true, commentOnly: false },
    };
  }

  // Parse added/deleted lines from patch (if provided).
  const addedLines = [];
  const deletedLines = [];

  if (patch) {
    for (const raw of patch.split("\n")) {
      if (raw.startsWith("+") && !raw.startsWith("+++")) {
        addedLines.push(raw.slice(1));
      } else if (raw.startsWith("-") && !raw.startsWith("---")) {
        deletedLines.push(raw.slice(1));
      }
    }
  }

  // -----------------------------------------------------------------------
  // Signal 1: whitespace-only check
  // If the patch is available, compare normalised lines. When normalisations
  // of both sides are identical sets the only change is whitespace.
  // -----------------------------------------------------------------------
  let whiteSpaceOnly = false;
  if (patch && addedLines.length > 0 && deletedLines.length > 0) {
    const normAdded = addedLines.map(normaliseWhitespace).sort();
    const normDeleted = deletedLines.map(normaliseWhitespace).sort();
    whiteSpaceOnly =
      normAdded.length === normDeleted.length &&
      normAdded.every((l, i) => l === normDeleted[i]);
  }

  if (whiteSpaceOnly) {
    return {
      kind: "whitespace_only",
      signals: { tokenSimilarity: 1, symmetry: 1, whiteSpaceOnly: true, commentOnly: false },
    };
  }

  // -----------------------------------------------------------------------
  // Signal 2: comment-only check
  // -----------------------------------------------------------------------
  let commentOnly = false;
  if (patch && (addedLines.length > 0 || deletedLines.length > 0)) {
    const allChangedAreComments =
      [...addedLines, ...deletedLines].every(isCommentOrBlank);
    commentOnly = allChangedAreComments;
  }

  if (commentOnly) {
    return {
      kind: "comment_only",
      signals: { tokenSimilarity: 1, symmetry: 1, whiteSpaceOnly: false, commentOnly: true },
    };
  }

  // -----------------------------------------------------------------------
  // Signal 3: token similarity (Jaccard on identifier tokens)
  // -----------------------------------------------------------------------
  let tokenSimilarity = 0.5; // default when no patch is available
  if (patch) {
    const addedTokens = addedLines.flatMap(extractTokens);
    const deletedTokens = deletedLines.flatMap(extractTokens);
    tokenSimilarity = jaccardSimilarity(addedTokens, deletedTokens);
  }

  // -----------------------------------------------------------------------
  // Signal 4: line symmetry
  // symmetry = 1 when added === deleted, approaches 0 when very asymmetric
  // -----------------------------------------------------------------------
  const maxLines = Math.max(added, deleted, 1);
  const symmetry = 1 - Math.abs(added - deleted) / maxLines;

  // -----------------------------------------------------------------------
  // Classification (priority order)
  // -----------------------------------------------------------------------

  // rename_only: very high token overlap AND symmetric line counts
  if (tokenSimilarity >= 0.95 && symmetry >= 0.9) {
    return {
      kind: "rename_only",
      signals: { tokenSimilarity, symmetry, whiteSpaceOnly: false, commentOnly: false },
    };
  }

  // symmetric: structurally close (high token similarity)
  if (tokenSimilarity >= 0.80) {
    return {
      kind: "symmetric",
      signals: { tokenSimilarity, symmetry, whiteSpaceOnly: false, commentOnly: false },
    };
  }

  // logic_change: low token similarity → significant change
  if (tokenSimilarity < 0.50) {
    return {
      kind: "logic_change",
      signals: { tokenSimilarity, symmetry, whiteSpaceOnly: false, commentOnly: false },
    };
  }

  // mixed: medium similarity — unclear structural intent
  return {
    kind: "mixed",
    signals: { tokenSimilarity, symmetry, whiteSpaceOnly: false, commentOnly: false },
  };
}

// ---------------------------------------------------------------------------
// Aggregate kind for a whole commit (derived from per-file kinds)
// ---------------------------------------------------------------------------

/** Priority ordering for aggregation: the "worst" kind wins. */
const KIND_PRIORITY = {
  whitespace_only: 0,
  comment_only: 1,
  rename_only: 2,
  symmetric: 3,
  mixed: 4,
  logic_change: 5,
};

/**
 * Aggregate per-file structural kinds into a single commit-level kind.
 * The "most significant" kind wins (logic_change > mixed > … > whitespace_only).
 *
 * Derivation: this roll-up is a Refscope heuristic.
 *
 * @param {StructuralKind[]} kinds
 * @returns {StructuralKind}
 */
export function aggregateKinds(kinds) {
  if (!kinds || kinds.length === 0) return "mixed";
  return kinds.reduce((worst, current) => {
    const w = KIND_PRIORITY[worst] ?? 4;
    const c = KIND_PRIORITY[current] ?? 4;
    return c > w ? current : worst;
  }, "whitespace_only");
}
