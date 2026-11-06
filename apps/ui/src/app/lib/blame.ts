/**
 * Pure helpers for the file viewer's blame mode. No runtime imports, so
 * `apps/ui/test/` can load this module under Node's type stripping.
 */

export type BlameLineLike = { line: number; hash: string };
export type BlameCommitLike = { hash: string; authorTime: string | null };

/** A run of consecutive lines last changed by the same commit. */
export type BlameRun = { hash: string; startLine: number; endLine: number };

/** Collapse per-line attribution into runs so the gutter labels each block once. */
export function groupBlameRuns(lines: readonly BlameLineLike[]): BlameRun[] {
  const runs: BlameRun[] = [];
  for (const entry of lines) {
    const last = runs[runs.length - 1];
    if (last && last.hash === entry.hash && last.endLine + 1 === entry.line) {
      last.endLine = entry.line;
    } else {
      runs.push({ hash: entry.hash, startLine: entry.line, endLine: entry.line });
    }
  }
  return runs;
}

/** Number of age buckets the gutter shades (0 = oldest … AGE_BUCKETS-1 = newest). */
export const BLAME_AGE_BUCKETS = 5;

/**
 * Bucket each commit by author time relative to the file's oldest and newest
 * attributed commits. Ranking (not linear time) keeps one ancient import from
 * flattening every later change into the same shade. Unknown times → 0.
 */
export function blameAgeBuckets(commits: readonly BlameCommitLike[]): Map<string, number> {
  const timed = commits
    .map((commit) => ({ hash: commit.hash, time: commit.authorTime ? Date.parse(commit.authorTime) : NaN }))
    .filter((entry) => Number.isFinite(entry.time))
    .sort((a, b) => a.time - b.time);
  const buckets = new Map<string, number>();
  for (const commit of commits) buckets.set(commit.hash, 0);
  if (timed.length <= 1) {
    for (const entry of timed) buckets.set(entry.hash, BLAME_AGE_BUCKETS - 1);
    return buckets;
  }
  timed.forEach((entry, index) => {
    const bucket = Math.round((index / (timed.length - 1)) * (BLAME_AGE_BUCKETS - 1));
    buckets.set(entry.hash, bucket);
  });
  return buckets;
}

/** Compact relative age for the gutter ("3d", "5mo", "2y"). */
export function shortAge(iso: string | null, nowMs: number): string {
  if (!iso) return "";
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const seconds = Math.max(0, Math.round((nowMs - then) / 1000));
  const day = 86_400;
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))}m`;
  if (seconds < day) return `${Math.round(seconds / 3600)}h`;
  if (seconds < 30 * day) return `${Math.round(seconds / day)}d`;
  if (seconds < 365 * day) return `${Math.round(seconds / (30 * day))}mo`;
  return `${Math.round(seconds / (365 * day))}y`;
}
