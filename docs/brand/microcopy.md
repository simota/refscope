# Refscope — Microcopy

This is the authoritative copy deck for Refscope. Every string is paired with its Japanese counterpart. Strings here override any draft text currently in `mock/src/app/components/refscope/`. The replacement mapping at the end of this document is the migration list for existing components.

All copy follows `voice-and-tone.md`. If a string here conflicts with that guide, the guide wins and this file must be updated.

Convention:
- **EN** = English source string.
- **JA** = Japanese counterpart.
- Strings in `code` are literal UI text. Strings in {curly braces} are interpolated values.
- A11y notes mark anything a screen reader will announce.

---

## 1. Empty states

### 1.1 No commits returned for the selected ref
- **EN — Title:** `No commits to show`
- **EN — Body:** `This ref resolved, but the log is empty for the current filters.`
- **JA — Title:** `表示できる commit はありません`
- **JA — Body:** `この ref は解決できましたが、現在のフィルタでは log が空です。`

### 1.2 Filter matched zero commits
- **EN — Title:** `No matching commits`
- **EN — Body:** `Try a wider range, or clear the author and path filters.`
- **JA — Title:** `条件に一致する commit はありません`
- **JA — Body:** `期間を広げるか、author と path のフィルタを解除できます。`

### 1.3 No refs in repository
- **EN — Title:** `This repository has no refs yet`
- **EN — Body:** `Refscope is connected, but no branches or tags have been observed.`
- **JA — Title:** `この repository には ref がまだありません`
- **JA — Body:** `Refscope は接続できていますが、branch も tag も観測できていません。`

### 1.4 First-run, no repository selected
- **EN — Title:** `Pick a repository to start observing`
- **EN — Body:** `Choose an allowlisted repo from the top bar. Refscope will record refs and history without modifying anything.`
- **JA — Title:** `観測を始める repository を選んでください`
- **JA — Body:** `top bar から allowlist の repository を選べます。Refscope は ref と history を記録するだけで、何も変更しません。`

---

## 2. Status badges

These labels are normalized vocabulary. Do not invent synonyms in code.

| Label (EN) | Label (JA) | When it shows | A11y announcement (EN) |
|------------|-----------|---------------|------------------------|
| `New` | `新規` | A ref appeared since this session began. | `New ref` |
| `Rewritten` | `書き換え` | The ref's tip changed AND the previous tip is no longer reachable from the new tip. | `History rewritten` |
| `Force-pushed` | `force-push` | Same as Rewritten, **and** the source-of-detection was a remote update event. Use only when this evidence exists. | `Force pushed` |
| `Merge` | `merge` | Commit has 2+ parents. | `Merge commit` |
| `Signature unknown` | `署名未確認` | Refscope does not verify signatures. Default for every commit. | `Signature not verified` |
| `Error` | `エラー` | Last operation on this row failed. Pair with a tooltip that states what failed. | `Error` |

Note on `rewritten` vs `force-pushed`: `Rewritten` is the safe default. Promote to `Force-pushed` only when the API has direct evidence (e.g., the SSE source was a remote ref-update event). When in doubt, stay at `Rewritten`.

---

## 3. Rewrite notice (banner / detail panel / observation log)

The product never says "alert". The pattern is: state the observation, then label it, then offer the recoverable hash.

### 3.1 Sidebar banner (single ref)
- **EN — Heading:** `History rewritten on {refName}`
- **EN — Body:** `Previous tip {prevShort} is no longer reachable from {currentShort}. Observed at {timestamp}.`
- **JA — Heading:** `{refName} の履歴を書き換え`
- **JA — Body:** `以前の tip `{prevShort}` は `{currentShort}` から到達できません。観測時刻: {timestamp}。`

### 3.2 Detail panel (after the user opens the rewritten ref)
- **EN — Section title:** `Observation log`
- **EN — Fact rows (label / value):**
  - `Ref` / `{refName}`
  - `Previous tip` / `{prevHash}`
  - `Current tip` / `{currentHash}`
  - `Observed` / `{timestamp}`
  - `Source` / `{sourceLabel}`
