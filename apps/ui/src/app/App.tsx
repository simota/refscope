import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { TopBar } from "./components/refscope/TopBar";
import { BranchSidebar } from "./components/refscope/BranchSidebar";
import { CommitTimeline } from "./components/refscope/CommitTimeline";
import { DetailPanel } from "./components/refscope/DetailPanel";
import type { WhyPanelQuery } from "./components/refscope/DetailPanel";
import { CommandPalette } from "./components/refscope/CommandPalette";
import { FileHistoryView } from "./components/refscope/FileHistoryView";
import { LensSwitcher, type LensId } from "./components/refscope/LensSwitcher";
import type { BrowserRevision, BrowserTab } from "./components/refscope/RepoBrowserDialog";
import {
  FileHistoryPrompt,
  validatePath,
} from "./components/refscope/FileHistoryPrompt";
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
import { takeRedactCarryOver, useRedactMode } from "./hooks/useRedactMode";
import { usePinnedRefs } from "./hooks/usePinnedRefs";
import { useRefBriefing } from "./hooks/useRefBriefing";
import { useWatchNotifications } from "./hooks/useWatchNotifications";
import { SinceLastVisitBanner } from "./components/refscope/SinceLastVisitBanner";
import { lazyWithPreload, useLatch, whenIdle } from "./lib/lazyWithPreload";
import { useLayoutPrefs } from "./hooks/useLayoutPrefs";
import { useTimelinePrefs } from "./hooks/useTimelinePrefs";
import { useColorVisionTheme } from "./hooks/useColorVisionTheme";
import { useLastOpenedRepos } from "./hooks/useLastOpenedRepos";
import {
  useKeyboardShortcuts,
  type ShortcutBinding,
} from "./hooks/useKeyboardShortcuts";
import { ShortcutHelp } from "./components/refscope/ShortcutHelp";
import { FleetSurface } from "./components/refscope/FleetSurface";
import { FleetOnboardingOverlay } from "./components/refscope/FleetOnboardingOverlay";
import { AddRepoDialog } from "./components/refscope/AddRepoDialog";
import { SymbolHistoryView } from "./components/refscope/SymbolHistoryView";
import type { FileViewerTarget } from "./components/refscope/FileViewerDialog";
import { useIsMobile } from "./components/ui/use-mobile";
import type {
  Commit,
  CommitDetail,
  CompareResult,
  GitRef,
  RealtimeAlert,
  Repository,
} from "./components/refscope/data";
import {
  COMMIT_PAGE_SIZE,
  commitFromDetail,
  compareRefs,
  deleteRepo,
  eventsUrl,
  fetchFleetSnapshot,
  fetchRefDrift,
  fetchWorkTree,
  getCommit,
  getCommitContainingRefs,
  getDiff,
  getRepoState,
  listCommits,
  listRefs,
  listRepositories,
  listStashes,
  listSubmodules,
  listWorktrees,
  postRepo,
  type CommitListWindow,
  type ContainingRef,
  type DiffPayload,
  type FleetSnapshot,
  type RefDriftEntry,
  type RepoStateResponse,
  type SearchMode,
  type StashEntry,
  type SubmoduleEntry,
  type ViewerEvent,
  type WorkTreeResponse,
  type WorktreeEntry,
  type CompareMode,
  redactPayload,
} from "./api";
import type { RefDriftSummary } from "./components/refscope/BranchSidebar";
import {
  appendOlderPage,
  buildDeepLinkSearch,
  parseDeepLink,
  localDateToIsoBound,
  mergeLiveFirstPage,
  pageMayHaveMore,
} from "./lib/historyBrowsing";
import {
  HISTORY_SHAPES,
  HISTORY_SHAPE_INFO,
  buildFilterLinkSearch,
  describeFilters,
  exportFileStem,
  findMatchingView,
  parseFilterLink,
  parseHistoryShape,
  shortRefName,
  timelineToCsv,
  timelineToMarkdown,
  type HistoryShape,
  type SavedView,
  type TimelineFilters,
} from "./lib/timelineViews";
import { useSavedViews } from "./hooks/useSavedViews";
import { SavedViewsMenu } from "./components/refscope/SavedViewsMenu";
import type { TimelineViewCommand } from "./components/refscope/CommandPalette";
import { buildCompareLinkSearch, parseCompareLink } from "./lib/compareReview";
import {
  loadRewriteSnapshots,
  saveRewriteSnapshot,
  MAX_SNAPSHOTS,
  type RewriteRescueEntry,
} from "./rewriteStore";

const EMPTY_DIFF: DiffPayload = { diff: "", truncated: false, maxBytes: 0 };

// Lenses built on recharts are split out of the startup bundle (recharts and
// its dependencies are most of it) and fetched once the app is idle, so they
// are usually ready before anyone opens them.
const HotspotLens = lazyWithPreload(() =>
  import("./components/refscope/HotspotLens").then((m) => m.HotspotLens),
);
const RiskTrendLens = lazyWithPreload(() =>
  import("./components/refscope/RiskTrendLens").then((m) => m.RiskTrendLens),
);
const DriftLens = lazyWithPreload(() =>
  import("./components/refscope/DriftLens").then((m) => m.DriftLens),
);
// The other non-default lenses mount only when their tab is chosen; the
// startup bundle need not parse them. They are prefetched with the ones above.
const PulseLens = lazyWithPreload(() =>
  import("./components/refscope/PulseLens").then((m) => m.PulseLens),
);
const FileStreamLens = lazyWithPreload(() =>
  import("./components/refscope/FileStreamLens").then((m) => m.FileStreamLens),
);
const RiskHeatmapLens = lazyWithPreload(() =>
  import("./components/refscope/RiskHeatmapLens").then((m) => m.RiskHeatmapLens),
);
const CoChangeLens = lazyWithPreload(() =>
  import("./components/refscope/CoChangeLens").then((m) => m.CoChangeLens),
);
const OutboxLens = lazyWithPreload(() =>
  import("./components/refscope/OutboxLens").then((m) => m.OutboxLens),
);
const DigestLens = lazyWithPreload(() =>
  import("./components/refscope/DigestLens").then((m) => m.DigestLens),
);
const RewriteRescuePanel = lazyWithPreload(() =>
  import("./components/refscope/RewriteRescuePanel").then((m) => m.RewriteRescuePanel),
);
const RefFlightRecorderLens = lazyWithPreload(() =>
  import("./components/refscope/RefFlightRecorderLens").then((m) => m.RefFlightRecorderLens),
);
// Dialogs that render nothing until opened: each mounts on its first open
// (see useLatch) and is prefetched with the lenses.
const RepoBrowserDialog = lazyWithPreload(() =>
  import("./components/refscope/RepoBrowserDialog").then((m) => m.RepoBrowserDialog),
);
const ReleasesDialog = lazyWithPreload(() =>
  import("./components/refscope/ReleasesDialog").then((m) => m.ReleasesDialog),
);
const FileViewerDialog = lazyWithPreload(() =>
  import("./components/refscope/FileViewerDialog").then((m) => m.FileViewerDialog),
);

function LensLoading() {
  return (
    <div
      role="status"
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        color: "var(--rs-text-secondary)",
        fontFamily: "var(--rs-sans)",
      }}
    >
      Loading…
    </div>
  );
}

const RECENT_FILE_HISTORY_PATHS_STORAGE_KEY = "refscope.fileHistory.recentPaths.v1";
const RECENT_FILE_HISTORY_PATHS_MAX = 10;
const RECENT_FILE_HISTORY_PATHS_SCHEMA_VERSION = 1;
const FLIGHT_RECORDER_FLAG_STORAGE_KEY = "refscope.flags.flightRecorder.v1";
const BASE_LENSES: readonly LensId[] = [
  "live",
  "pulse",
  "stream",
  "hotspot",
  "risk-trend",
  "risk-heatmap",
  "co-change",
  "drift",
  "outbox",
  "digest",
  "rescue",
  "symbol",
];

type RecentFileHistoryPathsPayload = {
  v: typeof RECENT_FILE_HISTORY_PATHS_SCHEMA_VERSION;
  paths: string[];
};

/**
 * Read the persisted recent-paths list. We schema-validate every read because
 * localStorage is a public surface (browser devtools, sync between tabs);
 * a malformed value here would crash the app on mount.
 */
function loadRecentFileHistoryPaths(): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENT_FILE_HISTORY_PATHS_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return [];
    const candidate = parsed as Partial<RecentFileHistoryPathsPayload>;
    if (candidate.v !== RECENT_FILE_HISTORY_PATHS_SCHEMA_VERSION) return [];
    if (!Array.isArray(candidate.paths)) return [];
    const cleaned: string[] = [];
    const seen = new Set<string>();
    for (const entry of candidate.paths) {
      if (typeof entry !== "string") continue;
      const trimmed = entry.trim();
      if (!trimmed) continue;
      if (seen.has(trimmed)) continue;
      seen.add(trimmed);
      cleaned.push(trimmed);
      if (cleaned.length >= RECENT_FILE_HISTORY_PATHS_MAX) break;
    }
    return cleaned;
  } catch {
    return [];
  }
}

function persistRecentFileHistoryPaths(paths: string[]): void {
  if (typeof window === "undefined") return;
  try {
    const payload: RecentFileHistoryPathsPayload = {
      v: RECENT_FILE_HISTORY_PATHS_SCHEMA_VERSION,
      paths: paths.slice(0, RECENT_FILE_HISTORY_PATHS_MAX),
    };
    window.localStorage.setItem(
      RECENT_FILE_HISTORY_PATHS_STORAGE_KEY,
      JSON.stringify(payload),
    );
  } catch {
    // Quota exceeded / disabled storage / private mode → silently skip.
    // The feature still works for the current session; persistence is a nice-to-have.
  }
}

