import { GitCommandError } from "./gitRunner.js";
import {
  isLoopbackHostHeader,
  isValidGitRef,
  isValidRepoId,
  parseDateQuery,
  parseFleetIncludeQuery,
  parseFleetWindowQuery,
  parseFuncNameQuery,
  parseLimitQuery,
  parsePathQuery,
  parsePostBodyJson,
  validateRepoAddInput,
} from "./validation.js";
import {
  HOTSPOT_DEFAULT_COMMIT_CAP,
  HOTSPOT_DEFAULT_LIMIT,
  HOTSPOT_MAX_COMMIT_CAP,
  HOTSPOT_MAX_LIMIT,
  RANGE_HISTORY_DEFAULT_LIMIT,
  RANGE_HISTORY_MAX_LIMIT,
  REF_FLIGHT_DEFAULT_LIMIT,
  REF_FLIGHT_MAX_LIMIT,
  SYMBOL_HISTORY_DEFAULT_LIMIT,
  SYMBOL_HISTORY_MAX_LIMIT,
} from "./gitService.js";

export function createRequestHandler(config, gitService, fleetService) {
  return async function handleRequest(req, res) {
    setSecurityHeaders(res);

    // Checked before CORS and routing so a rebound hostname never receives
    // CORS grants or reaches a handler. Browsers always send Host, so a
    // missing header is rejected too.
    if (config.enforceLoopbackHost !== false && !isLoopbackHostHeader(req.headers.host)) {
      sendJson(res, 403, { error: "Host not allowed" });
      return;
    }

    setCorsHeaders(req, res, config.allowedOrigins);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Parse the request target exactly once, before any routing. A malformed
    // target (e.g. `//a:b`) makes the URL constructor throw synchronously —
    // answer with 400 instead of letting the rejection crash the process.
    let url;
    try {
      url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    } catch (error) {
      if (error instanceof TypeError) {
        sendJson(res, 400, { error: "Invalid request path" });
        return;
      }
      handleError(res, error);
      return;
    }

    // POST /api/repos — add a repository to the allowlist at runtime
    if (req.method === "POST" && url.pathname === "/api/repos") {
      await handlePostRepos(req, res, config, gitService);
      return;
    }

    // DELETE /api/repos/:id — remove a user-managed repository from the allowlist
    if (req.method === "DELETE") {
      const deleteParts = decodePathParts(url.pathname);
      if (deleteParts && deleteParts[0] === "api" && deleteParts[1] === "repos" && deleteParts.length === 3) {
        await handleDeleteRepo(req, res, config, gitService, deleteParts[2]);
        return;
      }
    }

    try {
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
      if (route.name === "refFlightEvents") {
        const limitResult = parseLimitQuery(
          url.searchParams.get("limit"),
          REF_FLIGHT_DEFAULT_LIMIT,
          REF_FLIGHT_MAX_LIMIT,
        );
        if (!limitResult.ok) {
          sendJson(res, 400, { error: limitResult.error });
          return;
        }
        const result = await gitService.listRefFlightEvents(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "branchesGrouped") {
        const result = await gitService.getBranchGroupHealth(repo.value, url.searchParams);
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
      if (route.name === "commitsRisk") {
        const result = await gitService.getCommitRisk(repo.value, route.params.hash);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "commitsContaining") {
        const result = await gitService.getCommitContainingRefs(repo.value, route.params.hash);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "compare") {
        const result = await gitService.compareRefs(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "compareCherry") {
        const result = await gitService.getCompareCherry(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "fileHistory") {
        const result = await gitService.getFileHistory(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "rangeHistory") {
        const result = await gitService.getRangeHistory(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "symbolHistory") {
        // Validate funcname and path before delegating to gitService.
        // parseFuncNameQuery enforces the strict allowlist (Architecture Review flag).
        const funcNameResult = parseFuncNameQuery(url.searchParams.get("funcname"));
        if (!funcNameResult.ok) {
          sendJson(res, 400, { error: funcNameResult.error });
          return;
        }
        const pathResult = parsePathQuery(url.searchParams.get("path"));
        if (!pathResult.ok) {
          sendJson(res, 400, { error: pathResult.error });
          return;
        }
        if (!pathResult.value.trim()) {
          sendJson(res, 400, { error: "Missing path parameter" });
          return;
        }
        const refRaw = url.searchParams.get("ref") ?? "HEAD";
        if (!isValidGitRef(refRaw)) {
          sendJson(res, 400, { error: "Invalid ref parameter" });
          return;
        }
        const limitResult = parseLimitQuery(
          url.searchParams.get("limit"),
          SYMBOL_HISTORY_DEFAULT_LIMIT,
          SYMBOL_HISTORY_MAX_LIMIT,
        );
        if (!limitResult.ok) {
          sendJson(res, 400, { error: limitResult.error });
          return;
        }
        const result = await gitService.getSymbolHistory(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "filesRelated") {
        const result = await gitService.getRelatedFiles(repo.value, url.searchParams);
        sendJson(res, result.status, result.body);
        return;
      }
      if (route.name === "filesHotspot") {
        // Validate query parameters before invoking gitService.
        const refRaw = url.searchParams.get("ref") ?? "HEAD";
        if (!isValidGitRef(refRaw)) {
          sendJson(res, 400, { error: "Invalid ref parameter" });
          return;
        }
        const limitResult = parseLimitQuery(
          url.searchParams.get("limit"),
          HOTSPOT_DEFAULT_LIMIT,
          HOTSPOT_MAX_LIMIT,
        );
        if (!limitResult.ok) {
          sendJson(res, 400, { error: limitResult.error });
          return;
        }
        const commitCapResult = parseLimitQuery(
          url.searchParams.get("commitCap"),
          HOTSPOT_DEFAULT_COMMIT_CAP,
          HOTSPOT_MAX_COMMIT_CAP,
          "commitCap",
        );
        if (!commitCapResult.ok) {
          sendJson(res, 400, { error: commitCapResult.error });
          return;
        }
        const sinceResult = parseDateQuery(url.searchParams.get("since"), "since");
        if (!sinceResult.ok) {
          sendJson(res, 400, { error: sinceResult.error });
          return;
        }
        const result = await gitService.getFileHotspot(repo.value, {
          ref: refRaw,
          limit: limitResult.value,
          commitCap: commitCapResult.value,
          since: sinceResult.value,
        });
        if (result.status === 504) {
          sendJson(res, 504, result.body);
          return;
        }
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
  if (parts.length === 5 && parts[3] === "ref-flight" && parts[4] === "events") {
    return { name: "refFlightEvents", params: { repoId } };
  }
  if (parts.length === 4 && parts[3] === "commits") return { name: "commits", params: { repoId } };
  if (parts.length === 4 && parts[3] === "compare") return { name: "compare", params: { repoId } };
  // Cherry-pick equivalence panel: GET /api/repos/:id/compare/cherry
  // Same query contract as /compare but exposes patch-id correlation
  // (`git cherry`). Read-only, opt-in fetch — heavier than the summary.
  if (parts.length === 5 && parts[3] === "compare" && parts[4] === "cherry") {
    return { name: "compareCherry", params: { repoId } };
  }
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
  // Risky Diff Detector: GET /api/repos/:id/commits/:sha/risk
  // Matched before the generic /commits/:hash route so "risk" is never
  // misread as a hash value. Input validation (isValidObjectId) lives in
  // the handler to keep matchRoute pure.
  if (parts.length === 6 && parts[3] === "commits" && parts[5] === "risk") {
    return { name: "commitsRisk", params: { repoId, hash: parts[4] } };
  }
  // Reachability: GET /api/repos/:id/commits/:sha/refs
  // Returns public refs (heads/tags/remotes) whose history reaches the
  // given commit. Same matching shape as /risk so the literal trailing
  // segment cannot be misread as a hash.
  if (parts.length === 6 && parts[3] === "commits" && parts[5] === "refs") {
    return { name: "commitsContaining", params: { repoId, hash: parts[4] } };
  }
  // File-history view: `/files/history` is a literal sub-path so the file path
  // itself stays in the query string (where validation owns the contract).
  if (parts.length === 5 && parts[3] === "files" && parts[4] === "history") {
    return { name: "fileHistory", params: { repoId } };
  }
  // Range-history (Why panel): `/files/range-history` so the line range and
  // path stay in the query string, matching the validation contract exactly.
  if (parts.length === 5 && parts[3] === "files" && parts[4] === "range-history") {
    return { name: "rangeHistory", params: { repoId } };
  }
  // Symbol-history (D-1): GET /api/repos/:id/symbols/history
  // Path and funcname stay in the query string so validation owns the contract.
  // The `/symbols/history` sub-path is distinct from `/files/*` to signal that
  // this endpoint traces a named symbol (not a file-level history).
  if (parts.length === 5 && parts[3] === "symbols" && parts[4] === "history") {
    return { name: "symbolHistory", params: { repoId } };
  }
  // Related files (co-change) view: same `/files/<verb>` shape as
  // `/files/history`. The target path stays in the query string so validation
  // (`parsePathQuery`) is the single contract authority for path inputs.
  if (parts.length === 5 && parts[3] === "files" && parts[4] === "related") {
    return { name: "filesRelated", params: { repoId } };
  }
  // Hotspot Lens view: LOC × churn scatter data for the repo at a given ref.
  // All query parameters (ref, limit, commitCap, since) are validated in the
  // handler before `gitService.getFileHotspot` is called.
  if (parts.length === 5 && parts[3] === "files" && parts[4] === "hotspot") {
    return { name: "filesHotspot", params: { repoId } };
  }
  // Working-tree changes view: HEAD vs index + index vs worktree.
  // Literal sub-path with no parameters — we surface staged + unstaged
  // diff in a single call so the UI can render both tabs without a
  // round-trip per side.
  if (parts.length === 4 && parts[3] === "worktree") {
    return { name: "workTree", params: { repoId } };
  }
  if (parts.length === 4 && parts[3] === "events") return { name: "events", params: { repoId } };
  // Branch group health: GET /api/repos/:id/branches/grouped
  // Returns branches filtered by prefix with ahead/behind/rotScore fields.
  if (parts.length === 5 && parts[3] === "branches" && parts[4] === "grouped") {
    return { name: "branchesGrouped", params: { repoId } };
  }
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
  let closed = false;
  let poller;
  let heartbeat;

  // Attach the close listener BEFORE the first await: if the client
  // disconnects while the initial snapshot is being computed, the close
  // event would otherwise fire with no listener and the intervals created
  // below would never be cleared. The intervals are guarded because they
  // do not exist yet when close fires during the snapshot await.
  req.on("close", () => {
    closed = true;
    if (poller) clearInterval(poller);
    if (heartbeat) clearInterval(heartbeat);
  });
  // Swallow write errors after a disconnect so they don't surface as
  // unhandled 'error' events on the response stream.
  res.on("error", () => {});

  let snapshot = await gitService.getRefSnapshot(repo);

  if (closed || req.destroyed || res.writableEnded) {
    return;
  }

  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
  });
  writeEvent(res, "connected", { type: "connected", repoId: repo.id });

  let polling = false;

  function stop() {
    closed = true;
    clearInterval(poller);
    clearInterval(heartbeat);
  }

  async function poll() {
    if (closed || polling) return;
    // The repository was removed (or re-registered) after this stream opened:
    // stop reading a path that is no longer allowlisted under this id. The
    // client's reconnect then gets the usual 404.
    if (gitService.getRepository(repo.id) !== repo) {
      stop();
      res.end();
      return;
    }
    polling = true;
    try {
      const result = await gitService.collectRefEvents(repo, snapshot);
      snapshot = result.snapshot;
      if (closed) return;
      for (const event of result.events) {
        writeEvent(res, event.type, event);
      }
    } catch (error) {
      if (closed) return;
      writeEvent(res, "error", publicStreamError(error));
    } finally {
      polling = false;
    }
  }

  poller = setInterval(() => {
    void poll();
  }, config.refPollMs);
  heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 25_000);
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
    const tooLarge = () => Object.assign(new Error("Request body too large"), { tooLarge: true });

    // A declared length over the cap is refused before any byte is read.
    const declaredLength = req.headers?.["content-length"];
    if (typeof declaredLength === "string" && /^[0-9]+$/.test(declaredLength) && Number(declaredLength) > maxBytes) {
      reject(tooLarge());
      return;
    }

    req.on("data", (chunk) => {
      if (aborted) return;
      totalSize += chunk.length;
      if (totalSize > maxBytes) {
        aborted = true;
        reject(tooLarge());
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
 * Check that the request Origin header is present and is either the API's own
 * origin (same-origin UI, e.g. the CLI that serves UI and API on one port) or
 * matches the allowlist. Used for POST/DELETE only (CSRF guard).
 *
 * Same-origin is derived from the Host header, so it is only trusted while the
 * loopback Host guard is active; on a deliberate public bind a rebound
 * hostname would otherwise count as "same-origin".
 *
 * @param {import("node:http").IncomingMessage} req
 * @param {{ allowedOrigins: Set<string> | "*", enforceLoopbackHost?: boolean }} config
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function requireSafeOrigin(req, config) {
  const { allowedOrigins } = config;
  const origin = req.headers.origin;
  if (!origin) {
    return { ok: false, error: "Missing Origin header" };
  }
  if (config.enforceLoopbackHost !== false && origin === `http://${req.headers.host}`) {
    return { ok: true };
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
    const originCheck = requireSafeOrigin(req, config);
    if (!originCheck.ok) {
      sendJson(res, 403, { error: originCheck.error });
      return;
    }

    let bodyBuffer;
    try {
      bodyBuffer = await readRequestBody(req, 4096);
    } catch (error) {
      if (error?.tooLarge) {
        // The rest of the body is never read; closing the connection stops
        // the client from streaming it into a kept-alive socket.
        res.setHeader("connection", "close");
        sendJson(res, 400, { error: "Request body too large" });
      } else {
        sendJson(res, 400, { error: "Invalid request body" });
      }
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
    const originCheck = requireSafeOrigin(req, config);
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
