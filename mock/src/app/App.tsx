import { useEffect, useState } from "react";
import { TopBar } from "./components/refscope/TopBar";
import { BranchSidebar } from "./components/refscope/BranchSidebar";
import { CommitTimeline } from "./components/refscope/CommitTimeline";
import { DetailPanel } from "./components/refscope/DetailPanel";
import { CommandPalette } from "./components/refscope/CommandPalette";
import { commits } from "./components/refscope/data";

export default function App() {
  const [selected, setSelected] = useState(commits[0].hash);
  const [paletteOpen, setPaletteOpen] = useState(false);

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

  const current = commits.find((c) => c.hash === selected) ?? commits[0];

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
      <TopBar />
      <div className="flex flex-1 overflow-hidden">
        <BranchSidebar />
        <CommitTimeline
          commits={commits}
          selected={selected}
          onSelect={setSelected}
        />
        <DetailPanel commit={current} />
      </div>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
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
