/**
 * refUtil — Lens 横断で使うブランチ参照ユーティリティ。
 *
 * 旧来 DriftLens.tsx と OutboxLens.tsx でそれぞれ estimateBase / shortRefName が
 * 重複定義されていた。リファクタの一環として 1 箇所に集約し、Lens 群で同じ
 * ヒューリスティック (main → master → trunk → 先頭) を共有する。
 */

/**
 * ref リストから base ブランチを推定。
 * 優先順位: main → master → trunk → 先頭の ref。
 * 引数が空配列の場合は null を返す。
 *
 * 1. ローカル名直接一致または `refs/heads/<name>` 形式の完全一致を最優先
 * 2. リモート tracking ブランチ (例: `refs/remotes/origin/main`) のサフィックス一致
 * 3. それでも見つからなければリストの先頭 ref
 */
export function estimateBase(refs: Array<{ name: string }>): string | null {
  const CANDIDATES = ['main', 'master', 'trunk'];
  for (const candidate of CANDIDATES) {
    if (refs.some((r) => r.name === candidate || r.name === `refs/heads/${candidate}`)) {
      return candidate;
    }
  }
  for (const candidate of CANDIDATES) {
    const remote = refs.find((r) => r.name.endsWith(`/${candidate}`));
    if (remote) return remote.name;
  }
  return refs[0]?.name ?? null;
}

/**
 * フル ref 名 (refs/heads/foo / refs/remotes/origin/bar / refs/tags/v1) から
 * UI 表示用のショート名を抽出する。マッチしない名前はそのまま返す。
 */
export function shortRefName(name: string): string {
  if (name.startsWith('refs/heads/')) return name.slice('refs/heads/'.length);
  if (name.startsWith('refs/remotes/')) return name.slice('refs/remotes/'.length);
  if (name.startsWith('refs/tags/')) return name.slice('refs/tags/'.length);
  return name;
}
