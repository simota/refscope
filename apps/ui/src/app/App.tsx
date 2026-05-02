import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ImperativePanelHandle } from "react-resizable-panels";
import { TopBar } from "./components/refscope/TopBar";
import { BranchSidebar } from "./components/refscope/BranchSidebar";
import { CommitTimeline } from "./components/refscope/CommitTimeline";
import { DetailPanel } from "./components/refscope/DetailPanel";
import { CommandPalette } from "./components/refscope/CommandPalette";
import { FileHistoryView } from "./components/refscope/FileHistoryView";
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
import { useLayoutPrefs } from "./hooks/useLayoutPrefs";
import { useTimelinePrefs } from "./hooks/useTimelinePrefs";
import { useColorVisionTheme } from "./hooks/useColorVisionTheme";
import {
  useKeyboardShortcuts,
  type ShortcutBinding,
} from "./hooks/useKeyboardShortcuts";
import { ShortcutHelp } from "./components/refscope/ShortcutHelp";
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
  fetchRefDrift,
  fetchWorkTree,
  getCommit,
  getDiff,
  getRepoState,
  listCommits,
  listRefs,
  listRepositories,
  listStashes,
  listSubmodules,
  listWorktrees,
  type DiffPayload,
  type RefDriftEntry,
  type RepoStateResponse,
  type SearchMode,
  type StashEntry,
  type SubmoduleEntry,
  type ViewerEvent,
  type WorkTreeResponse,
  type WorktreeEntry,
} from "./api";
import type { RefDriftSummary } from "./components/refscope/BranchSidebar";

const EMPTY_DIFF: DiffPayload = { diff: "", truncated: false, maxBytes: 0 };

