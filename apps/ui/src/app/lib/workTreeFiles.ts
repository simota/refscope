// workTreeFiles — Working-tree diff を file 単位に展開する共通ヘルパ
import type { WorkTreeResponse } from '../api';
import {
  parseUnifiedDiff,
  type DiffChangeKind,
  type DiffFile,
} from './parseUnifiedDiff';

export type WorkTreeFile = {
  path: string;
  basename: string;
  parentDir: string;
  status: string;
  added: number;
  deleted: number;
  section: 'staged' | 'unstaged' | 'untracked';
};

function lineCounts(file: DiffFile): { added: number; deleted: number } {
  let added = 0;
  let deleted = 0;
  for (const h of file.hunks) {
    for (const l of h.lines) {
      if (l.kind === 'add') added += 1;
      else if (l.kind === 'del') deleted += 1;
    }
  }
  return { added, deleted };
}

function pickPath(file: DiffFile): string {
  return file.displayPath || file.newPath || file.oldPath || '?';
}

function changeKindToStatus(kind: DiffChangeKind): string {
  switch (kind) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
    case 'copied':
      return 'R';
    case 'modified':
    case 'mode-changed':
    case 'binary':
    default:
      return 'M';
  }
}

export function extractWorkTreeFiles(
  workTree: WorkTreeResponse | null | undefined,
): WorkTreeFile[] {
  if (!workTree) return [];
  const out: WorkTreeFile[] = [];
  const sections: Array<['staged' | 'unstaged', WorkTreeResponse['staged']]> = [
    ['unstaged', workTree.unstaged],
    ['staged', workTree.staged],
  ];
  for (const [section, data] of sections) {
    if (!data || data.summary.fileCount === 0) continue;
    const parsed = parseUnifiedDiff(data.diff);
    for (const file of parsed.files) {
      const path = pickPath(file);
      const idx = path.lastIndexOf('/');
      const { added, deleted } = lineCounts(file);
      out.push({
        path,
        basename: idx === -1 ? path : path.slice(idx + 1),
        parentDir: idx === -1 ? '' : path.slice(0, idx),
        status: changeKindToStatus(file.changeKind),
        added,
        deleted,
        section,
      });
    }
  }

  // Untracked files are not in the diff text — the API surfaces them as a
  // separate `{ files: [...] }` list. They join the same return shape so
  // downstream consumers (Pulse particles, Stream rows, sidebar counts)
  // need no special-casing beyond reading `section === 'untracked'`.
  if (workTree.untracked) {
    for (const file of workTree.untracked.files) {
      const idx = file.path.lastIndexOf('/');
      out.push({
        path: file.path,
        basename: idx === -1 ? file.path : file.path.slice(idx + 1),
        parentDir: idx === -1 ? '' : file.path.slice(0, idx),
        status: file.status,
        added: file.added,
        deleted: 0,
        section: 'untracked',
      });
    }
  }

  return out;
}
