import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowRight } from "lucide-react";
import {
  fetchSymbolHistory,
  type SymbolHistoryEntry,
  type SymbolHistoryResponse,
} from "../../api";
import { LensHeader } from "./LensHeader";
import {
  EmptyStateCard,
  type EmptyStateMessage,
  type LensEmptyReason,
} from "./EmptyStateCard";
import type { LensId } from "./LensSwitcher";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "error"; message: string; hint?: string }
  | { kind: "success"; data: SymbolHistoryResponse };

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function formatTime(isoDate: string): string {
  const d = new Date(isoDate);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ---------------------------------------------------------------------------
// Self-explanation (LensHeader.helpContent / EmptyStateCard messages)
// ---------------------------------------------------------------------------

function SymbolHelpContent() {
  return (
    <>
      <div style={{ fontWeight: 600, marginBottom: 6, color: "var(--rs-text)" }}>
        Symbol Lens の見方
      </div>
      <div style={{ color: "var(--rs-text-secondary)", marginBottom: 8 }}>
        指定したファイル内の <strong>関数 / メソッド 1 つ</strong> の履歴を
        Git の <code style={{ fontFamily: "var(--rs-mono)" }}>git log -L</code>{" "}
        で辿ります。Refscope は推論を行わず、Git の出力をそのまま観測します。
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--rs-text)" }}>
        構文
      </div>
      <div
        style={{
          fontFamily: "var(--rs-mono)",
          color: "var(--rs-text)",
          marginBottom: 8,
          padding: "4px 8px",
          background: "var(--rs-bg-canvas)",
          borderRadius: "var(--rs-radius-sm)",
        }}
      >
        git log -L :&lt;funcname&gt;:&lt;path&gt;
      </div>
      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--rs-text)" }}>
        入力例
      </div>
      <ul
        style={{
          margin: "0 0 8px 16px",
          padding: 0,
          color: "var(--rs-text-secondary)",
          lineHeight: 1.6,
        }}
      >
        <li>
          Go:{" "}
          <code style={{ fontFamily: "var(--rs-mono)" }}>src/parser/scope.go</code> ×{" "}
          <code style={{ fontFamily: "var(--rs-mono)" }}>parseRefScope</code>
        </li>
        <li>
          TS:{" "}
          <code style={{ fontFamily: "var(--rs-mono)" }}>apps/ui/src/app/App.tsx</code> ×{" "}
          <code style={{ fontFamily: "var(--rs-mono)" }}>useSymbolHistory</code>
        </li>
        <li>
          Python:{" "}
          <code style={{ fontFamily: "var(--rs-mono)" }}>lib/scope.py</code> ×{" "}
          <code style={{ fontFamily: "var(--rs-mono)" }}>_resolve_scope</code>
        </li>
      </ul>
      <div style={{ fontWeight: 600, marginBottom: 4, color: "var(--rs-text)" }}>
        範囲と制約
      </div>
      <ul
        style={{
          margin: "0 0 8px 16px",
          padding: 0,
          color: "var(--rs-text-secondary)",
          lineHeight: 1.6,
        }}
      >
        <li>追跡対象は関数 / メソッドのみ (変数は不可)</li>
        <li>rename は Git の literal diff (heuristic similarity) に依存</li>
        <li>HEAD 由来の履歴を server 側上限で打ち切り</li>
      </ul>
      <div style={{ color: "var(--rs-text-muted)", fontSize: 11 }}>
        observation only — refscope は書き込み操作を行いません。
      </div>
    </>
  );
}

