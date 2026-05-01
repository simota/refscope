import { useState } from "react";
import { Copy, ExternalLink, History, ShieldCheck } from "lucide-react";
import type { Commit, CommitDetail } from "./data";
import type { DiffPayload } from "../../api";
import { DiffViewer } from "./DiffViewer";
import { FileHistoryView } from "./FileHistoryView";

export function DetailPanel({
  commit,
  detail,
  diff,
  loading,
  error,
  diffFullscreen,
  onDiffFullscreenChange,
  repoId,
  refName,
}: {
  commit: Commit | null;
  detail: CommitDetail | null;
  diff: DiffPayload;
  loading: boolean;
  error: string;
  diffFullscreen?: boolean;
  onDiffFullscreenChange?: (next: boolean) => void;
  repoId: string;
  refName: string;
}) {
  const [copyStatus, setCopyStatus] = useState("");
  // History overlay is owned at the panel level so opening it while the diff
  // is loading or while the commit changes does not race the network calls.
  const [historyPath, setHistoryPath] = useState<string | null>(null);

  if (!commit) {
    return (
      <PanelShell>
        <Empty>No commit selected</Empty>
      </PanelShell>
    );
  }
  const authorName = detail?.author.name ?? commit.author;
  const authorDate = detail?.authorDate ?? commit.authorDate;
  const parents = detail?.parents ?? commit.parents ?? [];
  const refs = detail?.refs ?? commit.refs ?? [];
  const body = detail?.body ?? commit.body;
  const files = detail?.files ?? commit.files;
  const signatureStatus = detail?.signatureStatus ?? commit.signatureStatus;
  const signed = detail?.signed ?? commit.signed;
  const gitShowCommand = `git show --stat --patch ${commit.hash}`;

  async function copyToClipboard(label: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopyStatus(`${label} copied`);
      window.setTimeout(() => setCopyStatus(""), 1600);
    } catch {
      setCopyStatus("Copy failed");
      window.setTimeout(() => setCopyStatus(""), 1600);
    }
  }

  return (
    <PanelShell>
      <div
        className="px-4 flex items-center justify-between"
        style={{
          height: 40,
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <div
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            fontWeight: 600,
            color: "var(--rs-text-muted)",
          }}
        >
          COMMIT
        </div>
        <div className="flex items-center gap-1">
          {copyStatus ? (
            <span
              style={{
                fontSize: 11,
                color: "var(--rs-text-muted)",
                fontFamily: "var(--rs-mono)",
              }}
            >
              {copyStatus}
            </span>
          ) : null}
          <button
            className="rs-icon-btn"
            title="Copy git show command"
            onClick={() => void copyToClipboard("git show command", gitShowCommand)}
          >
            <ExternalLink size={13} />
          </button>
          <button
            className="rs-icon-btn"
            title="Copy commit hash"
            onClick={() => void copyToClipboard("Commit hash", commit.hash)}
          >
            <Copy size={13} />
          </button>
        </div>
      </div>

      <div className="overflow-y-auto" style={{ flex: 1 }}>
        <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--rs-border)" }}>
          <div
            style={{
              fontFamily: "var(--rs-mono)",
              fontSize: 12,
              color: "var(--rs-text-secondary)",
            }}
          >
            {commit.hash}
          </div>
          <h3
            style={{
              fontSize: 14,
              fontWeight: 600,
              color: "var(--rs-text-primary)",
              marginTop: 6,
              lineHeight: 1.4,
            }}
          >
            {commit.subject}
          </h3>
          {body ? (
            <p
              style={{
                fontSize: 12,
                color: "var(--rs-text-secondary)",
                marginTop: 8,
                lineHeight: 1.55,
              }}
            >
              {body}
            </p>
          ) : null}

          <dl
            className="grid mt-3"
            style={{
              gridTemplateColumns: "72px 1fr",
              rowGap: 6,
              columnGap: 12,
              fontSize: 12,
            }}
          >
            <Meta label="Author">
              {authorName}{" "}
              <span style={{ color: "var(--rs-text-muted)" }}>· {formatDate(authorDate)}</span>
            </Meta>
            <Meta label="Parents">
              <span style={{ fontFamily: "var(--rs-mono)" }}>
                {parents.length ? parents.join(", ") : "—"}
              </span>
            </Meta>
            <Meta label="Refs">
              <span className="flex flex-wrap gap-1">
                {refs.map((r) => (
                  <span
                    key={r}
                    className="px-1.5 rounded-full"
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--rs-mono)",
                      background:
                        "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 22%)",
                      color: "var(--rs-text-primary)",
                      border: "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                    }}
                  >
                    {r}
                  </span>
                ))}
                {signed ? (
                  <span
                    className="px-1.5 rounded-full inline-flex items-center gap-1"
                    aria-label={`Commit signature status: ${formatSignatureStatus(signatureStatus)}`}
                    style={{
                      fontSize: 10,
                      color: "var(--rs-accent)",
                      border:
                        "1px solid color-mix(in oklab, var(--rs-border), var(--rs-accent) 40%)",
                    }}
                  >
                    <ShieldCheck size={10} aria-hidden /> {formatSignatureStatus(signatureStatus)}
                  </span>
                ) : null}
              </span>
            </Meta>
          </dl>
        </div>

        {loading ? <Empty>Loading commit detail…</Empty> : null}
        {error ? <Empty>{error}</Empty> : null}

        <Section title="CHANGE GRAPH" hint={`${commit.added} / ${commit.deleted}`}>
          <ChangeGraph files={files} totalAdded={commit.added} totalDeleted={commit.deleted} />
        </Section>

        <Section title="FILE STATUS MIX" hint={`${files.length} files`}>
          <FileStatusMix files={files} />
        </Section>

        <Section title="CHANGED FILES" hint={`${files.length} files`}>
          {files.length === 0 ? (
            <Empty>{loading ? "Loading changed files…" : "No file changes returned for this commit."}</Empty>
          ) : (
            files.map((f) => (
              <div
                key={f.path}
                className="px-3 flex items-center gap-2"
                style={{
                  height: 28,
                  fontSize: 12,
                  fontFamily: "var(--rs-mono)",
                  borderBottom:
                    "1px solid color-mix(in oklab, var(--rs-border), transparent 60%)",
                }}
              >
                <FileBadge status={f.status} />
                <span
                  className="flex-1 truncate"
                  style={{ color: "var(--rs-text-primary)" }}
                >
                  {f.path}
                </span>
                <span style={{ color: "var(--rs-git-added)" }}>+{f.added}</span>
                <span style={{ color: "var(--rs-git-deleted)" }}>-{f.deleted}</span>
                <button
                  type="button"
                  className="rs-icon-btn"
                  aria-label={`Open file history for ${f.path}`}
                  title="Open file history"
                  // Disabled when we lack a repoId — the API needs both repo + path.
                  disabled={!repoId}
                  onClick={() => setHistoryPath(f.path)}
                  style={{ width: 22, height: 22 }}
                >
                  <History size={12} />
                </button>
              </div>
            ))
          )}
        </Section>

        <Section
          title="DIFF"
          hint={diff.truncated ? "truncated" : diff.diff ? "git show --patch" : "empty"}
        >
          {diff.diff || diff.truncated ? (
            <DiffViewer
              diff={diff.diff}
              truncated={diff.truncated}
              maxBytes={diff.maxBytes}
              commitHash={commit.hash}
              fullscreen={diffFullscreen}
              onFullscreenChange={onDiffFullscreenChange}
            />
          ) : (
            <Empty>{loading ? "Loading diff…" : "No diff returned for this commit."}</Empty>
          )}
        </Section>
      </div>
      {historyPath ? (
        <FileHistoryView
          repoId={repoId}
          filePath={historyPath}
          ref={refName}
          onClose={() => setHistoryPath(null)}
        />
      ) : null}
    </PanelShell>
  );
}

