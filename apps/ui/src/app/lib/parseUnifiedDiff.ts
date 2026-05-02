/**
 * Unified diff parser.
 *
 * Consumes the raw stdout produced by `git show <hash> --patch --no-color
 * --no-ext-diff --no-textconv --find-renames --stat` (and similar `git diff`
 * outputs) and produces a structured AST keyed by file. The parser is
 * intentionally permissive: malformed lines are accumulated into the file's
 * `headerLines` and the parser keeps walking — it never throws.
 *
 * Why hand-rolled instead of a library: the API server limits diff output to
 * `RTGV_DIFF_MAX_BYTES` (default 4 MB) and rejects everything dangerous
 * before spawn, so the parser only ever sees small, well-formed-ish output.
 * A 200-line state machine fits this contract better than a 50-KB dependency.
 */

/** A single line in a hunk body. Discriminated by `kind`. */
export type DiffLine =
  | { kind: "context"; text: string; oldLineNo: number; newLineNo: number }
  | { kind: "add"; text: string; newLineNo: number }
  | { kind: "del"; text: string; oldLineNo: number }
  | { kind: "no-newline"; text: string };

/** A hunk: a contiguous range of changes inside a single file. */
export type DiffHunk = {
  /** Original `@@ -a,b +c,d @@ heading` header line, verbatim. */
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Function/section heading text after the closing `@@`, or `""`. */
  sectionHeading: string;
  lines: DiffLine[];
};

/**
 * High-level classification for the file. We do not invent categories: each
 * value here is grounded in a literal marker that appears in the diff
 * (`Binary files`, `--- /dev/null`, `rename from`, `old mode`, etc.).
 */
export type DiffChangeKind =
  | "added"
  | "deleted"
  | "modified"
  | "renamed"
  | "copied"
  | "mode-changed"
  | "binary"
  | "unknown";

/** A single file entry in the parsed diff. */
export type DiffFile = {
  /**
   * Every header line associated with this file, including `diff --git`,
   * extended headers (`old mode`, `new mode`, `similarity index`, `rename
   * from/to`, `copy from/to`, `index`, `Binary files …`), and the `--- a/…`
   * / `+++ b/…` markers. Preserved verbatim for diagnostics and for cases
   * the renderer wants to surface (e.g. mode change).
   */
  headerLines: string[];
  /** `--- a/<path>`; `null` when source is `/dev/null`. */
  oldPath: string | null;
  /** `+++ b/<path>`; `null` when target is `/dev/null`. */
  newPath: string | null;
  /** What we display in the file list. Falls back gracefully. */
  displayPath: string;
  changeKind: DiffChangeKind;
  /** Similarity percentage for renamed/copied files, else `null`. */
  similarity: number | null;
  /** True iff a `Binary files … differ` marker was seen. */
  isBinary: boolean;
  hunks: DiffHunk[];
};

/** The full parsed result. */
export type ParsedDiff = {
  files: DiffFile[];
  /**
   * Lines that appeared before the first `diff --git` header (e.g. the leading
   * `--stat` block from `git show --stat`). Renderers can ignore this.
   */
  preamble: string[];
};

/**
 * Hunk header regex. Anchored at the start of the line, both line counts are
 * optional (a header like `@@ -1 +1 @@` means "exactly one line"). Bounded
 * character classes prevent ReDoS on adversarial input.
 */
const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/;

const DIFF_GIT_PREFIX = "diff --git ";
const SIMILARITY_RE = /^(?:similarity|dissimilarity) index (\d{1,3})%\s*$/;
const BINARY_LINE_RE = /^Binary files (.+) and (.+) differ\s*$/;

/**
 * Parse a unified diff string into a structured AST.
 * Never throws. Unknown / malformed input falls into `headerLines` or
 * `preamble` so the caller can still render something.
 */
