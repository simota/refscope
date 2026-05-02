import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { startServer } from "./server.mjs";
import { openBrowser } from "./open-browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PACKAGE_JSON = path.resolve(HERE, "..", "package.json");

const HELP = `refscope — an observatory for Git refs and history.

By default, Refscope observes the current working directory.

Usage:
  refscope [options]

Options:
  --repo <path>             Git working tree to observe (default: current directory)
  --port <number>           Port to listen on (default: 4175)
  --host <hostname>         Host interface to bind (default: 127.0.0.1)
  --no-open                 Do not open a browser window on startup
  --ref-poll <ms>           Ref polling interval for live updates (default: 2000)
  --git-timeout <ms>        Per-Git-command timeout (default: 5000)
  --diff-max-bytes <bytes>  Maximum diff payload retained in memory (default: 512000)
  -h, --help                Show this help and exit
  -v, --version             Show version and exit

The repository is read-only. Refscope never writes to it, never fetches, and
never invokes user-configured hooks, GPG, pagers, or external diff drivers.
`;

/**
 * Entry point used by bin/refscope.mjs. Resolves arguments, validates the
 * target repository, configures the API via environment variables, and starts
 * a single HTTP server that serves both the API and the bundled UI.
 *
 * @param {string[]} argv
 */
export async function run(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    process.stderr.write(`refscope: ${error.message}\n`);
    process.stderr.write(`Run "refscope --help" for usage.\n`);
    process.exit(2);
    return;
  }

  if (parsed.help) {
    process.stdout.write(HELP);
    return;
  }
  if (parsed.version) {
    process.stdout.write(`${readVersion()}\n`);
    return;
  }

  const repoPath = path.resolve(parsed.repo);
  const repoCheck = validateRepoPath(repoPath, { fromCwd: !parsed.repoExplicit });
  if (!repoCheck.ok) {
    process.stderr.write(`refscope: ${repoCheck.error}\n`);
    process.exit(1);
    return;
  }

  // Inject the API contract through env so loadConfig() stays the single
  // owner of validation. Same-origin serving means CORS is moot, so the
  // wildcard is safe; nothing outside this process can reach the API.
  process.env.RTGV_REPOS = `cli=${repoCheck.canonicalPath}`;
  process.env.HOST = parsed.host;
  process.env.PORT = String(parsed.port);
  if (parsed.refPollMs != null) {
    process.env.RTGV_REF_POLL_MS = String(parsed.refPollMs);
  }
  if (parsed.gitTimeoutMs != null) {
    process.env.RTGV_GIT_TIMEOUT_MS = String(parsed.gitTimeoutMs);
  }
  if (parsed.diffMaxBytes != null) {
    process.env.RTGV_DIFF_MAX_BYTES = String(parsed.diffMaxBytes);
  }
  process.env.RTGV_ALLOWED_ORIGINS = "*";

  let started;
  try {
    started = await startServer();
  } catch (error) {
    process.stderr.write(`refscope: ${error.message ?? error}\n`);
    process.exit(1);
    return;
  }

  const url = `http://${displayHost(parsed.host)}:${started.port}`;
  process.stdout.write(`Refscope is open at ${url}\n`);
  process.stdout.write(`Observing ${repoCheck.canonicalPath}\n`);
  process.stdout.write(`Press Ctrl+C to stop.\n`);

  if (parsed.open) {
    // Browser launch is best-effort; failing to open should not abort the
    // server. Users with --no-open or in headless environments will copy the
    // URL printed above.
    openBrowser(url).catch(() => {
      /* swallowed by design */
    });
  }

  setupShutdown(started.server);
}

