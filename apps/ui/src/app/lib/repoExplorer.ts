/**
 * Pure helpers for the repository browser (files + code search at a commit)
 * and the reflog explorer. No React, no fetch — unit-tested under node:test.
 */

// ─── Go to file ─────────────────────────────────────────────────────────────

export type RankedPath = {
  path: string;
  /** Indices into `path` that matched the query, for highlighting. */
  positions: number[];
  score: number;
};

/**
 * Rank `paths` against a "go to file" query, best first.
 *
 * Whitespace splits the query into terms that must all match. A term matches
 * as a contiguous substring (strongest when inside the file name) or, failing
 * that, as an in-order subsequence (`gsvc` → `gitService.js`). Matching is
 * case-insensitive. Shorter paths win ties so `src/app.ts` beats a deeply
 * nested namesake.
 */
export function rankPaths(paths: readonly string[], query: string, limit = 50): RankedPath[] {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return [];
  const ranked: RankedPath[] = [];
  for (const path of paths) {
    const lower = path.toLowerCase();
    const baseStart = lower.lastIndexOf("/") + 1;
    let score = 0;
    const positions: number[] = [];
    let ok = true;
    for (const term of terms) {
      const match = matchTerm(lower, baseStart, term);
      if (!match) {
        ok = false;
        break;
      }
      score += match.score;
      positions.push(...match.positions);
    }
    if (!ok) continue;
    score -= path.length * 0.01;
    ranked.push({ path, positions: [...new Set(positions)].sort((a, b) => a - b), score });
  }
  ranked.sort((a, b) => b.score - a.score || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return ranked.slice(0, limit);
}

function matchTerm(lower: string, baseStart: number, term: string): { score: number; positions: number[] } | null {
  const inBase = lower.indexOf(term, baseStart);
  if (inBase !== -1) {
    const exactBase = inBase === baseStart && lower.length - baseStart === term.length;
    const prefix = inBase === baseStart;
    return {
      score: 100 + (exactBase ? 60 : prefix ? 30 : 0) + term.length,
      positions: range(inBase, term.length),
    };
  }
  const anywhere = lower.indexOf(term);
  if (anywhere !== -1) {
    const segmentStart = anywhere === 0 || lower[anywhere - 1] === "/";
    return { score: 60 + (segmentStart ? 10 : 0) + term.length, positions: range(anywhere, term.length) };
  }
  // In-order subsequence; prefer runs that land in the file name.
  const positions: number[] = [];
  let from = 0;
  for (const char of term) {
    const at = lower.indexOf(char, from);
    if (at === -1) return null;
    positions.push(at);
    from = at + 1;
  }
  const inName = positions.filter((p) => p >= baseStart).length;
  const spread = positions[positions.length - 1] - positions[0];
  return { score: 20 + inName * 2 - spread * 0.1, positions };
}

function range(start: number, length: number): number[] {
  return Array.from({ length }, (_, i) => start + i);
}

/** Breadcrumb segments for a directory path ("" is the repository root). */
export function pathBreadcrumbs(path: string): Array<{ name: string; path: string }> {
  if (!path) return [];
  const parts = path.split("/");
  return parts.map((name, i) => ({ name, path: parts.slice(0, i + 1).join("/") }));
}

export function parentDirectory(path: string): string {
  const at = path.lastIndexOf("/");
  return at === -1 ? "" : path.slice(0, at);
}

/** Human-readable byte size (B / KB / MB, one decimal past bytes). */
export function formatBytes(size: number | null): string {
  if (size == null) return "";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

// ─── Code search ────────────────────────────────────────────────────────────

export type CodeMatchLike = { path: string; line: number; text: string };

/** Group matches by file, keeping the server's file order and line order. */
export function groupMatchesByFile<T extends CodeMatchLike>(matches: readonly T[]): Array<{ path: string; matches: T[] }> {
  const groups = new Map<string, T[]>();
  for (const match of matches) {
    const list = groups.get(match.path);
    if (list) list.push(match);
    else groups.set(match.path, [match]);
  }
  return [...groups].map(([path, list]) => ({ path, matches: list }));
}

/**
 * Character ranges in `text` to highlight for a search result line. Fixed
 * mode is an exact (optionally case-folded) substring scan. Regex mode tries
 * the pattern as a JavaScript RegExp — Git's ERE is close enough for display;
 * if it does not compile here, nothing is highlighted (the line still shows).
 */
export function highlightMatchRanges(
  text: string,
  query: string,
  mode: "fixed" | "regex",
  ignoreCase: boolean,
): Array<[number, number]> {
  if (!query) return [];
  const ranges: Array<[number, number]> = [];
  if (mode === "fixed") {
    const haystack = ignoreCase ? text.toLowerCase() : text;
    const needle = ignoreCase ? query.toLowerCase() : query;
    let from = 0;
    while (from <= haystack.length - needle.length) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      ranges.push([at, at + needle.length]);
      from = at + needle.length;
    }
    return ranges;
  }
  let re: RegExp;
  try {
    re = new RegExp(query, ignoreCase ? "gi" : "g");
  } catch {
    return [];
  }
  let guard = 0;
  for (let m = re.exec(text); m && guard < 200; m = re.exec(text), guard += 1) {
    if (m[0].length === 0) {
      re.lastIndex += 1;
      continue;
    }
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

// ─── Reflog ─────────────────────────────────────────────────────────────────

export type ReflogAction =
  | "commit"
  | "amend"
  | "merge"
  | "rebase"
  | "reset"
  | "checkout"
  | "pull"
  | "cherry-pick"
  | "revert"
  | "branch"
  | "fetch"
  | "push"
  | "clone"
  | "other";

/** POSIX single-quote a value so a copied command is safe to paste. */
export function shellQuote(value: string): string {
  return /^[A-Za-z0-9._/@:=+-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A branch name for rescuing a reflog entry: `rescue/<ref>-<shorthash>`,
 * restricted to characters valid in a ref name.
 */
export function reflogRescueBranchName(ref: string, hash: string): string {
  const short = ref.replace(/^refs\/(heads|remotes)\//, "");
  const safe = short.replace(/[^A-Za-z0-9._/-]/g, "_").replace(/\/+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "head";
  return `rescue/${safe.toLowerCase()}-${hash.slice(0, 7)}`;
}

/** Copyable commands to recover a reflog entry's commit without touching the current branch. */
export function reflogRescueCommands(ref: string, hash: string): { branch: string; inspect: string; cherryPick: string } {
  const name = reflogRescueBranchName(ref, hash);
  return {
    branch: `git branch ${shellQuote(name)} ${hash}`,
    inspect: `git log --oneline --graph ${hash} --not --branches --tags --remotes`,
    cherryPick: `git cherry-pick ${hash}`,
  };
}

/** Keep only entries whose moved-to or moved-from tip is unreachable (lost work). */
export function filterLostEntries<T extends { reachable: boolean | null; previousReachable: boolean | null }>(
  entries: readonly T[],
): T[] {
  return entries.filter((entry) => entry.reachable === false || entry.previousReachable === false);
}
