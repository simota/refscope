// Suggested reading order for a review range — DERIVED, not observed.
//
// Reading a range newest-commit-first means the migration or the shared
// utility everything depends on is often found last. This groups the changed
// files into "Read first" / "Then read" / "Skim" from evidence the reviewer
// can check on the row itself: what kind of path it is, how big the change
// is, whether it deletes code, and whether a matching test changed in the
// same range. The heuristics are deliberately simple and every placement
// lists its reasons, so the suggestion can be second-guessed at a glance.

export type ReviewFile = {
  status: string;
  path: string;
  oldPath?: string;
  added: number;
  deleted: number;
  binary: boolean;
};

export type ReviewGroup = "first" | "next" | "skim";

export type ReviewItem = {
  file: ReviewFile;
  group: ReviewGroup;
  /** Short, human-readable evidence, strongest first. */
  reasons: string[];
  /** Higher reads earlier within its group. */
  score: number;
};

export type ReviewPlan = {
  items: ReviewItem[];
  counts: Record<ReviewGroup, number>;
  /** Source files changed without any test file changing in the range. */
  untestedSources: number;
  testsChanged: number;
};

type Category =
  | "migration"
  | "security"
  | "contract"
  | "dependency"
  | "lockfile"
  | "build"
  | "shared"
  | "test"
  | "docs"
  | "generated"
  | "asset"
  | "source"
  | "other";

const SOURCE_EXT = /\.(?:[cm]?[jt]sx?|py|rb|go|rs|java|kt|kts|scala|swift|c|cc|cpp|h|hpp|cs|php|ex|exs|erl|clj|lua|dart|vue|svelte|astro|sh|bash|zsh|sql)$/i;
const DOC_EXT = /\.(?:md|mdx|rst|adoc)$/i;
const ASSET_EXT = /\.(?:png|jpe?g|gif|svg|ico|webp|avif|bmp|woff2?|ttf|otf|eot|mp3|mp4|webm|pdf)$/i;

function baseName(path: string): string {
  const index = path.lastIndexOf("/");
  return index >= 0 ? path.slice(index + 1) : path;
}

export function isTestPath(path: string): boolean {
  return (
    /(?:^|\/)(?:tests?|__tests__|spec|specs|e2e)\//i.test(path) ||
    /[._-](?:test|spec)\.[^/]+$/i.test(path) ||
    /(?:^|\/)test_[^/]+\.py$/i.test(path) ||
    /_test\.go$/i.test(path)
  );
}