- **EN — Inferred label:** `Pattern matches: history rewritten`
- **EN — Recovery hint:** `The previous tip {prevShort} is still in this repository's reflog. Run \`git reflog show {refName}\` to inspect.`
- **JA — Section title:** `観測ログ`
- **JA — Inferred label:** `観測パターン: 履歴の書き換え`
- **JA — Recovery hint:** `以前の tip `{prevShort}` は reflog に残っています。`git reflog show {refName}` で確認できます。`

A11y note: the section uses `aria-labelledby` pointing to the section title; do not put the long observation text in `aria-label`.

### 3.3 Inline incident note (compact list row)
- **EN:** `{refName} — rewritten {relativeTime} ago`
- **JA:** `{refName} — {relativeTime} 前に書き換え`

---

## 4. Error messages (What / Why / Next)

Five canonical errors. Each has the structure: one sentence stating what was attempted and what blocked it, then one sentence with the next step.

### 4.1 API request failed
- **EN — Title:** `Couldn't reach the Refscope API`
- **EN — Body:** `The request to {endpoint} did not respond. Check that the API process is running on {apiBaseUrl}, then retry.`
- **JA — Title:** `Refscope API に到達できませんでした`
- **JA — Body:** `{endpoint} への request に応答がありません。{apiBaseUrl} で API process が起動していることを確認してから再試行できます。`

### 4.2 Ref could not be resolved
- **EN — Title:** `Couldn't resolve ref {refName}`
- **EN — Body:** `Git did not return an object id for this ref. The ref may have been deleted, or the name may contain characters Refscope rejects. Pick another ref or refresh the list.`
- **JA — Title:** `ref `{refName}` を解決できませんでした`
- **JA — Body:** `Git はこの ref の object id を返しませんでした。ref が削除されたか、名前に Refscope が受け付けない文字が含まれている可能性があります。別の ref を選ぶか、一覧を更新できます。`

### 4.3 Git command timed out
- **EN — Title:** `Git command timed out after {timeoutSec}s`
- **EN — Body:** `The {gitCommand} call did not complete within the configured limit. Large histories may need a higher \`RTGV_GIT_TIMEOUT_MS\`. Retry, or narrow the request with a path or author filter.`
- **JA — Title:** `Git command が {timeoutSec} 秒で timeout`
- **JA — Body:** `{gitCommand} は設定上限内に完了しませんでした。大きな history では `RTGV_GIT_TIMEOUT_MS` の引き上げを検討できます。再試行するか、path や author フィルタで範囲を絞れます。`

### 4.4 CORS rejected (the Mina pain point)
- **EN — Title:** `Browser blocked the request`
- **EN — Body:** `The API at {apiBaseUrl} rejected this origin. Add `{currentOrigin}` to `RTGV_ALLOWED_ORIGINS` in the API environment, then restart the API.`
- **EN — Inline help:** `Example: \`RTGV_ALLOWED_ORIGINS=http://127.0.0.1:5173\``
- **JA — Title:** `Browser が request を blocked しました`
- **JA — Body:** `{apiBaseUrl} の API はこの origin を許可していません。API 側の環境変数 `RTGV_ALLOWED_ORIGINS` に `{currentOrigin}` を追加し、API を再起動できます。`
- **JA — Inline help:** `例: `RTGV_ALLOWED_ORIGINS=http://127.0.0.1:5173``

### 4.5 Repository not in allowlist
- **EN — Title:** `Repository `{repoId}` is not allowlisted`
- **EN — Body:** `The API only serves repos listed in `RTGV_REPOS`. Add `{repoId}=<absolute git path>` to that variable, then restart the API.`
- **JA — Title:** `repository `{repoId}` は allowlist にありません`
- **JA — Body:** `API は `RTGV_REPOS` に登録された repository だけを公開します。`{repoId}=<絶対パス>` を `RTGV_REPOS` に追加し、API を再起動できます。`

