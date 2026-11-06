/**
 * RepoBrowserDialog — browse the repository as it was at any revision.
 *
 * Two tabs over one revision (a commit object ID plus a display label):
 *   - Files: walk directories (GET /tree), or type to "go to file" across the
 *     whole tree (GET /tree/paths, ranked client-side).
 *   - Search code: `git grep` over that revision's tree (GET /code-search),
 *     results grouped per file.
 * Opening a file (or a search hit) hands off to the existing file viewer,
 * which already provides blame, line tracing and file history.
 *
 * The viewer opens as a nested dialog on top, so closing it returns here
 * with the folder, finder query and search results intact.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { ChevronRight, File, FileSearch, Folder, FolderGit2, FolderTree, History, Link2, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "../ui/dialog";
import {
  fetchTree,
  fetchTreePaths,
  searchCode,
  type CodeSearchMatch,
  type CodeSearchMode,
  type CodeSearchResponse,
  type TreeResponse,
} from "../../api";
import type { GitRef } from "./data";
import {
  formatBytes,
  groupMatchesByFile,
  highlightMatchRanges,
  parentDirectory,
  pathBreadcrumbs,
  rankPaths,
} from "../../lib/repoExplorer";

export type BrowserRevision = {
  /** Full commit object ID. */
  commit: string;
  /** What the user picked: a ref's short name or a short hash. */
  label: string;
};

export type BrowserTab = "files" | "search";

type Async<T> =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; value: T };

const FINDER_LIMIT = 60;

