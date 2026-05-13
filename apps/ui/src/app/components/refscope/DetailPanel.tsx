import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  FileSearch,
  FolderTree,
  History,
  List as ListIcon,
  Search,
  ShieldCheck,
} from "lucide-react";
import type { Commit, CommitDetail } from "./data";
import type {
  ContainingRef,
  DiffPayload,
  RangeHistoryEntry,
  RangeHistoryResponse,
  WorkTreeResponse,
  WorkTreeUntrackedFile,
} from "../../api";
import { fetchRangeHistory } from "../../api";
import { DiffViewer } from "./DiffViewer";
import { StructuralDiffBadge } from "./StructuralDiffBadge";
import { ChangedFilesTree } from "./ChangedFilesTree";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";

export type WhyPanelQuery = {
  path: string;
  lineStart: number;
  lineEnd: number;
};

type ChangedFilesView = "list" | "tree";

const CHANGED_FILES_VIEW_STORAGE_KEY = "rs.changedFilesView";

function readChangedFilesView(): ChangedFilesView {
  if (typeof window === "undefined") return "list";
  try {
    const raw = window.localStorage.getItem(CHANGED_FILES_VIEW_STORAGE_KEY);
    return raw === "tree" ? "tree" : "list";
  } catch {
    return "list";
  }
}

function writeChangedFilesView(view: ChangedFilesView): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(CHANGED_FILES_VIEW_STORAGE_KEY, view);
  } catch {
    // Ignore storage failures — view preference simply won't persist
    // across reloads in private-mode browsers or when quota is exhausted.
  }
}

