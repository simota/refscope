# Hotspot Lens 仕様

| 項目 | 値 |
|---|---|
| Feature ID | `hotspot-lens` |
| Status | `Draft` |
| Scope mode | `Full` (Accord) |
| Audiences | Biz / Dev / Design |
| Owner | Refscope core |
| Version | `0.1.0` |
| Last updated | 2026-05-06 |

Refscope の 4 つ目の Lens として「Hotspot Lens」を追加する。X = ファイル行数、Y = 変更頻度の散布図と、同じデータセットを行数降順で見せるランキング表をタブ切替で提供し、肥大ファイル発見からリファクタリング優先順位付けまでを 1 ビューで完結させる。

---

## 1. L0 Vision

リポジトリの中で「**大きく、かつ頻繁に触られているファイル**」は、リファクタリング ROI が最も高い候補である。一般的な行数カウンタ (`tokei` / `cloc`) は静的な LOC しか出さず、Git churn ツールはチャーンしか出さない。Refscope の Hotspot Lens は、すでに Refscope が常時取得している `git log` / `git ls-files` / `git show` のデータを、選択中の ref を起点に **「LOC × churn」 2 軸の散布図** にして可視化する。エンジニアは散布図の右上に張り付くファイルを見るだけで、リファクタリング対象の候補リストを 30 秒で得られる。

差別化軸は 3 点に絞る:

1. **Git 履歴と LOC の掛け合わせ** — Refscope の既存資産そのまま。新規依存ゼロ。
2. **選択中 ref に追従** — `main` だけでなく feature ブランチや任意のタグでも同じ分析が走る。
3. **既存 Lens と同じ操作モデル** — タブ切替・ファイルクリック → 履歴オーバーレイの導線を踏襲する。

スコープイン: 散布図ビュー / ランキング表ビュー / scope セグメント (全期間 / 直近 30日 / 直近 90日 / カスタム since) / ref 連動 / クリックでファイル履歴オーバーレイ起動。
スコープアウト: 自動リファクタリング提案、循環的複雑度 (cyclomatic complexity) などのコードメトリクス、co-change マトリクス、サブモジュール内の集計、SSE 経由のリアルタイム push、複数 ref 同時比較。

KPI:

- アクティブユーザーのうち、week 内に Hotspot Lens を 1 回以上開く比率 ≥ 35%
- Hotspot Lens 内で「ファイル履歴オーバーレイへ遷移」が発生する率 ≥ 25%
- 1 万ファイル × 200 コミット規模で初回フェッチ ≤ 5 秒、キャッシュヒット ≤ 100 ms

タイムライン: Phase 1 (MVP) を 1 スプリント、Phase 2 (scope 切替・キャッシュ・authors) を 1 スプリント、Phase 3 は要望次第。

---

## 2. L1 Requirements

### 2.1 機能スコープ

#### In

- 散布図ビュー (X = `lines`, Y = `churn`, 点サイズ = `lastChangedAt` の新しさ)
- ランキング表ビュー (列: rank / path / lines / churn / lastChangedAt / 操作)
- 散布図/ランキング表のタブ切替 (両者は同一データを別表現で見せる)
- scope セグメント: `全期間` / `直近 30日` / `直近 90日` / `カスタム since`
- 選択中 ref への自動追従 (App の `selectedRef` を購読)
- ref / repo / scope / since 変更時の自動再フェッチ
- 手動リフレッシュボタン
- 点 / 行クリック → 既存 `setFileHistoryPath(path)` を呼んでファイル履歴オーバーレイを開く
- ローディング、エラー、`truncated` の各表示
- 1 万ファイル / 200 コミット規模のリポジトリでも操作不能にならない

#### Out

- ファイル単位のリファクタリング自動提案
- 循環的複雑度・関数数などのコードメトリクス
- ファイル間 co-change ヒートマップ
- サブモジュール内のホットスポット集計 (本フェーズはスーパープロジェクトの working tree のみ)
- SSE 経由のリアルタイム push (今フェーズはリクエスト型のみ)
- 複数 ref 横並びの diff 比較

### 2.2 ユーザーストーリー

| ID | Story | Priority |
|---|---|---|
| `US-1` | リファクタリング対象を探したいシニアエンジニアとして、リポジトリ全体で LOC が大きく churn も高いファイルを 1 ビューで特定したい。なぜなら肥大ファイルこそ次スプリントの投資対象になるから。 | Must |
| `US-2` | PR レビュアーとして、レビュー対象のファイルが「ホットスポットの常連」かどうかを事前に知りたい。なぜなら常連であればより慎重なレビューが必要だから。 | Must |
| `US-3` | feature ブランチで実装中のエンジニアとして、現在の ref 状態でホットスポットを確認したい。なぜなら自分の作業がさらに肥大ファイルを膨らませていないか確認したいから。 | Must |
| `US-4` | テックリードとして、直近 90 日に絞ったホットスポットを見たい。なぜなら歴史的負債と最近の急成長を分けて議論したいから。 | Should |
| `US-5` | OSS メンテナとして、ランキング表を CSV 的に走り読みしたい。なぜなら GitHub Issue に貼って議論したいから (Phase 3 で export 対応の余地あり)。 | Could |

