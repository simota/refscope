import { GitCommandError } from "./gitRunner.js";
import {
  isValidRepoId,
  parseFleetIncludeQuery,
  parseFleetWindowQuery,
  parsePostBodyJson,
  validateRepoAddInput,
} from "./validation.js";

export function createRequestHandler(config, gitService, fleetService) {
  return async function handleRequest(req, res) {
    setSecurityHeaders(res);
    setCorsHeaders(req, res, config.allowedOrigins);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // POST /api/repos — add a repository to the allowlist at runtime
    if (req.method === "POST" && (new URL(req.url ?? "/", "http://localhost")).pathname === "/api/repos") {
      await handlePostRepos(req, res, config, gitService);
      return;
    }

    // DELETE /api/repos/:id — remove a user-managed repository from the allowlist
    if (req.method === "DELETE") {
      const parsedUrl = new URL(req.url ?? "/", "http://localhost");
      const deleteParts = decodePathParts(parsedUrl.pathname);
      if (deleteParts && deleteParts[0] === "api" && deleteParts[1] === "repos" && deleteParts.length === 3) {
        await handleDeleteRepo(req, res, config, gitService, deleteParts[2]);
        return;
      }
    }

    try {
      const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const route = matchRoute(req.method, url.pathname);

      if (route?.name === "badRequest") {
        sendJson(res, 400, { error: route.error });
        return;
      }

      if (!route) {
        sendJson(res, 404, { error: "Not found" });
        return;
      }

      if (route.name === "health") {
        sendJson(res, 200, { status: "ok" });
        return;
      }

      if (route.name === "repos") {
        sendJson(res, 200, { repositories: gitService.listRepositories() });
        return;
      }

      if (route.name === "fleetSnapshot") {
        const includeResult = parseFleetIncludeQuery(url.searchParams.get("include"));
        if (!includeResult.ok) {
          sendJson(res, 400, { error: includeResult.error });
          return;
        }
        const windowResult = parseFleetWindowQuery(url.searchParams.get("window"));
        if (!windowResult.ok) {
          sendJson(res, 400, { error: windowResult.error });
          return;
        }
        const snapshot = await fleetService.getFleetSnapshot({
          include: includeResult.value,
          window: windowResult.value,
        });
        sendJson(res, 200, snapshot);
        return;
      }

      const repo = resolveRepo(route.params.repoId, gitService);
      if (!repo.ok) {
        sendJson(res, repo.status, { error: repo.error });
        return;
      }

      if (route.name === "refs") {
        sendJson(res, 200, { refs: await gitService.listRefs(repo.value) });
        return;
      }
      if (route.name === "stashes") {
        const result = await gitService.listStashes(repo.value);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "worktrees") {
        const result = await gitService.listWorktrees(repo.value);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "submodules") {
        const result = await gitService.listSubmodules(repo.value);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "state") {
        const result = await gitService.getRepoState(repo.value);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "refsDrift") {
        const result = await gitService.getRefDrift(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "commits") {
        const result = await gitService.listCommits(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "commitsSummary") {
        const result = await gitService.summarizeCommits(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "commit") {
        const result = await gitService.getCommit(repo.value, route.params.hash);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "diff") {
        const result = await gitService.getDiff(repo.value, route.params.hash);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "compare") {
        const result = await gitService.compareRefs(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "fileHistory") {
        const result = await gitService.getFileHistory(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "filesRelated") {
        const result = await gitService.getRelatedFiles(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "workTree") {
        const result = await gitService.getWorkTreeChanges(repo.value);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "events") {
        await sendEventStream(req, res, config, gitService, repo.value);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (error) {
      handleError(res, error);
    }
  };
}

function matchRoute(method, pathname) {
  if (method !== "GET") return null;
  if (pathname === "/health") return { name: "health", params: {} };
  if (pathname === "/api/repos") return { name: "repos", params: {} };

  const parts = decodePathParts(pathname);
  if (!parts) {
    return { name: "badRequest", error: "Invalid request path", params: {} };
  }

  // Fleet snapshot endpoint: GET /api/fleet/snapshot
  // Discriminated on parts[1] === 'fleet' so it never collides with the
  // /api/repos/:repoId family (parts[1] === 'repos').
  if (parts[0] === "api" && parts[1] === "fleet" && parts[2] === "snapshot" && parts.length === 3) {
    return { name: "fleetSnapshot", params: {} };
  }

  if (parts[0] !== "api" || parts[1] !== "repos" || !parts[2]) return null;

  const repoId = parts[2];
  if (parts.length === 4 && parts[3] === "refs") return { name: "refs", params: { repoId } };
  if (parts.length === 4 && parts[3] === "stashes") {
    return { name: "stashes", params: { repoId } };
  }
  if (parts.length === 4 && parts[3] === "worktrees") {
    return { name: "worktrees", params: { repoId } };
  }
  if (parts.length === 4 && parts[3] === "submodules") {
    return { name: "submodules", params: { repoId } };
  }
  if (parts.length === 4 && parts[3] === "state") {
    return { name: "state", params: { repoId } };
  }
  // `/refs/drift` is a literal sub-path that lives one segment deeper than
  // `/refs`. Distinct `parts.length` keeps the two from colliding, but we
  // match the longer form first for symmetry with the `/commits/summary`
  // pattern used elsewhere in this router.
  if (parts.length === 5 && parts[3] === "refs" && parts[4] === "drift") {
    return { name: "refsDrift", params: { repoId } };
  }
  if (parts.length === 4 && parts[3] === "commits") return { name: "commits", params: { repoId } };
  if (parts.length === 4 && parts[3] === "compare") return { name: "compare", params: { repoId } };
  // `/commits/summary` is matched before the generic `/commits/:hash` route so
  // the literal path segment cannot be misread as a commit hash.
  if (parts.length === 5 && parts[3] === "commits" && parts[4] === "summary") {
    return { name: "commitsSummary", params: { repoId } };
  }
  if (parts.length === 5 && parts[3] === "commits") {
    return { name: "commit", params: { repoId, hash: parts[4] } };
  }
  if (parts.length === 6 && parts[3] === "commits" && parts[5] === "diff") {
    return { name: "diff", params: { repoId, hash: parts[4] } };
  }
  // File-history view: `/files/history` is a literal sub-path so the file path
  // itself stays in the query string (where validation owns the contract).
  if (parts.length === 5 && parts[3] === "files" && parts[4] === "history") {
    return { name: "fileHistory", params: { repoId } };
  }
  // Related files (co-change) view: same `/files/<verb>` shape as
  // `/files/history`. The target path stays in the query string so validation
  // (`parsePathQuery`) is the single contract authority for path inputs.
  if (parts.length === 5 && parts[3] === "files" && parts[4] === "related") {
    return { name: "filesRelated", params: { repoId } };
  }
  // Working-tree changes view: HEAD vs index + index vs worktree.
  // Literal sub-path with no parameters — we surface staged + unstaged
  // diff in a single call so the UI can render both tabs without a
  // round-trip per side.
  if (parts.length === 4 && parts[3] === "worktree") {
    return { name: "workTree", params: { repoId } };
  }
  if (parts.length === 4 && parts[3] === "events") return { name: "events", params: { repoId } };
  return null;
}

function decodePathParts(pathname) {
  try {
    return pathname.split("/").filter(Boolean).map(decodeURIComponent);
  } catch (error) {
    if (error instanceof URIError) {
      return null;
    }
    throw error;
  }
}

function resolveRepo(repoId, gitService) {
  if (!isValidRepoId(repoId)) {
    return { ok: false, status: 400, error: "Invalid repository id" };
  }

  const repo = gitService.getRepository(repoId);
  if (!repo) {
    return { ok: false, status: 404, error: "Repository is not allowlisted" };
  }

  return { ok: true, value: repo };
}

function handleError(res, error) {
  if (error instanceof GitCommandError) {
    const status = error.timedOut || error.truncated ? 504 : 502;
    sendJson(res, status, {
      error: "Git command failed",
      timedOut: error.timedOut,
      truncated: error.truncated,
    });
    return;
  }

  sendJson(res, 500, { error: "Internal server error" });
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function sendEventStream(req, res, config, gitService, repo) {
  let snapshot = await gitService.getRefSnapshot(repo);

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  writeEvent(res, "connected", { type: "connected", repoId: repo.id });

  let closed = false;
  let polling = false;

  async function poll() {
    if (closed || polling) return;
    polling = true;
    try {
      const result = await gitService.collectRefEvents(repo, snapshot);
      snapshot = result.snapshot;
      for (const event of result.events) {
        writeEvent(res, event.type, event);
      }
    } catch (error) {
      writeEvent(res, "error", publicStreamError(error));
    } finally {
      polling = false;
    }
  }

  const poller = setInterval(() => {
    void poll();
  }, config.refPollMs);
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25_000);
  req.on("close", () => {
    closed = true;
    clearInterval(poller);
    clearInterval(heartbeat);
  });
}

function writeEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function publicStreamError(error) {
  if (error instanceof GitCommandError) {
    return {
      type: "error",
      error: "Git command failed",
      timedOut: error.timedOut,
      truncated: error.truncated,
    };
  }
  return { type: "error", error: "Internal server error" };
}

function setSecurityHeaders(res) {
  res.setHeader("x-content-type-options", "nosniff");
  res.setHeader("referrer-policy", "no-referrer");
}

function setCorsHeaders(req, res, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) return;
  if (allowedOrigins === "*" || allowedOrigins.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "Origin");
    res.setHeader("access-control-allow-methods", "GET, POST, DELETE, OPTIONS");
    res.setHeader("access-control-allow-headers", "content-type");
  }
}

/**
 * Read and buffer the request body up to maxBytes.
 * Returns a Promise<Buffer>.
 * Rejects with an error if the body exceeds maxBytes or a read error occurs.
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {number} maxBytes
 * @returns {Promise<Buffer>}
 */
function readRequestBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let totalSize = 0;
    let aborted = false;

    req.on("data", (chunk) => {
      if (aborted) return;
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        aborted = true;
        reject(new Error("Request body too large"));
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      if (!aborted) {
        resolve(Buffer.concat(chunks));
      }
    });

    req.on("error", (err) => {
      if (!aborted) {
        aborted = true;
        reject(err);
      }
    });
  });
}

/**
 * Check that the request Origin header is present and matches the allowlist.
 * Used for POST/DELETE only (CSRF guard).
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {Set<string> | "*"} allowedOrigins
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function requireSafeOrigin(req, allowedOrigins) {
  const origin = req.headers.origin;
  if (!origin) {
    return { ok: false, error: "Missing Origin header" };
  }
  if (allowedOrigins !== "*" && !allowedOrigins.has(origin)) {
    return { ok: false, error: "Origin not allowed" };
  }
  return { ok: true };
}

/**
 * Handle POST /api/repos — add a repository to the runtime allowlist.
 *
 * Flow: requireSafeOrigin → readRequestBody → parsePostBodyJson →
 *       validateRepoAddInput → gitService.addRepository → 200
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {object} config
 * @param {object} gitService
 */
async function handlePostRepos(req, res, config, gitService) {
  try {
    const originCheck = requireSafeOrigin(req, config.allowedOrigins);
    if (!originCheck.ok) {
      sendJson(res, 403, { error: originCheck.error });
      return;
    }

    let bodyBuffer;
    try {
      bodyBuffer = await readRequestBody(req, 4096);
    } catch {
      sendJson(res, 400, { error: "Request body too large" });
      return;
    }

    const parseResult = parsePostBodyJson(bodyBuffer, { id: "string", path: "string" });
    if (!parseResult.ok) {
      sendJson(res, 400, { error: parseResult.error });
      return;
    }

    const { id, path } = parseResult.value;
    const validateResult = validateRepoAddInput({ id, path });
    if (!validateResult.ok) {
      sendJson(res, 400, { error: validateResult.error });
      return;
    }

    const { id: validId, normalizedPath } = validateResult.value;

    let entry;
    try {
      entry = gitService.addRepository(validId, normalizedPath);
    } catch (err) {
      const msg = err.message ?? "";
      if (msg.includes("already exists")) {
        sendJson(res, 409, { error: "Repository id already exists" });
      } else if (msg.includes("already registered")) {
        // Extract the conflicting id from the error message
        const match = msg.match(/already registered as ([^:]+)/);
        const conflictId = match ? match[1].trim() : "another id";
        sendJson(res, 409, { error: `Repository path already registered as ${conflictId}` });
      } else if (msg.includes("maximum") || msg.includes("allowlist is at")) {
        sendJson(res, 400, { error: "Repository allowlist full (max 32)" });
      } else {
        handleError(res, err);
      }
      return;
    }

    sendJson(res, 200, { repository: entry });
  } catch (error) {
    handleError(res, error);
  }
}

/**
 * Handle DELETE /api/repos/:id — remove a user-managed repository from the allowlist.
 *
 * Flow: requireSafeOrigin → isValidRepoId → gitService.removeRepository → 204
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {import("node:http").ServerResponse} res
 * @param {object} config
 * @param {object} gitService
 * @param {string} id
 */
async function handleDeleteRepo(req, res, config, gitService, id) {
  try {
    const originCheck = requireSafeOrigin(req, config.allowedOrigins);
    if (!originCheck.ok) {
      sendJson(res, 403, { error: originCheck.error });
      return;
    }

    if (!isValidRepoId(id)) {
      sendJson(res, 400, { error: "Invalid repository id" });
      return;
    }

    try {
      gitService.removeRepository(id);
    } catch (err) {
      const msg = err.message ?? "";
      if (msg.includes("env-origin")) {
        sendJson(res, 400, { error: "Cannot remove repository defined via RTGV_REPOS env var" });
      } else if (msg.includes("not found") || msg.includes("Repository not found")) {
        sendJson(res, 404, { error: "Repository not found" });
      } else {
        handleError(res, err);
      }
      return;
    }

    res.writeHead(204);
    res.end();
  } catch (error) {
    handleError(res, error);
  }
}
