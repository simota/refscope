/**
 * LensHeader — Lens 共通の自己説明ヘッダ primitive。
 *
 * Title + 1行説明 + ? Popover で Lens の意図を初見ユーザに伝える。
 * Popover content は呼び出し側が任意の React ノードを差し込む
 * (riskScore glossary、Heatmap metaphor 解説など)。
 */
import type { ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';

export type LensHeaderProps = {
  /** タブのタイトル (例: "Risk Trend") */
  title: string;
  /** 1行説明 — Lens の意図を短く */
  oneLiner: string;
  /** ? を押したときに開く Popover の中身 */
  helpContent: ReactNode;
  /** ? ボタンの aria-label。省略時は "ヘルプを表示"。 */
  helpAriaLabel?: string;
};

export function LensHeader({
  title,
  oneLiner,
  helpContent,
  helpAriaLabel = 'ヘルプを表示',
}: LensHeaderProps) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '8px 16px 6px',
        flexShrink: 0,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--rs-sans)',
            fontSize: 13,
            fontWeight: 600,
            color: 'var(--rs-text)',
          }}
        >
          {title}
        </div>
        <div
          style={{
            fontFamily: 'var(--rs-sans)',
            fontSize: 11,
            color: 'var(--rs-text-secondary)',
          }}
        >
          {oneLiner}
        </div>
      </div>

      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={helpAriaLabel}
            style={{
              width: 24,
              height: 24,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 'var(--rs-radius-sm)',
              border: '1px solid var(--rs-border)',
              background: 'transparent',
              color: 'var(--rs-text-secondary)',
              fontFamily: 'var(--rs-sans)',
              fontSize: 12,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ?
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 text-xs">
          <div style={{ fontFamily: 'var(--rs-sans)', lineHeight: 1.5 }}>{helpContent}</div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * RiskScoreLegend — riskScore の 0 / 1-49 / 50+ 凡例を表示する共通ヘルパ。
 * Risk 系 Lens の LensHeader.helpContent として利用する。
 */
export function RiskScoreLegend() {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--rs-text)' }}>
        riskScore とは
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        Risky Diff Detector がコミット毎に算出するスコア。
        変更行数・ファイル構造・コメントなど複数の特徴から導かれる。
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--rs-text-muted)',
            }}
          />
          <span style={{ fontFamily: 'var(--rs-mono)', fontSize: 11 }}>0</span>
          <span style={{ color: 'var(--rs-text-secondary)' }}>リスクなし</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--rs-warning)',
            }}
          />
          <span style={{ fontFamily: 'var(--rs-mono)', fontSize: 11 }}>1–49</span>
          <span style={{ color: 'var(--rs-text-secondary)' }}>warning (LOW 閾値)</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            style={{
              display: 'inline-block',
              width: 10,
              height: 10,
              borderRadius: '50%',
              background: 'var(--rs-git-deleted)',
            }}
          />
          <span style={{ fontFamily: 'var(--rs-mono)', fontSize: 11 }}>50+</span>
          <span style={{ color: 'var(--rs-text-secondary)' }}>danger (HIGH 閾値)</span>
        </div>
      </div>
    </>
  );
}