### 2.3 機能要件 (REQ)

| ID | Requirement | Trace to US |
|---|---|---|
| `REQ-API-1` | 新エンドポイント `GET /api/repos/:repoId/files/hotspot` を追加し、ref / limit / since / commitCap をクエリで受ける | US-1 / US-3 / US-4 |
| `REQ-API-2` | `ref` を `gitService` の既存 resolve パターン (`rev-parse` + `cat-file -t`) で commit OID に解決し、解決後の OID で以降の Git コマンドを走らせる | US-3 |
| `REQ-API-3` | ファイル一覧は `git ls-files` を許可済みコマンドとして使い、各ファイルの行数 / バイト数は `git show <ref>:<path>` で取得した blob から API 側で計算する | US-1 |
| `REQ-API-4` | churn / lastChangedAt / authors は `git log --no-show-signature --name-only --format=%H%x00%aI%x00%aE --end-of-options <ref> --` の単一呼び出しで集計する | US-1 / US-4 |
| `REQ-API-5` | レスポンスは `lines` 降順でソートし、`limit` 件で打ち切る。打ち切り発生時は `truncated:true` と `truncationReason` を返す | US-1 |
| `REQ-API-6` | 結果は `Map<key, {data, expiresAt}>` で 60 秒間キャッシュする。key = `repoPath + resolvedRef + commitCap + sinceISO` | US-1 / 性能 |
| `REQ-API-7` | 専用上限: `limit` default=500 / max=1000、`commitCap` default=200 / max=500、Git stdout maxBytes=1 MB、timeout=20 s | 性能 |
| `REQ-API-8` | 入力 validator は既存 `isValidGitRef` / `parseLimitQuery` / `parseDateQuery` / `parsePathQuery` / `isValidRepoId` を再利用し、`validation.js` への新規追加は行わない | セキュリティ |
| `REQ-API-9` | Git 呼び出しは `gitRunner.runGit` を経由し、`spawn` を直接使わない。`gitRunner.js` の allowlist (`cat-file`, `diff`, `for-each-ref`, `log`, `ls-files`, `merge-base`, `rev-list`, `rev-parse`, `show`, `stash`, `submodule`, `worktree`) を変更しない | セキュリティ |
| `REQ-UI-1` | `LensSwitcher` の `LensId` 型と `LENSES` 配列に `'hotspot'` を追加し、label="Hotspot" / labelJa="ホットスポット" として並べる | US-1 |
| `REQ-UI-2` | `App.tsx` のレンダリングブロックに `'hotspot'` ケースを追加し、`HotspotLens` を `repoId` / `selectedRef` を props に渡してマウントする | US-1 |
| `REQ-UI-3` | `HotspotLens` 内で shadcn `Tabs` (`scatter` / `ranking`) を持ち、デフォルト選択は `scatter` | US-1 |
| `REQ-UI-4` | 散布図は `recharts` の `ScatterChart` を使い、X 軸=lines (log scale)、Y 軸=churn (linear)、点 fill 透明度=`lastChangedAt` の新しさにマップする | US-1 |
| `REQ-UI-5` | ランキング表は shadcn `table.tsx` を使い、列: rank / path / lines / churn / lastChangedAt / 操作 (履歴を開くボタン) | US-1 |
| `REQ-UI-6` | 散布図の点クリックおよびランキング表の行クリックで `setFileHistoryPath(path)` を呼ぶ既存パターンを使う | US-2 |
| `REQ-UI-7` | scope セグメント (全期間 / 30日 / 90日 / カスタム since) を備え、変更時に再フェッチする | US-4 |
| `REQ-UI-8` | 手動リフレッシュボタンを備える。クリックで `fetchFileHotspot` を AbortController 付きで再呼び出しする | US-3 |
| `REQ-UI-9` | API 呼び出しは `apps/ui/src/app/api.ts` に `fetchFileHotspot()` を追加して経由する。SSE は使わない | アーキ整合 |

### 2.4 Cross-Functional Requirements (CFR)

