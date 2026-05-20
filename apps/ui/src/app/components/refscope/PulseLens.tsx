/**
 * Pulse Lens — コードベースの"鼓動"を Fleet Cosmos 風 3D メッセージウィンドウ宇宙で可視化。
 *
 *   - ファイル変更 = 3D カード（Billboard + Text）
 *   - 位置 = ハッシュ由来の固定座標 (X/Y) + 鮮度 (Z: 手前=新)
 *   - 色  = 変更量 (added + deleted の log スケール: 青=軽微→赤=巨大)
 *   - 不透明度 = 鮮度（古いほど霧化）
 *   - 金枠 + 拡大 = 5 分以内に更新
 *   - OrbitControls: 左ドラッグ回転 / 右ドラッグパン / ホイールズーム
 *
 * ログ的な「Activity」ではなく、コードベースが今動いている感覚を映すレイヤー。
 */
import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { getCommit, type WorkTreeResponse } from '../../api';
import type { Commit, CommitDetail } from './data';
import { FileContextMenu } from './FileContextMenu';
import { extractWorkTreeFiles } from '../../lib/workTreeFiles';
import type { FileKind } from '../../lib/fileKind';
import { classifyFile, colorForKind, labelForKind } from '../../lib/fileKind';
import { LensHeader } from './LensHeader';
import {
  EmptyStateCard,
  type LensEmptyReason,
  type EmptyStateMessage,
} from './EmptyStateCard';
import type { LensId } from './LensSwitcher';
import {
  buildCosmos,
  type SpacePoint,
  type SpacePointInput,
} from './cosmosUtils';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';

// PulseCosmosStage を React.lazy で遅延ロード (Three.js 一式を分割)
const CosmosStage = lazy(() => import('./PulseCosmosStage'));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MAX_COMMITS = 30;
const HIGHLIGHT_MS = 4000;
const NEW_FILE_MS = 3500;
const RECENT_CHANGES_MAX = 30;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// 上位 2 セグメントでグループ化。ルート直下は (root)
function topGroupForPath(path: string): string {
  const parts = path.split('/').filter((s) => s.length > 0);
  if (parts.length <= 1) return '(root)';
  if (parts.length === 2) return parts[0];
  return `${parts[0]}/${parts[1]}`;
}

function relativeTime(iso: string): string {
  if (!iso) return '';
  try {
    const diff = Date.now() - new Date(iso).getTime();
    const secs = Math.floor(diff / 1000);
    if (secs < 5) return 'just now';
    if (secs < 60) return `${secs}s`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  } catch {
    return '';
  }
}

function statusGlyph(status: string): string {
  switch (status) {
    case 'A': return '＋';
    case 'D': return '−';
    case 'R': return '↦';
    default:  return '·';
  }
}

/**
 * statusGlyph (装飾) の代わりに SR が読み上げる自然語ラベル。
 */
function statusName(status: string): string {
  switch (status) {
    case 'A': return '追加';
    case 'D': return '削除';
    case 'M': return '変更';
    case 'R': return '名前変更';
    case 'C': return 'コピー';
    default:  return status || '変更';
  }
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
type FileStat = {
  path: string;
  basename: string;
  parentDir: string;
  topGroup: string;
  kind: FileKind;
  commitCount: number;
  totalAdded: number;
  totalDeleted: number;
  lastSeenHash: string;
  lastSeenShortHash: string;
  lastSeenSubject: string;
  lastSeenTime: string;
  lastStatus: string;
  highlightedUntil: number;
  isNewFile: boolean;
  appearedAt: number;
  isWorkingTree: boolean;
};

type RecentEntry = {
  id: string;
  path: string;
  basename: string;
  parentDir: string;
  status: string;
  kind: FileKind;
  added: number;
  deleted: number;
  commitHash: string;
  commitShortHash: string;
  subject: string;
  time: string;
  isWorkingTree: boolean;
};

const WORKING_TREE_HASH = 'WORKING-TREE';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------
export type PulseLensProps = {
  repoId: string | null;
  commits: Commit[];
  selectedCommitHash: string | null;
  onSelectCommit: (hash: string) => void;
  onOpenFileHistory?: (path: string) => void;
  workTree?: WorkTreeResponse | null;
  paused?: boolean;
  /**
   * SSE 接続状態。"connected" 以外で live dot をグレー/赤に切替し、
   * 切断バナーを表示する (Rescue PR #37 と同パターン)。
   */
  eventStatus?: 'connecting' | 'connected' | 'error';
  /** 他 Lens への遷移 (EmptyStateCard relatedLenses 用) */
  onChangeLens?: (lens: LensId) => void;
};

// ---------------------------------------------------------------------------
// Help content + i18n labels
// ---------------------------------------------------------------------------

const KIND_LABEL_JA: Record<FileKind, string> = {
  code: 'コード',
  style: 'スタイル',
  config: '設定',
  markup: 'マークアップ',
  docs: 'ドキュメント',
  test: 'テスト',
  asset: 'アセット',
  other: 'その他',
};

const KIND_TOOLTIP_JA: Record<FileKind, string> = {
  code: 'TypeScript / JavaScript / Python 等のソースコード',
  style: 'CSS / SCSS / Tailwind 等のスタイル',
  config: 'package.json / vite.config.ts 等の設定',
  markup: 'HTML / Vue / Astro 等のマークアップ',
  docs: 'Markdown / README 等のドキュメント',
  test: '.test.* / .spec.* 等のテスト',
  asset: '画像 / フォント / バイナリ等のアセット',
  other: '分類されないファイル',
};

function labelForKindJa(k: FileKind): string {
  return KIND_LABEL_JA[k] ?? labelForKind(k);
}

function kindTooltip(k: FileKind): string {
  return KIND_TOOLTIP_JA[k] ?? '';
}

function PulseHelpContent() {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: 'var(--rs-text)' }}>
        Pulse Lens とは
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        コードベースの<strong>今の鼓動</strong>を 3D 宇宙で可視化する Lens。
        1 カード = 1 ファイル。ログ的な「Activity」ではなく、リポジトリが今動いている感覚を映します。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        カードの読み方
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
        ・<strong>1 カード = 1 ファイル</strong><br />
        ・<strong>位置</strong> = ハッシュ由来の固定座標 (X/Y) + 鮮度 (Z: 手前=新)<br />
        ・<strong>色 = 変更量</strong> (added + deleted の log スケール: 青=軽微 / 緑=小 / 黄=中 / 橙=大 / 赤=巨大)<br />
        ・<strong>不透明度 = 鮮度</strong>（古いほど霧化、6 時間で最小）<br />
        ・<strong>金枠 + 拡大</strong> = 5 分以内に更新<br />
        ・カードのアクセント帯（左縦線）= ファイル種別 (kind)
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        対象データ
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8 }}>
        <strong>直近 {MAX_COMMITS} commits + working tree</strong> の変更を 3D カード化。
        累計 +N / -N も同じ範囲の合計です。
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        live indicator
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', marginBottom: 8, lineHeight: 1.7 }}>
        ・<span style={{ color: '#22c55e' }}>緑パルス</span>: SSE 接続中 (リアルタイム取り込み)<br />
        ・<span style={{ color: 'var(--rs-text-muted)' }}>グレー</span>: 接続中… または 一時停止<br />
        ・<span style={{ color: '#ef4444' }}>赤</span>: 切断 (新しい変更は記録されません)
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, color: 'var(--rs-text)' }}>
        操作
      </div>
      <div style={{ color: 'var(--rs-text-secondary)' }}>
        ・<strong>左ドラッグ</strong>で回転<br />
        ・<strong>右ドラッグ</strong>でパン<br />
        ・<strong>ホイール</strong>でズーム<br />
        ・カード<strong>クリック</strong> → ファイル履歴を開く<br />
        ・カード<strong>右クリック</strong> → コンテキストメニュー<br />
        ・右側の "Recent changes" リスト → コミット選択
      </div>

      <div style={{ fontWeight: 600, marginBottom: 4, marginTop: 8, color: 'var(--rs-text)' }}>
        凡例 (kind アクセント帯)
      </div>
      <div style={{ color: 'var(--rs-text-secondary)', fontSize: 11 }}>
        カード左端の縦帯がファイル種別 (kind) を示します。色は下記の凡例と同じです。
      </div>
    </>
  );
}

