/**
 * lensThreshold — Risk 系 Lens 共通の閾値モード primitive。
 *
 * - Fixed (1/50, default) / Auto (p90/p99) / Custom の3モード切替
 * - localStorage に永続化 (`refscope.risk.threshold` 共有キー)
 * - 旧キー `refscope.riskTrend.threshold` からの1回限り migration
 * - `useThresholdState()` hook で読み込み + 永続化を自動化
 * - `ThresholdSelector` コンポーネントで UI 提供
 * - `computeThresholds(state, scores)` で動的閾値を算出
 */
import { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import { percentile } from './percentile';

export type ThresholdMode = 'fixed' | 'auto' | 'custom';

export type ThresholdState = {
  mode: ThresholdMode;
  customLow: number;
  customHigh: number;
};

export const DEFAULT_LOW = 1;
export const DEFAULT_HIGH = 50;

const SHARED_STORAGE_KEY = 'refscope.risk.threshold';
const LEGACY_TREND_KEY = 'refscope.riskTrend.threshold';

const DEFAULT_THRESHOLD: ThresholdState = {
  mode: 'fixed',
  customLow: DEFAULT_LOW,
  customHigh: DEFAULT_HIGH,
};

function isValidState(parsed: Partial<ThresholdState>): parsed is ThresholdState {
  return (
    (parsed.mode === 'fixed' || parsed.mode === 'auto' || parsed.mode === 'custom') &&
    typeof parsed.customLow === 'number' &&
    Number.isFinite(parsed.customLow) &&
    typeof parsed.customHigh === 'number' &&
    Number.isFinite(parsed.customHigh)
  );
}

function readKey(key: string): ThresholdState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ThresholdState>;
    if (isValidState(parsed)) {
      return { mode: parsed.mode, customLow: parsed.customLow, customHigh: parsed.customHigh };
    }
  } catch {
    // ignore corrupt storage
  }
  return null;
}

export function loadThresholdState(): ThresholdState {
  if (typeof window === 'undefined') return DEFAULT_THRESHOLD;
  // 新キーがあれば優先
  const fromShared = readKey(SHARED_STORAGE_KEY);
  if (fromShared) return fromShared;
  // 旧キー (Trend 専用) からの 1回限り migration
  const fromLegacy = readKey(LEGACY_TREND_KEY);
  if (fromLegacy) {
    try {
      window.localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify(fromLegacy));
      window.localStorage.removeItem(LEGACY_TREND_KEY);
    } catch {
      // 書き込み失敗時はそのまま使用 (次回起動でも再試行)
    }
    return fromLegacy;
  }
  return DEFAULT_THRESHOLD;
}

export function saveThresholdState(s: ThresholdState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(SHARED_STORAGE_KEY, JSON.stringify(s));
  } catch {
    // ignore quota / disabled storage
  }
}

/** Threshold state + 永続化を扱う共通 hook */
export function useThresholdState(): [ThresholdState, (next: ThresholdState) => void] {
  const [state, setState] = useState<ThresholdState>(loadThresholdState);
  useEffect(() => {
    saveThresholdState(state);
  }, [state]);
  return [state, setState];
}

/**
 * 動的閾値を算出。
 * - fixed: (1, 50)
 * - custom: 入力値（順序逆転防止 + 整数化）
 * - auto: 入力スコアのうち > 0 のみで p90 / p99 を計算
 *   nonzero 件数 0 の場合は default にフォールバック
 */
export function computeThresholds(
  state: ThresholdState,
  scores: readonly number[],
): { lowThreshold: number; highThreshold: number } {
  if (state.mode === 'custom') {
    const lo = Math.max(0, Math.round(state.customLow));
    const hi = Math.max(lo + 1, Math.round(state.customHigh));
    return { lowThreshold: lo, highThreshold: hi };
  }
  if (state.mode === 'auto') {
    const nonzero = scores.filter((s) => s > 0);
    if (nonzero.length === 0) {
      return { lowThreshold: DEFAULT_LOW, highThreshold: DEFAULT_HIGH };
    }
    const p90 = Math.max(1, Math.round(percentile(nonzero, 90)));
    const p99 = Math.max(p90 + 1, Math.round(percentile(nonzero, 99)));
    return { lowThreshold: p90, highThreshold: p99 };
  }
  return { lowThreshold: DEFAULT_LOW, highThreshold: DEFAULT_HIGH };
}