| ID | Category | Statement | Trace to AC |
|---|---|---|---|
| `CFR-PERF-1` | Performance | 1 万ファイル × 200 コミットの初回 fetch で server 側の `getFileHotspot` 実行時間 ≤ 5,000 ms (P95) | `AC-PERF-1` |
| `CFR-PERF-2` | Performance | 同一キーの再リクエストはキャッシュヒットで API レスポンス ≤ 100 ms (P95) | `AC-PERF-2` |
| `CFR-PERF-3` | Performance | UI のタブ切替 (scatter ↔ ranking) はネットワーク再フェッチを発生させない | `AC-PERF-3` |
| `CFR-A11Y-1` | Accessibility | LensSwitcher は `role="tablist"` / 各タブ `role="tab"` / `aria-controls="lens-panel-hotspot"` / `aria-selected` を維持する | `AC-A11Y-1` |
| `CFR-A11Y-2` | Accessibility | 散布図はスクリーンリーダー利用者向けに「ランキング表ビュー」を等価な代替として常時提供する (タブ切替で切り替え可能) | `AC-A11Y-2` |
| `CFR-A11Y-3` | Accessibility | ランキング表は `<table>` セマンティクスを保ち、ヘッダ列にソート方向を `aria-sort` で公開する | `AC-A11Y-3` |
| `CFR-SEC-1` | Security | 全 Git 呼び出しは `gitRunner.runGit` 経由。直接 `spawn` 禁止。 | `AC-SEC-1` |
| `CFR-SEC-2` | Security | `ref` / `repoId` / `since` / `path` の入力は `validation.js` の既存 validator を再利用し、ad-hoc 検査を入れない | `AC-SEC-2` |
| `CFR-SEC-3` | Security | 暗号署名検証は行わない (Refscope 全体方針)。`--no-show-signature` を維持する | `AC-SEC-3` |
| `CFR-OBS-1` | Observability | timeout / maxBytes 超過は `truncated:true` + `truncationReason` で返し、500 にしない | `AC-ERR-2` / `AC-ERR-3` |

---

## 3. L2 Team Detail

### 3.1 L2-Biz: なぜ作るか

- **競合観点**: GitLens / git-quick-stats / `tokei` などはどれも単軸 (LOC か churn) しか見せない。Refscope はすでに `gitService.summarizeCommits` 系で churn 集計の素材を持っているため、追加コストが最小で「LOC × churn」の 2 軸を提供できる。
- **ユーザー価値**: シニア / テックリード層がリファクタ ROI を語るときの共通言語を作る。会議で「あのファイルが右上に張り付いている」と言える状態を作る。
- **コスト観点**: 追加依存ゼロ (`recharts` は既存)。バックエンドの新規 Git コマンドもゼロ (`ls-files` は allowlist 済み)。`gitRunner.js` / `validation.js` の改修も不要。

### 3.2 L2-Dev: どう作るか

#### 3.2.1 API レスポンス型 (TypeScript として明示)

```typescript
type HotspotResponse = {
  repoId: string;
  ref: string;          // 解決済み commit OID (40 hex)
  refLabel: string;     // 元の ref 表記 (例: "main", "v1.2.3", "HEAD")
  scope: {
    commitsAnalyzed: number; // 実際に集計に使ったコミット数
    commitCap: number;       // 上限値 (default 200)
    sinceISO?: string;       // since が指定されたとき
  };
  files: Array<{
    path: string;            // repo root からの相対パス
    lines: number;           // 解決済み ref における現在行数
    // bytes は Phase 1 では省略 (UTF-8 re-encoding により不正確なため)。Phase 2 で再導入予定。
    churn: number;           // commitsAnalyzed 内での変更回数
    lastChangedAt: string;   // ISO 8601 (commitsAnalyzed 内での最新)
    authors: number;         // distinct author email 数 (Phase 2 で実装、Phase 1 は 0 を返す)
  }>;
  truncated: boolean;
  truncationReason?: 'limit' | 'commitCap' | 'maxBytes' | 'timeout';
};
```

#### 3.2.2 エンドポイント

```
GET /api/repos/:repoId/files/hotspot
  ?ref=<git-ref>           // default: HEAD
  &limit=<int>             // default: 500, max: 1000
  &since=<ISO 8601>        // optional
  &commitCap=<int>         // default: 200, max: 500
```

ステータスコード:

| Status | When |
|---|---|
| `200` | 正常 (`truncated:true` を含む正常完了) |
| `400` | `ref` が `isValidGitRef` を通らない / `limit` / `commitCap` / `since` のフォーマット不正 |
| `404` | `repoId` が `reposStore` に存在しない |
| `504` | Git 呼び出しが timeout した場合に限り 504 を返し、body は `{ "error": "timeout", "truncated": true, "truncationReason": "timeout" }` |
| `500` | 上記いずれにも該当しない予期せぬ Git エラー |

#### 3.2.3 `gitService.getFileHotspot(repo, query)` 実装手順

