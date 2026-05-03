import fs from "node:fs";
import path from "node:path";

import { isValidRepoId, parseHost } from "./validation.js";
import { MAX_GIT_OUTPUT_BYTES } from "./gitRunner.js";
import { loadPersistedRepos, appendRepo, removeRepo } from "./reposStore.js";

export const DEFAULT_PORT = 4175;
const POSITIVE_DECIMAL_INTEGER_PATTERN = /^[0-9]+$/;
const MAX_TIMEOUT_MS = 2_147_483_647;
const REPO_ALLOWLIST_MAX_SIZE = 32;

/**
 * The in-memory config object reference. Mutated by addRepository / removeRepository.
 * @type {{ repositories: Map<string, { id: string, name: string, path: string, origin: "env" | "ui" }> } | null}
 */
let _currentConfig = null;

export function loadConfig(env = process.env) {
  const envEntries = parseRepositoryAllowlist(env.RTGV_REPOS ?? "", env);
  const persistedEntries = loadPersistedRepos(env);
  const repositories = mergeRepositoryAllowlist(envEntries, persistedEntries);
  const allowedOrigins = parseAllowedOrigins(env.RTGV_ALLOWED_ORIGINS);

  const rawHost = env.HOST ?? "127.0.0.1";
  const hostResult = parseHost(rawHost, env);
  if (!hostResult.accepted) {
    throw new Error(hostResult.reason);
  }
  if (hostResult.escapeHatchUsed) {
    console.warn(
      `[refscope] WARNING: HOST=${rawHost} is not a localhost address. ` +
      `RTGV_BIND_PUBLIC=1 override is active — the API is reachable from external networks. ` +
      `Ensure firewall rules are in place.`,
    );
  }

  const config = {
    host: rawHost,
    port: parsePort(env.PORT, DEFAULT_PORT),
    gitTimeoutMs: parsePositiveInteger(env.RTGV_GIT_TIMEOUT_MS, 5000, {
      max: MAX_TIMEOUT_MS,
      name: "RTGV_GIT_TIMEOUT_MS",
    }),
    diffMaxBytes: parsePositiveInteger(env.RTGV_DIFF_MAX_BYTES, 4_000_000, {
      max: MAX_GIT_OUTPUT_BYTES,
      name: "RTGV_DIFF_MAX_BYTES",
    }),
    refPollMs: parsePositiveInteger(env.RTGV_REF_POLL_MS, 2000),
    repositories,
    allowedOrigins,
  };
  _currentConfig = config;
  return config;
}

export function parseRepositoryAllowlist(value, _env = {}) {
  if (!value.trim()) {
    return new Map();
  }

  const repositories = new Map();
  /** @type {Map<string, string>} realPath -> first repoId that claimed it */
  const realPathIndex = new Map();

  for (const rawEntry of value.split(",")) {
    const entry = rawEntry.trim();
    if (!entry) continue;

    const separatorIndex = entry.indexOf("=");
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new Error("RTGV_REPOS entries must use repoId=/absolute/path");
    }

    const repoId = entry.slice(0, separatorIndex).trim();
    const repoPath = entry.slice(separatorIndex + 1).trim();
    if (!isValidRepoId(repoId)) {
      throw new Error(`Invalid repository id in RTGV_REPOS: ${repoId}`);
    }
    if (repositories.has(repoId)) {
      throw new Error(`Duplicate repository id in RTGV_REPOS: ${repoId}`);
    }
    if (!path.isAbsolute(repoPath)) {
      throw new Error(`Repository path for ${repoId} must be absolute`);
    }
    if (!fs.existsSync(repoPath)) {
      throw new Error(`Repository path for ${repoId} does not exist`);
    }

    const realPath = fs.realpathSync(repoPath);
    if (!isGitWorkingTreeRoot(realPath)) {
      throw new Error(`Repository path for ${repoId} must be a Git working tree root`);
    }

    if (realPathIndex.has(realPath)) {
      const firstId = realPathIndex.get(realPath);
      throw new Error(
        `Duplicate repository path in RTGV_REPOS: ${firstId} and ${repoId} resolve to ${realPath}`,
      );
    }
    realPathIndex.set(realPath, repoId);

    repositories.set(repoId, {
      id: repoId,
      path: realPath,
      name: path.basename(realPath),
      origin: "env",
    });
  }

  if (repositories.size > REPO_ALLOWLIST_MAX_SIZE) {
    throw new Error(
      `RTGV_REPOS exceeds ${REPO_ALLOWLIST_MAX_SIZE} entries (got ${repositories.size}). ` +
      `Fleet view is not designed for >${REPO_ALLOWLIST_MAX_SIZE} repos. ` +
      `Reduce the allowlist or run multiple Refscope instances on different ports.`,
    );
  }

  return repositories;
}

