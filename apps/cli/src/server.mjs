import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createStaticHandler } from "./static-server.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUNDLED_API_DIR = path.join(HERE, "bundled-api");
const STATIC_DIR = path.join(HERE, "static");

/**
 * Build the API stack from the bundled apps/api source, mount it under
 * `/api/*` and `/health`, and fall back to a static file server for every
 * other path so a single port hosts both surfaces.
 *
 * @returns {Promise<{ server: import("node:http").Server, port: number }>}
 */
export async function startServer() {
  const config = await loadApiConfig();
  const gitService = await createGitService(config);
  const apiHandler = await createApiHandler(config, gitService);
  const staticHandler = createStaticHandler(STATIC_DIR);

  const server = http.createServer((req, res) => {
    const pathname = extractPathname(req.url);
    if (isApiRequest(pathname)) {
      apiHandler(req, res);
      return;
    }
    staticHandler(req, res);
  });

  await listen(server, config.port, config.host);
  // The actual port may differ from the requested one only if the user passes
  // an OS-assigned port (`0`) — surface the bound value so callers can print
  // the canonical URL.
  const address = server.address();
  const boundPort = typeof address === "object" && address ? address.port : config.port;
  return { server, port: boundPort };
}

function isApiRequest(pathname) {
  if (pathname === "/health") return true;
  return pathname.startsWith("/api/") || pathname === "/api";
}

function extractPathname(url) {
  if (!url) return "/";
  // Use a placeholder origin so URL parsing succeeds for relative request
  // targets (`/foo?x=1`). We only care about the pathname here.
  try {
    return new URL(url, "http://localhost").pathname;
  } catch {
    return "/";
  }
}

async function loadApiConfig() {
  const mod = await import(modulePath("config.js"));
  return mod.loadConfig();
}

async function createGitService(config) {
  const mod = await import(modulePath("gitService.js"));
  return mod.createGitService(config);
}

async function createApiHandler(config, gitService) {
  const mod = await import(modulePath("http.js"));
  return mod.createRequestHandler(config, gitService);
}

function modulePath(file) {
  // pathToFileURL handles Windows drive letters and percent-encoding so
  // dynamic import gets a spec that resolves on every platform.
  return pathToFileURL(path.join(BUNDLED_API_DIR, file)).href;
}

function listen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.removeListener("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

// Exported so tests / future tooling can introspect the bundled paths
// without re-deriving them.
export const paths = {
  bundledApi: BUNDLED_API_DIR,
  staticRoot: STATIC_DIR,
};