```
Step 1. ref resolve
  resolvedOid = await resolveRefToCommit(repo, query.ref ?? 'HEAD')
  // 既存の rev-parse + cat-file -t パターンに従う
  refLabel = query.ref ?? 'HEAD'

Step 2. cache lookup
  key = `${repo.path}|${resolvedOid}|${commitCap}|${sinceISO ?? ''}`
  if (cache.has(key) && cache.get(key).expiresAt > Date.now()) return cache.get(key).data

Step 3. file inventory
  ls-files の出力を gitRunner.runGit('ls-files', ['--no-empty-directory', '--end-of-options', resolvedOid, '--']) ではなく、
  ファイル列挙は `git ls-tree -r --name-only <resolvedOid>` 相当を `ls-files` で代替できないため、
  Phase 1 では `git ls-files` を `working tree HEAD` 限定で使い、ref と HEAD が異なる場合は
  `git log -r ... --name-only` で得たファイル集合を逆引きする。
  ※ 注: 現状 allowlist は `ls-tree` を含まない。Phase 1 は HEAD = resolvedOid のときのみ ls-files を使い、
    それ以外は `git log` 集計から得たファイルパス集合に対し `git show resolvedOid:<path>` を試行 →
    存在しないファイルは無視 (rename / 削除に対応)。
  Phase 2 で必要なら `ls-tree` 追加を検討するが、本仕様では allowlist 改変なし。

Step 4. lines per file (Phase 1; bytes は Phase 2 で再導入)
  Promise.all で各 path に対し:
    blob = await runGit('show', ['--no-show-signature', '--end-of-options', `${resolvedOid}:${path}`])
    lines = blob.toString('utf-8').split('\n').length - (末尾改行で空行が入る分の補正)
    // bytes は UTF-8 re-encoding により不正確なため Phase 1 では返さない。
  並列度は os.cpus().length の半分を上限に絞る (大規模リポでイベントループを詰まらせないため)。

Step 5. churn / lastChangedAt aggregation
  args = ['--no-show-signature', '--name-only', '--format=%H%x00%aI%x00%aE', `--max-count=${commitCap}`,
          ...(sinceISO ? [`--since=${sinceISO}`] : []),
          '--end-of-options', resolvedOid, '--']
  log = await runGit('log', args)
  // log を改行で分割し、ヘッダー行 (%H...) と path 行を交互に処理。
  // 同一コミット内に同一 path が複数回出ても 1 回として数える。

Step 6. compose
  files = paths
    .map(p => ({ path: p, lines: ..., churn: ..., lastChangedAt: ..., authors: 0 }))
    .sort((a, b) => b.lines - a.lines)
    .slice(0, limit)
  truncated = paths.length > limit || ranLogReturnedCommits === commitCap
  truncationReason = paths.length > limit ? 'limit' : (ranLogReturnedCommits === commitCap ? 'commitCap' : undefined)

Step 7. cache store
  cache.set(key, { data, expiresAt: Date.now() + 60_000 })

Step 8. return data
```

#### 3.2.4 `http.js` ルーター追加

`matchRoute()` に以下を追加 (既存の `apps/api/src/http.js` の `/api/repos/:repoId/...` パターンに整合させる):

```
GET /api/repos/:repoId/files/hotspot → handler
```

ハンドラの責務は (a) `isValidRepoId` で `repoId` を弾く → 404、(b) `parseLimitQuery` / `parseDateQuery` / `isValidGitRef` で query を弾く → 400、(c) `gitService.getFileHotspot` を呼ぶ → 200 / 504 / 500、の 3 段。

#### 3.2.5 `apps/ui/src/app/api.ts` 追加

```typescript
export async function fetchFileHotspot(
  repoId: string,
  params: { ref?: string; limit?: number; since?: string; commitCap?: number },
  signal?: AbortSignal,
): Promise<HotspotResponse> {
  const search = new URLSearchParams();
  if (params.ref)        search.set('ref', params.ref);
  if (params.limit)      search.set('limit', String(params.limit));
  if (params.since)      search.set('since', params.since);
  if (params.commitCap)  search.set('commitCap', String(params.commitCap));
  const qs = search.toString();
  const path = `/api/repos/${encodeURIComponent(repoId)}/files/hotspot${qs ? `?${qs}` : ''}`;
  return getJson<HotspotResponse>(path, signal);
}
```

#### 3.2.6 `LensSwitcher.tsx` 拡張差分 (擬似)

```diff
-export type LensId = 'live' | 'pulse' | 'stream';
+export type LensId = 'live' | 'pulse' | 'stream' | 'hotspot';

 const LENSES: Array<{ id: LensId; label: string; labelJa: string }> = [
   { id: 'live',    label: 'Live',    labelJa: 'ライブ' },
   { id: 'pulse',   label: 'Pulse',   labelJa: 'パルス' },
   { id: 'stream',  label: 'Stream',  labelJa: 'ストリーム' },
+  { id: 'hotspot', label: 'Hotspot', labelJa: 'ホットスポット' },
 ];
```

