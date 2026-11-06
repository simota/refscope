import { useCallback, useEffect, useRef, useState } from "react";
import type { ViewerEvent } from "../api";

// Desktop notifications for watched (pinned) refs while the tab is in the
// background. Opt-in, per browser. Notifications are tagged per ref so a
// 50-commit push replaces one notification instead of stacking 50.

const STORAGE_KEY = "refscope.watchNotify";

type NotifyPermission = "default" | "granted" | "denied" | "unsupported";

function readPermission(): NotifyPermission {
  if (typeof window === "undefined" || !("Notification" in window)) return "unsupported";
  return window.Notification.permission;
}

function readEnabled(): boolean {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** The title/body for an event on a watched ref, or null when it is not worth a notification. */
export function describeWatchedEvent(event: ViewerEvent, repoLabel: string): { title: string; body: string } | null {
  const short = (hash: string | null | undefined) => (hash ? hash.slice(0, 7) : "?");
  switch (event.type) {
    case "history_rewritten":
      return {
        title: `History rewritten · ${event.ref.shortName}`,
        body: `${repoLabel}: ${short(event.previousHash)} → ${short(event.currentHash)}. Previous tip kept in the Rescue lens.`,
      };
    case "commit_added":
      return {
        title: `New commit · ${event.ref.shortName}`,
        body: `${repoLabel}: ${event.commit.subject}`,
      };
    case "ref_created":
      return { title: `Ref created · ${event.ref.shortName}`, body: `${repoLabel}: at ${short(event.ref.hash)}` };
    case "ref_deleted":
      return { title: `Ref deleted · ${event.ref.shortName}`, body: `${repoLabel}: was ${short(event.ref.hash)}` };
    case "ref_updated":
      return { title: `Ref moved · ${event.ref.shortName}`, body: `${repoLabel}: now ${short(event.ref.hash)}` };
    default:
      return null;
  }
}

export function useWatchNotifications(watched: ReadonlySet<string>, repoLabel: string) {
  const [enabled, setEnabled] = useState(readEnabled);
  const [permission, setPermission] = useState<NotifyPermission>(readPermission);
  const stateRef = useRef({ enabled, permission, watched, repoLabel });
  stateRef.current = { enabled, permission, watched, repoLabel };

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
    } catch {
      // In-session only when storage is unavailable.
    }
  }, [enabled]);

  const toggle = useCallback(async () => {
    if (stateRef.current.enabled) {
      setEnabled(false);
      return;
    }
    const current = readPermission();
    if (current === "unsupported" || current === "denied") {
      setPermission(current);
      return;
    }
    const next = current === "granted" ? current : await window.Notification.requestPermission();
    setPermission(next);
    if (next === "granted") setEnabled(true);
  }, []);

  /** Call for every SSE event; stable identity, reads the latest state. */
  const notify = useCallback((event: ViewerEvent) => {
    const { enabled: on, permission: perm, watched: set, repoLabel: label } = stateRef.current;
    if (!on || perm !== "granted") return;
    if (typeof document !== "undefined" && document.visibilityState === "visible") return;
    if (!("ref" in event) || !set.has(event.ref.name)) return;
    const text = describeWatchedEvent(event, label);
    if (!text) return;
    try {
      new window.Notification(text.title, { body: text.body, tag: `refscope:${event.ref.name}` });
    } catch {
      // Some platforms only allow notifications from a service worker; ignore.
    }
  }, []);

  return { enabled: enabled && permission === "granted", permission, toggle, notify };
}
