以下は、**リアルタイム git log ビュアーのWeb UI設計案**です。
前提として、ブラウザだけで `.git` を直接監視するのは現実的ではないため、**Gitリポジトリを読むバックエンド + Web UI** の構成にします。

---

# 1. コンセプト

## 目的

開発中のリポジトリに対して、以下をWeb UIでリアルタイムに確認できるようにします。

* 新しいコミット
* ブランチの進行
* merge / rebase / reset による履歴変化
* タグ追加
* author / branch / file path / message による絞り込み
* コミット詳細、差分、変更ファイル一覧

Gitの履歴取得には `git log` や `git rev-list` を使います。`git rev-list` は親コミットをたどってコミット履歴を列挙するための中核的なGitコマンドで、日付・author・grepなどの絞り込みにも対応しています。([Git][1])
表示用の整形には `git log --pretty=format:` 系を使えます。Git公式ドキュメントでも、`format:` によってハッシュ、author、日時、件名などを任意の形式で出力できることが説明されています。([Git][2])

---

# 2. 全体アーキテクチャ

```text
┌────────────────────────────┐
│          Browser UI         │
│  - commit timeline          │
│  - branch graph             │
│  - filters/search           │
│  - commit detail/diff       │
└──────────────┬─────────────┘
               │
               │ REST: 初期取得 / 検索 / 詳細
               │ SSE or WebSocket: リアルタイム通知
               │
┌──────────────▼─────────────┐
│        Git Log API Server   │
│  - repo registry            │
│  - git command runner       │
│  - event broadcaster        │
│  - cache/index              │
└──────────────┬─────────────┘
               │
               │ git log / rev-list / show / diff-tree
               │ fs watch / webhook / polling
               │
┌──────────────▼─────────────┐
│        Git Repository       │
│  .git/HEAD                  │
│  .git/refs                  │
│  packed-refs                │
│  objects                    │
└────────────────────────────┘
```

---

# 3. 通信方式

## 推奨: Server-Sent Events

このUIでは、基本的に **サーバーからブラウザへ更新を流す** だけで十分です。
そのため、MVPでは **SSE / Server-Sent Events** を推奨します。

MDNでも、SSEはサーバーからフロントエンドへイベントを流すための単方向接続であり、クライアントからサーバーへイベント送信はできないと説明されています。([MDNウェブドキュメント][3])

```text
GET /api/repos/:repoId/events
```

イベント例:

```json
{
  "type": "commit_added",
  "repoId": "frontend",
  "branch": "main",
  "commit": {
    "hash": "a1b2c3d",
    "subject": "Add realtime git log viewer",
    "author": "shingo",
    "authorDate": "2026-04-30T12:30:00+09:00"
  }
}
```

## WebSocketを使うケース

以下のように、ブラウザからサーバーへ頻繁に指示を送るならWebSocketを選びます。

* UIから `git fetch` を実行する
* 複数ユーザーのカーソルや選択状態を共有する
* リアルタイム検索条件をサーバーへ送り続ける
* tailモードの購読対象ブランチを動的に変更する

WebSocketはブラウザとサーバーの双方向通信を可能にし、ポーリングせずにメッセージを送受信できるAPIです。([MDNウェブドキュメント][4])

---

# 4. リアルタイム更新の検知方法

## ローカルリポジトリの場合

バックエンドが以下を監視します。

```text
.git/HEAD
.git/refs/heads/*
.git/refs/tags/*
.git/packed-refs
.git/logs/HEAD
.git/logs/refs/heads/*
```

ただし、ファイル監視だけに依存すると取りこぼしやイベント重複が起きます。
そのため、設計としては次の流れにします。

```text
ファイル変更検知
  ↓
短時間 debounce
  ↓
現在の refs を再取得
  ↓
前回 snapshot と比較
  ↓
oldHash..newHash の差分コミットを取得
  ↓
UIへイベント配信
```

## リモートリポジトリの場合

GitHub / GitLab / Bitbucket などのリモートを対象にする場合は、以下の構成が良いです。

```text
Webhook受信
  ↓
対象repoで git fetch
  ↓
refs比較
  ↓
新規コミット取得
  ↓
SSE/WebSocketでUIへ通知
```

---

# 5. 画面設計

## メイン画面

