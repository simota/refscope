/**
 * RiskBadge — Risky Diff Detector visual indicator.
 *
 * Thresholds:
 *   score 0       → null (not rendered)
 *   score 1-49    → yellow "RISK"  (--rs-warning)
 *   score 50+     → red   "RISK!"  (--rs-danger)
 *
 * muted prop reduces opacity to 0.3 (user has silenced risk highlights).
 */

export const LOW_THRESHOLD = 1;
export const HIGH_THRESHOLD = 50;

export function RiskBadge({
  score,
  muted = false,
}: {
  score: number | undefined;
  muted?: boolean;
}) {
  if (score == null || score < LOW_THRESHOLD) return null;

  const isHigh = score >= HIGH_THRESHOLD;
  const label = isHigh ? "RISK!" : "RISK";
  // --rs-danger does not exist in the design token set; use --rs-git-deleted
  // (red) for the high-risk tier and --rs-warning (yellow) for the low tier.
  const color = isHigh ? "var(--rs-git-deleted)" : "var(--rs-warning)";

  return (
    <span
      aria-label={`Risk score: ${score}`}
      title={`Risk score: ${score}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "1px 6px",
        fontSize: 10,
        fontFamily: "var(--rs-mono)",
        fontWeight: 700,
        height: 18,
        borderRadius: 9999,
        color,
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${color} 18%)`,
        border: `1px solid color-mix(in oklab, var(--rs-border), ${color} 50%)`,
        letterSpacing: "0.04em",
        opacity: muted ? 0.3 : 1,
        transition: "opacity 120ms ease-out",
        flexShrink: 0,
      }}
    >
      {label}
    </span>
  );
}
