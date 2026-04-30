export type Commit = {
  hash: string;
  shortHash?: string;
  subject: string;
  author: string;
  authorDate?: string;
  time: string;
  branch?: string;
  refs?: string[];
  added: number;
  deleted: number;
  fileCount?: number;
  files: ChangedFile[];
  isMerge?: boolean;
  isNew?: boolean;
  signed?: boolean;
  signatureStatus?: SignatureStatus;
  body?: string;
  parents?: string[];
  lane: number;
};

export type SignatureStatus =
  | "valid"
  | "untrusted"
  | "bad"
  | "expired-signature"
  | "expired-key"
  | "revoked-key"
  | "missing-key"
  | "unsigned"
  | "unknown";

export type ChangedFile = {
  status: string;
  path: string;
  added: number;
  deleted: number;
};

export type Repository = {
  id: string;
  name: string;
};

export type GitRef = {
  name: string;
  shortName: string;
  hash: string;
  type: "branch" | "tag" | "remote" | "other";
  updatedAt: string | null;
};

export type CompareResult = {
  base: string;
  target: string;
  mergeBase: string | null;
  ahead: number;
  behind: number;
  files: number;
  added: number;
  deleted: number;
  commands: {
    log: string;
    stat: string;
    diff: string;
  };
};

export type RealtimeAlert = {
  id: string;
  type: "history_rewritten";
  refName: string;
  previousHash: string;
  currentHash: string;
  time: string;
};

export type CommitDetail = {
  hash: string;
  parents: string[];
  subject: string;
  body: string;
  author: {
    name: string;
    email: string;
  };
  authorDate: string;
  refs: string[];
  signed?: boolean;
  signatureStatus?: SignatureStatus;
  files: ChangedFile[];
};

export const commits: Commit[] = [
  {
    hash: "a1b2c3d4e5f6789",
    subject: "Add realtime git log viewer",
    author: "shingo",
    time: "2m ago",
    refs: ["main", "origin/main"],
    added: 96,
    deleted: 4,
    signed: true,
    isNew: true,
    parents: ["9e8f7a6"],
    body:
      "Introduce SSE-based realtime updates for the commit timeline. Adds reconnect handling and history-rewrite detection.",
    files: [
      { status: "M", path: "src/App.tsx", added: 12, deleted: 3 },
      { status: "A", path: "src/api/events.ts", added: 84, deleted: 0 },
      { status: "M", path: "package.json", added: 1, deleted: 1 },
    ],
    lane: 0,
  },
  {
    hash: "9e8f7a6b1c2d3e4",
    subject: "Refactor commit parser for streaming input",
    author: "tanaka",
    time: "14m ago",
    added: 48,
    deleted: 33,
    parents: ["7d6c5b4"],
    files: [
      { status: "M", path: "src/parser/commit.ts", added: 48, deleted: 33 },
    ],
    lane: 0,
  },
  {
    hash: "7d6c5b4a3f2e1d0",
    subject: "feat(ui): add graph rail with lane folding",
    author: "ichiro",
    time: "1h ago",
    branch: "feature/ui",
    added: 120,
    deleted: 12,
    parents: ["4c3b2a1"],
    files: [{ status: "A", path: "src/ui/GraphRail.tsx", added: 120, deleted: 0 }],
    lane: 1,
  },
  {
    hash: "4c3b2a1f0e9d8c7",
    subject: "Merge branch 'feature/parser'",
    author: "shingo",
    time: "3h ago",
    isMerge: true,
    added: 0,
    deleted: 0,
    parents: ["b5a4938", "7d6c5b4"],
    files: [],
    lane: 0,
  },
  {
    hash: "b5a493827e6f1c2",
    subject: "fix: handle disconnected SSE source",
    author: "kana",
    time: "5h ago",
    added: 18,
    deleted: 6,
    parents: ["3a2b1c0"],
    files: [{ status: "M", path: "src/api/events.ts", added: 18, deleted: 6 }],
    lane: 0,
  },
  {
    hash: "3a2b1c0d9e8f7a6",
    subject: "chore: bump deps & tailwind config",
    author: "tanaka",
    time: "yesterday",
    added: 4,
    deleted: 4,
    parents: ["2f1e0d9"],
    files: [{ status: "M", path: "package.json", added: 4, deleted: 4 }],
    lane: 0,
  },
  {
    hash: "2f1e0d9c8b7a6f5",
    subject: "docs: add design tokens reference",
    author: "ichiro",
    time: "2d ago",
    added: 210,
    deleted: 0,
    parents: ["1d0c9b8"],
    files: [{ status: "A", path: "docs/tokens.md", added: 210, deleted: 0 }],
    lane: 0,
  },
];

export const diffSample = `@@ -10,6 +10,11 @@ export function subscribe() {
   const source = new EventSource(url)

+  source.addEventListener("commit_added", onCommitAdded)
+  source.addEventListener("ref_updated", onRefUpdated)
+  source.addEventListener("history_rewritten", onHistoryRewritten)
+
   return () => source.close()
 }`;
