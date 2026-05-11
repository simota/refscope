/**
 * riskBadge — riskScore に対応する視覚バッジスタイルの共通 primitive。
 *
 * Outbox / Digest など複数 Lens で同じ閾値・色基準を再利用するための
 * 単一源泉。色は BranchSidebar の `ROT_SCORE_COLORS` (healthy/warning/critical)
 * を流用し、Risk 系の視覚語彙をプロジェクト全体で統一する。
 *
 * 閾値:
 *   - riskScore < 1                → バッジ非表示 (null)
 *   - 1 ≤ riskScore < HIGH         → warning 色
 *   - HIGH ≤ riskScore             → critical 色
 */
import type { CSSProperties } from 'react';
import { ROT_SCORE_COLORS } from './BranchSidebar';

/** riskScore ≥ HIGH → critical 色 */
export const RISK_HIGH_THRESHOLD = 50;
/** riskScore ≥ LOW → warning 色 (LOW 未満は null = バッジ非表示) */
export const RISK_LOW_THRESHOLD = 1;

/**
 * riskScore からバッジの inline style を生成する。
 * `score < RISK_LOW_THRESHOLD` のときは null を返し、呼び出し側でバッジを
 * 描画しない選択を可能にする。
 */
export function riskBadgeStyle(score: number): CSSProperties | null {
  if (score < RISK_LOW_THRESHOLD) return null;
  const color =
    score >= RISK_HIGH_THRESHOLD
      ? ROT_SCORE_COLORS.critical
      : ROT_SCORE_COLORS.warning;
  return {
    display: 'inline-flex',
    alignItems: 'center',
    padding: '0 5px',
    height: 14,
    borderRadius: 4,
    fontSize: 9,
    fontFamily: 'var(--rs-mono)',
    fontWeight: 600,
    background: `color-mix(in oklab, var(--rs-bg-elevated), ${color} 25%)`,
    color,
    border: `1px solid ${color}`,
  };
}

/** riskScore に対するラベル文字列 (warning / critical)。バッジの title 属性用。 */
export function riskBadgeLabel(score: number): 'warning' | 'critical' | null {
  if (score < RISK_LOW_THRESHOLD) return null;
  return score >= RISK_HIGH_THRESHOLD ? 'critical' : 'warning';
}
