import { useCallback, useEffect, useRef, useState } from "react";
import { compareRefs, fetchReflog, type ReflogEntry } from "../api";
import type { GitRef } from "../components/refscope/data";
import {
  classifyMove,
  diffRefSnapshot,
  hasReflog,
  parseSnapshotStore,
  reflogMovesSince,
  sameSnapshot,
  serializeSnapshotStore,
  snapshotFromRefs,
  type MoveShape,
  type RefChange,
} from "../lib/refBriefing";

// Per-repo "last seen" ref snapshots, kept in this browser only. The
// snapshot is refreshed while the page is open (on every ref change, once a
// minute, and on pagehide) so "since your last visit" means since this
// browser last looked, not since the last time a ref happened to move.

const STORAGE_KEY = "refscope.refSnapshots.v1";
const HEARTBEAT_MS = 60_000;
/** Moves enriched with ahead/behind; the rest show hashes only. */
const MAX_COMPARE = 12;
/** Reflog reads at startup, watched refs first. */
const MAX_REFLOG = 6;

export type BriefingEvidence = {
  shape?: MoveShape;
  ahead?: number;
  behind?: number;
  /** The previous tip is no longer readable (gc'd or unreachable). */
  compareFailed?: boolean;
  /** Reflog moves after the snapshot time, newest first. */
  reflog?: ReflogEntry[];
};

export type RefBriefing = {
  repoId: string;
  /** When the compared snapshot was last confirmed current. */
  since: string;
  changes: RefChange[];
  evidence: Record<string, BriefingEvidence>;
};

// Page-lifetime state, outside React: Redact mode remounts <App>, and the
// briefing must survive that. Only ref names and hashes are cached here —
// evidence (reflog entries carry author names) is re-read so it goes through
// the current redaction setting.
const briefedRepos = new Set<string>();
const briefingCache = new Map<string, { since: string; changes: RefChange[] }>();

function readStore() {
  try {
    return parseSnapshotStore(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return {};
  }
}

function writeSnapshot(repoId: string, refs: Record<string, string>) {
  try {
    const store = readStore();
    store[repoId] = { savedAt: new Date().toISOString(), refs };
    window.localStorage.setItem(STORAGE_KEY, serializeSnapshotStore(store));
  } catch {
    // Storage unavailable / full: the briefing simply has nothing to compare next time.
  }
}

/**
 * Computes the briefing once per repo per page session (the first time that
 * repo's refs load), then keeps the stored snapshot current.
 */
export function useRefBriefing(repoId: string, refs: readonly GitRef[], watched: ReadonlySet<string>) {
  const [briefing, setBriefing] = useState<RefBriefing | null>(() => {
    const cached = repoId ? briefingCache.get(repoId) : undefined;
    return cached ? { repoId, ...cached, evidence: {} } : null;
  });
  const latestRef = useRef<{ repoId: string; refs: Record<string, string> } | null>(null);
  const watchedRef = useRef(watched);
  watchedRef.current = watched;

  useEffect(() => {
    if (!repoId || refs.length === 0) return;
    const current = snapshotFromRefs(refs);
    if (!briefedRepos.has(repoId)) {
      briefedRepos.add(repoId);
      const previous = readStore()[repoId];
      if (previous) {
        const entry = {
          since: previous.savedAt,
          changes: diffRefSnapshot(previous.refs, refs, watchedRef.current),
        };
        briefingCache.set(repoId, entry);
        setBriefing({ repoId, ...entry, evidence: {} });
      } else {
        setBriefing(null);
      }
    } else {
      const cached = briefingCache.get(repoId);
      setBriefing((value) =>
        value?.repoId === repoId ? value : cached ? { repoId, ...cached, evidence: {} } : null,
      );
    }
    const last = latestRef.current;
    latestRef.current = { repoId, refs: current };
    if (!last || last.repoId !== repoId || !sameSnapshot(last.refs, current)) {
      writeSnapshot(repoId, current);
    }
  }, [repoId, refs]);

  // Keep `savedAt` fresh while the page is open so a long idle session is
  // not reported as "last visit 8h ago" the next morning.
  useEffect(() => {
    const persist = () => {
      const latest = latestRef.current;
      if (latest) writeSnapshot(latest.repoId, latest.refs);
    };
    const timer = window.setInterval(persist, HEARTBEAT_MS);
    window.addEventListener("pagehide", persist);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pagehide", persist);
    };
  }, []);

  // Evidence: ahead/behind for moves, reflog entries since the snapshot.
  const briefingKey = briefing ? `${briefing.repoId}@${briefing.since}` : "";
  useEffect(() => {
    if (!briefing || briefing.changes.length === 0) return;
    const { repoId: briefRepo, since, changes } = briefing;
    let cancelled = false;
    const merge = (name: string, patch: BriefingEvidence) => {
      if (cancelled) return;
      setBriefing((value) =>
        value && value.repoId === briefRepo && value.since === since
          ? { ...value, evidence: { ...value.evidence, [name]: { ...value.evidence[name], ...patch } } }
          : value,
      );
    };
    const moves = changes.filter((change) => change.kind === "moved").slice(0, MAX_COMPARE);
    for (const change of moves) {
      compareRefs(briefRepo, change.from!, change.to!)
        .then((result) =>
          merge(change.name, {
            shape: classifyMove(result),
            ahead: result.ahead,
            behind: result.behind,
          }),
        )
        .catch(() => merge(change.name, { compareFailed: true }));
    }
    const reflogTargets = changes.filter(hasReflog).slice(0, MAX_REFLOG);
    for (const change of reflogTargets) {
      fetchReflog(briefRepo, { ref: change.name, limit: 20 })
        .then((result) => merge(change.name, { reflog: reflogMovesSince(result.entries, since) }))
        .catch(() => {
          // A ref without a reflog (core.logAllRefUpdates off) just shows no entries.
        });
    }
    return () => {
      cancelled = true;
    };
    // Re-run only when a new briefing is created, not on every evidence merge.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefingKey]);

  const dismiss = useCallback(() => {
    if (repoId) briefingCache.delete(repoId);
    setBriefing(null);
  }, [repoId]);

  return { briefing: briefing && briefing.repoId === repoId ? briefing : null, dismiss };
}
