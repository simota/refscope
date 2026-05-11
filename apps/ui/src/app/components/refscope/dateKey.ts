/**
 * 日付キー生成ユーティリティ。
 *
 * RiskHeatmapLens / RiskTrendLens など複数の Lens で
 * 同日コミットを集約するために共有する。
 */

/** Date → "YYYY-MM-DD" (ローカルタイムゾーン基準) */
export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
