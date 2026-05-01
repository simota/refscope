import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "refscope.colorVisionTheme";
const FORCED_COLORS_QUERY = "(forced-colors: active)";

export type ColorVisionTheme = "default" | "cvd-safe";

// Color vision theme toggle — parallel to useQuietMode in shape.
// "default" uses the existing OKLCH palette (may cause hue collisions for
//  deuteranomaly / protanopia users).
// "cvd-safe" replaces the diff add/del colors and Prism token palette with
//  the Wong (2011) blue-orange dichotomy, which is safe for deuteranopia,
//  protanopia, and tritanopia.
//
// This hook owns ONE independent input (user toggle).
// OS `prefers-contrast` detection is tracked as an informational signal
// but does not auto-activate CVD-safe mode (different concern from CVD).
// `data-color-vision` and `data-quiet` are orthogonal root attributes —
// they must never be merged into a single attribute so both can be active
// simultaneously without CSS specificity surprises.
export function useColorVisionTheme() {
  const [theme, setTheme] = useState<ColorVisionTheme>(readStoredTheme);
  const [prefersHighContrast, setPrefersHighContrast] = useState<boolean>(
    readForcedColors,
  );

  // Persist user choice to localStorage.
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Storage unavailable (private mode / quota): in-session toggle still works.
    }
  }, [theme]);

  // Track OS forced-colors (informational only — not auto-toggled).
  useEffect(() => {
    try {
      const media = window.matchMedia(FORCED_COLORS_QUERY);
      const handler = (event: MediaQueryListEvent) =>
        setPrefersHighContrast(event.matches);
      setPrefersHighContrast(media.matches);
      media.addEventListener("change", handler);
      return () => media.removeEventListener("change", handler);
    } catch {
      return undefined;
    }
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((current) => (current === "default" ? "cvd-safe" : "default"));
  }, []);

  const isCvdSafe = theme === "cvd-safe";

  return {
    colorVisionTheme: theme,
    isCvdSafe,
    prefersHighContrast,
    toggleTheme,
  };
}

function readStoredTheme(): ColorVisionTheme {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "cvd-safe" ? "cvd-safe" : "default";
  } catch {
    return "default";
  }
}

function readForcedColors(): boolean {
  try {
    return window.matchMedia(FORCED_COLORS_QUERY).matches;
  } catch {
    return false;
  }
}