function isFlightRecorderEnabled(): boolean {
  if (import.meta.env.VITE_REFSCOPE_FLIGHT_RECORDER === "1") return true;
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("flight") === "1") {
    try {
      window.localStorage.setItem(FLIGHT_RECORDER_FLAG_STORAGE_KEY, "1");
    } catch {
      // Storage is optional; URL flag still enables the lens for this session.
    }
    return true;
  }
  try {
    return window.localStorage.getItem(FLIGHT_RECORDER_FLAG_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Returns `value` once it has been stable for `delayMs`. Used to debounce the
 * typed filter inputs (search / author / path / pattern) so every keystroke
 * doesn't trigger a full refs+commits refetch.
 */
function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type BackgroundErrorSource = "drift" | "worktree" | "timeline" | "stream" | "compare";

// Backoff for reopening a live stream the server refused (non-200).
const STREAM_RETRY_MIN_MS = 2_000;
const STREAM_RETRY_MAX_MS = 30_000;

export default function App() {
  // View state handed over by the previous instance when Redact mode was
  // toggled (it remounts <App>); null on a normal page load.
  const [redactCarry] = useState(takeRedactCarryOver);
  // `?repo=&ref=&commit=&path=` captured once at startup; later URL writes
  // (replaceState below) must not feed back into selection.
  const initialDeepLink = useMemo(
    () =>
      typeof window === "undefined"
        ? { repo: "", ref: "", commit: "", path: "" }
        : parseDeepLink(window.location.search),
    [],
  );
  // `?q=&mode=&author=&since=&until=&history=` — the timeline filters a
  // shared view link carries. Redact-mode carry-over wins over the URL.
  const initialFilterLink = useMemo(
    () =>
      parseFilterLink(typeof window === "undefined" ? "" : window.location.search),
    [],
  );
  // The linked commit may be older than the first page or off the linked
  // ref; the first timeline load keeps it selected (shown from its own
  // detail) instead of replacing it with the newest row.
  const pendingDeepLinkCommitRef = useRef(initialDeepLink.commit);
  // `?cbase=&ctarget=&cmode=` restores an open compare review.
  const initialCompareLink = useMemo(
    () =>
      typeof window === "undefined"
        ? { base: "", target: "", mode: "three-dot" as const }
        : parseCompareLink(window.location.search),
    [],
  );
  const flightRecorderEnabled = useMemo(() => isFlightRecorderEnabled(), []);
  const availableLenses = useMemo<readonly LensId[]>(
    () => (flightRecorderEnabled ? [...BASE_LENSES, "flight"] : BASE_LENSES),
    [flightRecorderEnabled],
  );
  // Fleet/Detail mode state — 'detail' is the default (preserves existing behavior).
  // URL sync: ?fleet=1 ↔ mode='fleet' via replaceState (no pushState to avoid history pollution,
  // per proposal §10.1). Mount reads URL to restore mode.
  const [mode, setModeState] = useState<"fleet" | "detail">(() => {
    if (typeof window === "undefined") return "detail";
    return new URLSearchParams(window.location.search).get("fleet") === "1"
      ? "fleet"
      : "detail";
  });

  const setMode = useCallback((nextMode: "fleet" | "detail") => {
    setModeState(nextMode);
    const url = new URL(window.location.href);
    if (nextMode === "fleet") {
      url.searchParams.set("fleet", "1");
    } else {
      url.searchParams.delete("fleet");
    }
    window.history.replaceState(null, "", url.toString());
  }, []);

  // Fleet snapshot state — null until first poll completes.
  const [fleetSnapshot, setFleetSnapshot] = useState<FleetSnapshot | null>(null);
  const [fleetError, setFleetError] = useState<string | null>(null);
  const fleetAbortRef = useRef<AbortController | null>(null);

  // Fleet 集計窓セレクタ (1h/6h/24h/7d)。localStorage に永続化し、再起動後も復元。
  // API 型 (FleetSnapshot["window"]) は既に対応済だが UI は 24h ハードコードだった
  // (Echo J-2 / Spark ID-3a)。
  const [fleetWindow, setFleetWindowState] = useState<"1h" | "6h" | "24h" | "7d">(() => {
    if (typeof window === "undefined") return "24h";
    try {
      const raw = window.localStorage.getItem("refscope.fleet.window.v1");
      if (raw === "1h" || raw === "6h" || raw === "24h" || raw === "7d") return raw;
    } catch {
      // localStorage 不可: default 維持
    }
    return "24h";
  });
  const setFleetWindow = useCallback((next: "1h" | "6h" | "24h" | "7d") => {
    setFleetWindowState(next);
    try {
      window.localStorage.setItem("refscope.fleet.window.v1", next);
    } catch {
      // 永続化失敗: in-memory state のみで継続
    }
  }, []);

  // AddRepoDialog state — Step 7 will wire real API call.
  const [addRepoDialogOpen, setAddRepoDialogOpen] = useState(false);

  // Fleet polling: 30s setInterval, starts when mode='fleet', cleans up on mode switch/unmount.
  // Magi 争点 #4: Page Visibility 連動。document.hidden 時は poll skip し、
  // visible 復帰で即時 1 回 fetch (背景タブの不要な git 呼び出しを抑制)。
  // fleetWindow が変わると依存配列により effect 再起動 → 直前 abort + 即時新 window で fetch。
  useEffect(() => {
    if (mode !== "fleet") return;

    async function poll() {
      // Cancel any in-flight request before starting a new one (race prevention).
      fleetAbortRef.current?.abort();
      const controller = new AbortController();
      fleetAbortRef.current = controller;

      try {
        const snapshot = await fetchFleetSnapshot({
          window: fleetWindow,
          signal: controller.signal,
        });
        if (!controller.signal.aborted) {
          // Pass the full snapshot through. FleetSurface owns the exclude
          // filter (localStorage key refscope.fleet.excluded.v1) and needs
          // the excluded repos present in the snapshot to render its
          // "excluded this session" section with Restore buttons.
          setFleetSnapshot(snapshot);
          setFleetError(null);
        }
      } catch (err) {
        if (err instanceof Error && err.name === "AbortError") return;
        if (!controller.signal.aborted) {
          setFleetError(err instanceof Error ? err.message : String(err));
        }
      }
    }

    function maybePoll() {
      if (typeof document !== "undefined" && document.hidden) return;
      void poll();
    }

    // 初回 + window 切替時の即時 fetch。
    maybePoll();
    const timer = setInterval(maybePoll, 30_000);
    // タブが visible に戻ったタイミングで即時 1 回 poll し直す (古い snapshot を更新)。
    const onVisibility = () => {
      if (typeof document !== "undefined" && !document.hidden) {
        maybePoll();
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibility);
    }

    return () => {
      clearInterval(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
      fleetAbortRef.current?.abort();
      fleetAbortRef.current = null;
    };
  }, [mode, fleetWindow]);

  // Hoisted before `handleFleetSelectRepo` to avoid TDZ on `recordLastOpened`.
  const { lastOpenedRepos, recordLastOpened, evictRepo } = useLastOpenedRepos();

  // Single repo-switch path shared by TopBar, CommandPalette, and Fleet.
  // Every route must reset the same per-repo state (selection, compare
  // refs, alerts, pending live events, …) — otherwise stale compare refs
  // from repo A get fetched against repo B and error. Setters and refs are
  // referenced via closure (declared further down; safe because the callback
  // only runs after mount), so the dependency array stays empty.
  const switchRepo = useCallback((repoId: string) => {
    // Re-picking the open repo (palette, Fleet row) changes neither the repo
    // nor the ref, so no effect would reload what the reset below clears.
    if (repoId === selectedRepoRef.current) return;
    // Updated here too, not only in the sync effect, so two switches in one
    // batch (A→B→A) compare against the latest pick.
    selectedRepoRef.current = repoId;
    backgroundErrorsRef.current.clear();
    setSelectedRepo(repoId);
    setSelectedRef("HEAD");
    setSelected("");
    setSelectedWorkTree(false);
    // Clear the previous repo's commits so the timeline shows the loading
    // placeholder instead of briefly rendering repo A's history as repo B's.
    setCommits([]);
    setHasMoreCommits(false);
    // Likewise drop repo A's refs and drift so the sidebar and compare
    // pickers never offer A's refs against repo B.
    setRefs([]);
    setDriftMap(new Map());
    realtimeNewCommitHashesRef.current.clear();
    setEventStatus("connecting");
    setEventNotice("");
    setLivePaused(false);
    setPendingUpdates(0);
    setLiveAnnouncement("");
    pendingRealtimeEventsRef.current = [];
    setRealtimeAlerts([]);
    setRewriteRescueEntries([]);
    setCompareBase("");
    setCompareTarget("");
    setCompareResult(null);
  }, []);

  // Handle Fleet row click: switch to detail mode for the selected repo.
  const handleFleetSelectRepo = useCallback((id: string) => {
    recordLastOpened(id);
    switchRepo(id);
    setMode("detail");
  }, [setMode, recordLastOpened, switchRepo]);

  // Lens switcher state — 'live' is the default; other lenses are placeholders.
  const [activeLens, setActiveLens] = useState<LensId>(
    () => (redactCarry?.activeLens as LensId | undefined) ?? 'live',
  );
  useEffect(
    () =>
      whenIdle(() => {
        // A failed prefetch is retried when the lens is opened.
        for (const lens of [
          HotspotLens,
          RiskTrendLens,
          DriftLens,
          PulseLens,
          FileStreamLens,
          RiskHeatmapLens,
          CoChangeLens,
          OutboxLens,
          DigestLens,
          RewriteRescuePanel,
          RefFlightRecorderLens,
          RepoBrowserDialog,
          ReleasesDialog,
          FileViewerDialog,
        ]) {
          lens.preload().catch(() => {});
        }
      }),
    [],
  );
  useEffect(() => {
    if (!availableLenses.includes(activeLens)) {
      setActiveLens("live");
    }
  }, [activeLens, availableLenses]);
  const [repositories, setRepositories] = useState<Repository[]>([]);
  const [refs, setRefs] = useState<GitRef[]>([]);
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedRepo, setSelectedRepo] = useState("");

  // Hoisted after `repositories` / `selectedRepo` declarations to avoid TDZ on setters/values.
  // Handle AddRepoDialog submit — calls POST /api/repos and updates state optimistically.
  const handleAddRepo = useCallback(async (input: { id: string; path: string }) => {
    const result = await postRepo(input);
    if (result.ok) {
      setRepositories((prev) => [...prev, result.repository]);
      return { ok: true as const };
    }
    return { ok: false as const, error: result.error };
  }, []);

  // Handle FleetSurface remove — calls DELETE /api/repos/:id, evicts from last-opened,
  // and switches away from the deleted repo if it was active.
  const handleRemoveRepo = useCallback(async (repoId: string) => {
    const result = await deleteRepo(repoId);
    if (result.ok) {
      setRepositories((prev) => prev.filter((r) => r.id !== repoId));
      evictRepo(repoId);
      if (selectedRepo === repoId) {
        // Go through switchRepo so the removed repo's compare refs, selection
        // and pending live events are reset like on any other repo switch.
        const remaining = repositories.filter((r) => r.id !== repoId);
        switchRepo(remaining[0]?.id ?? "");
      }
      return { ok: true as const };
    }
    return { ok: false as const, error: result.error };
  }, [evictRepo, selectedRepo, repositories, switchRepo]);
  const [selectedRef, setSelectedRef] = useState(() => initialDeepLink.ref || "HEAD");
  const [selected, setSelected] = useState(() => initialDeepLink.commit);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [diff, setDiff] = useState<DiffPayload>(EMPTY_DIFF);
  // Reachability ("Contained in") — public refs whose history reaches the
  // selected commit. `null` means "not yet loaded for this commit"; `[]`
  // is a valid loaded state (commit exists but is unreachable from any
  // public ref, e.g. a fresh local commit before push).
  const [containingRefs, setContainingRefs] = useState<ContainingRef[] | null>(null);
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
  const [helpOpen, setHelpOpen] = useState(false);
  const [summaryViewOpen, setSummaryViewOpen] = useState(false);
  const [diffFullscreen, setDiffFullscreen] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<"all" | "single">("all");
  const [search, setSearch] = useState(() => redactCarry?.search ?? initialFilterLink.search);
  const [author, setAuthor] = useState(() => redactCarry?.author ?? initialFilterLink.author);
  const [path, setPath] = useState(() => initialDeepLink.path);
  // Commit kind filter (D-2): client-side filter applied to coarseKind from API.
  // 'all' = show all, 'refactor' = likely_refactor + empty, 'logic' = likely_logic.
  const [commitKindFilter, setCommitKindFilter] = useState<"all" | "refactor" | "logic">("all");
  // Risk Trend Lens のドラッグ範囲選択で設定される時間フィルタ (epoch ms).
  // null のときは未適用。CommitTimeline に渡す filteredCommits を絞り込む。
  const [dateRangeFilter, setDateRangeFilter] = useState<{ from: number; to: number } | null>(null);
  // State A: subject-mode value lives in `search`; pickaxe/regex/message values live in `searchPattern`.
  // Keeping them separate prevents mode-switch cross-contamination and maps 1-to-1 onto the API contract
  // (`search` param vs `mode`+`pattern` params).
  const [searchMode, setSearchMode] = useState<SearchMode>(
    () => (redactCarry?.searchMode as SearchMode | undefined) ?? initialFilterLink.searchMode,
  );
  const [searchPattern, setSearchPattern] = useState(
    () => redactCarry?.searchPattern ?? initialFilterLink.searchPattern,
  );
  // Server-side commit date window (`YYYY-MM-DD` local days from the Filters
  // popover). Unlike `dateRangeFilter` (a client-side narrowing of the rows
  // already loaded), this re-queries the whole history.
  const [sinceDate, setSinceDate] = useState(() => redactCarry?.sinceDate ?? initialFilterLink.since);
  const [untilDate, setUntilDate] = useState(() => redactCarry?.untilDate ?? initialFilterLink.until);
  // History shape: every commit, the first-parent line, merges only (one row
  // per merged pull request), or no merges. Server-side, like the dates.
  const [historyShape, setHistoryShape] = useState<HistoryShape>(() =>
    redactCarry?.historyShape ? parseHistoryShape(redactCarry.historyShape) : initialFilterLink.history,
  );
  const commitWindow = useMemo<CommitListWindow>(
    () => ({
      since: localDateToIsoBound(sinceDate, "start") || undefined,
      until: localDateToIsoBound(untilDate, "end") || undefined,
      history: historyShape,
    }),
    [sinceDate, untilDate, historyShape],
  );
  // History pagination: whether the last page was full (so older commits may
  // exist) and whether a "Load older" request is in flight.
  const [hasMoreCommits, setHasMoreCommits] = useState(false);
  const [loadingOlderCommits, setLoadingOlderCommits] = useState(false);
  // Debounced copies of the typed filter inputs. The timeline load effect
  // listens to these (not the raw values) so a refetch fires ~250ms after the
  // user stops typing instead of on every keystroke. `searchMode` is a
  // discrete toggle and stays undebounced.
  const debouncedSearch = useDebouncedValue(search, 250);
  const debouncedAuthor = useDebouncedValue(author, 250);
  const debouncedPath = useDebouncedValue(path, 250);
  const debouncedSearchPattern = useDebouncedValue(searchPattern, 250);
  const [selectionNotice, setSelectionNotice] = useState("");
  const [compareBase, setCompareBase] = useState(() => initialCompareLink.base);
  const [compareTarget, setCompareTarget] = useState(() => initialCompareLink.target);
  const [compareMode, setCompareMode] = useState<CompareMode>(() => initialCompareLink.mode);
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
  // Bumped by live refreshes so an open compare is recomputed.
  const [compareRefreshKey, setCompareRefreshKey] = useState(0);
  // Branch Drift Halo: drift fetch is independent of the timeline fetch and
  // is a dedicated batched endpoint, so we keep it in its own state. The
  // value is a Map keyed by full ref name (`refs/heads/foo`) so BranchSidebar
  // can look up O(1) per row without re-scanning the array.
  const [driftMap, setDriftMap] = useState<Map<string, RefDriftSummary>>(() => new Map());
  const [driftBaseShortName, setDriftBaseShortName] = useState<string>("HEAD");
  const driftAbortRef = useRef<AbortController | null>(null);
  const driftDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Working tree state: HEAD vs index ("staged") + index vs worktree ("unstaged").
  // Independent of the commit timeline state — we keep `selectedWorkTree` as a
  // separate boolean so the existing `selected` (commit hash) doesn't pick up a
  // sentinel value. Switching to worktree clears the commit selection and
  // vice versa, mirroring how mutually-exclusive panels are wired in the
  // BranchSidebar / DetailPanel pairing.
  const [workTree, setWorkTree] = useState<WorkTreeResponse | null>(null);
  const [selectedWorkTree, setSelectedWorkTree] = useState(false);
  // File-history feature: top-level entry point with a path-input prompt.
  // `fileHistoryPath` drives the FileHistoryView overlay; the prompt is its
  // gateway. Both states live here so CommandPalette / TopBar / DetailPanel
  // can drive the same overlay without parallel state copies.
  const [fileHistoryPath, setFileHistoryPath] = useState<string | null>(null);
  const [fileHistoryPromptOpen, setFileHistoryPromptOpen] = useState(false);
  const [recentFileHistoryPaths, setRecentFileHistoryPaths] = useState<string[]>(
    () => loadRecentFileHistoryPaths(),
  );
  // Stash + linked-worktree listings live alongside refs because the sidebar
  // renders them next to branches / tags. They re-fetch on repo change but
  // not on every commit selection — they're slow-moving observation facts.
  const [stashes, setStashes] = useState<StashEntry[]>([]);
  const [worktrees, setWorktrees] = useState<WorktreeEntry[]>([]);
  const [submodules, setSubmodules] = useState<SubmoduleEntry[]>([]);
  const [repoState, setRepoState] = useState<RepoStateResponse | null>(null);
  // Rewrite rescue: SSE history_rewritten snapshots persisted in localStorage.
  // Initialized from localStorage on repo change so previously captured events
  // survive browser refresh. App.tsx owns this state; the panel is read-only.
  const [rewriteRescueEntries, setRewriteRescueEntries] = useState<RewriteRescueEntry[]>([]);
  // Branch group prefix for the Group tab in BranchSidebar.
  // Persisted in localStorage keyed by repoId so each repo keeps its own setting.
  const [branchGroupPrefix, setBranchGroupPrefix] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = window.localStorage.getItem("refscope.branchGroup.prefix.v1");
      if (!raw) return null;
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== "string") return null;
      return parsed || null;
    } catch {
      return null;
    }
  });
  const handleSetBranchGroupPrefix = useCallback((prefix: string | null) => {
    setBranchGroupPrefix(prefix);
    try {
      if (prefix) {
        window.localStorage.setItem("refscope.branchGroup.prefix.v1", JSON.stringify(prefix));
      } else {
        window.localStorage.removeItem("refscope.branchGroup.prefix.v1");
      }
    } catch {
      // localStorage unavailable — setting works for the session only.
    }
  }, []);
  // D-4 "Why is this here?" panel query. Owned here so the query survives
  // commit re-selections within the same session. Reset when the selected
  // commit changes (handled below) so stale results don't mislead.
  const [whyPanelQuery, setWhyPanelQuery] = useState<WhyPanelQuery | null>(null);
  useEffect(() => {
    setWhyPanelQuery(null);
  }, [selected]);
  // D-1 Symbol History query. { path, funcname } when the Symbol lens is
  // active; null clears the view. Owned here so CommandPalette / LensSwitcher
  // can drive the same view without parallel state copies.
  const [symbolHistoryQuery, setSymbolHistoryQuery] = useState<{ path: string; funcname: string } | null>(null);
  const [flightRefreshKey, setFlightRefreshKey] = useState(0);
  const workTreeAbortRef = useRef<AbortController | null>(null);
  const workTreeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRepoRef = useRef(selectedRepo);
  const selectedRefRef = useRef(selectedRef);
  // Messages currently reported by background refreshes, per source. A
  // source clears its own message once it succeeds; the banner then falls
  // back to another source that is still failing, or empties.
  const backgroundErrorsRef = useRef<Map<BackgroundErrorSource, string>>(new Map());
  const timelineRefreshDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [streamRetryKey, setStreamRetryKey] = useState(0);
  // Per-repo stream state: reset when the effect opens a stream for another
  // repo, kept across the reopen of a refused stream.
  const streamRepoRef = useRef("");
  const streamResyncOnConnectRef = useRef(false);
  const streamRetryDelayRef = useRef(STREAM_RETRY_MIN_MS);
  // Filters as the timeline last applied them (debounced), for live
  // refreshes that run outside React's render cycle. Reading the raw input
  // instead would apply a half-typed filter (or a regex such as `(foo` on
  // its way to `(foo|bar)`) and leave its error behind.
  const searchRef = useRef(debouncedSearch);
  const authorRef = useRef(debouncedAuthor);
  const pathRef = useRef(debouncedPath);
  const searchModeRef = useRef(searchMode);
  const searchPatternRef = useRef(debouncedSearchPattern);
  const commitWindowRef = useRef(commitWindow);
  commitWindowRef.current = commitWindow;
  const selectedWorkTreeRef = useRef(selectedWorkTree);
  // The list a live refresh replaces: tells a timeline row that left the
  // list apart from a lens selection that was never in it.
  const commitsRef = useRef(commits);
  // repo/base/target of the compare result on screen; a run with the same
  // key is a live refresh of it. Set only once a result is applied, so a
  // refresh that replaces a still-pending first request is treated as the
  // first request (loading shown, errors in the foreground).
  const compareKeyRef = useRef("");
  const livePausedRef = useRef(livePaused);
  // Generation guard for refreshTimeline: bumped whenever the active repo
  // changes so an SSE-triggered refresh that resolves after a repo switch is
  // discarded instead of clobbering the new repo's refs/commits.
  const timelineGenerationRef = useRef(0);
  // Every timeline load/refresh takes a ticket when it starts; a result is
  // applied only if no later-started one has been applied already. A newer
  // request that fails therefore never discards an older one that succeeded.
  const timelineTicketRef = useRef(0);
  const appliedTimelineTicketRef = useRef(0);
  const pendingRealtimeEventsRef = useRef<Array<() => void>>([]);
  const realtimeNewCommitHashesRef = useRef<Set<string>>(new Set());
  const { quietMode, prefersReducedMotion, isQuiet, toggleQuietMode } = useQuietMode();
  const { redacted, setRedacted } = useRedactMode();
  // Read through a ref so the shortcut / palette callbacks stay stable.
  const redactCarryStateRef = useRef({ search, author, searchMode, searchPattern, sinceDate, untilDate, historyShape, activeLens });
  redactCarryStateRef.current = { search, author, searchMode, searchPattern, sinceDate, untilDate, historyShape, activeLens };
  const toggleRedact = useCallback(() => {
    setRedacted(!redacted, redactCarryStateRef.current);
  }, [redacted, setRedacted]);
  // Pinned refs double as the watch list: they sort first in the
  // since-last-visit briefing and can raise desktop notifications.
  const { pinnedSet: watchedRefs } = usePinnedRefs(selectedRepo);
  const { briefing: refBriefing, dismiss: dismissRefBriefing } = useRefBriefing(selectedRepo, refs, watchedRefs);
  const watchNotifications = useWatchNotifications(
    watchedRefs,
    repositories.find((repo) => repo.id === selectedRepo)?.name ?? selectedRepo,
  );
  const notifyWatchedRef = watchNotifications.notify;
  const { colorVisionTheme, isCvdSafe, toggleTheme: toggleColorVisionTheme } = useColorVisionTheme();
  const {
    sidebarCollapsed,
    panelSizes,
    setSidebarCollapsed,
    toggleSidebar,
    setPanelSizes,
  } = useLayoutPrefs();
  const {
    compareBarCollapsed,
    activityGraphCollapsed,
    toggleCompareBar,
    toggleActivityGraph,
  } = useTimelinePrefs();
  const sidebarPanelRef = useRef<ImperativePanelHandle>(null);
  // Below 768px the three panes stack vertically instead of being squeezed
  // side by side (each pane was ~130px wide at 390px).
  const isNarrow = useIsMobile();
  // Mount the sidebar at its collapsed size when the persisted preference says
  // so. Mounting it expanded made react-resizable-panels fire onExpand, which
  // overwrote the saved "hidden" preference on every reload.
  const initialPanelSizes = useMemo(() => {
    if (!sidebarCollapsed) return panelSizes;
    const rest = panelSizes.center + panelSizes.detail;
    return {
      sidebar: 0,
      center: (panelSizes.center / rest) * 100,
      detail: (panelSizes.detail / rest) * 100,
    };
    // Only the mount-time value matters (defaultSize); recompute when the
    // group remounts for a layout-direction change.
  }, [isNarrow]);
  // Track collapse intent vs. actual panel state so the imperative API is only
  // called when they diverge — react-resizable-panels' collapse() is idempotent
  // but extra calls during drag would fight user input.
  useEffect(() => {
    const handle = sidebarPanelRef.current;
    if (!handle) return;
    if (sidebarCollapsed && !handle.isCollapsed()) {
      handle.collapse();
    } else if (!sidebarCollapsed && handle.isCollapsed()) {
      // A panel mounted collapsed has no pre-collapse size to restore, so
      // reopen it at the user's saved ratio rather than at minSize.
      handle.resize(Math.min(30, Math.max(12, panelSizes.sidebar)));
    }
    // panelSizes is read for the restore size only; re-running on every drag
    // would fight user input.
  }, [sidebarCollapsed, isNarrow]);
  // Quiet mode controls motion only; SSE application must not gate on isQuiet,
  // or OS prefers-reduced-motion silently freezes ref/commit updates.
  const effectivePaused = livePaused;

  useEffect(() => {
    livePausedRef.current = livePaused;
  }, [livePaused]);

  // Any change to what the timeline shows invalidates in-flight live
  // refreshes, so a refresh started for ref A cannot overwrite (or snap the
  // selection back from) ref B or a newer filter.
  useEffect(() => {
    timelineGenerationRef.current += 1;
  }, [
    selectedRepo,
    selectedRef,
    debouncedSearch,
    debouncedAuthor,
    debouncedPath,
    searchMode,
    debouncedSearchPattern,
    commitWindow,
  ]);

  useEffect(() => {
    selectedRepoRef.current = selectedRepo;
  }, [selectedRepo]);

  useEffect(() => {
    selectedRefRef.current = selectedRef;
  }, [selectedRef]);

  const reportBackgroundError = useCallback((source: BackgroundErrorSource, message: string) => {
    backgroundErrorsRef.current.set(source, message);
    setError(message);
  }, []);

  const clearBackgroundError = useCallback((...sources: BackgroundErrorSource[]) => {
    const errors = backgroundErrorsRef.current;
    const cleared = new Set<string>();
    for (const source of sources) {
      const message = errors.get(source);
      if (message == null) continue;
      errors.delete(source);
      cleared.add(message);
    }
    if (cleared.size === 0) return;
    const remaining = [...errors.values()].at(-1) ?? "";
    setError((current) => (cleared.has(current) ? remaining : current));
  }, []);

  // A foreground request (initial load, compare, commit detail) that succeeds
  // replaces the banner with a background failure that is still active, if any.
  const clearForegroundError = useCallback(() => {
    setError([...backgroundErrorsRef.current.values()].at(-1) ?? "");
  }, []);

  useEffect(() => {
    searchRef.current = debouncedSearch;
  }, [debouncedSearch]);

  useEffect(() => {
    authorRef.current = debouncedAuthor;
  }, [debouncedAuthor]);

  useEffect(() => {
    pathRef.current = debouncedPath;
  }, [debouncedPath]);

  useEffect(() => {
    searchModeRef.current = searchMode;
  }, [searchMode]);

  useEffect(() => {
    searchPatternRef.current = debouncedSearchPattern;
  }, [debouncedSearchPattern]);

  useEffect(() => {
    selectedWorkTreeRef.current = selectedWorkTree;
  }, [selectedWorkTree]);

  useEffect(() => {
    commitsRef.current = commits;
  }, [commits]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    listRepositories()
      .then((items) => {
        if (cancelled) return;
        setRepositories(items);
        const linked = initialDeepLink.repo;
        const linkValid = Boolean(linked) && items.some((item) => item.id === linked);
        if (linked && !linkValid && !selectedRepoRef.current) {
          // A link to a repo that is no longer allowlisted must not apply
          // its ref/commit/path to a different repository.
          pendingDeepLinkCommitRef.current = "";
          setSelectedRef("HEAD");
          setSelected("");
          setPath("");
          setCompareBase("");
          setCompareTarget("");
        }
        setSelectedRepo((current) => current || (linkValid ? linked : items[0]?.id || ""));
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
    // A live refresh that starts later and lands first must win over this
    // (older) load; see timelineTicketRef.
    const ticket = ++timelineTicketRef.current;
    const isStale = () => cancelled || ticket < appliedTimelineTicketRef.current;
    setLoading(true);
    loadRepositoryState(
      selectedRepo,
      selectedRef,
      debouncedSearch,
      debouncedAuthor,
      debouncedPath,
      searchMode,
      debouncedSearchPattern,
      commitWindow,
    )
      .then(({ nextRefs, nextRef, nextCommits }) => {
        if (isStale()) return;
        appliedTimelineTicketRef.current = ticket;
        setHasMoreCommits(pageMayHaveMore(nextCommits.length, COMMIT_PAGE_SIZE));
        const markedCommits = markRealtimeNewCommits(
          nextCommits,
          realtimeNewCommitHashesRef.current,
        );
        setRefs(nextRefs);
        setSelectedRef(nextRef);
        setCommits(markedCommits);
        setSelected((current) => {
          // The working tree is shown instead of a commit; picking one here
          // would only fetch a detail nobody sees.
          if (selectedWorkTreeRef.current) return current;
          const linked = pendingDeepLinkCommitRef.current;
          // A hand-written `ref=main` resolves to `refs/heads/main` and
          // reloads once more; keep the link alive until the ref settles.
          if (nextRef === selectedRef) pendingDeepLinkCommitRef.current = "";
          if (linked && current === linked) {
            setSelectionNotice("");
            return current;
          }
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
        // This load reflects the current filters, so an earlier live refresh's
        // failure (e.g. a since-corrected regex) no longer applies.
        clearBackgroundError("timeline");
        clearForegroundError();
      })
      .catch((err) => {
        if (!isStale()) setError(errorMessage(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [
    selectedRepo,
    selectedRef,
    debouncedSearch,
    debouncedAuthor,
    debouncedPath,
    searchMode,
    debouncedSearchPattern,
    commitWindow,
  ]);

  useEffect(() => {
    if (!selectedRepo || !compareBase || !compareTarget) {
      compareKeyRef.current = "";
      clearBackgroundError("compare");
      setCompareResult(null);
      return;
    }
    let cancelled = false;
    const key = `${selectedRepo}\0${compareBase}\0${compareTarget}`;
    // A live refresh updates the result in place: no loading flash, and a
    // failure keeps the last result and reports like other background work
    // instead of replacing an unrelated foreground error.
    const refresh = compareKeyRef.current === key;
    if (!refresh) setCompareLoading(true);
    compareRefs(selectedRepo, compareBase, compareTarget)
      .then((result) => {
        if (cancelled) return;
        compareKeyRef.current = key;
        setCompareResult(result);
        clearBackgroundError("compare");
        if (!refresh) clearForegroundError();
      })
      .catch((err) => {
        if (cancelled) return;
        if (refresh) {
          reportBackgroundError("compare", errorMessage(err));
          return;
        }
        compareKeyRef.current = "";
        setCompareResult(null);
        setError(errorMessage(err));
      })
      .finally(() => {
        // Whichever request is current settles loading, including one that
        // replaced the request that set it.
        if (!cancelled) setCompareLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo, compareBase, compareTarget, compareRefreshKey]);

  useEffect(() => {
    setDiffFullscreen(false);
  }, [selected]);

  useEffect(() => {
    if (!selectedRepo || !selected) {
      setDetail(null);
      setDiff(EMPTY_DIFF);
      setContainingRefs(null);
      setDetailLoading(false);
      return;
    }
    // A new selection must not retain the previous commit's detail or diff,
    // including when the new read fails or the commit is outside this ref.
    setDetail(null);
    setDiff(EMPTY_DIFF);
    setContainingRefs(null);
    // Show the indicator immediately so rapid navigation has visible feedback
    // while we coalesce key-repeat bursts before issuing a fetch.
    setDetailLoading(true);
    const controller = new AbortController();
    // Coalesce rapid `selected` changes (key-repeat / arrow-hold) into a
    // single fetch. Each useEffect cleanup clears the pending timer and
    // aborts any in-flight request, so:
    //   1. fast bursts → only the final selection actually hits the API
    //   2. single clicks → a 60 ms delay that is imperceptible in practice
    //   3. in-flight aborts → AbortController stops both fetch and the
    //      client-side `response.json()` work that previously froze the
    //      main thread on 4 MB diffs.
    // This complements the AbortController by also reducing the number of
    // server-side `git show --patch` spawns the API has to absorb during
    // rapid navigation.
    const timer = setTimeout(() => {
      // Reachability fetch is fire-and-forget alongside detail/diff so a slow
      // for-each-ref on a repo with thousands of refs doesn't block the
      // primary detail render. Failures degrade the section to a friendly
      // empty state rather than surfacing a top-level banner.
      getCommitContainingRefs(selectedRepo, selected, controller.signal)
        .then((refs) => {
          if (controller.signal.aborted) return;
          setContainingRefs(refs);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          // Treat as "no data" rather than a hard error; an empty array is a
          // valid render state for the panel.
          setContainingRefs([]);
        });
      // Settle detail and diff independently: a diff that fails (e.g. a git
      // timeout on a huge commit) must not discard metadata that loaded.
      Promise.allSettled([
        getCommit(selectedRepo, selected, controller.signal),
        getDiff(selectedRepo, selected, controller.signal),
      ])
        .then(([detailResult, diffResult]) => {
          if (controller.signal.aborted) return;
          if (detailResult.status === "fulfilled") setDetail(detailResult.value);
          if (diffResult.status === "fulfilled") setDiff(diffResult.value);
          const failure = [detailResult, diffResult].find(
            (result): result is PromiseRejectedResult => result.status === "rejected",
          );
          if (!failure) {
            // A successful load clears any error left by a previous failed
            // detail/diff fetch — otherwise the banner sticks forever.
            clearForegroundError();
            return;
          }
          const err = failure.reason;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(errorMessage(err));
        })
        .finally(() => {
          if (!controller.signal.aborted) setDetailLoading(false);
        });
    }, 60);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [selectedRepo, selected]);

  // Branch Drift Halo: refetch the batched drift payload. Cancels any
  // in-flight request via AbortController so a fast burst of SSE events
  // doesn't pile up parallel network calls. Base stays at "HEAD" for the
  // MVP; the API accepts an explicit base parameter for future use.
  const refreshDrift = useCallback(
    (repoId: string) => {
      if (!repoId) {
        setDriftMap(new Map());
        return;
      }
      driftAbortRef.current?.abort();
      const controller = new AbortController();
      driftAbortRef.current = controller;
      fetchRefDrift(repoId, { base: "HEAD" }, controller.signal)
        .then((response) => {
          if (controller.signal.aborted) return;
          setDriftMap(buildDriftMap(response.refs));
          setDriftBaseShortName(shortenBaseLabel(response.base.input));
          clearBackgroundError("drift");
        })
        .catch((err) => {
          // Aborts are routine (rapid SSE bursts cancel the previous in-flight
          // request) — they are not user-visible errors. Anything else surfaces
          // through the existing error banner so users can see the API issue.
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          reportBackgroundError("drift", errorMessage(err));
        });
    },
    [clearBackgroundError, reportBackgroundError],
  );

  // Debounce SSE-driven drift refetches. Multiple ref_* events can fire in
  // quick succession (rapid push, branch tidy-up); we coalesce them into one
  // request so the API isn't hammered. 500 ms is the spec-recommended value
  // — fast enough that the halo feels live, slow enough to absorb bursts.
  const scheduleDriftRefresh = useCallback(
    (repoId: string) => {
      if (driftDebounceRef.current) {
        clearTimeout(driftDebounceRef.current);
      }
      driftDebounceRef.current = setTimeout(() => {
        driftDebounceRef.current = null;
        refreshDrift(repoId);
      }, 500);
    },
    [refreshDrift],
  );

  useEffect(() => {
    if (!selectedRepo) {
      setDriftMap(new Map());
      return;
    }
    refreshDrift(selectedRepo);
    return () => {
      driftAbortRef.current?.abort();
      if (driftDebounceRef.current) {
        clearTimeout(driftDebounceRef.current);
        driftDebounceRef.current = null;
      }
    };
  }, [selectedRepo, refreshDrift]);

  // Working-tree fetch. Same Abort-based pattern as `refreshDrift`: any
  // in-flight request is cancelled when the inputs change or a fresh refresh
  // fires, so the UI never shows a stale snapshot. Errors surface through the
  // existing error banner — except `AbortError`, which is routine.
  const refreshWorkTree = useCallback((repoId: string) => {
    if (!repoId) {
      setWorkTree(null);
      return;
    }
    workTreeAbortRef.current?.abort();
    const controller = new AbortController();
    workTreeAbortRef.current = controller;
    fetchWorkTree(repoId, controller.signal)
      .then((response) => {
        if (controller.signal.aborted) return;
        setWorkTree((prev) =>
          prev && isWorkTreeContentEqual(prev, response) ? prev : response,
        );
        clearBackgroundError("worktree");
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        reportBackgroundError("worktree", errorMessage(err));
      });
  }, [clearBackgroundError, reportBackgroundError]);

  // Window focus + repo-change refresh. Multiple focus events can fire in
  // quick succession when the user alt-tabs through several windows; we
  // debounce them so the API isn't hammered with redundant snapshots. 500 ms
  // mirrors `scheduleDriftRefresh` for consistency.
  const scheduleWorkTreeRefresh = useCallback(
    (repoId: string) => {
      if (workTreeDebounceRef.current) {
        clearTimeout(workTreeDebounceRef.current);
      }
      workTreeDebounceRef.current = setTimeout(() => {
        workTreeDebounceRef.current = null;
        refreshWorkTree(repoId);
      }, 500);
    },
    [refreshWorkTree],
  );

  useEffect(() => {
    if (!selectedRepo) {
      setWorkTree(null);
      setSelectedWorkTree(false);
      return;
    }
    refreshWorkTree(selectedRepo);
    const onFocus = () => scheduleWorkTreeRefresh(selectedRepo);
    window.addEventListener("focus", onFocus);
    // Working-tree changes (notably new untracked files) don't surface as
    // ref-snapshot SSE events, so without polling the Live view only updates
    // on focus or manual refresh. A 2.5s tick is loose enough to absorb the
    // 5-call cost of the worktree endpoint while keeping "Live" actually live.
    // Skip when the tab is hidden or live updates are paused.
    const poll = window.setInterval(() => {
      if (typeof document !== "undefined" && document.hidden) return;
      if (livePausedRef.current) return;
      refreshWorkTree(selectedRepo);
    }, 2500);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(poll);
      workTreeAbortRef.current?.abort();
      if (workTreeDebounceRef.current) {
        clearTimeout(workTreeDebounceRef.current);
        workTreeDebounceRef.current = null;
      }
    };
  }, [selectedRepo, refreshWorkTree, scheduleWorkTreeRefresh]);

  useEffect(() => {
    if (!selectedRepo) return;
    const source = new EventSource(eventsUrl(selectedRepo));
    if (streamRepoRef.current !== selectedRepo) {
      streamRepoRef.current = selectedRepo;
      streamResyncOnConnectRef.current = false;
      streamRetryDelayRef.current = STREAM_RETRY_MIN_MS;
    }
    // Resync on `connected` once this repo has had a stream before or a
    // refused one is being reopened (see `onerror`): changes made in the gap
    // emit no events, since the server diffs against a fresh snapshot.
    let hasConnected = streamResyncOnConnectRef.current;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    source.addEventListener("connected", () => {
      streamResyncOnConnectRef.current = true;
      streamRetryDelayRef.current = STREAM_RETRY_MIN_MS;
      clearBackgroundError("stream");
      setEventStatus("connected");
      if (hasConnected) {
        // Each connection diffs against a fresh server-side snapshot, so
        // changes made while EventSource was reconnecting emit no events.
        // Resync once instead of staying stale until the next change.
        const notice = "Reconnected";
        handleRealtimeEvent(notice, () => setEventNotice(notice));
        scheduleDriftRefresh(selectedRepo);
        setFlightRefreshKey((value) => value + 1);
      }
      hasConnected = true;
    });
    source.addEventListener("commit_added", (event) => {
      const data = parseEvent(event);
      notifyWatchedRef(data);
      const notice = `New commit on ${eventRefName(data)}`;
      handleRealtimeEvent(notice, () => {
        setEventNotice(notice);
        if (data.type === "commit_added") {
          rememberRealtimeNewCommit(data.commit.hash, realtimeNewCommitHashesRef.current);
        }
      });
      // A new commit on the base advances HEAD and shifts every other ref's
      // ahead/behind by one; on a non-base ref it shifts that single ref's
      // ahead. Either way drift needs a refresh.
      scheduleDriftRefresh(selectedRepo);
    });
    source.addEventListener("history_rewritten", (event) => {
      const data = parseEvent(event);
      notifyWatchedRef(data);
      const notice = `History rewritten on ${eventRefName(data)}`;
      // Capture the pre-rewrite snapshot immediately (outside the pause guard)
      // so we never miss it even when live updates are paused. Persistence to
      // localStorage happens here; the state update is handled inside the guard
      // to keep UI changes coherent with the pause/resume cycle.
      if (data.type === "history_rewritten") {
        const entry: RewriteRescueEntry = {
          ref: data.ref.name,
          branch: data.ref.name.replace(/^refs\/heads\//, ""),
          previousHash: data.previousHash,
          currentHash: data.currentHash,
          observedAt: data.observedAt ?? new Date().toISOString(),
          repoId: data.repoId,
        };
        saveRewriteSnapshot(data.repoId, entry);
        // Update in-memory state immediately so the Rescue lens shows the event
        // without requiring the user to switch repos or refresh. Prepend newest
        // first and cap at MAX_SNAPSHOTS (mirrors rewriteStore.ts ring buffer).
        setRewriteRescueEntries((prev) =>
          [entry, ...prev.filter(
            (e) =>
              !(e.ref === entry.ref &&
                e.previousHash === entry.previousHash &&
                e.observedAt === entry.observedAt),
          )].slice(0, MAX_SNAPSHOTS),
        );
      }
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
      // History rewrites change ahead/behind against base, so refresh drift.
      scheduleDriftRefresh(selectedRepo);
      setFlightRefreshKey((value) => value + 1);
    });
    for (const type of ["ref_created", "ref_updated", "ref_deleted"] as const) {
      source.addEventListener(type, (event) => {
        try {
          notifyWatchedRef(parseEvent(event));
        } catch {
          // A malformed payload only skips the notification.
        }
        const notice = "Refs changed";
        handleRealtimeEvent(notice, () => setEventNotice(notice));
        // Any ref topology change can shift drift on every other ref (e.g.
        // moving HEAD changes ahead/behind for all branches). Debounced
        // refresh coalesces bursts.
        scheduleDriftRefresh(selectedRepo);
        setFlightRefreshKey((value) => value + 1);
      });
    }
    source.onerror = (event) => {
      // The server reports a failed poll as an `error` event on a stream that
      // stays open, and EventSource delivers it here too. Only a transport
      // failure (no payload) means the stream itself is down; a later
      // `connected` restores the status.
      const streamError = parseStreamErrorEvent(event);
      if (streamError) {
        reportBackgroundError("stream", streamError);
        return;
      }
      setEventStatus("error");
      // EventSource retries a dropped connection by itself, but a non-200
      // answer (e.g. the initial ref snapshot timed out on a busy repo)
      // closes it for good. Reopen it with backoff by re-running this effect.
      if (source.readyState === EventSource.CLOSED && !retryTimer) {
        const delay = streamRetryDelayRef.current;
        streamRetryDelayRef.current = Math.min(delay * 2, STREAM_RETRY_MAX_MS);
        streamResyncOnConnectRef.current = true;
        retryTimer = setTimeout(() => setStreamRetryKey((key) => key + 1), delay);
      }
    };
    return () => {
      if (retryTimer) clearTimeout(retryTimer);
      if (timelineRefreshDebounceRef.current) {
        clearTimeout(timelineRefreshDebounceRef.current);
        timelineRefreshDebounceRef.current = null;
      }
      source.close();
    };
    // `scheduleDriftRefresh` and other callbacks read from refs/state via
    // their useCallback closures; the only reactive identifier the EventSource
    // itself depends on is `selectedRepo` (plus `streamRetryKey`, which only
    // reopens it), mirroring existing precedent in this file.
  }, [selectedRepo, streamRetryKey]);

  // Repo-scoped sidebar facts refresh per repo. All four endpoints are
  // failure-soft — missing data degrades to an empty section / clean banner
  // rather than evicting the sidebar; transient network blips shouldn't
  // surface as red error UI for these slow-moving observation facts.
  useEffect(() => {
    if (!selectedRepo) {
      setStashes([]);
      setWorktrees([]);
      setSubmodules([]);
      setRepoState(null);
      return;
    }
    let cancelled = false;
    Promise.all([
      listStashes(selectedRepo).catch(() => [] as StashEntry[]),
      listWorktrees(selectedRepo).catch(() => [] as WorktreeEntry[]),
      listSubmodules(selectedRepo).catch(() => [] as SubmoduleEntry[]),
      getRepoState(selectedRepo).catch(
        () => null as RepoStateResponse | null,
      ),
    ]).then(([stashList, worktreeList, submoduleList, state]) => {
      if (cancelled) return;
      setStashes(stashList);
      setWorktrees(worktreeList);
      setSubmodules(submoduleList);
      setRepoState(state);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedRepo]);

  // Rewrite rescue: load persisted snapshots from localStorage when the active
  // repo changes. The in-memory state is replaced so stale entries from a
  // previous repo don't bleed into the new repo's panel.
  useEffect(() => {
    if (!selectedRepo) {
      setRewriteRescueEntries([]);
      return;
    }
    setRewriteRescueEntries(loadRewriteSnapshots(selectedRepo));
  }, [selectedRepo]);

  // Shortcut wiring lives further down (see `shortcutBindings` + `useKeyboardShortcuts`)
  // so it can read `current`, `commits`, and `diff` availability that are
  // computed below.

  // Lenses can select a commit outside the current ref or filters. Keep that
  // selection independent of the timeline instead of borrowing its first row.
  // Detail and diff are fetched together, so the detail hash identifies both.
  const selectedDetail = detail?.hash === selected ? detail : null;
  const selectedDiff = selectedDetail ? diff : EMPTY_DIFF;
  const current = commits.find((c) => c.hash === selected)
    ?? (selectedDetail ? commitFromDetail(selectedDetail) : null);
  // Client-side commit kind filter (D-2). Applied after server-side filters so the
  // list endpoint payload is unchanged; only the rendered subset changes.
  const filteredCommits = useMemo(() => {
    let result = commits;
    if (commitKindFilter !== "all") {
      result = result.filter((c) => {
        const kind = c.coarseKind;
        if (commitKindFilter === "refactor") {
          // 'empty' is included because zero-change commits carry no logic.
          return kind === "likely_refactor" || kind === "empty" || kind === undefined;
        }
        // 'logic': show likely_logic and unknown (undefined = legacy API response)
        return kind === "likely_logic" || kind === undefined;
      });
    }
    if (dateRangeFilter) {
      const { from, to } = dateRangeFilter;
      result = result.filter((c) => {
        const ts = Date.parse(c.authorDate ?? c.time ?? "");
        if (!Number.isFinite(ts)) return false;
        return ts >= from && ts <= to;
      });
    }
    return result;
  }, [commits, commitKindFilter, dateRangeFilter]);
  const repoName = repositories.find((repo) => repo.id === selectedRepo)?.name ?? selectedRepo;
  const refName = displayRefName(selectedRef, refs);
  const toggleSummaryView = useCallback(() => setSummaryViewOpen((prev) => !prev), []);

  // ---- Saved views, share link and export -------------------------------
  // A view is the server-side filter set (ref, search, author, path, dates,
  // history shape). Typed values are compared after debounce so a view only
  // reads as "current" once the timeline actually shows it.
  const { views: savedViews, saveView, deleteView } = useSavedViews(selectedRepo);
  const currentFilters = useMemo<TimelineFilters>(
    () => ({
      ref: selectedRef,
      searchMode,
      search: debouncedSearch,
      searchPattern: debouncedSearchPattern,
      author: debouncedAuthor,
      path: debouncedPath,
      since: sinceDate,
      until: untilDate,
      history: historyShape,
    }),
    [
      selectedRef,
      searchMode,
      debouncedSearch,
      debouncedSearchPattern,
      debouncedAuthor,
      debouncedPath,
      sinceDate,
      untilDate,
      historyShape,
    ],
  );
  const activeSavedView = useMemo(
    () => findMatchingView(savedViews, currentFilters),
    [savedViews, currentFilters],
  );
  const applySavedView = useCallback((view: SavedView) => {
    const { filters } = view;
    setSelectedRef(filters.ref);
    setSearchMode(filters.searchMode);
    setSearch(filters.search);
    setSearchPattern(filters.searchPattern);
    setAuthor(filters.author);
    setPath(filters.path);
    setSinceDate(filters.since);
    setUntilDate(filters.until);
    setHistoryShape(filters.history);
    setDateRangeFilter(null);
    setSelected("");
    setActiveLens("live");
    setLiveAnnouncement(`Applied view ${view.name}.`);
  }, []);
  const saveCurrentView = useCallback(
    (name: string) => {
      // Save what the inputs say now, not the debounced copy, so typing a
      // filter and saving immediately keeps the last keystrokes.
      const { view, persisted } = saveView(name, {
        ref: selectedRef,
        searchMode,
        search,
        searchPattern,
        author,
        path,
        since: sinceDate,
        until: untilDate,
        history: historyShape,
      });
      if (!view) return "Enter a name for the view.";
      return persisted
        ? `Saved “${view.name}”.`
        : `Saved “${view.name}” for this session — browser storage is unavailable.`;
    },
    [saveView, selectedRef, searchMode, search, searchPattern, author, path, sinceDate, untilDate, historyShape],
  );
  const exportExtraFilters = useMemo(
    () =>
      [
        commitKindFilter !== "all" ? `kind: ${commitKindFilter}` : "",
        dateRangeFilter
          ? `brushed ${new Date(dateRangeFilter.from).toISOString().slice(0, 10)} → ${new Date(dateRangeFilter.to).toISOString().slice(0, 10)}`
          : "",
      ].filter(Boolean),
    [commitKindFilter, dateRangeFilter],
  );
  const buildTimelineExport = useCallback(
    (format: "markdown" | "csv") => {
      const generatedAt = new Date().toISOString();
      const text =
        format === "markdown"
          ? timelineToMarkdown(filteredCommits, {
              repo: repoName,
              filters: currentFilters,
              generatedAt,
              hasMore: hasMoreCommits,
              extraFilters: exportExtraFilters,
            })
          : timelineToCsv(filteredCommits);
      return { text, stem: exportFileStem(repoName, selectedRef, generatedAt) };
    },
    [filteredCommits, repoName, currentFilters, hasMoreCommits, exportExtraFilters, selectedRef],
  );
  const copyViewLink = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      return redacted && author.trim()
        ? "Link copied — the author filter is left out in Redact mode."
        : "Link copied.";
    } catch {
      return "Copy failed — copy the address bar instead.";
    }
  }, [redacted, author]);
  const copyTimelineMarkdown = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(buildTimelineExport("markdown").text);
      return `Copied ${filteredCommits.length} commit${filteredCommits.length === 1 ? "" : "s"} as Markdown.`;
    } catch {
      return "Copy failed — use Download instead.";
    }
  }, [buildTimelineExport, filteredCommits.length]);
  const downloadTimeline = useCallback(
    (format: "markdown" | "csv") => {
      const { text, stem } = buildTimelineExport(format);
      const blob = new Blob([text], {
        type: format === "markdown" ? "text/markdown;charset=utf-8" : "text/csv;charset=utf-8",
      });
      const href = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = href;
      link.download = `${stem}.${format === "markdown" ? "md" : "csv"}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(href), 0);
      return `Downloaded ${link.download}.`;
    },
    [buildTimelineExport],
  );
  const timelineViewCommands = useMemo<TimelineViewCommand[]>(() => {
    if (mode !== "detail" || !selectedRepo) return [];
    const viewCommands: TimelineViewCommand[] = savedViews.map((view) => ({
      kind: "view",
      label: `Apply view: ${view.name}`,
      hint: [shortRefName(view.filters.ref), ...describeFilters(view.filters)].join(" · "),
      run: () => applySavedView(view),
    }));
    const historyCommands: TimelineViewCommand[] = HISTORY_SHAPES.filter((shape) => shape !== historyShape).map(
      (shape) => ({
        kind: "history",
        label: `History: ${HISTORY_SHAPE_INFO[shape].label}`,
        hint: shape === "merges" ? "pull requests" : shape,
        run: () => {
          setHistoryShape(shape);
          setSelected("");
        },
      }),
    );
    const exportCommands: TimelineViewCommand[] = [
      { kind: "export", label: "Copy link to this view", hint: "share", run: copyViewLink },
      { kind: "export", label: "Copy commit list as Markdown", hint: `${filteredCommits.length} commits`, run: copyTimelineMarkdown },
      { kind: "export", label: "Download commit list as CSV", hint: "export", run: () => downloadTimeline("csv") },
    ];
    return [...viewCommands, ...historyCommands, ...exportCommands];
  }, [
    mode,
    selectedRepo,
    savedViews,
    applySavedView,
    historyShape,
    copyViewLink,
    copyTimelineMarkdown,
    downloadTimeline,
    filteredCommits.length,
  ]);
  // Suggestions for the file-history prompt: most-recent first, then the
  // currently-selected commit's changed files. Dedup happens here so the
  // prompt component stays presentational.
  const fileHistorySuggestions = (() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    for (const entry of recentFileHistoryPaths) {
      if (seen.has(entry)) continue;
      seen.add(entry);
      merged.push(entry);
    }
    // Timeline commits always carry `files: []` (the list endpoint omits
    // per-file stats), so the changed-file suggestions come from the loaded
    // commit detail when it matches the selected commit, falling back to
    // `current.files` for callers that do populate it.
    const selectedFiles =
      detail && current && detail.hash === current.hash
        ? detail.files
        : current?.files ?? [];
    for (const file of selectedFiles) {
      if (!file?.path || seen.has(file.path)) continue;
      seen.add(file.path);
      merged.push(file.path);
    }
    return merged;
  })();

  // Mutual exclusion: selecting a commit must clear the worktree selection
  // (the DetailPanel can only show one of the two), and vice versa. Keeping
  // the wiring at App.tsx level means the children only need a single
  // callback per direction.
  const handleSelectCommit = useCallback((hash: string) => {
    setSelected(hash);
    setSelectedWorkTree(false);
    setSelectionNotice("");
  }, []);
  // File-at-revision viewer (whole file at the selected commit / its parent).
  const [fileViewerTarget, setFileViewerTarget] = useState<FileViewerTarget | null>(null);
  const handleViewFile = useCallback(
    (filePath: string, side: "after" | "before", beforePath?: string) => {
      if (!current) return;
      setFileViewerTarget({
        path: filePath,
        commit: current.hash,
        parent: (selectedDetail?.parents ?? current.parents ?? [])[0] ?? null,
        beforePath,
        side,
      });
    },
    [current, selectedDetail],
  );
  // Repository browser (tree + code search at a revision). A file opened
  // from it stacks the viewer on top as a nested dialog, so closing the
  // viewer returns to the same folder / search results.
  const [browserRevision, setBrowserRevision] = useState<BrowserRevision | null>(null);
  const [browserTabRequest, setBrowserTabRequest] = useState<{ tab: BrowserTab; nonce: number }>({
    tab: "files",
    nonce: 0,
  });
  const defaultBrowserRevision = useCallback((): BrowserRevision | null => {
    if (current) return { commit: current.hash, label: current.shortHash || current.hash.slice(0, 7) };
    const ref = refs.find((r) => r.name === selectedRef);
    if (ref && /^[0-9a-f]{40}$/i.test(ref.hash)) return { commit: ref.hash, label: ref.shortName };
    const tip = commits[0];
    return tip ? { commit: tip.hash, label: selectedRef || tip.hash.slice(0, 7) } : null;
  }, [current, refs, selectedRef, commits]);
  const openBrowser = useCallback(
    (tab: BrowserTab, revision?: BrowserRevision) => {
      const next = revision ?? defaultBrowserRevision();
      if (!next) return;
      setBrowserRevision(next);
      setBrowserTabRequest((prev) => ({ tab, nonce: prev.nonce + 1 }));
    },
    [defaultBrowserRevision],
  );
  const handleOpenFileFromBrowser = useCallback((filePath: string, commit: string, line?: number) => {
    setFileViewerTarget({ path: filePath, commit, parent: null, side: "after", line, origin: "browser" });
  }, []);
  useEffect(() => {
    setBrowserRevision(null);
    setReleasesOpen(false);
  }, [selectedRepo]);
  // Releases dialog (tags reachable from the timeline's ref). Reviewing a
  // release hands the pair to the compare review on the Live lens.
  const [releasesOpen, setReleasesOpen] = useState(false);
  const openReleaseReview = useCallback((base: string, target: string) => {
    setReleasesOpen(false);
    setCompareBase(base);
    setCompareTarget(target);
    setActiveLens("live");
  }, []);
  // Owners tab → timeline: one author's commits on one path.
  const showAuthorCommitsOnPath = useCallback((authorName: string, ownerPath: string) => {
    setBrowserRevision(null);
    setSearch("");
    setAuthor(authorName);
    setPath(ownerPath);
    setSelected("");
    setActiveLens("live");
  }, []);
  // Deep-link sync: mirror repo / ref / selected commit / path filter into
  // the URL (replaceState — no history entry per click), so a reload or a
  // copied link reopens the same view. Unrelated params (fleet, flight) stay.
  // The timeline filters ride along so the URL is a shareable view; in Redact
  // mode the author filter stays out of the address bar.
  useEffect(() => {
    if (typeof window === "undefined" || !selectedRepo) return;
    const search = buildFilterLinkSearch(
      buildCompareLinkSearch(
        buildDeepLinkSearch(window.location.search, {
          repo: selectedRepo,
          ref: selectedRef,
          commit: selectedWorkTree ? "" : selected,
          path: debouncedPath.trim(),
        }),
        { base: compareBase, target: compareTarget, mode: compareMode },
      ),
      {
        searchMode,
        search: debouncedSearch,
        searchPattern: debouncedSearchPattern,
        author: debouncedAuthor,
        since: sinceDate,
        until: untilDate,
        history: historyShape,
      },
      { includeAuthor: !redacted },
    );
    if (search === window.location.search) return;
    const url = `${window.location.pathname}${search}${window.location.hash}`;
    window.history.replaceState(window.history.state, "", url);
  }, [
    selectedRepo,
    selectedRef,
    selected,
    selectedWorkTree,
    debouncedPath,
    compareBase,
    compareTarget,
    compareMode,
    searchMode,
    debouncedSearch,
    debouncedSearchPattern,
    debouncedAuthor,
    sinceDate,
    untilDate,
    historyShape,
    redacted,
  ]);
  // The viewer reads from one repository; a repo switch closes it.
  useEffect(() => {
    setFileViewerTarget(null);
  }, [selectedRepo]);
  const handleSelectWorkTree = useCallback(() => {
    setSelectedWorkTree(true);
    setSelected("");
  }, []);
  const handleRefreshWorkTree = useCallback(() => {
    if (!selectedRepo) return;
    refreshWorkTree(selectedRepo);
  }, [selectedRepo, refreshWorkTree]);

  // File-history handlers. Two routes converge on the FileHistoryView overlay:
  // (1) the prompt, opened by command palette / top-bar / etc., and
  // (2) DetailPanel's per-file history button which already knows the path.
  // Both go through `submitFileHistoryPath` so recent-paths persistence and
  // overlay opening stay in one place.
  const submitFileHistoryPath = useCallback((rawPath: string) => {
    const result = validatePath(rawPath);
    if (!result.ok) {
      // The prompt validates locally before calling us, and DetailPanel only
      // forwards Git-confirmed paths from the changed-files list, so a
      // failure here means an upstream caller drifted from the contract.
      // Surface it through the existing error banner rather than silently
      // swallowing it.
      setError(result.error);
      return;
    }
    setFileHistoryPromptOpen(false);
    setFileHistoryPath(result.value);
    setRecentFileHistoryPaths((previous) => {
      const next = [
        result.value,
        ...previous.filter((entry) => entry !== result.value),
      ].slice(0, RECENT_FILE_HISTORY_PATHS_MAX);
      persistRecentFileHistoryPaths(next);
      return next;
    });
  }, []);
  const openFileHistoryPrompt = useCallback(() => {
    setFileHistoryPromptOpen(true);
  }, []);
  const closeFileHistoryPrompt = useCallback(() => {
    setFileHistoryPromptOpen(false);
  }, []);
  const closeFileHistory = useCallback(() => {
    setFileHistoryPath(null);
  }, []);
  // Whether the worktree pseudo-row should be visible at all. Derived from
  // the literal Git facts: if both summaries report zero file changes, there
  // is nothing to show.
  const workTreeHasChanges = Boolean(
    workTree &&
      (workTree.staged.summary.fileCount > 0 ||
        workTree.unstaged.summary.fileCount > 0 ||
        (workTree.untracked?.summary.fileCount ?? 0) > 0),
  );

  // Drilldown intentionally routes group keys back through the existing search /
  // path / author filters rather than tracking a separate hash highlight set.
  // Filters already shape the timeline state and survive realtime refreshes.
  const handleSummaryDrilldown = useCallback(
    (_commitHashes: string[], context: { kind: "prefix" | "path" | "author"; key: string }) => {
      if (context.kind === "prefix" && context.key !== "uncategorized") {
        // Drilldown always uses subject mode so the prefix colon-search maps cleanly.
        setSearchMode("subject");
        setSearchPattern("");
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

  // "Load older commits": fetch the page after the rows already loaded with
  // the same ref, filters and date window. The timeline generation guards
  // against a repo/ref/filter switch landing mid-request.
  const loadOlderInFlightRef = useRef(false);
  const loadOlderCommits = useCallback(async () => {
    if (loadOlderInFlightRef.current) return;
    const repoId = selectedRepoRef.current;
    if (!repoId) return;
    const generation = timelineGenerationRef.current;
    const skip = commitsRef.current.length;
    loadOlderInFlightRef.current = true;
    setLoadingOlderCommits(true);
    try {
      const page = await listCommits(
        repoId,
        selectedRefRef.current,
        searchRef.current,
        authorRef.current,
        pathRef.current,
        searchModeRef.current,
        searchPatternRef.current,
        COMMIT_PAGE_SIZE,
        { ...commitWindowRef.current, skip },
      );
      if (generation !== timelineGenerationRef.current) return;
      const next = appendOlderPage(commitsRef.current, page);
      commitsRef.current = next;
      setCommits(next);
      setHasMoreCommits(pageMayHaveMore(page.length, COMMIT_PAGE_SIZE));
      const added = next.length - skip;
      setLiveAnnouncement(
        added > 0
          ? `Loaded ${added} older commit${added === 1 ? "" : "s"}; ${next.length} shown.`
          : "No older commits.",
      );
    } catch (err) {
      if (generation === timelineGenerationRef.current) {
        reportBackgroundError("timeline", errorMessage(err));
      }
    } finally {
      loadOlderInFlightRef.current = false;
      setLoadingOlderCommits(false);
    }
    // Every input is read through refs; reportBackgroundError is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshTimeline(
    repoId: string,
    ref: string,
    searchTerm: string,
    authorTerm: string,
    pathTerm: string,
    mode: SearchMode,
    pattern: string,
  ) {
    // Capture the generation before awaiting; if the user switches repos
    // while the request is in flight, the generation moves on and the stale
    // result is discarded before any state write below. The ticket orders
    // this refresh against other loads/refreshes of the same view; a refresh
    // for a repo that is no longer open never takes one.
    if (repoId !== selectedRepoRef.current) return;
    const generation = timelineGenerationRef.current;
    const ticket = ++timelineTicketRef.current;
    let state: Awaited<ReturnType<typeof loadRepositoryState>>;
    try {
      state = await loadRepositoryState(
        repoId,
        ref,
        searchTerm,
        authorTerm,
        pathTerm,
        mode,
        pattern,
        commitWindowRef.current,
      );
    } catch (err) {
      // A stale request's failure must not surface over the current view.
      if (generation !== timelineGenerationRef.current) return;
      throw err;
    }
    if (generation !== timelineGenerationRef.current) return;
    if (ticket < appliedTimelineTicketRef.current) return;
    appliedTimelineTicketRef.current = ticket;
    // A server-side poll failure arrives as a stream `error` event with no
    // matching success event; a successful refs read stands in for one.
    clearBackgroundError("timeline", "stream");
    const { nextRefs, nextRef, nextCommits: firstPage } = state;
    setRefs(nextRefs);
    // A live refresh re-reads only the first page; keep older pages the user
    // loaded when the new first page still connects to them.
    const merged =
      nextRef === selectedRefRef.current
        ? mergeLiveFirstPage(firstPage, commitsRef.current, COMMIT_PAGE_SIZE)
        : { commits: firstPage, reset: true };
    if (merged.reset) setHasMoreCommits(pageMayHaveMore(firstPage.length, COMMIT_PAGE_SIZE));
    const nextCommits = merged.commits;
    setSelectedRef(nextRef);
    const markedCommits = markRealtimeNewCommits(nextCommits, realtimeNewCommitHashesRef.current);
    setCommits(markedCommits);
    // A live event must not move the user's selection: a commit picked in a
    // lens (another ref, older than the list, hidden by a filter) is shown
    // from its own detail, and the working tree has no row at all.
    setSelected((current) => {
      if (selectedWorkTreeRef.current) return current;
      if (!current) {
        setSelectionNotice("");
        return markedCommits[0]?.hash || "";
      }
      if (markedCommits.some((commit) => commit.hash === current)) {
        setSelectionNotice("");
        return current;
      }
      // A timeline row that left the list (force-push, filter) falls back
      // with a notice; a lens selection was never a row and stays.
      if (commitsRef.current.some((commit) => commit.hash === current)) {
        setSelectionNotice("Previous selection is not on this ref; selected the latest visible commit.");
        return markedCommits[0]?.hash || "";
      }
      return current;
    });
    // The compared refs may be the ones that just moved.
    setCompareRefreshKey((key) => key + 1);
  }

  // SSE バースト時に setLiveAnnouncement が秒間多数回呼ばれると SR が
  // 直前メッセージを上書き連発し、ユーザの読み上げ体験が壊れる。
  // 1.5s ウィンドウで coalesce し、ウィンドウ内に届いた最新メッセージのみを
  // SR に通知する。pause/resume 等のユーザ起動アクションは throttle せず
  // 直接 setLiveAnnouncement を呼ぶ。
  const announceThrottleRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    pending: string | null;
  }>({ timer: null, pending: null });

  const announceLiveThrottled = useCallback((message: string) => {
    if (announceThrottleRef.current.timer != null) {
      announceThrottleRef.current.pending = message;
      return;
    }
    setLiveAnnouncement(message);
    announceThrottleRef.current.timer = setTimeout(() => {
      announceThrottleRef.current.timer = null;
      if (announceThrottleRef.current.pending != null) {
        const next = announceThrottleRef.current.pending;
        announceThrottleRef.current.pending = null;
        announceLiveThrottled(next);
      }
    }, 1500);
  }, []);

  function handleRealtimeEvent(notice: string, applyEvent: () => void) {
    if (livePausedRef.current) {
      pendingRealtimeEventsRef.current.push(applyEvent);
      setPendingUpdates((count) => {
        const nextCount = count + 1;
        announceLiveThrottled(`Live updates paused. ${nextCount} updates pending.`);
        return nextCount;
      });
      return;
    }
    applyEvent();
    announceLiveThrottled(notice);
    scheduleTimelineRefresh();
  }

  // One push emits a `commit_added` per new commit (up to 50 per ref per
  // poll). Each would otherwise start its own refs + commits refetch; they
  // are coalesced into one, like `scheduleDriftRefresh`. The SSE effect
  // cancels a pending refresh when the repo changes.
  function scheduleTimelineRefresh() {
    if (timelineRefreshDebounceRef.current) {
      clearTimeout(timelineRefreshDebounceRef.current);
    }
    const repoId = selectedRepo;
    timelineRefreshDebounceRef.current = setTimeout(() => {
      timelineRefreshDebounceRef.current = null;
      void refreshTimeline(
        repoId,
        selectedRefRef.current,
        searchRef.current,
        authorRef.current,
        pathRef.current,
        searchModeRef.current,
        searchPatternRef.current,
      ).catch((err) => reportBackgroundError("timeline", errorMessage(err)));
    }, 150);
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
      searchModeRef.current,
      searchPatternRef.current,
    ).catch((err) => setError(errorMessage(err)));
    // refreshTimeline is stable through refs; selectedRepo is the only reactive input.
  }, [selectedRepo]);

  // useCallback (not a plain function) so the `shortcutBindings` memo below
  // can list it as a dependency — otherwise the Mod+. shortcut captures a
  // stale `livePaused` closure and can never resume after pausing.
  const toggleLiveUpdates = useCallback(() => {
    if (!livePaused) {
      // pause 時は button の aria-pressed + label 変化が SR に伝わるので無音 (Calm)。
      // Update the ref synchronously: the mirroring effect runs only after
      // the next commit, and an SSE event arriving in between would otherwise
      // be applied (on pause) or queued after the flush (on resume).
      livePausedRef.current = true;
      setLivePaused(true);
      return;
    }
    livePausedRef.current = false;
    setLivePaused(false);
    if (pendingUpdates > 0) {
      // resume + 適用件数を 1 件のメッセージとして polite に通知。
      setLiveAnnouncement(`Live updates resumed. ${pendingUpdates} pending updates applied.`);
      flushPendingRealtimeEvents();
    } else {
      setLiveAnnouncement("Live updates resumed.");
    }
  }, [livePaused, pendingUpdates, flushPendingRealtimeEvents]);

  // Diff fullscreen only makes sense when there's actually a diff rendered.
  // Mirrors the gating used in CommandPalette so the shortcut behaves identically
  // to the palette command and doesn't surprise users with a no-op.
  const diffFullscreenAvailable =
    Boolean(current) && (Boolean(selectedDiff.diff) || selectedDiff.truncated);

  const goToAdjacentCommit = useCallback(
    (direction: 1 | -1) => {
      // Navigate the same list the timeline renders (`filteredCommits`), not
      // the raw `commits` — otherwise an active commit-kind / date-range
      // filter makes j/k/arrows select commits that are hidden from view.
      if (!filteredCommits.length) return;
      const currentIndex = selected
        ? filteredCommits.findIndex((commit) => commit.hash === selected)
        : 0;
      // No selection yet (or the selection is filtered out): treat the next
      // press as "land on the first visible commit" rather than jumping
      // based on a -1 index.
      const nextIndex =
        currentIndex < 0
          ? 0
          : Math.min(filteredCommits.length - 1, Math.max(0, currentIndex + direction));
      if (nextIndex === currentIndex) return;
      handleSelectCommit(filteredCommits[nextIndex].hash);
    },
    [filteredCommits, selected, handleSelectCommit],
  );

  const shortcutBindings = useMemo<ShortcutBinding[]>(() => {
    const list: ShortcutBinding[] = [
      {
        combo: "Mod+K",
        description: "Toggle command palette",
        category: "General",
        // `global` so the same combo can dismiss the palette it just opened
        // (and also work when other modals are visible).
        global: true,
        run: () => setPaletteOpen((value) => !value),
      },
      {
        combo: "?",
        description: "Show keyboard shortcuts",
        category: "General",
        run: () => setHelpOpen(true),
      },
      {
        combo: "t",
        description: "Browse files / go to file at the selected commit",
        category: "Navigation",
        run: () => {
          if (mode === "detail") openBrowser("files");
        },
      },
      {
        combo: "Mod+Shift+F",
        description: "Search code at the selected commit",
        category: "Navigation",
        run: () => {
          if (mode === "detail") openBrowser("search");
        },
      },
      {
        combo: "o",
        description: "Who changed this folder (owners) at the selected commit",
        category: "Navigation",
        run: () => {
          if (mode === "detail") openBrowser("owners");
        },
      },
      {
        combo: "Shift+L",
        description: "Releases: tags, unreleased changes, release notes",
        category: "Navigation",
        run: () => {
          if (mode === "detail") setReleasesOpen(true);
        },
      },
      {
        combo: "Mod+B",
        description: "Toggle branch sidebar",
        category: "View",
        run: toggleSidebar,
      },
      {
        combo: "Mod+/",
        description: "Toggle period summary",
        category: "View",
        run: toggleSummaryView,
      },
      {
        combo: "Mod+.",
        description: "Pause / resume live updates",
        category: "View",
        run: toggleLiveUpdates,
      },
      {
        combo: "Shift+R",
        description: "Toggle redact mode (mask names & e-mails)",
        category: "View",
        run: toggleRedact,
      },
    ];
    // Commit navigation is suppressed while the diff overlay owns the keyboard;
    // otherwise the same ArrowUp/Down used to move between files would also
    // shift the selected commit, which closes fullscreen on commit change.
    if (!diffFullscreen) {
      list.push(
        {
          combo: "ArrowDown",
          description: "Next commit",
          category: "Navigation",
          run: () => goToAdjacentCommit(1),
        },
        {
          combo: "ArrowUp",
          description: "Previous commit",
          category: "Navigation",
          run: () => goToAdjacentCommit(-1),
        },
        {
          combo: "j",
          description: "Next commit",
          category: "Navigation",
          run: () => goToAdjacentCommit(1),
        },
        {
          combo: "k",
          description: "Previous commit",
          category: "Navigation",
          run: () => goToAdjacentCommit(-1),
        },
      );
    }
    if (diffFullscreenAvailable) {
      // Only register when a diff is actually visible — keeps the help dialog
      // honest about what's available right now.
      list.push({
        combo: "Mod+Enter",
        description: "Toggle diff fullscreen",
        category: "Diff",
        run: () => setDiffFullscreen((value) => !value),
      });
      list.push({
        combo: "v",
        description: "Toggle diff view (all / single file)",
        category: "Diff",
        run: () =>
          setDiffViewMode((mode) => (mode === "all" ? "single" : "all")),
      });
    }
    return list;
  }, [
    toggleSidebar,
    toggleSummaryView,
    toggleLiveUpdates,
    toggleRedact,
    goToAdjacentCommit,
    diffFullscreenAvailable,
    diffFullscreen,
    openBrowser,
    mode,
  ]);

  // Suppress non-global shortcuts whenever a modal-like surface owns the
  // keyboard. Each surface manages its own Esc handler; we just need to keep
  // the global bindings out of the way.
  const shortcutsSuppressed =
    paletteOpen ||
    helpOpen ||
    fileHistoryPromptOpen ||
    Boolean(fileHistoryPath) ||
    browserRevision !== null ||
    releasesOpen ||
    fileViewerTarget !== null;

  useKeyboardShortcuts(shortcutBindings, shortcutsSuppressed);

  const releasesDialogOpen = releasesOpen && Boolean(selectedRepo);
  const repoBrowserMounted = useLatch(browserRevision !== null);
  const releasesDialogMounted = useLatch(releasesDialogOpen);
  const fileViewerMounted = useLatch(fileViewerTarget !== null);

  return (
    <div
      className="size-full flex flex-col"
      data-quiet={isQuiet ? "true" : undefined}
      data-redacted={redacted ? "true" : undefined}
      data-color-vision={colorVisionTheme}
      style={{
        background: "var(--rs-bg-canvas)",
        color: "var(--rs-text-primary)",
        fontFamily: "var(--rs-sans)",
      }}
    >
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:px-3 focus:py-2 focus:rounded"
        style={{
          background: "var(--rs-bg-elevated)",
          color: "var(--rs-text-primary)",
          border: "1px solid var(--rs-border)",
          zIndex: "var(--rs-z-modal)",
        }}
      >
        Skip to commit list
      </a>
      <TopBar
        repositories={repositories}
        selectedRepo={selectedRepo}
        onSelectRepo={switchRepo}
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
        redacted={redacted}
        onToggleRedact={toggleRedact}
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
        since={sinceDate}
        until={untilDate}
        onSinceChange={(value) => {
          setSinceDate(value);
          setSelected("");
        }}
        onUntilChange={(value) => {
          setUntilDate(value);
          setSelected("");
        }}
        historyShape={historyShape}
        onHistoryShapeChange={(shape) => {
          setHistoryShape(shape);
          setSelected("");
        }}
        viewsMenu={
          mode === "detail" && selectedRepo ? (
            <SavedViewsMenu
              views={savedViews}
              activeViewId={activeSavedView?.id ?? null}
              onApply={applySavedView}
              onSave={saveCurrentView}
              onDelete={(view) => deleteView(view.id)}
              onCopyLink={copyViewLink}
              onCopyMarkdown={copyTimelineMarkdown}
              onDownload={downloadTimeline}
              commitCount={filteredCommits.length}
              hasMore={hasMoreCommits}
            />
          ) : null
        }
        searchMode={searchMode}
        onSearchModeChange={(mode) => {
          setSearchMode(mode);
          setSelected("");
        }}
        searchPattern={searchPattern}
        onSearchPatternChange={(value) => {
          setSearchPattern(value);
          setSelected("");
        }}
        summaryViewOpen={summaryViewOpen}
        onToggleSummaryView={toggleSummaryView}
        sidebarCollapsed={sidebarCollapsed}
        onToggleSidebar={toggleSidebar}
        onRefreshWorkTree={handleRefreshWorkTree}
        workTreeAvailable={Boolean(selectedRepo)}
        onOpenFileHistory={openFileHistoryPrompt}
        mode={mode}
        onSetMode={setMode}
        onAddRepo={() => setAddRepoDialogOpen(true)}
      />
      <LensSwitcher
        activeLens={activeLens}
        onLensChange={setActiveLens}
        hidden={mode === "fleet"}
        availableLenses={availableLenses}
      />
      {refBriefing && mode === "detail" && (
        <SinceLastVisitBanner
          briefing={refBriefing}
          onDismiss={dismissRefBriefing}
          onReview={(base, target) => {
            setCompareBase(base);
            setCompareTarget(target);
            setActiveLens('live');
          }}
          onShowRef={(refName) => {
            setSelectedRef(refName);
            setActiveLens('live');
          }}
          watchNotifications={{
            enabled: watchNotifications.enabled,
            permission: watchNotifications.permission,
            onToggle: () => {
              void watchNotifications.toggle();
            },
          }}
        />
      )}
      {dateRangeFilter && mode !== "fleet" && (
        <DateRangeFilterBanner
          from={dateRangeFilter.from}
          to={dateRangeFilter.to}
          matched={filteredCommits.length}
          onClear={() => setDateRangeFilter(null)}
        />
      )}
      {/* Fleet mode: FleetSurface + onboarding overlay */}
      {mode === "fleet" && (
        <div style={{ position: "relative", flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          <FleetOnboardingOverlay isQuiet={isQuiet} />
          <FleetSurface
            snapshot={fleetSnapshot}
            error={fleetError}
            isCvdSafe={isCvdSafe}
            isQuiet={isQuiet}
            onSelectRepo={handleFleetSelectRepo}
            lastOpenedRepos={lastOpenedRepos}
            repoOrigins={Object.fromEntries(
              repositories
                .filter((r) => r.origin !== undefined)
                .map((r) => [r.id, r.origin as "env" | "ui"]),
            )}
            onRemoveRepo={handleRemoveRepo}
            fleetWindow={fleetWindow}
            onWindowChange={setFleetWindow}
          />
        </div>
      )}

      <AddRepoDialog
        open={addRepoDialogOpen}
        onOpenChange={setAddRepoDialogOpen}
        onSubmit={handleAddRepo}
      />

      {/* Detail mode: existing lens layout. Hidden (display:none) in Fleet mode so
          SSE subscriptions, hooks, and resizable-panel refs stay alive. */}
      {activeLens === 'pulse' && mode === "detail" && (
        <div className="flex-1 overflow-hidden" id="lens-panel-pulse" role="tabpanel" aria-labelledby="lens-tab-pulse">
          <Suspense fallback={<LensLoading />}>
            <PulseLens
              repoId={selectedRepo || null}
              commits={commits}
              selectedCommitHash={selected || null}
              onSelectCommit={handleSelectCommit}
              onOpenFileHistory={submitFileHistoryPath}
              workTree={workTreeHasChanges ? workTree : null}
              eventStatus={eventStatus}
              onChangeLens={setActiveLens}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'stream' && mode === "detail" && (
        <div className="flex-1 overflow-hidden" id="lens-panel-stream" role="tabpanel" aria-labelledby="lens-tab-stream">
          <Suspense fallback={<LensLoading />}>
            <FileStreamLens
              // Remount per repo: its commit-detail cache is keyed by hash
              // only, and forks share hashes across repositories.
              key={selectedRepo}
              repoId={selectedRepo || null}
              commits={commits}
              selectedCommitHash={selected || null}
              onSelectCommit={handleSelectCommit}
              onOpenFileHistory={submitFileHistoryPath}
              workTree={workTreeHasChanges ? workTree : null}
              onChangeLens={setActiveLens}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'hotspot' && mode === "detail" && selectedRepo && (
        <div className="flex-1 overflow-hidden" id="lens-panel-hotspot" role="tabpanel" aria-labelledby="lens-tab-hotspot">
          <Suspense fallback={<LensLoading />}>
            <HotspotLens
              repoId={selectedRepo}
              selectedRef={selectedRef}
              onOpenFileHistory={submitFileHistoryPath}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'risk-trend' && mode === "detail" && (
        <div className="flex-1 overflow-hidden" id="lens-panel-risk-trend" role="tabpanel" aria-labelledby="lens-tab-risk-trend">
          <Suspense fallback={<LensLoading />}>
            <RiskTrendLens
              commits={commits}
              onSelectCommit={handleSelectCommit}
              onChangeLens={setActiveLens}
              onSelectRange={(from, to) => setDateRangeFilter({ from, to })}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'risk-heatmap' && mode === "detail" && (
        <div className="flex-1 overflow-hidden" id="lens-panel-risk-heatmap" role="tabpanel" aria-labelledby="lens-tab-risk-heatmap">
          <Suspense fallback={<LensLoading />}>
            <RiskHeatmapLens
              commits={commits}
              onSelectCommit={handleSelectCommit}
              onChangeLens={setActiveLens}
              onSelectRange={(from, to) => setDateRangeFilter({ from, to })}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'co-change' && mode === "detail" && selectedRepo && (
        <div className="flex-1 overflow-hidden" id="lens-panel-co-change" role="tabpanel" aria-labelledby="lens-tab-co-change">
          <Suspense fallback={<LensLoading />}>
            <CoChangeLens
              repoId={selectedRepo}
              selectedRef={selectedRef}
              selectedFilePath={fileHistoryPath}
              onOpenFileHistory={submitFileHistoryPath}
              onChangeLens={setActiveLens}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'drift' && mode === "detail" && selectedRepo && (
        <div className="flex-1 overflow-hidden" id="lens-panel-drift" role="tabpanel" aria-labelledby="lens-tab-drift">
          <Suspense fallback={<LensLoading />}>
            <DriftLens
              repoId={selectedRepo}
              refs={refs}
              selectedRef={selectedRef}
              onSelectRef={(ref) => { setSelectedRef(ref); }}
              onChangeLens={setActiveLens}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'outbox' && mode === "detail" && selectedRepo && (
        <div className="flex-1 overflow-hidden" id="lens-panel-outbox" role="tabpanel" aria-labelledby="lens-tab-outbox">
          <Suspense fallback={<LensLoading />}>
            <OutboxLens
              repoId={selectedRepo}
              refs={refs}
              onSelectCommit={(hash) => {
                handleSelectCommit(hash);
                setActiveLens('live');
              }}
              onOpenWorktree={() => {
                handleSelectWorkTree();
                setActiveLens('live');
              }}
              onChangeLens={setActiveLens}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'digest' && mode === "detail" && selectedRepo && (
        <div className="flex-1 overflow-hidden" id="lens-panel-digest" role="tabpanel" aria-labelledby="lens-tab-digest">
          <Suspense fallback={<LensLoading />}>
            <DigestLens
              repoId={selectedRepo}
              onSelectCommit={(hash) => {
                handleSelectCommit(hash);
                setActiveLens('live');
              }}
              onOpenFileHistory={submitFileHistoryPath}
              onChangeLens={setActiveLens}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'rescue' && mode === "detail" && (
        <div className="flex-1 overflow-hidden" id="lens-panel-rescue" role="tabpanel" aria-labelledby="lens-tab-rescue">
          <Suspense fallback={<LensLoading />}>
            <RewriteRescuePanel
              repoId={selectedRepo}
              entries={rewriteRescueEntries}
              eventStatus={eventStatus}
              onChangeLens={setActiveLens}
              refs={refs}
              onInspectCommit={(hash) => {
                handleSelectCommit(hash);
                setActiveLens('live');
              }}
              onBrowseAt={(hash, label) => openBrowser("files", { commit: hash, label })}
              onCompareWithHead={(hash) => {
                setCompareBase("HEAD");
                setCompareTarget(hash);
                setActiveLens('live');
              }}
              onClear={(repoId) => {
                if (repoId === selectedRepo) {
                  setRewriteRescueEntries([]);
                }
              }}
              onDelete={(repoId, previousHash, observedAt) => {
                if (repoId === selectedRepo) {
                  setRewriteRescueEntries((prev) =>
                    prev.filter(
                      (e) =>
                        !(
                          e.previousHash === previousHash &&
                          e.observedAt === observedAt
                        ),
                    ),
                  );
                }
              }}
            />
          </Suspense>
        </div>
      )}
      {activeLens === 'symbol' && mode === "detail" && selectedRepo && (
        <div className="flex-1 overflow-hidden" id="lens-panel-symbol" role="tabpanel" aria-labelledby="lens-tab-symbol">
          <SymbolHistoryView
            repoId={selectedRepo}
            query={symbolHistoryQuery}
            onQueryChange={setSymbolHistoryQuery}
            onChangeLens={setActiveLens}
          />
        </div>
      )}
      {flightRecorderEnabled && activeLens === 'flight' && mode === "detail" && selectedRepo && (
        <div className="flex-1 overflow-hidden" id="lens-panel-flight" role="tabpanel" aria-labelledby="lens-tab-flight">
          <Suspense fallback={<LensLoading />}>
            <RefFlightRecorderLens
              repoId={selectedRepo}
              refreshKey={flightRefreshKey}
              onChangeLens={setActiveLens}
            />
          </Suspense>
        </div>
      )}
      {/* Live lens: render the full existing layout. Hidden (not unmounted) when inactive
          so that SSE subscriptions, hooks, and resizable-panel refs stay alive.
          tabpanel wrapper を持たない唯一の Lens だったが、他 11 Lens と整合するため
          `role="tabpanel"` で wrap し、Live 固有の context strip と SSE 切断 banner を内包させる。 */}
      <div
        id="lens-panel-live"
        role="tabpanel"
        aria-labelledby="lens-tab-live"
        style={{
          display: (activeLens === 'live' && mode === "detail") ? 'flex' : 'none',
          flexDirection: 'column',
          flex: 1,
          overflow: 'hidden',
        }}
      >
        {/* Live context strip — TopBar はグローバル文脈、本 strip は Lens 文脈
            (現在観測中の repo/ref と filtered/total commits) を表す。
            LensHeader component は採用せず軽量な 1 行に留め、Status / Pause は TopBar に残置。 */}
        <div
          role="status"
          aria-label={
            selectedRepo
              ? `Live observing ${selectedRepo}${selectedRef ? ` / ${selectedRef}` : ''}, ${filteredCommits.length} of ${commits.length} commits`
              : 'Live — no repository selected'
          }
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '4px 12px',
            borderBottom: '1px solid var(--rs-border)',
            background: 'var(--rs-bg-panel)',
            fontFamily: 'var(--rs-sans)',
            fontSize: 11,
            color: 'var(--rs-text-secondary)',
            flexShrink: 0,
          }}
        >
          <span style={{ fontWeight: 600, color: 'var(--rs-text-primary)' }} aria-hidden="true">
            Live
          </span>
          <span aria-hidden="true" style={{ opacity: 0.5 }}>·</span>
          <span aria-hidden="true">
            {selectedRepo ? (
              <>
                <span style={{ fontFamily: 'var(--rs-mono)' }}>{selectedRepo}</span>
                {selectedRef && (
                  <>
                    <span style={{ opacity: 0.5, margin: '0 4px' }}>/</span>
                    <span style={{ fontFamily: 'var(--rs-mono)' }}>{selectedRef}</span>
                  </>
                )}
              </>
            ) : (
              <span style={{ fontStyle: 'italic' }}>no repository selected</span>
            )}
          </span>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--rs-mono)' }} aria-hidden="true">
            {filteredCommits.length === commits.length
              ? `${commits.length.toLocaleString()} commits`
              : `${filteredCommits.length.toLocaleString()} / ${commits.length.toLocaleString()} commits`}
          </span>
        </div>

        {/* SSE 切断 banner — eventStatus === 'error' のときだけ表示。
            CommitTimeline 本体に触れず、tabpanel 直下に追加する形で実装。 */}
        {eventStatus === 'error' && (
          <div
            role="status"
            aria-live="polite"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderBottom: '1px solid color-mix(in oklab, var(--rs-border), var(--rs-warning) 50%)',
              background: 'color-mix(in oklab, var(--rs-bg-panel), var(--rs-warning) 12%)',
              fontFamily: 'var(--rs-sans)',
              fontSize: 11,
              color: 'var(--rs-text-primary)',
              flexShrink: 0,
            }}
          >
            <span aria-hidden="true">⚠</span>
            <span>
              Live feed disconnected. Reconnecting automatically…
            </span>
          </div>
        )}

      <ResizablePanelGroup
        key={isNarrow ? "stacked" : "side-by-side"}
        direction={isNarrow ? "vertical" : "horizontal"}
        className="flex flex-1 overflow-hidden"
        onLayout={(layout) => {
          // Stacked (narrow) heights must not overwrite the desktop width ratios.
          if (isNarrow) return;
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
          defaultSize={initialPanelSizes.sidebar}
          minSize={12}
          maxSize={30}
          onCollapse={() => setSidebarCollapsed(true)}
          onExpand={() => setSidebarCollapsed(false)}
        >
          <aside aria-label="Refs panel: branches, stashes, worktrees, submodules" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
          <BranchSidebar
            repoId={selectedRepo}
            refs={refs}
            selectedRef={selectedRef}
            onSelectRef={(ref) => {
              setSelectedRef(ref);
            }}
            headHash={commits[0]?.shortHash ?? commits[0]?.hash.slice(0, 7)}
            alerts={realtimeAlerts}
            driftMap={driftMap}
            driftBaseShortName={driftBaseShortName}
            onSetRefAsCompareBase={setCompareBase}
            onSetRefAsCompareTarget={setCompareTarget}
            onOpenReleases={selectedRepo ? () => setReleasesOpen(true) : undefined}
            stashes={stashes}
            worktrees={worktrees}
            submodules={submodules}
            repoState={repoState}
            branchGroupPrefix={branchGroupPrefix}
            onSetBranchGroupPrefix={handleSetBranchGroupPrefix}
          />
          </aside>
        </ResizablePanel>
        <ResizableHandle withHandle aria-label={`Resize Refs panel (drag to adjust ${isNarrow ? "height" : "width"})`} />
        <ResizablePanel
          id="rs-center"
          order={2}
          defaultSize={initialPanelSizes.center}
          minSize={25}
        >
          <div id="main-content" tabIndex={-1} aria-label="Commit timeline" className="flex flex-col overflow-hidden h-full">
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
              commits={filteredCommits}
              selected={selected}
              onSelect={handleSelectCommit}
              // Only blank the timeline when there is nothing to show yet
              // (first load / repo switch). Filter-driven refetches keep the
              // current list visible instead of flashing "Loading commits".
              loading={loading && commits.length === 0}
              error={error}
              eventNotice={eventNotice}
              eventStatus={eventStatus}
              livePaused={livePaused}
              pendingUpdates={pendingUpdates}
              liveAnnouncement={liveAnnouncement}
              activeFilters={activeFilters(search, author, path, searchMode, searchPattern, sinceDate, untilDate, historyShape)}
              hasMoreCommits={hasMoreCommits}
              loadingOlderCommits={loadingOlderCommits}
              onLoadOlderCommits={loadOlderCommits}
              refs={refs}
              repoId={selectedRepo}
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
              compareMode={compareMode}
              onCompareModeChange={setCompareMode}
              onOpenCompareFileHistory={submitFileHistoryPath}
              compareBarCollapsed={compareBarCollapsed}
              activityGraphCollapsed={activityGraphCollapsed}
              onToggleCompareBar={toggleCompareBar}
              onToggleActivityGraph={toggleActivityGraph}
              summaryViewOpen={summaryViewOpen}
              workTree={workTreeHasChanges ? workTree : null}
              isWorkTreeSelected={selectedWorkTree}
              onSelectWorkTree={handleSelectWorkTree}
              onRefreshWorkTree={handleRefreshWorkTree}
              onSetCommitAsCompareBase={setCompareBase}
              onSetCommitAsCompareTarget={setCompareTarget}
              onFilterByAuthor={(value) => {
                setAuthor(value);
                setSelected("");
              }}
              commitKindFilter={commitKindFilter}
              onCommitKindFilterChange={(value) => {
                setCommitKindFilter(value);
                setSelected("");
              }}
            />
          </div>
        </ResizablePanel>
        <ResizableHandle withHandle aria-label={`Resize Commit details panel (drag to adjust ${isNarrow ? "height" : "width"})`} />
        <ResizablePanel
          id="rs-detail"
          order={3}
          defaultSize={initialPanelSizes.detail}
          minSize={25}
          maxSize={70}
        >
          <section aria-label="Commit details" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <DetailPanel
              commit={current}
              detail={selectedDetail}
              diff={selectedDiff}
              loading={detailLoading}
              error={error}
              diffFullscreen={diffFullscreen}
              onDiffFullscreenChange={setDiffFullscreen}
              diffViewMode={diffViewMode}
              onDiffViewModeChange={setDiffViewMode}
              repoId={selectedRepo}
              workTreeSelected={selectedWorkTree}
              workTree={workTree}
              containingRefs={selectedDetail ? containingRefs : null}
              onOpenFileHistory={submitFileHistoryPath}
              onFilterByPath={(value) => {
                setPath(value);
                setSelected("");
              }}
              whyPanelQuery={whyPanelQuery}
              onWhyPanelQueryChange={setWhyPanelQuery}
              onViewFile={handleViewFile}
              onBrowseFiles={(hash) =>
                openBrowser("files", { commit: hash, label: current?.hash === hash ? current.shortHash || hash.slice(0, 7) : hash.slice(0, 7) })
              }
            />
          </section>
        </ResizablePanel>
      </ResizablePanelGroup>
      </div>
      {repoBrowserMounted && (
        <Suspense fallback={null}>
          <RepoBrowserDialog
            repoId={selectedRepo}
            open={browserRevision !== null}
            revision={browserRevision}
            requestedTab={browserTabRequest}
            refs={refs}
            onRevisionChange={setBrowserRevision}
            onClose={() => setBrowserRevision(null)}
            onOpenFile={handleOpenFileFromBrowser}
            onOpenHistory={(filePath) => {
              setBrowserRevision(null);
              submitFileHistoryPath(filePath);
            }}
            onShowAuthorCommits={showAuthorCommitsOnPath}
          />
        </Suspense>
      )}
      {releasesDialogMounted && (
        <Suspense fallback={null}>
          <ReleasesDialog
            repoId={selectedRepo}
            open={releasesDialogOpen}
            refs={refs}
            initialRef={selectedRef && !selectedRef.startsWith("refs/tags/") ? selectedRef : "HEAD"}
            onClose={() => setReleasesOpen(false)}
            onReview={openReleaseReview}
            onBrowse={(commitHash, label) => {
              setReleasesOpen(false);
              openBrowser("files", { commit: commitHash, label });
            }}
            onShowRef={(refName) => {
              setReleasesOpen(false);
              setSelectedRef(refName);
              setSelected("");
              setActiveLens("live");
            }}
          />
        </Suspense>
      )}
      {fileViewerMounted && (
        <Suspense fallback={null}>
          <FileViewerDialog
            repoId={selectedRepo}
            target={fileViewerTarget}
            onClose={() => setFileViewerTarget(null)}
            onOpenHistory={submitFileHistoryPath}
            onSelectCommit={handleSelectCommit}
          />
        </Suspense>
      )}
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
        searchMode={searchMode}
        searchPattern={searchPattern}
        livePaused={livePaused}
        quietMode={quietMode}
        isQuiet={isQuiet}
        isCvdSafe={isCvdSafe}
        onToggleColorVision={toggleColorVisionTheme}
        summaryViewOpen={summaryViewOpen}
        onToggleSummaryView={toggleSummaryView}
        onToggleQuietMode={toggleQuietMode}
        redacted={redacted}
        onToggleRedact={toggleRedact}
        watchNotifyEnabled={watchNotifications.enabled}
        onToggleWatchNotify={() => {
          void watchNotifications.toggle();
        }}
        onToggleLiveUpdates={toggleLiveUpdates}
        diffAvailable={diffFullscreenAvailable}
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
        onSearchPatternChange={(value) => {
          setSearchPattern(value);
          setSelected("");
        }}
        onSetSearchMode={(nextMode) => {
          setSearchMode(nextMode);
          setSelected("");
        }}
        workTreeAvailable={workTreeHasChanges}
        onShowWorkTree={handleSelectWorkTree}
        onRefreshWorkTree={handleRefreshWorkTree}
        onOpenFileHistory={openFileHistoryPrompt}
        onBrowseFiles={mode === "detail" && selectedRepo ? () => openBrowser("files") : undefined}
        onSearchCode={mode === "detail" && selectedRepo ? () => openBrowser("search") : undefined}
        onShowOwners={mode === "detail" && selectedRepo ? () => openBrowser("owners") : undefined}
        onOpenReleases={mode === "detail" && selectedRepo ? () => setReleasesOpen(true) : undefined}
        onShowShortcuts={() => setHelpOpen(true)}
        mode={mode}
        onSetMode={setMode}
        repos={repositories.map((r) => r.id)}
        onSetSelectedRepo={(id) => {
          recordLastOpened(id);
          switchRepo(id);
        }}
        timelineViewCommands={timelineViewCommands}
        lastOpenedRepos={lastOpenedRepos}
      />
      <FileHistoryPrompt
        open={fileHistoryPromptOpen}
        onSubmit={submitFileHistoryPath}
        onClose={closeFileHistoryPrompt}
        suggestions={fileHistorySuggestions}
      />
      {fileHistoryPath ? (
        <FileHistoryView
          repoId={selectedRepo}
          filePath={fileHistoryPath}
          refName={selectedRef}
          onClose={closeFileHistory}
          onSwitchFile={submitFileHistoryPath}
        />
      ) : null}
      <ShortcutHelp
        open={helpOpen}
        onClose={() => setHelpOpen(false)}
        bindings={shortcutBindings}
      />
    </div>
  );
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unexpected error";
}

/**
 * Compare two worktree responses for content equivalence (ignores `snapshotAt`).
 * Used to suppress redundant `setWorkTree` calls during the 2.5s polling loop:
 * without this, every tick produces a new object reference even when nothing
 * changed, which re-parses the diff inside `DiffViewer` and resets transient
 * state (collapse, search query, fullscreen).
 */
function isWorkTreeContentEqual(
  prev: WorkTreeResponse,
  next: WorkTreeResponse,
): boolean {
  if (prev.staged.diff !== next.staged.diff) return false;
  if (prev.unstaged.diff !== next.unstaged.diff) return false;
  if (prev.notes.untrackedExcluded !== next.notes.untrackedExcluded) return false;
  const prevUntracked = prev.untracked?.files ?? [];
  const nextUntracked = next.untracked?.files ?? [];
  if (prevUntracked.length !== nextUntracked.length) return false;
  for (let i = 0; i < prevUntracked.length; i += 1) {
    if (prevUntracked[i].path !== nextUntracked[i].path) return false;
    if (prevUntracked[i].added !== nextUntracked[i].added) return false;
  }
  return true;
}

function DateRangeFilterBanner({
  from,
  to,
  matched,
  onClear,
}: {
  from: number;
  to: number;
  matched: number;
  onClear: () => void;
}) {
  const fmt = (ts: number): string => {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return "?";
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const mi = String(d.getMinutes()).padStart(2, "0");
    return `${yyyy}/${mm}/${dd} ${hh}:${mi}`;
  };
  return (
    <div
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 16px",
        background: "color-mix(in oklab, var(--rs-bg-panel), var(--rs-accent) 12%)",
        borderBottom: "1px solid var(--rs-border)",
        fontFamily: "var(--rs-sans)",
        fontSize: 11,
        color: "var(--rs-text-secondary)",
        flexShrink: 0,
      }}
    >
      <span style={{ color: "var(--rs-accent)", fontWeight: 600 }}>
        Range filter
      </span>
      <span style={{ fontFamily: "var(--rs-mono)", color: "var(--rs-text-primary)" }}>
        {fmt(from)} – {fmt(to)}
      </span>
      <span style={{ color: "var(--rs-text-muted)" }}>
        {matched.toLocaleString()} {matched === 1 ? "commit" : "commits"} matched
      </span>
      <button
        type="button"
        onClick={onClear}
        style={{
          marginLeft: "auto",
          height: 22,
          padding: "0 10px",
          fontSize: 11,
          fontFamily: "var(--rs-sans)",
          border: "1px solid var(--rs-border)",
          borderRadius: "var(--rs-radius-sm)",
          background: "var(--rs-bg-elevated)",
          color: "var(--rs-text-primary)",
          cursor: "pointer",
        }}
      >
        Clear filter
      </button>
    </div>
  );
}

function activeFilters(
  search: string,
  author: string,
  path: string,
  searchMode: SearchMode,
  searchPattern: string,
  sinceDate = "",
  untilDate = "",
  historyShape: HistoryShape = "all",
) {
  const modeLabels: Record<SearchMode, string> = {
    subject: "Subject",
    pickaxe: "Pickaxe -S",
    regex: "Regex -G",
    message: "Message --grep",
  };
  const searchFilter =
    searchMode === "subject"
      ? search.trim() ? `${modeLabels.subject}: "${search.trim()}"` : ""
      : searchPattern.trim() ? `${modeLabels[searchMode]}: "${searchPattern.trim()}"` : "";
  return [
    searchFilter,
    author.trim() ? `author "${author.trim()}"` : "",
    path.trim() ? `path "${path.trim()}"` : "",
    sinceDate || untilDate
      ? `date ${sinceDate || "…"} → ${untilDate || "…"}`
      : "",
    HISTORY_SHAPE_INFO[historyShape].chip,
  ].filter(Boolean);
}

async function loadRepositoryState(
  repoId: string,
  requestedRef: string,
  searchTerm: string,
  authorTerm: string,
  pathTerm: string,
  searchMode: SearchMode = "subject",
  searchPattern = "",
  window: CommitListWindow = {},
) {
  const nextRefs = await listRefs(repoId);
  const nextRef = resolveSelectableRef(requestedRef, nextRefs);
  const nextCommits = await listCommits(
    repoId,
    nextRef,
    searchTerm,
    authorTerm,
    pathTerm,
    searchMode,
    searchPattern,
    COMMIT_PAGE_SIZE,
    window,
  );
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
  return redactPayload(JSON.parse((event as MessageEvent<string>).data) as ViewerEvent);
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

function buildDriftMap(entries: RefDriftEntry[]) {
  // Keyed by full ref name so BranchSidebar can do `driftMap.get(ref.name)`
  // without ambiguity (`shortName` collides between branches and same-named
  // tags). The payload's `name` is already the full ref name from
  // `for-each-ref %(refname)`.
  const next = new Map<string, RefDriftSummary>();
  for (const entry of entries) {
    next.set(entry.name, {
      ahead: entry.ahead,
      behind: entry.behind,
      mergeBase: entry.mergeBase,
    });
  }
  return next;
}

function shortenBaseLabel(input: string) {
  // Display label for the halo's aria-text. We strip the well-known prefixes
  // for readability ("of main" beats "of refs/heads/main") but otherwise
  // surface the input verbatim — never inferring a friendly name.
  if (input === "HEAD") return "HEAD";
  return input
    .replace(/^refs\/heads\//, "")
    .replace(/^refs\/tags\//, "")
    .replace(/^refs\/remotes\//, "");
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