// ---------------------------------------------------------------------------
// ThresholdSelector — Popover ベースのモード切替 UI
// ---------------------------------------------------------------------------

const MODE_LABEL: Record<ThresholdMode, string> = {
  fixed: 'Fixed',
  auto: 'Auto',
  custom: 'Custom',
};

export type ThresholdSelectorProps = {
  threshold: ThresholdState;
  onChange: (next: ThresholdState) => void;
};

export function ThresholdSelector({ threshold, onChange }: ThresholdSelectorProps) {
  const optionRow = (mode: ThresholdMode, title: string, hint: string) => {
    const active = threshold.mode === mode;
    return (
      <button
        type="button"
        onClick={() => onChange({ ...threshold, mode })}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          padding: '6px 8px',
          textAlign: 'left',
          background: active
            ? 'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 15%)'
            : 'transparent',
          color: active ? 'var(--rs-accent)' : 'var(--rs-text)',
          border: '1px solid',
          borderColor: active
            ? 'color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)'
            : 'transparent',
          borderRadius: 'var(--rs-radius-sm)',
          fontFamily: 'var(--rs-sans)',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        <span style={{ fontWeight: 600 }}>{title}</span>
        <span style={{ color: 'var(--rs-text-secondary)', fontSize: 10 }}>{hint}</span>
      </button>
    );
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`閾値モード: ${MODE_LABEL[threshold.mode]}`}
          style={{
            height: 22,
            padding: '0 8px',
            fontSize: 10,
            fontFamily: 'var(--rs-sans)',
            border: '1px solid var(--rs-border)',
            borderRadius: 'var(--rs-radius-sm)',
            background: 'transparent',
            color: 'var(--rs-text-secondary)',
            cursor: 'pointer',
          }}
        >
          閾値: {MODE_LABEL[threshold.mode]} ▾
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-72">
        <div style={{ fontFamily: 'var(--rs-sans)', fontSize: 12, lineHeight: 1.5 }}>
          <div
            style={{
              fontWeight: 600,
              marginBottom: 8,
              color: 'var(--rs-text)',
              fontSize: 13,
            }}
          >
            閾値モード
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {optionRow('fixed', 'Fixed (1 / 50)', '仕様デフォルト')}
            {optionRow('auto', 'Auto (p90 / p99)', '現データの分布から自動算出')}
            {optionRow('custom', 'Custom', '手動で LOW / HIGH を指定')}
          </div>

          {threshold.mode === 'custom' && (
            <div
              style={{
                marginTop: 10,
                padding: 8,
                borderTop: '1px solid var(--rs-border)',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 40, color: 'var(--rs-warning)', fontWeight: 600 }}>LOW</span>
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={threshold.customLow}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      onChange({ ...threshold, customLow: v });
                    }
                  }}
                  style={{
                    flex: 1,
                    height: 26,
                    padding: '0 8px',
                    fontFamily: 'var(--rs-mono)',
                    fontSize: 12,
                    border: '1px solid var(--rs-border)',
                    borderRadius: 'var(--rs-radius-sm)',
                    background: 'var(--rs-bg-elevated)',
                    color: 'var(--rs-text)',
                  }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 40, color: 'var(--rs-git-deleted)', fontWeight: 600 }}>HIGH</span>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={threshold.customHigh}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) {
                      onChange({ ...threshold, customHigh: v });
                    }
                  }}
                  style={{
                    flex: 1,
                    height: 26,
                    padding: '0 8px',
                    fontFamily: 'var(--rs-mono)',
                    fontSize: 12,
                    border: '1px solid var(--rs-border)',
                    borderRadius: 'var(--rs-radius-sm)',
                    background: 'var(--rs-bg-elevated)',
                    color: 'var(--rs-text)',
                  }}
                />
              </label>
            </div>
          )}

          <div
            style={{
              marginTop: 10,
              paddingTop: 8,
              borderTop: '1px solid var(--rs-border)',
              fontSize: 10,
              color: 'var(--rs-text-muted)',
            }}
          >
            選択は localStorage に保存されます
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
