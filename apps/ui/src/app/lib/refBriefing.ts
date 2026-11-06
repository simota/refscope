// "Since your last visit" — reconstruct what happened to refs while Refscope
// was closed.
//
// SSE only observes while a tab is connected, so an off-hours force-push or
// branch deletion is otherwise invisible. The browser keeps a per-repo
// snapshot of the last ref → hash map it saw; on the next visit the fresh
// ref list is diffed against it. These are facts reconstructed at startup
// from Git (current refs, reflog, ahead/behind), not session observations,
// and the UI labels them that way.
//
// Pure helpers only (no DOM / storage) so they run under `node --test`.

export type BriefingRef = {
  name: string;
  shortName: string;
  hash: string;
  type: "branch" | "tag" | "remote" | "other";
};

export type RefSnapshot = {
  /** ISO time the snapshot was last confirmed current. */
  savedAt: string;
  /** Full ref name → object id. */
  refs: Record<string, string>;
};

export type RefChangeKind = "moved" | "created" | "deleted";

export type RefChange = {
  name: string;
  shortName: string;
  type: BriefingRef["type"];
  kind: RefChangeKind;
  /** Hash in the saved snapshot (null for created refs). */
  from: string | null;
  /** Current hash (null for deleted refs). */
  to: string | null;
  /** Pinned refs are the watch list and sort first. */
  watched: boolean;
};

/** How a moved ref relates to its previous tip, from `compare?base=from&target=to`. */
export type MoveShape = "fast-forward" | "rewound" | "rewritten" | "unchanged";

/** Upper bound on refs kept per snapshot so a huge tag set cannot fill storage. */
export const MAX_SNAPSHOT_REFS = 5000;

export function snapshotFromRefs(refs: readonly BriefingRef[]): Record<string, string> {
  const out: Record<string, string> = {};
  let count = 0;
  for (const ref of refs) {
    if (!ref.name || !ref.hash) continue;
    out[ref.name] = ref.hash;
    count += 1;
    if (count >= MAX_SNAPSHOT_REFS) break;
  }
  return out;
}

export function sameSnapshot(a: Record<string, string>, b: Record<string, string>): boolean {
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((key) => b[key] === a[key]);
}

const TYPE_ORDER: Record<BriefingRef["type"], number> = { branch: 0, remote: 1, tag: 2, other: 3 };
const KIND_ORDER: Record<RefChangeKind, number> = { moved: 0, deleted: 1, created: 2 };

export function shortRefName(name: string): string {
  return name.replace(/^refs\/(?:heads|tags|remotes)\//, "");
}

function typeFromName(name: string): BriefingRef["type"] {
  if (name.startsWith("refs/heads/")) return "branch";
  if (name.startsWith("refs/remotes/")) return "remote";
  if (name.startsWith("refs/tags/")) return "tag";
  return "other";
}

/**
 * Diff a saved snapshot against the current ref list. Watched refs first,
 * then moves before deletions before creations, branches before remotes
 * before tags, then by name.
 */
export function diffRefSnapshot(
  previous: Record<string, string>,
  current: readonly BriefingRef[],
  watched: ReadonlySet<string>,
): RefChange[] {
  const changes: RefChange[] = [];
  const seen = new Set<string>();
  for (const ref of current) {
    if (!ref.name || !ref.hash) continue;
    seen.add(ref.name);
    const before = previous[ref.name];
    if (before === ref.hash) continue;
    changes.push({
      name: ref.name,
      shortName: ref.shortName || shortRefName(ref.name),
      type: ref.type,
      kind: before ? "moved" : "created",
      from: before ?? null,
      to: ref.hash,
      watched: watched.has(ref.name),
    });
  }
  for (const [name, hash] of Object.entries(previous)) {
    if (seen.has(name)) continue;
    changes.push({
      name,
      shortName: shortRefName(name),
      type: typeFromName(name),
      kind: "deleted",
      from: hash,
      to: null,
      watched: watched.has(name),
    });
  }
  return changes.sort(
    (a, b) =>
      Number(b.watched) - Number(a.watched) ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      TYPE_ORDER[a.type] - TYPE_ORDER[b.type] ||
      a.name.localeCompare(b.name),
  );
}

/**
 * `ahead` = commits on the new tip not reachable from the old one,
 * `behind` = commits the ref no longer reaches (dropped by reset / rebase).
 */
export function classifyMove(counts: { ahead: number; behind: number }): MoveShape {
  if (counts.behind > 0 && counts.ahead > 0) return "rewritten";
  if (counts.behind > 0) return "rewound";
  if (counts.ahead > 0) return "fast-forward";
  return "unchanged";
}

/** Reflog entries that moved the ref after `sinceIso` (newest first in, newest first out). */
export function reflogMovesSince<T extends { movedAt: string | null }>(
  entries: readonly T[],
  sinceIso: string,
): T[] {
  const since = Date.parse(sinceIso);
  if (!Number.isFinite(since)) return [];
  return entries.filter((entry) => {
    if (!entry.movedAt) return false;
    const at = Date.parse(entry.movedAt);
    return Number.isFinite(at) && at > since;
  });
}

/** Reflog walking is only allowed for local and remote-tracking branches. */
export function hasReflog(change: Pick<RefChange, "name" | "kind">): boolean {
  return change.kind !== "deleted" && /^refs\/(?:heads|remotes)\//.test(change.name);
}

/** A copy-ready recovery command for a tip the ref no longer points at. */
export function rescueCommand(change: Pick<RefChange, "shortName" | "from">): string | null {
  if (!change.from) return null;
  const safe = change.shortName.replace(/[^A-Za-z0-9._/-]+/g, "-").replace(/^-+|-+$/g, "") || "ref";
  return `git branch rescue/${safe}-${change.from.slice(0, 7)} ${change.from}`;
}

export function formatElapsed(fromIso: string, now: number): string {
  const at = Date.parse(fromIso);
  if (!Number.isFinite(at)) return "";
  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Parse the persisted store defensively; anything malformed is dropped. */
export function parseSnapshotStore(raw: string | null): Record<string, RefSnapshot> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const candidate = parsed as { v?: unknown; repos?: unknown };
    if (candidate.v !== 1 || !candidate.repos || typeof candidate.repos !== "object") return {};
    const out: Record<string, RefSnapshot> = {};
    for (const [repoId, value] of Object.entries(candidate.repos as Record<string, unknown>)) {
      if (!value || typeof value !== "object") continue;
      const snap = value as { savedAt?: unknown; refs?: unknown };
      if (typeof snap.savedAt !== "string" || !Number.isFinite(Date.parse(snap.savedAt))) continue;
      if (!snap.refs || typeof snap.refs !== "object") continue;
      const refs: Record<string, string> = {};
      for (const [name, hash] of Object.entries(snap.refs as Record<string, unknown>)) {
        if (typeof hash === "string" && /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(hash) && name.startsWith("refs/")) {
          refs[name] = hash;
        }
      }
      out[repoId] = { savedAt: snap.savedAt, refs };
    }
    return out;
  } catch {
    return {};
  }
}

export function serializeSnapshotStore(repos: Record<string, RefSnapshot>): string {
  return JSON.stringify({ v: 1, repos });
}