```text
┌────────────────────────────────────────────────────────────┐
│ Git Log Viewer                                      ● LIVE │
├────────────────────────────────────────────────────────────┤
│ Repo: frontend-app ▼     Branch: main ▼   Search: [     ] │
├───────────────┬────────────────────────────────────────────┤
│ Branches      │ Commit Timeline                            │
│               │                                            │
│ ● main        │  ● a1b2c3d  Add realtime log viewer         │
│   develop     │  │          shingo · 2 min ago              │
│   feature/x   │  │                                          │
│   release     │  ● 9e8f7a6  Refactor git event parser       │
│               │ ╱           tanaka · 14 min ago             │
│ Tags          │ ● 3d2c1b0  Merge branch feature/ui          │
│               │ │                                           │
│ v1.2.0        │ ● 8a7b6c5  Fix branch filter                │
│ v1.1.0        │                                            │
├───────────────┴────────────────────────────────────────────┤
│ Selected Commit                                            │
│ a1b2c3d                                                     │
│ Message: Add realtime log viewer                           │
│ Author: shingo                                             │
│ Files: src/App.tsx, src/api/events.ts                      │
│ Diff: ...                                                   │
└────────────────────────────────────────────────────────────┘
```

---

# 6. UI構成

## 左ペイン: Repository / Branch Navigator

表示項目:

* リポジトリ一覧
* ブランチ一覧
* タグ一覧
* remote tracking branch
* 現在選択中のbranch
* ahead / behind 表示
* 最終更新時刻

例:

```text
Repositories
  frontend-app
  api-server
  infra

Branches
● main
  develop
  feature/realtime-log
  hotfix/auth

Tags
  v2.0.0
  v1.9.0
```

## 中央: Commit Timeline

1コミットをカードとして表示します。

```text
● a1b2c3d  Add realtime git log viewer
│          shingo · 2026-04-30 12:30 · main
│          +12 -3 · 4 files
```

表示項目:

* 短縮hash
* subject
* author
* author date
* branch / tag
* changed files count
* insertions / deletions
* merge commit indicator
* signed commit indicator
* unread/new badge

リアルタイムで新規コミットが入った場合:

```text
┌─────────────────────────────┐
│ 3 new commits on main        │
│ [Show new commits]           │
└─────────────────────────────┘
```

いきなりリスト先頭へ挿入するとユーザーの読んでいる位置が崩れるため、**新規コミットは一旦バナーで通知**し、クリック時に反映するのが良いです。

## 右または下ペイン: Commit Detail

表示項目:

* full hash
* author / committer
* author date / commit date
* full message
* parent commits
* changed files
* diff
* copy hash button
* checkout / cherry-pick用コマンドコピー

例:

```text
Commit
a1b2c3d4e5f6...

Author
shingo <shingo@example.com>

Message
Add realtime git log viewer

Parents
9e8f7a6

Changed files
M src/App.tsx
A src/api/git-events.ts
M package.json

Commands
git show a1b2c3d
git checkout a1b2c3d
git cherry-pick a1b2c3d
```

---

# 7. フィルタ設計

上部に検索バーを配置します。

```text
[ message / hash / author / file path ] [Branch ▼] [Date ▼] [Merge ▼]
```

## 検索条件

| 条件             | 例                  |
| -------------- | ------------------ |
| commit message | `fix login`        |
| hash           | `a1b2c3d`          |
| author         | `author:shingo`    |
| branch         | `branch:main`      |
| file path      | `path:src/api`     |
| date           | `since:2026-04-01` |
| merge commit   | `is:merge`         |
| tag            | `tag:v1.2.0`       |

内部的には `git rev-list` の条件に変換します。`git rev-list` は `--since`、`--author`、`--grep` などの制限オプションを持つため、検索APIの土台に向いています。([Git][1])

---

# 8. API設計

## リポジトリ一覧

```http
GET /api/repos
```

レスポンス:

```json
[
  {
    "id": "frontend",
    "name": "frontend-app",
    "path": "/repos/frontend-app",
    "defaultBranch": "main",
    "lastUpdatedAt": "2026-04-30T12:30:00+09:00"
  }
]
```

## コミット一覧

```http
GET /api/repos/:repoId/commits?branch=main&limit=100&cursor=...
```

レスポンス:

```json
{
  "items": [
    {
      "hash": "a1b2c3d4e5f6",
      "shortHash": "a1b2c3d",
      "parents": ["9e8f7a6"],
      "subject": "Add realtime git log viewer",
      "authorName": "shingo",
      "authorEmail": "shingo@example.com",
      "authorDate": "2026-04-30T12:30:00+09:00",
      "refs": ["main"],
      "isMerge": false
    }
  ],
  "nextCursor": "..."
}
```