export function parseUnifiedDiff(raw: string): ParsedDiff {
  const files: DiffFile[] = [];
  const preamble: string[] = [];

  if (!raw) return { files, preamble };

  const lines = raw.split("\n");
  let current: DiffFile | null = null;
  let currentHunk: DiffHunk | null = null;
  let cursorOldLineNo = 0;
  let cursorNewLineNo = 0;

  const finalizeHunk = () => {
    if (current && currentHunk) {
      current.hunks.push(currentHunk);
    }
    currentHunk = null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];

    // The trailing split("\n") yields a final empty string for diffs ending
    // with a newline. Skip it so it does not become a phantom context line.
    if (i === lines.length - 1 && line === "") continue;

    if (line.startsWith(DIFF_GIT_PREFIX)) {
      finalizeHunk();
      if (current) files.push(current);
      current = createFile(line);
      continue;
    }

    if (!current) {
      preamble.push(line);
      continue;
    }

    if (line.startsWith("@@")) {
      finalizeHunk();
      const parsed = parseHunkHeader(line);
      if (parsed) {
        currentHunk = parsed;
        cursorOldLineNo = parsed.oldStart;
        cursorNewLineNo = parsed.newStart;
        // Modified marker; finer kinds (added/deleted/renamed) take precedence
        // and are decided from extended headers below.
        if (current.changeKind === "unknown") {
          current.changeKind = "modified";
        }
      } else {
        // Malformed header — keep raw line so nothing is silently dropped.
        current.headerLines.push(line);
      }
      continue;
    }

    if (currentHunk) {
      const result = consumeHunkLine(line, cursorOldLineNo, cursorNewLineNo);
      if (result) {
        currentHunk.lines.push(result.line);
        cursorOldLineNo = result.oldLineNo;
        cursorNewLineNo = result.newLineNo;
        continue;
      }
      // Line did not look like a hunk body line. Treat as end-of-hunk and
      // re-process via the header path on the next iteration.
      finalizeHunk();
      i -= 1;
      continue;
    }

    // Extended header line for the current file.
    classifyHeaderLine(current, line);
    current.headerLines.push(line);
  }

  finalizeHunk();
  if (current) files.push(current);

  for (const file of files) {
    file.displayPath = computeDisplayPath(file);
    if (file.changeKind === "unknown") {
      file.changeKind = inferFallbackChangeKind(file);
    }
  }

  return { files, preamble };
}

/** Aggregate add / del counts across all hunks of a file. */
export function countFileChanges(file: DiffFile): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const hunk of file.hunks) {
    for (const line of hunk.lines) {
      if (line.kind === "add") added += 1;
      else if (line.kind === "del") deleted += 1;
    }
  }
  return { added, deleted };
}

/** Aggregate add / del counts across an entire parsed diff. */
export function countTotalChanges(parsed: ParsedDiff): {
  added: number;
  deleted: number;
} {
  let added = 0;
  let deleted = 0;
  for (const file of parsed.files) {
    const counts = countFileChanges(file);
    added += counts.added;
    deleted += counts.deleted;
  }
  return { added, deleted };
}

/**
 * Reconstruct the raw diff text for a single file (header + hunks).
 * Used for the file-level "copy" action so the user can paste a Git-valid
 * patch fragment.
 */
export function fileToDiffText(file: DiffFile): string {
  const out: string[] = [];
  for (const header of file.headerLines) out.push(header);
  for (const hunk of file.hunks) {
    out.push(hunk.header);
    for (const line of hunk.lines) out.push(reconstructLine(line));
  }
  return out.join("\n");
}

function reconstructLine(line: DiffLine): string {
  switch (line.kind) {
    case "add":
      return `+${line.text}`;
    case "del":
      return `-${line.text}`;
    case "context":
      return ` ${line.text}`;
    case "no-newline":
      return line.text;
  }
}

/** Parse a single `@@ -a,b +c,d @@ heading` line, returning `null` on failure. */
export function parseHunkHeader(line: string): DiffHunk | null {
  const match = HUNK_HEADER_RE.exec(line);
  if (!match) return null;
  const oldStart = Number(match[1]);
  const oldLines = match[2] === undefined ? 1 : Number(match[2]);
  const newStart = Number(match[3]);
  const newLines = match[4] === undefined ? 1 : Number(match[4]);
  if (
    !Number.isFinite(oldStart) ||
    !Number.isFinite(oldLines) ||
    !Number.isFinite(newStart) ||
    !Number.isFinite(newLines)
  ) {
    return null;
  }
  return {
    header: line,
    oldStart,
    oldLines,
    newStart,
    newLines,
    sectionHeading: match[5].trim(),
    lines: [],
  };
}

function consumeHunkLine(
  line: string,
  oldLineNo: number,
  newLineNo: number,
): { line: DiffLine; oldLineNo: number; newLineNo: number } | null {
  // An empty line inside a hunk body is a context line containing just the
  // newline. Treat it as such instead of bailing out.
  if (line === "") {
    return {
      line: { kind: "context", text: "", oldLineNo, newLineNo },
      oldLineNo: oldLineNo + 1,
      newLineNo: newLineNo + 1,
    };
  }
  const sigil = line[0];
  const text = line.slice(1);
  if (sigil === " ") {
    return {
      line: { kind: "context", text, oldLineNo, newLineNo },
      oldLineNo: oldLineNo + 1,
      newLineNo: newLineNo + 1,
    };
  }
  if (sigil === "+") {
    return {
      line: { kind: "add", text, newLineNo },
      oldLineNo,
      newLineNo: newLineNo + 1,
    };
  }
  if (sigil === "-") {
    return {
      line: { kind: "del", text, oldLineNo },
      oldLineNo: oldLineNo + 1,
      newLineNo,
    };
  }
  if (sigil === "\\") {
    // `\ No newline at end of file` — does not advance either cursor.
    return {
      line: { kind: "no-newline", text: line },
      oldLineNo,
      newLineNo,
    };
  }
  return null;
}

