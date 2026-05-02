import { useEffect } from "react";
import { Keyboard } from "lucide-react";
import {
  formatCombo,
  groupBindings,
  type ShortcutBinding,
} from "../../hooks/useKeyboardShortcuts";

// Lightweight help overlay listing the active shortcut bindings. Visual style
// mirrors CommandPalette (centered card on a dimmed backdrop) so the two
// keyboard-driven surfaces feel like the same family.

export function ShortcutHelp({
  open,
  onClose,
  bindings,
}: {
  open: boolean;
  onClose: () => void;
  bindings: ShortcutBinding[];
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  const groups = groupBindings(bindings);

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Keyboard shortcuts"
      className="fixed inset-0 grid place-items-start justify-center pt-[14vh]"
      style={{
        background: "color-mix(in oklab, black, transparent 50%)",
        zIndex: "var(--rs-z-modal)",
      }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg rounded-xl overflow-hidden"
        style={{
          background: "var(--rs-bg-elevated)",
          border: "1px solid var(--rs-border)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <div
          className="flex items-center gap-2 px-4"
          style={{
            height: 48,
            borderBottom: "1px solid var(--rs-border)",
          }}
        >
          <Keyboard size={14} style={{ color: "var(--rs-text-muted)" }} />
          <span
            className="flex-1"
            style={{ fontSize: 14, color: "var(--rs-text-primary)" }}
          >
            Keyboard shortcuts
          </span>
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

        <div className="px-2 py-1 max-h-[60vh] overflow-y-auto">
          {groups.map(({ category, items }) => (
            <section key={category} className="py-2">
              <header
                className="px-3 pb-1"
                style={{
                  fontSize: 10,
                  fontFamily: "var(--rs-mono)",
                  color: "var(--rs-text-muted)",
                  letterSpacing: "0.05em",
                  textTransform: "uppercase",
                }}
              >
                {category}
              </header>
              <ul role="list">
                {items.map((binding) => (
                  <li
                    key={binding.combo}
                    className="mx-1 px-3 flex items-center gap-2.5 rounded-md"
                    style={{
                      height: 32,
                      color: "var(--rs-text-primary)",
                      fontSize: 13,
                    }}
                  >
                    <span className="flex-1">{binding.description}</span>
                    <kbd
                      className="px-1.5 rounded"
                      style={{
                        fontSize: 11,
                        fontFamily: "var(--rs-mono)",
                        color: "var(--rs-text-primary)",
                        background: "var(--rs-bg-base)",
                        border: "1px solid var(--rs-border)",
                      }}
                    >
                      {formatCombo(binding.combo)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

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
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
