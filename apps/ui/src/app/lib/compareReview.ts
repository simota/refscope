/**
 * Pure helpers for the compare review workbench: release-note / review
 * report export, mode-aware Git commands, and the compare deep link.
 *
 * Kept free of runtime imports from React or the API client so
 * `apps/ui/test/` can load it with Node's type stripping.
 */
import { parseConventionalCommit } from "./conventionalCommit.ts";

export type CompareReviewMode = "three-dot" | "two-dot";

export type ReportCommit = {
  hash: string;
  subject: string;
  author: string;
  authorDate?: string;
  isMerge?: boolean;
};

export type ReportFile = {
  status: string;
  path: string;
  oldPath?: string;
  added: number;
  deleted: number;
  binary: boolean;
};

export type CompareReportInput = {
  base: string;
  target: string;
  mode: CompareReviewMode;
  /** True when three-dot was requested but there is no merge base. */
  fallback?: boolean;
  mergeBase: string | null;
  ahead: ReportCommit[];
  behind: ReportCommit[];
  aheadTruncated: boolean;
  behindTruncated: boolean;
  files: ReportFile[] | null;
  added?: number;
  deleted?: number;
};

/**
 * Conventional-commit types in report order. Anything else (including
 * non-conventional subjects) lands in "Other changes".
 */
const TYPE_SECTIONS: ReadonlyArray<{ types: readonly string[]; title: string }> = [
  { types: ["feat"], title: "Features" },
  { types: ["fix"], title: "Fixes" },
  { types: ["perf"], title: "Performance" },
  { types: ["refactor"], title: "Refactoring" },
  { types: ["docs"], title: "Documentation" },
  { types: ["test", "tests"], title: "Tests" },
  { types: ["build", "ci", "chore", "style", "revert"], title: "Maintenance" },
];
const OTHER_SECTION = "Other changes";
const MERGE_SECTION = "Merges";

export type CommitGroup = { title: string; commits: Array<ReportCommit & { breaking: boolean; display: string }> };

/**
 * Group commits by conventional-commit type, preserving input order inside
 * each group. Merge commits get their own trailing group so they do not
 * crowd the change list. Empty groups are dropped.
 */
export function groupCommitsByType(commits: readonly ReportCommit[]): CommitGroup[] {
  const buckets = new Map<string, CommitGroup["commits"]>();
  for (const commit of commits) {
    const parsed = parseConventionalCommit(commit.subject);
    let title = OTHER_SECTION;
    if (commit.isMerge) {
      title = MERGE_SECTION;
    } else if (parsed) {
      title = TYPE_SECTIONS.find((section) => section.types.includes(parsed.type))?.title ?? OTHER_SECTION;
    }
    const display = parsed && !commit.isMerge
      ? `${parsed.scope ? `**${parsed.scope}:** ` : ""}${parsed.description}`
      : commit.subject;
    const list = buckets.get(title) ?? [];
    list.push({ ...commit, breaking: Boolean(parsed?.breaking), display });
    buckets.set(title, list);
  }
  const order = [...TYPE_SECTIONS.map((section) => section.title), OTHER_SECTION, MERGE_SECTION];
  return order
    .filter((title) => buckets.has(title))
    .map((title) => ({ title, commits: buckets.get(title)! }));
}

export function shortRev(value: string): string {
  return /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value) ? value.slice(0, 7) : value;
}

/** Strip characters that would break a Markdown inline code span or table cell. */
function mdCode(value: string): string {
  const cleaned = value.replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
  return cleaned.includes("`") ? `\`\` ${cleaned} \`\`` : `\`${cleaned}\``;
}

function mdText(value: string): string {
  return value.replace(/[\r\n]+/g, " ");
}

/**
 * Git commands that reproduce the review locally. Revisions stay separate
 * shell words; `...` is the user-facing spelling only (the API never passes
 * a combined range token to Git).
 */
export function compareCommands(base: string, target: string, mode: CompareReviewMode) {
  const range = mode === "three-dot" ? `${base}...${target}` : `${base} ${target}`;
  return {
    log: `git log --oneline ${base}..${target}`,
    stat: `git diff --stat ${range}`,
    diff: `git diff ${range}`,
  };
}

const STATUS_LABELS: Record<string, string> = {
  A: "added",
  D: "deleted",
  M: "modified",
  R: "renamed",
  C: "copied",
  T: "type changed",
  U: "unmerged",
};

export function fileStatusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status;
}

/**
 * Markdown review report for a compare: grouped change list (what target
 * brings in), behind list, and the changed files. Suitable for a PR
 * description, release notes draft, or an incident note.
 */