export function DetailPanel({
  commit,
  detail,
  diff,
  loading,
  error,
  diffFullscreen,
  onDiffFullscreenChange,
  diffViewMode,
  onDiffViewModeChange,
  repoId,
  workTreeSelected,
  workTree,
  containingRefs,
  onOpenFileHistory,
  onFilterByPath,
  whyPanelQuery,
  onWhyPanelQueryChange,
}: {
  commit: Commit | null;
  detail: CommitDetail | null;
  diff: DiffPayload;
  loading: boolean;
  error: string;
  diffFullscreen?: boolean;
  onDiffFullscreenChange?: (next: boolean) => void;
  diffViewMode?: "all" | "single";
  onDiffViewModeChange?: (next: "all" | "single") => void;
  repoId: string;
  workTreeSelected: boolean;
  workTree: WorkTreeResponse | null;
  // Reachability — public refs whose history reaches this commit. `null`
  // means "not yet loaded for this commit"; `[]` is loaded-but-empty.
  containingRefs: ContainingRef[] | null;
  // Opens the path-input prompt or — when a path is supplied directly —
  // jumps straight to FileHistoryView (state owner: App.tsx).
  onOpenFileHistory: (path: string) => void;
  // Right-click action: pin a path into the global path filter so the
  // timeline narrows to commits that touched it.
  onFilterByPath?: (path: string) => void;
  // "Why is this here?" panel query state (owned by App.tsx).
  whyPanelQuery?: WhyPanelQuery | null;
  onWhyPanelQueryChange?: (q: WhyPanelQuery | null) => void;
}) {
  // Hooks must run unconditionally before any early return, otherwise React's
  // rules-of-hooks check trips and reorders break state. The previous version
  // declared `useState` after the worktree early return — we move the hook
  // ahead so both code paths visit the same hook order.
  const [copyStatus, setCopyStatus] = useState("");
  const [filesView, setFilesView] = useState<ChangedFilesView>(() =>
    readChangedFilesView(),
  );
  useEffect(() => {
    writeChangedFilesView(filesView);
  }, [filesView]);

  // Working-tree view takes precedence over commit detail when selected.
  // Rendered before any commit lookup so the panel can show a useful state
  // even while no commit is selected (e.g. fresh repo load with pending
  // worktree changes).
  if (workTreeSelected) {
    return (
      <WorkTreePanel
        workTree={workTree}
        onOpenFileHistory={onOpenFileHistory}
        onFilterByPath={onFilterByPath}
      />
    );
  }

  if (!commit) {
    return (
      <PanelShell>
        <Empty>No commit selected</Empty>
      </PanelShell>
    );
  }
  const authorName = detail?.author.name ?? commit.author;
  const authorDate = detail?.authorDate ?? commit.authorDate;
  const parents = detail?.parents ?? commit.parents ?? [];
  const refs = detail?.refs ?? commit.refs ?? [];
  const body = detail?.body ?? commit.body;
  const files = detail?.files ?? commit.files;
  const signatureStatus = detail?.signatureStatus ?? commit.signatureStatus;
  const signed = detail?.signed ?? commit.signed;
  const gitShowCommand = `git show --stat --patch ${commit.hash}`;

  async function copyToClipboard(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied`);
      window.setTimeout(() => setCopyStatus(""), 1600);
    } catch {
      setCopyStatus("Copy failed");
      window.setTimeout(() => setCopyStatus(""), 1600);
    }
  }

  return (
    <PanelShell>
      <div
        className="px-4 flex items-center justify-between"
        style={{
          height: 40,
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <div
          className="flex items-center gap-2"
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            fontWeight: 600,
            color: "var(--rs-text-muted)",
          }}
        >
          <span>COMMIT</span>
          {/* aria-busy lets assistive tech announce the in-flight state without
              requiring a focus change. The text label keeps the signal visible
              for sighted users during rapid keyboard navigation. */}
          {loading ? (
            <span
              role="status"
              aria-busy="true"
              style={{
                color: "var(--rs-text-secondary)",
                letterSpacing: "0.04em",
                fontWeight: 500,
              }}
            >
              · Loading…
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {copyStatus ? (
            <span
              style={{
                fontSize: 11,
                color: "var(--rs-text-muted)",
                fontFamily: "var(--rs-mono)",
              }}
            >
              {copyStatus}
            </span>
          ) : null}
          <button
            className="rs-icon-btn"
            title="Copy git show command"
            onClick={() => void copyToClipboard("git show command", gitShowCommand)}
          >
            <ExternalLink size={13} />
          </button>
          <button
            className="rs-icon-btn"
            title="Copy commit hash"
            onClick={() => void copyToClipboard("Commit hash", commit.hash)}
          >
            <Copy size={13} />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto" style={{ flex: 1 }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--rs-border)" }}>
          <div
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 12,
              color: "var(--rs-text-secondary)",
            }}
          >
            {commit.hash}
          </div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              marginTop: 6,
              lineHeight: 1.4,
            }}
          >
            {commit.subject}
          </h3>
          {body ? (
            <p
              style={{
                fontSize: 12,
                color: "var(--rs-text-secondary)",
                marginTop: 8,
                lineHeight: 1.55,
              }}
            >
              {body}
            </p>
          ) : null}

          <dl
            className="grid mt-3"
            style={{
              gridTemplateColumns: "72px 1fr",
              rowGap: 6,
              columnGap: 12,
              fontSize: 12,
            }}
          >
            <Meta label="Author">
              {authorName}{" "}
              <span style={{ color: "var(--rs-text-muted)" }}>· {formatDate(authorDate)}</span>
            </Meta>
            <Meta label="Parents">
              <span style={{ fontFamily: "var(--rs-mono)" }}>
                {parents.length ? parents.join(", ") : "—"}
              </span>
            </Meta>
            <Meta label="Refs">
              <span className="flex flex-wrap gap-1">
                {refs.map((r) => (
                  <span
                    key={r}
                    className="px-1.5 rounded-full"
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--rs-mono)",
                      background:
                        "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 22%)",
                      color: "var(--rs-text-primary)",
                      border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                    }}
                  >
                    {r}
                  </span>
                ))}
                {signed ? (
                  <span
                    className="px-1.5 rounded-full inline-flex items-center gap-1"
                    aria-label={`Commit signature status: ${formatSignatureStatus(signatureStatus)}`}
                    style={{
                      fontSize: 10,
                      color: "var(--rs-accent)",
                      border:
                        "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 40%)",
                    }}
                  >
                    <ShieldCheck size={10} aria-hidden /> {formatSignatureStatus(signatureStatus)}
                  </span>
                ) : null}
              </span>
            </Meta>
          </dl>
        </div>

        {loading ? <Empty>Loading commit detail…</Empty> : null}
        {error ? <Empty>{error}</Empty> : null}

        <Section
          title="CONTAINED IN"
          hint={containedInHint(containingRefs)}
        >
          <ContainedIn refs={containingRefs} />
        </Section>

        <Section title="CHANGE GRAPH" hint={`${commit.added} / ${commit.deleted}`}>
          <ChangeGraph files={files} totalAdded={commit.added} totalDeleted={commit.deleted} />
        </Section>

        <Section title="FILE STATUS MIX" hint={`${files.length} files`}>
          <FileStatusMix files={files} />
        </Section>

        <ChangedFilesSection
          fileCount={files.length}
          view={filesView}
          onViewChange={setFilesView}
        >
          {files.length === 0 ? (
            <Empty>{loading ? "Loading changed files…" : "No file changes returned for this commit."}</Empty>
          ) : filesView === "tree" ? (
            <ChangedFilesTree
              files={files}
              repoId={repoId}
              onOpenFileHistory={onOpenFileHistory}
              onFilterByPath={onFilterByPath}
            />
          ) : (
            files.map((f) => (
              <ContextMenu key={f.path}>
                <ContextMenuTrigger asChild>
                  <div
                    className="px-3 flex items-center gap-2"
                    style={{
                      height: 28,
                      fontSize: 12,
                      fontFamily: "var(--rs-mono)",
                      borderBottom:
                        "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
                    }}
                  >
                    <FileBadge status={f.status} />
                    <span
                      className="flex-1 truncate"
                      style={{ color: "var(--rs-text-primary)" }}
                    >
                      {f.path}
                    </span>
                    <StructuralDiffBadge kind={f.structuralKind} compact />
                    <span style={{ color: "var(--rs-git-added)" }}>+{f.added}</span>
                    <span style={{ color: "var(--rs-git-deleted)" }}>-{f.deleted}</span>
                    <button
                      type="button"
                      className="rs-icon-btn"
                      aria-label={`Open file history for ${f.path}`}
                      title="Open file history"
                      // Disabled when we lack a repoId — the API needs both repo + path.
                      disabled={!repoId}
                      onClick={() => onOpenFileHistory(f.path)}
                      style={{ width: 22, height: 22 }}
                    >
                      <History size={12} />
                    </button>
                  </div>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem
                    disabled={!repoId}
                    onSelect={() => onOpenFileHistory(f.path)}
                  >
                    <History />
                    Open file history
                  </ContextMenuItem>
                  <ContextMenuSeparator />
                  <ContextMenuItem
                    onSelect={() => void navigator.clipboard?.writeText(f.path)}
                  >
                    <Copy />
                    Copy path
                  </ContextMenuItem>
                  <ContextMenuItem
                    disabled={!onFilterByPath}
                    onSelect={() => onFilterByPath?.(f.path)}
                  >
                    <FileSearch />
                    Filter by this path
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            ))
          )}
        </ChangedFilesSection>

        <Section
          title="DIFF"
          hint={diff.truncated ? "truncated" : diff.diff ? "git show --patch" : "empty"}
        >
          {diff.diff || diff.truncated ? (
            <DiffViewer
              diff={diff.diff}
              truncated={diff.truncated}
              maxBytes={diff.maxBytes}
              commitHash={commit.hash}
              fullscreen={diffFullscreen}
              onFullscreenChange={onDiffFullscreenChange}
              viewMode={diffViewMode}
              onViewModeChange={onDiffViewModeChange}
              onOpenFileHistory={onOpenFileHistory}
              onFilterByPath={onFilterByPath}
            />
          ) : (
            <Empty>{loading ? "Loading diff…" : "No diff returned for this commit."}</Empty>
          )}
        </Section>

        <WhyPanel
          repoId={repoId}
          changedFiles={files.map((f) => f.path)}
          query={whyPanelQuery ?? null}
          onQueryChange={onWhyPanelQueryChange ?? (() => {})}
        />
      </div>
    </PanelShell>
  );
}

/**
 * Working-tree detail panel. Two tabs (Staged / Unstaged) share the same
 * `DiffViewer` used by per-commit and file-history views.
 *
 * Boundary discipline:
 * - The diff text is the literal `git diff [--cached]` output. No client-side
 *   reinterpretation; `parseUnifiedDiff` handles everything.
 * - The "untracked files are not shown" disclaimer in the footer reflects
 *   the API's `notes.untrackedExcluded` flag — refscope never silently hides
 *   the boundary.
 * - The viewer's `commitHash` prop is used as a reset key. We pass a sentinel
 *   that includes the active tab so switching tabs resets transient viewer
 *   state (collapse, query) the same way switching commits does.
 */
type WorkTreeTab = "staged" | "unstaged" | "untracked";

function WorkTreePanel({
  workTree,
  onOpenFileHistory,
  onFilterByPath,
}: {
  workTree: WorkTreeResponse | null;
  onOpenFileHistory: (path: string) => void;
  onFilterByPath?: (path: string) => void;
}) {
  const [activeTab, setActiveTab] = useState<WorkTreeTab>("staged");

  if (!workTree) {
    return (
      <PanelShell>
        <Empty>Loading working tree…</Empty>
      </PanelShell>
    );
  }

  const stagedFiles = workTree.staged.summary.fileCount;
  const unstagedFiles = workTree.unstaged.summary.fileCount;
  const untrackedFiles = workTree.untracked?.summary.fileCount ?? 0;
  const untrackedAvailable = !workTree.notes.untrackedExcluded && Boolean(workTree.untracked);
  // Default the active tab to whichever side has changes. Recomputed on each
  // render so the user lands on a useful tab when the underlying state
  // changes — e.g. they refreshed and only the unstaged side has content now.
  const tabHasContent = (tab: WorkTreeTab) =>
    tab === "staged"
      ? stagedFiles > 0
      : tab === "unstaged"
      ? unstagedFiles > 0
      : untrackedAvailable && untrackedFiles > 0;
  const effectiveTab: WorkTreeTab = tabHasContent(activeTab)
    ? activeTab
    : stagedFiles > 0
    ? "staged"
    : unstagedFiles > 0
    ? "unstaged"
    : untrackedAvailable && untrackedFiles > 0
    ? "untracked"
    : activeTab;

  return (
    <PanelShell>
      <div
        className="px-4 flex items-center justify-between"
        style={{
          height: 40,
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            fontWeight: 600,
            color: "var(--rs-warning)",
          }}
        >
          WORKING TREE — Not yet committed
        </div>
        <span
          style={{
            fontSize: 11,
            color: "var(--rs-text-muted)",
            fontFamily: "var(--rs-mono)",
          }}
        >
          {formatSnapshot(workTree.snapshotAt)}
        </span>
      </div>

      <div
        className="px-4 flex items-center gap-1"
        role="tablist"
        aria-label="Working tree view"
        style={{
          height: 36,
          borderBottom: "1px solid var(--rs-border)",
          background: "var(--rs-bg-canvas)",
        }}
      >
        <WorkTreeTabButton
          tabValue="staged"
          active={effectiveTab === "staged"}
          fileCount={stagedFiles}
          label="Staged"
          onSelect={() => setActiveTab("staged")}
        />
        <WorkTreeTabButton
          tabValue="unstaged"
          active={effectiveTab === "unstaged"}
          fileCount={unstagedFiles}
          label="Unstaged"
          onSelect={() => setActiveTab("unstaged")}
        />
        {untrackedAvailable ? (
          <WorkTreeTabButton
            tabValue="untracked"
            active={effectiveTab === "untracked"}
            fileCount={untrackedFiles}
            label="Untracked"
            onSelect={() => setActiveTab("untracked")}
          />
        ) : null}
        <div className="flex-1" />
        <span
          style={{
            fontSize: 11,
            color: "var(--rs-text-muted)",
            fontFamily: "var(--rs-mono)",
          }}
        >
          {effectiveTab === "untracked"
            ? `+${workTree.untracked?.summary.added ?? 0}`
            : `+${(effectiveTab === "staged" ? workTree.staged : workTree.unstaged).summary.added} −${(effectiveTab === "staged" ? workTree.staged : workTree.unstaged).summary.deleted}`}
        </span>
      </div>

      <div
        className="overflow-y-auto"
        style={{ flex: 1 }}
        role="tabpanel"
        aria-label={`${effectiveTab} changes`}
      >
        {effectiveTab === "untracked" ? (
          untrackedFiles === 0 ? (
            <Empty>No untracked files.</Empty>
          ) : workTree.untracked!.diff ? (
            <DiffViewer
              diff={workTree.untracked!.diff}
              truncated={false}
              maxBytes={0}
              commitHash={`worktree:untracked`}
              onOpenFileHistory={onOpenFileHistory}
              onFilterByPath={onFilterByPath}
            />
          ) : (
            // Defensive: a non-empty file list with an empty synthetic diff
            // shouldn't happen (the API always emits at least the `diff --git`
            // headers), but fall back to the path-only list if it does.
            <UntrackedFileList
              files={workTree.untracked!.files}
              onFilterByPath={onFilterByPath}
            />
          )
        ) : (() => {
          const section = effectiveTab === "staged" ? workTree.staged : workTree.unstaged;
          const filesInTab = section.summary.fileCount;
          if (filesInTab === 0) {
            return (
              <Empty>
                {effectiveTab === "staged"
                  ? "No staged changes."
                  : "No unstaged changes."}
              </Empty>
            );
          }
          return section.diff || section.truncated ? (
            <DiffViewer
              diff={section.diff}
              truncated={section.truncated}
              maxBytes={0}
              // Sentinel `commitHash`: the viewer uses this prop as a reset
              // key. Tab is encoded so switching tabs resets fullscreen /
              // collapse / query state. snapshotAt is intentionally NOT in
              // the sentinel — the worktree polls every few seconds, and
              // including it would dismiss fullscreen and re-collapse files
              // on every tick.
              commitHash={`worktree:${effectiveTab}`}
              onOpenFileHistory={onOpenFileHistory}
              onFilterByPath={onFilterByPath}
            />
          ) : (
            <Empty>
              {effectiveTab === "staged"
                ? "No staged changes."
                : "No unstaged changes."}
            </Empty>
          );
        })()}
      </div>

      {workTree.notes.untrackedExcluded ? (
        <div
          className="px-4 py-2"
          style={{
            borderTop: "1px solid var(--rs-border)",
            background: "var(--rs-bg-panel)",
            fontSize: 11,
            color: "var(--rs-text-muted)",
            fontFamily: "var(--rs-mono)",
          }}
        >
          Untracked files are not shown in this view.
        </div>
      ) : null}
    </PanelShell>
  );
}

function UntrackedFileList({
  files,
  onFilterByPath,
}: {
  files: WorkTreeUntrackedFile[];
  onFilterByPath?: (path: string) => void;
}) {
  return (
    <div role="list" aria-label="Untracked files">
      {files.map((f) => (
        <ContextMenu key={f.path}>
          <ContextMenuTrigger asChild>
            <div
              role="listitem"
              className="px-4 py-1.5 flex items-center gap-2"
              style={{
                fontSize: 12,
                fontFamily: "var(--rs-mono)",
                borderBottom:
                  "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
              }}
            >
              <FileBadge status="A" />
              <span
                className="flex-1 truncate"
                style={{ color: "var(--rs-text-primary)" }}
                title={f.path}
              >
                {f.path}
              </span>
              <span style={{ color: "var(--rs-git-added)" }}>+{f.added}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => void navigator.clipboard?.writeText(f.path)}
            >
              <Copy />
              Copy path
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!onFilterByPath}
              onSelect={() => onFilterByPath?.(f.path)}
            >
              <FileSearch />
              Filter by this path
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      ))}
    </div>
  );
}

function WorkTreeTabButton({
  tabValue,
  active,
  fileCount,
  label,
  onSelect,
}: {
  tabValue: WorkTreeTab;
  active: boolean;
  fileCount: number;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={`worktree-${tabValue}`}
      onClick={onSelect}
      style={{
        height: 28,
        padding: "0 12px",
        border: "1px solid var(--rs-border)",
        borderRadius: "var(--rs-radius-sm)",
        fontSize: 11,
        fontFamily: "var(--rs-mono)",
        background: active
          ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 16%)"
          : "transparent",
        color: active ? "var(--rs-text-primary)" : "var(--rs-text-secondary)",
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
      }}
    >
      {label}
      <span
        style={{
          marginLeft: 6,
          color: active ? "var(--rs-text-primary)" : "var(--rs-text-muted)",
        }}
      >
        ({fileCount})
      </span>
    </button>
  );
}

function formatSnapshot(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return `snapshot ${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `snapshot ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `snapshot ${hours}h ago`;
  return `snapshot ${Math.floor(hours / 24)}d ago`;
}

function ChangeGraph({
  files,
  totalAdded,
  totalDeleted,
}: {
  files: Commit["files"];
  totalAdded: number;
  totalDeleted: number;
}) {
  const maxFileChange = Math.max(1, ...files.map((file) => file.added + file.deleted));
  const totalChange = totalAdded + totalDeleted;
  const addedPercent = totalChange ? Math.round((totalAdded / totalChange) * 100) : 0;
  const deletedPercent = totalChange ? 100 - addedPercent : 0;

  return (
    <div
      className="px-3 py-3"
      aria-label={`Change graph with ${totalAdded} additions and ${totalDeleted} deletions`}
      style={{ color: "var(--rs-text-secondary)", fontSize: 11 }}
    >
      <div className="flex items-center gap-2" style={{ fontFamily: "var(--rs-mono)" }}>
        <span style={{ color: "var(--rs-git-added)" }}>+{totalAdded}</span>
        <div
          className="flex flex-1 overflow-hidden rounded-sm"
          style={{ height: 8, background: "var(--rs-bg-canvas)" }}
          aria-hidden
        >
          <span style={{ width: `${addedPercent}%`, background: "var(--rs-git-added)" }} />
          <span style={{ width: `${deletedPercent}%`, background: "var(--rs-git-deleted)" }} />
        </div>
        <span style={{ color: "var(--rs-git-deleted)" }}>-{totalDeleted}</span>
      </div>

      {files.length ? (
        <div className="mt-3 grid gap-1.5">
          {files.slice(0, 8).map((file) => {
            const width = Math.max(6, Math.round(((file.added + file.deleted) / maxFileChange) * 100));
            return (
              <div
                key={file.path}
                className="grid items-center gap-2"
                style={{ gridTemplateColumns: "1fr 74px" }}
              >
                <span
                  className="truncate"
                  title={`${file.path}: +${file.added} -${file.deleted}`}
                  style={{ color: "var(--rs-text-muted)", fontFamily: "var(--rs-mono)" }}
                >
                  {file.path}
                </span>
                <span
                  className="rounded-sm"
                  style={{
                    height: 6,
                    background: "var(--rs-bg-canvas)",
                    overflow: "hidden",
                  }}
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-sm"
                    style={{
                      width: `${width}%`,
                      background:
                        file.deleted > file.added ? "var(--rs-git-deleted)" : "var(--rs-git-added)",
                    }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-2" style={{ color: "var(--rs-text-muted)" }}>
          Change graph appears after file stats load.
        </div>
      )}
    </div>
  );
}

function FileStatusMix({ files }: { files: Commit["files"] }) {
  const segments = summarizeFileStatuses(files);
  return (
    <div
      className="px-3 py-3"
      aria-label={`File status mix for ${files.length} files`}
      style={{ color: "var(--rs-text-secondary)", fontSize: 11 }}
    >
      {segments.length ? (
        <>
          <div
            className="flex overflow-hidden rounded-sm"
            style={{ height: 10, background: "var(--rs-bg-canvas)" }}
            aria-hidden
          >
            {segments.map((segment) => (
              <span
                key={segment.status}
                style={{
                  width: `${segment.percent}%`,
                  background: segment.color,
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {segments.map((segment) => (
              <span
                key={segment.status}
                className="inline-flex items-center gap-1"
                style={{ fontFamily: "var(--rs-mono)", fontSize: 10 }}
              >
                <span
                  className="rounded-sm"
                  style={{ width: 8, height: 8, background: segment.color }}
                  aria-hidden
                />
                <span style={{ color: "var(--rs-text-primary)" }}>{segment.status}</span>
                <span style={{ color: "var(--rs-text-muted)" }}>{segment.count}</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div style={{ color: "var(--rs-text-muted)" }}>
          File status mix appears after changed files load.
        </div>
      )}
    </div>
  );
}

function summarizeFileStatuses(files: Commit["files"]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({
      status,
      count,
      percent: files.length ? Math.max(5, Math.round((count / files.length) * 100)) : 0,
      color: fileStatusColor(status),
    }));
}

function fileStatusColor(status: string) {
  if (status === "A") return "var(--rs-git-added)";
  if (status === "D") return "var(--rs-git-deleted)";
  if (status === "M") return "var(--rs-git-modified)";
  return "var(--rs-text-secondary)";
}

function formatSignatureStatus(status: Commit["signatureStatus"]) {
  if (!status || status === "valid") return "Signed";
  return status
    .split("-")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <aside
      className="flex flex-col overflow-hidden h-full w-full"
      style={{
        background: "var(--rs-bg-panel)",
        borderLeft: "1px solid var(--rs-border)",
      }}
    >
      {children}
    </aside>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt
        style={{
          color: "var(--rs-text-muted)",
          fontSize: 11,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </dt>
      <dd style={{ color: "var(--rs-text-primary)", fontSize: 12 }}>{children}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------
// "Why is this here?" panel
// ---------------------------------------------------------------------------

/**
 * WhyPanel — lets the user query `git log -L` for a line range in a file that
 * was modified in the selected commit. All displayed text is the literal output
 * from Git; no inference is performed.
 */
function WhyPanel({
  repoId,
  changedFiles,
  query,
  onQueryChange,
}: {
  repoId: string;
  changedFiles: string[];
  query: WhyPanelQuery | null;
  onQueryChange: (q: WhyPanelQuery | null) => void;
}) {
  const [localPath, setLocalPath] = useState(query?.path ?? "");
  const [localStart, setLocalStart] = useState(query?.lineStart ? String(query.lineStart) : "");
  const [localEnd, setLocalEnd] = useState(query?.lineEnd ? String(query.lineEnd) : "");
  const [result, setResult] = useState<RangeHistoryResponse | null>(null);
  const [fetchError, setFetchError] = useState("");
  const [fetching, setFetching] = useState(false);
  const [middleExpanded, setMiddleExpanded] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      const start = parseInt(localStart, 10);
      const end = parseInt(localEnd, 10);
      if (!localPath || !Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
        setFetchError("Please enter a valid path and line range (start ≤ end, both ≥ 1).");
        return;
      }
      const q: WhyPanelQuery = { path: localPath, lineStart: start, lineEnd: end };
      onQueryChange(q);
      setFetchError("");
      setResult(null);
      setMiddleExpanded(false);
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      setFetching(true);
      try {
        const data = await fetchRangeHistory(repoId, { path: q.path, lineStart: q.lineStart, lineEnd: q.lineEnd }, ctrl.signal);
        if (!ctrl.signal.aborted) {
          setResult(data);
        }
      } catch (err) {
        if (!ctrl.signal.aborted) {
          setFetchError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!ctrl.signal.aborted) {
          setFetching(false);
        }
      }
    },
    [localPath, localStart, localEnd, repoId, onQueryChange],
  );

  // When a file from the context menu is selected, pre-fill the path.
  const handleFileSelect = (path: string) => {
    setLocalPath(path);
  };

  const entries = result?.entries ?? [];
  const oldest = entries.length > 0 ? entries[entries.length - 1] : null;
  const newest = entries.length > 0 ? entries[0] : null;
  const middle = entries.length > 2 ? entries.slice(1, entries.length - 1) : [];

  return (
    <div style={{ borderBottom: "1px solid var(--rs-border)" }}>
      {/* Section header */}
      <div
        className="px-4 flex items-center gap-2"
        style={{
          height: 30,
          fontSize: 10,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--rs-text-muted)",
          background: "var(--rs-bg-canvas)",
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <Search size={10} aria-hidden />
        <span>WHY IS THIS HERE?</span>
      </div>

      {/* Query form */}
      <form onSubmit={(e) => void handleSubmit(e)} className="px-3 py-2" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        {/* File path — datalist from changed files */}
        <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <label
            htmlFor="why-path"
            style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--rs-text-muted)" }}
          >
            FILE PATH
          </label>
          <input
            id="why-path"
            list="why-path-list"
            value={localPath}
            onChange={(e) => setLocalPath(e.target.value)}
            placeholder="path/to/file.ts"
            autoComplete="off"
            style={{
              fontSize: 11,
              fontFamily: "var(--rs-mono)",
              background: "var(--rs-bg-elevated)",
              color: "var(--rs-text-primary)",
              border: "1px solid var(--rs-border)",
              borderRadius: 4,
              padding: "3px 6px",
              outline: "none",
              width: "100%",
            }}
          />
          {changedFiles.length > 0 ? (
            <datalist id="why-path-list">
              {changedFiles.map((p) => (
                <option key={p} value={p} />
              ))}
            </datalist>
          ) : null}
        </div>

        {/* Line range */}
        <div style={{ display: "flex", gap: 6, alignItems: "flex-end" }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <label
              htmlFor="why-start"
              style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--rs-text-muted)" }}
            >
              LINE START
            </label>
            <input
              id="why-start"
              type="number"
              min={1}
              max={99999}
              value={localStart}
              onChange={(e) => setLocalStart(e.target.value)}
              placeholder="1"
              style={{
                fontSize: 11,
                fontFamily: "var(--rs-mono)",
                background: "var(--rs-bg-elevated)",
                color: "var(--rs-text-primary)",
                border: "1px solid var(--rs-border)",
                borderRadius: 4,
                padding: "3px 6px",
                outline: "none",
                width: "100%",
              }}
            />
          </div>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
            <label
              htmlFor="why-end"
              style={{ fontSize: 10, letterSpacing: "0.06em", color: "var(--rs-text-muted)" }}
            >
              LINE END
            </label>
            <input
              id="why-end"
              type="number"
              min={1}
              max={99999}
              value={localEnd}
              onChange={(e) => setLocalEnd(e.target.value)}
              placeholder="1"
              style={{
                fontSize: 11,
                fontFamily: "var(--rs-mono)",
                background: "var(--rs-bg-elevated)",
                color: "var(--rs-text-primary)",
                border: "1px solid var(--rs-border)",
                borderRadius: 4,
                padding: "3px 6px",
                outline: "none",
                width: "100%",
              }}
            />
          </div>
          <button
            type="submit"
            disabled={fetching || !repoId}
            style={{
              fontSize: 11,
              padding: "4px 10px",
              borderRadius: 4,
              background: "var(--rs-accent)",
              color: "#fff",
              border: "none",
              cursor: fetching ? "wait" : "pointer",
              opacity: fetching ? 0.6 : 1,
              whiteSpace: "nowrap",
              alignSelf: "flex-end",
            }}
          >
            {fetching ? "Loading…" : "Search"}
          </button>
        </div>

        {/* Quick-fill chips from changed files */}
        {changedFiles.length > 0 ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {changedFiles.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => handleFileSelect(p)}
                title={`Use ${p}`}
                style={{
                  fontSize: 10,
                  fontFamily: "var(--rs-mono)",
                  padding: "1px 6px",
                  borderRadius: 99,
                  background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 10%)",
                  color: "var(--rs-text-secondary)",
                  border: "1px solid var(--rs-border)",
                  cursor: "pointer",
                  maxWidth: 180,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.split("/").pop()}
              </button>
            ))}
          </div>
        ) : null}
      </form>

      {/* Results */}
      {fetchError ? (
        <div className="px-3 pb-3" style={{ fontSize: 11, color: "var(--rs-git-deleted)" }}>
          {fetchError}
        </div>
      ) : null}

      {result !== null && entries.length === 0 ? (
        <Empty>No commits found for this line range.</Empty>
      ) : null}

      {result !== null && entries.length > 0 ? (
        <div style={{ display: "flex", flexDirection: "column" }}>
          {/* Newest commit */}
          {newest !== null ? (
            <WhyEntry entry={newest} label="LATEST CHANGE" />
          ) : null}

          {/* Middle history (collapsible) */}
          {middle.length > 0 ? (
            <div>
              <button
                type="button"
                onClick={() => setMiddleExpanded((v) => !v)}
                className="px-3 flex items-center gap-1"
                style={{
                  width: "100%",
                  textAlign: "left",
                  fontSize: 10,
                  letterSpacing: "0.06em",
                  color: "var(--rs-text-muted)",
                  background: "var(--rs-bg-canvas)",
                  border: "none",
                  borderTop: "1px solid color-mix(in oklab, var(--rs-border), transparent 40%)",
                  borderBottom: "1px solid color-mix(in oklab, var(--rs-border), transparent 40%)",
                  cursor: "pointer",
                  padding: "4px 12px",
                  gap: 4,
                  display: "flex",
                  alignItems: "center",
                }}
              >
                {middleExpanded ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
                {middle.length} more commit{middle.length === 1 ? "" : "s"} in between
              </button>
              {middleExpanded
                ? middle.map((e) => <WhyEntry key={e.hash} entry={e} />)
                : null}
            </div>
          ) : null}

          {/* Oldest commit — the likely introducing commit */}
          {oldest !== null && oldest !== newest ? (
            <WhyEntry entry={oldest} label="OLDEST (INTRODUCED HERE?)" />
          ) : null}

          {/* Footer note */}
          <div
            className="px-3 py-2"
            style={{
              fontSize: 10,
              color: "var(--rs-text-muted)",
              borderTop: "1px solid var(--rs-border)",
              fontStyle: "italic",
            }}
          >
            Literal commit messages from Git — no LLM inference used.
            {result.truncated ? ` Showing first ${result.limit} of more results.` : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Single commit entry within the WhyPanel result list. */
function WhyEntry({
  entry,
  label,
}: {
  entry: RangeHistoryEntry;
  label?: string;
}) {
  return (
    <div
      style={{
        borderTop: "1px solid color-mix(in oklab, var(--rs-border), transparent 40%)",
        padding: "6px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 2,
      }}
    >
      {label ? (
        <span
          style={{
            fontSize: 9,
            letterSpacing: "0.08em",
            fontWeight: 700,
            color: "var(--rs-accent)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </span>
      ) : null}
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--rs-mono)",
            color: "var(--rs-text-muted)",
            flexShrink: 0,
          }}
        >
          {entry.shortHash}
        </span>
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--rs-text-primary)",
            lineHeight: 1.4,
          }}
        >
          {entry.subject}
        </span>
      </div>
      <div
        style={{
          fontSize: 11,
          color: "var(--rs-text-secondary)",
          display: "flex",
          gap: 6,
        }}
      >
        <span>{entry.author}</span>
        <span style={{ color: "var(--rs-text-muted)" }}>·</span>
        <span>{formatDate(entry.authorDate)}</span>
      </div>
      {entry.body ? (
        <p
          style={{
            fontSize: 11,
            color: "var(--rs-text-secondary)",
            lineHeight: 1.5,
            marginTop: 2,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {entry.body}
        </p>
      ) : null}
      {entry.urlsInBody.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 2 }}>
          {entry.urlsInBody.map((url, i) => (
            url.startsWith("http") ? (
              <a
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                href={url}
                target="_blank"
                rel="noreferrer noopener"
                style={{
                  fontSize: 10,
                  fontFamily: "var(--rs-mono)",
                  color: "var(--rs-accent)",
                  textDecoration: "underline",
                  wordBreak: "break-all",
                }}
              >
                {url}
              </a>
            ) : (
              <span
                // eslint-disable-next-line react/no-array-index-key
                key={i}
                style={{
                  fontSize: 10,
                  fontFamily: "var(--rs-mono)",
                  color: "var(--rs-text-muted)",
                }}
              >
                {url}
              </span>
            )
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--rs-border)" }}>
      <div
        className="px-4 flex items-center justify-between"
        style={{
          height: 30,
          fontSize: 10,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--rs-text-muted)",
          background: "var(--rs-bg-canvas)",
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <span>{title}</span>
        {hint ? (
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function ChangedFilesSection({
  fileCount,
  view,
  onViewChange,
  children,
}: {
  fileCount: number;
  view: ChangedFilesView;
  onViewChange: (next: ChangedFilesView) => void;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--rs-border)" }}>
      <div
        className="px-4 flex items-center justify-between gap-2"
        style={{
          height: 30,
          fontSize: 10,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--rs-text-muted)",
          background: "var(--rs-bg-canvas)",
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <span>CHANGED FILES</span>
        <div className="flex items-center gap-2">
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {fileCount} files
          </span>
          <div
            role="group"
            aria-label="Changed files view mode"
            className="flex items-center"
            style={{
              border: "1px solid var(--rs-border)",
              borderRadius: "var(--rs-radius-sm)",
              overflow: "hidden",
            }}
          >
            <ChangedFilesViewButton
              active={view === "list"}
              label="List"
              icon={<ListIcon size={11} />}
              onClick={() => onViewChange("list")}
            />
            <ChangedFilesViewButton
              active={view === "tree"}
              label="Tree"
              icon={<FolderTree size={11} />}
              onClick={() => onViewChange("tree")}
            />
          </div>
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

function ChangedFilesViewButton({
  active,
  label,
  icon,
  onClick,
}: {
  active: boolean;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      title={`${label} view`}
      className="flex items-center gap-1"
      style={{
        height: 20,
        padding: "0 6px",
        background: active ? "var(--rs-bg-elevated)" : "transparent",
        color: active ? "var(--rs-text-primary)" : "var(--rs-text-muted)",
        fontSize: 10,
        fontFamily: "var(--rs-mono)",
        textTransform: "none",
        letterSpacing: 0,
        fontWeight: active ? 600 : 400,
        cursor: "pointer",
        border: "none",
      }}
    >
      {icon}
      {label}
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-4"
      style={{ fontSize: 12, color: "var(--rs-text-muted)" }}
    >
      {children}
    </div>
  );
}

// Branch priority for "Contained in" — main and release/* surface first so
// the SRE / release-engineer view answers "is this in prod yet?" without
// scrolling. Everything else (feature/*, personal branches) keeps API order.
function branchPriority(shortName: string): number {
  if (shortName === "main" || shortName === "master") return 0;
  if (shortName.startsWith("release/") || shortName.startsWith("releases/")) return 1;
  if (shortName.startsWith("hotfix/")) return 2;
  return 3;
}

function groupContainingRefs(refs: ContainingRef[]) {
  const branches = refs.filter((r) => r.type === "branch");
  const tags = refs.filter((r) => r.type === "tag");
  const remotes = refs.filter((r) => r.type === "remote");
  branches.sort((a, b) => {
    const p = branchPriority(a.shortName) - branchPriority(b.shortName);
    return p !== 0 ? p : a.shortName.localeCompare(b.shortName);
  });
  // Tags arrive newest-first from the API (--sort=-committerdate); preserve
  // that ordering so v0.9.0 lists above v0.1.0.
  return { branches, tags, remotes };
}

function containedInHint(refs: ContainingRef[] | null): string | undefined {
  if (refs === null) return undefined;
  if (refs.length === 0) return "0 refs";
  const { branches, tags, remotes } = groupContainingRefs(refs);
  const parts: string[] = [];
  if (branches.length > 0) parts.push(`${branches.length} branch${branches.length === 1 ? "" : "es"}`);
  if (tags.length > 0) parts.push(`${tags.length} tag${tags.length === 1 ? "" : "s"}`);
  if (remotes.length > 0) parts.push(`${remotes.length} remote${remotes.length === 1 ? "" : "s"}`);
  return parts.join(" · ");
}

function ContainedIn({ refs }: { refs: ContainingRef[] | null }) {
  if (refs === null) {
    return <Empty>Loading reachability…</Empty>;
  }
  if (refs.length === 0) {
    // Distinct copy from the generic empty states elsewhere in the panel —
    // the AC requires we explicitly tell the user the commit is unreachable
    // from any *public* ref (heads/tags/remotes), not that the section
    // failed to load.
    return <Empty>Not yet reachable from any public ref.</Empty>;
  }
  const { branches, tags, remotes } = groupContainingRefs(refs);
  return (
    <div className="px-3 py-2" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {branches.length > 0 ? <RefRow label="Branches" items={branches} accent="branch" /> : null}
      {tags.length > 0 ? <RefRow label="Tags" items={tags} accent="tag" /> : null}
      {remotes.length > 0 ? <RefRow label="Remotes" items={remotes} accent="remote" /> : null}
    </div>
  );
}

function RefRow({
  label,
  items,
  accent,
}: {
  label: string;
  items: ContainingRef[];
  accent: "branch" | "tag" | "remote";
}) {
  // Three accent palettes so a glance at the chip color answers
  // "did this reach main? is there a tag yet?" without reading text.
  const accentMap = {
    branch: "var(--rs-accent)",
    tag: "var(--rs-git-added)",
    remote: "var(--rs-text-muted)",
  } as const;
  const tint = accentMap[accent];
  return (
    <div className="flex items-baseline gap-2 flex-wrap">
      <span
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--rs-text-muted)",
          minWidth: 56,
        }}
      >
        {label.toUpperCase()}
      </span>
      <span className="flex flex-wrap gap-1">
        {items.map((ref) => (
          <span
            key={ref.name}
            title={ref.name}
            className="px-1.5 rounded-full"
            style={{
              fontSize: 10,
              fontFamily: "var(--rs-mono)",
              background: `color-mix(in oklab, var(--rs-bg-elevated), ${tint} 22%)`,
              color: "var(--rs-text-primary)",
              border: `1px solid color-mix(in oklab, var(--rs-border), ${tint} 50%)`,
            }}
          >
            {ref.shortName}
          </span>
        ))}
      </span>
    </div>
  );
}

export function FileBadge({ status }: { status: string }) {
  const map = {
    M: { color: "var(--rs-git-modified)", bg: "var(--rs-git-modified)" },
    A: { color: "var(--rs-git-added)", bg: "var(--rs-git-added)" },
    D: { color: "var(--rs-git-deleted)", bg: "var(--rs-git-deleted)" },
  } as const;
  const c = map[status as keyof typeof map] ?? {
    color: "var(--rs-text-secondary)",
    bg: "var(--rs-text-secondary)",
  };
  return (
    <span
      className="grid place-items-center rounded"
      style={{
        width: 16,
        height: 16,
        fontSize: 10,
        fontWeight: 700,
        color: c.color,
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${c.bg} 22%)`,
        border: `1px solid color-mix(in oklab, var(--rs-border), ${c.bg} 40%)`,
      }}
    >
      {status}
    </span>
  );
}

function formatDate(value?: string) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