---

## 5. CORS / allowlist rescue copy (Mina's biggest pain point)

When the UI detects a CORS or allowlist failure, surface a guided panel rather than a raw error.

- **EN — Panel heading:** `Refscope can see the API, but the API isn't accepting this origin yet.`
- **EN — Step 1:** `Open the file or shell where you start the API.`
- **EN — Step 2:** `Set \`RTGV_ALLOWED_ORIGINS\` to include \`{currentOrigin}\`.`
- **EN — Step 3:** `Restart the API process. Refscope will resume on its own.`
- **EN — Footer link label:** `Read the full CORS notes`
- **JA — Panel heading:** `API には到達できていますが、この origin はまだ許可されていません。`
- **JA — Step 1:** `API を起動しているファイルまたは shell を開きます。`
- **JA — Step 2:** `環境変数 `RTGV_ALLOWED_ORIGINS` に `{currentOrigin}` を含めます。`
- **JA — Step 3:** `API process を再起動します。Refscope は自動で観測を再開します。`
- **JA — Footer link label:** `CORS の詳細を読む`

A11y: the steps are an `<ol>`; the heading is the panel's accessible name via `aria-labelledby`.

---

## 6. Pause / Resume

### 6.1 Buttons
- **EN:** `Pause live updates` / `Resume live updates`
- **JA:** `live 更新を一時停止` / `live 更新を再開`

### 6.2 Inline status
- **EN — When paused:** `Live updates paused. New observations will appear when you resume.`
- **JA — When paused:** `live 更新を一時停止しています。再開すると新しい観測が表示されます。`

### 6.3 Live region announcements (aria-live="polite")
- **EN — On pause:** `Live updates paused.`
- **EN — On resume:** `Live updates resumed.`
- **EN — On new commit while live:** `New commit on {refName}.`
- **EN — On rewrite while live:** `History rewritten on {refName}.`
- **JA — On pause:** `live 更新を一時停止しました。`
- **JA — On resume:** `live 更新を再開しました。`
- **JA — On new commit while live:** `{refName} に新しい commit。`
- **JA — On rewrite while live:** `{refName} の履歴が書き換えられました。`

A11y: do **not** announce pause/resume in `aria-live="assertive"` — these are not interruptions.

---

## 7. Command palette (Cmd/Ctrl+K)

### 7.1 Placeholder
- **EN:** `Type a command, ref, or hash`
- **JA:** `command, ref, hash を入力`

### 7.2 Empty hint (no input yet)
- **EN:** `Try: pause, resume, copy hash, refresh working tree`
- **JA:** `例: pause、resume、copy hash、refresh working tree`

### 7.3 No results
- **EN:** `No commands match. Press Esc to close.`
- **JA:** `一致する command はありません。Esc で閉じられます。`

### 7.4 Command labels and descriptions
| EN label | EN description | JA label | JA description |
|----------|---------------|----------|----------------|
| `Pause live updates` | `Stop receiving real-time observations.` | `live 更新を一時停止` | `real-time 観測の受信を止めます。` |
| `Resume live updates` | `Resume receiving real-time observations.` | `live 更新を再開` | `real-time 観測の受信を再開します。` |
| `Copy current commit hash` | `Copy the full hash of the selected commit.` | `現在の commit hash をコピー` | `選択中の commit の full hash をコピーします。` |
| `Clear author filter` | `Show commits from all authors.` | `author フィルタを解除` | `すべての author の commit を表示します。` |
| `Clear path filter` | `Show commits touching all paths.` | `path フィルタを解除` | `すべての path の commit を表示します。` |
| `Refresh working tree` | `Re-read staged and unstaged changes.` | `working tree を再読み込み` | `staged と unstaged の変更を読み直します。` |
| `Toggle quiet mode` | `Suppress non-essential live announcements.` | `quiet mode を切り替え` | `重要でない live 通知を抑えます。` |
| `Show keyboard shortcuts` | `Open the shortcuts reference.` | `keyboard shortcut を表示` | `shortcut の一覧を開きます。` |

