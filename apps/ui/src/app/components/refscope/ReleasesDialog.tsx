/**
 * ReleasesDialog — the tags reachable from one line of history, read as
 * releases (GET /releases).
 *
 * For the chosen ref (default: the ref the timeline shows) it lists:
 *   - Unreleased: commits on the ref since its newest reachable tag, with a
 *     one-click jump into the compare review (newest tag → ref), whose
 *     Markdown export is the release-notes draft.
 *   - Each release: commits and contributors it added over the previous
 *     reachable tag, plus Review (previous → tag), Browse at tag, and
 *     Show in timeline.
 *
 * Everything is derived from Git refs and history; nothing is written. Tag
 * messages are not read. "Previous" is the next older tag (by tagged commit
 * date) reachable from the same ref — the UI says so.
 */
import { useEffect, useMemo, useState } from "react";
import { FolderTree, GitCompareArrows, ListTree, PackageCheck, Tag } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import { fetchReleases, type ReleaseEntry, type ReleasesResponse } from "../../api";
import type { GitRef } from "./data";
import { formatCount, formatDays, releaseCadence, releaseDate } from "../../lib/insights";
import { shortAge } from "../../lib/blame";

type Async<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; value: T };

export function ReleasesDialog({
  repoId,
  open,
  refs,
  initialRef,
  onClose,
  onReview,
  onBrowse,
  onShowRef,
}: {
  repoId: string;
  open: boolean;
  refs: GitRef[];
  /** The ref whose releases to show first (the timeline's ref). */
  initialRef: string;
  onClose: () => void;
  /** Open the compare review for `base` → `target` (full ref names or HEAD). */
  onReview: (base: string, target: string) => void;
  onBrowse: (commit: string, label: string) => void;
  onShowRef: (refName: string) => void;
}) {
  const [line, setLine] = useState(initialRef || "HEAD");
  useEffect(() => {
    if (open) setLine(initialRef || "HEAD");
  }, [open, initialRef]);
  const [state, setState] = useState<Async<ReleasesResponse>>({ kind: "idle" });

  useEffect(() => {
    if (!open || !repoId) return;
    const ctrl = new AbortController();
    setState({ kind: "loading" });
    fetchReleases(repoId, line, ctrl.signal)
      .then((value) => !ctrl.signal.aborted && setState({ kind: "ready", value }))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setState({ kind: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => ctrl.abort();
  }, [open, repoId, line]);

  const lineOptions = useMemo(() => {
    const options = refs.filter((ref) => ref.type === "branch" || ref.type === "remote").slice(0, 200);
    return options;
  }, [refs]);
  const lineLabel = line === "HEAD" ? "HEAD" : refs.find((ref) => ref.name === line)?.shortName ?? line.replace(/^refs\/(heads|remotes|tags)\//, "");
  const nowMs = Date.now();
  const value = state.kind === "ready" ? state.value : null;
  const cadence = value ? releaseCadence(value.releases, nowMs) : null;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="bg-[var(--rs-bg-elevated)] border-[var(--rs-border)] text-[var(--rs-text-primary)] shadow-[0_24px_60px_rgba(0,0,0,0.55)] sm:max-w-[min(860px,calc(100vw-2rem))] w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] p-4 gap-3 grid-rows-[auto_auto_minmax(0,1fr)] [&>button]:text-[var(--rs-text-secondary)] [&>button]:opacity-100"
        style={{ height: "min(760px, calc(100dvh - 2rem))" }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="text-[var(--rs-text-primary)]">
            <span className="flex items-center gap-2" style={{ fontSize: 14 }}>
              <PackageCheck size={15} aria-hidden /> Releases
            </span>
          </DialogTitle>
          <DialogDescription className="text-[var(--rs-text-secondary)]" style={{ fontSize: 12 }}>
            Tags reachable from <span style={{ fontFamily: "var(--rs-mono)" }}>{lineLabel}</span>, newest first, with what each one
            added over the previous release. Review a release to read its commits and diff and to export release notes.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2" style={{ fontSize: 12, color: "var(--rs-text-secondary)" }}>
          <label className="flex items-center gap-1.5" style={{ fontSize: 12, color: "var(--rs-text-secondary)" }}>
            Release line
            <select value={line} onChange={(event) => setLine(event.target.value)} aria-label="Ref whose releases to list" style={selectStyle}>
              <option value="HEAD">HEAD</option>
              {lineOptions.map((ref) => (
                <option key={ref.name} value={ref.name}>
                  {ref.type === "remote" ? `remote: ${ref.shortName}` : ref.shortName}
                </option>
              ))}
              {line !== "HEAD" && lineOptions.every((ref) => ref.name !== line) ? <option value={line}>{lineLabel}</option> : null}
            </select>
          </label>
          {value && cadence ? (
            <span aria-live="polite">
              {value.totalTags} release{value.totalTags === 1 ? "" : "s"}
              {cadence.medianDays !== null ? ` · typically every ${formatDays(cadence.medianDays)}` : ""}
              {cadence.daysSinceLatest !== null ? ` · latest ${formatDays(cadence.daysSinceLatest)} ago` : ""}
              {value.otherTagCount > 0 ? ` · ${value.otherTagCount} tag${value.otherTagCount === 1 ? "" : "s"} on other lines not shown` : ""}
            </span>
          ) : null}
        </div>

        <div className="min-h-0 overflow-auto flex flex-col gap-2">
          {state.kind === "loading" || state.kind === "idle" ? (
            <p style={statusStyle}>Reading tags…</p>
          ) : state.kind === "error" ? (
            <p role="alert" style={statusStyle}>
              {state.message}
            </p>
          ) : (
            <>
              {state.value.unreleased ? (
                <section
                  aria-label="Unreleased changes"
                  style={{
                    border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 45%)",
                    borderRadius: "var(--rs-radius-md)",
                    background: "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 8%)",
                    padding: "10px 12px",
                  }}
                  className="flex flex-wrap items-center gap-2"
                >
                  <div style={{ flex: "1 1 260px", minWidth: 0, fontSize: 12 }}>
                    <div style={{ fontWeight: 650, color: "var(--rs-text-primary)" }}>Unreleased on {lineLabel}</div>
                    <div style={{ color: "var(--rs-text-secondary)" }}>
                      {state.value.unreleased.commitCount === 0
                        ? `Nothing since ${state.value.unreleased.since.shortName} — ${lineLabel} is at its latest release.`
                        : `${formatCount(state.value.unreleased.commitCount, state.value.unreleased.truncated)} commit${state.value.unreleased.commitCount === 1 ? "" : "s"} by ${state.value.unreleased.contributorCount} contributor${state.value.unreleased.contributorCount === 1 ? "" : "s"} since ${state.value.unreleased.since.shortName}.`}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="rs-compact-button rs-compact-button--icon"
                    disabled={state.value.unreleased.commitCount === 0}
                    onClick={() => onReview(state.value.unreleased!.since.name, state.value.ref)}
                    title="Open the compare review (latest release → this line) to read the changes and export draft release notes"
                  >
                    <GitCompareArrows size={12} aria-hidden /> Review &amp; draft notes
                  </button>
                </section>
              ) : (
                <p style={statusStyle}>
                  No tag is reachable from {lineLabel} yet
                  {state.value.otherTagCount > 0 ? ` (${state.value.otherTagCount} tag${state.value.otherTagCount === 1 ? "" : "s"} exist on other lines)` : ""}. Tag a
                  commit to start tracking releases.
                </p>
              )}

              {state.value.releases.length > 0 ? (
                <ol aria-label={`Releases on ${lineLabel}`} style={listStyle}>
                  {state.value.releases.map((release) => (
                    <ReleaseRow
                      key={release.name}
                      release={release}
                      nowMs={nowMs}
                      onReview={onReview}
                      onBrowse={onBrowse}
                      onShowRef={onShowRef}
                    />
                  ))}
                </ol>
              ) : null}
              {state.value.truncated ? (
                <p style={statusStyle}>
                  Showing the newest {state.value.releases.length} of {state.value.totalTags} releases.
                </p>
              ) : null}
              <p style={statusStyle}>
                Ordered by the tagged commit's date. “Since previous” counts commits in the tag that the next older reachable tag
                does not have; counts over {state.value.rangeCap.toLocaleString("en-US")} are shown as a lower bound. Tag messages are not
                read. Derived from Git, read-only.
              </p>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReleaseRow({
  release,
  nowMs,
  onReview,
  onBrowse,
  onShowRef,
}: {
  release: ReleaseEntry;
  nowMs: number;
  onReview: (base: string, target: string) => void;
  onBrowse: (commit: string, label: string) => void;
  onShowRef: (refName: string) => void;
}) {
  const date = releaseDate(release);
  return (
    <li
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
      style={{ padding: "7px 10px", fontSize: 12, borderBottom: "1px solid color-mix(in oklab, var(--rs-border), transparent 50%)" }}
    >
      <span className="inline-flex items-center gap-1.5 min-w-0" style={{ flex: "1 1 160px" }}>
        <Tag size={12} aria-hidden style={{ color: "var(--rs-accent)", flex: "none" }} />
        <span className="truncate" style={{ fontFamily: "var(--rs-mono)", fontWeight: 650 }}>
          {release.shortName}
        </span>
        {release.annotated ? (
          <span className="rs-chip" style={{ fontSize: 10 }} title="Annotated tag (date is the tagger date)">
            annotated
          </span>
        ) : null}
      </span>
      <span style={{ color: "var(--rs-text-muted)", fontSize: 11, flex: "0 0 auto" }} title={date ?? undefined}>
        {date ? `${new Date(date).toISOString().slice(0, 10)} · ${shortAge(date, nowMs)} ago` : "undated"}
      </span>
      <span style={{ color: "var(--rs-text-secondary)", flex: "0 0 auto", fontVariantNumeric: "tabular-nums" }}>
        {release.previous
          ? `+${formatCount(release.commitCount, release.truncated)} commit${release.commitCount === 1 ? "" : "s"} · ${release.contributorCount} contributor${release.contributorCount === 1 ? "" : "s"} since ${release.previous.shortName}`
          : `first release · ${formatCount(release.commitCount, release.truncated)} commit${release.commitCount === 1 ? "" : "s"}`}
      </span>
      <span className="inline-flex items-center gap-1" style={{ flex: "0 0 auto" }}>
        <button
          type="button"
          className="rs-compact-button rs-compact-button--icon"
          disabled={!release.previous}
          onClick={() => release.previous && onReview(release.previous.name, release.name)}
          aria-label={release.previous ? `Review ${release.shortName} against ${release.previous.shortName}` : `${release.shortName} has no earlier release to compare with`}
          title={release.previous ? `Compare review ${release.previous.shortName} → ${release.shortName} (export release notes there)` : "No earlier release to compare with"}
        >
          <GitCompareArrows size={12} aria-hidden /> Review
        </button>
        <button
          type="button"
          className="rs-compact-button rs-compact-button--icon"
          onClick={() => onBrowse(release.commit, release.shortName)}
          aria-label={`Browse files at ${release.shortName}`}
          title="Browse the repository as released"
        >
          <FolderTree size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="rs-compact-button rs-compact-button--icon"
          onClick={() => onShowRef(release.name)}
          aria-label={`Show ${release.shortName} in the timeline`}
          title="Show this tag's history in the timeline"
        >
          <ListTree size={12} aria-hidden />
        </button>
      </span>
    </li>
  );
}

const selectStyle = {
  height: 28,
  padding: "0 6px",
  fontSize: 12,
  maxWidth: 240,
  borderRadius: "var(--rs-radius-sm)",
  border: "1px solid var(--rs-border)",
  background: "var(--rs-bg-canvas)",
  color: "var(--rs-text-primary)",
} as const;

const statusStyle = { margin: "4px 2px", fontSize: 11, color: "var(--rs-text-muted)" } as const;

const listStyle = {
  listStyle: "none",
  margin: 0,
  padding: 0,
  border: "1px solid var(--rs-border)",
  borderRadius: "var(--rs-radius-md)",
  background: "var(--rs-bg-canvas)",
} as const;