export function RepoBrowserDialog({
  repoId,
  open,
  revision,
  requestedTab,
  refs,
  onRevisionChange,
  onClose,
  onOpenFile,
  onOpenHistory,
}: {
  repoId: string;
  open: boolean;
  revision: BrowserRevision | null;
  /** Bumped object: re-applied whenever App asks for a specific tab. */
  requestedTab: { tab: BrowserTab; nonce: number };
  refs: GitRef[];
  onRevisionChange: (revision: BrowserRevision) => void;
  onClose: () => void;
  onOpenFile: (path: string, commit: string, line?: number) => void;
  onOpenHistory?: (path: string) => void;
}) {
  const commit = revision?.commit ?? "";
  const [tab, setTab] = useState<BrowserTab>(requestedTab.tab);
  useEffect(() => setTab(requestedTab.tab), [requestedTab]);

  // ── Files tab state ──
  const [dir, setDir] = useState("");
  const [tree, setTree] = useState<Async<TreeResponse>>({ kind: "idle" });
  const [finder, setFinder] = useState("");
  const [paths, setPaths] = useState<Async<{ commit: string; paths: string[]; truncated: boolean }>>({ kind: "idle" });
  const [finderActive, setFinderActive] = useState(0);

  // ── Search tab state ──
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<CodeSearchMode>("fixed");
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [scope, setScope] = useState("");
  const [results, setResults] = useState<Async<CodeSearchResponse>>({ kind: "idle" });
  const searchAbortRef = useRef<AbortController | null>(null);

  // A different revision (or repository) starts from the root with no results.
  useEffect(() => {
    setDir("");
    setPaths({ kind: "idle" });
    setResults({ kind: "idle" });
    searchAbortRef.current?.abort();
  }, [repoId, commit]);

  useEffect(() => {
    if (!open || !commit || !repoId) return;
    const ctrl = new AbortController();
    setTree({ kind: "loading" });
    fetchTree(repoId, commit, dir, ctrl.signal)
      .then((value) => !ctrl.signal.aborted && setTree({ kind: "ready", value }))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setTree({ kind: "error", message: errorMessage(err) });
      });
    return () => ctrl.abort();
  }, [open, repoId, commit, dir]);

  // The path index is fetched lazily, the first time the finder is used.
  const wantsPaths = open && tab === "files" && finder.trim() !== "";
  useEffect(() => {
    if (!wantsPaths || !commit || !repoId) return;
    if (paths.kind === "ready" && paths.value.commit === commit) return;
    if (paths.kind === "loading") return;
    const ctrl = new AbortController();
    setPaths({ kind: "loading" });
    fetchTreePaths(repoId, commit, ctrl.signal)
      .then((value) => !ctrl.signal.aborted && setPaths({ kind: "ready", value }))
      .catch((err: unknown) => {
        if (!ctrl.signal.aborted) setPaths({ kind: "error", message: errorMessage(err) });
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsPaths, repoId, commit]);

  const ranked = useMemo(
    () => (paths.kind === "ready" && finder.trim() ? rankPaths(paths.value.paths, finder, FINDER_LIMIT) : []),
    [paths, finder],
  );
  useEffect(() => setFinderActive(0), [finder]);

  useEffect(() => () => searchAbortRef.current?.abort(), []);

  const runSearch = useCallback(
    (event?: FormEvent) => {
      event?.preventDefault();
      const trimmed = query.trim();
      if (!trimmed || !commit) return;
      searchAbortRef.current?.abort();
      const ctrl = new AbortController();
      searchAbortRef.current = ctrl;
      setResults({ kind: "loading" });
      searchCode(repoId, { commit, query: trimmed, mode, ignoreCase, path: scope.trim() || undefined }, ctrl.signal)
        .then((value) => !ctrl.signal.aborted && setResults({ kind: "ready", value }))
        .catch((err: unknown) => {
          if (!ctrl.signal.aborted) setResults({ kind: "error", message: errorMessage(err) });
        });
    },
    [query, commit, repoId, mode, ignoreCase, scope],
  );

  const searchInFolder = useCallback((folder: string) => {
    setScope(folder);
    setTab("search");
  }, []);

  const onFinderKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (ranked.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFinderActive((i) => Math.min(ranked.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFinderActive((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const pick = ranked[finderActive];
      if (pick) onOpenFile(pick.path, commit);
    }
  };

  const revisionOptions = useMemo(() => {
    const seen = new Set<string>();
    const options: Array<{ key: string; label: string; commit: string }> = [];
    for (const ref of refs) {
      if (ref.type !== "branch" && ref.type !== "tag" && ref.type !== "remote") continue;
      if (!/^[0-9a-f]{40}$/i.test(ref.hash) || seen.has(ref.name)) continue;
      seen.add(ref.name);
      options.push({ key: ref.name, label: `${ref.type === "tag" ? "tag" : ref.type === "remote" ? "remote" : "branch"}: ${ref.shortName}`, commit: ref.hash });
    }
    return options.slice(0, 200);
  }, [refs]);

  const shortHash = commit.slice(0, 7);
  const grouped = useMemo(
    () => (results.kind === "ready" ? groupMatchesByFile(results.value.matches) : []),
    [results],
  );

  return (
    <Dialog open={open && revision !== null} onOpenChange={(next) => !next && onClose()}>
      <DialogContent
        className="bg-[var(--rs-bg-elevated)] border-[var(--rs-border)] text-[var(--rs-text-primary)] shadow-[0_24px_60px_rgba(0,0,0,0.55)] sm:max-w-[min(1000px,calc(100vw-2rem))] w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] p-4 gap-3 grid-rows-[auto_auto_minmax(0,1fr)] [&>button]:text-[var(--rs-text-secondary)] [&>button]:opacity-100"
        style={{ height: "min(820px, calc(100dvh - 2rem))" }}
      >
        <DialogHeader className="pr-8">
          <DialogTitle className="text-[var(--rs-text-primary)]">
            <span className="flex items-center gap-2 min-w-0" style={{ fontSize: 14 }}>
              <FolderTree size={15} aria-hidden className="shrink-0" />
              <span className="truncate">
                Browse repository at{" "}
                <span style={{ fontFamily: "var(--rs-mono)" }}>{revision?.label ?? ""}</span>
              </span>
            </span>
          </DialogTitle>
          <DialogDescription className="text-[var(--rs-text-secondary)]" style={{ fontSize: 12 }}>
            Every file as committed at <span style={{ fontFamily: "var(--rs-mono)" }}>{shortHash}</span>. Read-only —
            uncommitted changes are not included.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-wrap items-center gap-2">
          <div role="tablist" aria-label="Browser mode" className="inline-flex" style={{ gap: 0 }}>
            <TabButton id="files" active={tab === "files"} onSelect={setTab} position="first">
              <FolderTree size={12} aria-hidden /> Files
            </TabButton>
            <TabButton id="search" active={tab === "search"} onSelect={setTab} position="last">
              <FileSearch size={12} aria-hidden /> Search code
            </TabButton>
          </div>
          <label className="flex items-center gap-1.5 ml-auto" style={{ fontSize: 12, color: "var(--rs-text-secondary)" }}>
            Revision
            <select
              value=""
              onChange={(event) => {
                const option = revisionOptions.find((o) => o.key === event.target.value);
                if (option) onRevisionChange({ commit: option.commit, label: option.key.replace(/^refs\/(heads|tags|remotes)\//, "") });
              }}
              style={selectStyle}
              aria-label="Revision to browse"
            >
              <option value="">
                {revision ? (revision.label === shortHash ? revision.label : `${revision.label} (${shortHash})`) : "—"}
              </option>
              {revisionOptions.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="min-h-0 flex flex-col gap-2" role="tabpanel" aria-label={tab === "files" ? "Files" : "Search code"}>
          {tab === "files" ? (
            <>
              <div className="relative">
                <Search size={13} aria-hidden style={{ position: "absolute", left: 8, top: 8, color: "var(--rs-text-muted)" }} />
                <input
                  type="search"
                  value={finder}
                  onChange={(event) => setFinder(event.target.value)}
                  onKeyDown={onFinderKeyDown}
                  placeholder="Go to file… (type part of a path; ↑↓ Enter)"
                  aria-label="Go to file"
                  autoFocus
                  style={{ ...inputStyle, paddingLeft: 26, width: "100%" }}
                />
              </div>
              {finder.trim() ? (
                <FinderResults
                  state={paths}
                  ranked={ranked}
                  active={finderActive}
                  onOpen={(p) => onOpenFile(p, commit)}
                  onHover={setFinderActive}
                />
              ) : (
                <DirectoryView
                  dir={dir}
                  state={tree}
                  onNavigate={setDir}
                  onOpenFile={(p) => onOpenFile(p, commit)}
                  onOpenHistory={onOpenHistory}
                  onSearchInFolder={searchInFolder}
                />
              )}
            </>
          ) : (
            <>
              <form onSubmit={runSearch} className="flex flex-wrap items-center gap-2">
                <input
                  type="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={mode === "regex" ? "Extended regex, e.g. function\\s+handle" : "Text to find"}
                  aria-label="Text or pattern to search for"
                  maxLength={200}
                  autoFocus
                  style={{ ...inputStyle, flex: "1 1 240px" }}
                />
                <input
                  type="text"
                  value={scope}
                  onChange={(event) => setScope(event.target.value)}
                  placeholder="In path (optional), e.g. src/api"
                  aria-label="Limit search to a path"
                  maxLength={200}
                  style={{ ...inputStyle, flex: "0 1 200px", fontFamily: "var(--rs-mono)" }}
                />
                <label className="flex items-center gap-1" style={toggleLabelStyle}>
                  <input type="checkbox" checked={mode === "regex"} onChange={(e) => setMode(e.target.checked ? "regex" : "fixed")} />
                  Regex
                </label>
                <label className="flex items-center gap-1" style={toggleLabelStyle}>
                  <input type="checkbox" checked={!ignoreCase} onChange={(e) => setIgnoreCase(!e.target.checked)} />
                  Match case
                </label>
                <button type="submit" className="rs-compact-button rs-compact-button--icon" disabled={!query.trim() || results.kind === "loading"}>
                  <Search size={12} aria-hidden /> Search
                </button>
              </form>
              <SearchResults
                state={results}
                grouped={grouped}
                onOpen={(p, line) => onOpenFile(p, commit, line)}
                onOpenHistory={onOpenHistory}
              />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function TabButton({
  id,
  active,
  onSelect,
  position,
  children,
}: {
  id: BrowserTab;
  active: boolean;
  onSelect: (tab: BrowserTab) => void;
  position: "first" | "last";
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      className="rs-compact-button rs-compact-button--icon"
      onClick={() => onSelect(id)}
      style={{
        borderRadius:
          position === "first" ? "var(--rs-radius-sm) 0 0 var(--rs-radius-sm)" : "0 var(--rs-radius-sm) var(--rs-radius-sm) 0",
        marginLeft: position === "last" ? -1 : 0,
        color: active ? "var(--rs-text-primary)" : undefined,
        background: active ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 22%)" : undefined,
        borderColor: active ? "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)" : undefined,
      }}
    >
      {children}
    </button>
  );
}

function DirectoryView({
  dir,
  state,
  onNavigate,
  onOpenFile,
  onOpenHistory,
  onSearchInFolder,
}: {
  dir: string;
  state: Async<TreeResponse>;
  onNavigate: (dir: string) => void;
  onOpenFile: (path: string) => void;
  onOpenHistory?: (path: string) => void;
  onSearchInFolder: (dir: string) => void;
}) {
  const crumbs = pathBreadcrumbs(dir);
  return (
    <div className="min-h-0 flex flex-col gap-1.5 flex-1">
      <nav aria-label="Folder path" className="flex flex-wrap items-center gap-0.5" style={{ fontSize: 12, fontFamily: "var(--rs-mono)" }}>
        <button type="button" className="rs-compact-button rs-compact-button--icon" onClick={() => onNavigate("")} aria-current={dir === "" ? "page" : undefined}>
          /
        </button>
        {crumbs.map((crumb, i) => (
          <span key={crumb.path} className="inline-flex items-center gap-0.5">
            <ChevronRight size={11} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
            <button
              type="button"
              className="rs-compact-button rs-compact-button--icon"
              onClick={() => onNavigate(crumb.path)}
              aria-current={i === crumbs.length - 1 ? "page" : undefined}
            >
              {crumb.name}
            </button>
          </span>
        ))}
        <button
          type="button"
          className="rs-compact-button rs-compact-button--icon ml-auto"
          onClick={() => onSearchInFolder(dir)}
          title={dir ? `Search code inside ${dir}` : "Search code in the whole repository"}
          style={{ fontFamily: "var(--rs-sans)" }}
        >
          <FileSearch size={12} aria-hidden /> Search here
        </button>
      </nav>
      <div className="min-h-0 overflow-auto flex-1" style={listBoxStyle}>
        {state.kind === "loading" || state.kind === "idle" ? (
          <Status>Loading…</Status>
        ) : state.kind === "error" ? (
          <Status role="alert">{state.message}</Status>
        ) : (
          <ul aria-label={dir ? `Contents of ${dir}` : "Repository root"} style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {dir ? (
              <li>
                <button type="button" style={rowStyle} onClick={() => onNavigate(parentDirectory(dir))}>
                  <Folder size={13} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
                  <span style={{ fontFamily: "var(--rs-mono)" }}>..</span>
                </button>
              </li>
            ) : null}
            {state.value.entries.length === 0 ? <Status>Empty directory.</Status> : null}
            {state.value.entries.map((entry) => (
              <li key={entry.path} className="flex items-center" style={{ borderBottom: "1px solid color-mix(in oklab, var(--rs-border), transparent 50%)" }}>
                {entry.type === "submodule" ? (
                  <div style={{ ...rowStyle, cursor: "default" }} title={`Submodule at ${entry.objectId.slice(0, 7)} — browse it in its own repository`}>
                    <FolderGit2 size={13} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
                    <span style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-secondary)" }}>{entry.name}</span>
                    <span style={metaStyle}>submodule @ {entry.objectId.slice(0, 7)}</span>
                  </div>
                ) : (
                  <button
                    type="button"
                    style={rowStyle}
                    onClick={() => (entry.type === "dir" ? onNavigate(entry.path) : onOpenFile(entry.path))}
                  >
                    {entry.type === "dir" ? (
                      <Folder size={13} aria-hidden style={{ color: "var(--rs-accent)" }} />
                    ) : entry.type === "symlink" ? (
                      <Link2 size={13} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
                    ) : (
                      <File size={13} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
                    )}
                    <span className="truncate" style={{ fontFamily: "var(--rs-mono)" }}>
                      {entry.name}
                      {entry.type === "dir" ? "/" : ""}
                    </span>
                    <span style={metaStyle}>{entry.type === "symlink" ? "symlink" : formatBytes(entry.size)}</span>
                  </button>
                )}
                {entry.type === "file" && onOpenHistory ? (
                  <button
                    type="button"
                    className="rs-compact-button rs-compact-button--icon"
                    onClick={() => onOpenHistory(entry.path)}
                    aria-label={`History of ${entry.path}`}
                    title="File history"
                    style={{ marginRight: 6 }}
                  >
                    <History size={12} aria-hidden />
                  </button>
                ) : null}
              </li>
            ))}
            {state.value.truncated ? <Status>Listing cut at {state.value.entries.length} entries — use “Go to file”.</Status> : null}
          </ul>
        )}
      </div>
    </div>
  );
}

function FinderResults({
  state,
  ranked,
  active,
  onOpen,
  onHover,
}: {
  state: Async<{ commit: string; paths: string[]; truncated: boolean }>;
  ranked: ReturnType<typeof rankPaths>;
  active: number;
  onOpen: (path: string) => void;
  onHover: (index: number) => void;
}) {
  if (state.kind === "loading" || state.kind === "idle") return <Status>Indexing files…</Status>;
  if (state.kind === "error") return <Status role="alert">{state.message}</Status>;
  return (
    <div className="min-h-0 overflow-auto flex-1" style={listBoxStyle}>
      <p aria-live="polite" style={{ ...metaStyle, margin: "6px 10px" }}>
        {ranked.length === 0
          ? `No file matches among ${state.value.paths.length.toLocaleString()} files.`
          : `${ranked.length}${ranked.length === FINDER_LIMIT ? "+" : ""} matches among ${state.value.paths.length.toLocaleString()} files`}
        {state.value.truncated ? " (index truncated for a very large tree)" : ""}
      </p>
      <ul role="listbox" aria-label="Matching files" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {ranked.map((item, index) => (
          <li key={item.path} role="option" aria-selected={index === active}>
            <button
              type="button"
              style={{
                ...rowStyle,
                background: index === active ? "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 16%)" : undefined,
              }}
              onClick={() => onOpen(item.path)}
              onMouseEnter={() => onHover(index)}
              ref={index === active ? (el) => el?.scrollIntoView({ block: "nearest" }) : undefined}
            >
              <File size={13} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
              <span className="truncate" style={{ fontFamily: "var(--rs-mono)" }}>
                <Highlighted text={item.path} positions={item.positions} />
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SearchResults({
  state,
  grouped,
  onOpen,
  onOpenHistory,
}: {
  state: Async<CodeSearchResponse>;
  grouped: Array<{ path: string; matches: CodeSearchMatch[] }>;
  onOpen: (path: string, line?: number) => void;
  onOpenHistory?: (path: string) => void;
}) {
  if (state.kind === "idle") {
    return <Status>Search every file at this revision. Matches open in the file viewer at the line.</Status>;
  }
  if (state.kind === "loading") return <Status>Searching…</Status>;
  if (state.kind === "error") return <Status role="alert">{state.message}</Status>;
  const result = state.value;
  return (
    <div className="min-h-0 overflow-auto flex-1" style={listBoxStyle}>
      <p aria-live="polite" style={{ ...metaStyle, margin: "6px 10px" }}>
        {result.matches.length === 0
          ? "No matches."
          : `${result.matches.length} match${result.matches.length === 1 ? "" : "es"} in ${result.fileCount} file${result.fileCount === 1 ? "" : "s"}`}
        {result.truncated ? ` — results capped (max ${result.perFileLimit} per file); narrow the pattern or path` : ""}
      </p>
      {grouped.map((group) => (
        <section key={group.path} aria-label={group.path} style={{ marginBottom: 6 }}>
          <div className="flex items-center gap-1" style={{ padding: "4px 8px", background: "var(--rs-bg-panel)", position: "sticky", top: 0 }}>
            <button type="button" style={{ ...rowStyle, padding: "2px 4px" }} onClick={() => onOpen(group.path)}>
              <File size={13} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
              <span className="truncate" style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-primary)" }}>{group.path}</span>
              <span style={metaStyle} title={group.matches.length >= result.perFileLimit ? `Showing the first ${result.perFileLimit} matches in this file` : undefined}>
                {group.matches.length >= result.perFileLimit ? `${result.perFileLimit}+` : group.matches.length}
              </span>
            </button>
            {onOpenHistory ? (
              <button type="button" className="rs-compact-button rs-compact-button--icon" onClick={() => onOpenHistory(group.path)} aria-label={`History of ${group.path}`} title="File history">
                <History size={12} aria-hidden />
              </button>
            ) : null}
          </div>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {group.matches.map((match) => (
              <li key={match.line}>
                <button
                  type="button"
                  onClick={() => onOpen(match.path, match.line)}
                  aria-label={`${match.path} line ${match.line}`}
                  style={{ ...rowStyle, alignItems: "baseline", fontFamily: "var(--rs-mono)", fontSize: 12 }}
                >
                  <span style={{ color: "var(--rs-text-muted)", minWidth: "5ch", textAlign: "right", flex: "none" }}>{match.line}</span>
                  <span style={{ whiteSpace: "pre", overflow: "hidden", textOverflow: "ellipsis", color: "var(--rs-text-secondary)" }}>
                    <RangeHighlighted
                      text={match.text}
                      ranges={highlightMatchRanges(match.text, result.query, result.mode, result.ignoreCase)}
                    />
                    {match.clipped ? "…" : ""}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Highlighted({ text, positions }: { text: string; positions: number[] }) {
  if (positions.length === 0) return <>{text}</>;
  const marks = new Set(positions);
  const parts: ReactNode[] = [];
  let run = "";
  let runMarked = false;
  const flush = (key: number) => {
    if (!run) return;
    parts.push(runMarked ? <mark key={key} style={markStyle}>{run}</mark> : <span key={key}>{run}</span>);
    run = "";
  };
  for (let i = 0; i < text.length; i += 1) {
    const marked = marks.has(i);
    if (marked !== runMarked) {
      flush(i);
      runMarked = marked;
    }
    run += text[i];
  }
  flush(text.length);
  return <>{parts}</>;
}

function RangeHighlighted({ text, ranges }: { text: string; ranges: Array<[number, number]> }) {
  if (ranges.length === 0) return <>{text}</>;
  const parts: ReactNode[] = [];
  let at = 0;
  ranges.forEach(([start, end], i) => {
    if (start > at) parts.push(<span key={`t${i}`}>{text.slice(at, start)}</span>);
    parts.push(<mark key={`m${i}`} style={markStyle}>{text.slice(start, end)}</mark>);
    at = end;
  });
  if (at < text.length) parts.push(<span key="tail">{text.slice(at)}</span>);
  return <>{parts}</>;
}

function Status({ children, role }: { children: ReactNode; role?: "alert" }) {
  return (
    <p role={role} style={{ ...metaStyle, margin: "10px", fontSize: 12 }}>
      {children}
    </p>
  );
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

// ─── Styles ─────────────────────────────────────────────────────────────────

const inputStyle = {
  height: 30,
  padding: "0 8px",
  fontSize: 12,
  borderRadius: "var(--rs-radius-sm)",
  border: "1px solid var(--rs-border)",
  background: "var(--rs-bg-canvas)",
  color: "var(--rs-text-primary)",
} as const;

const selectStyle = { ...inputStyle, maxWidth: 260 } as const;

const toggleLabelStyle = { fontSize: 12, color: "var(--rs-text-secondary)", cursor: "pointer" } as const;

const listBoxStyle = {
  border: "1px solid var(--rs-border)",
  borderRadius: "var(--rs-radius-md)",
  background: "var(--rs-bg-canvas)",
} as const;

const rowStyle = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  minWidth: 0,
  padding: "5px 10px",
  fontSize: 12,
  textAlign: "left",
  background: "transparent",
  border: "none",
  color: "var(--rs-text-primary)",
  cursor: "pointer",
} as const;

const metaStyle = {
  marginLeft: "auto",
  paddingLeft: 8,
  fontSize: 11,
  color: "var(--rs-text-muted)",
  flex: "none",
} as const;

const markStyle = {
  background: "color-mix(in oklab, transparent, var(--rs-warning) 35%)",
  color: "var(--rs-text-primary)",
  borderRadius: 2,
} as const;