export function categorize(path: string): Category {
  const lower = path.toLowerCase();
  const name = baseName(lower);
  if (/(?:^|\/)(?:dist|build|out|vendor|node_modules)\//.test(lower) || /\.min\.(?:js|css)$/.test(name) || /\.snap$/.test(name) || /(?:^|\/)__snapshots__\//.test(lower) || /\.generated\./.test(name)) {
    return "generated";
  }
  if (/^(?:pnpm-lock\.yaml|package-lock\.json|yarn\.lock|cargo\.lock|gemfile\.lock|poetry\.lock|composer\.lock|go\.sum|bun\.lockb?|uv\.lock)$/.test(name)) {
    return "lockfile";
  }
  if (isTestPath(path)) return "test";
  if (/(?:^|\/)(?:migrations?|migrate|db\/schema|alembic)\//.test(lower) || /(?:^|[._-])(?:schema|migration)\.[^/]+$/.test(name) || (/\.sql$/.test(name) && /(?:migrat|schema)/.test(lower))) {
    return "migration";
  }
  if (/(?:^|[/_.-])(?:auth|authn|authz|security|permission|permissions|acl|crypto|secret|secrets|session|token|password|sanitiz\w*|csrf|cors)(?:[/_.-]|$)/.test(lower)) {
    return "security";
  }
  if (/\.(?:proto|graphql|gql|avsc|thrift)$/.test(name) || /(?:openapi|swagger)[^/]*\.(?:ya?ml|json)$/.test(name) || /(?:^|\/)(?:routes?|api|contracts?)\/[^/]+$/.test(lower) || /\.d\.ts$/.test(name)) {
    return "contract";
  }
  if (/^(?:package\.json|cargo\.toml|go\.mod|gemfile|pyproject\.toml|requirements[^/]*\.txt|pom\.xml|build\.gradle(?:\.kts)?|composer\.json)$/.test(name)) {
    return "dependency";
  }
  if (/^(?:dockerfile|makefile|docker-compose[^/]*\.ya?ml|tsconfig[^/]*\.json|vite\.config\.[^/]+|webpack\.config\.[^/]+|\.env[^/]*)$/.test(name) || /(?:^|\/)\.github\/workflows\//.test(lower) || /(?:^|\/)(?:infra|terraform|k8s|helm|deploy)\//.test(lower)) {
    return "build";
  }
  if (DOC_EXT.test(name) || /(?:^|\/)docs?\//.test(lower) || /^(?:license|changelog|authors)(?:\.|$)/.test(name)) return "docs";
  if (ASSET_EXT.test(name)) return "asset";
  if (SOURCE_EXT.test(name)) {
    if (/(?:^|\/)(?:lib|libs|shared|common|core|utils?|helpers?|packages\/[^/]+\/src)\//.test(lower)) return "shared";
    return "source";
  }
  return "other";
}

const CATEGORY_REASON: Partial<Record<Category, string>> = {
  migration: "schema / migration",
  security: "security-sensitive path",
  contract: "API contract / public types",
  dependency: "dependency manifest",
  build: "build / CI / deploy config",
  shared: "shared module (wide blast radius)",
  lockfile: "lockfile (usually generated)",
  generated: "generated / vendored output",
  docs: "documentation",
  asset: "static asset",
  test: "test",
};

/** A module stem used to pair `src/foo/bar.ts` with `test/bar.test.ts`. */
export function moduleStem(path: string): string {
  return baseName(path)
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/^test_/, "")
    .replace(/(?:[._-](?:test|spec)|_test)$/, "");
}

const LARGE_CHANGE = 200;
const MEDIUM_CHANGE = 50;

export function buildReviewPlan(files: readonly ReviewFile[]): ReviewPlan {
  const testStems = new Set<string>();
  let testsChanged = 0;
  for (const file of files) {
    if (categorize(file.path) === "test") {
      testsChanged += 1;
      testStems.add(moduleStem(file.path));
    }
  }

  let untestedSources = 0;
  const items = files.map((file): ReviewItem => {
    const category = categorize(file.path);
    const churn = file.added + file.deleted;
    const reasons: string[] = [];
    const categoryReason = CATEGORY_REASON[category];
    if (categoryReason) reasons.push(categoryReason);

    let group: ReviewGroup;
    let score = churn;
    switch (category) {
      case "migration":
      case "security":
      case "contract":
        group = "first";
        score += 10_000;
        break;
      case "dependency":
      case "build":
        group = "first";
        score += 5_000;
        break;
      case "shared":
        group = "first";
        score += 2_000;
        break;
      case "lockfile":
      case "generated":
      case "docs":
      case "asset":
        group = "skim";
        break;
      default:
        group = "next";
    }

    const isCode = category === "source" || category === "shared" || category === "security" || category === "contract";
    if (file.status.startsWith("D") && isCode) {
      reasons.push("deletes code");
      if (group === "next") group = "first";
      score += 1_000;
    }
    if (!file.binary && churn >= LARGE_CHANGE) {
      reasons.push(`large change (${churn} lines)`);
      if (group === "next") group = "first";
    } else if (!file.binary && churn >= MEDIUM_CHANGE && group !== "skim") {
      reasons.push(`${churn} lines`);
    }
    const pureRename = file.status.startsWith("R") && churn === 0;
    if (pureRename) {
      reasons.push("pure rename");
      group = "skim";
    }
    if (file.binary && group !== "skim") reasons.push("binary");

    if (isCode && !file.status.startsWith("D") && !pureRename) {
      if (testStems.has(moduleStem(file.path))) {
        reasons.push("matching test changed");
      } else {
        untestedSources += 1;
        reasons.push(testsChanged > 0 ? "no matching test changed" : "no test changed in range");
        score += 100;
      }
    }
    return { file, group, reasons, score };
  });

  // Tests read best right after the code they cover: place a paired test
  // just below its source's score, an unpaired one at the end of its group.
  const sourceScore = new Map<string, number>();
  for (const item of items) {
    if (categorize(item.file.path) === "test") continue;
    const stem = moduleStem(item.file.path);
    sourceScore.set(stem, Math.max(sourceScore.get(stem) ?? -Infinity, item.score));
  }
  for (const item of items) {
    if (categorize(item.file.path) !== "test") continue;
    const paired = sourceScore.get(moduleStem(item.file.path));
    item.score = paired !== undefined ? paired - 0.5 : -1;
  }

  const groupOrder: Record<ReviewGroup, number> = { first: 0, next: 1, skim: 2 };
  items.sort(
    (a, b) =>
      groupOrder[a.group] - groupOrder[b.group] ||
      b.score - a.score ||
      a.file.path.localeCompare(b.file.path),
  );
  const counts: Record<ReviewGroup, number> = { first: 0, next: 0, skim: 0 };
  for (const item of items) counts[item.group] += 1;
  return { items, counts, untestedSources, testsChanged };
}

export const REVIEW_GROUP_LABEL: Record<ReviewGroup, string> = {
  first: "Read first",
  next: "Then read",
  skim: "Skim — likely low risk",
};

/** Markdown block for the review report / PR description. */
export function formatReviewPlanMarkdown(plan: ReviewPlan): string {
  const lines: string[] = ["## Suggested reading order (derived)", ""];
  lines.push(
    "_Heuristic from path kind, diff size, deletions and test presence — a starting point, not a verdict._",
    "",
  );
  for (const group of ["first", "next", "skim"] as const) {
    const groupItems = plan.items.filter((item) => item.group === group);
    if (groupItems.length === 0) continue;
    lines.push(`### ${REVIEW_GROUP_LABEL[group]}`, "");
    for (const item of groupItems) {
      const why = item.reasons.length ? ` — ${item.reasons.join("; ")}` : "";
      lines.push(`- \`${item.file.path}\` (+${item.file.added} −${item.file.deleted})${why}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}
