import { useEffect, useMemo, useState } from "react";
import { FileSearch, GitBranch, Hash, Moon, Pause, Play, Search, Tag } from "lucide-react";
import type { LucideIcon } from "lucide-react";
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
  livePaused,
  quietMode,
  isQuiet,
  onToggleQuietMode,
  onToggleLiveUpdates,
  onSearchChange,
  onAuthorChange,
  onPathChange,
}: {
  open: boolean;
  onClose: () => void;
  refs: GitRef[];
  selectedCommit: Commit | null;
  onSelectRef: (ref: string) => void;
  search: string;
  author: string;
  path: string;
  livePaused: boolean;
  quietMode: boolean;
  isQuiet: boolean;
  onToggleQuietMode: () => void;
  onToggleLiveUpdates: () => void;
  onSearchChange: (value: string) => void;
  onAuthorChange: (value: string) => void;
  onPathChange: (value: string) => void;
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

    const filterCommands = [
      search
        ? {
            icon: FileSearch,
            label: "Clear message search",
            hint: "search",
            run: () => {
              onSearchChange("");
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

    return [...refCommands, quietCommand, liveCommand, ...copyCommand, ...filterCommands];
  }, [
    author,
    isQuiet,
    livePaused,
    onAuthorChange,
    onClose,
    onPathChange,
    onSearchChange,
    onSelectRef,
    onToggleLiveUpdates,
    onToggleQuietMode,
    path,
    quietMode,
    refs,
    search,
    selectedCommit,
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
      className="fixed inset-0 grid place-items-start justify-center pt-[18vh] z-50"
      style={{ background: "color-mix(in oklab, black, transparent 50%)" }}
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
