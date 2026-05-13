import { useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Copy, FileSearch, History } from "lucide-react";
import type { ChangedFile } from "./data";
import { FileBadge } from "./DetailPanel";
import { StructuralDiffBadge } from "./StructuralDiffBadge";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import {
  buildFileTree,
  defaultExpandedDirs,
  type FileTreeNode,
} from "./fileTreeBuilder";

const ROW_HEIGHT = 28;
const INDENT_STEP = 14;

export function ChangedFilesTree({
  files,
  repoId,
  onOpenFileHistory,
  onFilterByPath,
}: {
  files: ChangedFile[];
  repoId: string;
  onOpenFileHistory: (path: string) => void;
  onFilterByPath?: (path: string) => void;
}) {
  const nodes = useMemo(() => buildFileTree(files), [files]);
  const initialExpanded = useMemo(
    () => defaultExpandedDirs(nodes, files.length),
    [nodes, files.length],
  );
  const [expanded, setExpanded] = useState<Set<string>>(initialExpanded);
  // Reset expansion state when the underlying file list changes (e.g.
  // selecting a different commit). `initialExpanded` itself changes by
  // reference whenever `nodes`/`files.length` change, so we wire this through
  // a derived ref check rather than useEffect to keep the surface small.
  const [expansionKey, setExpansionKey] = useState(initialExpanded);
  if (expansionKey !== initialExpanded) {
    setExpansionKey(initialExpanded);
    setExpanded(initialExpanded);
  }

  const toggle = (fullPath: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(fullPath)) next.delete(fullPath);
      else next.add(fullPath);
      return next;
    });
  };

  return (
    <div role="tree" aria-label="Changed files tree">
      {nodes.map((node) => (
        <TreeRow
          key={node.fullPath || node.displayName}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggle}
          repoId={repoId}
          onOpenFileHistory={onOpenFileHistory}
          onFilterByPath={onFilterByPath}
        />
      ))}
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  onToggle,
  repoId,
  onOpenFileHistory,
  onFilterByPath,
}: {
  node: FileTreeNode;
  depth: number;
  expanded: Set<string>;
  onToggle: (fullPath: string) => void;
  repoId: string;
  onOpenFileHistory: (path: string) => void;
  onFilterByPath?: (path: string) => void;
}) {
  if (node.kind === "dir") {
    const isOpen = expanded.has(node.fullPath);
    return (
      <>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              role="treeitem"
              aria-expanded={isOpen}
              aria-level={depth + 1}
              className="flex items-center gap-2 cursor-pointer"
              onClick={() => onToggle(node.fullPath)}
              style={{
                height: ROW_HEIGHT,
                fontSize: 12,
                fontFamily: "var(--rs-mono)",
                paddingLeft: 12 + depth * INDENT_STEP,
                paddingRight: 12,
                borderBottom:
                  "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
              }}
            >
              <span
                aria-hidden
                className="grid place-items-center"
                style={{ width: 14, height: 14, color: "var(--rs-text-muted)" }}
              >
                {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              </span>
              <span
                className="flex-1 truncate"
                style={{ color: "var(--rs-text-primary)" }}
                title={node.fullPath}
              >
                {node.displayName}/
              </span>
              <span style={{ color: "var(--rs-text-muted)" }}>
                {node.fileCount}
              </span>
              <span style={{ color: "var(--rs-git-added)" }}>+{node.added}</span>
              <span style={{ color: "var(--rs-git-deleted)" }}>-{node.deleted}</span>
            </div>
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem
              onSelect={() => void navigator.clipboard?.writeText(node.fullPath)}
            >
              <Copy />
              Copy path
            </ContextMenuItem>
            <ContextMenuItem
              disabled={!onFilterByPath}
              onSelect={() => onFilterByPath?.(node.fullPath)}
            >
              <FileSearch />
              Filter by this path
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
        {isOpen
          ? node.children.map((child) => (
              <TreeRow
                key={child.fullPath || child.displayName}
                node={child}
                depth={depth + 1}
                expanded={expanded}
                onToggle={onToggle}
                repoId={repoId}
                onOpenFileHistory={onOpenFileHistory}
                onFilterByPath={onFilterByPath}
              />
            ))
          : null}
      </>
    );
  }

  const f = node.file;
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          role="treeitem"
          aria-level={depth + 1}
          className="flex items-center gap-2"
          style={{
            height: ROW_HEIGHT,
            fontSize: 12,
            fontFamily: "var(--rs-mono)",
            paddingLeft: 12 + depth * INDENT_STEP,
            paddingRight: 12,
            borderBottom:
              "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
          }}
        >
          <span
            aria-hidden
            style={{ width: 14, height: 14, display: "inline-block" }}
          />
          <FileBadge status={f.status} />
          <span
            className="flex-1 truncate"
            style={{ color: "var(--rs-text-primary)" }}
            title={node.fullPath}
          >
            {node.displayName}
          </span>
          <StructuralDiffBadge kind={f.structuralKind} compact />
          <span style={{ color: "var(--rs-git-added)" }}>+{f.added}</span>
          <span style={{ color: "var(--rs-git-deleted)" }}>-{f.deleted}</span>
          <button
            type="button"
            className="rs-icon-btn"
            aria-label={`Open file history for ${node.fullPath}`}
            title="Open file history"
            disabled={!repoId}
            onClick={() => onOpenFileHistory(node.fullPath)}
            style={{ width: 22, height: 22 }}
          >
            <History size={12} />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem
          disabled={!repoId}
          onSelect={() => onOpenFileHistory(node.fullPath)}
        >
          <History />
          Open file history
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => void navigator.clipboard?.writeText(node.fullPath)}
        >
          <Copy />
          Copy path
        </ContextMenuItem>
        <ContextMenuItem
          disabled={!onFilterByPath}
          onSelect={() => onFilterByPath?.(node.fullPath)}
        >
          <FileSearch />
          Filter by this path
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
