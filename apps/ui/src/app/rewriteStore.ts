/**
 * rewriteStore.ts — localStorage persistence for rewrite rescue snapshots.
 *
 * Captures `history_rewritten` SSE events and stores the pre-rewrite tip hash
 * so users can recover from accidental force-push / rebase operations.
 *
 * Design decisions:
 * - Per-repo key: `refscope:rewrite_snapshots:v1:<repoId>` — avoids cross-repo
 *   contamination and allows per-repo eviction.
 * - FIFO ring buffer capped at MAX_SNAPSHOTS (20). Newest first on load so the
 *   most recent event is always at index 0.
 * - All localStorage calls are wrapped in try/catch. Private browsing mode and
 *   full-quota scenarios degrade gracefully to in-memory-only operation without
 *   throwing or crashing the app.
 * - No external dependencies; plain JSON serialization.
 */

/** Typed snapshot of a `history_rewritten` SSE event. */
export type RewriteRescueEntry = {
  /** Full ref name (e.g. "refs/heads/feature-x"). */
  ref: string;
  /** Short branch name (ref with "refs/heads/" stripped). */
  branch: string;
  /** Pre-rewrite tip commit hash. */
  previousHash: string;
  /** Post-rewrite tip commit hash. */
  currentHash: string;
  /** ISO 8601 timestamp of when the event was observed. */
  observedAt: string;
  /** Repo the event belongs to. */
  repoId: string;
};

/** Versioned wire shape stored in localStorage. */
type StoragePayload = {
  v: 1;
  entries: RewriteRescueEntry[];
};

const SCHEMA_VERSION = 1 as const;
/**
 * FIFO ring buffer cap for rescue snapshots.
 * Exported so the UI can render the same value in transparency text
 * ("up to N events kept") without duplicating the magic number in App.tsx
 * or RewriteRescuePanel.
 */
export const MAX_SNAPSHOTS = 20;

function storageKey(repoId: string): string {
  // Include schema version in key so a future breaking migration can use a
  // different key prefix without corrupting existing data during the transition.
  return `refscope:rewrite_snapshots:v1:${repoId}`;
}

/**
 * Load all rescue snapshots for a given repo from localStorage.
 * Returns an empty array on any error (missing key, malformed JSON, wrong schema).
 * Newest entries first (the store prepends on write).
 */
export function loadRewriteSnapshots(repoId: string): RewriteRescueEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(repoId));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !("v" in parsed) ||
      (parsed as Partial<StoragePayload>).v !== SCHEMA_VERSION
    ) {
      return [];
    }
    const candidate = parsed as Partial<StoragePayload>;
    if (!Array.isArray(candidate.entries)) return [];
    // Validate each entry is a well-formed object. Reject malformed entries
    // individually so a partial corruption doesn't wipe the whole list.
    return candidate.entries.filter((e): e is RewriteRescueEntry => {
      if (!e || typeof e !== "object") return false;
      return (
        typeof e.ref === "string" &&
        typeof e.branch === "string" &&
        typeof e.previousHash === "string" &&
        typeof e.currentHash === "string" &&
        typeof e.observedAt === "string" &&
        typeof e.repoId === "string"
      );
    });
  } catch {
    return [];
  }
}

/**
 * Persist a new rescue snapshot for the given repo.
 * Prepends the entry (newest first), then slices to MAX_SNAPSHOTS.
 * Silently no-ops when localStorage is unavailable or full.
 */
export function saveRewriteSnapshot(
  repoId: string,
  entry: RewriteRescueEntry,
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadRewriteSnapshots(repoId);
    const updated = [entry, ...existing].slice(0, MAX_SNAPSHOTS);
    const payload: StoragePayload = { v: SCHEMA_VERSION, entries: updated };
    window.localStorage.setItem(storageKey(repoId), JSON.stringify(payload));
  } catch {
    // QuotaExceededError / SecurityError / private mode → silently skip.
    // The caller holds the entry in React state for the current session.
  }
}

/**
 * Remove all stored snapshots for a given repo.
 * Safe to call even when no data exists (no-op in that case).
 */
