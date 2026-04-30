import fs from "node:fs";
import path from "node:path";

import { isValidRepoId } from "./validation.js";

export const DEFAULT_PORT = 4175;
const POSITIVE_DECIMAL_INTEGER_PATTERN = /^[0-9]+$/;

export function loadConfig(env = process.env) {
  const repositories = parseRepositoryAllowlist(env.RTGV_REPOS ?? "");
  const allowedOrigins = parseAllowedOrigins(env.RTGV_ALLOWED_ORIGINS);

  return {
    host: env.HOST ?? "127.0.0.1",
    port: parsePort(env.PORT, DEFAULT_PORT),
    gitTimeoutMs: parsePositiveInteger(env.RTGV_GIT_TIMEOUT_MS, 5000),
    diffMaxBytes: parsePositiveInteger(env.RTGV_DIFF_MAX_BYTES, 512_000),
    refPollMs: parsePositiveInteger(env.RTGV_REF_POLL_MS, 2000),
    repositories,
    allowedOrigins,
  };
}

export function parseRepositoryAllowlist(value) {
  if (!value.trim()) {
    return new Map();
  }

  const repositories = new Map();
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

    repositories.set(repoId, {
      id: repoId,
      path: realPath,
      name: path.basename(realPath),
    });
  }

  return repositories;
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

function parsePositiveInteger(value, fallback) {
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
  return parsed;
}