## コミット詳細

```http
GET /api/repos/:repoId/commits/:hash
```

レスポンス:

```json
{
  "hash": "a1b2c3d4e5f6",
  "parents": ["9e8f7a6"],
  "author": {
    "name": "shingo",
    "email": "shingo@example.com",
    "date": "2026-04-30T12:30:00+09:00"
  },
  "committer": {
    "name": "shingo",
    "email": "shingo@example.com",
    "date": "2026-04-30T12:35:00+09:00"
  },
  "message": "Add realtime git log viewer",
  "files": [
    {
      "path": "src/App.tsx",
      "status": "M",
      "additions": 12,
      "deletions": 3
    }
  ]
}
```

## 差分

```http
GET /api/repos/:repoId/commits/:hash/diff
```

レスポンス:

```json
{
  "files": [
    {
      "path": "src/App.tsx",
      "status": "M",
      "hunks": [
        {
          "oldStart": 10,
          "oldLines": 6,
          "newStart": 10,
          "newLines": 8,
          "lines": [
            {
              "type": "context",
              "content": "function App() {"
            },
            {
              "type": "added",
              "content": "  useGitEvents();"
            }
          ]
        }
      ]
    }
  ]
}
```

## リアルタイムイベント

```http
GET /api/repos/:repoId/events
```

SSEイベント例:

```text
event: commit_added
data: {"repoId":"frontend","branch":"main","hash":"a1b2c3d"}

event: ref_updated
data: {"repoId":"frontend","ref":"refs/heads/main","old":"9e8f7a6","new":"a1b2c3d"}

event: force_push_detected
data: {"repoId":"frontend","branch":"main","old":"1111111","new":"2222222"}
```

---

# 9. Gitコマンド設計

## 初期コミット取得

```bash
git log \
  --date=iso-strict \
  --pretty=format:'%H%x1f%P%x1f%an%x1f%ae%x1f%aI%x1f%cn%x1f%ce%x1f%cI%x1f%s%x1e' \
  --decorate=full \
  --max-count=100 \
  main
```

区切り文字に `%x1f`、レコード区切りに `%x1e` を使うと、通常のコミットメッセージ中の改行や空白と衝突しにくくなります。Gitのpretty formatでは `%x` に続く16進数で任意バイトを出力できます。([Git][2])

## 新規コミット検出

```bash
git rev-list oldHash..newHash
```

## 詳細取得

```bash
git show --date=iso-strict --stat --summary --format=fuller <hash>
```

## ファイル変更一覧

```bash
git diff-tree --no-commit-id --name-status -r <hash>
```

## 差分取得

```bash
git show --format= --patch <hash>
```

---

# 10. データモデル

## Commit

```ts
type Commit = {
  hash: string;
  shortHash: string;
  parents: string[];
  subject: string;
  body?: string;

  authorName: string;
  authorEmail: string;
  authorDate: string;

  committerName: string;
  committerEmail: string;
  committerDate: string;

  refs: string[];
  isMerge: boolean;

  additions?: number;
  deletions?: number;
  changedFiles?: number;
};
```

## Ref

```ts
type GitRef = {
  name: string;
  type: "branch" | "tag" | "remote";
  hash: string;
  previousHash?: string;
  updatedAt: string;
};
```

## Event

```ts
type GitEvent =
  | {
      type: "commit_added";
      repoId: string;
      branch: string;
      commit: Commit;
    }
  | {
      type: "ref_updated";
      repoId: string;
      ref: string;
      oldHash: string;
      newHash: string;
    }
  | {
      type: "force_push_detected";
      repoId: string;
      branch: string;
      oldHash: string;
      newHash: string;
    }
  | {
      type: "tag_added";
      repoId: string;
      tag: string;
      hash: string;
    };
```

---

# 11. Force push / rebase / reset 対応

リアルタイムGitログで重要なのは、単純な「新規コミット追加」だけではなく、**履歴の巻き戻り**を検出することです。

## 判定

```bash
git merge-base --is-ancestor oldHash newHash
```

### 結果

| 状態                | 意味                          | UI表示        |
| ----------------- | --------------------------- | ----------- |
| old が new の祖先     | fast-forward                | 新規コミットとして追加 |
| old が new の祖先ではない | force push / rebase / reset | 履歴変更警告を表示   |
| ref が消えた          | branch deleted              | ブランチ削除として表示 |
| ref が増えた          | branch/tag added            | 新規refとして表示  |