#### 3.2.7 `App.tsx` 拡張箇所

- `activeLens` state は既存で `LensId` を持つため自動拡張。
- `apps/ui/src/app/App.tsx:1245` 付近のレンダリングブロックに `case 'hotspot'` を追加し、`<HotspotLens repoId={activeRepoId} selectedRef={selectedRef} onOpenFileHistory={setFileHistoryPath} />` をマウント。
- フェッチは Lens 内 `useEffect` で行い、`repoId` / `selectedRef` / `scope` / `since` を依存配列に入れる。`AbortController` で前のリクエストを cancel。

#### 3.2.8 新規ファイル: `apps/ui/src/app/components/refscope/HotspotLens.tsx`

主要 props:

```typescript
type HotspotLensProps = {
  repoId: string;
  selectedRef: string;
  onOpenFileHistory: (path: string) => void;
};
```

内部 state: `data`, `loading`, `error`, `tab` (`'scatter' | 'ranking'`), `scopeKind` (`'all' | '30d' | '90d' | 'custom'`), `customSinceISO`.

### 3.3 L2-Design: 誰がどう使うか

#### 3.3.1 ペルソナ動線

1. テックリード Aoi が main ブランチをチェックアウトした状態で Refscope を開く
2. 上部 LensSwitcher の `Hotspot` をクリック
3. 散布図が表示され、右上に張り付いている `apps/api/src/gitService.js` (約 2400 行) が一目でわかる
4. その点をクリック → 既存のファイル履歴オーバーレイが開く
5. レビューが終わったら Hotspot タブに戻り、scope を「直近 90日」に切り替えて議論を続ける

#### 3.3.2 コンポーネント構造 (擬似)

```
HotspotLens
├── HotspotToolbar
│   ├── ScopeSegment (all / 30d / 90d / custom)
│   ├── RefreshButton
│   └── TruncatedBadge (条件付き表示)
├── Tabs (scatter / ranking)
│   ├── TabsList
│   └── TabsContent[scatter] → ScatterPanel
│       └── ScatterChart (recharts)
│   └── TabsContent[ranking] → RankingPanel
│       └── Table (shadcn)
└── EmptyState / LoadingState / ErrorState
```

#### 3.3.3 状態と空 / エラー

| 状態 | 表示 |
|---|---|
| Loading | スケルトン (散布図エリアにシマー、ランキング表に 5 行のスケルトン) |
| Empty (`files.length === 0`) | 「このリポジトリには分析対象のファイルがありません」+ 解決済み ref を表示 |
| Error | 「ホットスポットの取得に失敗しました」+ リトライボタン + サーバが返した `error` 文字列 |
| Truncated | 上部に黄色バッジ「結果は上限で打ち切られています (理由: limit / commitCap / maxBytes / timeout)」 |

#### 3.3.4 視覚マッピング

- X 軸: lines (log scale, base 10)。tick は `[1, 10, 100, 1k, 10k, 100k]`
- Y 軸: churn (linear)。max は `Math.max(...files.map(f => f.churn))`
- 点サイズ: lastChangedAt の新しさ。最新 = 半径 8、最古 = 半径 3 の線形補間
- 点色: var(--rs-accent) を opacity 0.6 で塗る (Pulse Lens と統一)
- ホバー: shadcn `tooltip.tsx` で path / lines / churn / lastChangedAt を表示

---

## 4. L3 Acceptance Criteria

各 AC は Given / When / Then を厳密に分離する。`Given` は前提状態、`When` は単一トリガ、`Then` は観測可能な結果。閾値はすべて実測値で記述。

### Rule: 散布図とランキングは同一データの別表現である

#### `AC-VIEW-1` 散布図のデフォルト表示

```
Given Refscope に repoId="self" が登録されており selectedRef="HEAD" である
  And 該当 repo に 200 ファイル以上が存在する
When ユーザーが LensSwitcher の "Hotspot" タブをクリックする
Then `Tabs` のデフォルト選択が "scatter" になる
  And 5 秒以内に `ScatterChart` が描画される
  And `ScatterChart` は最低 1 つの点を持つ
  And X 軸ラベルが "lines"、Y 軸ラベルが "churn" と表示される
```

対応自動テスト: `apps/ui/src/app/components/refscope/__tests__/HotspotLens.test.tsx` (UI; ただし UI には test runner なしの方針であるため Phase 1 では手動 / Storybook、Phase 2 で Vitest 検討)。API 側の対応は `apps/api/test/getFileHotspot.test.js` の `returns files sorted by lines desc`。

