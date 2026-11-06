import { useCallback, useState } from "react";
import { setRedactionEnabled } from "../api";

// Redact mode persistence + the remount that applies it.
//
// Masking happens at the API boundary, so data already in memory was read
// under the previous setting. Toggling therefore remounts <App> (via the
// Root in main.tsx): every component re-reads through the new setting, and
// nothing unmasked can linger in a stale lens cache. Repo / ref / selected
// commit / path / compare pair already survive through the URL; the
// remaining view state is handed across the remount via `carryOver`.

const STORAGE_KEY = "refscope.redactMode";

export type RedactCarryOver = {
  search: string;
  author: string;
  searchMode: string;
  searchPattern: string;
  sinceDate: string;
  untilDate: string;
  historyShape?: string;
  activeLens: string;
};

let carryOver: RedactCarryOver | null = null;
const remountListeners = new Set<() => void>();

export function readStoredRedactMode(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Call once before the first render so the very first request is masked. */
export function initRedactMode() {
  setRedactionEnabled(readStoredRedactMode());
}

export function onRedactRemount(listener: () => void) {
  remountListeners.add(listener);
  return () => {
    remountListeners.delete(listener);
  };
}

/** View state stashed by the previous <App> instance, consumed once. */
export function takeRedactCarryOver(): RedactCarryOver | null {
  const value = carryOver;
  carryOver = null;
  return value;
}

export function useRedactMode() {
  const [redacted] = useState<boolean>(readStoredRedactMode);

  const setRedacted = useCallback((next: boolean, state: RedactCarryOver) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
    } catch {
      // Storage unavailable: the mode still applies for this page session.
    }
    setRedactionEnabled(next);
    carryOver = state;
    for (const listener of remountListeners) listener();
  }, []);

  return { redacted, setRedacted };
}
