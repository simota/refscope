import {
  ChevronDown,
  Search,
  Circle,
  Command,
  User,
  FileSearch,
  Moon,
  CalendarRange,
  PanelLeftClose,
  PanelLeftOpen,
  Eye,
} from "lucide-react";
import type { GitRef, Repository } from "./data";

export function TopBar({
  repositories,
  selectedRepo,
  onSelectRepo,
  refs,
  selectedRef,
  onSelectRef,
  repoName,
  refName,
  status,
  livePaused,
  effectivePaused,
  isQuiet,
  quietMode,
  prefersReducedMotion,
  onToggleQuietMode,
  isCvdSafe,
  onToggleColorVision,
  pendingUpdates,
  onToggleLiveUpdates,
  search,
  onSearchChange,
  author,
  onAuthorChange,
  path,
  onPathChange,
  summaryViewOpen,
  onToggleSummaryView,
  sidebarCollapsed,
  onToggleSidebar,
}: {
  repositories: Repository[];
  selectedRepo: string;
  onSelectRepo: (repoId: string) => void;
  refs: GitRef[];
  selectedRef: string;
  onSelectRef: (ref: string) => void;
  repoName: string;
  refName: string;
  status: "connecting" | "connected" | "error";
  livePaused: boolean;
  effectivePaused: boolean;
  isQuiet: boolean;
  quietMode: boolean;
  prefersReducedMotion: boolean;
  onToggleQuietMode: () => void;
  isCvdSafe: boolean;
  onToggleColorVision: () => void;
  pendingUpdates: number;
  onToggleLiveUpdates: () => void;
  search: string;
  onSearchChange: (value: string) => void;
  author: string;
  onAuthorChange: (value: string) => void;
  path: string;
  onPathChange: (value: string) => void;
  summaryViewOpen: boolean;
  onToggleSummaryView: () => void;
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}) {
  // In quiet mode, route the live indicator color to the muted token so chroma drops
  // without sacrificing the WCAG-validated text-on-panel contrast pairing.
  const liveColor = isQuiet
    ? "var(--rs-text-muted)"
    : livePaused
      ? "var(--rs-warning)"
      : status === "connected"
        ? "var(--rs-git-added)"
        : status === "error"
          ? "var(--rs-warning)"
          : "var(--rs-text-muted)";
  const quietReason = quietMode
    ? prefersReducedMotion
      ? "Quiet mode on (user + OS reduced-motion)"
      : "Quiet mode on"
    : prefersReducedMotion
      ? "Quiet mode on (OS reduced-motion)"
      : "Quiet mode off";

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

      <label className="rs-chip" style={{ paddingRight: 6 }}>
        <span className="sr-only">Repository</span>
        <select
          value={selectedRepo}
          onChange={(event) => onSelectRepo(event.target.value)}
          disabled={!repositories.length}
          className="bg-transparent outline-none"
          style={{
            appearance: "none",
            color: "inherit",
            font: "inherit",
            maxWidth: 180,
            cursor: repositories.length ? "pointer" : "default",
          }}
        >
          {repositories.length ? (
            repositories.map((repo) => (
              <option key={repo.id} value={repo.id}>
                {repo.name}
              </option>
            ))
          ) : (
            <option value="">{repoName}</option>
          )}
        </select>
        <ChevronDown size={12} />
      </label>
      <label className="rs-chip" style={{ paddingRight: 6 }}>
        <Circle size={8} fill="var(--rs-accent)" stroke="none" />
        <span className="sr-only">Ref</span>
        <select
          value={selectedRef}
          onChange={(event) => onSelectRef(event.target.value)}
          disabled={!selectedRepo}
          className="bg-transparent outline-none"
          style={{
            appearance: "none",
            color: "inherit",
            font: "inherit",
            maxWidth: 180,
            cursor: selectedRepo ? "pointer" : "default",
          }}
        >
          <option value="HEAD">{refs.length ? "HEAD" : refName}</option>
          {refs.map((ref) => (
            <option key={ref.name} value={ref.name}>
              {formatRefOption(ref)}
            </option>
          ))}
        </select>
        <ChevronDown size={12} />
      </label>

      <div className="flex-1 flex items-center justify-center gap-2 px-4">
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
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search commit messages…"
            className="bg-transparent outline-none flex-1"
            style={{ fontSize: 12, color: "var(--rs-text-primary)" }}
          />
          <span
            className="flex items-center gap-1 px-1.5 rounded"
            title="Author and path search via Cmd+K (Command Palette)"
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
        <div
          className="hidden xl:flex items-center gap-2 px-3"
          style={{
            width: 160,
            height: 30,
            background: "var(--rs-bg-canvas)",
            border: "1px solid var(--rs-border)",
            borderRadius: "var(--rs-radius-sm)",
          }}
        >
          <User size={13} style={{ color: "var(--rs-text-muted)" }} />
          <input
            value={author}
            onChange={(event) => onAuthorChange(event.target.value)}
            placeholder="Author"
            className="bg-transparent outline-none min-w-0 flex-1"
            style={{ fontSize: 12, color: "var(--rs-text-primary)" }}
          />
        </div>
        <div
          className="hidden xl:flex items-center gap-2 px-3"
          style={{
            width: 190,
            height: 30,
            background: "var(--rs-bg-canvas)",
            border: "1px solid var(--rs-border)",
            borderRadius: "var(--rs-radius-sm)",
          }}
        >
          <FileSearch size={13} style={{ color: "var(--rs-text-muted)" }} />
          <input
            value={path}
            onChange={(event) => onPathChange(event.target.value)}
            placeholder="Path"
            className="bg-transparent outline-none min-w-0 flex-1"
            style={{ fontSize: 12, color: "var(--rs-text-primary)" }}
          />
        </div>
      </div>

      <div className="flex items-center gap-2" style={{ fontFamily: "var(--rs-mono)" }}>
        <div
          className="flex items-center gap-1.5 px-2"
          aria-label={
            effectivePaused
              ? `Live updates paused, ${pendingUpdates} pending`
              : `Live status ${status}`
          }
          style={{ fontSize: 11, color: "var(--rs-text-secondary)" }}
        >
          <span
            className="inline-block rounded-full"
            style={{
              width: 7,
              height: 7,
              background: liveColor,
              boxShadow: isQuiet
                ? "none"
                : `0 0 0 3px color-mix(in oklab, ${liveColor}, transparent 75%)`,
            }}
          />
          <LivePulse
            status={status}
            paused={effectivePaused}
            pendingUpdates={pendingUpdates}
            color={liveColor}
            quiet={isQuiet}
          />
          {effectivePaused
            ? `PAUSED · ${pendingUpdates}`
            : status === "connected"
              ? "LIVE"
              : status.toUpperCase()}
        </div>
        <Separator />
        <button
          type="button"
          className="rs-compact-button"
          onClick={onToggleSidebar}
          aria-pressed={sidebarCollapsed}
          aria-label={sidebarCollapsed ? "Show branch sidebar" : "Hide branch sidebar"}
          title={sidebarCollapsed ? "Show branch sidebar" : "Hide branch sidebar"}
          style={
            sidebarCollapsed
              ? {
                  color: "var(--rs-text-primary)",
                  borderColor: "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                  background: "var(--rs-bg-elevated)",
                }
              : undefined
          }
        >
          {sidebarCollapsed ? (
            <PanelLeftOpen size={11} aria-hidden style={{ marginRight: 4 }} />
          ) : (
            <PanelLeftClose size={11} aria-hidden style={{ marginRight: 4 }} />
          )}
          {sidebarCollapsed ? "Show" : "Hide"}
        </button>
        <Separator />
        <button
          type="button"
          className="rs-compact-button"
          onClick={onToggleSummaryView}
          aria-pressed={summaryViewOpen}
          aria-label="Toggle period summary"
          title="Period summary view"
          style={
            summaryViewOpen
              ? {
                  color: "var(--rs-text-primary)",
                  borderColor: "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                  background: "var(--rs-bg-elevated)",
                }
              : undefined
          }
        >
          <CalendarRange size={11} aria-hidden style={{ marginRight: 4 }} />
          {summaryViewOpen ? "Summary on" : "Summary"}
        </button>
        <button
          type="button"
          className="rs-compact-button"
          onClick={onToggleQuietMode}
          aria-pressed={isQuiet}
          aria-label="Quiet mode"
          title={quietReason}
          style={
            isQuiet
              ? {
                  color: "var(--rs-text-primary)",
                  borderColor: "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                  background: "var(--rs-bg-elevated)",
                }
              : undefined
          }
        >
          <Moon size={11} aria-hidden style={{ marginRight: 4 }} />
          {isQuiet ? "Quiet on" : "Quiet"}
        </button>
        <button
          type="button"
          className="rs-compact-button"
          onClick={onToggleColorVision}
          aria-pressed={isCvdSafe}
          aria-label={isCvdSafe ? "CVD-safe theme on — click to switch to default" : "CVD-safe theme off — click to enable color-blind safe palette"}
          title={isCvdSafe ? "CVD-safe theme (Wong palette) — on" : "CVD-safe theme — off"}
          style={
            isCvdSafe
              ? {
                  color: "var(--rs-text-primary)",
                  borderColor: "color-mix(in oklab, var(--rs-border), var(--rs-accent) 50%)",
                  background: "var(--rs-bg-elevated)",
                }
              : undefined
          }
        >
          <Eye size={11} aria-hidden style={{ marginRight: 4 }} />
          {isCvdSafe ? "CVD on" : "CVD"}
        </button>
        <Separator />
        <button
          type="button"
          className="rs-compact-button"
          onClick={onToggleLiveUpdates}
          disabled={status === "error"}
          aria-pressed={livePaused}
          aria-label={livePaused ? "Resume live updates" : "Pause live updates"}
        >
          {livePaused ? "Resume" : "Pause"}
        </button>
      </div>
    </header>
  );
}