#### `AC-VIEW-2` ランキングタブへの切替

```
Given Hotspot Lens が "scatter" タブで表示されている
  And `files` が 50 件取得済みである
When ユーザーが "Ranking" タブをクリックする
Then 100 ms 以内に shadcn `<table>` が描画される
  And rank 列は 1, 2, 3, ... の連番である
  And lines 列が降順に並んでいる (a.lines >= b.lines for all i, j where i<j)
  And ネットワーク再フェッチが発生しない (`fetchFileHotspot` の呼び出し回数が増えない)
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `sorts files by lines desc` + UI 手動確認。

#### `AC-VIEW-3` ファイルクリックで履歴オーバーレイ起動

```
Given ランキングタブが開いており、1 行目が path="apps/api/src/gitService.js" である
When ユーザーが 1 行目の "履歴を開く" ボタンをクリックする
Then `onOpenFileHistory("apps/api/src/gitService.js")` が 1 回だけ呼ばれる
  And 既存のファイル履歴オーバーレイが open になる
```

対応自動テスト: UI 手動確認 (Phase 2 で UI test 検討)。

### Rule: ref / scope の変更は再フェッチを起こす

#### `AC-REF-1` ref 切替時に再フェッチ

```
Given Hotspot Lens が selectedRef="main" で取得済みである
When ユーザーが BranchSidebar から "feature/foo" を選択し selectedRef が "feature/foo" に変わる
Then `fetchFileHotspot` が ref="feature/foo" で 1 回呼ばれる
  And 旧リクエストの AbortController が abort される
  And 新しいレスポンスで `ScatterChart` / `<table>` が再描画される
```

対応自動テスト: `apps/ui/src/app/components/refscope/__tests__/HotspotLens.test.tsx` (Phase 2)、API 側 `getFileHotspot.test.js` の `resolves ref alias to commit oid`。

#### `AC-REF-2` scope=直近 30日 を選択

```
Given Hotspot Lens が scope="all" で表示されている
When ユーザーが ScopeSegment の "30d" を選択する
Then `fetchFileHotspot` が `since=` に `now() - 30 日` (ISO 8601, UTC) を入れて呼ばれる
  And レスポンスの `scope.sinceISO` がリクエストの since と一致する
  And `scope.commitsAnalyzed` の値が UI 上 (Truncated バッジまたは toolbar) に表示される
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `applies since filter to log scope`。

#### `AC-REF-3` カスタム since が無効な場合

```
Given Hotspot Lens が表示されている
When ユーザーが ScopeSegment の "custom" を選び、入力欄に "not-a-date" と打って Enter
Then `fetchFileHotspot` は呼ばれない (UI 側 validation)
  And 入力欄に「ISO 8601 で指定してください」というエラーメッセージが出る
```

対応自動テスト: UI 手動 (Phase 2 で UI test)。

### Rule: 上限と打ち切りは正直に通知する

#### `AC-LIMIT-1` limit 超過で truncated

```
Given API repoId="big-repo" が 1500 ファイルを持つ
When `GET /api/repos/big-repo/files/hotspot?limit=500` を叩く
Then status=200
  And レスポンス JSON の `files.length === 500`
  And `truncated === true`
  And `truncationReason === "limit"`
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `marks truncated when files exceed limit`。

#### `AC-LIMIT-2` commitCap での打ち切り

```
Given API repoId="big-repo" の log が 1000 コミット
When `GET /api/repos/big-repo/files/hotspot?commitCap=200` を叩く
Then `scope.commitsAnalyzed === 200`
  And `truncated === true`
  And `truncationReason === "commitCap"` または "limit" のいずれか
  (両方に該当する場合は `commitCap` 以外の打ち切り、すなわち `limit` を優先するルールでも可とし、本仕様では `limit` を優先する)
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `respects commitCap and reports it in scope`。

#### `AC-LIMIT-3` 0 ファイル

```
Given repoId="empty" にコミットが 1 件あるが追跡ファイルがゼロ
When `GET /api/repos/empty/files/hotspot` を叩く
Then status=200
  And `files.length === 0`
  And `truncated === false`
  And UI は EmptyState (「このリポジトリには分析対象のファイルがありません」) を表示する
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `returns empty array when repo has no tracked files`。

### Rule: 入力エラーは validator が確実に弾く

#### `AC-ERR-1` 無効 ref → 400

```
Given API が起動している
When `GET /api/repos/self/files/hotspot?ref=$$$invalid` を叩く
Then status=400
  And body は `{ "error": "invalid_ref" }` (既存の validation エラーメッセージ規約に従う)
  And gitService.getFileHotspot が呼ばれない (gitRunner にも到達しない)
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `rejects invalid ref before invoking git`。