const PULSE_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  ['pulse-quiet' as LensEmptyReason]: {
    title: '鼓動を待っています',
    body:
      'コミットや working tree の変更がまだ観測されていません。リポジトリで何か作業が起きるとカードが現れます。別の Lens で別の観点を確認するか、しばらく待ってみてください。',
  },
};

// ---------------------------------------------------------------------------
// PulseLens main
// ---------------------------------------------------------------------------
export function PulseLens({
  repoId,
  commits,
  selectedCommitHash,
  onSelectCommit,
  onOpenFileHistory,
  workTree,
  paused = false,
  eventStatus,
  onChangeLens,
}: PulseLensProps) {
  // ---- Detail cache (per-commit file lists) -----------------------------
  const [detailCache, setDetailCache] = useState<Map<string, CommitDetail>>(
    () => new Map(),
  );

  // ---- File statistics ---------------------------------------------------
  const [statistics, setStatistics] = useState<Map<string, FileStat>>(
    () => new Map(),
  );

  const processedHashesRef = useRef<Set<string>>(new Set());

  // Map<untracked-path, first-observed-timestamp>
  const untrackedFirstSeenRef = useRef<Map<string, number>>(new Map());

  // ---- Right-click context menu ----------------------------------------
  const [menuState, setMenuState] = useState<{ x: number; y: number; path: string } | null>(null);

  const handleContextMenu = useCallback(
    (event: ReactMouseEvent | MouseEvent, path: string) => {
      const e = event as MouseEvent;
      setMenuState({ x: e.clientX, y: e.clientY, path });
    },
    [],
  );

  // Three.js の onContextMenu イベント経由 (nativeEvent を使う)
  const handleContextMenuPoint = useCallback(
    (nativeEvent: MouseEvent, key: string) => {
      // key は path と同一
      setMenuState({ x: nativeEvent.clientX, y: nativeEvent.clientY, path: key });
    },
    [],
  );

  // ---- prefers-reduced-motion ------------------------------------------
  const reducedMotion = useMemo(
    () =>
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  // ---- now ドリフト (30 秒インターバル + データ変化時即時更新) -----------
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  // commits / detailCache / workTree 変化時に即時更新
  useEffect(() => {
    setNow(Date.now());
  }, [commits, detailCache, workTree]);

  // ---- nowMs for summary (800ms 更新で hot カウント正確化) ---------------
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 800);
    return () => window.clearInterval(id);
  }, []);

  // ---- Fetch commit details on demand -----------------------------------
  useEffect(() => {
    if (!repoId) return;
    const sliced = commits.slice(0, MAX_COMMITS);
    for (const c of sliced) {
      if (detailCache.has(c.hash)) continue;
      void (async () => {
        try {
          const detail = await getCommit(repoId, c.hash);
          setDetailCache((prev) => {
            if (prev.has(c.hash)) return prev;
            const next = new Map(prev);
            next.set(c.hash, detail);
            return next;
          });
        } catch {
          // Non-critical — card will appear once data lands
        }
      })();
    }
  }, [commits, repoId, detailCache]);

  // ---- Update statistics when commits/details flow in ------------------
  useEffect(() => {
    const sliced = commits.slice(0, MAX_COMMITS);
    const t = Date.now();

    setStatistics((prevStats) => {
      const next = new Map(prevStats);
      for (const commit of sliced) {
        const detail = detailCache.get(commit.hash);
        if (!detail) continue;
        if (processedHashesRef.current.has(commit.hash)) continue;

        const shortHash = commit.shortHash ?? commit.hash.slice(0, 7);
        for (const file of detail.files) {
          const path = file.path;
          const existing = next.get(path);
          if (existing) {
            next.set(path, {
              ...existing,
              commitCount: existing.commitCount + 1,
              totalAdded: existing.totalAdded + (file.added ?? 0),
              totalDeleted: existing.totalDeleted + (file.deleted ?? 0),
              lastSeenHash: commit.hash,
              lastSeenShortHash: shortHash,
              lastSeenSubject: commit.subject,
              lastSeenTime: commit.time,
              lastStatus: file.status,
              highlightedUntil: t + HIGHLIGHT_MS,
              isWorkingTree: false,
            });
          } else {
            const slash = path.lastIndexOf('/');
            next.set(path, {
              path,
              basename: slash === -1 ? path : path.slice(slash + 1),
              parentDir: slash === -1 ? '' : path.slice(0, slash),
              topGroup: topGroupForPath(path),
              kind: classifyFile(path),
              commitCount: 1,
              totalAdded: file.added ?? 0,
              totalDeleted: file.deleted ?? 0,
              lastSeenHash: commit.hash,
              lastSeenShortHash: shortHash,
              lastSeenSubject: commit.subject,
              lastSeenTime: commit.time,
              lastStatus: file.status,
              highlightedUntil: t + HIGHLIGHT_MS,
              isNewFile: true,
              appearedAt: t,
              isWorkingTree: false,
            });
          }
        }
        processedHashesRef.current.add(commit.hash);
      }
      return next;
    });
  }, [commits, detailCache]);

  // ---- Merge working-tree changes into rendering ------------------------
  const mergedStats = useMemo<Map<string, FileStat>>(() => {
    const wtFiles = extractWorkTreeFiles(workTree);
    if (wtFiles.length === 0) {
      untrackedFirstSeenRef.current.clear();
      return statistics;
    }

    type WtAgg = {
      added: number;
      deleted: number;
      status: string;
      isUntracked: boolean;
    };
    const wtByPath = new Map<string, WtAgg>();
    for (const f of wtFiles) {
      const ex = wtByPath.get(f.path);
      const fileIsUntracked = f.section === 'untracked';
      if (ex) {
        wtByPath.set(f.path, {
          added: ex.added + f.added,
          deleted: ex.deleted + f.deleted,
          status: ex.status,
          isUntracked: ex.isUntracked || fileIsUntracked,
        });
      } else {
        wtByPath.set(f.path, {
          added: f.added,
          deleted: f.deleted,
          status: f.status,
          isUntracked: fileIsUntracked,
        });
      }
    }

    const t = Date.now();
    const currentUntracked = new Set<string>();
    for (const [path, agg] of wtByPath) {
      if (!agg.isUntracked) continue;
      currentUntracked.add(path);
      if (!untrackedFirstSeenRef.current.has(path)) {
        untrackedFirstSeenRef.current.set(path, t);
      }
    }
    for (const path of [...untrackedFirstSeenRef.current.keys()]) {
      if (!currentUntracked.has(path)) {
        untrackedFirstSeenRef.current.delete(path);
      }
    }

    const merged = new Map<string, FileStat>(statistics);
    const snapshot = workTree?.snapshotAt ?? '';

    for (const [path, agg] of wtByPath) {
      const existing = merged.get(path);
      const firstSeen = agg.isUntracked
        ? untrackedFirstSeenRef.current.get(path)
        : undefined;
      const isFreshUntracked =
        firstSeen !== undefined && t - firstSeen < NEW_FILE_MS;

      if (existing) {
        merged.set(path, {
          ...existing,
          commitCount: existing.commitCount + 1,
          totalAdded: existing.totalAdded + agg.added,
          totalDeleted: existing.totalDeleted + agg.deleted,
          lastSeenHash: WORKING_TREE_HASH,
          lastSeenShortHash: 'WT',
          lastSeenSubject: 'Working tree (uncommitted)',
          lastSeenTime: snapshot,
          lastStatus: agg.status,
          isWorkingTree: true,
        });
      } else {
        const slash = path.lastIndexOf('/');
        merged.set(path, {
          path,
          basename: slash === -1 ? path : path.slice(slash + 1),
          parentDir: slash === -1 ? '' : path.slice(0, slash),
          topGroup: topGroupForPath(path),
          kind: classifyFile(path),
          commitCount: 1,
          totalAdded: agg.added,
          totalDeleted: agg.deleted,
          lastSeenHash: WORKING_TREE_HASH,
          lastSeenShortHash: 'WT',
          lastSeenSubject: 'Working tree (uncommitted)',
          lastSeenTime: snapshot,
          lastStatus: agg.status,
          highlightedUntil: isFreshUntracked ? t + HIGHLIGHT_MS : 0,
          isNewFile: isFreshUntracked,
          appearedAt: firstSeen ?? 0,
          isWorkingTree: true,
        });
      }
    }
    return merged;
  }, [statistics, workTree]);

  // ---- buildCosmos 入力を生成 (useMemo) ---------------------------------
  const cosmosInputs = useMemo<SpacePointInput[]>(() => {
    const inputs: SpacePointInput[] = [];
    for (const stat of mergedStats.values()) {
      // lastSeenTime → epoch ms
      let ts = now;
      if (stat.lastSeenTime) {
        try {
          const parsed = new Date(stat.lastSeenTime).getTime();
          if (!isNaN(parsed)) ts = parsed;
        } catch {
          /* フォールバック: now */
        }
      }
      inputs.push({
        key: stat.path,
        groupKey: stat.topGroup,
        ts,
        basename: stat.basename,
        parentDir: stat.parentDir,
        subject: stat.lastSeenSubject || 'No commit message',
        meta: {
          shortHash: stat.lastSeenShortHash,
          added: stat.totalAdded,
          deleted: stat.totalDeleted,
          status: stat.lastStatus || '·',
          kind: stat.kind,
          isWorkingTree: stat.isWorkingTree,
        },
      });
    }
    return inputs;
  }, [mergedStats, now]);

  // ---- SpacePoint 配列 (buildCosmos, useMemo) ---------------------------
  const spacePoints = useMemo<SpacePoint[]>(
    () => buildCosmos(cosmosInputs, now),
    [cosmosInputs, now],
  );

  // ---- Recent changes feed ---------------------------------------------
  const recentEntries = useMemo<RecentEntry[]>(() => {
    const out: RecentEntry[] = [];

    const wtFiles = extractWorkTreeFiles(workTree);
    if (wtFiles.length > 0) {
      for (const f of wtFiles) {
        out.push({
          id: `wt::${f.section}::${f.path}`,
          path: f.path,
          basename: f.basename,
          parentDir: f.parentDir,
          status: f.status,
          kind: classifyFile(f.path),
          added: f.added,
          deleted: f.deleted,
          commitHash: WORKING_TREE_HASH,
          commitShortHash: f.section === 'staged' ? 'STAGED' : 'UNSTAGED',
          subject: f.section === 'staged' ? 'Staged' : 'Unstaged',
          time: workTree?.snapshotAt ?? new Date().toISOString(),
          isWorkingTree: true,
        });
        if (out.length >= RECENT_CHANGES_MAX) break;
      }
    }

    if (out.length < RECENT_CHANGES_MAX) {
      const sliced = commits.slice(0, MAX_COMMITS);
      for (const commit of sliced) {
        const detail = detailCache.get(commit.hash);
        if (!detail) continue;
        const shortHash = commit.shortHash ?? commit.hash.slice(0, 7);
        for (const file of detail.files) {
          const slash = file.path.lastIndexOf('/');
          out.push({
            id: `${commit.hash}::${file.path}`,
            path: file.path,
            basename: slash === -1 ? file.path : file.path.slice(slash + 1),
            parentDir: slash === -1 ? '' : file.path.slice(0, slash),
            status: file.status,
            kind: classifyFile(file.path),
            added: file.added ?? 0,
            deleted: file.deleted ?? 0,
            commitHash: commit.hash,
            commitShortHash: shortHash,
            subject: commit.subject,
            time: commit.time,
            isWorkingTree: false,
          });
          if (out.length >= RECENT_CHANGES_MAX) break;
        }
        if (out.length >= RECENT_CHANGES_MAX) break;
      }
    }

    return out.slice(0, RECENT_CHANGES_MAX);
  }, [workTree, commits, detailCache]);

  // ---- Activity Ticker — リアルタイム俯瞰用の最近の新着ピル群 -----------
  // recentEntries が一度でも観測された時刻を記録し、TICKER_LIFE_MS 以内のものを
  // 上部にピル表示する。time フィールドだと commit.time が author date になり
  // 「ファイルが画面に出現した瞬間」とずれるため、独立 ledger を使う。
  const TICKER_LIFE_MS = 8000;
  const tickerObservedAtRef = useRef<Map<string, number>>(new Map());

  useEffect(() => {
    const t = Date.now();
    const seen = tickerObservedAtRef.current;
    const currentIds = new Set<string>();
    for (const e of recentEntries) {
      currentIds.add(e.id);
      if (!seen.has(e.id)) seen.set(e.id, t);
    }
    // 消えた id を ledger からも除去（メモリリーク防止）
    for (const id of [...seen.keys()]) {
      if (!currentIds.has(id)) seen.delete(id);
    }
  }, [recentEntries]);

  const newlyArrived = useMemo<RecentEntry[]>(() => {
    const cutoff = nowMs - TICKER_LIFE_MS;
    const seen = tickerObservedAtRef.current;
    return recentEntries
      .filter((e) => (seen.get(e.id) ?? 0) >= cutoff)
      .slice(0, 5);
  }, [recentEntries, nowMs]);

  // ---- カードクリック — 詳細モーダルを開く -----------------------------
  // 旧実装は onOpenFileHistory or onSelectCommit を直接呼んでいたが、
  // クリックで情報を一度見せてからユーザにアクションを選ばせる UX に変更。
  const [detailPoint, setDetailPoint] = useState<SpacePoint | null>(null);

  const handlePick = useCallback((point: SpacePoint) => {
    setDetailPoint(point);
  }, []);

  // shortHash → フルハッシュ逆引き。working tree や見つからない場合は null。
  const resolveFullHash = useCallback(
    (point: SpacePoint): string | null => {
      if (point.meta.isWorkingTree || point.meta.shortHash === 'WT') return null;
      const fullHash = commits.find(
        (c) =>
          (c.shortHash ?? c.hash.slice(0, 7)) === point.meta.shortHash ||
          c.hash.startsWith(point.meta.shortHash),
      )?.hash;
      return fullHash ?? null;
    },
    [commits],
  );

  const handleDetailOpenHistory = useCallback(() => {
    if (!detailPoint) return;
    onOpenFileHistory?.(detailPoint.key);
    setDetailPoint(null);
  }, [detailPoint, onOpenFileHistory]);

  const handleDetailSelectCommit = useCallback(() => {
    if (!detailPoint) return;
    const fullHash = resolveFullHash(detailPoint);
    if (fullHash) {
      onSelectCommit(fullHash);
      setDetailPoint(null);
    }
  }, [detailPoint, resolveFullHash, onSelectCommit]);

  // ---- Header summary ---------------------------------------------------
  const summary = useMemo(() => {
    let added = 0;
    let deleted = 0;
    let hotCount = 0;
    let workingTreeCount = 0;
    for (const stat of mergedStats.values()) {
      added += stat.totalAdded;
      deleted += stat.totalDeleted;
      if (nowMs < stat.highlightedUntil) hotCount += 1;
      if (stat.isWorkingTree) workingTreeCount += 1;
    }
    return {
      files: mergedStats.size,
      added,
      deleted,
      hotCount,
      workingTreeCount,
      commits: Math.min(commits.length, MAX_COMMITS),
    };
  }, [mergedStats, commits.length, nowMs]);

  // ---- Empty state ------------------------------------------------------
  if (commits.length === 0 && summary.workingTreeCount === 0) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          background: 'var(--rs-bg-canvas)',
        }}
      >
        <LensHeader
          title="Pulse"
          oneLiner="コードベースの今の鼓動 — ファイル変更を 3D 宇宙で可視化"
          helpContent={<PulseHelpContent />}
        />
        <EmptyStateCard
          reason={'pulse-quiet' as LensEmptyReason}
          messages={PULSE_EMPTY_MESSAGES}
          onChangeLens={onChangeLens}
          relatedLenses={
            onChangeLens
              ? [
                  { id: 'stream', label: 'File Stream を開く' },
                  { id: 'hotspot', label: 'Hotspot を開く' },
                  { id: 'digest', label: 'Digest を開く' },
                ]
              : undefined
          }
        />
      </div>
    );
  }

  // ---- live dot 状態 (eventStatus + paused) -----------------------------
  const dotState: 'connected' | 'connecting' | 'error' | 'paused' = paused
    ? 'paused'
    : eventStatus ?? 'connected';

  const dotColor =
    dotState === 'connected'
      ? '#22c55e'
      : dotState === 'error'
        ? '#ef4444'
        : 'var(--rs-text-muted)';
  const dotAriaLabel =
    dotState === 'connected'
      ? '接続中: 新しい変更をリアルタイムで取り込んでいます'
      : dotState === 'connecting'
        ? '接続中…'
        : dotState === 'error'
          ? '接続が途切れています'
          : '一時停止中';

  const showStatusBanner =
    dotState === 'error' || dotState === 'paused' || dotState === 'connecting';

  return (
    <div className="rs-pulse-root">
      <style>{PULSE_STYLES}</style>

      {/* Row 1: LensHeader (title + oneLiner + ? Popover) */}
      <LensHeader
        title="Pulse"
        oneLiner="コードベースの今の鼓動 — ファイル変更を 3D 宇宙で可視化"
        helpContent={<PulseHelpContent />}
      />

      {/* Row 2: live indicator + counts + legend (legacy stats bar) */}
      <header className="rs-pulse-header">
        <span className="rs-pulse-header__indicator" aria-hidden="true">
          <span
            className={
              dotState === 'connected'
                ? 'rs-pulse-header__dot'
                : 'rs-pulse-header__dot rs-pulse-header__dot--static'
            }
            style={{ background: dotColor }}
          />
        </span>
        <span
          role="status"
          aria-live="polite"
          className="rs-pulse-header__live-label"
          aria-label={dotAriaLabel}
        >
          <span aria-hidden="true">
            {dotState === 'connected'
              ? 'live'
              : dotState === 'connecting'
                ? 'connecting…'
                : dotState === 'error'
                  ? 'offline'
                  : 'paused'}
          </span>
        </span>
        <span className="rs-pulse-header__divider" aria-hidden="true" />
        <span className="rs-pulse-header__stat">
          <strong>{summary.files.toLocaleString()}</strong> files
        </span>
        <span className="rs-pulse-header__stat">
          <strong>{summary.commits.toLocaleString()}</strong> commits
          <span aria-hidden="true" style={{ color: 'var(--rs-text-muted)', marginLeft: 4, fontSize: 10 }}>
            / {MAX_COMMITS} max
          </span>
        </span>
        <span
          className="rs-pulse-header__diff"
          title="直近 30 commits + working tree の累計追加 / 削除行数"
        >
          <span aria-hidden="true" style={{ color: '#22c55e' }}>+{summary.added.toLocaleString()}</span>
          <span className="sr-only">{summary.added.toLocaleString()} lines added</span>
          <span aria-hidden="true" style={{ color: '#ef4444' }}>−{summary.deleted.toLocaleString()}</span>
          <span className="sr-only">{summary.deleted.toLocaleString()} lines deleted</span>
        </span>
        {summary.hotCount > 0 && (
          <span
            className="rs-pulse-header__hot"
            title={`直近 ${Math.round(HIGHLIGHT_MS / 1000)} 秒以内に変更されたファイル数`}
          >
            {summary.hotCount} hot
          </span>
        )}
        {summary.workingTreeCount > 0 && (
          <span
            className="rs-pulse-header__wt"
            title="working tree の未コミット変更ファイル数"
          >
            {summary.workingTreeCount} uncommitted
          </span>
        )}

        <div className="rs-pulse-header__legend" aria-label="ファイル種別の凡例">
          {(['code', 'style', 'config', 'markup', 'docs', 'test', 'asset'] as const).map((k) => (
            <span
              key={k}
              className="rs-pulse-header__legend-item"
              title={kindTooltip(k)}
            >
              <span
                className="rs-pulse-header__legend-dot"
                style={{ background: colorForKind(k) }}
                aria-hidden="true"
              />
              <span>{labelForKindJa(k)}</span>
            </span>
          ))}
        </div>
      </header>

      {/* Activity Ticker — 直近 8 秒以内に観測した新着を右から流れるピルで表示。
          画面のどこかに目を向けていても変更検知に気づける。 */}
      {newlyArrived.length > 0 && (
        <div
          className="rs-pulse-ticker"
          role="status"
          aria-live="polite"
          aria-label="Recent changes"
        >
          <span className="rs-pulse-ticker__caption" aria-hidden="true">
            ✦ live
          </span>
          {newlyArrived.map((entry) => (
            <span key={entry.id} className="rs-pulse-ticker__item">
              <span
                className="rs-pulse-ticker__dot"
                style={{ background: colorForKind(entry.kind) }}
                aria-hidden="true"
              />
              <span className="rs-pulse-ticker__status" aria-hidden="true">
                {statusGlyph(entry.status)}
              </span>
              <span className="rs-pulse-ticker__path" title={entry.path}>
                {entry.path}
              </span>
              <span className="rs-pulse-ticker__diff">
                <span style={{ color: 'var(--rs-git-added)' }}>+{entry.added}</span>
                <span style={{ color: 'var(--rs-git-deleted)' }}>−{entry.deleted}</span>
              </span>
            </span>
          ))}
        </div>
      )}

      {showStatusBanner && (
        <div
          role="status"
          aria-live="polite"
          className="rs-pulse-status-banner"
          style={{
            padding: '6px 16px',
            fontSize: 11,
            fontFamily: 'var(--rs-sans)',
            color:
              dotState === 'error'
                ? '#ef4444'
                : dotState === 'paused'
                  ? 'var(--rs-text-secondary)'
                  : 'var(--rs-text-muted)',
            background:
              dotState === 'error'
                ? 'color-mix(in oklab, var(--rs-bg-elevated), #ef4444 12%)'
                : 'var(--rs-bg-elevated)',
            borderBottom: '1px solid var(--rs-border)',
          }}
        >
          {dotState === 'error'
            ? '⚠ 接続が途切れています — 新しい変更は記録されていません。'
            : dotState === 'paused'
              ? 'Paused — 新しい変更の取り込みを停止しています。'
              : 'Connecting — サーバーに接続しています…'}
        </div>
      )}

      {reducedMotion && (
        <div
          className="rs-pulse-reduced-motion-note"
          style={{
            padding: '4px 16px',
            fontSize: 10,
            fontFamily: 'var(--rs-sans)',
            color: 'var(--rs-text-muted)',
            background: 'var(--rs-bg-elevated)',
            borderBottom: '1px solid var(--rs-border)',
          }}
        >
          Reduced motion: カードアニメーションを抑制しています (Lens は動作中)。
        </div>
      )}

      {/* Body: 3D stage (left) + sidebar (right) */}
      <div className="rs-pulse-body">
        <div
          className="rs-pulse-stage"
          role="region"
          aria-label="Codebase pulse 3D cosmos field"
          style={{
            background:
              'radial-gradient(ellipse at 60% 40%, #0a1040 0%, #000814 70%)',
          }}
        >
          {/* React.lazy でロードされる 3D ステージ */}
          <Suspense
            fallback={
              <div className="rs-pulse-stage__empty">
                Loading 3D field…
              </div>
            }
          >
            <CosmosStage
              points={spacePoints}
              selectedCommitHash={selectedCommitHash}
              reducedMotion={reducedMotion}
              onPick={handlePick}
              onContextMenuPoint={handleContextMenuPoint}
            />
          </Suspense>

          {/* Visually-hidden SR live region: surfaces recent file changes for SR users */}
          <ul
            role="status"
            aria-live="polite"
            aria-atomic="false"
            style={{
              position: 'absolute',
              width: 1,
              height: 1,
              padding: 0,
              margin: -1,
              overflow: 'hidden',
              clip: 'rect(0,0,0,0)',
              whiteSpace: 'nowrap',
              border: 0,
            }}
          >
            {recentEntries.slice(0, 5).map((entry) => (
              <li key={`${entry.commitHash ?? 'wt'}:${entry.path}`}>
                {entry.isWorkingTree ? '未コミット' : entry.commitHash?.slice(0, 7)}{' '}
                {entry.path} (+{entry.added ?? 0} / -{entry.deleted ?? 0})
              </li>
            ))}
          </ul>
        </div>

        {/* Recent changes — right sidebar */}
        <aside className="rs-pulse-sidebar" aria-label="Recent changes">
          <div className="rs-pulse-recent" aria-label="Recent changes">
            <div className="rs-pulse-recent__title">Recent changes</div>
            <ul className="rs-pulse-recent__list">
              {recentEntries.length === 0 ? (
                <li className="rs-pulse-recent__empty">No recent changes</li>
              ) : (
                recentEntries.map((entry) => {
                  const isSelected =
                    !entry.isWorkingTree && entry.commitHash === selectedCommitHash;
                  return (
                    <li
                      key={entry.id}
                      className={
                        isSelected
                          ? 'rs-pulse-recent__row rs-pulse-recent__row--selected'
                          : 'rs-pulse-recent__row'
                      }
                    >
                      <button
                        type="button"
                        className="rs-pulse-recent__btn"
                        onClick={() => {
                          if (entry.isWorkingTree) return;
                          onSelectCommit(entry.commitHash);
                        }}
                        onContextMenu={(e: ReactMouseEvent) => {
                          e.preventDefault();
                          handleContextMenu(e, entry.path);
                        }}
                        title={`${entry.path}\n${entry.subject}`}
                        aria-label={`${statusName(entry.status)}: ${entry.path}${entry.isWorkingTree ? ' (working tree)' : ` — ${entry.subject}`}`}
                        aria-disabled={entry.isWorkingTree}
                        disabled={entry.isWorkingTree}
                      >
                        <span
                          className="rs-pulse-recent__dot"
                          style={{ background: colorForKind(entry.kind) }}
                          aria-hidden="true"
                        />
                        <span className="rs-pulse-recent__status" aria-hidden="true">
                          {statusGlyph(entry.status)}
                        </span>
                        <span className="rs-pulse-recent__path">
                          {entry.parentDir && (
                            <span className="rs-pulse-recent__parent">{entry.parentDir}/</span>
                          )}
                          <span className="rs-pulse-recent__base">{entry.basename}</span>
                        </span>
                        <span className="rs-pulse-recent__diff">
                          <span style={{ color: '#22c55e' }}>+{entry.added}</span>
                          <span style={{ color: '#ef4444' }}>−{entry.deleted}</span>
                        </span>
                        <span className="rs-pulse-recent__time">
                          {entry.isWorkingTree ? entry.commitShortHash : relativeTime(entry.time)}
                        </span>
                      </button>
                    </li>
                  );
                })
              )}
            </ul>
          </div>
        </aside>
      </div>

      {/* Right-click context menu (open file history etc.) */}
      <FileContextMenu
        open={menuState !== null}
        x={menuState?.x ?? 0}
        y={menuState?.y ?? 0}
        path={menuState?.path ?? null}
        onClose={() => setMenuState(null)}
        onOpenHistory={(p) => {
          onOpenFileHistory?.(p);
        }}
      />

      {/* カードクリックで開く詳細モーダル */}
      <PulseDetailDialog
        point={detailPoint}
        onClose={() => setDetailPoint(null)}
        onOpenHistory={handleDetailOpenHistory}
        onSelectCommit={handleDetailSelectCommit}
        canSelectCommit={detailPoint ? resolveFullHash(detailPoint) !== null : false}
        canOpenHistory={Boolean(onOpenFileHistory)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PulseDetailDialog — カードクリックで開く詳細モーダル
//   refscope の Dialog primitive (Radix) を使い、トークンに溶け込ませる。
// ---------------------------------------------------------------------------
type PulseDetailDialogProps = {
  point: SpacePoint | null;
  onClose: () => void;
  onOpenHistory: () => void;
  onSelectCommit: () => void;
  canSelectCommit: boolean;
  canOpenHistory: boolean;
};

function PulseDetailDialog({
  point,
  onClose,
  onOpenHistory,
  onSelectCommit,
  canSelectCommit,
  canOpenHistory,
}: PulseDetailDialogProps) {
  const isOpen = point !== null;
  const isoTime = point ? new Date(point.ts).toISOString() : '';
  const kindLabel = point ? labelForKind(point.meta.kind) : '';
  const kindColor = point ? colorForKind(point.meta.kind) : 'transparent';

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        className="sm:max-w-2xl"
        style={{
          background: 'var(--rs-bg-panel)',
          border: '1px solid var(--rs-border)',
          color: 'var(--rs-text-primary)',
          fontFamily: 'var(--rs-sans)',
        }}
      >
        <DialogHeader>
          <DialogTitle
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              fontSize: 15,
              color: 'var(--rs-text-primary)',
              fontFamily: 'var(--rs-mono)',
            }}
          >
            <span
              aria-hidden="true"
              style={{
                width: 10,
                height: 10,
                borderRadius: 2,
                background: kindColor,
                flexShrink: 0,
              }}
            />
            <span style={{ wordBreak: 'break-all' }}>
              {point?.basename ?? ''}
            </span>
            {point?.isFresh && (
              <span
                style={{
                  fontSize: 10,
                  fontFamily: 'var(--rs-sans)',
                  fontWeight: 700,
                  padding: '2px 6px',
                  borderRadius: 999,
                  color: 'var(--rs-warning)',
                  background:
                    'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 18%)',
                  border:
                    '1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 45%)',
                  letterSpacing: 0.5,
                }}
              >
                ✦ NEW
              </span>
            )}
          </DialogTitle>
          <DialogDescription
            style={{
              fontFamily: 'var(--rs-mono)',
              color: 'var(--rs-text-secondary)',
              fontSize: 11,
              wordBreak: 'break-all',
            }}
          >
            {point?.parentDir || '(root)'}
          </DialogDescription>
        </DialogHeader>

        {point && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* commit subject */}
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: 'var(--rs-text-primary)',
                padding: '10px 12px',
                background: 'var(--rs-bg-elevated)',
                border: '1px solid var(--rs-border)',
                borderRadius: 'var(--rs-radius-sm)',
              }}
            >
              {point.subject}
            </div>

            {/* metadata grid */}
            <dl
              style={{
                margin: 0,
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                rowGap: 6,
                columnGap: 12,
                fontSize: 12,
              }}
            >
              <DetailRow label="状態">
                {statusName(point.meta.status)}{' '}
                <span style={{ color: 'var(--rs-text-muted)' }}>
                  ({point.meta.status})
                </span>
              </DetailRow>
              <DetailRow label="種別">
                <span style={{ color: 'var(--rs-text-secondary)' }}>
                  {kindLabel}
                </span>
              </DetailRow>
              <DetailRow label="差分">
                <span
                  style={{
                    fontFamily: 'var(--rs-mono)',
                    color: 'var(--rs-git-added)',
                    marginRight: 8,
                  }}
                >
                  +{point.meta.added}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--rs-mono)',
                    color: 'var(--rs-git-deleted)',
                  }}
                >
                  −{point.meta.deleted}
                </span>
              </DetailRow>
              <DetailRow label="コミット">
                <span style={{ fontFamily: 'var(--rs-mono)' }}>
                  {point.meta.shortHash}
                </span>
                {point.meta.isWorkingTree && (
                  <span
                    style={{
                      marginLeft: 6,
                      color: 'var(--rs-warning)',
                      fontSize: 11,
                    }}
                  >
                    (working tree)
                  </span>
                )}
              </DetailRow>
              <DetailRow label="時刻">
                <span
                  style={{
                    fontFamily: 'var(--rs-mono)',
                    color: 'var(--rs-text-secondary)',
                  }}
                  title={isoTime}
                >
                  {relativeTime(isoTime)}
                  <span
                    style={{
                      color: 'var(--rs-text-muted)',
                      marginLeft: 6,
                      fontSize: 11,
                    }}
                  >
                    {isoTime ? isoTime.replace('T', ' ').slice(0, 19) : ''}
                  </span>
                </span>
              </DetailRow>
              <DetailRow label="パス">
                <span
                  style={{
                    fontFamily: 'var(--rs-mono)',
                    color: 'var(--rs-text-secondary)',
                    wordBreak: 'break-all',
                  }}
                >
                  {point.key}
                </span>
              </DetailRow>
            </dl>
          </div>
        )}

        <DialogFooter
          style={{
            marginTop: 8,
            display: 'flex',
            gap: 6,
            justifyContent: 'flex-end',
          }}
        >
          <DialogActionButton onClick={onClose} variant="ghost">
            閉じる
          </DialogActionButton>
          <DialogActionButton
            onClick={onSelectCommit}
            disabled={!canSelectCommit}
            variant="secondary"
            title={
              canSelectCommit
                ? 'このコミットを Timeline で選択'
                : 'working tree は Timeline 選択できません'
            }
          >
            コミットを表示
          </DialogActionButton>
          <DialogActionButton
            onClick={onOpenHistory}
            disabled={!canOpenHistory}
            variant="primary"
          >
            ファイル履歴を開く
          </DialogActionButton>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt
        style={{
          color: 'var(--rs-text-muted)',
          fontSize: 11,
          letterSpacing: 0.3,
          whiteSpace: 'nowrap',
        }}
      >
        {label}
      </dt>
      <dd style={{ margin: 0, color: 'var(--rs-text-primary)' }}>
        {children}
      </dd>
    </>
  );
}

