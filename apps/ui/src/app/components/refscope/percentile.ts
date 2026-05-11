/**
 * Percentile (Type 7, linear interpolation — R/NumPy default).
 *
 * @param values - 数値配列（非破壊、内部でコピー＆ソート）
 * @param p - パーセンタイル位置 [0, 100]
 * @returns p パーセンタイル値。空配列の場合 0。
 */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const sorted = [...values].sort((a, b) => a - b);
  const clamped = Math.max(0, Math.min(100, p));
  const idx = (clamped / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}
