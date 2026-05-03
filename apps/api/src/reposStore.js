/**
 * reposStore.js — Persistence layer for the user-managed repository allowlist.
 *
 * Persists repo entries added via the UI to ~/.config/refscope/repos.json
 * (or $XDG_CONFIG_HOME/refscope/repos.json when XDG_CONFIG_HOME is set).
 *
 * Charter v2 §1 Principle 2/3: file-based persistence is permitted ONLY for
 * the user-managed repository allowlist. No other state may be persisted.
 *
 * Schema (version 1):
 * {
 *   "version": 1,
 *   "repos": [{ "id": string, "path": string, "addedAt": ISO8601 }]
 * }
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STORE_VERSION = 1;
const STORE_SUBDIR = "refscope";
const STORE_FILENAME = "repos.json";

/**
 * Resolve the absolute path to the repos.json store file.
 *
 * Priority:
 * 1. $XDG_CONFIG_HOME/refscope/repos.json  (if XDG_CONFIG_HOME is set and non-empty)
 * 2. $HOME/.config/refscope/repos.json     (standard XDG default)
 * 3. null                                  (HOME unset or empty — env-only fallback)
 *
 * @param {{ XDG_CONFIG_HOME?: string, HOME?: string } & NodeJS.ProcessEnv} [env]
 * @returns {string | null}
 */
export function resolveStorePath(env = process.env) {
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    return path.join(xdg, STORE_SUBDIR, STORE_FILENAME);
  }

  const home = env.HOME?.trim() || os.homedir();
  if (!home) {
    return null;
  }

  return path.join(home, ".config", STORE_SUBDIR, STORE_FILENAME);
}

/**
 * Load persisted repository entries from the store file.
 *
 * Behaviour:
 * - Store file absent or HOME unset → returns [] (env-only startup continues normally)
 * - JSON parse error or version mismatch → renames file to .bak.<timestamp>,
 *   emits one console.warn, returns [] (startup continues normally)
 *
 * @param {{ XDG_CONFIG_HOME?: string, HOME?: string } & NodeJS.ProcessEnv} [env]
 * @returns {{ id: string, path: string, addedAt: string }[]}
 */
export function loadPersistedRepos(env = process.env) {
  const storePath = resolveStorePath(env);
  if (!storePath) {
    return [];
  }

  let raw;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch (err) {
    // File does not exist yet — treat as empty; any other read error is also safe to ignore.
    if (err.code !== "ENOENT") {
      console.warn(`[reposStore] Could not read ${storePath}: ${err.message}`);
    }
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    _backupCorrupted(storePath);
    return [];
  }

  if (!isValidStoreShape(parsed)) {
    _backupCorrupted(storePath);
    return [];
  }

  return parsed.repos;
}

/**
 * Append a new repository entry to the store file.
 * Creates the parent directory (mode 0o700) and the file (mode 0o600) if absent.
 * Uses an atomic tmp-file → rename write to avoid partial writes on crash.
 *
 * @param {{ id: string, path: string, addedAt: string }} entry
 * @param {{ XDG_CONFIG_HOME?: string, HOME?: string } & NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
export function appendRepo(entry, env = process.env) {
  const storePath = resolveStorePath(env);
  if (!storePath) {
    throw new Error("[reposStore] Cannot persist: HOME directory is not set");
  }

  const current = _readStore(storePath);
  const updated = { version: STORE_VERSION, repos: [...current.repos, entry] };
  _atomicWrite(storePath, updated);
}

/**
 * Remove a repository entry from the store file by id.
 * If the id does not exist in the store the operation is a no-op.
 *
 * @param {string} id
 * @param {{ XDG_CONFIG_HOME?: string, HOME?: string } & NodeJS.ProcessEnv} [env]
 * @returns {void}
 */
export function removeRepo(id, env = process.env) {
  const storePath = resolveStorePath(env);
  if (!storePath) {
    throw new Error("[reposStore] Cannot persist: HOME directory is not set");
  }

  const current = _readStore(storePath);
  const filtered = current.repos.filter((r) => r.id !== id);
  if (filtered.length === current.repos.length) {
    // Entry not present — no-op (caller responsibility to check existence).
    return;
  }

  const updated = { version: STORE_VERSION, repos: filtered };
  _atomicWrite(storePath, updated);
}

// ─── Internal helpers ────────────────────────────────────────────────────────

/**
 * Read the store file and return a validated store object.
 * If the file is absent, returns an empty store.
 * If the file is corrupted, backs it up and returns an empty store.
 *
 * @param {string} storePath
 * @returns {{ version: number, repos: { id: string, path: string, addedAt: string }[] }}
 */
function _readStore(storePath) {
  let raw;
  try {
    raw = fs.readFileSync(storePath, "utf8");
  } catch (err) {
    if (err.code === "ENOENT") {
      return { version: STORE_VERSION, repos: [] };
    }
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    _backupCorrupted(storePath);
    return { version: STORE_VERSION, repos: [] };
  }

  if (!isValidStoreShape(parsed)) {
    _backupCorrupted(storePath);
    return { version: STORE_VERSION, repos: [] };
  }

  return parsed;
}

/**
 * Write data to storePath atomically:
 * 1. Ensure parent directory exists (mkdir -p, mode 0o700).
 * 2. Write JSON to a unique tmp file with mode 0o600.
 * 3. Rename tmp → target (POSIX rename atomicity).
 *
 * @param {string} storePath
 * @param {object} data
 * @returns {void}
 */
function _atomicWrite(storePath, data) {
  const dir = path.dirname(storePath);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

  const tmp = `${storePath}.tmp.${process.pid}.${Date.now()}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, storePath);
  } catch (err) {
    // Clean up tmp on failure to avoid leaving orphaned temp files.
    try { fs.unlinkSync(tmp); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Rename a corrupted store file to .bak.<timestamp> and emit a single warning.
 *
 * @param {string} storePath
 * @returns {void}
 */
function _backupCorrupted(storePath) {
  const bak = `${storePath}.bak.${Date.now()}`;
  try {
    fs.renameSync(storePath, bak);
    console.warn(`[reposStore] Persisted file corrupted, backed up to ${bak}`);
  } catch (renameErr) {
    console.warn(`[reposStore] Persisted file corrupted and could not be backed up: ${renameErr.message}`);
  }
}

/**
 * Return true if the parsed value matches the expected store schema (version 1).
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidStoreShape(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    value.version !== STORE_VERSION ||
    !Array.isArray(value.repos)
  ) {
    return false;
  }

  return value.repos.every(
    (r) =>
      typeof r === "object" &&
      r !== null &&
      typeof r.id === "string" &&
      typeof r.path === "string" &&
      typeof r.addedAt === "string",
  );
}
