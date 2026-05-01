import { useCallback, useEffect, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { TopBar } from "./components/refscope/TopBar";
import { BranchSidebar } from "./components/refscope/BranchSidebar";
import { CommitTimeline } from "./components/refscope/CommitTimeline";
import { DetailPanel } from "./components/refscope/DetailPanel";
import { CommandPalette } from "./components/refscope/CommandPalette";
import {
  PeriodSummaryView,
  isSafeTopSegmentForPathFilter,
} from "./components/refscope/PeriodSummaryView";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "./components/ui/resizable";
import { useQuietMode } from "./hooks/useQuietMode";
import { useLayoutPrefs } from "./hooks/useLayoutPrefs";
import { useColorVisionTheme } from "./hooks/useColorVisionTheme";
import type {
  Commit,
  CommitDetail,
  CompareResult,
  GitRef,
  RealtimeAlert,
  Repository,
} from "./components/refscope/data";
import {
  compareRefs,
  eventsUrl,
  getCommit,
  getDiff,
  listCommits,
  listRefs,
  listRepositories,
  type DiffPayload,
  type ViewerEvent,
} from "./api";

const EMPTY_DIFF: DiffPayload = { diff: "", truncated: false, maxBytes: 0 };

export default function App() {
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [refs, setRefs] = useState<GitRef[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");
  const [selectedRef, setSelectedRef] = useState("HEAD");
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [diff, setDiff] = useState<DiffPayload>(EMPTY_DIFF);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState("");
  const [eventStatus, setEventStatus] = useState<"connecting" | "connected" | "error">(
    "connecting",
  );
  const [eventNotice, setEventNotice] = useState("");
  const [livePaused, setLivePaused] = useState(false);
  const [pendingUpdates, setPendingUpdates] = useState(0);
  const [liveAnnouncement, setLiveAnnouncement] = useState("");
  const [realtimeAlerts, setRealtimeAlerts] = useState<RealtimeAlert[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [summaryViewOpen, setSummaryViewOpen] = useState(false);
  const [diffFullscreen, setDiffFullscreen] = useState(false);
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [path, setPath] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  const [compareBase, setCompareBase] = useState("");
  const [compareTarget, setCompareTarget] = useState("");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  const selectedRefRef = useRef(selectedRef);
  const searchRef = useRef(search);
  const authorRef = useRef(author);
  const pathRef = useRef(path);
  const livePausedRef = useRef(livePaused);
  const pendingRealtimeEventsRef = useRef<Array<() => void>>([]);
  const realtimeNewCommitHashesRef = useRef<Set<string>>(new Set());
  const { quietMode, prefersReducedMotion, isQuiet, toggleQuietMode } = useQuietMode();
  const { colorVisionTheme, isCvdSafe, toggleTheme: toggleColorVisionTheme } = useColorVisionTheme();
  const {
    sidebarCollapsed,
    panelSizes,
    setSidebarCollapsed,
    toggleSidebar,
    setPanelSizes,
  } = useLayoutPrefs();
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  // Track collapse intent vs. actual panel state so the imperative API is only
  // called when they diverge — react-resizable-panels' collapse() is idempotent
  // but extra calls during drag would fight user input.
  useEffect(() => {
    const handle = sidebarPanelRef.current;
    if (!handle) return;
    if (sidebarCollapsed && !handle.isCollapsed()) {
      handle.collapse();
    } else if (!sidebarCollapsed && handle.isCollapsed()) {
      handle.expand();
    }
  }, [sidebarCollapsed]);
  const isQuietRef = useRef(isQuiet);
  const quietPendingCountRef = useRef(0);
  const previousIsQuietRef = useRef(isQuiet);
  // `effectivePaused` unions the manual pause and the quiet-mode auto pause; the SSE handler
  // only needs to know "are updates frozen?", but the UI keeps both sources visible separately.
  const effectivePaused = livePaused || isQuiet;

  useEffect(() => {
    livePausedRef.current = livePaused;
  }, [livePaused]);

  useEffect(() => {
    isQuietRef.current = isQuiet;
  }, [isQuiet]);

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
        const markedCommits = markRealtimeNewCommits(
          nextCommits,
          realtimeNewCommitHashesRef.current,
        );
        setRefs(nextRefs);
        setSelectedRef(nextRef);
        setCommits(markedCommits);
        setSelected((current) => {
          if (!current) {
            setSelectionNotice("");
            return markedCommits[0]?.hash || "";
          }
          if (markedCommits.some((commit) => commit.hash === current)) {
            setSelectionNotice("");
            return current;
          }
          setSelectionNotice("Previous selection is not on this ref; selected the latest visible commit.");
          return markedCommits[0]?.hash || "";
        });
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
    if (!selectedRepo || !compareBase || !compareTarget) {
      setCompareResult(null);
      return;
    }
    let cancelled = false;
    setCompareLoading(true);
    compareRefs(selectedRepo, compareBase, compareTarget)
      .then((result) => {
        if (cancelled) return;
        setCompareResult(result);
        setError("");
      })
      .catch((err) => {
        if (!cancelled) {
          setCompareResult(null);
          setError(errorMessage(err));
        }
      })
      .finally(() => {
        if (!cancelled) setCompareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, compareBase, compareTarget]);

  useEffect(() => {
    setDiffFullscreen(false);
  }, [selected]);

  useEffect(() => {
    if (!selectedRepo || !selected) {
      setDetail(null);
      setDiff(EMPTY_DIFF);
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
      const notice = `New commit on ${eventRefName(data)}`;
      handleRealtimeEvent(notice, () => {
        setEventNotice(notice);
        if (data.type === "commit_added") {
          rememberRealtimeNewCommit(data.commit.hash, realtimeNewCommitHashesRef.current);
        }
      });
    });
    source.addEventListener("history_rewritten", (event) => {
      const data = parseEvent(event);
      const notice = `History rewritten on ${eventRefName(data)}`;
      handleRealtimeEvent(notice, () => {
        setEventNotice(notice);
        if (data.type === "history_rewritten") {
          const alert = toRealtimeAlert(data, repoName || selectedRepo);
          setRealtimeAlerts((current) => [
            alert,
            ...current.filter((item) => item.id !== alert.id),
          ].slice(0, 5));
        }
      });
    });
    for (const type of ["ref_created", "ref_updated", "ref_deleted"] as const) {
      source.addEventListener(type, () => {
        const notice = "Refs changed";
        handleRealtimeEvent(notice, () => setEventNotice(notice));
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
  const toggleSummaryView = useCallback(() => setSummaryViewOpen((prev) => !prev), []);

  // Drilldown intentionally routes group keys back through the existing search /
  // path / author filters rather than tracking a separate hash highlight set.
  // Filters already shape the timeline state and survive realtime refreshes.
  const handleSummaryDrilldown = useCallback(
    (_commitHashes: string[], context: { kind: "prefix" | "path" | "author"; key: string }) => {
      if (context.kind === "prefix" && context.key !== "uncategorized") {
        setSearch(`${context.key}:`);
        setAuthor("");
        setPath("");
      } else if (context.kind === "path" && isSafeTopSegmentForPathFilter(context.key)) {
        setPath(context.key);
        setSearch("");
        setAuthor("");
      } else if (context.kind === "author") {
        setAuthor(context.key);
        setSearch("");
        setPath("");
      }
      setSelected("");
      setSummaryViewOpen(false);
    },
    [],
  );

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
    const markedCommits = markRealtimeNewCommits(nextCommits, realtimeNewCommitHashesRef.current);
    setCommits(markedCommits);
    setSelected((current) => {
      if (!current) {
        setSelectionNotice("");
        return markedCommits[0]?.hash || "";
      }
      if (markedCommits.some((commit) => commit.hash === current)) {
        setSelectionNotice("");
        return current;
      }
      setSelectionNotice("Previous selection is not on this ref; selected the latest visible commit.");
      return markedCommits[0]?.hash || "";
    });
  }

  function handleRealtimeEvent(notice: string, applyEvent: () => void) {
    if (livePausedRef.current || isQuietRef.current) {
      pendingRealtimeEventsRef.current.push(applyEvent);
      if (isQuietRef.current && !livePausedRef.current) {
        quietPendingCountRef.current += 1;
      }
      setPendingUpdates((count) => {
        const nextCount = count + 1;
        if (livePausedRef.current) {
          setLiveAnnouncement(`Live updates paused. ${nextCount} updates pending.`);
        }
        return nextCount;
      });
      return;
    }
    applyEvent();
    setLiveAnnouncement(notice);
    void refreshTimeline(
      selectedRepo,
      selectedRefRef.current,
      searchRef.current,
      authorRef.current,
      pathRef.current,
    ).catch((err) => setError(errorMessage(err)));
  }

  const flushPendingRealtimeEvents = useCallback(() => {
    if (pendingRealtimeEventsRef.current.length === 0) return;
    for (const applyEvent of pendingRealtimeEventsRef.current) {
      applyEvent();
    }
    pendingRealtimeEventsRef.current = [];
    setPendingUpdates(0);
    void refreshTimeline(
      selectedRepo,
      selectedRefRef.current,
      searchRef.current,
      authorRef.current,
      pathRef.current,
    ).catch((err) => setError(errorMessage(err)));
    // refreshTimeline is stable through refs; selectedRepo is the only reactive input.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo]);

  function toggleLiveUpdates() {
    if (!livePaused) {
      setLivePaused(true);
      setLiveAnnouncement("Live updates paused.");
      return;
    }
    setLivePaused(false);
    setLiveAnnouncement("Live updates resumed.");
    // Stay paused if quiet mode is still asking us to be silent; the events will flush on quiet exit.
    if (!isQuietRef.current && pendingUpdates > 0) {
      flushPendingRealtimeEvents();
    }
  }

  useEffect(() => {
    const wasQuiet = previousIsQuietRef.current;
    previousIsQuietRef.current = isQuiet;
    if (!wasQuiet || isQuiet) return;
    const missedDuringQuiet = quietPendingCountRef.current;
    quietPendingCountRef.current = 0;
    if (livePausedRef.current) {
      // Manual pause is still on; do not flush, just announce.
      if (missedDuringQuiet > 0) {
        setLiveAnnouncement(
          `Resumed live updates. ${missedDuringQuiet} events were observed while quiet.`,
        );
      }
      return;
    }
    flushPendingRealtimeEvents();
    if (missedDuringQuiet > 0) {
      setLiveAnnouncement(
        `Resumed live updates. ${missedDuringQuiet} events were observed while quiet.`,
      );
    }
  }, [isQuiet, flushPendingRealtimeEvents]);

  return (
    <div
      className="size-full flex flex-col"
      data-quiet={isQuiet ? "true" : undefined}
      data-color-vision={colorVisionTheme}
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
          setLivePaused(false);
          setPendingUpdates(0);
          setLiveAnnouncement("");
          pendingRealtimeEventsRef.current = [];
          quietPendingCountRef.current = 0;
          setRealtimeAlerts([]);
          setCompareBase("");
          setCompareTarget("");
          setCompareResult(null);
        }}
        refs={refs}
        selectedRef={selectedRef}
        onSelectRef={(ref) => {
          setSelectedRef(ref);
        }}
        repoName={repoName || "No repository"}
        refName={refName}
        status={eventStatus}
        livePaused={livePaused}
        effectivePaused={effectivePaused}
        isQuiet={isQuiet}
        quietMode={quietMode}
        prefersReducedMotion={prefersReducedMotion}
        onToggleQuietMode={toggleQuietMode}
        isCvdSafe={isCvdSafe}
        onToggleColorVision={toggleColorVisionTheme}
        pendingUpdates={pendingUpdates}
        onToggleLiveUpdates={toggleLiveUpdates}
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
        summaryViewOpen={summaryViewOpen}
        onToggleSummaryView={toggleSummaryView}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
      />
      <ResizablePanelGroup
        direction="horizontal"
        className="flex flex-1 overflow-hidden"
        onLayout={(layout) => {
          // layout reflects the live order of panels; when the sidebar is collapsed
          // it is still present (collapsedSize=0) so the array length stays at 3.
          if (layout.length !== 3) return;
          const [sidebar, center, detail] = layout;
          // Skip writes triggered by the collapse animation itself — when the
          // sidebar is at collapsedSize 0, the other two panels absorb its share
          // and we don't want to overwrite the user's last drag-resized ratios.
          if (sidebar < 1) return;
          setPanelSizes({ sidebar, center, detail });
        }}
      >
        <ResizablePanel
          id="rs-sidebar"
          order={1}
          ref={sidebarPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={panelSizes.sidebar}
          minSize={12}
          maxSize={30}
          onCollapse={() => setSidebarCollapsed(true)}
          onExpand={() => setSidebarCollapsed(false)}
        >
          <BranchSidebar
            refs={refs}
            selectedRef={selectedRef}
            onSelectRef={(ref) => {
              setSelectedRef(ref);
            }}
            headHash={commits[0]?.shortHash ?? commits[0]?.hash.slice(0, 7)}
            alerts={realtimeAlerts}
          />
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="Resize branch sidebar" />
        <ResizablePanel
          id="rs-center"
          order={2}
          defaultSize={panelSizes.center}
          minSize={25}
        >
          <div className="flex flex-col overflow-hidden h-full">
            {summaryViewOpen && selectedRepo ? (
              <div className="overflow-y-auto" style={{ flexShrink: 0, maxHeight: "55%" }}>
                <PeriodSummaryView
                  repoId={selectedRepo}
                  refName={selectedRef}
                  onDrilldown={handleSummaryDrilldown}
                  isQuiet={isQuiet}
                />
              </div>
            ) : null}
            <CommitTimeline
              commits={commits}
              selected={selected}
              onSelect={setSelected}
              loading={loading}
              error={error}
              eventNotice={eventNotice}
              eventStatus={eventStatus}
              livePaused={livePaused}
              pendingUpdates={pendingUpdates}
              liveAnnouncement={liveAnnouncement}
              activeFilters={activeFilters(search, author, path)}
              refs={refs}
              selectedRef={selectedRef}
              selectedCommit={current}
              selectionNotice={selectionNotice}
              compareBase={compareBase}
              compareTarget={compareTarget}
              compareResult={compareResult}
              compareLoading={compareLoading}
              onCompareBaseChange={setCompareBase}
              onCompareTargetChange={setCompareTarget}
              onPinSelectedAsBase={() => {
                if (current) setCompareBase(current.hash);
              }}
              onPinCurrentRefAsTarget={() => setCompareTarget(selectedRef)}
              onClearCompare={() => {
                setCompareBase("");
                setCompareTarget("");
                setCompareResult(null);
              }}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="Resize detail panel" />
        <ResizablePanel
          id="rs-detail"
          order={3}
          defaultSize={panelSizes.detail}
          minSize={25}
          maxSize={70}
        >
          <DetailPanel
            commit={current}
            detail={detail}
            diff={diff}
            loading={detailLoading}
            error={error}
            diffFullscreen={diffFullscreen}
            onDiffFullscreenChange={setDiffFullscreen}
          />
        </ResizablePanel>
      </ResizablePanelGroup>
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        refs={refs}
        selectedCommit={current}
        onSelectRef={(ref) => {
          setSelectedRef(ref);
        }}
        search={search}
        author={author}
        path={path}
        livePaused={livePaused}
        quietMode={quietMode}
        isQuiet={isQuiet}
        isCvdSafe={isCvdSafe}
        onToggleColorVision={toggleColorVisionTheme}
        summaryViewOpen={summaryViewOpen}
        onToggleSummaryView={toggleSummaryView}
        onToggleQuietMode={toggleQuietMode}
        onToggleLiveUpdates={toggleLiveUpdates}
        diffAvailable={Boolean(current) && (Boolean(diff.diff) || diff.truncated)}
        diffFullscreen={diffFullscreen}
        onToggleDiffFullscreen={() => setDiffFullscreen((prev) => !prev)}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
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

function toRealtimeAlert(
  event: Extract<ViewerEvent, { type: "history_rewritten" }>,
  repoName: string,
): RealtimeAlert {
  const observedAt = event.observedAt ?? new Date().toISOString();
  return {
    id: `${event.ref.name}:${event.previousHash}:${event.currentHash}`,
    type: "history_rewritten",
    repoId: event.repoId,
    repoName,
    refName: event.ref.shortName,
    fullRefName: event.ref.name,
    previousHash: event.previousHash,
    currentHash: event.currentHash,
    observedAt,
    detectionSource: event.detectionSource ?? "polling",
    explanation:
      event.explanation ??
      "The current commit is not a descendant of the previously observed commit.",
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
      .rs-compact-button {
        height: 26px;
        padding: 0 9px;
        border-radius: var(--rs-radius-sm);
        border: 1px solid var(--rs-border);
        background: var(--rs-bg-canvas);
        color: var(--rs-text-secondary);
        font-size: 11px;
        white-space: nowrap;
      }
      .rs-compact-button:not(:disabled) {
        cursor: pointer;
      }
      .rs-compact-button:disabled {
        opacity: 0.45;
      }
      .rs-compact-button:not(:disabled):hover {
        color: var(--rs-text-primary);
        border-color: color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%);
      }
      .rs-compare-select {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        height: 26px;
        padding: 0 8px;
        border-radius: var(--rs-radius-sm);
        border: 1px solid var(--rs-border);
        background: var(--rs-bg-canvas);
        color: var(--rs-text-secondary);
        font-size: 11px;
      }
      .rs-compare-select select {
        max-width: 170px;
        background: transparent;
        color: var(--rs-text-primary);
        border: 0;
        outline: 0;
        font: inherit;
      }
      .rs-compare-select option {
        background: var(--rs-bg-elevated);
        color: var(--rs-text-primary);
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
      /* Quiet mode: stop ambient transitions and animations across the tree.
         Saturation is lowered by remapping the chroma channel of accent / status
         tokens while preserving the lightness channel — keeps WCAG 2.2 AA
         contrast against bg-canvas and bg-panel intact. */
      [data-quiet="true"] *,
      [data-quiet="true"] *::before,
      [data-quiet="true"] *::after {
        transition-duration: 0ms !important;
        animation-duration: 0ms !important;
        animation-iteration-count: 1 !important;
      }
      [data-quiet="true"] {
        --rs-accent: oklch(72% 0.04 235);
        --rs-git-added: oklch(72% 0.05 150);
        --rs-git-deleted: oklch(70% 0.06 25);
        --rs-git-modified: oklch(78% 0.05 80);
        --rs-git-merge: oklch(74% 0.05 285);
        --rs-warning: oklch(78% 0.06 75);
      }
      [data-quiet="true"] .rs-chip:hover,
      [data-quiet="true"] .rs-btn--accent:hover,
      [data-quiet="true"] .rs-icon-btn:hover,
      [data-quiet="true"] .rs-btn--ghost:hover {
        background: var(--rs-bg-elevated);
      }
      /* Prism token colors. Scoped to .rs-prism so we never bleed into the
         rest of the UI. Hue picked to harmonize with the existing rs-* palette
         and to keep contrast on top of the +/- background tints. */
      .rs-prism .token.comment,
      .rs-prism .token.prolog,
      .rs-prism .token.cdata,
      .rs-prism .token.doctype {
        color: oklch(60% 0.03 255);
        font-style: italic;
      }
      .rs-prism .token.punctuation {
        color: oklch(72% 0.02 255);
      }
      .rs-prism .token.namespace {
        opacity: 0.7;
      }
      .rs-prism .token.string,
      .rs-prism .token.char,
      .rs-prism .token.attr-value,
      .rs-prism .token.regex,
      .rs-prism .token.template-string {
        color: oklch(78% 0.13 145);
      }
      .rs-prism .token.number,
      .rs-prism .token.boolean,
      .rs-prism .token.constant,
      .rs-prism .token.symbol {
        color: oklch(78% 0.15 80);
      }
      .rs-prism .token.keyword,
      .rs-prism .token.atrule,
      .rs-prism .token.important,
      .rs-prism .token.rule {
        color: oklch(74% 0.15 285);
      }
      .rs-prism .token.tag,
      .rs-prism .token.selector,
      .rs-prism .token.deleted {
        color: oklch(72% 0.14 25);
      }
      .rs-prism .token.attr-name,
      .rs-prism .token.builtin,
      .rs-prism .token.property,
      .rs-prism .token.entity,
      .rs-prism .token.url,
      .rs-prism .token.variable {
        color: oklch(78% 0.13 195);
      }
      .rs-prism .token.function,
      .rs-prism .token.class-name {
        color: oklch(80% 0.14 95);
      }
      .rs-prism .token.operator {
        color: oklch(82% 0.04 255);
      }
      .rs-prism .token.inserted {
        color: oklch(72% 0.14 150);
      }
      .rs-prism .token.bold {
        font-weight: 600;
      }
      .rs-prism .token.italic {
        font-style: italic;
      }

      /* ─── CVD-safe theme ────────────────────────────────────────────────
         Activated by data-color-vision="cvd-safe" on the root element.
         Completely independent from data-quiet — both can be active at once
         without CSS cascade conflicts (different attribute selectors, different
         custom property names for CVD tokens).

         Palette: Wong (2011) + Paul Tol neutral blue family.
           add  → orange  oklch(74% 0.17 55)   ≈ #E69F00  (Wong orange)
           del  → blue    oklch(50% 0.17 240)   ≈ #0072B2  (Wong blue)
         Both hues are >90° apart on the hue wheel — safe for deuteranopia,
         protanopia, and tritanopia.  Neither is green or red.

         Prism tokens in CVD-safe mode — chosen so no token shares a hue
         within 30° of the add (55°) or del (240°) anchors:
           keyword  → vermilion  oklch(62% 0.18 25)   ≈ #D55E00  (Wong vermilion)
           string   → sky-blue   oklch(70% 0.12 200)  ≈ #56B4E9  (Wong sky-blue)
           comment  → gray       oklch(55% 0.02 255)  (achromatic, italic)
           number   → amber      oklch(80% 0.16 85)   ≈ #F0E442  (Wong yellow)
           function → bluish-grn oklch(68% 0.14 175)  ≈ #009E73  (Wong blueish-green, hue 175° — far from add 55°/del 240°)
           variable → white      oklch(86% 0.02 255)  (near-white, distinct from all above)
           operator → muted      oklch(72% 0.03 255)  (near-neutral)
           punctuation → muted   oklch(65% 0.02 255)

         Non-color signals (always active in CVD-safe mode):
           · Left bar: 4px solid (add) vs 4px dashed (del) via box-shadow trick on the row.
           · The +/- glyph column is always present (fact layer, never removed).
           · ChangeKindBadge A/D/M letters are always shown (file level).
         ─────────────────────────────────────────────────────────────────── */
      [data-color-vision="cvd-safe"] {
        --rs-git-added:   oklch(74% 0.17 55);
        --rs-git-deleted: oklch(50% 0.17 240);
        --rs-git-modified: oklch(68% 0.14 175);
        --rs-git-merge:   oklch(70% 0.12 200);
      }

      /* CVD-safe Prism overrides — scoped to both attributes independently */
      [data-color-vision="cvd-safe"] .rs-prism .token.keyword,
      [data-color-vision="cvd-safe"] .rs-prism .token.atrule,
      [data-color-vision="cvd-safe"] .rs-prism .token.important,
      [data-color-vision="cvd-safe"] .rs-prism .token.rule {
        color: oklch(62% 0.18 25);
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.string,
      [data-color-vision="cvd-safe"] .rs-prism .token.char,
      [data-color-vision="cvd-safe"] .rs-prism .token.attr-value,
      [data-color-vision="cvd-safe"] .rs-prism .token.regex,
      [data-color-vision="cvd-safe"] .rs-prism .token.template-string {
        color: oklch(70% 0.12 200);
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.number,
      [data-color-vision="cvd-safe"] .rs-prism .token.boolean,
      [data-color-vision="cvd-safe"] .rs-prism .token.constant,
      [data-color-vision="cvd-safe"] .rs-prism .token.symbol {
        color: oklch(80% 0.16 85);
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.function,
      [data-color-vision="cvd-safe"] .rs-prism .token.class-name {
        color: oklch(68% 0.14 175);
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.attr-name,
      [data-color-vision="cvd-safe"] .rs-prism .token.builtin,
      [data-color-vision="cvd-safe"] .rs-prism .token.property,
      [data-color-vision="cvd-safe"] .rs-prism .token.entity,
      [data-color-vision="cvd-safe"] .rs-prism .token.url,
      [data-color-vision="cvd-safe"] .rs-prism .token.variable {
        color: oklch(86% 0.02 255);
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.operator {
        color: oklch(72% 0.03 255);
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.punctuation {
        color: oklch(65% 0.02 255);
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.comment,
      [data-color-vision="cvd-safe"] .rs-prism .token.prolog,
      [data-color-vision="cvd-safe"] .rs-prism .token.cdata,
      [data-color-vision="cvd-safe"] .rs-prism .token.doctype {
        color: oklch(55% 0.02 255);
        font-style: italic;
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.tag,
      [data-color-vision="cvd-safe"] .rs-prism .token.selector,
      [data-color-vision="cvd-safe"] .rs-prism .token.deleted {
        color: oklch(62% 0.18 25);
      }
      [data-color-vision="cvd-safe"] .rs-prism .token.inserted {
        color: oklch(74% 0.17 55);
      }

      /* Non-color diff line signals: left bar width+style in CVD-safe mode.
         The bar is rendered as a box-shadow on the row element via the
         .rs-diff-add / .rs-diff-del / .rs-diff-context classes that
         DiffViewer sets.  This is additive to the existing +/- glyph. */
      [data-color-vision="cvd-safe"] .rs-diff-add {
        box-shadow: inset 4px 0 0 var(--rs-git-added);
      }
      [data-color-vision="cvd-safe"] .rs-diff-del {
        box-shadow: inset 4px 0 0 var(--rs-git-deleted);
        background-image: repeating-linear-gradient(
          135deg,
          transparent,
          transparent 3px,
          color-mix(in oklab, var(--rs-git-deleted), transparent 85%) 3px,
          color-mix(in oklab, var(--rs-git-deleted), transparent 85%) 4px
        );
      }

      /* Quiet + CVD-safe stacking: when both attributes are present, quiet
         takes the chroma-reduction path (lightness preserved) while CVD-safe
         overrides the hue anchors.  No selector conflict because data-quiet
         and data-color-vision are distinct attributes — both rules apply via
         independent cascade entries. The resulting palette is:
           add  → orange low-chroma (quiet reduces chroma to 0.05 range)
           del  → blue low-chroma
         Both remain distinguishable in grayscale because their lightness
         values differ: add L≈74%, del L≈50% → ΔL≈24 points. */
      [data-quiet="true"][data-color-vision="cvd-safe"] {
        --rs-git-added:   oklch(74% 0.05 55);
        --rs-git-deleted: oklch(50% 0.06 240);
        --rs-git-modified: oklch(68% 0.05 175);
        --rs-git-merge:   oklch(70% 0.04 200);
      }
    `}</style>
  );
}
