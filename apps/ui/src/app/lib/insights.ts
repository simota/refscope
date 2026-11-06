// Pure helpers for the Releases dialog and the repository browser's Owners
// tab. Type-only imports keep this loadable by Node's type stripping in
// `apps/ui/test/`.
import type { PathOwner, PathOwnersResponse, ReleaseEntry } from "../api";

const DAY_MS = 86_400_000;

/** Display date of a release: tagger date, else the tagged commit's date. */
export function releaseDate(release: Pick<ReleaseEntry, "taggedAt" | "committedAt">): string | null {
  return release.taggedAt ?? release.committedAt;
}

export type ReleaseCadence = {
  /** Median days between consecutive releases (null with fewer than two). */
  medianDays: number | null;
  /** Days from the newest release to `nowMs` (null with no dated release). */
  daysSinceLatest: number | null;
};

/**
 * Derived release rhythm over the listed releases (newest first). Gaps are
 * measured between consecutive release dates in list order, absolute so a
 * retro-tagged release does not produce a negative gap.
 */
export function releaseCadence(releases: ReadonlyArray<Pick<ReleaseEntry, "taggedAt" | "committedAt">>, nowMs: number): ReleaseCadence {
  const times = releases
    .map((release) => Date.parse(releaseDate(release) ?? ""))
    .filter((time) => Number.isFinite(time));
  const gaps: number[] = [];
  for (let index = 0; index + 1 < times.length; index += 1) {
    gaps.push(Math.abs(times[index] - times[index + 1]) / DAY_MS);
  }
  gaps.sort((a, b) => a - b);
  let medianDays: number | null = null;
  if (gaps.length > 0) {
    const mid = Math.floor(gaps.length / 2);
    medianDays = gaps.length % 2 === 1 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
  }
  const latest = times.length > 0 ? Math.max(...times) : null;
  return {
    medianDays,
    daysSinceLatest: latest === null ? null : Math.max(0, (nowMs - latest) / DAY_MS),
  };
}

/** "3 days", "1 day", "5 hours", "2 months" — coarse, for prose. */
export function formatDays(days: number): string {
  if (days < 1) {
    const hours = Math.max(1, Math.round(days * 24));
    return `${hours} hour${hours === 1 ? "" : "s"}`;
  }
  if (days < 60) {
    const whole = Math.round(days);
    return `${whole} day${whole === 1 ? "" : "s"}`;
  }
  if (days < 730) {
    const months = Math.round(days / 30);
    return `${months} month${months === 1 ? "" : "s"}`;
  }
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? "" : "s"}`;
}

/** "12", or "5000+" for a capped (lower-bound) count. */
export function formatCount(count: number, truncated: boolean): string {
  return `${count.toLocaleString("en-US")}${truncated ? "+" : ""}`;
}

/** Share of the scanned commits, as a whole percentage (0 when nothing was scanned). */
export function ownerShare(owner: Pick<PathOwner, "commits">, scannedCommits: number): number {
  if (scannedCommits <= 0) return 0;
  return Math.round((owner.commits / scannedCommits) * 100);
}

/**
 * One-line, plain-language reading of an ownership result. It states what
 * was counted (non-merge commits, capped) so the derived "half of the
 * commits" figure is not mistaken for line ownership.
 */
export function ownersSummary(result: Pick<PathOwnersResponse, "authorCount" | "scannedCommits" | "truncated" | "majorityAuthors" | "path">): string {
  const where = result.path ? result.path : "the repository";
  if (result.scannedCommits === 0) return `No commit changed ${where} in this history.`;
  const commits = `${formatCount(result.scannedCommits, result.truncated)} non-merge commit${result.scannedCommits === 1 ? "" : "s"}`;
  const people = `${result.authorCount} author${result.authorCount === 1 ? "" : "s"}`;
  const majority =
    result.authorCount > 1
      ? ` ${result.majorityAuthors === 1 ? "One author" : `${result.majorityAuthors} authors`} made half or more of them.`
      : "";
  return `${people} across ${commits}${result.truncated ? " (newest only)" : ""} touching ${where}.${majority}`;
}

/** Owners that are still active: at least one commit inside the recent window. */
export function activeOwners<T extends Pick<PathOwner, "recentCommits">>(owners: ReadonlyArray<T>): T[] {
  return owners.filter((owner) => owner.recentCommits > 0);
}

/**
 * The timeline author filter for one owner. Owners are grouped by e-mail, so
 * the e-mail catches every name variant (`--author` matches "Name <email>");
 * in Redact mode the e-mail is masked, so the (pseudonymized, reversible)
 * name is used instead.
 */
export function ownerFilterValue(owner: Pick<PathOwner, "author" | "authorEmail">, redacted: boolean): string {
  if (!redacted && owner.authorEmail && owner.authorEmail.includes("@")) return owner.authorEmail;
  return owner.author;
}