function LivePulse({
  status,
  paused,
  pendingUpdates,
  color,
  quiet,
}: {
  status: "connecting" | "connected" | "error";
  paused: boolean;
  pendingUpdates: number;
  color: string;
  quiet?: boolean;
}) {
  // Quiet mode pins the bars to a flat profile to remove ambient motion cues
  // while keeping the indicator visually present (legibility > erasure).
  const heights = quiet
    ? [6, 6, 6]
    : paused
      ? [5, Math.min(16, 6 + pendingUpdates * 2), 5]
      : status === "connected"
        ? [7, 13, 9]
        : status === "error"
          ? [12, 12, 12]
          : [5, 8, 11];
  return (
    <span
      className="inline-flex items-end gap-0.5"
      aria-hidden
      style={{ width: 16, height: 16 }}
    >
      {heights.map((height, index) => (
        <span
          key={`${height}-${index}`}
          className="rounded-sm"
          style={{
            width: 3,
            height,
            background: color,
            opacity: quiet ? 0.7 : paused ? 0.85 : 0.55 + index * 0.16,
          }}
        />
      ))}
    </span>
  );
}

function Separator() {
  return (
    <div style={{ width: 1, height: 20, background: "var(--rs-border)" }} aria-hidden />
  );
}

function formatRefOption(ref: GitRef) {
  if (ref.type === "branch") return ref.shortName;
  if (ref.type === "tag") return `tag: ${ref.shortName}`;
  if (ref.type === "remote") return `remote: ${ref.shortName}`;
  return ref.shortName;
}
