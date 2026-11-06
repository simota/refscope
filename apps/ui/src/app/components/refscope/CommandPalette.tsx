import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarRange,
  Bell,
  Eye,
  EyeOff,
  FileSearch,
  FolderOpen,
  FolderTree,
  PackageCheck,
  Users,
  GitBranch,
  Hash,
  History,
  Keyboard,
  Layers,
  Maximize2,
  Moon,
  PanelLeftClose,
  Pause,
  Play,
  RefreshCw,
  Search,
  Tag,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { SearchMode } from "../../api";
import type { Commit, GitRef } from "./data";
import type { LastOpenedEntry } from "../../hooks/useLastOpenedRepos";

type PaletteCommand = {
  icon: LucideIcon;
  label: string;
  hint: string;
  run: () => void | Promise<void>;
};

export function CommandPalette({
  open,
  onClose,
  refs,
  selectedCommit,
  onSelectRef,
  search,
  author,
  path,
  searchMode,
  searchPattern,
  livePaused,
  quietMode,
  isQuiet,
  isCvdSafe,
  onToggleColorVision,
  summaryViewOpen,
  onToggleSummaryView,
  onToggleQuietMode,
  redacted,
  onToggleRedact,
  watchNotifyEnabled = false,
  onToggleWatchNotify,
  onToggleLiveUpdates,
  onSearchChange,
  onAuthorChange,
  onPathChange,
  onSearchPatternChange,
  onSetSearchMode,
  diffAvailable,
  diffFullscreen,
  onToggleDiffFullscreen,
  sidebarCollapsed,
  onToggleSidebar,
  workTreeAvailable,
  onShowWorkTree,
  onRefreshWorkTree,
  onOpenFileHistory,
  onBrowseFiles,
  onSearchCode,
  onShowOwners,
  onOpenReleases,
  onShowShortcuts,
  mode,
  onSetMode,
  repos,
  onSetSelectedRepo,
  lastOpenedRepos,
}: {
  open: boolean;
  onClose: () => void;
  refs: GitRef[];
  selectedCommit: Commit | null;
  onSelectRef: (ref: string) => void;
  search: string;
  author: string;
  path: string;
  searchMode: SearchMode;
  searchPattern: string;
  livePaused: boolean;
  quietMode: boolean;
  isQuiet: boolean;
  isCvdSafe: boolean;
  onToggleColorVision: () => void;
  summaryViewOpen: boolean;
  onToggleSummaryView: () => void;
  onToggleQuietMode: () => void;
  redacted: boolean;
  onToggleRedact: () => void;
  /** Desktop notifications for pinned refs while the tab is hidden. */
  watchNotifyEnabled?: boolean;
  onToggleWatchNotify?: () => void;
  onToggleLiveUpdates: () => void;
  onSearchChange: (value: string) => void;
  onAuthorChange: (value: string) => void;
  onPathChange: (value: string) => void;
  onSearchPatternChange: (value: string) => void;
  onSetSearchMode: (mode: SearchMode) => void;
  diffAvailable: boolean;
  diffFullscreen: boolean;
  onToggleDiffFullscreen: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  // `workTreeAvailable` is true when the API confirmed at least one tracked
  // change. We hide the "Show working tree changes" command when the
  // working tree is clean; the refresh command stays visible regardless so
  // the user can re-poll after committing or staging.
  workTreeAvailable: boolean;
  onShowWorkTree: () => void;
  onRefreshWorkTree: () => void;
  // Opens the file-history path-input prompt. Always available — the prompt
  // itself is the gate, so we don't gate the command on selection state.
  onOpenFileHistory: () => void;
  // Repository browser at the selected commit (or the selected ref's tip).
  onBrowseFiles?: () => void;
  onSearchCode?: () => void;
  /** Repository browser on the Owners tab (who changed a folder or file). */
  onShowOwners?: () => void;
  /** Releases dialog (tags reachable from the timeline's ref). */
  onOpenReleases?: () => void;
  // Opens the keyboard-shortcut help dialog. Surfaced here so users who reach
  // for the palette can still find the shortcut list without knowing the `?` key.
  onShowShortcuts: () => void;
  /** Current view mode — used to show context-sensitive mode-switch commands. */
  mode: "fleet" | "detail";
  /** Callback to switch view mode. */
  onSetMode: (mode: "fleet" | "detail") => void;
  /** All repo ids from RTGV_REPOS — used to build jump-to-repo commands. */
  repos: string[];
  /** Callback to switch the active repo in Detail mode. */
  onSetSelectedRepo: (id: string) => void;
  /** Last opened entries (newest first) — used to sort jump commands. */
  lastOpenedRepos: LastOpenedEntry[];
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("");
  // Delayed-close timer for copy-style commands: the status message must be
  // visible before the palette unmounts (a closed palette renders null).
  const closeTimerRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    },
    [],
  );
  const commands = useMemo<PaletteCommand[]>(() => {
    const refCommands = refs.slice(0, 12).map((ref) => ({
      icon: ref.type === "tag" ? Tag : GitBranch,
      label: `Switch to ${formatRefLabel(ref)}`,
      hint: ref.type,
      run: () => {
        onSelectRef(ref.name);
        onClose();
      },
    }));

    const searchModeLabelMap: Record<SearchMode, string> = {
      subject: "message search",
      pickaxe: "pickaxe search (-S)",
      regex: "regex search (-G)",
      message: "message grep (--grep)",
    };
    // Subject mode uses `search`; other modes use `searchPattern`.
    const activeSearchValue = searchMode === "subject" ? search : searchPattern;
    const filterCommands = [
      activeSearchValue
        ? {
            icon: FileSearch,
            label: `Clear ${searchModeLabelMap[searchMode]}`,
            hint: "search",
            run: () => {
              if (searchMode === "subject") {
                onSearchChange("");
              } else {
                onSearchPatternChange("");
              }
              onClose();
            },
          }
        : null,
      author
        ? {
            icon: FileSearch,
            label: "Clear author filter",
            hint: "author",
            run: () => {
              onAuthorChange("");
              onClose();
            },
          }
        : null,
      path
        ? {
            icon: FileSearch,
            label: "Clear path filter",
            hint: "path",
            run: () => {
              onPathChange("");
              onClose();
            },
          }
        : null,
    ].filter((command): command is PaletteCommand => command !== null);

    const copyCommand: PaletteCommand[] = selectedCommit
      ? [
          {
            icon: Hash,
            label: "Copy current commit hash",
            hint: selectedCommit.shortHash ?? selectedCommit.hash.slice(0, 7),
            run: async () => {
              await navigator.clipboard.writeText(selectedCommit.hash);
              setStatus("Commit hash copied");
              // Keep the palette open briefly so the feedback is visible,
              // then close. Navigation commands still close instantly.
              if (closeTimerRef.current !== null) {
                window.clearTimeout(closeTimerRef.current);
              }
              closeTimerRef.current = window.setTimeout(() => {
                closeTimerRef.current = null;
                setStatus("");
                onClose();
              }, 900);
            },
          },
        ]
      : [];

    const liveCommand: PaletteCommand = {
      icon: livePaused ? Play : Pause,
      label: livePaused ? "Resume live updates" : "Pause live updates",
      hint: "live",
      run: () => {
        onToggleLiveUpdates();
        onClose();
      },
    };

    const quietCommand: PaletteCommand = {
      icon: Moon,
      label: "Toggle quiet mode",
      hint: quietBadge(quietMode, isQuiet),
      run: () => {
        onToggleQuietMode();
        onClose();
      },
    };

    const redactCommand: PaletteCommand = {
      icon: EyeOff,
      // "privacy" / "hide" / "screen share" are the natural search terms.
      label: "Toggle redact mode (hide names & e-mails for screen share)",
      hint: redacted ? "on" : "off",
      run: () => {
        onClose();
        onToggleRedact();
      },
    };

    const watchNotifyCommands: PaletteCommand[] = onToggleWatchNotify
      ? [
          {
            icon: Bell,
            label: "Toggle desktop notifications for pinned refs",
            hint: watchNotifyEnabled ? "on" : "off",
            run: () => {
              onToggleWatchNotify();
              onClose();
            },
          },
        ]
      : [];

    const cvdCommand: PaletteCommand = {
      icon: Eye,
      // Long-form label so palette substring search hits "color", "blind",
      // "safe", "CVD", or "theme" — all natural search terms for this feature.
      label: "Toggle color-blind safe theme (CVD)",
      hint: isCvdSafe ? "on (Wong palette)" : "off",
      run: () => {
        onToggleColorVision();
        onClose();
      },
    };

    const summaryCommand: PaletteCommand = {
      icon: CalendarRange,
      label: "Toggle period summary",
      hint: summaryViewOpen ? "on" : "off",
      run: () => {
        onToggleSummaryView();
        onClose();
      },
    };

    const sidebarCommand: PaletteCommand = {
      icon: PanelLeftClose,
      label: "Toggle branch sidebar",
      hint: sidebarCollapsed ? "hidden" : "shown",
      run: () => {
        onToggleSidebar();
        onClose();
      },
    };

    // Only surface the fullscreen command when there's actually a diff to show.
    // Mirrors the copyCommand pattern: hide entirely rather than disable, so the
    // palette stays focused on currently-actionable commands.
    const diffFullscreenCommand: PaletteCommand[] = diffAvailable
      ? [
          {
            icon: Maximize2,
            label: "Toggle diff fullscreen",
            hint: diffFullscreen ? "on" : "off",
            run: () => {
              onToggleDiffFullscreen();
              onClose();
            },
          },
        ]
      : [];

    // File-history entry. The trailing "…" follows the convention that the
    // command requires further input (here: the path-input prompt). Always
    // shown — gating on selection state would hide the very feature that
    // lets users escape from a wrong selection.
    const fileHistoryCommand: PaletteCommand = {
      icon: History,
      label: "Open file history…",
      hint: "path",
      run: () => {
        onOpenFileHistory();
        onClose();
      },
    };

    const browserTarget = selectedCommit
      ? selectedCommit.shortHash ?? selectedCommit.hash.slice(0, 7)
      : "ref tip";
    const browserCommands: PaletteCommand[] = [
      ...(onBrowseFiles
        ? [
            {
              icon: FolderTree,
              label: "Browse files / go to file…",
              hint: `t · ${browserTarget}`,
              run: () => {
                onBrowseFiles();
                onClose();
              },
            },
          ]
        : []),
      ...(onSearchCode
        ? [
            {
              icon: FileSearch,
              label: "Search code (grep) at revision…",
              hint: browserTarget,
              run: () => {
                onSearchCode();
                onClose();
              },
            },
          ]
        : []),
      ...(onShowOwners
        ? [
            {
              icon: Users,
              label: "Who changed this? Owners of a folder or file…",
              hint: `o · ${browserTarget}`,
              run: () => {
                onShowOwners();
                onClose();
              },
            },
          ]
        : []),
      ...(onOpenReleases
        ? [
            {
              icon: PackageCheck,
              label: "Releases, unreleased changes & release notes…",
              hint: "Shift+L",
              run: () => {
                onOpenReleases();
                onClose();
              },
            },
          ]
        : []),
    ];

    const shortcutHelpCommand: PaletteCommand = {
      icon: Keyboard,
      label: "Show keyboard shortcuts",
      hint: "?",
      run: () => {
        onShowShortcuts();
        onClose();
      },
    };

    // Working-tree commands. Refresh is always offered (the worktree might
    // be clean now and dirty after the user stages something); the
    // "Show changes" entry only appears when the API has confirmed at least
    // one tracked change, mirroring the copyCommand visibility pattern.
    const workTreeCommands: PaletteCommand[] = [
      {
        icon: RefreshCw,
        label: "Refresh working tree",
        hint: "worktree",
        run: () => {
          onRefreshWorkTree();
          onClose();
        },
      },
      ...(workTreeAvailable
        ? [
            {
              icon: FileSearch,
              label: "Show working tree changes",
              hint: "uncommitted",
              run: () => {
                onShowWorkTree();
                onClose();
              },
            },
          ]
        : []),
    ];

    // Jump-to-repo commands (Magi D4 O2).
    // One command per repo in RTGV_REPOS. Sorted by most recently opened first;
    // repos with no recorded open appear at the end in original declaration order.
    const openedIdsSorted = lastOpenedRepos.map((e) => e.repoId);
    const openedSet = new Set(openedIdsSorted);
    const reposSorted = [
      ...openedIdsSorted.filter((id) => repos.includes(id)),
      ...repos.filter((id) => !openedSet.has(id)),
    ];
    const repoJumpCommands: PaletteCommand[] = reposSorted.map((repoId) => ({
      icon: FolderOpen,
      label: `Open detail: ${repoId}`,
      hint: `Open ${repoId} in Detail mode`,
      run: () => {
        onSetMode("detail");
        onSetSelectedRepo(repoId);
        onClose();
      },
    }));

    // Mode-switch commands (Magi D1 採択前提条件 #3).
    // "Switch to Fleet mode" is always available; "Switch to Detail mode" only appears in Fleet mode.
    const modeCommands: PaletteCommand[] = [
      {
        icon: Layers,
        label: "Switch to Fleet mode",
        // Tooltip supplement per Magi D1 採択前提条件 #3: "(multi-repo observation mode)"
        hint: "multi-repo overview",
        run: () => {
          onSetMode("fleet");
          onClose();
        },
      },
      ...(mode === "fleet"
        ? [
            {
              icon: Layers,
              label: "Switch to Detail mode",
              hint: "single repo",
              run: () => {
                onSetMode("detail");
                onClose();
              },
            } satisfies PaletteCommand,
          ]
        : []),
    ];

    return [
      ...refCommands,
      ...repoJumpCommands,
      ...modeCommands,
      sidebarCommand,
      summaryCommand,
      quietCommand,
      cvdCommand,
      redactCommand,
      ...watchNotifyCommands,
      liveCommand,
      fileHistoryCommand,
      ...browserCommands,
      shortcutHelpCommand,
      ...workTreeCommands,
      ...diffFullscreenCommand,
      ...copyCommand,
      ...filterCommands,
    ];
  }, [
    author,
    diffAvailable,
    diffFullscreen,
    isCvdSafe,
    isQuiet,
    lastOpenedRepos,
    livePaused,
    mode,
    onAuthorChange,
    onClose,
    onOpenFileHistory,
    onBrowseFiles,
    onSearchCode,
    onShowOwners,
    onOpenReleases,
    onPathChange,
    onSearchChange,
    onSearchPatternChange,
    onSelectRef,
    onSetMode,
    onSetSelectedRepo,
    onToggleColorVision,
    onToggleDiffFullscreen,
    onToggleLiveUpdates,
    onRefreshWorkTree,
    onShowShortcuts,
    onShowWorkTree,
    onToggleQuietMode,
    onToggleRedact,
    redacted,
    onToggleWatchNotify,
    watchNotifyEnabled,
    onToggleSidebar,
    onToggleSummaryView,
    path,
    quietMode,
    refs,
    repos,
    search,
    searchMode,
    searchPattern,
    selectedCommit,
    sidebarCollapsed,
    summaryViewOpen,
    workTreeAvailable,
  ]);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
  }, [open]);

  // Dynamic commands synthesised from the literal query. Each label always
  // includes the query verbatim, so they survive the substring-includes
  // filter below. Kept as separate `if`s instead of useMemo because the cost
  // is trivial and we re-evaluate per keystroke anyway.
  const trimmedQ = q.trim();

  // "Scope to <path>" — when the query looks path-like (contains a forward
  // slash). Monorepo users land on `Cmd+K → "apps/api/" → Enter` for a
  // single-keystroke scope without polluting the static command list.
  const looksLikePath =
    trimmedQ.length > 0 &&
    trimmedQ.includes("/") &&
    !trimmedQ.startsWith("-") &&
    trimmedQ !== path &&
    /^[A-Za-z0-9_./*-]+$/.test(trimmedQ);

  // "Jump to PR #N" — recognises three forms reviewers actually type into a
  // chat-link → palette workflow: `pr 1234`, `#1234`, or a bare digit run
  // long enough to look like an issue number. The action narrows the
  // timeline via message-mode regex so both `Merge pull request #N` (merge
  // commits) and `(#N)` (squashed) are matched, then closes the palette.
  // No GitHub API call — purely local commit-message matching, the
  // explicit fallback strategy from the demand.
  let prNumber: string | null = null;
  const prMatch =
    /^pr\s+#?(\d+)$/i.exec(trimmedQ) ??
    /^#(\d+)$/.exec(trimmedQ) ??
    /^(\d{2,})$/.exec(trimmedQ);
  if (prMatch) prNumber = prMatch[1];

  const dynamicCommands: PaletteCommand[] = [];
  if (looksLikePath) {
    dynamicCommands.push({
      icon: FileSearch,
      label: `Scope to "${trimmedQ}"`,
      hint: "scope",
      run: () => {
        onPathChange(trimmedQ);
        onClose();
      },
    });
  }
  if (prNumber) {
    // POSIX ERE pattern (Git --grep --extended-regexp): match either the
    // GitHub merge-commit subject or the squash trailing `(#N)`. The digit
    // boundary `[^0-9]|$` prevents `#1234` matching `#12345`.
    const ereSafe = prNumber;
    const grepPattern =
      `(Merge pull request #${ereSafe}([^0-9]|$))|` +
      `(\\(#${ereSafe}\\))`;
    dynamicCommands.push({
      icon: GitBranch,
      label: `Jump to PR #${prNumber}`,
      hint: "pr",
      run: () => {
        onSetSearchMode("message");
        onSearchPatternChange(grepPattern);
        onClose();
      },
    });
  }

  const filtered = [
    ...commands.filter((c) => c.label.toLowerCase().includes(q.toLowerCase())),
    ...dynamicCommands,
  ];

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      // Ignore keys fired while an IME composition is active (Enter would
      // otherwise execute the highlighted command mid-composition).
      if (e.isComposing || e.keyCode === 229) return;
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => (filtered.length ? Math.min(filtered.length - 1, i + 1) : 0));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
      if (e.key === "Enter") {
        e.preventDefault();
        void runCommand(filtered[active]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [active, filtered, open, onClose]);

  // Return focus to whatever opened the palette, unless the command that ran
  // already moved focus somewhere meaningful (anything but <body>). The opener
  // is captured during the render that opens the palette: by the time an
  // effect runs, the input's autoFocus has already moved focus into it.
  const openerRef = useRef<HTMLElement | null>(null);
  const wasOpenRef = useRef(false);
  if (open && !wasOpenRef.current) {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  wasOpenRef.current = open;
  useEffect(() => {
    if (!open) return;
    const opener = openerRef.current;
    return () => {
      const current = document.activeElement;
      if (opener && opener.isConnected && (!current || current === document.body)) {
        opener.focus();
      }
    };
  }, [open]);

  // Keep the keyboard-highlighted option visible in the scrolling listbox.
  useEffect(() => {
    if (!open) return;
    document.getElementById(`rs-palette-option-${active}`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  if (!open) return null;

  async function runCommand(command: PaletteCommand | undefined) {
    if (!command) return;
    try {
      await command.run();
    } catch {
      setStatus("Command failed");
      window.setTimeout(() => setStatus(""), 1600);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Command palette"
      className="fixed inset-0 grid place-items-start justify-center pt-[18vh]"
      style={{ background: "color-mix(in oklab, black, transparent 50%)", zIndex: "var(--rs-z-modal)" }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl overflow-hidden"
        style={{
          background: "var(--rs-bg-elevated)",
          border: "1px solid var(--rs-border)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-4"
          style={{
            height: 48,
            borderBottom: "1px solid var(--rs-border)",
          }}
        >
          <Search size={14} style={{ color: "var(--rs-text-muted)" }} />
          <input
            autoFocus
            role="combobox"
            aria-label="Search commands"
            aria-expanded="true"
            aria-controls="rs-palette-listbox"
            aria-autocomplete="list"
            aria-activedescendant={filtered.length > 0 ? `rs-palette-option-${active}` : undefined}
            placeholder="Type a command…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="flex-1 bg-transparent outline-none"
            style={{
              fontSize: 14,
              color: "var(--rs-text-primary)",
            }}
          />
          <kbd
            className="px-1.5 rounded"
            style={{
              fontSize: 10,
              fontFamily: "var(--rs-mono)",
              color: "var(--rs-text-muted)",
              border: "1px solid var(--rs-border)",
            }}
          >
            ESC
          </kbd>
        </div>
        <ul id="rs-palette-listbox" role="listbox" aria-label="Commands" className="py-1 max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <li
              role="option"
              aria-selected="false"
              aria-disabled="true"
              className="px-4 py-6 text-center"
              style={{ color: "var(--rs-text-muted)", fontSize: 12 }}
            >
              No matches
            </li>
          ) : (
            filtered.map((c, i) => {
              const Icon = c.icon;
              const isActive = i === active;
              return (
                <li
                  key={c.label}
                  id={`rs-palette-option-${i}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => void runCommand(c)}
                  className="mx-1 px-3 flex items-center gap-2.5 rounded-md cursor-pointer"
                  style={{
                    height: 36,
                    background: isActive
                      ? "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 16%)"
                      : "transparent",
                    color: "var(--rs-text-primary)",
                    fontSize: 13,
                  }}
                >
                  <Icon
                    size={13}
                    style={{
                      color: isActive ? "var(--rs-accent)" : "var(--rs-text-muted)",
                    }}
                  />
                  <span className="flex-1">{c.label}</span>
                  <span
                    style={{
                      fontSize: 10,
                      fontFamily: "var(--rs-mono)",
                      color: "var(--rs-text-muted)",
                    }}
                  >
                    {c.hint}
                  </span>
                </li>
              );
            })
          )}
        </ul>
        <div
          className="px-4 flex items-center gap-3"
          style={{
            height: 28,
            borderTop: "1px solid var(--rs-border)",
            fontSize: 10,
            color: "var(--rs-text-muted)",
            fontFamily: "var(--rs-mono)",
          }}
        >
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
          {status ? <span>{status}</span> : null}
        </div>
      </div>
    </div>
  );
}

function formatRefLabel(ref: GitRef) {
  if (ref.type === "tag") return `tag ${ref.shortName}`;
  if (ref.type === "remote") return `remote ${ref.shortName}`;
  return ref.shortName;
}

function quietBadge(quietMode: boolean, isQuiet: boolean) {
  if (quietMode && isQuiet) return "on";
  if (!quietMode && isQuiet) return "on (OS)";
  return "off";
}