function DialogActionButton({
  children,
  onClick,
  disabled,
  title,
  variant,
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  variant: 'primary' | 'secondary' | 'ghost';
}) {
  const styleByVariant: Record<
    'primary' | 'secondary' | 'ghost',
    React.CSSProperties
  > = {
    primary: {
      background:
        'color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 28%)',
      borderColor:
        'color-mix(in oklab, var(--rs-border), var(--rs-accent) 55%)',
      color: 'var(--rs-text-primary)',
    },
    secondary: {
      background: 'var(--rs-bg-elevated)',
      borderColor: 'var(--rs-border)',
      color: 'var(--rs-text-primary)',
    },
    ghost: {
      background: 'transparent',
      borderColor: 'transparent',
      color: 'var(--rs-text-secondary)',
    },
  };
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        ...styleByVariant[variant],
        borderStyle: 'solid',
        borderWidth: 1,
        borderRadius: 'var(--rs-radius-sm)',
        padding: '6px 12px',
        fontSize: 12,
        fontFamily: 'var(--rs-sans)',
        fontWeight: 500,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition:
          'background 120ms ease-out, border-color 120ms ease-out, color 120ms ease-out',
      }}
    >
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Styles — kept inline so the component stays self-contained
// ---------------------------------------------------------------------------
const PULSE_STYLES = `
.rs-pulse-root {
  display: flex;
  flex-direction: column;
  height: 100%;
  background:
    radial-gradient(ellipse at top left,  color-mix(in oklab, var(--rs-bg-canvas), var(--rs-accent) 6%), transparent 55%),
    radial-gradient(ellipse at bottom right, color-mix(in oklab, var(--rs-bg-canvas), #8b5cf6 5%), transparent 60%),
    var(--rs-bg-canvas);
  overflow: hidden;
  font-family: var(--rs-sans, system-ui);
  color: var(--rs-text-primary);
}

.rs-pulse-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  border-bottom: 1px solid var(--rs-border);
  background: color-mix(in oklab, var(--rs-bg-panel), transparent 10%);
  backdrop-filter: blur(6px);
  flex-shrink: 0;
  flex-wrap: wrap;
}
.rs-pulse-header__indicator {
  position: relative;
  width: 12px;
  height: 12px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}
.rs-pulse-header__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #22c55e;
  box-shadow: 0 0 8px #22c55e;
  animation: rs-pulse-dot 1.6s ease-out infinite;
}
@keyframes rs-pulse-dot {
  0%, 100% { transform: scale(1);   opacity: 1; }
  50%      { transform: scale(1.3); opacity: 0.55; }
}
.rs-pulse-header__title {
  font-size: 12px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rs-text-primary);
}
.rs-pulse-header__divider {
  width: 1px;
  height: 14px;
  background: var(--rs-border);
  opacity: 0.6;
}
.rs-pulse-header__stat {
  font-size: 12px;
  color: var(--rs-text-secondary);
}
.rs-pulse-header__stat strong {
  font-family: var(--rs-mono, ui-monospace, monospace);
  color: var(--rs-text-primary);
  font-weight: 700;
  margin-right: 3px;
}
.rs-pulse-header__diff {
  display: inline-flex;
  gap: 6px;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 12px;
  font-weight: 600;
}
.rs-pulse-header__hot {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 2px 7px;
  border-radius: 999px;
  color: #fff;
  background: linear-gradient(120deg, #f97316, #ec4899);
  box-shadow: 0 0 8px color-mix(in oklab, #ec4899, transparent 60%);
  text-transform: uppercase;
}
.rs-pulse-header__wt {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.4px;
  padding: 2px 7px;
  border-radius: 999px;
  color: #f59e0b;
  background: color-mix(in oklab, var(--rs-bg-canvas), #f59e0b 12%);
  border: 1px solid color-mix(in oklab, var(--rs-border), #f59e0b 50%);
  text-transform: uppercase;
}
.rs-pulse-header__legend {
  margin-left: auto;
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
  font-size: 10px;
  color: var(--rs-text-secondary);
}
.rs-pulse-header__legend-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.rs-pulse-header__legend-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.rs-pulse-body {
  display: flex;
  flex-direction: row;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.rs-pulse-stage {
  flex: 1;
  overflow: hidden;
  position: relative;
  min-height: 0;
  min-width: 0;
}
.rs-pulse-stage__empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--rs-text-secondary);
  font-size: 13px;
}

.rs-pulse-sidebar {
  width: 280px;
  flex-shrink: 0;
  border-left: 1px solid var(--rs-border);
  background: color-mix(in oklab, var(--rs-bg-panel), transparent 10%);
  overflow-y: auto;
  overflow-x: hidden;
}

.rs-pulse-recent {
  padding: 8px 16px 10px;
}
.rs-pulse-recent__title {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rs-text-secondary);
  margin-bottom: 4px;
}
.rs-pulse-recent__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.rs-pulse-recent__row {
  display: flex;
  width: 100%;
}
.rs-pulse-recent__row--selected .rs-pulse-recent__btn {
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 18%);
  border-color: color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%);
}
.rs-pulse-recent__btn {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 6px;
  border: 1px solid transparent;
  background: transparent;
  cursor: pointer;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 11px;
  color: var(--rs-text-primary);
  transition: background 120ms ease-out, border-color 120ms ease-out;
  text-align: left;
  min-width: 0;
}
.rs-pulse-recent__btn:hover:not(:disabled) {
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 6%);
  border-color: color-mix(in oklab, var(--rs-border), transparent 30%);
}
.rs-pulse-recent__btn:disabled {
  cursor: default;
  opacity: 0.85;
}
.rs-pulse-recent__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rs-pulse-recent__status {
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 11px;
  width: 12px;
  flex-shrink: 0;
  text-align: center;
  color: var(--rs-text-secondary);
}
.rs-pulse-recent__path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.rs-pulse-recent__parent {
  color: var(--rs-text-secondary);
  opacity: 0.8;
}
.rs-pulse-recent__base {
  font-weight: 600;
  color: var(--rs-text-primary);
}
.rs-pulse-recent__diff {
  display: inline-flex;
  gap: 4px;
  flex-shrink: 0;
  font-family: var(--rs-mono, ui-monospace, monospace);
  font-size: 10px;
  font-weight: 600;
}
.rs-pulse-recent__time {
  flex-shrink: 0;
  font-size: 10px;
  color: var(--rs-text-muted, var(--rs-text-secondary));
  min-width: 32px;
  text-align: right;
}
.rs-pulse-recent__empty {
  font-family: var(--rs-sans, system-ui);
  font-size: 12px;
  color: var(--rs-text-secondary);
  padding: 6px 8px;
}

/* Activity Ticker — リアルタイム俯瞰用の新着ピル */
.rs-pulse-ticker {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 5px 16px;
  background: color-mix(in oklab, var(--rs-bg-panel), transparent 22%);
  border-bottom: 1px solid var(--rs-border);
  overflow-x: hidden;
  min-height: 30px;
  font-family: var(--rs-mono);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
}
.rs-pulse-ticker__caption {
  font-family: var(--rs-sans);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.6px;
  text-transform: uppercase;
  color: var(--rs-warning);
  padding: 1px 7px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-warning) 18%);
  border: 1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 45%);
  flex-shrink: 0;
  animation: rs-pulse-ticker-caption 2.4s ease-in-out infinite;
}
@keyframes rs-pulse-ticker-caption {
  0%, 100% { opacity: 1; transform: scale(1); }
  50%      { opacity: 0.7; transform: scale(0.96); }
}
.rs-pulse-ticker__item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  padding: 3px 9px;
  border-radius: 999px;
  background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 14%);
  border: 1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 35%);
  color: var(--rs-text-primary);
  white-space: nowrap;
  flex-shrink: 0;
  animation: rs-pulse-ticker-in 360ms cubic-bezier(.2,.7,.3,1);
  box-shadow: 0 0 12px color-mix(in oklab, var(--rs-accent), transparent 65%);
}
@keyframes rs-pulse-ticker-in {
  from { opacity: 0; transform: translateX(28px) scale(0.85); }
  to   { opacity: 1; transform: translateX(0) scale(1); }
}
.rs-pulse-ticker__dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}
.rs-pulse-ticker__status {
  color: var(--rs-text-secondary);
  font-size: 10px;
  width: 10px;
  text-align: center;
}
.rs-pulse-ticker__path {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--rs-text-primary);
}
.rs-pulse-ticker__diff {
  display: inline-flex;
  gap: 4px;
  font-weight: 600;
  font-size: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .rs-pulse-header__dot {
    animation: none !important;
  }
  .rs-pulse-ticker__item,
  .rs-pulse-ticker__caption {
    animation: none !important;
  }
}
`;
