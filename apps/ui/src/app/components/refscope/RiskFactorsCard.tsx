/**
 * RiskFactorsCard — Lens 共通の Risk Factors 表示 primitive。
 *
 * Risk 系 Lens (Risk Trend / Risk Heatmap など) の Tooltip / HoverCard 内で、
 * コミット単体の "なぜスコアが高いか" を伝える要素を統一的にレンダリング。
 *
 * 表示要素:
 *  - hash(7) / subject / author + 高精度日時
 *  - riskScore (動的閾値による色分け)
 *  - ±added / -deleted / fileCount
 *  - coarseKind / merge / signatureStatus のバッジ
 *  - top N changed files (basename + structuralKind)
 */
import type { ChangedFile, CoarseKind, Commit, SignatureStatus } from './data';

// ---------------------------------------------------------------------------
// Types & helpers (Lens 横断で再利用)
// ---------------------------------------------------------------------------

export type TopFile = {
  basename: string;
  status: string;
  changes: number;
  structuralKind?: ChangedFile['structuralKind'];
};

/** path から basename を抽出 */
export function basename(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx >= 0 ? path.slice(idx + 1) : path;
}

/** 変更量降順で上位 N ファイルを返す (added + deleted > 0 のみ) */
export function pickTopFiles(files: ChangedFile[], limit: number): TopFile[] {
  return files
    .filter((f) => (f.added ?? 0) + (f.deleted ?? 0) > 0)
    .map((f) => ({
      basename: basename(f.path),
      status: f.status,
      changes: (f.added ?? 0) + (f.deleted ?? 0),
      structuralKind: f.structuralKind,
    }))
    .sort((a, b) => b.changes - a.changes)
    .slice(0, limit);
}

/** coarseKind を人間語ラベルに */
export function coarseKindLabel(kind?: CoarseKind): string | null {
  if (!kind) return null;
  switch (kind) {
    case 'likely_logic':
      return 'logic';
    case 'likely_refactor':
      return 'refactor';
    case 'empty':
      return 'empty';
  }
}

/** signatureStatus が表示すべき状態か */
export function shouldShowSignature(s?: SignatureStatus): boolean {
  return !!s && s !== 'unknown' && s !== 'unsigned';
}

/**
 * Risk Factors 表示に必要な最小データ。
 * 各 Lens 側で Commit / ChartPoint / CellData から構築する。
 */
export type RiskFactor = {
  hash: string;
  subject: string;
  author: string;
  /** 表示用整形済み日時 (例: "2026/05/11 14:35") */
  dateTimeLabel: string;
  riskScore: number;
  added: number;
  deleted: number;
  fileCount: number;
  coarseKind?: CoarseKind;
  isMerge: boolean;
  signatureStatus?: SignatureStatus;
  topFiles: TopFile[];
};

const DEFAULT_TOP_FILE_COUNT = 3;

/**
 * Commit から RiskFactor を組み立てるヘルパ。
 * Heatmap など pre-aggregated な ChartPoint を持たない Lens 用。
 */
export function buildRiskFactor(
  commit: Commit,
  dateTimeLabel: string,
  topFileLimit: number = DEFAULT_TOP_FILE_COUNT,
): RiskFactor {
  return {
    hash: commit.hash,
    subject: commit.subject,
    author: commit.author,
    dateTimeLabel,
    riskScore: commit.riskScore ?? 0,
    added: commit.added ?? 0,
    deleted: commit.deleted ?? 0,
    fileCount: commit.fileCount ?? commit.files?.length ?? 0,
    coarseKind: commit.coarseKind,
    isMerge: !!commit.isMerge,
    signatureStatus: commit.signatureStatus,
    topFiles: pickTopFiles(commit.files ?? [], topFileLimit),
  };
}

// ---------------------------------------------------------------------------
// Card component
// ---------------------------------------------------------------------------

export type RiskFactorsCardProps = {
  factor: RiskFactor;
  lowThreshold: number;
  highThreshold: number;
  /** 既存 Trend Tooltip は pointerEvents: none で構築されているため、用途に応じて切替可能に */
  pointerEvents?: 'auto' | 'none';
};