export function clearRewriteSnapshots(repoId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(storageKey(repoId));
  } catch {
    // Silently ignore storage errors on clear.
  }
}

/**
 * Identifier used to address a single rescue snapshot. Composite of
 * `previousHash + observedAt` because (ref, previousHash) can repeat when the
 * same branch is rewritten multiple times — only the timestamp disambiguates.
 */
export type RescueSnapshotKey = {
  previousHash: string;
  observedAt: string;
};

/**
 * Remove a single rescue snapshot identified by its composite key.
 * No-op when storage is unavailable or the entry is absent.
 */
export function deleteRewriteSnapshot(
  repoId: string,
  key: RescueSnapshotKey,
): void {
  if (typeof window === "undefined") return;
  try {
    const existing = loadRewriteSnapshots(repoId);
    const filtered = existing.filter(
      (e) =>
        !(e.previousHash === key.previousHash && e.observedAt === key.observedAt),
    );
    if (filtered.length === existing.length) return; // not found, no-op
    const payload: StoragePayload = { v: SCHEMA_VERSION, entries: filtered };
    window.localStorage.setItem(storageKey(repoId), JSON.stringify(payload));
  } catch {
    // Silently ignore storage errors.
  }
}

// ---------------------------------------------------------------------------
// Shell quoting helpers (POSIX sh)
// ---------------------------------------------------------------------------

/**
 * Quote a string for safe substitution inside a POSIX sh single-quoted context.
 * `'` is replaced with `'\''` (close, escaped quote, reopen). This handles
 * spaces, `$`, backticks, semicolons, and other shell metacharacters because
 * single quotes suppress all expansion in POSIX sh.
 *
 * Used by `generateRestoreCommands` so branch names like `feature/alice's-fix`
 * or `feature/spaced name` round-trip safely through clipboard → terminal.
 *
 * NOTE: refscope assumes a POSIX-compatible shell (bash / zsh / sh / fish);
 * csh is not supported. Windows users are expected to use WSL / Git Bash.
 */
function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

// ---------------------------------------------------------------------------
// Command generation helpers (pure, no side effects)
// ---------------------------------------------------------------------------

/**
 * Generate the recommended restore commands for a rescue entry.
 * Returns a multiline shell string suitable for display and clipboard copy.
 *
 * Read-only philosophy: these are text templates only — they are never
 * executed by the UI.
 */
export function generateRestoreCommands(entry: RewriteRescueEntry): string {
  // shellQuote each free-form value so POSIX sh handles spaces, single quotes,
  // and metacharacters safely (e.g. `feature/alice's-fix`). previousHash is
  // hex-only in practice but we quote it too for uniform safety.
  const branch = shellQuote(entry.branch);
  const previousHash = shellQuote(entry.previousHash);
  return [
    `# Restore branch to pre-rewrite state (local only)`,
    `git checkout ${branch}`,
    `git reset --hard ${previousHash}`,
    ``,
    `# Verify`,
    `git log --oneline -5`,
    ``,
    `# (Optional) Inspect the rescued commit`,
    `git show ${previousHash} --stat`,
  ].join("\n");
}

/**
 * Generate a safe "create rescue branch" command so the user can inspect the
 * old state without disturbing the current branch.
 */
export function generateRescueBranchCommand(entry: RewriteRescueEntry): string {
  // Timestamp suffix: YYYYMMDD-HHMMSS derived from observedAt.
  const ts = entry.observedAt
    .replace(/[-:T]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace(/Z$/, "")
    .slice(0, 15);
  // safeBranch enforces git's ref-format constraints (a stricter alphabet
  // than shell). The resulting ref-name is then shellQuote-d when embedded
  // in the command alongside previousHash so a quote in a future format
  // change cannot break the command.
  const safeBranch = entry.branch.replace(/[^a-zA-Z0-9._/-]/g, "_");
  const newRef = shellQuote(`rescue/${safeBranch}-${ts}`);
  const previousHash = shellQuote(entry.previousHash);
  return `git checkout -b ${newRef} ${previousHash}`;
}