/**
 * Merge env-derived and persisted repository entries into a single Map.
 *
 * Rules:
 * - env entries take precedence: if a persisted entry shares an id with an env
 *   entry, the persisted entry is silently skipped (env is authoritative).
 * - id collision between two persisted entries: throws (data integrity error).
 * - realPath collision across env+persisted or within persisted: throws.
 * - Total entry count must not exceed REPO_ALLOWLIST_MAX_SIZE (32).
 *
 * @param {Map<string, { id: string, name: string, path: string, origin: "env" | "ui" }>} envEntries
 * @param {{ id: string, path: string, addedAt: string }[]} persistedEntries
 * @returns {Map<string, { id: string, name: string, path: string, origin: "env" | "ui" }>}
 */
export function mergeRepositoryAllowlist(envEntries, persistedEntries) {
  const merged = new Map(envEntries);

  /** @type {Map<string, string>} realPath -> first repoId that claimed it (all origins) */
  const realPathIndex = new Map();
  for (const [id, entry] of envEntries) {
    realPathIndex.set(entry.path, id);
  }

  for (const persisted of persistedEntries) {
    const { id, path: repoPath } = persisted;

    // Env entries take precedence -- skip silently when id already claimed by env.
    if (envEntries.has(id)) {
      continue;
    }

    if (merged.has(id)) {
      throw new Error(
        `Duplicate repository id in persisted store: ${id}. ` +
        `Edit ~/.config/refscope/repos.json to resolve the conflict.`,
      );
    }

    if (!path.isAbsolute(repoPath)) {
      console.warn(`[reposStore] Skipping persisted repo ${id}: path is not absolute (${repoPath})`);
      continue;
    }
    if (!fs.existsSync(repoPath)) {
      console.warn(`[reposStore] Skipping persisted repo ${id}: path does not exist (${repoPath})`);
      continue;
    }

    let realPath;
    try {
      realPath = fs.realpathSync(repoPath);
    } catch {
      console.warn(`[reposStore] Skipping persisted repo ${id}: cannot resolve realpath (${repoPath})`);
      continue;
    }

    if (!isGitWorkingTreeRoot(realPath)) {
      console.warn(`[reposStore] Skipping persisted repo ${id}: not a Git working tree root (${realPath})`);
      continue;
    }

    if (realPathIndex.has(realPath)) {
      const firstId = realPathIndex.get(realPath);
      throw new Error(
        `Duplicate repository path: persisted repo ${id} and ${firstId} resolve to ${realPath}`,
      );
    }

    realPathIndex.set(realPath, id);
    merged.set(id, {
      id,
      path: realPath,
      name: path.basename(realPath),
      origin: "ui",
    });
  }

  if (merged.size > REPO_ALLOWLIST_MAX_SIZE) {
    throw new Error(
      `Total repository count exceeds ${REPO_ALLOWLIST_MAX_SIZE} entries (got ${merged.size}). ` +
      `Fleet view is not designed for >${REPO_ALLOWLIST_MAX_SIZE} repos. ` +
      `Remove entries from RTGV_REPOS or ~/.config/refscope/repos.json.`,
    );
  }

  return merged;
}