#### `AC-ERR-2` 不明 repo → 404

```
Given reposStore に repoId="ghost" が登録されていない
When `GET /api/repos/ghost/files/hotspot` を叩く
Then status=404
  And body は `{ "error": "repo_not_found" }`
```

対応自動テスト: `apps/api/test/http.test.js` の既存パターンを踏襲して `responds 404 for unknown repo on /files/hotspot`。

#### `AC-ERR-3` Git timeout → 504 + truncated

```
Given gitRunner.runGit がタイムアウトを発生させる (テストでは 1 ms に絞る)
When `GET /api/repos/self/files/hotspot` を叩く
Then status=504
  And body は `{ "error": "timeout", "truncated": true, "truncationReason": "timeout" }`
  And UI は ErrorState を出すが、リトライボタンを active にする
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `returns 504 with truncated payload when git times out`。

### Rule: 性能は実測値でガードする

#### `AC-PERF-1` 初回フェッチ ≤ 5 秒

```
Given fixtures/big-repo (10,000 ファイル, 200 コミット) を使う
When `GET /api/repos/big-repo/files/hotspot?limit=500&commitCap=200` を 5 回連続で叩く (キャッシュ無効化済み)
Then 5 回中 5 回が 5,000 ms 以内に 200 を返す (P95 が 5,000 ms 以内とみなす)
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `completes within 5s on 10k files / 200 commits` (Phase 1 では 1k ファイルのスケールダウン版でも可、Phase 2 で fixtures/big-repo を整備)。

#### `AC-PERF-2` キャッシュヒット ≤ 100 ms

```
Given 上記と同じリクエストを 1 度実行済みでキャッシュ有効
When 同じリクエストをもう一度叩く
Then レスポンスが 100 ms 以内に返る
  And レスポンスの内容が初回と完全一致する (deep equal)
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `serves identical payload from cache within 100ms`。

#### `AC-PERF-3` タブ切替で再フェッチしない

```
Given Hotspot Lens が scatter タブで取得済みである
When ユーザーが scatter ↔ ranking を 5 回連続で切り替える
Then `fetchFileHotspot` の呼び出し回数が初回 1 回のままで増えない
```

対応自動テスト: UI 手動 + ネットワークタブで確認。Phase 2 で UI test 化。

### Rule: アクセシビリティの最低ライン

#### `AC-A11Y-1` Lens タブの ARIA

```
Given LensSwitcher がレンダリングされている
When DOM を検査する
Then 親要素が `role="tablist"`
  And `Hotspot` ボタンが `role="tab"` / `aria-controls="lens-panel-hotspot"` / `aria-selected={isActive}`
  And アクティブ時のみ `aria-selected="true"`
```

対応自動テスト: 既存の LensSwitcher テストパターンに合わせ `apps/ui/src/app/components/refscope/__tests__/LensSwitcher.test.tsx` (Phase 2)。

#### `AC-A11Y-2` 散布図に等価な代替

```
Given Hotspot Lens が表示されている
When スクリーンリーダー利用者が `Ranking` タブをアクティブにする
Then 散布図と等価な情報 (path / lines / churn / lastChangedAt) が `<table>` で読み上げ可能になる
```

対応自動テスト: 手動 a11y チェック (axe-core で table セマンティクスを検証可)。

#### `AC-A11Y-3` table のソート方向公開

```
Given ランキング表が表示されている
When DOM の `<thead>` を検査する
Then `lines` 列の `<th>` に `aria-sort="descending"` が付いている
  And 他の列の `<th>` には `aria-sort` が付いていないか `none`
```

対応自動テスト: 手動 + Phase 2 で axe-core 自動化。

### Rule: gitRunner / validation はバイパスしない

#### `AC-SEC-1` 直接 spawn 禁止

```
Given 本機能のソースコード差分
When `apps/api/src/` 配下を `grep -nE "child_process|spawn\\(" -- 'apps/api/src/**'` で走査する
Then `gitService.js` 内に `spawn(` の新規呼び出しが無い (`gitRunner.js` のみが spawn を呼ぶ)
```

対応自動テスト: lint レベルのチェック、または PR レビュー時の手動確認 (CI に grep ガードを追加する余地あり)。

#### `AC-SEC-2` 既存 validator の再利用

```
Given 本機能のソースコード差分
When `apps/api/src/validation.js` の差分を確認する
Then 新規 export が増えていない (`isValidGitRef` / `parseLimitQuery` / `parseDateQuery` / `parsePathQuery` / `isValidRepoId` のみが使われている)
```

対応自動テスト: `apps/api/test/validation.test.js` の既存テストが緑のまま。

#### `AC-SEC-3` 署名検証を行わない

```
Given 本機能の Git 引数生成
When 引数文字列を全て連結する
Then `--show-signature` が含まれない
  And `gpg.program` を設定する `-c` フラグが含まれない
  And レスポンスに `signed` / `signatureStatus` フィールドが含まれない (もしくは既存規約通り `signed:false` / `signatureStatus:"unknown"` で固定)