function ChangeGraph({
  files,
  totalAdded,
  totalDeleted,
}: {
  files: Commit["files"];
  totalAdded: number;
  totalDeleted: number;
}) {
  const maxFileChange = Math.max(1, ...files.map((file) => file.added + file.deleted));
  const totalChange = totalAdded + totalDeleted;
  const addedPercent = totalChange ? Math.round((totalAdded / totalChange) * 100) : 0;
  const deletedPercent = totalChange ? 100 - addedPercent : 0;

  return (
    <div
      className="px-3 py-3"
      aria-label={`Change graph with ${totalAdded} additions and ${totalDeleted} deletions`}
      style={{ color: "var(--rs-text-secondary)", fontSize: 11 }}
    >
      <div className="flex items-center gap-2" style={{ fontFamily: "var(--rs-mono)" }}>
        <span style={{ color: "var(--rs-git-added)" }}>+{totalAdded}</span>
        <div
          className="flex flex-1 overflow-hidden rounded-sm"
          style={{ height: 8, background: "var(--rs-bg-canvas)" }}
          aria-hidden
        >
          <span style={{ width: `${addedPercent}%`, background: "var(--rs-git-added)" }} />
          <span style={{ width: `${deletedPercent}%`, background: "var(--rs-git-deleted)" }} />
        </div>
        <span style={{ color: "var(--rs-git-deleted)" }}>-{totalDeleted}</span>
      </div>

      {files.length ? (
        <div className="mt-3 grid gap-1.5">
          {files.slice(0, 8).map((file) => {
            const width = Math.max(6, Math.round(((file.added + file.deleted) / maxFileChange) * 100));
            return (
              <div
                key={file.path}
                className="grid items-center gap-2"
                style={{ gridTemplateColumns: "1fr 74px" }}
              >
                <span
                  className="truncate"
                  title={`${file.path}: +${file.added} -${file.deleted}`}
                  style={{ color: "var(--rs-text-muted)", fontFamily: "var(--rs-mono)" }}
                >
                  {file.path}
                </span>
                <span
                  className="rounded-sm"
                  style={{
                    height: 6,
                    background: "var(--rs-bg-canvas)",
                    overflow: "hidden",
                  }}
                  aria-hidden
                >
                  <span
                    className="block h-full rounded-sm"
                    style={{
                      width: `${width}%`,
                      background:
                        file.deleted > file.added ? "var(--rs-git-deleted)" : "var(--rs-git-added)",
                    }}
                  />
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="mt-2" style={{ color: "var(--rs-text-muted)" }}>
          Change graph appears after file stats load.
        </div>
      )}
    </div>
  );
}

function FileStatusMix({ files }: { files: Commit["files"] }) {
  const segments = summarizeFileStatuses(files);
  return (
    <div
      className="px-3 py-3"
      aria-label={`File status mix for ${files.length} files`}
      style={{ color: "var(--rs-text-secondary)", fontSize: 11 }}
    >
      {segments.length ? (
        <>
          <div
            className="flex overflow-hidden rounded-sm"
            style={{ height: 10, background: "var(--rs-bg-canvas)" }}
            aria-hidden
          >
            {segments.map((segment) => (
              <span
                key={segment.status}
                style={{
                  width: `${segment.percent}%`,
                  background: segment.color,
                }}
              />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {segments.map((segment) => (
              <span
                key={segment.status}
                className="inline-flex items-center gap-1"
                style={{ fontFamily: "var(--rs-mono)", fontSize: 10 }}
              >
                <span
                  className="rounded-sm"
                  style={{ width: 8, height: 8, background: segment.color }}
                  aria-hidden
                />
                <span style={{ color: "var(--rs-text-primary)" }}>{segment.status}</span>
                <span style={{ color: "var(--rs-text-muted)" }}>{segment.count}</span>
              </span>
            ))}
          </div>
        </>
      ) : (
        <div style={{ color: "var(--rs-text-muted)" }}>
          File status mix appears after changed files load.
        </div>
      )}
    </div>
  );
}

function summarizeFileStatuses(files: Commit["files"]) {
  const counts = new Map<string, number>();
  for (const file of files) {
    counts.set(file.status, (counts.get(file.status) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([status, count]) => ({
      status,
      count,
      percent: files.length ? Math.max(5, Math.round((count / files.length) * 100)) : 0,
      color: fileStatusColor(status),
    }));
}

function fileStatusColor(status: string) {
  if (status === "A") return "var(--rs-git-added)";
  if (status === "D") return "var(--rs-git-deleted)";
  if (status === "M") return "var(--rs-git-modified)";
  return "var(--rs-text-secondary)";
}

function formatSignatureStatus(status: Commit["signatureStatus"]) {
  if (!status || status === "valid") return "Signed";
  return status
    .split("-")
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");
}

function PanelShell({ children }: { children: React.ReactNode }) {
  return (
    <aside
      className="flex flex-col overflow-hidden h-full w-full"
      style={{
        background: "var(--rs-bg-panel)",
        borderLeft: "1px solid var(--rs-border)",
      }}
    >
      {children}
    </aside>
  );
}

function Meta({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt
        style={{
          color: "var(--rs-text-muted)",
          fontSize: 11,
          letterSpacing: "0.04em",
        }}
      >
        {label}
      </dt>
      <dd style={{ color: "var(--rs-text-primary)", fontSize: 12 }}>{children}</dd>
    </>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderBottom: "1px solid var(--rs-border)" }}>
      <div
        className="px-4 flex items-center justify-between"
        style={{
          height: 30,
          fontSize: 10,
          letterSpacing: "0.08em",
          fontWeight: 600,
          color: "var(--rs-text-muted)",
          background: "var(--rs-bg-canvas)",
          borderBottom: "1px solid var(--rs-border)",
        }}
      >
        <span>{title}</span>
        {hint ? (
          <span
            style={{
              fontFamily: "var(--rs-mono)",
              fontWeight: 400,
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {hint}
          </span>
        ) : null}
      </div>
      <div>{children}</div>
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="px-3 py-4"
      style={{ fontSize: 12, color: "var(--rs-text-muted)" }}
    >
      {children}
    </div>
  );
}

function FileBadge({ status }: { status: string }) {
  const map = {
    M: { color: "var(--rs-git-modified)", bg: "var(--rs-git-modified)" },
    A: { color: "var(--rs-git-added)", bg: "var(--rs-git-added)" },
    D: { color: "var(--rs-git-deleted)", bg: "var(--rs-git-deleted)" },
  } as const;
  const c = map[status as keyof typeof map] ?? {
    color: "var(--rs-text-secondary)",
    bg: "var(--rs-text-secondary)",
  };
  return (
    <span
      className="grid place-items-center rounded"
      style={{
        width: 16,
        height: 16,
        fontSize: 10,
        fontWeight: 700,
        color: c.color,
        background: `color-mix(in oklab, var(--rs-bg-elevated), ${c.bg} 22%)`,
        border: `1px solid color-mix(in oklab, var(--rs-border), ${c.bg} 40%)`,
      }}
    >
      {status}
    </span>
  );
}

function formatDate(value?: string) {
  if (!value) return "unknown";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}
