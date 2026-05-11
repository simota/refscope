/**
 * EmptyStateCard — Lens 共通の空状態 primitive。
 *
 * Lens が描画できない原因（commits=0 / authorDate欠落 / 全 score=0 /
 * Heatmap で TOP_N 全落など）を区別して表示し、兄弟 Lens への遷移ボタンを提供する。
 *
 * Reason ごとの messages とフッタ (例: riskScore 凡例) は呼び出し側が指定する。
 */
import type { ReactNode } from 'react';
import type { LensId } from './LensSwitcher';

/**
 * Lens 共通の空状態理由。新しい reason が必要な Lens は文字列 union を拡張する。
 */
export type LensEmptyReason =
  | 'no-commits'
  | 'no-author-date'
  | 'no-risky'
  | 'no-visible-authors'
  | 'no-rewrite-events'
  | 'pulse-quiet';

export type EmptyStateMessage = {
  title: string;
  body: string;
};

export type EmptyStateCardProps = {
  /** 表示する空状態の理由 */
  reason: LensEmptyReason;
  /** reason → メッセージのマップ。表示する reason だけ含めれば良い。 */
  messages: Partial<Record<LensEmptyReason, EmptyStateMessage>>;
  /** Lens 遷移コールバック（指定時のみ relatedLenses のボタンが表示される） */
  onChangeLens?: (lens: LensId) => void;
  /** 関連 Lens への遷移ボタン群。`{ id, label }` の配列。 */
  relatedLenses?: ReadonlyArray<{ id: LensId; label: string }>;
  /** タイトルと本文の下に表示する補足要素 (riskScore 凡例など) */
  footer?: ReactNode;
};

export function EmptyStateCard({
  reason,
  messages,
  onChangeLens,
  relatedLenses,
  footer,
}: EmptyStateCardProps) {
  const m = messages[reason] ?? {
    title: '表示できる内容がありません',
    body: '',
  };

  return (
    <div
      style={{
        display: 'flex',
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        height: '100%',
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 440,
          padding: '20px 24px',
          background: 'var(--rs-bg-elevated)',
          border: '1px solid var(--rs-border)',
          borderRadius: 'var(--rs-radius-md)',
          fontFamily: 'var(--rs-sans)',
        }}
      >
        <div
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--rs-text)',
            marginBottom: 8,
          }}
        >
          {m.title}
        </div>
        <div
          style={{
            fontSize: 12,
            color: 'var(--rs-text-secondary)',
            lineHeight: 1.6,
            marginBottom: 16,
          }}
        >
          {m.body}
        </div>

        {footer && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--rs-text-muted)',
              marginBottom: 12,
              paddingTop: 12,
              borderTop: '1px solid var(--rs-border)',
            }}
          >
            {footer}
          </div>
        )}

        {onChangeLens && relatedLenses && relatedLenses.length > 0 && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {relatedLenses.map((l) => (
              <button
                key={l.id}
                type="button"
                onClick={() => onChangeLens(l.id)}
                style={{
                  height: 28,
                  padding: '0 12px',
                  fontSize: 11,
                  fontFamily: 'var(--rs-sans)',
                  borderRadius: 'var(--rs-radius-sm)',
                  border: '1px solid var(--rs-border)',
                  background: 'transparent',
                  color: 'var(--rs-text-secondary)',
                  cursor: 'pointer',
                }}
              >
                {l.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * riskScore の 0 / 1-49 / 50+ 凡例を EmptyStateCard.footer 用に表示。
 * Risk Trend / Risk Heatmap 等のリスク系 Lens で再利用する。
 */
export function RiskScoreLegendInline() {
  return (
    <>
      riskScore: <span style={{ fontFamily: 'var(--rs-mono)' }}>0</span> リスクなし ·{' '}
      <span style={{ fontFamily: 'var(--rs-mono)', color: 'var(--rs-warning)' }}>1–49</span>{' '}
      warning ·{' '}
      <span style={{ fontFamily: 'var(--rs-mono)', color: 'var(--rs-git-deleted)' }}>50+</span>{' '}
      danger
    </>
  );
}