const SYMBOL_EMPTY_MESSAGES: Partial<Record<LensEmptyReason, EmptyStateMessage>> = {
  "symbol-idle": {
    title: "関数 / メソッドの履歴を辿る",
    body: "ファイルパスとシンボル名 (関数 / メソッド名) を入力すると、git log -L で履歴を表示します。? アイコンに入力例が載っています。",
  },
  "symbol-no-result": {
    title: "該当するコミットが見つかりませんでした",
    body: "シンボル名の綴り違い、ファイルパスの相違、または現 HEAD で該当する関数が見つからない可能性があります。Stream や Hotspot でファイル全体の履歴を確認してください。",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function CommitEntry({ entry }: { entry: SymbolHistoryEntry }) {
  const hasRename = entry.renameInfo !== null;
  return (
    <article
      style={{
        borderBottom: "1px solid var(--rs-border)",
        padding: "10px 14px",
      }}
    >
      {/* Rename indicator */}
      {hasRename && entry.renameInfo && (
        <div
          role="note"
          aria-label="File renamed at this commit"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            marginBottom: 6,
            padding: "3px 8px",
            borderRadius: "var(--rs-radius-sm)",
            background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 8%)",
            border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 30%)",
            fontSize: 11,
            color: "var(--rs-accent)",
          }}
        >
          <ArrowRight size={11} aria-hidden />
          <span>
            Renamed from{" "}
            <code
              style={{
                fontFamily: "var(--rs-mono)",
                background: "var(--rs-bg-code)",
                padding: "0 3px",
                borderRadius: 3,
              }}
            >
              {entry.renameInfo.from}
            </code>
            {" → "}
            <code
              style={{
                fontFamily: "var(--rs-mono)",
                background: "var(--rs-bg-code)",
                padding: "0 3px",
                borderRadius: 3,
              }}
            >
              {entry.renameInfo.to}
            </code>
            {entry.renameInfo.similarity !== null && (
              <span style={{ color: "var(--rs-text-secondary)", marginLeft: 4 }}>
                ({entry.renameInfo.similarity}% similar — Git literal)
              </span>
            )}
          </span>
        </div>
      )}

      {/* Commit subject */}
      <p
        style={{
          margin: 0,
          fontSize: 13,
          fontWeight: 500,
          color: "var(--rs-text)",
          lineHeight: 1.4,
        }}
      >
        {entry.subject}
      </p>

      {/* Commit body */}
      {entry.body && (
        <pre
          style={{
            margin: "4px 0 0",
            fontSize: 11,
            color: "var(--rs-text-secondary)",
            fontFamily: "var(--rs-sans)",
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            lineHeight: 1.5,
            maxHeight: 80,
            overflow: "hidden",
          }}
        >
          {entry.body}
        </pre>
      )}

      {/* Meta row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginTop: 5,
          fontSize: 11,
          color: "var(--rs-text-secondary)",
        }}
      >
        <code
          style={{
            fontFamily: "var(--rs-mono)",
            background: "var(--rs-bg-code)",
            padding: "1px 4px",
            borderRadius: 3,
            fontSize: 10,
          }}
        >
          {entry.shortHash}
        </code>
        <span>{entry.author}</span>
        <time dateTime={entry.authorDate} title={entry.authorDate}>
          {formatDate(entry.authorDate)} {formatTime(entry.authorDate)}
        </time>
      </div>
    </article>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

/**
 * Symbol History View (D-1)
 *
 * Displays the commit history for a named symbol (function / method) in a file,
 * using `git log -L :<funcname>:<path>` on the API side.
 *
 * Boundary discipline:
 * - All data is observed Git output, never inferred by Refscope.
 * - Rename evidence comes from Git's literal diff output (no Refscope heuristics).
 * - Inputs are validated in the API layer; this component only passes user input
 *   to `fetchSymbolHistory` which forwards it via URL params.
 */
export function SymbolHistoryView({
  repoId,
  query,
  onQueryChange,
  onChangeLens,
}: {
  repoId: string;
  /** Current search query. null = show the empty input form. */
  query: { path: string; funcname: string } | null;
  /** Called when the user submits a new search. */
  onQueryChange: (q: { path: string; funcname: string } | null) => void;
  /** Optional sibling Lens routing for EmptyStateCard.relatedLenses. */
  onChangeLens?: (lens: LensId) => void;
}) {
  const [loadState, setLoadState] = useState<LoadState>({ kind: "idle" });
  const [localPath, setLocalPath] = useState(query?.path ?? "");
  const [localFuncname, setLocalFuncname] = useState(query?.funcname ?? "");
  const [validationMessage, setValidationMessage] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const pathInputRef = useRef<HTMLInputElement | null>(null);

  // Sync local inputs when parent changes query
  useEffect(() => {
    if (query) {
      setLocalPath(query.path);
      setLocalFuncname(query.funcname);
    }
  }, [query]);

  // mount: query 未指定 (=これから検索する) のときだけ path input にフォーカス。
  // 旧実装は close ボタンに自動フォーカスしていたが、能動検索 Lens の意図と逆。
  // WAI-ARIA APG の search dialog パターンに整合させ、検索フォーム入口へ案内する。
  useEffect(() => {
    if (query == null) {
      pathInputRef.current?.focus();
    }
    // 意図的に空依存配列 — マウント時 1 回のみ。query 変化での再フォーカスはしない。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch when query changes
  useEffect(() => {
    if (!query || !repoId) {
      setLoadState({ kind: "idle" });
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setLoadState({ kind: "loading" });

    fetchSymbolHistory(
      repoId,
      { path: query.path, funcname: query.funcname },
      controller.signal,
    )
      .then((data) => {
        if (controller.signal.aborted) return;
        setLoadState({ kind: "success", data });
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        const message =
          err instanceof Error ? err.message : String(err);
        // Surface any hint from the server-side 404 response
        const hint =
          err instanceof Error && "hint" in err
            ? String((err as { hint?: unknown }).hint)
            : undefined;
        setLoadState({ kind: "error", message, hint });
      });

    return () => {
      controller.abort();
    };
  }, [repoId, query]);

  const handleSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      const trimPath = localPath.trim();
      const trimFuncname = localFuncname.trim();
      if (!trimPath || !trimFuncname) {
        setValidationMessage("ファイルパスとシンボル名の両方を入力してください。");
        return;
      }
      setValidationMessage("");
      onQueryChange({ path: trimPath, funcname: trimFuncname });
    },
    [localPath, localFuncname, onQueryChange],
  );

  const handleClear = useCallback(() => {
    setLocalPath("");
    setLocalFuncname("");
    setValidationMessage("");
    onQueryChange(null);
    setLoadState({ kind: "idle" });
  }, [onQueryChange]);

  // 結果件数を SR に通知するためのテキスト。
  // 旧実装は results コンテナ全体に aria-live="polite" を当てており、commit
  // 一覧の追加要素すべてが冗長に読み上げられていた。件数のみを polite に通知。
  const statusText: string = (() => {
    if (loadState.kind === "loading") return "履歴を取得中";
    if (loadState.kind === "success") {
      const n = loadState.data.entries.length;
      const truncated = loadState.data.truncated ? " (一部省略)" : "";
      return `${n} 件のコミットが見つかりました${truncated}`;
    }
    return "";
  })();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        background: "var(--rs-bg-panel)",
        borderLeft: "1px solid var(--rs-border)",
        overflow: "hidden",
      }}
    >
      <style>{`
        .rs-symbol-input:focus-visible {
          outline: 2px solid var(--rs-accent);
          outline-offset: -1px;
        }
        .rs-symbol-btn:focus-visible {
          outline: 2px solid var(--rs-accent);
          outline-offset: 1px;
        }
      `}</style>

      {/* Lens self-explanation header */}
      <LensHeader
        title="Symbol"
        oneLiner="関数 / メソッド 1 つの履歴を git log -L で辿る"
        helpContent={<SymbolHelpContent />}
      />

      {/* SR-only status: 件数 / loading のみを polite 通知 */}
      <span
        role="status"
        aria-live="polite"
        style={{
          position: "absolute",
          width: 1,
          height: 1,
          padding: 0,
          margin: -1,
          overflow: "hidden",
          clip: "rect(0, 0, 0, 0)",
          whiteSpace: "nowrap",
          border: 0,
        }}
      >
        {statusText}
      </span>

      {/* Search form */}
      <form
        onSubmit={handleSubmit}
        aria-label="Symbol 検索フォーム"
        style={{
          padding: "10px 12px",
          borderTop: "1px solid var(--rs-border)",
          borderBottom: "1px solid var(--rs-border)",
          display: "flex",
          flexDirection: "column",
          gap: 6,
          flexShrink: 0,
        }}
      >
        <label
          htmlFor="sym-hist-path"
          style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
        >
          File path
        </label>
        <input
          id="sym-hist-path"
          ref={pathInputRef}
          type="text"
          value={localPath}
          onChange={(e) => setLocalPath(e.target.value)}
          placeholder="例: apps/ui/src/app/App.tsx"
          autoComplete="off"
          spellCheck={false}
          className="rs-symbol-input"
          style={{
            fontSize: 12,
            fontFamily: "var(--rs-mono)",
            padding: "4px 8px",
            borderRadius: "var(--rs-radius-sm)",
            border: "1px solid var(--rs-border)",
            background: "var(--rs-bg-input)",
            color: "var(--rs-text)",
            outline: "none",
          }}
        />
        <label
          htmlFor="sym-hist-func"
          style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
        >
          Symbol name (関数 / メソッド)
        </label>
        <input
          id="sym-hist-func"
          type="text"
          value={localFuncname}
          onChange={(e) => setLocalFuncname(e.target.value)}
          placeholder="例: parseRefScope"
          autoComplete="off"
          spellCheck={false}
          className="rs-symbol-input"
          style={{
            fontSize: 12,
            fontFamily: "var(--rs-mono)",
            padding: "4px 8px",
            borderRadius: "var(--rs-radius-sm)",
            border: "1px solid var(--rs-border)",
            background: "var(--rs-bg-input)",
            color: "var(--rs-text)",
            outline: "none",
          }}
        />
        {validationMessage && (
          <p
            role="status"
            aria-live="polite"
            style={{
              margin: 0,
              fontSize: 11,
              color: "var(--rs-warning, var(--rs-text-secondary))",
            }}
          >
            {validationMessage}
          </p>
        )}
        <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
          <button
            type="submit"
            disabled={!localPath.trim() || !localFuncname.trim()}
            className="rs-symbol-btn"
            style={{
              flex: 1,
              fontSize: 12,
              padding: "4px 10px",
              borderRadius: "var(--rs-radius-sm)",
              border: "1px solid var(--rs-border)",
              background: "var(--rs-accent)",
              color: "var(--rs-bg)",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            Search
          </button>
          {query && (
            <button
              type="button"
              onClick={handleClear}
              className="rs-symbol-btn"
              title="検索クエリと結果をクリアします"
              style={{
                fontSize: 12,
                padding: "4px 10px",
                borderRadius: "var(--rs-radius-sm)",
                border: "1px solid var(--rs-border)",
                background: "transparent",
                color: "var(--rs-text-secondary)",
                cursor: "pointer",
              }}
            >
              Clear
            </button>
          )}
        </div>
      </form>

      {/* Results — aria-live は外し、件数通知は上の SR-only status に集約 */}
      <div
        style={{ flex: 1, overflow: "auto" }}
        aria-busy={loadState.kind === "loading"}
      >
        {loadState.kind === "idle" && (
          <EmptyStateCard
            reason="symbol-idle"
            messages={SYMBOL_EMPTY_MESSAGES}
            onChangeLens={onChangeLens}
          />
        )}

        {loadState.kind === "loading" && (
          <p
            style={{
              padding: "20px 16px",
              fontSize: 12,
              color: "var(--rs-text-secondary)",
              textAlign: "center",
            }}
          >
            Tracing symbol history…
          </p>
        )}

        {loadState.kind === "error" && (
          <div
            role="alert"
            style={{
              padding: "16px",
              margin: "12px",
              borderRadius: "var(--rs-radius-sm)",
              border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-git-deleted) 40%)",
              background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-git-deleted) 8%)",
              fontSize: 12,
              color: "var(--rs-text)",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontWeight: 600,
                marginBottom: 4,
              }}
            >
              <AlertCircle size={13} aria-hidden style={{ flexShrink: 0 }} />
              {loadState.message}
            </div>
            {loadState.hint && (
              <p
                style={{
                  margin: 0,
                  color: "var(--rs-text-secondary)",
                  lineHeight: 1.5,
                }}
              >
                {loadState.hint}
              </p>
            )}
          </div>
        )}

        {loadState.kind === "success" && (
          <>
            {/* Summary bar */}
            <div
              style={{
                padding: "6px 14px",
                borderBottom: "1px solid var(--rs-border)",
                fontSize: 11,
                color: "var(--rs-text-secondary)",
                display: "flex",
                alignItems: "center",
                gap: 8,
              }}
            >
              <code
                style={{
                  fontFamily: "var(--rs-mono)",
                  background: "var(--rs-bg-code)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  color: "var(--rs-text)",
                  fontSize: 11,
                }}
              >
                {loadState.data.funcname}
              </code>
              <span>in</span>
              <code
                style={{
                  fontFamily: "var(--rs-mono)",
                  background: "var(--rs-bg-code)",
                  padding: "1px 4px",
                  borderRadius: 3,
                  color: "var(--rs-text)",
                  fontSize: 11,
                  maxWidth: 200,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={loadState.data.path}
              >
                {loadState.data.path}
              </code>
              <span style={{ marginLeft: "auto" }}>
                {loadState.data.entries.length} commit
                {loadState.data.entries.length !== 1 ? "s" : ""}
                {loadState.data.truncated && " (truncated)"}
              </span>
            </div>

            {/* No results */}
            {loadState.data.entries.length === 0 && (
              <EmptyStateCard
                reason="symbol-no-result"
                messages={SYMBOL_EMPTY_MESSAGES}
                onChangeLens={onChangeLens}
                relatedLenses={[
                  { id: "stream", label: "Stream で見る" },
                  { id: "hotspot", label: "Hotspot で見る" },
                ]}
              />
            )}

            {/* Commit list */}
            {loadState.data.entries.map((entry) => (
              <CommitEntry key={entry.hash} entry={entry} />
            ))}

            {/* Truncation notice */}
            {loadState.data.truncated && (
              <p
                style={{
                  padding: "8px 14px",
                  fontSize: 11,
                  color: "var(--rs-text-secondary)",
                  textAlign: "center",
                  borderTop: "1px solid var(--rs-border)",
                }}
              >
                先頭 {loadState.data.limit} 件まで表示しています。
                さらに古いコミットは server 側上限により省略されました。
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
