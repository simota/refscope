/**
 * FleetOnboardingOverlay — shown on first Fleet mount when localStorage key is absent.
 *
 * 4-line en text — Quill v1.2 confirmed wording (proposal §6.9).
 * No ja in MVP (single-language MVP per proposal §6.9 language note).
 *
 * localStorage key: "refscope.fleet.intro.dismissed.v1"
 * dismiss → sets key to "true"
 *
 * Quiet: animation 0ms, no fade (Quiet inherits 0ms, overlay stays persistent).
 * No new --rs-* CSS variables. No new npm packages.
 */

import { useState } from "react";
import { X } from "lucide-react";

const STORAGE_KEY = "refscope.fleet.intro.dismissed.v1";

function readDismissed(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeDismissed(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "true");
  } catch {
    // Quota exceeded / disabled storage — overlay can reappear next session; acceptable.
  }
}

export function FleetOnboardingOverlay({ isQuiet }: { isQuiet: boolean }) {
  const [dismissed, setDismissed] = useState<boolean>(() => readDismissed());

  if (dismissed) return null;

  const handleDismiss = () => {
    writeDismissed();
    setDismissed(true);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      handleDismiss();
    }
  };

  return (
    <div
      role="region"
      aria-label="Fleet introduction"
      onKeyDown={handleKeyDown}
      style={{
        position: "absolute",
        top: 48,
        left: 0,
        right: 0,
        zIndex: 40,
        margin: "0 auto",
        maxWidth: 540,
        background: "var(--rs-bg-elevated)",
        border: "1px solid var(--rs-border)",
        borderRadius: "var(--rs-radius-sm)",
        padding: "16px 20px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        // No transition/animation so Quiet is already satisfied (0ms)
        transition: isQuiet ? "none" : undefined,
      }}
    >
      {/* Dismiss × button */}
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss Fleet introduction"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          background: "none",
          border: "none",
          cursor: "pointer",
          color: "var(--rs-text-muted)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: 24,
          height: 24,
          borderRadius: "var(--rs-radius-sm)",
        }}
      >
        <X size={14} />
      </button>

      {/* 4-line en text — Quill v1.2 exact wording (proposal §6.9) */}
      <div
        style={{
          fontSize: 13,
          lineHeight: 1.65,
          color: "var(--rs-text-primary)",
          marginBottom: 16,
        }}
      >
        <p style={{ margin: "0 0 8px" }}>
          Fleet shows all repos you&apos;ve registered with Refscope &mdash; one row per repo.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          Just you, your machine, your Git repos. Not a team tool.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          A dash (&mdash;) means no Git event was observed in the last 24 hours, not that something is broken.
        </p>
        <p style={{ margin: "0 0 8px" }}>
          Click any row to open that repo in detail view. Press Esc to return here.
        </p>
        <p style={{ margin: 0, color: "var(--rs-text-secondary)" }}>
          You can also add repos via the Add button below or via the RTGV_REPOS env var.
        </p>
      </div>

      {/* Got it button */}
      <button
        type="button"
        onClick={handleDismiss}
        style={{
          background: "var(--rs-bg-canvas)",
          border: "1px solid var(--rs-border)",
          borderRadius: "var(--rs-radius-sm)",
          padding: "4px 16px",
          fontSize: 12,
          color: "var(--rs-text-primary)",
          cursor: "pointer",
          fontFamily: "var(--rs-sans)",
        }}
      >
        Got it
      </button>
    </div>
  );
}
