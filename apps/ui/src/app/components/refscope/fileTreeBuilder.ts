import type { ChangedFile } from "./data";

/**
 * Tree node produced by {@link buildFileTree}.
 *
 * `dir` nodes describe a directory segment and hold their direct `children`
 * plus rolled-up `added`/`deleted`/`fileCount` sums for the entire subtree.
 * `file` nodes are leaves that carry the original {@link ChangedFile} entry.
 *
 * `displayName` is the segment string the UI should render at this level. For
 * a chain of directories with only one child, the chain is collapsed into a
 * single node whose `displayName` is the joined path (e.g. `apps/ui/src`).
 * `fullPath` is always the absolute path from the repo root so callers can
 * use it as a stable React key and as the localStorage key for expand state.
 */
export type FileTreeNode =
  | {
      kind: "dir";
      displayName: string;
      fullPath: string;
      added: number;
      deleted: number;
      fileCount: number;
      children: FileTreeNode[];
    }
  | {
      kind: "file";
      displayName: string;
      fullPath: string;
      file: ChangedFile;
    };

type DirAccumulator = {
  name: string;
  fullPath: string;
  children: Map<string, DirAccumulator>;
  files: ChangedFile[];
};

function makeDir(name: string, fullPath: string): DirAccumulator {
  return { name, fullPath, children: new Map(), files: [] };
}

function insert(root: DirAccumulator, file: ChangedFile): void {
  const parts = file.path.split("/").filter((p) => p.length > 0);
  if (parts.length === 0) {
    root.files.push(file);
    return;
  }
  const leafName = parts.pop() as string;
  let cursor = root;
  for (const segment of parts) {
    const existing = cursor.children.get(segment);
    if (existing) {
      cursor = existing;
    } else {
      const fullPath = cursor.fullPath ? `${cursor.fullPath}/${segment}` : segment;
      const next = makeDir(segment, fullPath);
      cursor.children.set(segment, next);
      cursor = next;
    }
  }
  cursor.files.push(file);
}

function compareNodes(a: FileTreeNode, b: FileTreeNode): number {
  // Directories before files, then alphabetical case-insensitive.
  if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
  return a.displayName.localeCompare(b.displayName, undefined, { sensitivity: "base" });
}

function finalize(node: DirAccumulator): FileTreeNode {
  const children: FileTreeNode[] = [];
  for (const child of node.children.values()) {
    children.push(finalize(child));
  }
  for (const f of node.files) {
    children.push({
      kind: "file",
      displayName: f.path.split("/").pop() ?? f.path,
      fullPath: f.path,
      file: f,
    });
  }
  children.sort(compareNodes);

  let added = 0;
  let deleted = 0;
  let fileCount = 0;
  for (const child of children) {
    if (child.kind === "file") {
      added += child.file.added;
      deleted += child.file.deleted;
      fileCount += 1;
    } else {
      added += child.added;
      deleted += child.deleted;
      fileCount += child.fileCount;
    }
  }

  return {
    kind: "dir",
    displayName: node.name,
    fullPath: node.fullPath,
    added,
    deleted,
    fileCount,
    children,
  };
}

/**
 * Collapse single-child directory chains so a tree like
 *   apps/ ui/ src/ app/ <files>
 * renders as a single node `apps/ui/src/app` rather than four nested rows.
 *
 * The root itself is never collapsed — it always emits a flat list of its
 * direct children, so the UI can render the tree without an artificial root
 * wrapper.
 */
function collapseChain(node: FileTreeNode): FileTreeNode {
  if (node.kind !== "dir") return node;
  let current = node;
  while (
    current.children.length === 1 &&
    current.children[0].kind === "dir"
  ) {
    const only = current.children[0] as Extract<FileTreeNode, { kind: "dir" }>;
    current = {
      kind: "dir",
      displayName: `${current.displayName}/${only.displayName}`,
      fullPath: only.fullPath,
      added: only.added,
      deleted: only.deleted,
      fileCount: only.fileCount,
      children: only.children,
    };
  }
  return {
    ...current,
    children: current.children.map(collapseChain),
  };
}

/**
 * Build a directory tree from a flat list of changed files. The result is
 * the root's children — there is no synthetic top-level node.
 *
 * - Path segments are split on `/`. Empty segments (from leading slashes or
 *   duplicate separators) are ignored.
 * - Files at the repo root surface as top-level entries alongside directories.
 * - Single-child directory chains are collapsed so the UI doesn't render
 *   a tower of one-line directory rows.
 * - Children are sorted directories-first, then alphabetically (case
 *   insensitive) so the order is stable across renders.
 */
export function buildFileTree(files: ChangedFile[]): FileTreeNode[] {
  const root = makeDir("", "");
  for (const file of files) {
    insert(root, file);
  }
  const finalized = finalize(root);
  if (finalized.kind !== "dir") return [];
  return finalized.children.map(collapseChain);
}

/**
 * Pre-compute the set of directory `fullPath` values that should default to
 * expanded. Heuristic: expand everything when the total file count is small
 * enough to skim at a glance; otherwise only expand the top-level row so
 * deep trees collapse on first render.
 */
export function defaultExpandedDirs(
  nodes: FileTreeNode[],
  fileCount: number,
  threshold = 50,
): Set<string> {
  const expanded = new Set<string>();
  const expandAll = fileCount <= threshold;
  const walk = (n: FileTreeNode, depth: number) => {
    if (n.kind !== "dir") return;
    if (expandAll || depth === 0) {
      expanded.add(n.fullPath);
    }
    for (const child of n.children) walk(child, depth + 1);
  };
  for (const n of nodes) walk(n, 0);
  return expanded;
}