A11y: each command row uses `aria-labelledby` pointing to the label; the description is in `aria-describedby`. Never put the description in `aria-label`.

---

## 8. First-run welcome message

Two short paragraphs. No bullet points, no exclamation marks, no marketing.

- **EN:**
  > `Welcome. Refscope is an observatory for your repository — it watches refs and history, records what changes, and stays out of the way.`
  >
  > `Pick a repository above to start. Refscope reads from Git only; it never writes back.`
- **JA:**
  > `Refscope へようこそ。Refscope は repository の観測所です。ref と history を見守り、変化を記録し、邪魔をしません。`
  >
  > `上で repository を選ぶと観測が始まります。Refscope は Git を読むだけで、書き込みはしません。`

---

## 9. Footer / About

- **EN:** `Refscope — a quiet observatory for Git refs and history. Local-first, read-only, allowlist-scoped.`
- **JA:** `Refscope — Git の ref と history を静かに観測する観測所。local-first、read-only、allowlist でスコープを限定。`

---

## 10. CLI / README / GitHub description (one-liner)

Used in the GitHub repository description field, package descriptions, and the README first line. Must fit GitHub's 350-character description limit; aim for under 120.

- **EN:** `Refscope — a local, read-only observatory for Git refs and history. Watches allowlisted repositories in real time and records what changes.`
- **JA:** `Refscope — Git の ref と history を観測する local の read-only 観測所。allowlist の repository を real-time で見守り、変化を記録します。`

---

## 11. Naming conventions — feature names (EN/JA fixed translations)

These names are fixed. Do not paraphrase them in any UI surface.

| English | 日本語 (固定訳) |
|---------|----------------|
| Compare bar | compare bar |
| Ref selector | ref selector |
| Command palette | command palette |
| Rewrite notice (was: rewrite alert) | 書き換え通知 |
| Live updates | live 更新 |
| Working tree view | working tree view |
| Observation log | 観測ログ |
| Period summary | 期間サマリ |
| File history | file history |
| Quiet mode | quiet mode |
| CVD-safe palette | CVD-safe palette |
| Pinned refs | pin した ref |
| Allowlisted repository | allowlist の repository |

Note: feature names that are themselves Git terminology (`branch`, `tag`, `ref`, `commit`, `working tree`, `stash`, `worktree`, `submodule`, `reflog`) stay in lower-case Latin script in Japanese surfaces — they are technical nouns the audience already reads in English.

---

## 12. Replacement mapping (current strings → recommended strings)

This is the migration list. Each row is a string that exists in `mock/src/app/components/refscope/` today and the recommended replacement. Apply during the next copy-pass; coordinate with Artisan/Builder so component logic that branches on string values is updated atomically.

