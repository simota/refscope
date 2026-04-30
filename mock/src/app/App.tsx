import { useEffect, useRef, useState } from "react";
import { TopBar } from "./components/refscope/TopBar";
import { BranchSidebar } from "./components/refscope/BranchSidebar";
import { CommitTimeline } from "./components/refscope/CommitTimeline";
import { DetailPanel } from "./components/refscope/DetailPanel";
import { CommandPalette } from "./components/refscope/CommandPalette";
import type {
  Commit,
  CommitDetail,
  GitRef,
  RealtimeAlert,
  Repository,
} from "./components/refscope/data";
import {
  eventsUrl,
  getCommit,
  getDiff,
  listCommits,
  listRefs,
  listRepositories,
  type ViewerEvent,
} from "./api";

export default function App() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [refs, setRefs] = useState<GitRef[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedRef, setSelectedRef] = useState("HEAD");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [diff, setDiff] = useState("");
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [eventStatus, setEventStatus] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  const [eventNotice, setEventNotice] = useState("");
  const [realtimeAlerts, setRealtimeAlerts] = useState<RealtimeAlert[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [path, setPath] = useState("");
  const selectedRefRef = useRef(selectedRef);
  const searchRef = useRef(search);
  const authorRef = useRef(author);
  const pathRef = useRef(path);
  const realtimeNewCommitHashesRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    selectedRefRef.current = selectedRef;
  }, [selectedRef]);

  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  useEffect(() => {
    authorRef.current = author;
  }, [author]);

  useEffect(() => {
    pathRef.current = path;
  }, [path]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listRepositories()
      .then((items) => {
        if (cancelled) return;
        setRepositories(items);
        setSelectedRepo((current) => current || items[0]?.id || "");
        setError(items.length ? "" : "No repositories are allowlisted in RTGV_REPOS.");
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedRepo) return;
    let cancelled = false;
    setLoading(true);
    loadRepositoryState(selectedRepo, selectedRef, search, author, path)
      .then(({ nextRefs, nextRef, nextCommits }) => {
        if (cancelled) return;
        setRefs(nextRefs);
        setSelectedRef(nextRef);
        setCommits(markRealtimeNewCommits(nextCommits, realtimeNewCommitHashesRef.current));
        setSelected((current) =>
          nextCommits.some((commit) => commit.hash === current)
            ? current
            : nextCommits[0]?.hash || "",
        );
        setError("");
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selectedRef, search, author, path]);

  useEffect(() => {
    if (!selectedRepo || !selected) {
      setDetail(null);
      setDiff("");
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    Promise.all([getCommit(selectedRepo, selected), getDiff(selectedRepo, selected)])
      .then(([nextDetail, nextDiff]) => {
        if (cancelled) return;
        setDetail(nextDetail);
        setDiff(nextDiff);
      })
      .catch((err) => {
        if (!cancelled) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, selected]);

  useEffect(() => {
    if (!selectedRepo) return;
    const source = new EventSource(eventsUrl(selectedRepo));
    source.addEventListener("connected", () => setEventStatus("connected"));
    source.addEventListener("commit_added", (event) => {
      const data = parseEvent(event);
      setEventNotice(`New commit on ${eventRefName(data)}`);
      if (data.type === "commit_added") {
        rememberRealtimeNewCommit(data.commit.hash, realtimeNewCommitHashesRef.current);
      }
      void refreshTimeline(
        selectedRepo,
        selectedRefRef.current,
        searchRef.current,
        authorRef.current,
        pathRef.current,
      ).catch((err) => setError(errorMessage(err)));
    });
    source.addEventListener("history_rewritten", (event) => {
      const data = parseEvent(event);
      setEventNotice(`History rewritten on ${eventRefName(data)}`);
      if (data.type === "history_rewritten") {
        const alert = toRealtimeAlert(data);
        setRealtimeAlerts((current) => [
          alert,
          ...current.filter((item) => item.id !== alert.id),
        ].slice(0, 5));
      }
      void refreshTimeline(
        selectedRepo,
        selectedRefRef.current,
        searchRef.current,
        authorRef.current,
        pathRef.current,
      ).catch((err) => setError(errorMessage(err)));
    });
    for (const type of ["ref_created", "ref_updated", "ref_deleted"] as const) {
      source.addEventListener(type, () => {
        setEventNotice("Refs changed");
        void refreshTimeline(
          selectedRepo,
          selectedRefRef.current,
          searchRef.current,
          authorRef.current,
          pathRef.current,
        ).catch((err) => setError(errorMessage(err)));
      });
    }
    source.onerror = (event) => {
      setEventStatus("error");
      const streamError = parseStreamErrorEvent(event);
      if (streamError) {
        setError(streamError);
      }
    };
    return () => source.close();
  }, [selectedRepo]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const current = commits.find((c) => c.hash === selected) ?? commits[0] ?? null;
  const repoName = repositories.find((repo) => repo.id === selectedRepo)?.name ?? selectedRepo;
  const refName = displayRefName(selectedRef, refs);

  async function refreshTimeline(
    repoId: string,
    ref: string,
    searchTerm: string,
    authorTerm: string,
    pathTerm: string,
  ) {
    const { nextRefs, nextRef, nextCommits } = await loadRepositoryState(
      repoId,
      ref,
      searchTerm,
      authorTerm,
      pathTerm,
    );
    setRefs(nextRefs);
    setSelectedRef(nextRef);
    setCommits(markRealtimeNewCommits(nextCommits, realtimeNewCommitHashesRef.current));
    setSelected((current) =>
      nextCommits.some((commit) => commit.hash === current) ? current : nextCommits[0]?.hash || "",
    );
  }

  return (
    <div
      className="size-full flex flex-col"
      style={{
        background: "var(--rs-bg-canvas)",
        color: "var(--rs-text-primary)",
        fontFamily: "var(--rs-sans)",
      }}
    >
      <RefScopeTokens />
      <TopBar
        repositories={repositories}
        selectedRepo={selectedRepo}
        onSelectRepo={(repoId) => {
          setSelectedRepo(repoId);
          setSelectedRef("HEAD");
          setSelected("");
          realtimeNewCommitHashesRef.current.clear();
          setEventStatus("connecting");
          setEventNotice("");
          setRealtimeAlerts([]);
        }}
        refs={refs}
        selectedRef={selectedRef}
        onSelectRef={(ref) => {
          setSelectedRef(ref);
          setSelected("");
        }}
        repoName={repoName || "No repository"}
        refName={refName}
        status={eventStatus}
        search={search}
        onSearchChange={(value) => {
          setSearch(value);
          setSelected("");
        }}
        author={author}
        onAuthorChange={(value) => {
          setAuthor(value);
          setSelected("");
        }}
        path={path}
        onPathChange={(value) => {
          setPath(value);
          setSelected("");
        }}
      />
      <div className="flex flex-1 overflow-hidden">
        <BranchSidebar
          refs={refs}
          selectedRef={selectedRef}
          onSelectRef={(ref) => {
            setSelectedRef(ref);
            setSelected("");
          }}
          headHash={commits[0]?.shortHash ?? commits[0]?.hash.slice(0, 7)}
          alerts={realtimeAlerts}
        />
        <CommitTimeline
          commits={commits}
          selected={selected}
          onSelect={setSelected}
          loading={loading}
          error={error}
          eventNotice={eventNotice}
          eventStatus={eventStatus}
          activeFilters={activeFilters(search, author, path)}
        />
        <DetailPanel commit={current} detail={detail} diff={diff} loading={detailLoading} error={error} />
      </div>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        refs={refs}
        selectedCommit={current}
        onSelectRef={(ref) => {
          setSelectedRef(ref);
          setSelected("");
        }}
        search={search}
        author={author}
        path={path}
        onSearchChange={(value) => {
          setSearch(value);
          setSelected("");
        }}
        onAuthorChange={(value) => {
          setAuthor(value);
          setSelected("");
        }}
        onPathChange={(value) => {
          setPath(value);
          setSelected("");
        }}
      />
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

function activeFilters(search: string, author: string, path: string) {
  return [
    search.trim() ? `message "${search.trim()}"` : "",
    author.trim() ? `author "${author.trim()}"` : "",
    path.trim() ? `path "${path.trim()}"` : "",
  ].filter(Boolean);
}

async function loadRepositoryState(
  repoId: string,
  requestedRef: string,
  searchTerm: string,
  authorTerm: string,
  pathTerm: string,
) {
  const nextRefs = await listRefs(repoId);
  const nextRef = resolveSelectableRef(requestedRef, nextRefs);
  const nextCommits = await listCommits(repoId, nextRef, searchTerm, authorTerm, pathTerm);
  return { nextRefs, nextRef, nextCommits };
}

function resolveSelectableRef(requestedRef: string, refs: GitRef[]) {
  if (requestedRef === "HEAD") return "HEAD";

  const exact = refs.find((ref) => ref.name === requestedRef);
  if (exact) return exact.name;

  const byShortName = refs.find((ref) => ref.shortName === requestedRef);
  if (byShortName) return byShortName.name;

  return refs.find((ref) => ref.type === "branch")?.name ?? refs[0]?.name ?? "HEAD";
}

function displayRefName(selectedRef: string, refs: GitRef[]) {
  if (selectedRef === "HEAD") return "HEAD";
  return refs.find((ref) => ref.name === selectedRef || ref.shortName === selectedRef)?.shortName ?? selectedRef;
}

function parseEvent(event: Event) {
  return JSON.parse((event as MessageEvent<string>).data) as ViewerEvent;
}

function parseStreamErrorEvent(event: Event) {
  if (!("data" in event) || typeof event.data !== "string") return "";
  try {
    const data = JSON.parse(event.data) as ViewerEvent;
    if (data.type !== "error") return "";
    const details = [
      data.timedOut ? "timed out" : "",
      data.truncated ? "output truncated" : "",
    ].filter(Boolean);
    return details.length ? `${data.error} (${details.join(", ")})` : data.error;
  } catch {
    return "";
  }
}

function eventRefName(event: ViewerEvent) {
  return "ref" in event ? event.ref.shortName : "selected ref";
}

function toRealtimeAlert(event: Extract<ViewerEvent, { type: "history_rewritten" }>): RealtimeAlert {
  return {
    id: `${event.ref.name}:${event.previousHash}:${event.currentHash}`,
    type: "history_rewritten",
    refName: event.ref.shortName,
    previousHash: event.previousHash,
    currentHash: event.currentHash,
    time: new Date().toLocaleTimeString(),
  };
}

function rememberRealtimeNewCommit(hash: string, hashes: Set<string>) {
  const nextHashes = [hash, ...Array.from(hashes).filter((item) => item !== hash)].slice(0, 20);
  hashes.clear();
  for (const nextHash of nextHashes) {
    hashes.add(nextHash);
  }
}

function markRealtimeNewCommits(commits: Commit[], hashes: Set<string>) {
  if (hashes.size === 0) return commits;
  return commits.map((commit) => ({
    ...commit,
    isNew: hashes.has(commit.hash),
  }));
}

function RefScopeTokens() {
  return (
    <style>{`
      :root {
        --rs-bg-canvas: oklch(16% 0.015 255);
        --rs-bg-panel: oklch(20% 0.018 255);
        --rs-bg-elevated: oklch(24% 0.02 255);
        --rs-border: oklch(34% 0.025 255);
        --rs-text-primary: oklch(92% 0.015 255);
        --rs-text-secondary: oklch(72% 0.02 255);
        --rs-text-muted: oklch(55% 0.02 255);
        --rs-accent: oklch(72% 0.14 235);
        --rs-git-added: oklch(72% 0.14 150);
        --rs-git-deleted: oklch(70% 0.16 25);
        --rs-git-modified: oklch(78% 0.15 80);
        --rs-git-merge: oklch(74% 0.15 285);
        --rs-warning: oklch(78% 0.16 75);
        --rs-radius-sm: 6px;
        --rs-radius-md: 8px;
        --rs-radius-lg: 12px;
        --rs-mono: "JetBrains Mono", "SFMono-Regular", "Cascadia Code", ui-monospace, monospace;
        --rs-sans: Inter, "Noto Sans JP", system-ui, -apple-system, sans-serif;
      }
      .rs-chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 28px;
        padding: 0 10px;
        border-radius: var(--rs-radius-sm);
        background: var(--rs-bg-elevated);
        border: 1px solid var(--rs-border);
        color: var(--rs-text-primary);
        font-size: 12px;
        font-family: var(--rs-mono);
        transition: background 80ms ease-out;
      }
      .rs-chip:hover {
        background: color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 10%);
      }
      .rs-btn {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        height: 24px;
        padding: 0 10px;
        border-radius: var(--rs-radius-sm);
        font-size: 11px;
        font-weight: 500;
        border: 1px solid transparent;
        cursor: pointer;
        transition: background 80ms ease-out;
      }
      .rs-btn--accent {
        background: var(--rs-accent);
        color: oklch(15% 0.02 255);
      }
      .rs-btn--accent:hover {
        background: color-mix(in oklab, var(--rs-accent), white 10%);
      }
      .rs-btn--warning {
        background: var(--rs-warning);
        color: oklch(20% 0.02 70);
      }
      .rs-btn--ghost {
        background: transparent;
        color: var(--rs-text-secondary);
        border-color: var(--rs-border);
      }
      .rs-btn--ghost:hover {
        background: var(--rs-bg-elevated);
        color: var(--rs-text-primary);
      }
      .rs-icon-btn {
        width: 26px;
        height: 26px;
        display: grid;
        place-items: center;
        border-radius: var(--rs-radius-sm);
        color: var(--rs-text-secondary);
        background: transparent;
        cursor: pointer;
      }
      .rs-icon-btn:hover {
        background: var(--rs-bg-elevated);
        color: var(--rs-text-primary);
      }
      *:focus-visible {
        outline: 2px solid var(--rs-accent);
        outline-offset: 2px;
      }
    `}</style>
  );
}