```

対応自動テスト: `apps/api/test/getFileHotspot.test.js` の `does not pass --show-signature to git`。

---

## 5. ロールアウト計画

| Phase | スコープ | 完了条件 |
|---|---|---|
| `P1` MVP | 散布図 + ランキング (scope=全期間, limit=500, authors=0)、エンドポイント実装、Lens タブ追加 | `AC-VIEW-1/2/3`, `AC-REF-1`, `AC-LIMIT-1/3`, `AC-ERR-1/2/3`, `AC-SEC-1/2/3` 全パス |
| `P2` Scope & Cache | scope セグメント (30d/90d/custom)、60 秒キャッシュ、authors メトリクス、UI テスト整備 | `AC-REF-2/3`, `AC-LIMIT-2`, `AC-PERF-1/2/3`, `AC-A11Y-1/2/3` 全パス |
| `P3` Future | co-change ヒートマップ / CSV エクスポート / サブモジュール集計 | 別仕様で再起票 |

---

## 6. 未決事項

| ID | 質問 | 合理的デフォルト |
|---|---|---|
| `Q-1` | `git ls-files` は HEAD と異なる ref のファイル列挙には素直には使えない。Phase 1 で `ls-tree` を allowlist に追加するか、`log --name-only` の集合で代替するか? | デフォルト: allowlist は変えず `log --name-only` の集合で代替する。allowlist 拡張は Phase 2 で改めて議論する。 |
| `Q-2` | `authors` 集計 (distinct author email 数) を Phase 1 から実装するか? | デフォルト: Phase 1 では `0` 固定で返し、Phase 2 で本実装する。フィールドは API 仕様には今から含める。 |
| `Q-3` | UI のテスト基盤 (Vitest など) を Phase 1 から導入するか? | デフォルト: Phase 1 は Node.js test (API 側のみ) に閉じ、UI は手動 + 既存スタイルで運用。Phase 2 で導入を再検討。 |
| `Q-4` | scope=custom の入力 UI は date picker か単純な ISO 8601 テキストフィールドか? | デフォルト: ISO 8601 テキストフィールド + 形式チェック。後日 date picker に差し替え可。 |
| `Q-5` | エラーレスポンスのキー名 (`error` / `code` / `message` のどれにするか) | デフォルト: 既存 `apps/api/src/http.js` のエラー JSON 形式 (`error` 文字列) を踏襲する。新規追加なし。 |

---

## 7. 実装影響ファイル一覧

| 種別 | パス | 役割 |
|---|---|---|
| 新規 | `apps/ui/src/app/components/refscope/HotspotLens.tsx` | Hotspot Lens 本体 (Tabs + ScatterChart + Table) |
| 変更 | `apps/ui/src/app/components/refscope/LensSwitcher.tsx` | `LensId` 型と `LENSES` 配列に `hotspot` を追加 |
| 変更 | `apps/ui/src/app/App.tsx` | レンダリングブロックに `case 'hotspot'` を追加 (周辺 line 1245-1268) |
| 変更 | `apps/ui/src/app/api.ts` | `fetchFileHotspot()` を追加。`HotspotResponse` 型を export |
| 変更 | `apps/api/src/gitService.js` | `getFileHotspot(repo, query)` を追加 |
| 変更 | `apps/api/src/http.js` | `matchRoute()` に `/files/hotspot` を追加。ハンドラ実装 |
| 不変 | `apps/api/src/gitRunner.js` | 変更不要 (allowlist 改変なし) |
| 不変 | `apps/api/src/validation.js` | 変更不要 (既存 validator 再利用) |
| 新規 | `apps/api/test/getFileHotspot.test.js` | 上記 AC のうち API 側に対応する自動テスト |

---

## 8. Meta

| 項目 | 値 |
|---|---|
| Authors | Accord (drafted), pending Three Amigos review (Product / Dev / QA) |
| Reviewers (required) | API オーナー / UI オーナー / QA リード |
| Status | `Draft` — 未レビュー |
| Traceability | `US-1..5` ↔ `REQ-API-1..9` / `REQ-UI-1..9` / `CFR-*` ↔ `AC-*` で全行対応 (Full スコープの 95% 閾値を満たす想定) |
| Open questions | `Q-1..5` (5 件以下) |
| Related docs | `docs/spec-v0.md`, `apps/api/src/gitRunner.js`, `apps/api/src/gitService.js`, `apps/ui/src/app/components/refscope/LensSwitcher.tsx` |
