import fs from "node:fs";
import path from "node:path";

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".map", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".gif", "image/gif"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff", "font/woff"],
  [".woff2", "font/woff2"],
  [".ttf", "font/ttf"],
  [".txt", "text/plain; charset=utf-8"],
]);

/**
 * Build a request handler that serves files from `rootDir`. Path traversal is
 * blocked by canonicalising the requested path and refusing anything that
 * escapes the root. Missing files fall back to `index.html` so the SPA can
 * own client-side routing.
 *
 * @param {string} rootDir Absolute directory path.
 */
export function createStaticHandler(rootDir) {
  const canonicalRoot = path.resolve(rootDir);
  const indexPath = path.join(canonicalRoot, "index.html");

  return function handleStatic(req, res) {
    if (req.method !== "GET" && req.method !== "HEAD") {
      writeText(res, 405, "Method not allowed");
      return;
    }

    const pathname = extractPathname(req.url);
    if (pathname == null) {
      writeText(res, 400, "Bad request");
      return;
    }

    const candidate = resolveSafePath(canonicalRoot, pathname);
    if (!candidate) {
      writeText(res, 400, "Bad request");
      return;
    }

    serveFile(candidate, req, res, () => {
      // SPA fallback. Index is served with no-cache so a stale HTML never
      // pins users to obsolete asset hashes after upgrades.
      serveFile(indexPath, req, res, () => writeText(res, 404, "Not found"));
    });
  };
}

function extractPathname(url) {
  if (!url) return "/";
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return null;
  }
}

function resolveSafePath(rootDir, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }

  // Strip leading slashes so path.join treats the result as relative.
  const relative = decoded.replace(/^\/+/, "");
  const target = relative === "" ? "index.html" : relative;
  const resolved = path.resolve(rootDir, target);

  // Reject anything that escapes the configured root after normalisation.
  // path.relative returning an absolute or `..`-prefixed value means the
  // request resolved outside `rootDir`.
  const rel = path.relative(rootDir, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null;
  }
  return resolved;
}

function serveFile(filePath, req, res, onMissing) {
  fs.stat(filePath, (statError, stats) => {
    if (statError || !stats.isFile()) {
      onMissing();
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    const contentType = CONTENT_TYPES.get(ext) ?? "application/octet-stream";
    const headers = {
      "content-type": contentType,
      "content-length": stats.size,
      "x-content-type-options": "nosniff",
      "cache-control": cacheControlFor(filePath, ext),
    };

    if (req.method === "HEAD") {
      res.writeHead(200, headers);
      res.end();
      return;
    }

    res.writeHead(200, headers);
    const stream = fs.createReadStream(filePath);
    stream.on("error", () => {
      // Headers are already on the wire; the only safe option is to abort
      // the connection so the client surfaces a network error.
      res.destroy();
    });
    stream.pipe(res);
  });
}

function cacheControlFor(filePath, ext) {
  if (ext === ".html") return "no-cache";
  // Vite emits hashed filenames for assets, so anything under `/assets/` is
  // safe to cache aggressively. Everything else stays conservative.
  if (filePath.includes(`${path.sep}assets${path.sep}`)) {
    return "public, max-age=31536000, immutable";
  }
  return "public, max-age=300";
}

function writeText(res, status, body) {
  res.writeHead(status, {
    "content-type": "text/plain; charset=utf-8",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}
