import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, Maximize2, Minimize2 } from "lucide-react";
import {
  countFileChanges,
  countTotalChanges,
  fileToDiffText,
  parseUnifiedDiff,
  type DiffChangeKind,
  type DiffFile,
  type DiffHunk,
  type DiffLine,
} from "../../lib/parseUnifiedDiff";
import {
  detectLanguage,
  flattenTokens,
  tokenizeLine,
  type HighlightedRun,
} from "../../lib/syntaxHighlight";

/**
 * Structured unified-diff viewer. Receives the raw `git show --patch` output
 * and renders a file list + diff body with real line numbers, +/-/context
 * coloring, file-level collapse, filtering, single/all view modes, soft word
 * wrap, and whitespace visualization.
 *
 * Stays UI-only: `truncated` and `maxBytes` come straight from the API
 * response (no client-side guesses) and the parser never throws.
 */
export function DiffViewer({
  diff,
  truncated,
  maxBytes,
  commitHash,
  fullscreen: fullscreenProp,
  onFullscreenChange,
}: {
  diff: string;
  truncated: boolean;
  maxBytes: number;
  commitHash: string;
  fullscreen?: boolean;
  onFullscreenChange?: (next: boolean) => void;
}) {
  const parsed = useMemo(() => parseUnifiedDiff(diff), [diff]);
  const totals = useMemo(() => countTotalChanges(parsed), [parsed]);

  const [viewMode, setViewMode] = useState<"all" | "single">("all");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [wordWrap, setWordWrap] = useState(false);
  const [showWhitespace, setShowWhitespace] = useState(false);
  const [query, setQuery] = useState("");
  const [collapsedKeys, setCollapsedKeys] = useState<Set<string>>(() => {
    if (parsed.files.length > 30) {
      return new Set(parsed.files.map((file) => fileKey(file)));
    }
    return new Set();
  });
  const [copyStatus, setCopyStatus] = useState("");

  // Fullscreen is controlled when the parent passes a value; otherwise the viewer
  // owns the state internally so usages without a parent override still work.
  const [internalFullscreen, setInternalFullscreen] = useState(false);
  const isControlled = fullscreenProp !== undefined;
  const fullscreen = isControlled ? fullscreenProp : internalFullscreen;
  const setFullscreen = useCallback(
    (next: boolean) => {
      if (!isControlled) setInternalFullscreen(next);
      onFullscreenChange?.(next);
    },
    [isControlled, onFullscreenChange],
  );

  const fullscreenToggleRef = useRef<HTMLButtonElement | null>(null);
  const exitFullscreenButtonRef = useRef<HTMLButtonElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Reset transient state when the underlying commit changes. Fullscreen is
  // also closed on commit change — opening a new commit while still in
  // fullscreen would surprise the user with a stale-context overlay.
  useEffect(() => {
    setQuery("");
    setSelectedIndex(0);
    setCollapsedKeys(
      parsed.files.length > 30 ? new Set(parsed.files.map((file) => fileKey(file))) : new Set(),
    );
    // Resetting per parsed identity (which is per `diff` input) is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed]);

  useEffect(() => {
    setFullscreen(false);
    // Only react to commit changes — controlled / uncontrolled both want this.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [commitHash]);

  // Body scroll lock and focus management while the overlay is open.
  useEffect(() => {
    if (!fullscreen) return;
    const previousOverflow = document.body.style.overflow;
    try {
      document.body.style.overflow = "hidden";
    } catch {
      // Some embedded environments may freeze body styles; ignore and continue.
    }
    // Move focus into the overlay's first action.
    const focusTimer = window.setTimeout(() => {
      exitFullscreenButtonRef.current?.focus();
    }, 0);
    return () => {
      window.clearTimeout(focusTimer);
      try {
        document.body.style.overflow = previousOverflow;
      } catch {
        // Same defensive pattern: never let cleanup throw.
      }
      // Return focus to the trigger when leaving fullscreen.
      fullscreenToggleRef.current?.focus();
    };
  }, [fullscreen]);

  function handleOverlayKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      setFullscreen(false);
    }
  }

  const filteredFiles = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return parsed.files;
    return parsed.files.filter((file) => file.displayPath.toLowerCase().includes(needle));
  }, [parsed.files, query]);

  if (!diff && !truncated) {
    return (
      <div className="px-3 py-4" style={{ fontSize: 12, color: "var(--rs-text-muted)" }}>
        No diff returned for this commit.
      </div>
    );
  }

  const visibleFiles =
    viewMode === "single" && filteredFiles.length > 0
      ? [filteredFiles[Math.min(selectedIndex, filteredFiles.length - 1)]]
      : filteredFiles;

  function toggleCollapse(file: DiffFile) {
    setCollapsedKeys((current) => {
      const next = new Set(current);
      const key = fileKey(file);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function expandAll() {
    setCollapsedKeys(new Set());
  }
  function collapseAll() {
    setCollapsedKeys(new Set(parsed.files.map((file) => fileKey(file))));
  }

  async function copyText(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied`);
    } catch {
      setCopyStatus("Copy failed");
    }
    window.setTimeout(() => setCopyStatus(""), 1600);
  }

  function copyVisibleDiff() {
    const text = filteredFiles.map((file) => fileToDiffText(file)).join("\n");
    void copyText(filteredFiles.length === parsed.files.length ? "Diff" : "Filtered diff", text);
  }

  function selectFile(index: number) {
    setSelectedIndex(index);
    if (viewMode === "all") {
      const target = filteredFiles[index];
      if (!target) return;
      const el = document.getElementById(`rs-diff-file-${commitHash}-${fileKey(target)}`);
      if (el) el.scrollIntoView({ block: "start" });
    }
  }

  function handleListKeyDown(event: React.KeyboardEvent<HTMLUListElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      const next = Math.min(filteredFiles.length - 1, selectedIndex + 1);
      selectFile(next);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      const next = Math.max(0, selectedIndex - 1);
      selectFile(next);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const target = filteredFiles[selectedIndex];
      if (target) toggleCollapse(target);
    }
  }

  const fileListStyle: React.CSSProperties = fullscreen
    ? { width: 280, minWidth: 280, maxWidth: 360, flexShrink: 0 }
    : { width: 240, minWidth: 220, maxWidth: 280, flexShrink: 0 };
  const bodyMinHeightStyle: React.CSSProperties = fullscreen ? { minHeight: 0, flex: 1 } : { minHeight: 0 };

  const inner = (
    <div
      className="rs-prism flex flex-col"
      style={{
        background: "var(--rs-bg-canvas)",
        fontFamily: "var(--rs-mono)",
        fontSize: 12,
        ...(fullscreen ? { height: "100%" } : null),
      }}
    >
      <DiffToolbar
        fileCount={parsed.files.length}
        filteredCount={filteredFiles.length}
        added={totals.added}
        deleted={totals.deleted}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        wordWrap={wordWrap}
        onWordWrapChange={setWordWrap}
        showWhitespace={showWhitespace}
        onShowWhitespaceChange={setShowWhitespace}
        query={query}
        onQueryChange={setQuery}
        onExpandAll={expandAll}
        onCollapseAll={collapseAll}
        onCopy={copyVisibleDiff}
        copyStatus={copyStatus}
        fullscreen={fullscreen}
        onFullscreenToggle={() => setFullscreen(!fullscreen)}
        toggleRef={fullscreen ? exitFullscreenButtonRef : fullscreenToggleRef}
      />
      {truncated ? (
        <div
          role="status"
          aria-live="polite"
          className="px-3 py-2"
          style={{
            fontSize: 11,
            color: "var(--rs-text-primary)",
            background:
              "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-warning) 14%)",
            border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 50%)",
            borderLeft: 0,
            borderRight: 0,
          }}
        >
          Diff was truncated at {Math.round(maxBytes / 1024)} KB. Showing partial output.
        </div>
      ) : null}
      <div
        className="flex"
        style={{ ...bodyMinHeightStyle, borderTop: "1px solid var(--rs-border)" }}
      >
        <FileList
          files={filteredFiles}
          selectedIndex={selectedIndex}
          onSelect={selectFile}
          onToggleCollapse={toggleCollapse}
          collapsedKeys={collapsedKeys}
          onKeyDown={handleListKeyDown}
          listStyle={fileListStyle}
        />
        <div
          className={fullscreen ? "flex-1 overflow-auto" : "flex-1 overflow-x-auto"}
          style={{ minWidth: 0, borderLeft: "1px solid var(--rs-border)" }}
        >
          {visibleFiles.length === 0 ? (
            <div className="px-3 py-4" style={{ color: "var(--rs-text-muted)" }}>
              {parsed.files.length === 0
                ? "No diff returned for this commit."
                : "No files match this filter."}
            </div>
          ) : (
            visibleFiles.map((file) => (
              <FileBlock
                key={`${commitHash}-${fileKey(file)}`}
                file={file}
                commitHash={commitHash}
                collapsed={collapsedKeys.has(fileKey(file))}
                onToggle={() => toggleCollapse(file)}
                wordWrap={wordWrap}
                showWhitespace={showWhitespace}
                onCopyFile={() =>
                  void copyText(`${file.displayPath} diff`, fileToDiffText(file))
                }
              />
            ))
          )}
        </div>
      </div>
    </div>
  );

  if (fullscreen) {
    return (
      <div
        ref={overlayRef}
        role="dialog"
        aria-modal="true"
        aria-label="Diff fullscreen"
        onKeyDown={handleOverlayKeyDown}
        style={{
          position: "fixed",
          inset: 0,
          zIndex: 50,
          background: "var(--rs-bg-canvas)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {inner}
      </div>
    );
  }

  return inner;
}

function DiffToolbar({
  fileCount,
  filteredCount,
  added,
  deleted,
  viewMode,
  onViewModeChange,
  wordWrap,
  onWordWrapChange,
  showWhitespace,
  onShowWhitespaceChange,
  query,
  onQueryChange,
  onExpandAll,
  onCollapseAll,
  onCopy,
  copyStatus,
  fullscreen,
  onFullscreenToggle,
  toggleRef,
}: {
  fileCount: number;
  filteredCount: number;
  added: number;
  deleted: number;
  viewMode: "all" | "single";
  onViewModeChange: (next: "all" | "single") => void;
  wordWrap: boolean;
  onWordWrapChange: (next: boolean) => void;
  showWhitespace: boolean;
  onShowWhitespaceChange: (next: boolean) => void;
  query: string;
  onQueryChange: (next: string) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onCopy: () => void;
  copyStatus: string;
  fullscreen: boolean;
  onFullscreenToggle: () => void;
  toggleRef: React.RefObject<HTMLButtonElement | null>;
}) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 px-3 py-2"
      style={{
        position: "sticky",
        top: 0,
        zIndex: 1,
        background: "var(--rs-bg-elevated)",
        borderBottom: "1px solid var(--rs-border)",
      }}
    >
      <span
        className="rs-chip"
        style={{ height: 22, padding: "0 8px", fontSize: 11 }}
        aria-label={`${fileCount} files changed`}
      >
        {filteredCount === fileCount
          ? `${fileCount} files`
          : `${filteredCount} / ${fileCount} files`}
      </span>
      <span style={{ color: "var(--rs-git-added)", fontSize: 11 }} aria-label={`${added} additions`}>
        +{added}
      </span>
      <span style={{ color: "var(--rs-git-deleted)", fontSize: 11 }} aria-label={`${deleted} deletions`}>
        -{deleted}
      </span>
      <input
        type="search"
        value={query}
        onChange={(event) => onQueryChange(event.target.value)}
        placeholder="Filter files…"
        aria-label="Filter files"
        style={{
          height: 24,
          padding: "0 8px",
          fontSize: 11,
          fontFamily: "var(--rs-mono)",
          background: "var(--rs-bg-canvas)",
          border: "1px solid var(--rs-border)",
          borderRadius: "var(--rs-radius-sm)",
          color: "var(--rs-text-primary)",
          minWidth: 140,
        }}
      />
      <div className="flex" role="group" aria-label="View mode">
        <ToolbarToggle
          pressed={viewMode === "all"}
          onClick={() => onViewModeChange("all")}
          label="All files"
        >
          All
        </ToolbarToggle>
        <ToolbarToggle
          pressed={viewMode === "single"}
          onClick={() => onViewModeChange("single")}
          label="Single file"
        >
          Single
        </ToolbarToggle>
      </div>
      <ToolbarToggle
        pressed={wordWrap}
        onClick={() => onWordWrapChange(!wordWrap)}
        label="Word wrap"
      >
        Wrap
      </ToolbarToggle>
      <ToolbarToggle
        pressed={showWhitespace}
        onClick={() => onShowWhitespaceChange(!showWhitespace)}
        label="Show whitespace"
      >
        WS
      </ToolbarToggle>
      <button
        type="button"
        className="rs-compact-button"
        onClick={onExpandAll}
        aria-label="Expand all files"
      >
        Expand all
      </button>
      <button
        type="button"
        className="rs-compact-button"
        onClick={onCollapseAll}
        aria-label="Collapse all files"
      >
        Collapse all
      </button>
      <button
        ref={toggleRef}
        type="button"
        className="rs-compact-button"
        aria-pressed={fullscreen}
        aria-label={fullscreen ? "Exit fullscreen diff" : "Enter fullscreen diff"}
        title={fullscreen ? "Exit fullscreen diff" : "Enter fullscreen diff"}
        onClick={onFullscreenToggle}
        style={{
          background: fullscreen ? "var(--rs-bg-elevated)" : "var(--rs-bg-canvas)",
          color: fullscreen ? "var(--rs-text-primary)" : "var(--rs-text-secondary)",
          borderColor: fullscreen
            ? "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)"
            : "var(--rs-border)",
        }}
      >
        {fullscreen ? <Minimize2 size={11} aria-hidden /> : <Maximize2 size={11} aria-hidden />}
        {fullscreen ? " Exit" : " Full"}
      </button>
      <button
        type="button"
        className="rs-compact-button"
        onClick={onCopy}
        aria-label="Copy diff text"
      >
        <Copy size={11} aria-hidden /> Copy
      </button>
      <span
        aria-live="polite"
        style={{ fontSize: 11, color: "var(--rs-text-muted)", marginLeft: "auto" }}
      >
        {copyStatus}
      </span>
    </div>
  );
}

function ToolbarToggle({
  pressed,
  onClick,
  label,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="rs-compact-button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      style={{
        background: pressed ? "var(--rs-bg-elevated)" : "var(--rs-bg-canvas)",
        color: pressed ? "var(--rs-text-primary)" : "var(--rs-text-secondary)",
        borderColor: pressed
          ? "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)"
          : "var(--rs-border)",
      }}
    >
      {children}
    </button>
  );
}

function FileList({
  files,
  selectedIndex,
  onSelect,
  onToggleCollapse,
  collapsedKeys,
  onKeyDown,
  listStyle,
}: {
  files: DiffFile[];
  selectedIndex: number;
  onSelect: (index: number) => void;
  onToggleCollapse: (file: DiffFile) => void;
  collapsedKeys: Set<string>;
  onKeyDown: (event: React.KeyboardEvent<HTMLUListElement>) => void;
  listStyle?: React.CSSProperties;
}) {
  return (
    <ul
      role="listbox"
      aria-label="Changed files"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className="overflow-y-auto"
      style={{
        listStyle: "none",
        margin: 0,
        padding: 0,
        width: 240,
        minWidth: 220,
        maxWidth: 280,
        flexShrink: 0,
        background: "var(--rs-bg-panel)",
        ...listStyle,
      }}
    >
      {files.map((file, index) => {
        const counts = countFileChanges(file);
        const isSelected = index === selectedIndex;
        const annotation = annotateFile(file);
        return (
          <li
            key={fileKey(file)}
            role="option"
            aria-selected={isSelected}
            onClick={() => onSelect(index)}
            onDoubleClick={() => onToggleCollapse(file)}
            style={{
              cursor: "pointer",
              padding: "6px 10px",
              borderBottom: "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
              background: isSelected ? "var(--rs-bg-elevated)" : "transparent",
              borderLeft: isSelected
                ? "2px solid var(--rs-accent)"
                : "2px solid transparent",
              fontSize: 11,
            }}
          >
            <div className="flex items-center gap-2" style={{ minWidth: 0 }}>
              <ChangeKindBadge kind={file.changeKind} />
              <span
                className="truncate"
                title={file.displayPath}
                style={{ color: "var(--rs-text-primary)", flex: 1, minWidth: 0 }}
              >
                {file.displayPath}
              </span>
              {collapsedKeys.has(fileKey(file)) ? (
                <ChevronRight size={11} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
              ) : (
                <ChevronDown size={11} aria-hidden style={{ color: "var(--rs-text-muted)" }} />
              )}
            </div>
            <div
              className="flex items-center gap-2 mt-0.5"
              style={{ color: "var(--rs-text-muted)", fontSize: 10 }}
            >
              {file.isBinary ? (
                <span>(binary)</span>
              ) : (
                <>
                  <span style={{ color: "var(--rs-git-added)" }}>+{counts.added}</span>
                  <span style={{ color: "var(--rs-git-deleted)" }}>-{counts.deleted}</span>
                </>
              )}
              {annotation ? <span>{annotation}</span> : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function FileBlock({
  file,
  commitHash,
  collapsed,
  onToggle,
  wordWrap,
  showWhitespace,
  onCopyFile,
}: {
  file: DiffFile;
  commitHash: string;
  collapsed: boolean;
  onToggle: () => void;
  wordWrap: boolean;
  showWhitespace: boolean;
  onCopyFile: () => void;
}) {
  const counts = countFileChanges(file);
  const renamed =
    file.changeKind === "renamed" || file.changeKind === "copied"
      ? `${file.oldPath ?? "?"} → ${file.newPath ?? "?"}`
      : null;
  const language = useMemo(
    () => detectLanguage(file.newPath ?? file.oldPath ?? file.displayPath),
    [file.newPath, file.oldPath, file.displayPath],
  );
  return (
    <section
      id={`rs-diff-file-${commitHash}-${fileKey(file)}`}
      style={{ borderBottom: "1px solid var(--rs-border)" }}
    >
      <header
        className="flex items-center gap-2 px-3"
        style={{
          height: 30,
          background: "var(--rs-bg-elevated)",
          borderBottom: collapsed ? "none" : "1px solid var(--rs-border)",
          fontSize: 11,
        }}
      >
        <button
          type="button"
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? "Expand" : "Collapse"} ${file.displayPath}`}
          onClick={onToggle}
          className="rs-icon-btn"
          style={{ width: 22, height: 22 }}
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
        <ChangeKindBadge kind={file.changeKind} />
        <span
          className="truncate"
          style={{ color: "var(--rs-text-primary)", flex: 1, minWidth: 0 }}
          title={renamed ?? file.displayPath}
        >
          {renamed ?? file.displayPath}
        </span>
        {file.isBinary ? null : (
          <>
            <span style={{ color: "var(--rs-git-added)" }}>+{counts.added}</span>
            <span style={{ color: "var(--rs-git-deleted)" }}>-{counts.deleted}</span>
          </>
        )}
        <button
          type="button"
          className="rs-icon-btn"
          aria-label={`Copy ${file.displayPath} diff`}
          title="Copy file diff"
          onClick={onCopyFile}
        >
          <Copy size={12} />
        </button>
      </header>
      {collapsed ? null : (
        <FileBody
          file={file}
          wordWrap={wordWrap}
          showWhitespace={showWhitespace}
          language={language}
        />
      )}
    </section>
  );
}

function FileBody({
  file,
  wordWrap,
  showWhitespace,
  language,
}: {
  file: DiffFile;
  wordWrap: boolean;
  showWhitespace: boolean;
  language: string | null;
}) {
  if (file.isBinary) {
    return (
      <div className="px-3 py-3" style={{ color: "var(--rs-text-muted)", fontSize: 11 }}>
        Binary file — diff not shown.
      </div>
    );
  }
  if (file.changeKind === "mode-changed" && file.hunks.length === 0) {
    return (
      <div className="px-3 py-3" style={{ color: "var(--rs-text-muted)", fontSize: 11 }}>
        File mode changed — no content diff.
        <pre
          style={{
            marginTop: 6,
            color: "var(--rs-text-secondary)",
            fontFamily: "var(--rs-mono)",
            fontSize: 11,
            whiteSpace: "pre-wrap",
          }}
        >
          {file.headerLines
            .filter((line) => line.startsWith("old mode") || line.startsWith("new mode"))
            .join("\n")}
        </pre>
      </div>
    );
  }
  if (file.hunks.length === 0) {
    return (
      <div className="px-3 py-3" style={{ color: "var(--rs-text-muted)", fontSize: 11 }}>
        No content hunks for this file.
      </div>
    );
  }
  return (
    <div role="grid" aria-label="Diff lines">
      {file.hunks.map((hunk, hunkIndex) => (
        <HunkBlock
          key={hunkIndex}
          hunk={hunk}
          wordWrap={wordWrap}
          showWhitespace={showWhitespace}
          language={language}
        />
      ))}
    </div>
  );
}

function HunkBlock({
  hunk,
  wordWrap,
  showWhitespace,
  language,
}: {
  hunk: DiffHunk;
  wordWrap: boolean;
  showWhitespace: boolean;
  language: string | null;
}) {
  return (
    <>
      <div
        role="row"
        className="grid items-center px-2"
        style={{
          gridTemplateColumns: "44px 44px auto",
          minWidth: "100%",
          minHeight: 22,
          background: "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 6%)",
          color: "var(--rs-text-muted)",
          borderTop: "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
          borderBottom: "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
          fontSize: 11,
        }}
      >
        <span role="gridcell" />
        <span role="gridcell" />
        <span role="gridcell" className="flex items-center gap-3" style={{ minWidth: 0 }}>
          <span style={{ color: "var(--rs-text-secondary)", whiteSpace: "nowrap" }}>
            {`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`}
          </span>
          {hunk.sectionHeading ? (
            <span className="truncate" style={{ color: "var(--rs-text-muted)" }}>
              {hunk.sectionHeading}
            </span>
          ) : null}
        </span>
      </div>
      {hunk.lines.map((line, lineIndex) => (
        <DiffLineRow
          key={lineIndex}
          line={line}
          wordWrap={wordWrap}
          showWhitespace={showWhitespace}
          language={language}
        />
      ))}
    </>
  );
}

function DiffLineRow({
  line,
  wordWrap,
  showWhitespace,
  language,
}: {
  line: DiffLine;
  wordWrap: boolean;
  showWhitespace: boolean;
  language: string | null;
}) {
  const sigil = sigilFor(line);
  const oldNo = line.kind === "context" || line.kind === "del" ? line.oldLineNo : "";
  const newNo = line.kind === "context" || line.kind === "add" ? line.newLineNo : "";
  // Non-color signal class — always set regardless of theme so CVD-safe CSS
  // can attach left-bar width / pattern signals via [data-color-vision="cvd-safe"] .rs-diff-*.
  // This is the "fact layer": add/del/context is structural information, not decoration.
  const rowClass = `grid px-2 rs-diff-${line.kind === "add" ? "add" : line.kind === "del" ? "del" : "context"}`;
  return (
    <div
      role="row"
      className={rowClass}
      // NOTE: use `backgroundColor` (longhand), not `background` (shorthand).
      // The `background:` shorthand resets `background-image: none`, which would
      // wipe out the diagonal-stripe pattern that
      // `[data-color-vision="cvd-safe"] .rs-diff-del { background-image: ... }`
      // attaches via the rs-diff-* class.  Inline styles win against external
      // CSS only on the properties they actually set, so a longhand
      // `background-color` lets the CSS rule's `background-image` apply.
      style={{
        gridTemplateColumns: wordWrap ? "44px 44px 1fr" : "44px 44px auto",
        minWidth: "100%",
        minHeight: 20,
        backgroundColor: backgroundForLine(line),
        color: line.kind === "no-newline" ? "var(--rs-text-muted)" : "var(--rs-text-primary)",
        fontStyle: line.kind === "no-newline" ? "italic" : "normal",
      }}
    >
      <span
        role="gridcell"
        style={{
          color: "var(--rs-text-muted)",
          fontSize: 11,
          textAlign: "right",
          paddingRight: 6,
          userSelect: "none",
        }}
      >
        {oldNo}
      </span>
      <span
        role="gridcell"
        style={{
          color: "var(--rs-text-muted)",
          fontSize: 11,
          textAlign: "right",
          paddingRight: 6,
          userSelect: "none",
        }}
      >
        {newNo}
      </span>
      <span
        role="gridcell"
        className="flex"
        style={{ minWidth: 0, gap: 0 }}
      >
        <span
          aria-hidden
          style={{
            display: "inline-block",
            width: 14,
            color: colorForSigil(line),
            flexShrink: 0,
            textAlign: "center",
          }}
        >
          {sigil}
        </span>
        <span
          style={{
            whiteSpace: wordWrap ? "pre-wrap" : "pre",
            wordBreak: wordWrap ? "break-word" : "normal",
            ...(wordWrap ? { flex: 1, minWidth: 0 } : { flexShrink: 0 }),
          }}
        >
          {renderLineContent(textOf(line), language, line.kind, showWhitespace)}
        </span>
      </span>
    </div>
  );
}

function textOf(line: DiffLine): string {
  return line.text;
}

function sigilFor(line: DiffLine): string {
  switch (line.kind) {
    case "add":
      return "+";
    case "del":
      return "-";
    case "no-newline":
      return "\\";
    case "context":
      return " ";
  }
}

function colorForSigil(line: DiffLine): string {
  switch (line.kind) {
    case "add":
      return "var(--rs-git-added)";
    case "del":
      return "var(--rs-git-deleted)";
    default:
      return "var(--rs-text-muted)";
  }
}

function backgroundForLine(line: DiffLine): string {
  switch (line.kind) {
    case "add":
      return "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-git-added) 14%)";
    case "del":
      return "color-mix(in oklab, var(--rs-bg-canvas), var(--rs-git-deleted) 14%)";
    case "no-newline":
      return "var(--rs-bg-elevated)";
    case "context":
      return "transparent";
  }
}

function renderLineContent(
  text: string,
  language: string | null,
  kind: DiffLine["kind"],
  showWhitespace: boolean,
) {
  // `no-newline` markers are diff metadata, not source — never highlight.
  if (kind === "no-newline" || !language) {
    return showWhitespace ? renderWhitespace(text) : text;
  }
  const tokens = tokenizeLine(text, language);
  if (!tokens) {
    return showWhitespace ? renderWhitespace(text) : text;
  }
  const runs = flattenTokens(tokens);
  return runs.map((run, index) => (
    <HighlightedRunSpan
      key={index}
      run={run}
      showWhitespace={showWhitespace}
    />
  ));
}

function HighlightedRunSpan({
  run,
  showWhitespace,
}: {
  run: HighlightedRun;
  showWhitespace: boolean;
}) {
  const content = showWhitespace ? renderWhitespace(run.text) : run.text;
  if (!run.className) return <>{content}</>;
  return <span className={run.className}>{content}</span>;
}

function renderWhitespace(text: string) {
  // Replace tabs and visual spaces with marker glyphs while keeping the
  // string copy-paste friendly: we render via spans, original text is still
  // available via DOM textContent because we keep the text characters intact
  // alongside the markers (trailing markers rendered as decoration only).
  // For simplicity we replace inline; users opt in via the toggle.
  const parts: Array<{ char: string; marker: boolean }> = [];
  for (const char of text) {
    if (char === "\t") {
      parts.push({ char: "→\t", marker: true });
    } else if (char === " ") {
      parts.push({ char: "·", marker: true });
    } else {
      parts.push({ char, marker: false });
    }
  }
  return (
    <>
      {parts.map((part, index) =>
        part.marker ? (
          <span key={index} style={{ color: "var(--rs-text-muted)", opacity: 0.6 }}>
            {part.char}
          </span>
        ) : (
          <span key={index}>{part.char}</span>
        ),
      )}
    </>
  );
}

function ChangeKindBadge({ kind }: { kind: DiffChangeKind }) {
  const color = colorForKind(kind);
  const letter = letterForKind(kind);
  return (
    <span
      aria-label={kind}
      title={kind}
      style={{
        display: "inline-grid",
        placeItems: "center",
        width: 16,
        height: 16,
        fontSize: 10,
        fontWeight: 700,
        color,
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${color} 22%)`,
        border: `1px solid color-mix(in oklab, var(--rs-border), ${color} 40%)`,
        borderRadius: 4,
        flexShrink: 0,
      }}
    >
      {letter}
    </span>
  );
}

function colorForKind(kind: DiffChangeKind): string {
  switch (kind) {
    case "added":
      return "var(--rs-git-added)";
    case "deleted":
      return "var(--rs-git-deleted)";
    case "modified":
      return "var(--rs-git-modified)";
    case "renamed":
    case "copied":
      return "var(--rs-accent)";
    case "binary":
    case "mode-changed":
      return "var(--rs-warning)";
    default:
      return "var(--rs-text-secondary)";
  }
}

function letterForKind(kind: DiffChangeKind): string {
  switch (kind) {
    case "added":
      return "A";
    case "deleted":
      return "D";
    case "modified":
      return "M";
    case "renamed":
      return "R";
    case "copied":
      return "C";
    case "binary":
      return "B";
    case "mode-changed":
      return "X";
    default:
      return "?";
  }
}

function annotateFile(file: DiffFile): string {
  if (file.isBinary) return "binary";
  if (file.changeKind === "renamed") {
    return file.similarity !== null ? `renamed ${file.similarity}%` : "renamed";
  }
  if (file.changeKind === "copied") {
    return file.similarity !== null ? `copied ${file.similarity}%` : "copied";
  }
  if (file.changeKind === "added") return "added";
  if (file.changeKind === "deleted") return "deleted";
  if (file.changeKind === "mode-changed") return "mode";
  return "";
}

function fileKey(file: DiffFile): string {
  return `${file.oldPath ?? ""}::${file.newPath ?? ""}::${file.displayPath}`;
}
