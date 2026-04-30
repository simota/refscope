import { useEffect, useState } from "react";
import { Search, GitBranch, Hash, Eye, Zap, FileSearch } from "lucide-react";

const COMMANDS = [
  { icon: GitBranch, label: "Switch branch: main", hint: "branch" },
  { icon: GitBranch, label: "Switch branch: develop", hint: "branch" },
  { icon: FileSearch, label: 'Search commits by "checkout main"', hint: "search" },
  { icon: Hash, label: "Copy current commit hash", hint: "C" },
  { icon: Eye, label: "Toggle compact mode", hint: "view" },
  { icon: Zap, label: "Toggle live mode", hint: "L" },
];

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((i) => Math.min(COMMANDS.length - 1, i + 1));
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((i) => Math.max(0, i - 1));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  const filtered = COMMANDS.filter((c) =>
    c.label.toLowerCase().includes(q.toLowerCase()),
  );

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
            placeholder="Type a command or search…"
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
        </div>
      </div>
    </div>
  );
}
