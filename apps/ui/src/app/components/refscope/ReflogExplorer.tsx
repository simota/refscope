/**
 * ReflogExplorer — the ref's own movement log (`git log --walk-reflogs`).
 *
 * The observed-rewrite list in the Rescue lens only knows what happened
 * while Refscope was connected. The reflog goes back as far as Git kept it,
 * so commits lost to an earlier `reset --hard`, `rebase`, or `commit --amend`
 * can still be found here. The API marks each tip that no branch, tag,
 * remote-tracking ref, or HEAD reaches any more ("lost"); "Lost work only"
 * narrows the list to those moves.
 *
 * Read-only: recovery commands are copied, never run.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, FolderTree, GitCompare, RefreshCw, Search } from "lucide-react";
import { fetchReflog, type ReflogEntry, type ReflogResponse } from "../../api";
import type { GitRef } from "./data";
import { filterLostEntries, reflogRescueCommands, type ReflogAction } from "../../lib/repoExplorer";

const PAGE_SIZE = 100;

const ACTION_LABEL: Record<ReflogAction, string> = {
  commit: "commit",
  amend: "amend",
  merge: "merge",
  rebase: "rebase",
  reset: "reset",
  checkout: "checkout",
  pull: "pull",
  "cherry-pick": "cherry-pick",
  revert: "revert",
  branch: "branch",
  fetch: "fetch",
  push: "push",
  clone: "clone",
  other: "other",
};

type LoadState =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: ReflogResponse; entries: ReflogEntry[] };

export function ReflogExplorer({
  repoId,
  refs,
  onInspectCommit,
  onBrowseAt,
  onCompareWithHead,
}: {
  repoId: string;
  refs: GitRef[];
  onInspectCommit: (hash: string) => void;
  onBrowseAt?: (hash: string, label: string) => void;
  onCompareWithHead?: (hash: string) => void;
}) {
  const [ref, setRef] = useState("HEAD");
  const [lostOnly, setLostOnly] = useState(false);
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loadingMore, setLoadingMore] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState("");

  const refOptions = useMemo(() => {
    const names = refs
      .filter((r) => (r.type === "branch" || r.type === "remote") && /^refs\/(heads|remotes)\//.test(r.name))
      .map((r) => r.name);
    return ["HEAD", ...new Set(names)];
  }, [refs]);

  // Repo switch: back to HEAD, whose reflog every repository has.
  useEffect(() => setRef("HEAD"), [repoId]);

  useEffect(() => {
    if (!repoId) return;
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetchReflog(repoId, { ref, limit: PAGE_SIZE }, ctrl.signal)
      .then((data) => !ctrl.signal.aborted && setState({ kind: "ready", data, entries: data.entries }))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [repoId, ref, reloadKey]);

  const loadMore = useCallback(async () => {
    if (state.kind !== "ready" || !state.data.hasMore) return;
    setLoadingMore(true);
    try {
      const next = await fetchReflog(repoId, { ref, limit: PAGE_SIZE, skip: state.entries.length });
      setState((prev) =>
        prev.kind === "ready" ? { kind: "ready", data: next, entries: [...prev.entries, ...next.entries] } : prev,
      );
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
    } finally {
      setLoadingMore(false);
    }
  }, [state, repoId, ref]);

  const copy = useCallback(async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(label);
    } catch {
      setCopied("Clipboard unavailable");
    }
    window.setTimeout(() => setCopied(""), 1600);
  }, []);

  const visible = state.kind === "ready" ? (lostOnly ? filterLostEntries(state.entries) : state.entries) : [];
  const lostHashes = state.kind === "ready" ? new Set(state.entries.filter((e) => e.reachable === false).map((e) => e.hash)) : new Set();

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
        <label className="flex items-center gap-1.5" style={{ color: "var(--rs-text-secondary)", fontSize: 12 }}>
          Reflog of
          <select
            value={ref}
            onChange={(event) => setRef(event.target.value)}
            aria-label="Ref whose reflog to show"
            style={{
              height: 26,
              padding: "0 6px",
              fontSize: 12,
              borderRadius: "var(--rs-radius-sm)",
              border: "1px solid var(--rs-border)",
              background: "var(--rs-bg-canvas)",
              color: "var(--rs-text-primary)",
              maxWidth: 240,
            }}
          >
            {refOptions.map((name) => (
              <option key={name} value={name}>
                {name.replace(/^refs\/(heads|remotes)\//, "")}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1" style={{ color: "var(--rs-text-secondary)", cursor: "pointer", fontSize: 12 }}>
          <input type="checkbox" checked={lostOnly} onChange={(e) => setLostOnly(e.target.checked)} />
          Lost work only
        </label>
        <button type="button" className="rs-compact-button rs-compact-button--icon" onClick={() => setReloadKey((k) => k + 1)} title="Reload reflog">
          <RefreshCw size={11} aria-hidden /> Reload
        </button>
        <span aria-live="polite" style={{ marginLeft: "auto", color: "var(--rs-text-muted)", fontSize: 11 }}>
          {copied ||
            (state.kind === "ready"
              ? `${state.entries.length} moves loaded · ${lostHashes.size} lost tip${lostHashes.size === 1 ? "" : "s"}`
              : "")}
        </span>
      </div>

      {state.kind === "loading" ? (
        <p style={mutedText}>Reading reflog…</p>
      ) : state.kind === "error" ? (
        <p role="alert" style={mutedText}>
          {state.message}
        </p>
      ) : visible.length === 0 ? (
        <p style={mutedText}>
          {state.entries.length === 0
            ? "This ref has no reflog (it may be new, or core.logAllRefUpdates is off)."
            : "No lost work among the loaded moves — every tip is still reachable from a branch, tag, remote, or HEAD."}
        </p>
      ) : (
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }} aria-label={`Reflog of ${ref}`}>
          {visible.map((entry) => (
            <ReflogRow
              key={`${entry.index}:${entry.hash}`}
              entry={entry}
              refName={ref}
              onInspect={() => onInspectCommit(entry.hash)}
              onInspectPrevious={entry.previousHash ? () => onInspectCommit(entry.previousHash!) : undefined}
              onBrowse={onBrowseAt ? () => onBrowseAt(entry.hash, entry.selector) : undefined}
              onCompare={onCompareWithHead ? () => onCompareWithHead(entry.reachable === false ? entry.hash : entry.previousHash ?? entry.hash) : undefined}
              onCopy={copy}
            />
          ))}
        </ol>
      )}

      {state.kind === "ready" && state.data.hasMore ? (
        <button type="button" className="rs-compact-button rs-compact-button--icon" onClick={loadMore} disabled={loadingMore} style={{ alignSelf: "flex-start" }}>
          {loadingMore ? "Loading…" : `Load ${PAGE_SIZE} older moves`}
        </button>
      ) : null}
    </div>
  );
}

function ReflogRow({
  entry,
  refName,
  onInspect,
  onInspectPrevious,
  onBrowse,
  onCompare,
  onCopy,
}: {
  entry: ReflogEntry;
  refName: string;
  onInspect: () => void;
  onInspectPrevious?: () => void;
  onBrowse?: () => void;
  onCompare?: () => void;
  onCopy: (text: string, label: string) => void;
}) {
  const lost = entry.reachable === false;
  const orphanedPrevious = entry.previousReachable === false && entry.rewrites;
  // The commit worth rescuing: the tip this move left behind when it orphaned
  // it, otherwise the tip it moved to (when that is the lost one).
  const rescueHash = orphanedPrevious && entry.previousHash ? entry.previousHash : entry.hash;
  const commands = reflogRescueCommands(refName, rescueHash);
  const showRescue = lost || orphanedPrevious;
  return (
    <li
      style={{
        border: "1px solid var(--rs-border)",
        borderLeft: `3px solid ${showRescue ? "var(--rs-warning)" : entry.rewrites ? "var(--rs-git-modified)" : "var(--rs-border)"}`,
        borderRadius: "var(--rs-radius-sm)",
        padding: "6px 8px",
        marginBottom: 6,
        background: "var(--rs-bg-panel)",
      }}
    >
      <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12 }}>
        <span style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-muted)" }}>{entry.selector}</span>
        <span
          className="rs-chip"
          style={{ color: entry.rewrites ? "var(--rs-git-modified)" : "var(--rs-text-secondary)" }}
          title={entry.rewrites ? "This operation can leave the previous tip unreachable" : undefined}
        >
          {ACTION_LABEL[entry.action]}
        </span>
        {lost ? (
          <span className="rs-chip" style={{ color: "var(--rs-warning)" }} title="No branch, tag, remote-tracking ref, or HEAD reaches this commit">
            lost
          </span>
        ) : null}
        {orphanedPrevious ? (
          <span className="rs-chip" style={{ color: "var(--rs-warning)" }} title={`The tip before this move (${entry.previousHash?.slice(0, 7)}) is no longer reachable`}>
            orphaned {entry.previousHash?.slice(0, 7)}
          </span>
        ) : null}
        <span style={{ marginLeft: "auto", color: "var(--rs-text-muted)", fontSize: 11 }} title={entry.movedAt ?? undefined}>
          {entry.movedAt ? new Date(entry.movedAt).toLocaleString() : ""}
        </span>
      </div>
      <div style={{ fontSize: 12, color: "var(--rs-text-secondary)", marginTop: 3, overflowWrap: "anywhere" }}>{entry.message}</div>
      <div className="flex flex-wrap items-center gap-1.5" style={{ marginTop: 4, fontSize: 12 }}>
        <button type="button" className="rs-compact-button rs-compact-button--icon" onClick={onInspect} title="Open this commit in the detail panel">
          <Search size={11} aria-hidden />
          <span style={{ fontFamily: "var(--rs-mono)" }}>{entry.hash.slice(0, 7)}</span>
          <span className="truncate" style={{ maxWidth: 320 }}>{entry.subject}</span>
        </button>
        {onInspectPrevious && orphanedPrevious ? (
          <button type="button" className="rs-compact-button rs-compact-button--icon" onClick={onInspectPrevious} title="Open the commit this move left behind">
            <Search size={11} aria-hidden /> previous tip
          </button>
        ) : null}
        {onBrowse ? (
          <button type="button" className="rs-compact-button rs-compact-button--icon" onClick={onBrowse} title="Browse files at this commit">
            <FolderTree size={11} aria-hidden /> Files
          </button>
        ) : null}
        {showRescue && onCompare ? (
          <button type="button" className="rs-compact-button rs-compact-button--icon" onClick={onCompare} title="Compare HEAD with the lost commit">
            <GitCompare size={11} aria-hidden /> Compare with HEAD
          </button>
        ) : null}
        {showRescue ? (
          <button
            type="button"
            className="rs-compact-button rs-compact-button--icon"
            onClick={() => onCopy(commands.branch, "Rescue command copied")}
            title={commands.branch}
          >
            <Copy size={11} aria-hidden /> Copy rescue branch command
          </button>
        ) : null}
      </div>
    </li>
  );
}

const mutedText = { margin: "8px 0", fontSize: 12, color: "var(--rs-text-muted)" } as const;
