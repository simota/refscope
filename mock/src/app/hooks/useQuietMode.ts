import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "refscope.quietMode";
const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

// Quiet mode owns two independent inputs (user toggle + OS prefers-reduced-motion)
// so the UI can distinguish "the user asked for calm" from "the OS asked for calm",
// while the rest of the app only cares about the unioned `isQuiet`.
export function useQuietMode() {
  const [quietMode, setQuietMode] = useState<boolean>(readStoredQuiet);
  const [prefersReducedMotion, setPrefersReducedMotion] = useState<boolean>(readReducedMotion);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, quietMode ? "1" : "0");
    } catch {
      // Storage may be unavailable (private mode, quota); the user toggle still works in-session.
    }
  }, [quietMode]);

  useEffect(() => {
    const media = window.matchMedia(REDUCED_MOTION_QUERY);
    const handler = (event: MediaQueryListEvent) => setPrefersReducedMotion(event.matches);
    setPrefersReducedMotion(media.matches);
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, []);

  const toggleQuietMode = useCallback(() => {
    setQuietMode((current) => !current);
  }, []);

  return {
    quietMode,
    prefersReducedMotion,
    isQuiet: quietMode || prefersReducedMotion,
    toggleQuietMode,
  };
}

function readStoredQuiet() {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function readReducedMotion() {
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}