export function RiskFactorsCard({
  factor,
  lowThreshold,
  highThreshold,
  pointerEvents = 'none',
}: RiskFactorsCardProps) {
  const score = factor.riskScore;
  const scoreColor =
    score >= highThreshold
      ? 'var(--rs-git-deleted)'
      : score >= lowThreshold
        ? 'var(--rs-warning)'
        : 'var(--rs-text-secondary)';

  const kindLabel = coarseKindLabel(factor.coarseKind);
  const showSig = shouldShowSignature(factor.signatureStatus);

  return (
    <div
      style={{
        background: 'var(--rs-bg-elevated)',
        border: '1px solid var(--rs-border)',
        borderRadius: 'var(--rs-radius-sm)',
        padding: '8px 10px',
        fontSize: 11,
        fontFamily: 'var(--rs-sans)',
        maxWidth: 320,
        pointerEvents,
        lineHeight: 1.45,
      }}
    >
      {/* Hash */}
      <div
        style={{
          fontWeight: 600,
          marginBottom: 4,
          fontFamily: 'var(--rs-mono)',
          fontSize: 10,
          color: 'var(--rs-text-secondary)',
        }}
      >
        {factor.hash.slice(0, 7)}
      </div>

      {/* Subject */}
      <div
        style={{
          fontWeight: 500,
          marginBottom: 4,
          wordBreak: 'break-all',
          color: 'var(--rs-text)',
        }}
      >
        {factor.subject}
      </div>

      {/* Author + 高精度日時 */}
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 4 }}>
        {factor.author} · {factor.dateTimeLabel}
      </div>

      {/* riskScore */}
      <div style={{ color: scoreColor, fontWeight: 600, marginBottom: 6 }}>
        riskScore: {score}
      </div>

      {/* Risk factors */}
      <div
        style={{
          borderTop: '1px solid var(--rs-border)',
          paddingTop: 6,
          marginTop: 2,
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
        }}
      >
        {/* Lines / files */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <span style={{ color: 'var(--rs-git-added)', fontFamily: 'var(--rs-mono)' }}>
            +{factor.added}
          </span>
          <span style={{ color: 'var(--rs-git-deleted)', fontFamily: 'var(--rs-mono)' }}>
            −{factor.deleted}
          </span>
          <span style={{ color: 'var(--rs-text-muted)' }}>
            {factor.fileCount} {factor.fileCount === 1 ? 'file' : 'files'}
          </span>
        </div>

        {/* Badges row: kind + merge + signed */}
        {(kindLabel || factor.isMerge || showSig) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {kindLabel && (
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background:
                    'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-text-muted) 15%)',
                  color: 'var(--rs-text-secondary)',
                  fontFamily: 'var(--rs-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                {kindLabel}
              </span>
            )}
            {factor.isMerge && (
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background:
                    'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 18%)',
                  color: 'var(--rs-accent)',
                  fontFamily: 'var(--rs-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
              >
                merge
              </span>
            )}
            {showSig && (
              <span
                style={{
                  fontSize: 9,
                  padding: '1px 5px',
                  borderRadius: 4,
                  background:
                    'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 15%)',
                  color: 'var(--rs-warning)',
                  fontFamily: 'var(--rs-mono)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.5,
                }}
                title={`signature: ${factor.signatureStatus}`}
              >
                {factor.signatureStatus}
              </span>
            )}
          </div>
        )}

        {/* Top files */}
        {factor.topFiles.length > 0 && (
          <div style={{ marginTop: 2 }}>
            {factor.topFiles.map((f) => (
              <div
                key={f.basename}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontFamily: 'var(--rs-mono)',
                  fontSize: 10,
                  color: 'var(--rs-text-secondary)',
                }}
              >
                <span style={{ width: 10, color: 'var(--rs-text-muted)' }}>{f.status}</span>
                <span
                  style={{
                    flex: 1,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {f.basename}
                </span>
                {f.structuralKind && (
                  <span style={{ color: 'var(--rs-text-muted)', fontSize: 9 }}>
                    {f.structuralKind}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
