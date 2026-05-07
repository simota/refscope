/**
 * StructuralDiffBadge — D-5 (Option A) heuristic structural diff badge.
 *
 * Displays a colour-coded label indicating the structural category of a file
 * diff. All labels are explicitly marked as heuristic estimates. Refscope does
 * NOT claim semantic equivalence; "rename_only" means token overlap is very
 * high, not that no behaviour changed.
 *
 * Transparency requirement (per Spark proposal §1.4):
 *   - The badge colour and label signal the *derived* category.
 *   - A hover tooltip always reminds the user that this is a heuristic.
 *   - The disclaimer "Refscope はここで意味等価を主張しません" is included in
 *     the tooltip so reviewers understand the limitation.
 */
import type { StructuralKind } from "./data";

/** CSS colour tokens for each structural kind. */
const KIND_COLORS: Record<StructuralKind, string> = {
  whitespace_only: "var(--rs-text-muted)",
  comment_only: "var(--rs-text-muted)",
  rename_only: "var(--color-blue-500, #3b82f6)",
  symmetric: "var(--rs-git-added)",
  logic_change: "var(--rs-git-deleted)",
  mixed: "var(--color-amber-500, #f59e0b)",
};

/** Short human-readable labels. Intentionally hedged — no "safe" claims. */
const KIND_LABELS: Record<StructuralKind, string> = {
  whitespace_only: "whitespace",
  comment_only: "comment",
  rename_only: "rename-like",
  symmetric: "structurally close",
  logic_change: "logic change",
  mixed: "mixed",
};

/**
 * Full tooltip text for each kind. Always includes the heuristic disclaimer
 * so reviewers understand Refscope is not making semantic equivalence claims.
 */
const KIND_TOOLTIPS: Record<StructuralKind, string> = {
  whitespace_only:
    "All changes appear to be whitespace/formatting only (heuristic).\n" +
    "Refscope はここで意味等価を主張しません。構造的近似のみです。",
  comment_only:
    "All changes appear to be comments or blank lines (heuristic).\n" +
    "Refscope はここで意味等価を主張しません。構造的近似のみです。",
  rename_only:
    "Very high token overlap with symmetric line counts — likely a rename/move (heuristic).\n" +
    "Refscope はここで意味等価を主張しません。型シグネチャや制御フローの変化は検出できません。",
  symmetric:
    "High structural similarity — many identifiers shared between old and new (heuristic).\n" +
    "Refscope はここで意味等価を主張しません。構造的に近い変更ですが、subtle な変更が含まれる場合があります。",
  logic_change:
    "Low token overlap — likely contains significant logic changes (heuristic).\n" +
    "Refscope はここで意味等価を主張しません。レビューを推奨します。",
  mixed:
    "Medium token overlap — structural intent is unclear (heuristic).\n" +
    "Refscope はここで意味等価を主張しません。構造的近似のみです。",
};

/**
 * Inline structural diff badge for a single file.
 *
 * @param kind  — the structural kind; if undefined, renders nothing.
 * @param compact — when true, renders a smaller badge without icon (for
 *                  use in dense commit-card contexts).
 */
export function StructuralDiffBadge({
  kind,
  compact = false,
}: {
  kind: StructuralKind | undefined;
  compact?: boolean;
}) {
  if (!kind) return null;

  const color = KIND_COLORS[kind];
  const label = KIND_LABELS[kind];
  const tooltip = KIND_TOOLTIPS[kind];

  return (
    <span
      title={tooltip}
      aria-label={`Structural diff classification: ${label} (heuristic estimate — not a semantic equivalence claim)`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        padding: compact ? "0 4px" : "1px 6px",
        fontSize: compact ? 9 : 10,
        fontFamily: "var(--rs-mono)",
        fontWeight: 700,
        letterSpacing: "0.03em",
        height: compact ? 15 : 17,
        borderRadius: "var(--rs-radius-sm, 3px)",
        color,
        background: `color-mix(in oklab, var(--rs-bg-elevated, #1e1e1e), ${color} 16%)`,
        border: `1px solid color-mix(in oklab, var(--rs-border, #333), ${color} 35%)`,
        cursor: "help",
        flexShrink: 0,
        whiteSpace: "nowrap",
      }}
    >
      {label}
    </span>
  );
}