## UI表示

```text
⚠ main was rewritten
old: 9e8f7a6
new: 2b3c4d5

[Show old commits] [Reload timeline]
```

force push時に既存タイムラインを無理に差し替えると混乱するため、UIでは明示的に「履歴が書き換わった」と表示します。

---

# 12. フロントエンド設計

## 状態管理

```ts
type AppState = {
  selectedRepoId: string;
  selectedBranch: string;
  commits: Commit[];
  selectedCommitHash?: string;
  liveMode: boolean;
  pendingNewCommits: Commit[];
  filters: {
    query?: string;
    author?: string;
    path?: string;
    since?: string;
    until?: string;
    showMerges?: boolean;
  };
};
```

## リアルタイム受信

```ts
const source = new EventSource(`/api/repos/${repoId}/events`);

source.addEventListener("commit_added", (event) => {
  const payload = JSON.parse(event.data);

  // ユーザーが先頭付近を見ている場合は即時追加
  // 過去ログを読んでいる場合は pending に入れてバナー表示
  addPendingCommit(payload.commit);
});

source.addEventListener("force_push_detected", (event) => {
  const payload = JSON.parse(event.data);
  showHistoryRewrittenWarning(payload);
});
```

MDNのEventSourceの説明どおり、クライアント側では `EventSource` を作成してサーバーからのイベントを受け取れます。([MDNウェブドキュメント][3])

---

# 13. バックエンド設計

## 主要コンポーネント

```text
GitRepositoryService
  - getRefs()
  - getCommits()
  - getCommitDetail()
  - getDiff()
  - compareRefs()

GitWatcher
  - watch .git files
  - debounce events
  - refresh snapshot
  - detect changes

GitEventBus
  - publish event
  - subscribe per repo
  - broadcast to SSE/WebSocket clients

GitCommandRunner
  - safe command execution
  - timeout
  - argument validation
  - output parser
```

## 更新検知フロー

```text
1. 起動時に refs snapshot を作成
2. .git 配下の変更を監視
3. 変更イベントを debounce
4. git for-each-ref などで refs を再取得
5. 前回 snapshot と比較
6. branch/tag の追加・削除・更新を検出
7. old..new で新規コミットを取得
8. SSE/WebSocketで配信
9. snapshotを更新
```

---

# 14. セキュリティ設計

Gitログビュアーはローカルファイルや社内コードを扱うため、セキュリティを強めに設計します。

## 必須対策

* 任意パスを直接受け取らない
* リポジトリはサーバー側の allowlist に登録
* APIの `repoId` から実パスへ解決
* shell文字列連結を禁止
* Gitコマンドは引数配列で実行
* コマンドtimeoutを設定
* 大きすぎるdiffを制限
* private repoの場合は認証必須
* author emailなどの個人情報表示を権限で制御
* `.git/config` の任意remote実行に注意
* UIから危険なGit操作を実行させない

悪い例:

```ts
exec(`git -C ${path} log ${userInput}`);
```

良い例:

```ts
spawn("git", [
  "-C",
  repoPath,
  "log",
  "--max-count",
  String(limit),
  branchName,
]);
```

---

# 15. パフォーマンス設計

## 問題

巨大リポジトリでは、以下が重くなります。

* 数万件以上のcommit表示
* 複雑なbranch graph
* 大きなdiff
* 全ブランチ横断検索
* merge commitの多い履歴

## 対策

### 1. ページング

```http
GET /commits?limit=100&cursor=...
```

### 2. 仮想スクロール

画面に見えているコミットだけDOM描画します。

### 3. commit detailは遅延取得

一覧では軽量データのみ取得。

```text
一覧: hash, subject, author, date, parents
詳細: message body, files, diff
```

### 4. 差分はさらに遅延取得

コミットをクリックしても、最初はファイル一覧だけ表示。
diffはファイルを開いた時点で取得します。

### 5. キャッシュ

```text
refs snapshot
recent commits
commit detail
diff summary
branch graph layout
```

### 6. イベントのdebounce

Git操作中は `.git` 配下に複数の変更が発生するため、すぐにイベント化せず、短い待ち時間でまとめます。

```text
watch event
watch event
watch event
  ↓ debounce 300ms
refresh once
```

---

# 16. ブランチグラフ設計

## MVP

最初は高度なグラフ描画をしすぎず、以下で十分です。

