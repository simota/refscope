import { useEffect, useMemo, useState } from "react";
import {
  CalendarRange,
  Eye,
  FileSearch,
  GitBranch,
  Hash,
  History,
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
  onToggleLiveUpdates,
  onSearchChange,
  onAuthorChange,
  onPathChange,
  onSearchPatternChange,
  diffAvailable,
  diffFullscreen,
  onToggleDiffFullscreen,
  sidebarCollapsed,
  onToggleSidebar,
  workTreeAvailable,
  onShowWorkTree,
  onRefreshWorkTree,
  onOpenFileHistory,
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
  onToggleLiveUpdates: () => void;
  onSearchChange: (value: string) => void;
  onAuthorChange: (value: string) => void;
  onPathChange: (value: string) => void;
  onSearchPatternChange: (value: string) => void;
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
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [status, setStatus] = useState("");
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
              window.setTimeout(() => setStatus(""), 1600);
              onClose();
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

    return [
      ...refCommands,
      sidebarCommand,
      summaryCommand,
      quietCommand,
      cvdCommand,
      liveCommand,
      fileHistoryCommand,
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
    livePaused,
    onAuthorChange,
    onClose,
    onOpenFileHistory,
    onPathChange,
    onSearchChange,
    onSearchPatternChange,
    onSelectRef,
    onToggleColorVision,
    onToggleDiffFullscreen,
    onToggleLiveUpdates,
    onRefreshWorkTree,
    onShowWorkTree,
    onToggleQuietMode,
    onToggleSidebar,
    onToggleSummaryView,
    path,
    quietMode,
    refs,
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

  const filtered = commands.filter((c) =>
    c.label.toLowerCase().includes(q.toLowerCase()),
  );

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(0, filtered.length - 1)));
  }, [filtered.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
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
        <ul role="listbox" className="py-1 max-h-80 overflow-y-auto">
          {filtered.length === 0 ? (
            <li
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