function parseArgs(argv) {
  const parsed = {
    repo: process.cwd(),
    repoExplicit: false,
    port: 4175,
    host: "127.0.0.1",
    open: true,
    refPollMs: null,
    gitTimeoutMs: null,
    diffMaxBytes: null,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    switch (arg) {
      case "-h":
      case "--help":
        parsed.help = true;
        break;
      case "-v":
      case "--version":
        parsed.version = true;
        break;
      case "--no-open":
        parsed.open = false;
        break;
      case "--repo":
        parsed.repo = requireValue(arg, argv[++i]);
        parsed.repoExplicit = true;
        break;
      case "--port":
        parsed.port = parsePositiveInt(arg, requireValue(arg, argv[++i]), 65535);
        break;
      case "--host":
        parsed.host = requireValue(arg, argv[++i]);
        break;
      case "--ref-poll":
        parsed.refPollMs = parsePositiveInt(arg, requireValue(arg, argv[++i]));
        break;
      case "--git-timeout":
        parsed.gitTimeoutMs = parsePositiveInt(arg, requireValue(arg, argv[++i]));
        break;
      case "--diff-max-bytes":
        parsed.diffMaxBytes = parsePositiveInt(arg, requireValue(arg, argv[++i]));
        break;
      default:
        if (arg.startsWith("--")) {
          throw new Error(`Unknown option: ${arg}`);
        }
        throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }

  return parsed;
}

function requireValue(flag, value) {
  if (value == null || value.startsWith("-")) {
    throw new Error(`Option ${flag} requires a value`);
  }
  return value;
}

function parsePositiveInt(flag, value, max) {
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`Option ${flag} requires a positive integer, got: ${value}`);
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Option ${flag} requires a positive integer, got: ${value}`);
  }
  if (max != null && parsed > max) {
    throw new Error(`Option ${flag} must be between 1 and ${max}`);
  }
  return parsed;
}

/**
 * Refuse to start unless the path resolves to a Git working tree root. The
 * shared API runner enforces the same rule, but checking here lets us return
 * an actionable, single-line message before the server even boots. The
 * `fromCwd` flag tailors the hint so cwd-derived failures point users at
 * `--repo` instead of asking them to re-run from a different shell.
 */
function validateRepoPath(repoPath, { fromCwd } = { fromCwd: false }) {
  const notWorkingTree = (resolvedPath) =>
    fromCwd
      ? `${resolvedPath} is not a Git working tree. Run \`npx refscope\` from inside a repository, or pass \`--repo <absolute-path>\`.`
      : `${resolvedPath} is not a Git working tree.`;

  let canonicalPath;
  try {
    canonicalPath = fs.realpathSync(repoPath);
  } catch {
    return { ok: false, error: notWorkingTree(repoPath) };
  }

  let stat;
  try {
    stat = fs.statSync(canonicalPath);
  } catch {
    return { ok: false, error: notWorkingTree(canonicalPath) };
  }
  if (!stat.isDirectory()) {
    return { ok: false, error: notWorkingTree(canonicalPath) };
  }

  let gitEntry;
  try {
    gitEntry = fs.statSync(path.join(canonicalPath, ".git"));
  } catch {
    return { ok: false, error: notWorkingTree(canonicalPath) };
  }
  if (!gitEntry.isDirectory() && !gitEntry.isFile()) {
    return { ok: false, error: notWorkingTree(canonicalPath) };
  }

  return { ok: true, canonicalPath };
}

function displayHost(host) {
  // 0.0.0.0 is hard to copy into a browser; show the loopback alias so the
  // printed URL is clickable on the local machine.
  if (host === "0.0.0.0") return "127.0.0.1";
  return host;
}

function readVersion() {
  try {
    const raw = fs.readFileSync(PACKAGE_JSON, "utf8");
    const parsed = JSON.parse(raw);
    return parsed.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

function setupShutdown(server) {
  let shuttingDown = false;
  const stop = (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stdout.write(`\nrefscope: received ${signal}, shutting down.\n`);
    server.close(() => {
      process.exit(0);
    });
    // Force exit if a long-lived SSE connection blocks server.close beyond
    // a reasonable grace window. Refscope is a local tool; users expect
    // Ctrl+C to be immediate.
    setTimeout(() => process.exit(0), 1500).unref();
  };
  process.on("SIGINT", () => stop("SIGINT"));
  process.on("SIGTERM", () => stop("SIGTERM"));
}