```text
● a1b2c3d main
│
● 9e8f7a6
│
├─● 6d5c4b3 feature/login
│ │
│ ● 5c4b3a2
│/
● 4b3a291
```

## 実装方針

コミットごとに `parents` を持たせ、UI側で列を割り当てます。

```ts
type GraphNode = {
  hash: string;
  parents: string[];
  lane: number;
  colorIndex: number;
};
```

最初のリリースでは、完全なGitKraken風の描画よりも、以下を優先します。

* mainlineが読みやすい
* mergeが分かる
* 現在のbranch位置が分かる
* force push時に壊れない

---

# 17. 推奨技術スタック

## フロントエンド

```text
React / Vue / Svelte のいずれか
TypeScript
仮想スクロール
SSE client
Diff viewer component
```

Reactを使う場合の構成例:

```text
src/
  components/
    RepoSelector.tsx
    BranchSidebar.tsx
    CommitTimeline.tsx
    CommitCard.tsx
    CommitGraph.tsx
    CommitDetail.tsx
    DiffViewer.tsx
    LiveUpdateBanner.tsx

  hooks/
    useCommits.ts
    useGitEvents.ts
    useCommitDetail.ts

  stores/
    gitLogStore.ts

  api/
    gitLogApi.ts
```

## バックエンド

```text
Node.js / Go / Rust / Python
```

個人的には次のどちらかが良いです。

### 案A: Node.js + TypeScript

Web UIとの親和性が高く、SSEやWebSocket、Gitコマンド実行、ファイル監視を実装しやすいです。

```text
Fastify / Express
child_process.spawn
fs.watch / chokidar
SSE endpoint
```

### 案B: Go

単一バイナリ化しやすく、社内ツールやローカル開発者向けツールとして配布しやすいです。

```text
net/http
os/exec
fsnotify
SSE endpoint
```

---

# 18. MVP仕様

最初のリリースでは、以下に絞るのが良いです。

## MVP機能

* リポジトリ選択
* ブランチ選択
* 最新100件のcommit表示
* commit詳細表示
* 変更ファイル一覧
* diff表示
* 新規commitのリアルタイム通知
* force push / rebase / reset の検出
* message / author / hash検索

## MVPでは後回し

* 完全なグラフ描画
* 高度な全文検索インデックス
* UIからのGit操作
* 複数ユーザー共同閲覧
* blame表示
* PR / Issue連携
* AI要約

---

# 19. 最小構成の画面遷移

```text
/repositories
  ↓
/repositories/:repoId
  ↓
/repositories/:repoId/branches/:branch
  ↓
/repositories/:repoId/commits/:hash
```

ただし、実際のUIはSPAで以下のように扱うと使いやすいです。

```text
/repos/frontend?branch=main&commit=a1b2c3d
```

---

# 20. 設計上の重要ポイント

このプロダクトで一番大事なのは、**リアルタイム性そのものよりも、履歴が変わった時にUIを壊さないこと**です。

特にGitでは以下が普通に起きます。

* commit追加
* branch移動
* tag追加
* branch削除
* rebase
* reset
* force push
* merge
* squash merge

そのため、イベントは単なる `new_commit` ではなく、次のように分類します。

```text
commit_added
ref_updated
ref_deleted
tag_added
history_rewritten
repository_refreshed
```

---

# まとめ

おすすめ設計はこれです。

```text
Frontend:
  Web UI + 仮想スクロール + SSE購読

Backend:
  Git command runner + .git監視 + refs snapshot比較 + event bus

Realtime:
  SSEを基本採用
  双方向操作が必要になったらWebSocketへ拡張

Git取得:
  git rev-list / git log / git show / git diff-tree

UI:
  左: repo / branch / tag
  中央: commit timeline + graph
  右または下: commit detail / files / diff

重要:
  force push / rebase / resetを必ず検出する
```

最初は **「最新コミットをリアルタイムに追える軽量ビューアー」** として作り、次に **ブランチグラフ、検索、diff、履歴書き換え検出** を強化していくのが良いです。

[1]: https://git-scm.com/docs/git-rev-list "Git - git-rev-list Documentation"
[2]: https://git-scm.com/docs/pretty-formats "Git - pretty-formats Documentation"
[3]: https://developer.mozilla.org/ja/docs/Web/API/Server-sent_events/Using_server-sent_events "サーバー送信イベントの使用 - Web API | MDN"
[4]: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API "WebSocket API (WebSockets) - Web APIs | MDN"