/**
 * Add a repository to the in-memory config and persist it to the store file.
 *
 * Input validation (isValidRepoId, Git root check, etc.) is the caller's
 * responsibility (HTTP layer, Step 3). This function enforces in-memory
 * constraints only.
 *
 * @param {string} id - Repository identifier (pre-validated by caller)
 * @param {string} repoPath - Absolute path to the Git working tree root (pre-validated)
 * @returns {{ id: string, name: string, path: string, origin: "ui" }}
 * @throws {Error} if loadConfig has not been called yet
 * @throws {Error} if id or resolved path already exists in the allowlist
 * @throws {Error} if the allowlist is at maximum capacity
 */
export function addRepository(id, repoPath) {
  if (!_currentConfig) {
    throw new Error("addRepository called before loadConfig");
  }

  const { repositories } = _currentConfig;

  if (repositories.has(id)) {
    throw new Error(`Repository id already exists: ${id}`);
  }

  const realPath = fs.realpathSync(repoPath);

  for (const existing of repositories.values()) {
    if (existing.path === realPath) {
      throw new Error(`Repository path already registered as ${existing.id}: ${realPath}`);
    }
  }

  if (repositories.size >= REPO_ALLOWLIST_MAX_SIZE) {
    throw new Error(
      `Cannot add repository: allowlist is at the maximum of ${REPO_ALLOWLIST_MAX_SIZE} entries`,
    );
  }

  const addedAt = new Date().toISOString();
  appendRepo({ id, path: realPath, addedAt });

  /** @type {{ id: string, name: string, path: string, origin: "ui" }} */
  const entry = {
    id,
    path: realPath,
    name: path.basename(realPath),
    origin: "ui",
  };
  repositories.set(id, entry);
  return entry;
}

/**
 * Remove a repository from the in-memory config and from the store file.
 *
 * Env-origin repositories cannot be removed (they are controlled by RTGV_REPOS).
 *
 * @param {string} id - Repository identifier to remove
 * @returns {{ id: string, name: string, path: string, origin: "env" | "ui" }}
 * @throws {Error} if loadConfig has not been called yet
 * @throws {Error} if the repository does not exist
 * @throws {Error} if the repository has origin "env"
 */
export function removeRepository(id) {
  if (!_currentConfig) {
    throw new Error("removeRepository called before loadConfig");
  }

  const { repositories } = _currentConfig;
  const entry = repositories.get(id);

  if (!entry) {
    throw new Error(`Repository not found: ${id}`);
  }

  if (entry.origin === "env") {
    throw new Error(`Cannot remove env-origin repository: ${id}`);
  }

  removeRepo(id);
  repositories.delete(id);
  return entry;
}

function isGitWorkingTreeRoot(repoPath) {
  try {
    const gitDir = fs.statSync(path.join(repoPath, ".git"));
    return gitDir.isDirectory() || gitDir.isFile();
  } catch {
    return false;
  }
}

function parseAllowedOrigins(value) {
  const rawValue = value?.trim();
  if (rawValue === "*") {
    return "*";
  }

  const source = rawValue ?? "http://localhost:5173,http://127.0.0.1:5173";
  return new Set(
    source
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean)
      .map(normalizeAllowedOrigin),
  );
}

function normalizeAllowedOrigin(origin) {
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    throw new Error(`Invalid origin in RTGV_ALLOWED_ORIGINS: ${origin}`);
  }

  if (
    (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error(`Invalid origin in RTGV_ALLOWED_ORIGINS: ${origin}`);
  }

  return parsed.origin;
}

function parsePort(value, fallback) {
  const parsed = parsePositiveInteger(value, fallback);
  if (parsed > 65535) {
    throw new Error("PORT must be between 1 and 65535");
  }
  return parsed;
}

function parsePositiveInteger(value, fallback, { max, name } = {}) {
  if (value == null || value === "") {
    return fallback;
  }
  const normalized = String(value).trim();
  if (!POSITIVE_DECIMAL_INTEGER_PATTERN.test(normalized)) {
    throw new Error(`Expected a positive decimal integer, got: ${value}`);
  }
  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive decimal integer, got: ${value}`);
  }
  if (max != null && parsed > max) {
    throw new Error(`${name} must be between 1 and ${max}`);
  }
  return parsed;
}