export function buildCompareReport(input: CompareReportInput): string {
  const lines: string[] = [];
  const { base, target } = input;
  lines.push(`## ${mdText(shortRev(target))} vs ${mdText(shortRev(base))}`);
  lines.push("");
  const modeText = input.mode === "three-dot"
    ? `changes since merge base ${input.mergeBase ? mdCode(shortRev(input.mergeBase)) : "(none)"}`
    : "direct tree difference";
  const fileSummary = input.files
    ? ` · ${input.files.length} file${input.files.length === 1 ? "" : "s"} (+${input.added ?? 0} −${input.deleted ?? 0})`
    : "";
  lines.push(
    `- **${input.ahead.length}${input.aheadTruncated ? "+" : ""}** commit${input.ahead.length === 1 ? "" : "s"} ahead, ` +
      `**${input.behind.length}${input.behindTruncated ? "+" : ""}** behind${fileSummary}`,
  );
  lines.push(`- Diff: ${modeText}${input.fallback ? " (no merge base; showing direct difference)" : ""}`);
  lines.push(`- Reproduce: ${mdCode(compareCommands(base, target, input.mode).diff)}`);
  lines.push("");

  if (input.ahead.length > 0) {
    lines.push(`### Changes in ${mdText(shortRev(target))}`);
    lines.push("");
    for (const group of groupCommitsByType(input.ahead)) {
      lines.push(`#### ${group.title}`);
      lines.push("");
      for (const commit of group.commits) {
        const breaking = commit.breaking ? "**BREAKING** " : "";
        lines.push(`- ${breaking}${mdText(commit.display)} (${mdCode(shortRev(commit.hash))}, ${mdText(commit.author)})`);
      }
      lines.push("");
    }
    if (input.aheadTruncated) {
      lines.push(`_List truncated to the newest ${input.ahead.length} commits._`);
      lines.push("");
    }
  } else {
    lines.push(`_${mdText(shortRev(target))} has no commits that ${mdText(shortRev(base))} lacks._`);
    lines.push("");
  }

  if (input.behind.length > 0) {
    lines.push(`### Only in ${mdText(shortRev(base))}`);
    lines.push("");
    for (const commit of input.behind) {
      lines.push(`- ${mdText(commit.subject)} (${mdCode(shortRev(commit.hash))}, ${mdText(commit.author)})`);
    }
    if (input.behindTruncated) lines.push(`- _…and more_`);
    lines.push("");
  }

  if (input.files && input.files.length > 0) {
    lines.push("### Files");
    lines.push("");
    lines.push("| Status | File | + | − |");
    lines.push("| --- | --- | ---: | ---: |");
    for (const file of input.files) {
      const name = file.oldPath ? `${mdCode(file.oldPath)} → ${mdCode(file.path)}` : mdCode(file.path);
      const added = file.binary ? "bin" : String(file.added);
      const deleted = file.binary ? "bin" : String(file.deleted);
      lines.push(`| ${fileStatusLabel(file.status)} | ${name} | ${added} | ${deleted} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n").trimEnd()}\n`;
}

// ---------------------------------------------------------------------------
// Compare deep link: `?cbase=&ctarget=&cmode=`
// ---------------------------------------------------------------------------

export type CompareLinkState = { base: string; target: string; mode: CompareReviewMode };

const COMPARE_LINK_KEYS = { base: "cbase", target: "ctarget", mode: "cmode" } as const;
const MAX_COMPARE_PARAM_LENGTH = 256;

function readCompareParam(params: URLSearchParams, key: string): string {
  const value = params.get(key) ?? "";
  // eslint-disable-next-line no-control-regex
  if (value.length > MAX_COMPARE_PARAM_LENGTH || /[\u0000-\u001f\u007f]/.test(value)) return "";
  return value;
}

/**
 * Read the compare pair from a location search. Both sides must be present
 * for the link to apply; the API validates the revisions themselves.
 */
export function parseCompareLink(search: string): CompareLinkState {
  const params = new URLSearchParams(search);
  const base = readCompareParam(params, COMPARE_LINK_KEYS.base);
  const target = readCompareParam(params, COMPARE_LINK_KEYS.target);
  const mode = params.get(COMPARE_LINK_KEYS.mode) === "two-dot" ? "two-dot" : "three-dot";
  if (!base || !target) return { base: "", target: "", mode };
  return { base, target, mode };
}

/** Write (or clear) the compare pair, preserving unrelated parameters. */
export function buildCompareLinkSearch(search: string, state: CompareLinkState): string {
  const params = new URLSearchParams(search);
  const active = Boolean(state.base && state.target);
  if (active) {
    params.set(COMPARE_LINK_KEYS.base, state.base);
    params.set(COMPARE_LINK_KEYS.target, state.target);
  } else {
    params.delete(COMPARE_LINK_KEYS.base);
    params.delete(COMPARE_LINK_KEYS.target);
  }
  if (active && state.mode === "two-dot") params.set(COMPARE_LINK_KEYS.mode, "two-dot");
  else params.delete(COMPARE_LINK_KEYS.mode);
  const text = params.toString();
  return text ? `?${text}` : "";
}