const RECENT_FILE_HISTORY_PATHS_STORAGE_KEY = "refscope.fileHistory.recentPaths.v1";
const RECENT_FILE_HISTORY_PATHS_MAX = 10;
const RECENT_FILE_HISTORY_PATHS_SCHEMA_VERSION = 1;

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
  const [helpOpen, setHelpOpen] = useState(false);
  const [summaryViewOpen, setSummaryViewOpen] = useState(false);
  const [diffFullscreen, setDiffFullscreen] = useState(false);
  const [diffViewMode, setDiffViewMode] = useState<"all" | "single">("all");
  const [search, setSearch] = useState("");
  const [author, setAuthor] = useState("");
  const [path, setPath] = useState("");
  // State A: subject-mode value lives in `search`; pickaxe/regex/message values live in `searchPattern`.
  // Keeping them separate prevents mode-switch cross-contamination and maps 1-to-1 onto the API contract
  // (`search` param vs `mode`+`pattern` params).
  const [searchMode, setSearchMode] = useState<SearchMode>("subject");
  const [searchPattern, setSearchPattern] = useState("");
  const [selectionNotice, setSelectionNotice] = useState("");
  const [compareBase, setCompareBase] = useState("");
  const [compareTarget, setCompareTarget] = useState("");
  const [compareResult, setCompareResult] = useState<CompareResult | null>(null);
  const [compareLoading, setCompareLoading] = useState(false);
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
  const workTreeAbortRef = useRef<AbortController | null>(null);
  const workTreeDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedRefRef = useRef(selectedRef);
  const searchRef = useRef(search);
  const authorRef = useRef(author);
  const pathRef = useRef(path);
  const searchModeRef = useRef(searchMode);
  const searchPatternRef = useRef(searchPattern);
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
  const {
    compareBarCollapsed,
    activityGraphCollapsed,
    toggleCompareBar,
    toggleActivityGraph,
  } = useTimelinePrefs();
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
    searchModeRef.current = searchMode;
  }, [searchMode]);

  useEffect(() => {
    searchPatternRef.current = searchPattern;
  }, [searchPattern]);

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
    loadRepositoryState(selectedRepo, selectedRef, search, author, path, searchMode, searchPattern)
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
  }, [selectedRepo, selectedRef, search, author, path, searchMode, searchPattern]);

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
      setDetailLoading(false);
      return;
    }
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
      Promise.all([
        getCommit(selectedRepo, selected, controller.signal),
        getDiff(selectedRepo, selected, controller.signal),
      ])
        .then(([nextDetail, nextDiff]) => {
          if (controller.signal.aborted) return;
          setDetail(nextDetail);
          setDiff(nextDiff);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
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
        })
        .catch((err) => {
          // Aborts are routine (rapid SSE bursts cancel the previous in-flight
          // request) — they are not user-visible errors. Anything else surfaces
          // through the existing error banner so users can see the API issue.
          if (controller.signal.aborted) return;
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(errorMessage(err));
        });
    },
    [],
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
        setWorkTree(response);
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(errorMessage(err));
      });
  }, []);

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
    return () => {
      window.removeEventListener("focus", onFocus);
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
      // A new commit on the base advances HEAD and shifts every other ref's
      // ahead/behind by one; on a non-base ref it shifts that single ref's
      // ahead. Either way drift needs a refresh.
      scheduleDriftRefresh(selectedRepo);
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
      // History rewrites change ahead/behind against base, so refresh drift.
      scheduleDriftRefresh(selectedRepo);
    });
    for (const type of ["ref_created", "ref_updated", "ref_deleted"] as const) {
      source.addEventListener(type, () => {
        const notice = "Refs changed";
        handleRealtimeEvent(notice, () => setEventNotice(notice));
        // Any ref topology change can shift drift on every other ref (e.g.
        // moving HEAD changes ahead/behind for all branches). Debounced
        // refresh coalesces bursts.
        scheduleDriftRefresh(selectedRepo);
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
    // `scheduleDriftRefresh` and other callbacks read from refs/state via
    // their useCallback closures; the only reactive identifier the EventSource
    // itself depends on is `selectedRepo`, mirroring existing precedent in
    // this file.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedRepo]);

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

  // Shortcut wiring lives further down (see `shortcutBindings` + `useKeyboardShortcuts`)
  // so it can read `current`, `commits`, and `diff` availability that are
  // computed below.

  const current = commits.find((c) => c.hash === selected) ?? commits[0] ?? null;
  const repoName = repositories.find((repo) => repo.id === selectedRepo)?.name ?? selectedRepo;
  const refName = displayRefName(selectedRef, refs);
  const toggleSummaryView = useCallback(() => setSummaryViewOpen((prev) => !prev), []);
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
    if (current?.files) {
      for (const file of current.files) {
        if (!file?.path || seen.has(file.path)) continue;
        seen.add(file.path);
        merged.push(file.path);
      }
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
  }, []);
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
        workTree.unstaged.summary.fileCount > 0),
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

  async function refreshTimeline(
    repoId: string,
    ref: string,
    searchTerm: string,
    authorTerm: string,
    pathTerm: string,
    mode: SearchMode,
    pattern: string,
  ) {
    const { nextRefs, nextRef, nextCommits } = await loadRepositoryState(
      repoId,
      ref,
      searchTerm,
      authorTerm,
      pathTerm,
      mode,
      pattern,
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
      searchModeRef.current,
      searchPatternRef.current,
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
      searchModeRef.current,
      searchPatternRef.current,
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

  // Diff fullscreen only makes sense when there's actually a diff rendered.
  // Mirrors the gating used in CommandPalette so the shortcut behaves identically
  // to the palette command and doesn't surprise users with a no-op.
  const diffFullscreenAvailable =
    Boolean(current) && (Boolean(diff.diff) || diff.truncated);

  const goToAdjacentCommit = useCallback(
    (direction: 1 | -1) => {
      if (!commits.length) return;
      const currentIndex = selected
        ? commits.findIndex((commit) => commit.hash === selected)
        : 0;
      // No selection yet: treat the next press as "land on the first commit"
      // rather than jumping based on a -1 index.
      const nextIndex =
        currentIndex < 0
          ? 0
          : Math.min(commits.length - 1, Math.max(0, currentIndex + direction));
      if (nextIndex === currentIndex) return;
      handleSelectCommit(commits[nextIndex].hash);
    },
    [commits, selected, handleSelectCommit],
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
    goToAdjacentCommit,
    diffFullscreenAvailable,
    diffFullscreen,
  ]);

  // Suppress non-global shortcuts whenever a modal-like surface owns the
  // keyboard. Each surface manages its own Esc handler; we just need to keep
  // the global bindings out of the way.
  const shortcutsSuppressed =
    paletteOpen ||
    helpOpen ||
    fileHistoryPromptOpen ||
    Boolean(fileHistoryPath);

  useKeyboardShortcuts(shortcutBindings, shortcutsSuppressed);

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
      <RefScopeTokens />
      <TopBar
        repositories={repositories}
        selectedRepo={selectedRepo}
        onSelectRepo={(repoId) => {
          setSelectedRepo(repoId);
          setSelectedRef("HEAD");
          setSelected("");
          setSelectedWorkTree(false);
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
            stashes={stashes}
            worktrees={worktrees}
            submodules={submodules}
            repoState={repoState}
          />
        </ResizablePanel>
        <ResizableHandle withHandle aria-label="Resize branch sidebar" />
        <ResizablePanel
          id="rs-center"
          order={2}
          defaultSize={panelSizes.center}
          minSize={25}
        >
          <div id="main-content" tabIndex={-1} className="flex flex-col overflow-hidden h-full">
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
              onSelect={handleSelectCommit}
              loading={loading}
              error={error}
              eventNotice={eventNotice}
              eventStatus={eventStatus}
              livePaused={livePaused}
              pendingUpdates={pendingUpdates}
              liveAnnouncement={liveAnnouncement}
              activeFilters={activeFilters(search, author, path, searchMode, searchPattern)}
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
            diffViewMode={diffViewMode}
            onDiffViewModeChange={setDiffViewMode}
            repoId={selectedRepo}
            workTreeSelected={selectedWorkTree}
            workTree={workTree}
            onOpenFileHistory={submitFileHistoryPath}
            onFilterByPath={(value) => {
              setPath(value);
              setSelected("");
            }}
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
        onSearchPatternChange={(value) => {
          setSearchPattern(value);
          setSelected("");
        }}
        workTreeAvailable={workTreeHasChanges}
        onShowWorkTree={handleSelectWorkTree}
        onRefreshWorkTree={handleRefreshWorkTree}
        onOpenFileHistory={openFileHistoryPrompt}
        onShowShortcuts={() => setHelpOpen(true)}
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

function activeFilters(
  search: string,
  author: string,
  path: string,
  searchMode: SearchMode,
  searchPattern: string,
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
        --rs-text-muted: oklch(62% 0.02 255);
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
        --rs-z-base:     0;
        --rs-z-elevated: 1;
        --rs-z-overlay:  40;
        --rs-z-modal:    50;
        --rs-z-toast:    60;
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
        display: inline-flex;
        align-items: center;
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
        color: oklch(63% 0.03 255);
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
        /* Wong vermilion. Was oklch(62% 0.18 25) — failed WCAG 2.2 AA
           (4.24:1 vs canvas, 0.26pt short of 4.5:1). On the dark canvas
           (L≈16%) we need to raise lightness, not lower it. L=68% with
           reduced chroma (0.16) keeps the Wong vermilion identity (hue 25°,
           >30° from add 55° and del 240° anchors) while clearing AA on
           canvas (7.02:1), add bg (5.80:1), and del bg (6.37:1). */
        color: oklch(68% 0.16 25);
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
        color: oklch(62% 0.02 255);
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
