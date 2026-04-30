import { ChevronDown, Search, Circle, Command } from "lucide-react";

export function TopBar() {
  return (
    <header
      className="flex items-center gap-3 px-4 border-b"
      style={{
        height: 48,
        background: "var(--rs-bg-panel)",
        borderColor: "var(--rs-border)",
      }}
    >
      <div className="flex items-center gap-2">
        <div
          className="grid place-items-center rounded-md"
          style={{
            width: 24,
            height: 24,
            background: "color-mix(in oklab, var(--rs-bg-elevated), var(--rs-accent) 30%)",
            color: "var(--rs-accent)",
          }}
        >
          <span style={{ fontSize: 12, fontWeight: 700 }}>R</span>
        </div>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--rs-text-primary)" }}>
          RefScope
        </span>
      </div>

      <Separator />

      <button className="rs-chip">
        frontend-app <ChevronDown size={12} />
      </button>
      <button className="rs-chip">
        <Circle size={8} fill="var(--rs-accent)" stroke="none" /> main <ChevronDown size={12} />
      </button>

      <div className="flex-1 flex items-center justify-center px-4">
        <div
          className="flex items-center gap-2 px-3 w-full max-w-xl"
          style={{
            height: 30,
            background: "var(--rs-bg-canvas)",
            border: "1px solid var(--rs-border)",
            borderRadius: "var(--rs-radius-sm)",
          }}
        >
          <Search size={13} style={{ color: "var(--rs-text-muted)" }} />
          <input
            placeholder="Search commits, files, authors…"
            className="bg-transparent outline-none flex-1"
            style={{ fontSize: 12, color: "var(--rs-text-primary)" }}
          />
          <span
            className="flex items-center gap-1 px-1.5 rounded"
            style={{
              fontSize: 11,
              color: "var(--rs-text-muted)",
              border: "1px solid var(--rs-border)",
              fontFamily: "var(--rs-mono)",
            }}
          >
            <Command size={10} /> K
          </span>
        </div>
      </div>

      <div
        className="flex items-center gap-1.5 px-2"
        style={{ fontSize: 11, color: "var(--rs-text-secondary)", fontFamily: "var(--rs-mono)" }}
      >
        <span
          className="inline-block rounded-full"
          style={{
            width: 7,
            height: 7,
            background: "var(--rs-git-added)",
            boxShadow: "0 0 0 3px color-mix(in oklab, var(--rs-git-added), transparent 75%)",
          }}
        />
        LIVE
      </div>
    </header>
  );
}

function Separator() {
  return (
    <div style={{ width: 1, height: 20, background: "var(--rs-border)" }} aria-hidden />
  );
}