function createFile(headerLine: string): DiffFile {
  return {
    headerLines: [headerLine],
    oldPath: null,
    newPath: null,
    displayPath: "(unknown)",
    changeKind: "unknown",
    similarity: null,
    isBinary: false,
    hunks: [],
  };
}

function classifyHeaderLine(file: DiffFile, line: string): void {
  if (line.startsWith("--- ")) {
    file.oldPath = parseDiffSidePath(line.slice(4), "a/");
    return;
  }
  if (line.startsWith("+++ ")) {
    file.newPath = parseDiffSidePath(line.slice(4), "b/");
    if (file.oldPath === null && file.newPath !== null) {
      file.changeKind = "added";
    } else if (file.oldPath !== null && file.newPath === null) {
      file.changeKind = "deleted";
    }
    return;
  }
  if (line.startsWith("rename from ")) {
    file.changeKind = "renamed";
    if (file.oldPath === null) file.oldPath = line.slice("rename from ".length);
    return;
  }
  if (line.startsWith("rename to ")) {
    file.changeKind = "renamed";
    if (file.newPath === null) file.newPath = line.slice("rename to ".length);
    return;
  }
  if (line.startsWith("copy from ")) {
    file.changeKind = "copied";
    if (file.oldPath === null) file.oldPath = line.slice("copy from ".length);
    return;
  }
  if (line.startsWith("copy to ")) {
    file.changeKind = "copied";
    if (file.newPath === null) file.newPath = line.slice("copy to ".length);
    return;
  }
  const similarity = SIMILARITY_RE.exec(line);
  if (similarity) {
    const value = Number(similarity[1]);
    if (Number.isFinite(value)) file.similarity = value;
    return;
  }
  if (line.startsWith("new file mode")) {
    if (file.changeKind === "unknown") file.changeKind = "added";
    return;
  }
  if (line.startsWith("deleted file mode")) {
    if (file.changeKind === "unknown") file.changeKind = "deleted";
    return;
  }
  if (line.startsWith("old mode") || line.startsWith("new mode")) {
    if (file.changeKind === "unknown") file.changeKind = "mode-changed";
    return;
  }
  if (BINARY_LINE_RE.test(line)) {
    file.isBinary = true;
    if (file.changeKind === "unknown" || file.changeKind === "modified") {
      file.changeKind = "binary";
    }
    // Even when classified as added/deleted/renamed we still want isBinary
    // so the renderer can suppress hunk drawing.
    return;
  }
}

/**
 * Strip the `a/` or `b/` prefix that Git emits for diff side paths. `/dev/null`
 * is returned as `null` so callers can distinguish "no such file" from empty
 * paths.
 */
export function parseDiffSidePath(rest: string, expectedPrefix: "a/" | "b/"): string | null {
  const trimmed = rest.trim();
  if (trimmed === "/dev/null") return null;
  if (trimmed.startsWith(expectedPrefix)) return trimmed.slice(expectedPrefix.length);
  return trimmed;
}

function computeDisplayPath(file: DiffFile): string {
  return file.newPath ?? file.oldPath ?? extractDiffGitPath(file.headerLines[0]) ?? "(unknown)";
}

/**
 * Extract the path from the `diff --git a/X b/Y` line as a last-resort
 * fallback when both `---`/`+++` markers are absent (e.g. mode-only changes).
 * Picks the `b/` side since it is what the user is moving toward.
 */
function extractDiffGitPath(headerLine: string | undefined): string | null {
  if (!headerLine) return null;
  const rest = headerLine.slice(DIFF_GIT_PREFIX.length);
  // Walk from the end until we find ` b/`; this avoids choking on paths
  // containing literal spaces.
  const marker = " b/";
  const idx = rest.lastIndexOf(marker);
  if (idx === -1) return null;
  return rest.slice(idx + marker.length);
}

function inferFallbackChangeKind(file: DiffFile): DiffChangeKind {
  if (file.isBinary) return "binary";
  if (file.hunks.length > 0) return "modified";
  return "unknown";
}