| # | File | Current string | Recommended (EN) | Recommended (JA) | Reason |
|---|------|---------------|------------------|------------------|--------|
| 1 | `TopBar.tsx` (~L116) | `Quiet mode on` / `Quiet mode off` | `Quiet mode on` / `Quiet mode off` (keep) — but pair with a11y `Quiet mode is on` / `Quiet mode is off` | `quiet mode 有効` / `quiet mode 無効` | Existing string is acceptable; explicit a11y form must be added because "on/off" alone is ambiguous to screen readers. |
| 2 | `TopBar.tsx` (~L335) | `LIVE` | `Live` (sentence case in source; CSS may render uppercase) | `live` | Section 4 of voice guide: source strings are sentence case; ALL CAPS is a CSS treatment, not a spelling. |
| 3 | `CommitTimeline.tsx` (~L125) | `API error` | `Couldn't reach the Refscope API` (with body from §4.1) | `Refscope API に到達できませんでした` | "API error" gives no recovery path. Use What/Why/Next from §4.1. |
| 4 | `CommitTimeline.tsx` (~L128) | `Selection changed` | `Selection updated` (title) + body `The selected ref or filter changed; the list now reflects the new selection.` | title `選択を更新しました` + body `選択中の ref またはフィルタが変わり、一覧に反映されています。` | "Changed" reads alarmist; "updated" is neutral and observational. |
| 5 | `CommitTimeline.tsx` (~L130) | `Realtime update` | `Live update` | `live 更新` | Normalize to the fixed feature name (§11). |
| 6 | `CommitTimeline.tsx` (~L159) | `Loading commits` / `Reading allowlisted repository history.` | `Loading commits…` / `Reading history from the allowlisted repository.` | `commit を読み込み中…` / `allowlist の repository から history を読んでいます。` | Add the in-progress ellipsis (§4 EN style). Rephrase body to active voice with explicit subject. |
| 7 | `CommitTimeline.tsx` (~L196 via `data.ts`) | `No commits` / `No commits were returned for the selected ref.` | Use §1.1 (`No commits to show` / `This ref resolved, but the log is empty for the current filters.`) | §1.1 JA equivalents | Aligns with the canonical empty state. |
| 8 | `CommandPalette.tsx` (~L98) | `Copy failed` (status) | `Couldn't copy to clipboard` | `clipboard にコピーできませんでした` | Blameless, full-sentence error; no truncated-fragment style. |
| 9 | `CommandPalette.tsx` (~L177) | `Commit hash copied` | `Copied commit hash to clipboard` | `commit hash を clipboard にコピーしました` | Active voice with object; screen reader parses better. |
| 10 | `CommandPalette.tsx` (~L398) | `Command failed` | `Couldn't run command. Try again, or open the shortcuts reference.` | `command を実行できませんでした。再試行するか、shortcut 一覧を開けます。` | What/Why/Next; gives a recovery path. |
| 11 | `CommandPalette.tsx` (~L430) | `Type a command…` | `Type a command, ref, or hash` | `command, ref, hash を入力` | Tells the user what the palette accepts; matches §7.1. |
| 12 | `BranchSidebar.tsx` (~L301) | section title `ALERTS` (tone="warning") | source string `Notices` (CSS uppercase rendering preserved) | `観測ノート` | "Alerts" violates §6 of the voice guide. "Notices" preserves the observational stance; the warning tone is conveyed by colour/icon, not by the word. |
| 13 | `BranchSidebar.tsx` (~L458) | `History rewritten on {refName}` (aria-label) | Keep as visible text; **also** set `aria-labelledby` to the visible heading rather than duplicating in `aria-label` | 同上 (Japanese visible text per §3.1) | Duplicating text in `aria-label` defeats screen-reader translation; reference the visible node instead. |
| 14 | `DetailPanel.tsx` (~L254) | `No file changes returned for this commit.` | `This commit has no file changes recorded.` | `この commit には記録された file 変更がありません。` | Active voice; states what is true rather than what an API "did not return". |
| 15 | `DetailPanel.tsx` (~L724) | `Signed` (when status is `valid` or unknown) | `Signature unknown` for unknown; reserve `Signed` only when the API explicitly reports a verified signature (currently never, per spec) | `署名未確認` / (将来) `署名済み` | Spec forbids signature verification; UI must not assert `Signed`. Use §2 normalized vocabulary. |

---

## Appendix — readability and review checklist

Before merging any UI string change:

1. Read the string aloud. Does it sound like an alarm? Rewrite.
2. Run it through Flesch-Kincaid; target Grade Level 9-11.
3. Pair every error with a recovery action (What / Why / Next).
4. Check screen-reader output: does the announcement still parse without surrounding visual context?
5. Confirm the Japanese counterpart exists in this file. If absent, add it before merging.
6. Verify no banned word from `voice-and-tone.md` §6 appears in either language.
